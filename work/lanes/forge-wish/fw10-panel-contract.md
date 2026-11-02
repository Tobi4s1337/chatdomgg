# FW10: the walk's wish box and separate chat grant

The walk's wish box sends `!forge <words>` as its signed-in citizen. Twitch's reply proves a chat send;
the existing Herald, judges and realm authority alone can prove a made piece. This is the concrete contract
for the backend and panel builders. It preserves the host API in [SEAMS.md](SEAMS.md) and adds only
[forge-chat.ts](../../../packages/shared/src/forge-chat.ts) to the shared contract.

## Sources and prior art

Founder decision 14 and the FW10 PRD/round notes win over older text. Read alongside ChatDom principles 6,
15 and 16, Quality's immediate response and never-lost-work rules, Safety §§3–5 and the accepted ritual in
Moments §3. Quality never refuses a wish. This task does not change the anvil, ritual, coal or judge policy.

The established local sources are `apps/api/src/dock/auth.ts`, `realm-auth/secrets.ts`, shared realm auth
contracts, `apps/realm/src/evening/bridge.ts` and its real authority. Reuse their identity and receipt rules.
The app session UUID is not the walk ticket's session ID.

Prior-art study: [pinned source and persistence findings](references/chat-grants.md),
[Twurple's RefreshingAuthProvider](https://github.com/twurple/twurple/blob/c487a28ae1e9e76c59dc085a52fbe6242e16d45b/packages/auth/src/providers/RefreshingAuthProvider.ts)
and the checked local Twitch skill reference show per-user refresh serialization and a refresh-persistence
hook. Take those invariants with a durable generation check; introduce no SDK dependency for this small
surface. No external code is copied. The reference note records the source pin and persistence pitfalls.

Verified protocol sources: [Send Chat Message](https://dev.twitch.tv/docs/api/reference/#send-chat-message),
[token validation](https://dev.twitch.tv/docs/authentication/validate-tokens/), and the local Twitch auth
reference. Sending uses a user token with `user:write:chat`. A 200 response with `is_sent:false` is a failed
send. Validate token identity, client and granted scopes, at startup and hourly as well as after an exchange
or refresh. These are authorization rules, not a reason to expand sign-in scopes.

## Wire model

Every body is a strict version-1 schema. Unknown identity, approval, redirect and sender fields are rejected.
Every route is same-origin, sends `Cache-Control: no-store`, and never returns tokens or wish words.

| Route | Input | Success |
|---|---|---|
| `GET /api/realm/forge/chat/status` | `kingdomId`, optional `requestId` query; parser adds `version:1` | `ForgeChatStatusReply`: grant, advisory availability, own wish or null |
| `POST /api/realm/forge/chat/authorize` | `ForgeChatAuthorizeRequest` | `ForgeChatAuthorizeReply`: the fixed Twitch authorization URL |
| `GET /api/realm/forge/chat/callback` | Twitch code/error and one-time state | 303 to the fixed kingdom return path below |
| `POST /api/realm/forge/chat/wish` | `ForgeChatWishRequest` | 202 `ForgeChatWishReply`; accepted means the request is recorded |
| `POST /api/realm/forge/chat/revoke` | `ForgeChatRevokeRequest` | `ForgeChatRevokeReply`; this app can no longer use the grant |

`ForgeChatError` maps unauthenticated to 401, forbidden to 403, invalid-request to 400, request-conflict or
request-expired to 409, consent-required to 403, rate-limited to 429, and not-configured/unavailable to 503.
Do not include raw provider errors. A recorded not-sent attempt uses the ordinary accepted reply with its
finite reason; a malformed or unauthenticated request is never recorded as a chat attempt.

Status's `grant` distinguishes signed-out, required (not-granted/expired/revoked), ready and unavailable
(not-configured/service-unavailable). `availability` is only the current stream/service preflight, never
authority to spend coal. A request may become ineligible after preflight; the real reservation and commit
still decide it. Never claim ready when the stream/service state cannot be read.

The owned wish projection has `requestId`, `kingdomId`, `updatedAt`, and a state:

| State | Evidence and UI meaning |
|---|---|
| `sending` | A durable attempt exists and one sender holds its send lease. The box answers immediately. |
| `unknown` | The chat request may have crossed Twitch's boundary but no definitive reply was retained. Check chat; do not resend automatically. |
| `sent` | Validated Helix response has `is_sent:true` and a message ID. Waiting for Herald; no made-item claim. |
| `working` | Herald's actual Forge path witnessed the command and started work. Quiet retries stay inside this state. |
| `delivered` | The existing authority actually committed. Carries attachment ID, committed time and optional private explanation. |
| `held`, `refused`, `cold`, `canceled` | An actual private outcome from that same command, with its own finite message. Only safety produces refused. |
| `not-sent` | No chat message was sent: consent missing, stream offline, unavailable, rate-limited or chat-dropped. May carry retryAt. |

Known Twitch message IDs carry the existing receipt ID `forge:` plus the first 48 hex digits of SHA-256 of
that message ID. The backend computes it. A client must not correlate by person display name, slot, wish
words, most recent public ritual or elapsed time. The delivered attachment does not need to be returned here:
the existing realm feed already supplies it for the accepted ritual and placement.

Current words limit is 240 UTF-16 code units, matching the existing Herald and Forge contracts, with
surrounding whitespace trimmed and control characters rejected. Add exactly one `!forge ` prefix. Never
truncate or send a wish the Herald cannot accept. Overlong words remain in the box with a clear edit request.
Widening the upstream intake for FW10's overlong fixture is a separate coordinated contract change; this
transport alone cannot bypass it. The HTTP body cap is 4 KiB.

## Server identity, authorization and persistence

Resolve the existing session cookie against `realm_sessions`: hash of the handle, matching configured
origin, unrevoked, unexpired, valid person ID and session UUID. Reuse read-only auth utilities or implement
this small query in the Forge module; do not alter the sign-in service. Cookies must follow the existing
secure `__Host-chatdom_session` versus loopback `chatdom_session` rule. A URL, request body, socket ID,
display name or walk ticket never selects the sender. Kingdom ID denotes the requested broadcaster, subject
to the actual founded realm and stream checks. Helix `sender_id` is always the verified session's person ID.

Every state-changing POST needs the exact configured Origin, a non-cross-site fetch context and the existing
session-bound `X-CSRF-Token` (`csrfFor(handle)`, constant-time comparison). This applies to grant revocation
and starting OAuth as well as sending. The callback instead requires the same live app session and a valid,
unconsumed state bound to it; an Origin header is not expected on that cross-site top-level GET.

The lane's `0014` migration owns three small private tables (plus a bounded observation inbox if needed):

1. **Grant:** key `(origin, personId, clientId)`, state/generation, encrypted access and refresh tokens,
   granted scopes, expiry, validatedAt and refresh lease. The generation rejects stale refresh/callback writes.
2. **Authorization attempt:** hash of 256-bit random state, originating session UUID/person/origin/client,
   kingdom, grant generation, expiry (10 minutes), consumed/canceled marker. Never store the raw state or code.
3. **Send attempt:** unique `(origin, personId, requestId)`, immutable kingdom, session audit ID, keyed digest of the
   normalized body, send claim, finite state, optional Twitch message ID/receipt ID and owned outcome. No words.

Token encryption uses a configured 256-bit key, authenticated encryption with a unique random nonce and
binding to the origin/person/client/generation. Key material lives in a mode-0600 file outside the checkout;
tokens themselves live encrypted in Postgres, not in a browser or a new plaintext token file. Missing key or
OAuth configuration produces unavailable/not-configured. Never generate a key implicitly. Never log body,
authorization URL/state/code, cookies, headers, provider response bodies or token ciphertext.

Authorize is an explicit click after the one-sentence consent: **“Let the Forge post your wishes in Twitch
chat as you.”** Add only `user:write:chat`; sign-in stays `openid` only. With the existing shared app client,
first use Get Authorization By User for exactly the signed-in person ID, authenticated with that client's
app token. Request the union of its verified currently-granted API scopes and `user:write:chat`, following
`apps/api/src/realm-auth/oidc.ts` and Herald's existing authorization bootstrap. This prevents narrowing another
feature's grant. A failed, missing or ambiguous grant read is cold; only an explicit has_authorized:false
response permits an empty prior API scope set. Do not read another service's tokens, scan users, invent role
scopes or trust a browser-supplied scope list. Keep the expected set in the pending state and require it on
callback validation. Forge uses only chat sending even when the preserved token includes other existing
rights. A separate client would isolate these grants further but requires a deliberate app registration and
credential change; this checkpoint does not silently introduce one. On callback, consume state once,
exchange the code and validate the actual access token. Match user ID, client ID and required scope against
the pending record and the still-current session. Scope or user data in the callback URL is not proof. A
different Twitch account never silently switches the signed-in citizen. A stale callback cannot recreate a
revoked grant. Best-effort revoke a newly exchanged rejected token without exposing it.

Return only to `/kingdom/<validated pending kingdomId>?forgeChat=<result>`, where result is one of connected,
denied, expired, wrong-account or unavailable. No caller-controlled return URL. If state is invalid and no
trusted kingdom can be recovered, return to `/?forgeChat=expired`. Callback HTML is unnecessary. Send
`Referrer-Policy: no-referrer` and strip code/state by the redirect immediately. The return marker conveys
no authority; the reopened box fetches status again.

Refresh runs once per durable grant generation, across processes. Persist rotated refresh/access tokens
atomically before their use; refresh cannot resurrect a revoked grant. On a definitive first Helix 401,
refresh/validate and retry once. A second 401 disables the grant. Validation outage leaves it cold; it is not
evidence of revocation. Invalid identity/client/scope disables the grant. Stored active tokens are validated
at startup and at least hourly; validation is maintained even while no wish panel is open.

Revoke first changes the local generation/state and prevents future sends, invalidates pending authorizations,
then attempts Twitch token revocation. The reply means Chatdom relinquished use, not an assertion that Twitch
is reachable. Serialize with send claiming: work already sent cannot be unsent. Ordinary signout makes the
session unusable; reconnecting the same citizen may reuse their still-valid separate grant. Every request
still needs a fresh unrevoked app session.

## Send hot path and irreversible boundaries

Authenticate, enforce CSRF, parse the bounded body, check grant and preflight, then insert/claim the durable
attempt **before** calling Helix. Sender and broadcaster IDs come from the trusted bindings. Keep only the
words in the current request's memory long enough to send; do not add a replay queue of wish words.

Twitch user-token messages also appear in all channels of an active Shared Chat. `for_source_only` is forbidden
for user tokens and must be omitted. Do not claim the words are visible only in the requested channel. The
Herald must scope Forge effects to the actual source broadcaster, never replicated Shared Chat copies. Any
real development send to tobi4s_ must first establish that no Shared Chat would carry it to other channels;
this contract subtask performs no such sends.

The same request ID and digest return the recorded result without another send, including after timeout,
restart or simultaneous clicks. The same ID with changed words is a conflict. Use a keyed digest so a stolen
database cannot cheaply dictionary-test short wishes. Keep detailed receipts for 24 hours; retain a compact
no-resend tombstone after pruning. An old request returns request-expired, never becomes a fresh send. The
storage retention constant describes receipt detail, not permission to forget irreversible side effects.

A 200/is_sent:false, definite 401 after the single refresh attempt, 403 or 429 is not-sent with a private
finite explanation. Map known drop codes to honest wording (AutoMod, chat restriction, duplicate or slow mode)
without copying arbitrary provider messages. Obey retry headers, disable repeated submit during the delay,
and let the person explicitly retry with a fresh request ID. Do not auto-retry HTTP 5xx, network disconnect,
timeout, malformed successful replies or process death after claiming: those can hide a successful send and
must become unknown. A DB failure while saving success is also ambiguous. Browser abort is not cancellation.

Only after validated is_sent:true does the durable binding gain Twitch message ID and become sent. This route
never calls the Forge application, reserves coal or manufactures Herald evidence. The real Herald hears the
message and uses its existing ingress. Lack of observation remains waiting, even after a long wait; a timer
cannot turn it into a safety refusal or a delivered piece.

## Private observation port and races

Add only an optional `onForgeChatObservation?: ForgeChatObserver` to the evening bridge options. Shared
`ForgeChatObservation` carries origin, kingdom, person, Twitch message ID, authoritative time and exactly one
finite state. It contains no command, words, draft, judge receipt or model record.

Emit working after `witnessed(...)` succeeds and the real live gate allows work. Emit delivered only from a
real committed outcome, with `outcome.attachment.id` and its actual committedAt. Preserve a bounded private
delivery explanation when available. Emit held/refused/cold/canceled from the actual result, including early
private offline/lease exits. Catch observer errors at the bridge boundary: they must not undo or fabricate a
Forge result. Do not use the existing public activity callback for owner correlation. Do not infer a private
reason from a reservation being released. `already-committed` requires actual committed-state lookup before
a delivered projection can be recovered.

Herald can observe and finish before the Helix reply binds its ID. Keep a bounded private observation inbox
indexed by exact `(origin, personId, kingdomId, messageId)`, and reconcile it transactionally when the real
Helix ID arrives. Retain only recent observations for an owner with a sending/unknown attempt; never bind by
timing or text. A working observation cannot overwrite a terminal one, and delayed sending/sent persistence
cannot downgrade working/delivered. Concurrent terminal updates use the authority's actual result/commit.
At most 32 unmatched observations per owner/kingdom, expiring after 10 minutes, is sufficient for this race.

For a lost observer callback, status may look up the authority's existing committed outcome by the exact
bound kingdom/Twitch message key and verify its owner. That is delivery evidence. Released/absent outcomes
cannot reconstruct a refusal or claim that no chat was sent. Unknown sends without a retained Twitch ID
cannot be correlated safely and remain honestly unknown. No generic public observer endpoint is added.

## Backend composition and configuration

The runtime lives in `apps/realm/src/forge-chat/**`. The backend builder's confirmed exports from its
`index.ts` define the concrete construction seam:

```ts
interface ForgeChatServiceOptions {
  readonly origin: 'live' | 'simulated';
  readonly store: ForgeChatStore;
  readonly config: ForgeChatConfig | null;
  readonly resolveTarget: (kingdomId: KingdomId) => Promise<{
    readonly broadcasterId: string;
    readonly availability: ForgeChatAvailability;
  } | null>;
  readonly recoverCommitted?: (input: {
    kingdomId: KingdomId; personId: string; messageId: string;
  }) => Promise<{ attachmentId: string; committedAt: number; message?: string } | null>;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}
declare function createForgeChatService(options: ForgeChatServiceOptions): ForgeChatService;
declare function mountForgeChatRoutes(
  app: uWebSocketsTransport['app'], service: ForgeChatService,
  options: {
    readonly pool: DockSessionPool;
    readonly origin: 'live' | 'simulated';
    readonly publicOrigin: string;
    readonly secureCookies: boolean;
  },
): void;
```

`forgeChatConfig(publicOrigin, env?)` asynchronously returns `ForgeChatConfig | null`. Construct
`new PostgresForgeChatStore(pool, origin, config ? new ForgeChatCipher(config.tokenKey, config.clientId) : null)`;
install its own `0014` through `installForgeChatSchema(pool)`, without changing core migration files.
`ForgeChatService` exposes status/authorize/callback/revoke/wish, `observe`, `start` and `stop`. The HTTP adapter
uses the existing read-only `DockSessionPool`/session helpers and owns bounded request reading. Call start
once and stop only its owned maintenance during shutdown; the shared pool belongs to the main service.

Resolve a founded kingdom without opening another authoritative writer. The store's origin is fixed at
construction; recoverCommitted must use that same origin and exact owner/key. Compose with the bridge's
optional observer and a small additive typed registration in main/server. Keep the service in not-configured
mode when credentials are absent so status still tells the truth. No generic auth framework is introduced.

Configuration is explicit and shared-origin:

| Name | Rule |
|---|---|
| `REALM_PUBLIC_ORIGIN` | Existing exact browser origin; HTTPS outside loopback. Never infer it from Host or forwarded headers. |
| `FORGE_CHAT_ENABLED` | Exactly `1` enables live grant/send capability; missing means not-configured. |
| `FORGE_CHAT_REDIRECT_URI` | Required when enabled; must equal publicOrigin + `/api/realm/forge/chat/callback`. Must be registered exactly on Twitch. |
| `FORGE_CHAT_TOKEN_KEY_FILE` | Required when enabled; existing outside-checkout mode-0600 file containing one base64-encoded 32-byte key. No auto-generation. |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Existing confidential app credentials, loaded server-side only. |
| `DATABASE_URL`, `REALM_DATABASE_SCHEMA` | Existing realm pool settings; development uses realm_forge_wish, never the live schema. |
| `CHATDOM_REALM_TARGET` | Existing web proxy realm target, confirmed in vite.config.ts; the chat prefix uses the same target. |

For the canonical public origin the required registration is
`https://chatdom.gg/api/realm/forge/chat/callback`; a preview or loopback origin has its own exact URI and must
be registered separately. The parent records the concrete deployment URI in `needs:`. Never configure or
register it on behalf of Tobias. Unconfigured copy says: “The wish box is waiting for Twitch's chat connection.
You can still write !forge followed by your wish in Twitch chat.” The internal evidence states which setting
or callback registration is missing; the product does not expose credentials or server file paths.

Gateway addition: one exact allowlist rule for `/api/realm/forge/chat/(status|authorize|callback|wish|revoke)`
to kind realm. No wildcard internal proxy. Web's more specific chat-prefix proxy goes before its `/api`
fallback. Existing API sign-in code, Herald and core realm schemas remain read-only.

## Panel and host lifecycle

Export `ForgeHost`, `ForgeHandle` and `openForge(host, from)` at `apps/web/src/forge/play/index.ts` exactly as
SEAMS describes. Mount only inside host.root. Call releasePointer on opening; on a single close transition
remove owned listeners/timers, restorePointer and onClosed exactly once. `dispose()` is idempotent and also
closes an open panel. Stop input propagation inside root; no window keyboard/pointer listeners and no direct
pointer-lock calls. Do not create the play HUD slot or change scene composition. The current anvil card may
call the same entry until play supplies its HUD slot.

The UI's small client first reads the existing `/api/realm/session` for CSRF and resumeScope. All fetches use
same-origin credentials; parse replies with the shared schemas and fail cold on malformed data. Read status
on open and after grant return. For authorize, preserve the private draft locally first, POST, then navigate
to the validated fixed Twitch URL. The return marker only asks the panel to reopen; it grants nothing.

Use a sessionStorage key partitioned by the opaque resumeScope and kingdom. It may hold this person's draft
and current request UUID, never tokens or identity. It is not a backend replay queue. Storage errors retain
the draft in memory and explain before navigating away. Do not restore a draft under a different or anonymous
session. On signout/changed scope purge Forge drafts for the old scope when detected. Do not put words or
IDs in URL query/hash, analytics, evidence, logs or public events. Clear the sent draft only after a definite
send while keeping the request metadata needed to follow its outcome.

Submit creates one UUID, persists it, disables repeated submission and immediately paints the sending state
within 100 ms. POST once. A lost reply causes GET status for that same UUID; it does not create a new POST or
UUID. Exact duplicate POST is safe server-side, but the normal client does not need it. Poll every 2 seconds
while open and active, back off to 10 seconds after 30 seconds, and stop on terminal state or close. Reopening
fetches the exact request again. Polling never reserves authority or starts a run.

Closing the panel cancels only UI work and outstanding GETs. It cannot retract an already-posted Twitch chat
message, cancel an authorized Forge, refund coal or revoke permission. Do not tie an HTTP send to a panel's
AbortController. A navigation or disconnect can still lose the response, so durable request metadata remains
the recovery mechanism. Revocation stops future chat sending; the existing Herald/moderation authority owns
withdrawal of an already witnessed wish.

The owner-only line can say sent/waiting, working, softened-and-why on a real delivered receipt, or the actual
private refusal/cold/hold cause. Do not say “your coal is safe” for an ambiguous send: it might already have
forged. Do not trigger a second public ritual from the HTTP result. Existing room rendering supplies the
accepted animation. No lost HTTP response may replay the reveal. Keep the input on definite not-sent states
so the citizen can edit and explicitly try again. No silence, raw provider text or fake success.

## Exact integration needs

**play host:** the play-owned kingdom/controller mount must create the empty HUD root, pass its real
`releasePointer` and `restorePointer` callbacks plus kingdom ID to ForgeHost, then call `openForge(host, from)`.
While its handle reports open, play's existing Escape handling calls `handle.close()` and does not open its
Esc menu. Its anvil host supplies the same ForgeHost to the optional Forge-owned AnvilVisit prop. It calls
dispose on kingdom unmount. The Forge adapter adds no raw pointer API, global listeners or fake no-op host.
Until this host lands, AnvilVisit keeps honest chat instructions and the exported panel is reviewable through
an isolated bench. A panel that works in that bench is not evidence that the actual walk's controls work.

**overlong intake:** coordinate this exact semantic patch with main and raid-show; these are existing exports
or other-lane files and are not changed by this checkpoint:

```diff
--- packages/shared/src/realm/herald.ts
- slot: UIntSchema.max(65534), words: z.string().trim().min(1).max(240), observedAt: EpochMsSchema,
+ slot: UIntSchema.max(65534), words: z.string().trim().min(1).max(493), observedAt: EpochMsSchema,
--- packages/shared/src/forge.ts (ForgeRunRequestSchema words field only)
- words:z.string().trim().min(1).max(240)
+ words:z.string().trim().min(1).max(493)
--- apps/herald/src/forge/commands.ts (extractForgeWords)
- return words && words.length <= 240 ? words : null;
+ return words && words.length <= 493 ? words : null;
--- apps/herald/src/forge/commands.ts (ForgeCommandHandoff.offer guard)
- if (slot === null || input.words.length < 1 || input.words.length > 240) return;
+ if (slot === null || input.words.length < 1 || input.words.length > 493) return;
--- packages/shared/src/forge-chat.ts (only after all downstream acceptance lands)
- words: 240,
+ words: 493,
```

493 plus the seven-character `!forge ` prefix stays within Twitch's 500-character bound. Keep the same
conservative UTF-16 counting everywhere and update the exact 240/241 guards in Herald's command tests to
493/494. Audit the Forge application's input validation for its own 240 limit before claiming the full path.
The direct realm `forge.wish` intent remains unused by this box; do not widen or use it as a bypass. Longer
wishes than Twitch permits remain fully editable with a length explanation, never quietly shortened.

## Budgets, growth and evidence

The panel adds no per-frame polling or scene traversal, zero draw calls and no new 3D assets. Idle code has
no animation loop. Rendering an input/state update targets under 2 ms CPU and acknowledgement under 100 ms;
these are budgets, not measured claims. One draft is at most 240 code units, one receipt under 2 KiB and the
panel's retained network state under 16 KiB excluding the existing UI kit. One active request per owner per
kingdom, a bounded HTTP body and a bounded observation inbox constrain memory. Requests/receipts are private
database records; large kingdom concurrency reuses the existing anvil capacity and worker queues.

Status response target is under 2 KiB; polling costs at most about 1 KiB/s for an open active panel, then
about 200 B/s on slow polling. Closed panels use no polling bandwidth. These HTTP reads never enter a room's
tick path. A realm socket owner receipt can eventually replace polling through an additive host port, with
the same server-side send ledger and status read for recovery. Worn twins, reveal choice and ledger content
add real committed metadata; they do not change grant identity or chat sending semantics.

Required builder tests use mocked Twitch and isolated persistence: missing configuration; exact origin/CSRF;
wrong account/scope/client; expired or consumed state and revoked session callback; refresh rotation versus
revocation; cross-owner status; duplicate concurrent requests; changed payload under same ID; 200-drop;
429; 401-refresh-once; timeout/5xx ambiguity with no second send; restart after claim; observer-before-send
response; working-after-delivered race; lost observer committed-state recovery; and raw words/tokens absent
from all public/status projections. UI tests cover every state, preserved drafts, no automatic repost, close
and dispose once, focus/input isolation, and narrow-screen composition. Only authored fixture words enter tests.

Contract review completed by inspection only. No build, test runner, screenshot, port or real Twitch send was
started by the contract subtask. Parent coordinates CPU checks. Main remaining doubts: independent auth and
realm services must point at the same session schema; callback registration/key configuration are external;
the UI cannot safely resolve an unknown send without a Twitch ID; 240-character upstream intake still needs
the separately requested overlong handling; and real visual/input proof remains the UI builder's work.
