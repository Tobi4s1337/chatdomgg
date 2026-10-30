# Twitch OAuth & tokens — complete guide (TypeScript)

Source of truth: `references/official/authentication*.md` (snapshot 2026-10-26). Everything below is
from those pages unless marked *(observed)* or *(Twurple)*.

## Contents
1. Mental model: two token types, three client situations
2. Endpoints at a glance
3. Flow: Authorization code (server apps — the default)
4. Flow: Client credentials (app access token)
5. Flow: Device code (DCF) — public vs confidential clients
6. Flow: Implicit (browser-only)
7. OIDC: id_token, claims, /userinfo, verifying the JWT
8. Refreshing (and the public-client rules)
9. Validating (the hourly requirement)
10. Revoking
11. Lifetimes cheat-sheet
12. Error handling
13. Storing tokens safely
14. Multi-user patterns (broadcaster + bot, many channels)
15. Which token for which surface

---

## 1. Mental model

| | **User access token** | **App access token** |
|---|---|---|
| Represents | a Twitch user who clicked *Authorize* for your client ID | your application (client ID) only |
| Carries scopes | yes — exactly the ones the user granted | no scopes of its own — but see "prior authorization" below |
| Obtained via | authorization code, implicit, device code (DCF), OIDC variants | client credentials only |
| Refreshable | yes (auth code + DCF give refresh tokens; implicit does not) | **no** — just request a new one |
| `/validate` shows | `login`, `user_id`, `scopes` | `login`/`user_id` = `null` |

**"App token with prior authorization"** (important, newer behaviour): a growing list of Helix
endpoints accept an *app* access token **if the relevant user has previously authorized your client ID
with the needed scope** (GA since 2026-05-29). Examples: Send Chat Message, Send Chat Announcement,
Send a Shoutout, Ban/Unban, Get Chatters, Update Chat Settings, Delete Chat Messages, Pin/Unpin chat
messages, Start Commercial, Get Ad Schedule, Snooze Next Ad, Check AutoMod Status, Warn Chat User,
Shield Mode, Blocked Terms, Get Moderated Channels. Most chat-actor endpoints additionally require the
acting user's `user:bot` and the broadcaster's `channel:bot` (or mod status). Same idea for EventSub
chat types over webhooks/conduits. The authorization is remembered server-side per (client ID, user),
so a bot account authorizes **once** and your backend then works with just an app token.
→ Per-endpoint rules: see the twitch-api skill; `node scripts/token.ts scopes "<endpoint>"`.

**Client type** (set in the dev console, see `app-registration.md`):
- **Confidential** (default; has a client secret; secret lives on a server). Can use every flow.
- **Public** (no secret; for desktop/mobile/CLI apps that cannot keep a secret). **Device code flow only**;
  refresh works without a secret, but refresh tokens are single-use and expire after 30 days.

## 2. Endpoints at a glance

| Purpose | Request |
|---|---|
| Authorize (browser redirect) | `GET https://id.twitch.tv/oauth2/authorize?response_type=code\|token\|token+id_token\|id_token&client_id&redirect_uri&scope&state[&force_verify=true][&nonce][&claims]` |
| Token (code / client creds / refresh / device) | `POST https://id.twitch.tv/oauth2/token` (x-www-form-urlencoded) |
| Device authorization | `POST https://id.twitch.tv/oauth2/device` (`client_id`, `scopes`) |
| Validate | `GET https://id.twitch.tv/oauth2/validate` with `Authorization: OAuth <token>` (`Bearer` also accepted) |
| Revoke | `POST https://id.twitch.tv/oauth2/revoke` (`client_id`, `token`) |
| OIDC discovery | `GET https://id.twitch.tv/oauth2/.well-known/openid-configuration` |
| OIDC userinfo | `GET https://id.twitch.tv/oauth2/userinfo` with `Authorization: Bearer <access token>` |
| OIDC JWKS | `https://id.twitch.tv/oauth2/keys` (RS256) |

Every Helix call sends **both** `Authorization: Bearer <token>` and `Client-Id: <client id>`; the
client ID must be the one the token was issued to (else 401).

## 3. Authorization code grant flow (server apps)

Use for: anything with a backend — "Connect with Twitch" for the broadcaster, logging in the bot account.

