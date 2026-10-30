# Realm sign-in, sessions and kingdom tickets

The API signs people in with Twitch (OpenID Connect, `openid` only), keeps a Chatdom session in an HttpOnly
cookie and issues one-use kingdom tickets. The realm (`apps/realm/src/auth/authenticator.ts`) consumes those
tickets and rechecks sessions from the same Postgres schema. Shapes are frozen in
`packages/shared/src/realm/auth.ts`; import them from `@chatdom/shared/realm`.

## Routes

All routes are same-origin under the public page origin. Every JSON reply and redirect sends
`Cache-Control: no-store`. Errors are `RealmApiError`, `{ version: 1, status, message }`, with HTTP 401
(`unauthenticated`), 403 (`refused`), 503 (`unavailable`) or 400 (`refused`, malformed input).

| Route | Request | Success |
|---|---|---|
| `GET /api/realm/session` | cookie | `RealmSessionReply`: `anonymous`, or `authenticated` with `expiresAt`, `resumeScope`, `csrfToken` |
| `GET /api/realm/auth/start?returnTo=<path>` | `returnTo` is a kingdom page | 302 to Twitch; sets the 10-minute sign-in binding cookie |
| `GET /api/realm/auth/callback` | OIDC `code`, `state` | 303 to the stored page with the session cookie |
| `POST /api/realm/ticket` | cookie, `Origin`, `X-CSRF-Token`, JSON `RealmTicketRequest` | `RealmTicketReply` |
| `POST /api/realm/signout` | cookie, `Origin`, `X-CSRF-Token` | `RealmSignoutReply`; clears the cookie |
| `POST /internal/realm/revoke` | `Authorization: Bearer $REALM_INTERNAL_SECRET`, JSON `{ personId }` or `{ sessionId }`, optional `reason: 'moderated'` | `{ version: 1, status: 'revoked', sessions }`; route absent without the secret |
| `GET /healthz` | | `{ alive, database, mode }`; 503 when the database is unreachable |

`returnTo` accepts `/`, `/<login>`, `/<login>/<page>` (up to three plain segments), `/map`, `/map/<login>` and
`/-/realm`. Anything else, including other hosts, `//`, backslashes, queries and fragments, is HTTP 400.

A callback that cannot finish still returns to a local page, with `?signin=<outcome>` appended:

| Outcome | Meaning | What the page says/does |
|---|---|---|
| `declined` | the person cancelled on Twitch | stay anonymous, offer Walk again |
| `expired` | state unknown, used, older than 10 minutes, or from another browser | offer Walk again; goes to `/` because the page is unknown |
| `refused` | the ID token failed verification, or the person belongs to another provider | truthful failure; no citizen is invented |
| `unavailable` | Twitch or our database could not be reached | try again shortly; nothing changed |

## What the browser does (Walk)

1. On Walk, `GET /api/realm/session`. If `anonymous`, navigate the top window to
   `/api/realm/auth/start?returnTo=<current kingdom path>`.
2. Back on the page, read the session again. Use `resumeScope` to key tab-scoped reconnect storage by
   endpoint, kingdom and scope (`connectRealm` in `apps/web/src/realm/client.ts` already does this).
3. For fresh entry, `POST /api/realm/ticket` with `credentials: 'same-origin'`, `Content-Type: application/json`,
   `X-CSRF-Token: <csrfToken>` and `{ version: 1, kingdomId, protocol: 1 }`, then join with `reply.join`. A ticket
   lives at most 60 seconds and is burned by its first presentation, even a wrong one. Request a new ticket for
   every fresh join, never store one, and try a saved reconnect token first.
4. Signout: `POST /api/realm/signout` with the CSRF header, then clear that scope's reconnect storage. A 401 from
   the ticket route means the session ended: clear the scope and show Walk again.

`csrfToken` is derived from the session and authorises same-session requests only; it is not a ticket. The cookie
is the only API credential and script cannot read it. `resumeScope` grants nothing; a new session (signing in
again, another account) gets a new one. A session lasts 14 days. One session may request 20 tickets per minute.

## Identity, names and what is stored

- The verified ID token `sub` is the Twitch user ID, which is also the Chatdom `PersonId` chat already uses, so
  signing in claims the existing person rather than creating a second one. Nothing the browser sends chooses the
  person, their rights or their name. A ticket request with extra fields (such as `personId`) is HTTP 400.
- ID tokens are checked against Twitch's JWKS: RS256 only, issuer `https://id.twitch.tv/oauth2`, our client ID as
  audience and authorised party, at most 15 minutes old, and the nonce of this browser's attempt.
- Twitch access and refresh tokens are dropped inside `exchangeCode` and never stored or logged.
- The public name is the Twitch display name (`preferred_username` claim, no extra scope), cleaned by Herald's
  window-name rule and recorded with approval `provider-display-name-v1`. A name that does not survive, or no name,
  uses the anonymous presentation (`Citizen`, look `neutral`), set by the realm.
