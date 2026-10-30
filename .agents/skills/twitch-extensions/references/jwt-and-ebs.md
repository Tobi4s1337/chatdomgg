# JWTs and the Extension Backend Service (EBS)

Sources: `official/extensions_building.md`, `extensions_reference.md` (JWT schema),
`extensions_required-technical-background.md`, the Helix reference (see `helix-extension-endpoints.md`),
plus verified behaviour from `scripts/jwt-selftest.ts` / `scripts/ebs-smoke-test.ts`.

## Contents
- [Do you need an EBS?](#do-you-need-an-ebs)
- [The secret](#the-secret)
- [Verifying frontend JWTs](#verifying-frontend-jwts)
- [Authorization rules on the EBS](#authorization-rules-on-the-ebs)
- [Signing EBS JWTs (role external)](#signing-ebs-jwts-role-external)
- [Helix calls from the EBS](#helix-calls-from-the-ebs)
- [Extension PubSub from the EBS](#extension-pubsub-from-the-ebs)
- [Send Extension Chat Message](#send-extension-chat-message)
- [CORS and allowlisting](#cors-and-allowlisting)
- [Secret rotation](#secret-rotation)
- [Hosting, scaling, versions](#hosting-scaling-versions)
- [Testing without Twitch](#testing-without-twitch)
- [Troubleshooting](#troubleshooting)

## Do you need an EBS?

| Need | EBS? |
|---|---|
| Broadcaster settings shown to viewers | No — Configuration Service (`configuration.set` from config view) |
| Show public Twitch data (streams, users) | No — Helix JWT from the frontend (`Authorization: Extension <helixToken>`) |
| Broadcaster pushes something live to viewers | No — `Twitch.ext.send('broadcast', …)` from live_config (broadcaster token) |
| Viewer input aggregated (votes, game moves), secrets, DB, third-party APIs | **Yes** |
| Verify Bits transactions, grant persistent items | **Yes** |
| Post to chat as the extension | **Yes** (EBS JWT); a broadcaster-role Twitch JWT also works per the Increase-Feedback guide |

## The secret

- Console → your extension → **Settings** → "Extension Client Configuration" → **Key** (also under
  **Secret Keys**). It is a **base64** string shared by Twitch and you; every extension JWT (viewer
  tokens, Bits receipts, your EBS tokens) is **HS256** over the **decoded bytes**.
- `Buffer.from(secret, 'base64')` → 32-byte key. Forgetting to decode is the #1 bug (the selftest
  includes this as a negative case).
- Never ship it to the frontend, never commit it; load from env (`TWITCH_EXTENSION_SECRET`).
- The extension secret is **not** the app "Client Secret" used for OAuth app tokens. Endpoints that
  need an *app access token* (Bits products, transactions, live channels) use the extension's client ID +
  its OAuth client secret (client-credentials grant — see the twitch-dev skill).

## Verifying frontend JWTs

```ts
import { jwtVerify } from 'jose';
const key = Buffer.from(process.env.TWITCH_EXTENSION_SECRET!, 'base64');
const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], requiredClaims: ['exp'] });
// payload: { exp, opaque_user_id, user_id?, channel_id, role, is_unlinked, pubsub_perms }
```

Template `ebs/jwt.ts` → `verifyExtensionJwt(token, secrets, { expectedChannelId? })` returns
`{ channelId, opaqueUserId, userId|null, role, isLoggedIn, isUnlinked, payload }` and:
- pins `HS256` (rejects `alg: none`, HS512, RS*), requires `exp`, 5 s clock tolerance;
- tries each configured secret (rotation), only retrying on signature mismatch;
- validates `role` ∈ broadcaster/moderator/viewer/external and non-empty `channel_id`;
- normalises `is_unlinked` (`true`/`"true"`).

Header convention: `Authorization: Bearer <token>` (the template's `extractBearer` also accepts a bare
token). Twitch's own samples use `x-extension-jwt`; it's your API, pick one.

## Authorization rules on the EBS

1. **Trust only the token.** Use `payload.channel_id` as the channel; ignore channel IDs in URLs/bodies
   (or pass `expectedChannelId` to reject mismatches).
2. **Roles**: `broadcaster` → channel owner; `moderator` → only appears for identity-linked moderators;
   `viewer` → everyone else. Gate admin actions with `requireRole(auth, 'broadcaster', 'moderator')`.
3. **Users**: `opaque_user_id` starting with `U` = logged-in account, stable across sessions and
   channels → OK as a DB key. `A…` = anonymous, transient, may represent different people → never
   persist, usually reject writes (template returns 403 "Log in to Twitch to vote").
4. **Real identity** (`user_id`) is present only after identity linking. Needed e.g. to show usernames
   (moderation policy 7.1/7.3 requires linked IDs + displayed usernames for user-generated content).
   Users can revoke; then `user_id` disappears and a new opaque ID is issued.
5. **Bits**: grant only after verifying the receipt JWT (`verifyBitsReceipt`) and de-duplicating by
   `transactionId`.
6. **Policy 2.7**: validate/sanitise anything you return that the frontend will render.

## Signing EBS JWTs (role external)

```ts
import { SignJWT } from 'jose';
const jwt = await new SignJWT({
  exp: Math.floor(Date.now() / 1000) + 60,   // short-lived; add a buffer for clock drift
  user_id: OWNER_ID,                          // numeric user ID of the account that OWNS the extension
  role: 'external',
  channel_id: broadcasterId,                  // needed for PubSub + chat ("all" for global PubSub)
  pubsub_perms: { send: ['broadcast'] },      // needed for PubSub
}).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(key);
```

Required claims per endpoint (from the Helix pages):

| Endpoint | Claims |
|---|---|
| Get/Set Extension Configuration Segment, Set Required Configuration, Get/Create Extension Secrets | `exp`, `user_id` (owner), `role: external` |
| Send Extension PubSub Message | + `channel_id` (broadcaster ID or `"all"`), `pubsub_perms.send` (`["broadcast"]`, `["global"]`, or whisper targets; `"*"` is documented as allowed for EBS sends) |
| Send Extension Chat Message | `role`, `user_id`, **and** `channel_id` = `broadcaster_id` (the 401 list requires the match) |
| Get Extensions | `role: external` (template includes the rest anyway) |

Sign a fresh token per call (claims differ per channel); 60 s TTL is plenty. The CLI
`scripts/make-jwt.ts external --secret … --owner … --channel … --send broadcast` mints one for curl.

## Helix calls from the EBS

Always send both headers:

```
Authorization: Bearer <EBS-signed JWT>
Client-Id: <extension client ID>
```

`ebs/twitch-ext-api.ts` wraps: `sendPubSubToChannel`, `sendPubSubGlobal`, `getConfigurationSegments`,
`setConfigurationSegment`, `setRequiredConfiguration`, `sendExtensionChatMessage`,
`getExtensionSecrets`, `createExtensionSecret`, `getExtension`. `apiBase` can point to a mock.
Full endpoint list with auth types: `helix-extension-endpoints.md`.

## Extension PubSub from the EBS

```http
POST https://api.twitch.tv/helix/extensions/pubsub
{ "target": ["broadcast"], "broadcaster_id": "141981764", "message": "{\"type\":\"poll_state\",…}" }
```

| Send to | JWT `channel_id` | JWT `pubsub_perms.send` | Body |
|---|---|---|---|
| One channel | broadcaster ID | `["broadcast"]` | `target:["broadcast"]`, `broadcaster_id` |
| One viewer | broadcaster ID | `["whisper-<id>"]` | `target:["whisper-<id>"]`, `broadcaster_id` (frontend listens on `whisper-${auth.userId}`) |
| All channels | `"all"` | `["global"]` | `target:["global"]`, `is_global_broadcast:true`, **no** `broadcaster_id` |

- `broadcast` and `global` are mutually exclusive in one request. `message` is a string ≤ 5 KB (422 if
  larger). 204 on success; 403 if JWT `channel_id` ≠ `broadcaster_id`.
- **Rate limits**: Helix page — 100 messages/min per (client ID, broadcaster ID); Building guide —
  1 message/second/channel. Design for ≤ 1/s/channel: the template's `scheduleBroadcast` sends the
  first change immediately and coalesces the rest into one trailing message ≤ 1 s later (verified by
  the smoke test). Global has a separate pool; whispers count against the channel's pool.
- Legacy PubSub (third-party topics, `wss://pubsub-edge.twitch.tv` listen) was shut down 2025-04-14;
  Twitch's announcement explicitly says **Extension PubSub is not affected**.

## Send Extension Chat Message

```http
POST https://api.twitch.tv/helix/extensions/chat?broadcaster_id=237757755
{ "text": "Hello", "extension_id": "<client id>", "extension_version": "0.0.9" }
```

- Requires **Chat Capabilities** enabled (Capabilities tab), otherwise 401; check
  `Twitch.ext.features.isChatEnabled` in the frontend.
- Posts with the **extension's name** as the sender. Max 280 chars, **12 messages/min per channel**
  (429). You cannot @mention users. Emotes the channel has are usable. Describe chat behaviour in your
  extension description (policy 4.2).
- For full chatbot features use the twitch-chat skill instead.

## CORS and allowlisting

- Hosted Test/Released frontends run on origin **`https://<client_id>.ext-twitch.tv`**. In Local Test
  the page is served from your Testing Base URI, so its origin is e.g. `https://localhost:8080`.
- Preflight: respond to `OPTIONS` with `Access-Control-Allow-Origin` (that origin), `Access-Control-
  Allow-Headers: Authorization, Content-Type`, `Access-Control-Allow-Methods`. Bearer auth (no cookies)
  means `*` is also safe, the template reflects an allowlist instead.
- The EBS host must be in **"Allowlist for URL Fetching Domains"** (Capabilities/Asset Hosting) or the
  CSP `connect-src` blocks the fetch. Public hosting domains need a unique identifier (policy 2.13:
  `https://my-bucket.s3…`, not `https://s3.amazonaws.com/`).
- Only `https:` / `wss:` (block-all-mixed-content). `http://localhost` EBS during Local Test may work
  in some browsers but use HTTPS (`EBS_TLS_CERT`/`EBS_TLS_KEY` in the template, or a tunnel).

## Secret rotation

- Secrets live ~100 years by default, but rotate regularly. Console → Settings → Secret Keys → Create
  New Secret, or **Create Extension Secret** (`POST /extensions/jwt/secrets?extension_id=…&delay=300`,
  `delay` ≥ 300 s before the new secret is active). The Building guide says the old secret is set to
  expire ~1 h after a new one is requested.
- Response/Get Extension Secrets: `data[0].secrets[] = { content, active_at, expires_at }`. **Sign** with
  the active secret with the latest expiry; **verify** with all non-expired ones
  (`TWITCH_EXTENSION_SECRET=new,old` in the template — first entry signs).
- Emergency: "Revoke All Secrets" deletes all secrets immediately (breaks the extension until clients
  pick up a new one).

## Hosting, scaling, versions

- EBS can be any language/host; it must be HTTPS. A 1-dyno host/tunnel is fine for a hackathon.
- Scale concern: viewers × page loads. Serve initial data from the **Configuration Service** where
  possible (no EBS hit on load), cache `GET /state`, push changes via PubSub instead of polling.
- When a new version is released, open viewers may still run the old frontend — keep EBS APIs backward
  compatible (version your routes or accept old payloads).
- Load testing guide (Locust on Elastic Beanstalk): `official/extensions_load-testing-extensions.md`.

## Testing without Twitch

```bash
# 22 JWT checks against your copy of jwt.ts
node <skill>/scripts/jwt-selftest.ts ./ebs/jwt.ts
# EBS + mock Helix end to end (ports default 8140/8141)
node <skill>/scripts/ebs-smoke-test.ts ./ebs/server.ts
# Hand-made tokens for curl
VIEWER=$(node <skill>/scripts/make-jwt.ts viewer --channel 123 --role viewer --opaque Uabc)
curl -H "Authorization: Bearer $VIEWER" http://localhost:8081/api/state
node <skill>/scripts/make-jwt.ts decode "$VIEWER"
```

The Twitch CLI's mock API has no `/extensions/*` endpoints — use the smoke test's mock instead. The CLI
**can** fire a signed `extension.bits_transaction.create` webhook (verified with CLI v1.1.24):

```bash
twitch event trigger extension.bits_transaction.create -F http://localhost:8144/eventsub \
  -s "$TWITCH_EVENTSUB_SECRET" --client-id "$TWITCH_EXTENSION_CLIENT_ID" -C 250
# → event.product = { name: "Test Trigger Item from CLI", sku: "testItemSku", bits: 250, in_development: true }
# The CLI may print a Go panic from its update checker AFTER "Received Status Code: 204" (exit 2) when
# GitHub is unreachable — the event was still delivered and correctly signed.
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| EBS: `signature verification failed` on every token | Secret not base64-decoded, wrong extension's secret, or rotated secret missing |
| EBS: `JWT expired` after the page sat open | Using the first token forever — read the latest from `onAuthorized` |
| Helix 401 "JWT token is not valid" | Wrong secret/decoding, missing `role: external`, `exp` in the past (clock drift), missing `Client-Id` |
| Helix 403 on PubSub | JWT `channel_id` ≠ `broadcaster_id`, or `pubsub_perms.send` doesn't include the target |
| Helix 422 on PubSub | message > 5 KB |
| Helix 429 | PubSub > 100/min/channel, config > 20/min, chat > 12/min/channel |
| Browser: "Refused to connect … violates connect-src" | EBS not in URL Fetching allowlist (or http://) |
| Browser: CORS error | Missing OPTIONS handling / `Authorization` not in allowed headers / wrong origin |
| Moderator shows up as `viewer` | Moderators only get `moderator` role after identity linking |