```ts
// server/auth.ts — minimal, dependency-free (Node 22+). Works in Nitro/Express/node:http alike.
import { randomBytes } from 'node:crypto';

const CLIENT_ID = process.env.TWITCH_CLIENT_ID!;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET!;
const REDIRECT_URI = process.env.TWITCH_REDIRECT_URI ?? 'http://localhost:3000/auth/callback'; // registered EXACTLY

export function buildAuthorizeUrl(scopes: string[], forceVerify = false): { url: string; state: string } {
  const state = randomBytes(16).toString('hex'); // store in the session/cookie; compare on callback (CSRF)
  const q = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: scopes.join(' '), state });
  if (forceVerify) q.set('force_verify', 'true'); // re-show consent (switch accounts, add scopes)
  return { url: `https://id.twitch.tv/oauth2/authorize?${q}`, state };
}

export interface TwitchTokenResponse { access_token: string; refresh_token?: string; expires_in: number; scope?: string[]; token_type: 'bearer'; id_token?: string }

export async function exchangeCode(code: string): Promise<TwitchTokenResponse> {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI }),
  });
  if (!res.ok) throw new Error(`code exchange ${res.status}: ${await res.text()}`);
  return (await res.json()) as TwitchTokenResponse;
}

// Callback handler: GET /auth/callback?code=...&scope=...&state=...   or  ?error=access_denied&error_description=...
export async function handleCallback(query: URLSearchParams, expectedState: string) {
  if (query.get('error')) throw new Error(`user declined: ${query.get('error_description')}`);
  if (query.get('state') !== expectedState) throw new Error('state mismatch - ignore this response');
  const tokens = await exchangeCode(query.get('code')!);
  const who = await validate(tokens.access_token); // learn user_id/login + actual granted scopes
  return { ...tokens, user_id: who!.user_id!, login: who!.login! };
}
```

Notes
- `scope` is **space**-delimited (URLSearchParams encodes spaces as `+`, which Twitch accepts).
- The user may have previously granted *fewer* scopes; always check `scope` in the token response /
  `/validate` instead of assuming. Request only scopes you use — over-asking can get the app suspended.
- The code is single-use and short-lived; exchange it immediately.

## 4. Client credentials grant (app access token)

```ts
export async function getAppToken(): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`client_credentials ${res.status}: ${await res.text()}`);
  return (await res.json()) as { access_token: string; expires_in: number }; // no refresh_token, no scope
}
```
Cache it; on 401 (or near `expires_in`) just call again. Needed for: EventSub **webhooks** and **conduits**
(subscription management must use an app token), the chatbot badge (sending chat with an app token),
Extensions endpoints that demand an app token, `Get Authorization By User`, and any public-data reads.

## 5. Device code grant flow (DCF)

For apps without a usable browser redirect: CLIs, desktop/Electron, game consoles — and handy for local dev
of a bot account. Works for **public** (no secret) and **confidential** clients.

```ts
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function deviceFlow(clientId: string, scopes: string[], clientSecret?: string) {
  const start = await fetch('https://id.twitch.tv/oauth2/device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scopes: scopes.join(' ') }), // NB: "scopes" (plural)
  });
  if (!start.ok) throw new Error(`device start ${start.status}: ${await start.text()}`);
  const d = (await start.json()) as { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number };
  console.log(`Go to ${d.verification_uri} (code ${d.user_code})`); // e.g. https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH

  const deadline = Date.now() + d.expires_in * 1000; // docs example: 1800 s
  while (Date.now() < deadline) {
    await sleep(d.interval * 1000); // docs example: 5 s
    const body = new URLSearchParams({ client_id: clientId, scopes: scopes.join(' '), device_code: d.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    if (clientSecret) body.set('client_secret', clientSecret);
    const res = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string[]; message?: string };
    if (res.ok) return json;                        // { access_token, refresh_token, expires_in, scope[] }
    if (json.message === 'authorization_pending') continue; // user hasn't approved yet
    throw new Error(`device poll: ${res.status} ${json.message}`); // "invalid device code" = used/expired
  }
  throw new Error('device code expired');
}
```

DCF facts (official): device_code is one-time use; access tokens last ~4 hours; for **public** clients
the refresh token is **one-time use** (each refresh returns a new one — persist it before using the new
access token) and expires after **30 days** of inactivity, after which the user must redo DCF.
The CLI equivalent is `twitch token -u --dcf -s "<scopes>"` (see `twitch-cli.md`).
Ready-made: `node scripts/token.ts device --name bot --scopes "user:read:chat user:write:chat user:bot"`.

## 6. Implicit grant flow (browser-only, no server)

`response_type=token`; the token arrives in the URL **fragment** (`#access_token=...&state=...`), read it
via `location.hash` (never sent to your server). No refresh token: when it stops working, send the user
through the flow again. Use only for pure static front-ends (e.g. a GitHub-Pages tool). Not usable by
public-type clients. OBS overlays should **not** do this — see `architecture.md` (overlays get data
from your backend; the backend holds tokens).