- Postgres stores SHA-256 hashes of session handles, tickets, sign-in state, nonce and browser binding. Never
  the values themselves.
- Mutating routes require the page's exact `Origin` (and reject `Sec-Fetch-Site: cross-site`) plus the CSRF token.
- Cookies are `HttpOnly; SameSite=Lax; Path=/`. When the public origin is HTTPS they are `Secure` and
  `__Host-` prefixed (`__Host-chatdom_session`, `__Host-chatdom_signin`). Plain HTTP is allowed only on loopback.

## Realm side

`createRealmAuthenticator({ pool, origin })` implements `RealmAuthenticator`:

- `authenticate(join)` burns the ticket atomically, then requires: it was unexpired, issued for this kingdom and
  protocol, of the realm's origin, and its session is unrevoked and unexpired. Failures are `ServerError` 403
  with a person-readable message (400 for a malformed join). A database failure is 503 and never grants entry.
- Each accepted ticket opens one **entry** (`realm_entries`, migration `0005`). The principal's `sessionId` is that
  entry's random id, never the Chatdom session id: Colyseus adopts it as the walker's room id, which every client in
  the room sees. Two windows of one session therefore get two seat ids, and a walker key links nothing across
  kingdoms or entries.
- `current(principal, now)` resolves the entry to its session and is true only while that session is unrevoked
  and unexpired, by database time, for the principal's person, kingdom and origin. A forged or edited principal is
  false. A database failure throws, which the room treats as an unanswered check (walking held, see below).
- A live realm refuses simulated tickets and principals; a SIMULATED realm refuses live ones.

The room asks `current` for every seat, connected or waiting out a reconnect grace, once a second. Signout,
revocation and expiry end the seat with no grace: a connected socket closes with 4401, a dropped seat's grace is
cancelled. The full seat and reconnect contract for the browser is in `apps/realm/README.md` (*Seats and
reconnect*). `sweep()` forgets entries of ended sessions.

## Running it

The schema belongs to the realm. Migrate once per schema, then build and start the API:

```bash
node --env-file-if-exists=.env apps/realm/scripts/migrate.mjs --schema realm
pnpm --filter @chatdom/api build
pnpm --filter @chatdom/api start            # LIVE: needs DATABASE_URL and ~/.config/chatdom/atlas.env
```

| Setting | Default | Notes |
|---|---|---|
| `REALM_AUTH_MODE` | `live` | `simulated` mounts the SIMULATED provider; it never runs in live mode |
| `DATABASE_URL` | none | required; there is no in-memory fallback |
| `REALM_DATABASE_SCHEMA` | `realm` (live), `realm_simulated` | SIMULATED refuses `realm`/`public`; live refuses simulated or test names |
| `REALM_PUBLIC_ORIGIN` | `http://localhost:5190` | the page origin; the redirect URI is `<origin>/api/realm/auth/callback` |
| `API_PORT`, `API_HOST` | `5192`, `127.0.0.1` | |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | none | live only; the redirect URI must be registered on the Twitch app |
| `REALM_INTERNAL_SECRET` | unset | 32+ characters; enables internal revocation |

The web dev server and preview proxy `/api` to `http://127.0.0.1:5192`, so cookies and routes stay same-origin. Without
that proxy, set `REALM_PUBLIC_ORIGIN=http://localhost:5192` and open the API origin directly.

### SIMULATED sign-in

```bash
node --env-file-if-exists=.env apps/realm/scripts/migrate.mjs --schema realm_simulated
pnpm --filter @chatdom/api start:simulated
```

The provider at `/api/realm/simulated-oidc/*` speaks the same authorize/token/JWKS protocol and signs real RS256
ID tokens, so sign-in runs through the production verifier. Its chooser page is stamped SIMULATED and offers six
simulated people (IDs `990100001`–`990100006`; tests may use the rest of `9901xxxxx`). Their sessions, tickets
and principals are `origin: 'simulated'` and only enter a SIMULATED realm. No Twitch account is involved.

### Tests

```bash
pnpm exec vitest run apps/api/src/realm-auth                     # verifier, return paths, names, config
REALM_DATABASE_TESTS=1 node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run apps/api/src/realm-auth/auth.integration.test.ts
```

The Postgres suite creates a random `realm_test_*` schema, drops it afterwards, and fails if `DATABASE_URL` is
missing. It signs two simulated people in through HTTP, rejects replayed or stolen callbacks, a wrong issuer and a
foreign nonce, and expired and replaced sessions. It burns replayed, cross-kingdom and expired tickets, refuses
client-chosen identities and forged principals, holds entry when storage fails, and walks both people into a real
Colyseus room through the browser's own `connectRealm`. Signout and internal revocation then close their
connections with 4401 and end their seats at once.

R8 runs a durable Postgres-backed realm (`apps/realm/src/auth/reconnect-harness.ts`) with real SDK clients on
`k:424243`: reload (explicit reconnect with the saved token), lost network (automatic reconnect), rotated tokens,
a second window, signout during the grace, expiry while connected, and a restart that leaves no old seat behind.