```ts
// browser
const p = new URLSearchParams(location.hash.slice(1));
if (p.get('state') !== sessionStorage.getItem('oauth_state')) throw new Error('CSRF');
const token = p.get('access_token'); history.replaceState(null, '', location.pathname); // scrub URL
```

## 7. OIDC (Sign in with Twitch)

- Add `openid` to `scope`. `response_type=code` (server) → token response also contains `id_token`;
  `response_type=token+id_token` or `id_token` (implicit) → in the fragment.
- Optional `nonce` (echoed as a claim in the id_token; compare it) and `claims` (JSON string) to request
  non-default claims: `email`, `email_verified`, `picture`, `preferred_username`, `updated_at`.
  `email`/`email_verified` also require scope `user:read:email`; `email` is `null` if not verified.
  `claims={"id_token":{"email":null,"email_verified":null},"userinfo":{"picture":null}}`
- Default claims: `aud` (= your client ID), `azp`, `exp`, `iat`, `iss` (`https://id.twitch.tv/oauth2`), `sub` (user ID).
- **An id_token is not an access token** — never send it to Helix.
- `/userinfo` accepts the OAuth **access** token (not the id_token) and returns the claims requested under `userinfo`.

Verify the id_token (uses `jose`, the one JWT dependency the suite allows):
```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';
const JWKS = createRemoteJWKSet(new URL('https://id.twitch.tv/oauth2/keys'));
export async function verifyIdToken(idToken: string, nonce?: string) {
  const { payload } = await jwtVerify(idToken, JWKS, { issuer: 'https://id.twitch.tv/oauth2', audience: process.env.TWITCH_CLIENT_ID!, algorithms: ['RS256'] });
  if (nonce && payload.nonce !== nonce) throw new Error('nonce mismatch');
  return payload as { sub: string; preferred_username?: string; email?: string; picture?: string };
}
```
For "log in with Twitch" on a website you can also skip OIDC: do the code flow, call `/validate` (gives
`user_id` + `login`) or Helix Get Users, and create your own session.

## 8. Refreshing

Only tokens from the **authorization code** (incl. OIDC code) and **device code** flows have refresh
tokens. App tokens and implicit tokens cannot be refreshed.

```ts
export async function refresh(refreshToken: string, clientSecret?: string) {
  const body = new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken }); // URLSearchParams URL-encodes it (required!)
  if (clientSecret) body.set('client_secret', clientSecret); // omit for PUBLIC clients
  const res = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (res.status === 400 || res.status === 401) throw new ReauthRequired(await res.text()); // "Invalid refresh token"
  if (!res.ok) throw new Error(`refresh ${res.status}: ${await res.text()}`);
  return (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; scope: string[] };
}
export class ReauthRequired extends Error {}
```

Rules that bite:
- **Store the returned `refresh_token`** every time — it may change (and for public clients it always does).
- Twitch recommends refreshing **reactively on 401** rather than on a timer, since tokens die for other
  reasons too (password change, user disconnects app, Twitch revokes). Refreshing a few minutes before
  `expires_in` as well is fine; just don't rely on it alone.
- Max **50 valid access tokens per refresh token**: if many workers refresh concurrently, the 51st fails.
  Refresh in **one place** (single-flight) and hand the new token to everyone:

```ts
const inflight = new Map<string, Promise<string>>(); // userId -> pending refresh
export function getFreshToken(userId: string, doRefresh: () => Promise<string>): Promise<string> {
  let p = inflight.get(userId);
  if (!p) { p = doRefresh().finally(() => inflight.delete(userId)); inflight.set(userId, p); }
  return p;
}
```
- Confidential-client refresh tokens don't expire on their own; public-client ones expire after 30 days and are single-use.
- When refresh fails → mark the account "needs re-auth", stop using it, prompt the user again.

## 9. Validating (required hourly)

Twitch policy: any app that keeps an OAuth session (web apps, bots, extensions' backends, desktop apps)
**must call `/validate` at startup and then hourly**, and must end sessions whose token became invalid
(e.g. the user clicked *Disconnect* in Settings → Connections). Twitch audits this and may revoke API
keys or throttle apps that don't. *(Twurple: does **not** do this for you — add a timer.)*

```ts
export interface ValidateResult { client_id: string; login: string | null; user_id: string | null; scopes: string[] | null; expires_in: number }
export async function validate(token: string): Promise<ValidateResult | null> {
  const res = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` } });
  if (res.status === 401) return null; // { status: 401, message: "invalid access token" }
  if (!res.ok) throw new Error(`validate ${res.status}`);
  return (await res.json()) as ValidateResult;
}
// startup + hourly, for every stored user token AND your app token
setInterval(() => void validateAllSessions(), 60 * 60 * 1000).unref();
declare function validateAllSessions(): Promise<void>; // refresh on null; if refresh fails -> logout/disable
```
`/validate` is also the cheapest way to learn the token's `user_id`, `login`, real `scopes`, and `expires_in`.
Server-side alternative for many users: `Get Authorization By User` (Helix, **app token**, up to 10
`user_id`s) returns the scopes each user granted your client and `has_authorized`. You can also
subscribe to the EventSub `user.authorization.revoke` type (webhook/conduit only, app token) to learn
immediately when someone disconnects your app.

## 10. Revoking

`POST https://id.twitch.tv/oauth2/revoke` with `client_id` + `token` (form-encoded). 200 = done (no body);
400 `Invalid token`; 404 `client does not exist`. Revoke on user "log out / disconnect" in your app,
and revoke dev tokens you pasted somewhere.

## 11. Lifetimes cheat-sheet

| Token | Lifetime | Refresh |
|---|---|---|
| User access (auth code / DCF) | ~4 h (DCF docs say 4 h; examples show `expires_in` ≈ 14 000 s) — always read `expires_in` | yes |
| User access (implicit) | not documented; treat as "until 401" | no — redo flow |
| App access (client credentials) | long (docs example `expires_in` 5 011 271 s ≈ 58 days) | no — request a new one |
| Refresh token, confidential client | no expiry (dies on password change / disconnect / revoke) | — |
| Refresh token, public client | 30 days, single use | — |
| Device code | `expires_in` from /device (example 1800 s), single use | — |
| Twitch CLI mock-API tokens *(observed)* | 24 h (`expires_in` 86399), no refresh tokens | — |

Any token can die early: password change, user disconnects the app, Twitch revokes, client secret
rotated (app tokens), scopes changed. Code for 401 everywhere.

## 12. Error handling

| Symptom | Cause | Fix |
|---|---|---|
| Helix 401 `Invalid OAuth token` | expired/revoked token | refresh (user) or re-mint (app); retry once |
| Helix 401 `Client ID and OAuth token do not match` | token minted for another client ID | use the token's own client ID (check `/validate`.client_id) |
| Helix 401 "missing scope" / 403 | scope not granted, or user lacks role (not mod/broadcaster) | re-auth with `force_verify=true` and the scope; check role |
| Send Chat Message 401/403 with an app token ("sender is not permitted…") | bot or broadcaster never granted the scopes | bot authorizes `user:bot user:write:chat (user:read:chat)`; broadcaster grants `channel:bot` (or mod the bot) |
| Send Chat Message 200 but `is_sent: false` | message dropped (AutoMod, chat mode, duplicate, …) — see `drop_reason` | log `drop_reason.code/message`; don't treat 200 as delivered |
| `/token` 400 `Invalid refresh token` | used/expired/unencoded refresh token | URL-encode; persist the newest one; re-auth |
| `/authorize` → `redirect_mismatch` | redirect URI not registered exactly (scheme, host, port, path, trailing slash) | register the exact string in the console |
| `/device` poll 400 `authorization_pending` | user not done yet | keep polling at `interval` |
| `/device` poll 400 `invalid device code` | code already exchanged or expired | restart DCF |
| EventSub create 401/403 with WebSocket transport | used an app token (must be user token) or a token for the wrong user | use the user token of the user in the condition |
| EventSub create 401 with webhook/conduit | used a user token | use an app token |
| HTTP 429 | rate limit (Helix bucket per client ID; per client+user for user tokens) | honour `Ratelimit-Reset` — see the twitch-api skill |

## 13. Storing tokens safely

- Treat access tokens, refresh tokens and the client secret like passwords. Never ship the secret to a
  browser, an OBS overlay URL, a mobile app, or a git repo. The **client ID is public** (fine in front-ends).
- Store per user: `user_id` (the stable key — logins can change), `login`, `access_token`,
  `refresh_token`, `scopes[]`, `expires_at`, `obtained_at`. Encrypt at rest in production
  (e.g. AES-GCM with a key from env/KMS); file mode 0600 for local JSON stores.
- Write atomically (temp file + rename, or a DB transaction) — losing a rotated single-use refresh
  token locks the user out.
- Regenerating the client secret in the console invalidates the old one immediately (app tokens minted
  with it stop working on next refresh); roll secrets with a deploy.
- `.gitignore`: `.env`, `.twitch-tokens.json`, `tokens.*.json`.

## 14. Multi-user patterns

**Broadcaster + bot (the standard chatbot/overlay setup)**
1. Register **one** app (client ID). Two Twitch accounts: the streamer and a separate bot account.
2. Bot account authorizes once: `user:read:chat user:write:chat user:bot` (+ e.g. `moderator:manage:announcements`
   if it should post announcements, `moderator:manage:banned_users` if it moderates).
3. Broadcaster authorizes once: `channel:bot` (lets your app put the bot in their chat with an app token)
   + whatever your features need (`channel:read:redemptions`, `moderator:read:followers`, `bits:read`,
   `channel:read:subscriptions`, `channel:manage:polls`, ...). See `scopes.md` recipes.
4. Logging in as two accounts from one browser: use a private window for the second, or `force_verify=true`
   (shows the consent screen with "Not you?"). `node scripts/token.ts login --name bot --force-verify`.
5. Runtime: keep a token store keyed by `user_id`; pick the token by the *acting* user. For the chat bot
   badge send messages with the **app** token (`sender_id` = bot, `broadcaster_id` = channel).

**Installed / single-account bot** (bot speaks as the broadcaster): one user token from the broadcaster
with `user:read:chat user:write:chat` — no badge, simplest for a hackathon.

**Many channels (SaaS)**: each streamer goes through the code flow on your site; store tokens per
`user_id`; use EventSub webhooks or a **conduit** with an app token so one backend serves all channels
(see `architecture.md`); use `Get Authorization By User` / `user.authorization.revoke` to clean up.

*(Twurple)* `RefreshingAuthProvider` models exactly this: `addUser(userId, token, intents)` with intents
like `['chat']`, `onRefresh(userId, token)` to persist. See `twurple.md`.

## 15. Which token for which surface

| Surface | Token |
|---|---|
| Helix endpoint | as its reference says: user token w/ scope, app token, either, or app token + prior authorization |
| EventSub **WebSocket** transport (create subscription) | **user** token (of the user in the condition / the authorizing user); app token fails |
| EventSub **webhook** transport | **app** token; user token fails |
| EventSub **conduit** (manage conduits + create subs with conduit transport) | **app** token |
| Chat read via EventSub `channel.chat.message` | WebSocket: bot's user token w/ `user:read:chat`; webhook/conduit: app token + bot `user:read:chat`+`user:bot` + broadcaster `channel:bot` (or bot is mod) |
| Chat send via Helix Send Chat Message | user token w/ `user:write:chat` (no badge) **or** app token + bot `user:write:chat`+`user:bot` + broadcaster `channel:bot`/mod (→ Chat Bot badge) |
| Legacy IRC | user token w/ `chat:read`/`chat:edit`, password `oauth:<token>` (see the twitch-chat skill) |
| Extensions frontend → EBS | Extension JWT from Helper (not OAuth) — see the twitch-extensions skill |
| Embeds | none |
