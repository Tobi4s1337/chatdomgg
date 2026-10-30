# Spec 34: A kingdom that survives its server

Status: frozen · 2026-10-30
Vision: `chatdom/ChatDom.md` §§2–5 (belonging, nothing lost, real people); `chatdom/Tech.md` §§4–7, 12.
Parent: `work/specs/33-realm.md`. Worker: `gpt-6.1-sol`, high; xhigh for realtime, fencing and recovery.

## What and why

A citizen signs in with Twitch, enters the same kingdom as everybody else, and returns to the same home after
a browser reload or a server crash. A lost reply does not spend another coal. A second server cannot take a
turn while the first still owns it. A revoked session cannot slip back in through reconnect. The server gives
the web, Herald and Forge one truthful authority; it never promotes a presentation slot into an owned home.

This lane turns main's small executable reference into the durable server foundation. It includes the missing
API sign-in service, home allocation and founded-layout adoption, because no other current service supplies
them. It proves the actual 300-walker path with small Node clients rather than hundreds of WebGL renderers.

## Current state

- `packages/shared/src/realm/domain.ts` defines `RealmPrivateState`, `RealmDomainCommand`, `RealmFact`,
  `RealmDecision`, `RealmWriterLease`, `RealmStoredOutcome`, `RealmRepository` and the transaction obligations.
  `RealmRepository.loadIngress`/`executeIngress` freeze checkpoint reads and atomic multi-command presence
  ingress. `RealmIngressCheckpoint` uses the private `presence-v1` codec; `RealmIngressTransition` carries
  checkpoint, capability-tagged commands and the public presence frame. `RealmOwnedHome` carries an
  `allocationReceipt` and `layoutRevision`; neither proves itself. Qualification is a union of evidenced closed
  intervals, and qualified-night credit requires a current owned home.
  `RealmFact` uses the envelope `{ version, kingdomId, writerEpoch, seq, occurredAt, receivedAt, committedAt,
  origin, type: 'realm.transaction', actor, cause, body }`; domain command data is `body`, event ordering is
  `seq`, and private state still uses `state.sequence`. Preserve all three authoritative timestamps and causality.
- `packages/shared/src/realm/messages.ts` defines `RealmJoinSchema`, `RealmPrincipal`, `RealmAuthenticator`,
  `RealmIntentSchema`, `RealmReceipt`, `RealmPublicMessage`, `RealmPublicDelivery` and `kingdomRoomId`.
- `packages/shared/src/realm/auth.ts` freezes `REALM_AUTH_ROUTES`, the schemas `RealmSessionReplySchema`,
  `RealmTicketRequestSchema`, `RealmTicketReplySchema`, `RealmSignoutReplySchema`, `RealmApiErrorSchema`,
  and corresponding inferred types. These are the HTTP DTOs; implementing their actual handlers is lane work.
- `packages/shared/src/realm/forge-authority.ts` defines `KingdomForgeAuthority` and its durable reservation,
  commit, cleanup and private-creation requirements. Existing Codex code consumes this port; it is no ledger.
- `packages/shared/src/realm/schema.ts` defines `WalkInputSchema`, `WalkerSchema`, `KingdomRoomState`.
  Only `walkers` is view-filtered; private state must never enter this schema.
- `packages/shared/src/realm/movement.ts` fixes `WALK_HZ = 30`, `REALM_PATCH_MS = 200`,
  `REALM_MESSAGE_LIMIT = 90` and the shared movement/collision types. Colyseus owns sequence/ack epochs.
- Main supplies `patches/@colyseus__sdk@0.18.8.patch` for reconnect-token parsing with colon-containing
  `k:<kingdomId>` room IDs, and `patches/@colyseus__uwebsockets-transport@0.18.4.patch` for the corresponding
  colon room URL path. Both SDK explicit reconnect and auto-reconnect split at the last colon; consumers keep
  tokens opaque. Preserve both patches and their pinned workspace/lockfile registration.
- `packages/world/src/settlement-plan.ts` exports the `SettlementPlan`/`SettlementHome` types and
  `generateSettlementPlan`. Plans have a `revision`; homes have stable plot IDs, quarter years and slots.
  Re-running a generator is not an allocation transaction or permission to rearrange occupied homes.
- `apps/realm/src/ports.ts` exports `RealmRoomServices` (`auth`, `open`), `RealmRoomHandle`,
  `RealmRoomEffects` and `RealmIntentContext`. The handle supplies `bootstrap`, `bindRoom`, `lifecycle`,
  `subscribe`, `bindTransient`, `intent`, `spawn` and `dispose`; effects supply `readWalker`, `placeWalker`,
  `allowWalking`, `adoptWorld`. These actual ports, not replacement signatures, compose the durable service.
- `apps/realm/src/kingdom-room.ts:createKingdomRoom` already enforces max 300 clients, the fixed input/patch
  rates, bounded input queue, duplicate-person rejection, expiry checks, periodic revocation checks and
  `onReconnect` validation before completing the reconnect handshake. Its one shared court view is the narrow
  district implementation to extend. `server.ts:createRealmServer` uses explicit 16 KiB payload and 1 MiB
  backpressure limits with closure. `main.ts` fails closed unless the labelled reference flag is enabled.
- `apps/realm/src/reference.ts:referenceServices` implements only the explicitly SIMULATED court; it does
  not implement durable authority. `packages/world/src/realm/reducer.ts` exports `createRealmState`,
  `decideRealm`, `applyRealmFact`, `projectRealmFact`. Main owns those rules, shared contracts and movement.
  `@chatdom/api` is scaffolded with pinned dependencies including `jose`; its auth/bootstrap are lane work.
  Main accepted the executable boundary after green `pnpm verify`, real uWS/SDK three-client and reload checks,
  and a three-browser Playwright flow. The team starts this frozen lane after main commits the handoff and
  creates `lane/realm-server` and its worktree this turn.
- Root already has `pg: 8.23.1`, Vitest and Vite. `scripts/check-services.mjs` checks Postgres read-only.
  A supplied ignored `.env` contains service configuration; load it in code and never print or copy it.

## Rules

1. **R1 — One durable writer.** Implement the existing `RealmRepository` port in
   `apps/realm/src/persistence/`. Acquire/renew/release use database time, a bounded lease and an unguessable
   fencing epoch. Every write compares the current unexpired epoch and expected sequence while holding the
   kingdom lock. A failed renewal immediately closes the authority gate, cancels uncommitted work and stops
   authoritative input/public delivery through `RealmRoomEffects.close`. An independent monotonic deadline closes
   the room even while renewal/outbox awaits stall; late completions cannot reopen it. An old owner cannot write after takeover, even if its process resumes.
   Keep one owned walker per person per kingdom across simultaneous tabs; define and test replacement/rejection.
2. **R2 — A commit is indivisible.** `execute` locks/fences, loads valid snapshot plus tail, invokes main's
   decision function with authoritative transaction time, rechecks `current`, and commits the fact, sequence,
   private state, command outcome, ledger/design constraints and public outbox together. Do not acknowledge,
   mutate authoritative room state or emit public success before commit. Unique `(kingdom, commandId)` stores
   a canonical command digest and outcome: committed and unchanged outcomes are terminal; a rejected same-
   payload request may be reevaluated against current authority (for example after earning a coal). Another payload
   conflicts. Ingress observation receipts remain terminal, including observations without domain facts.
   An uncertain COMMIT response is resolved by `lookup` before retry/cleanup; it is never an automatic refund.
   No held/refused decision, raw wish, rights, session ID, Twitch ID or reservation secret enters the public outbox.
3. **R3 — Recover the same kingdom.** Version snapshots with their sequence and integrity metadata. Load one
   valid snapshot, replay the ordered contiguous tail with main's reducer, then process remaining ingress.
   Fail closed on gaps, mismatched kingdom/version/digest or unsupported data; do not silently create an empty
   kingdom. Snapshot after 1,000 facts or five minutes, on offline and graceful shutdown. A committed snapshot
   never points beyond committed history. Expired forge reservations release capacity without spending coal;
   committed or another attempt's reservation is never erased. Durable timers/deadlines survive restart.
4. **R4 — Real entry has real sessions.** Build Twitch OIDC authorization-code sign-in with `openid` only in
   `apps/api/src/realm-auth/`. Verify the ID token signature, allowed algorithm, issuer, audience, expiry and
   request nonce; one-use state/nonce are server-bound and expire. Claim/create the same `PersonId` identified
   by verified `sub`; browser fields never set identity, rights, approved display names or provenance. Discard
   Twitch access/refresh tokens after the sign-in exchange. Store hashed random Chatdom session handles with
   explicit expiry/revocation; use HttpOnly, SameSite cookies, Secure outside loopback development. Protect
   mutating endpoints with origin/CSRF checks; constrain callback/return destinations. Implement logout and
   an internal revocation entrypoint. Do not add Twitch write scopes, a development-account bypass to live mode,
   or a token in a URL/log. A default unapproved public name/look uses the approved anonymous presentation.
5. **R5 — Tickets do not choose people.** The authenticated API issues opaque, hashed, short-lived, one-use
   room tickets bound to session, kingdom, protocol and origin. `RealmAuthenticator.authenticate` consumes the
   ticket atomically and establishes `RealmPrincipal`; `current` checks session revocation and expiry, not just
   a signature. Expired/consumed/cross-kingdom tickets and unknown protocols fail before an avatar is created.
   Live services reject simulated principals. Test identity providers are explicitly injected and available only
   in isolated simulation/test configuration. Session-service failure holds entry/actions; it never grants rights.
6. **R6 — Home ownership exists globally.** Add an allocation service in `apps/realm/src/allocation/` backed
   by the same Postgres database. Lock the person and appropriate kingdom/plot rows in a consistent order;
   race-safe global maximum is three citizen homes, with the monarch's own castle excluded. The fourth kingdom
   can grant a guest light but no deed. Enforce one citizen home per person per kingdom and one owner per plot.
   Follow-year evidence selects a tenure quarter; verified subscription history may select a street once within
   that quarter. Unknown history stays unknown; no date is inferred from a slot, sign-in or payment. Persist the
   assigned plot, original placement and allocation receipt. Adopt the explicit founded `SettlementPlan.revision`
   and complete layout as immutable data; no room startup regenerates/moves an existing citizen. Extension of
   a layout preserves all occupied plot IDs/transforms. A conflicting revision is an explicit rejected adoption.
   `home.installAllocated` validates the durable allocation receipt and exact home/layout linkage inside its
   transaction. Either allocate/install in one transaction or use a durable recoverable pending state whose
   reservation counts toward the cap; crashes cannot create orphaned available slots or a fourth home. This
   foundation service implements actual adoption/allocation, not merely a README for a future consumer.
7. **R7 — Ingress and public delivery survive retry.** In `apps/realm/src/ingress/`, persist an authenticated
   normalized internal command with source idempotency key and explicit capability, then have the room execute
   it. Implement the frozen `loadIngress`/`executeIngress`: load the locked checkpoint, apply the supplied
   transition and run its capability-tagged commands sequentially through `decideRealm` in the same transaction.
   Commit checkpoint revision/codec bytes, receipt/digest, the entire ordered fact batch, private state and public
   presence outbox frame together. No partially applied command batch or checkpoint advanced without its facts.
   Authenticate/verify live observation, allocation, publication, moderation and qualified-night evidence before
   granting the respective `RealmCapability`; arbitrary HTTP/browser commands cannot mint internal receipts.
   Persist `presence.confirmInterval` evidence as closed interval unions through the frozen reducer: overlap and
   retry do not multiply elapsed time, restart/coverage gaps never extend an open interval, and the same stream
   night credits once after actual 600,000 ms coverage and a current owned home. Do not use sample counts or
   manufacture credit from unobserved time. Never persist general chat text through this path.
   In `src/outbox/`, dispatch only committed sanitized
   `RealmPublicDelivery`, in fact order with stable `eventId` across retry. Transport is at-least-once: client
   dedupe/cursors prevent a lost dispatcher acknowledgement replaying a ritual. Restore the current published
   projection on fresh join without replaying historical spectacle. Implement synchronous `RealmRoomHandle.bootstrap`
   at `throughCursor`: browser buffers deltas while installing `current`, then applies only newer cursor entries.
   Domain `throughSequence` is not a public-delivery cursor: presence can change without a new domain fact. The
   bootstrap checkpoint reflects the delivered public prefix, not a private state ahead of its outbox.
   Use existing `lifecycle` for walker presence observations and `bindRoom` effects for walking/geometry changes;
   `bindTransient` carries ephemeral chat/seats and owner replies separately. No transient speech is appended to
   the durable checkpoint/history. Do not claim delivery is exactly-once.
8. **R8 — Reconnect is a checked lease.** Use Colyseus `allowReconnection` with an explicit 30-second grace.
   Drop immediately stops movement input; reconnect keeps the same person/avatar only if `current` succeeds.
   Expiry, logout/revocation, consented leave and a new writer epoch invalidate the seat. A process restart uses
   authenticated rejoin and durable state, not an old ephemeral seat. The browser lane owns tab-scoped token
   storage and rotation; supply it precise error/expiry/epoch behavior and prove SDK reload reconnect with a
   headless harness. Its reconnect callback occurs before token assignment in this SDK, so persist the rotated
   token after the completed promise/microtask. No parallel application ack/sequence scheme is permitted.
9. **R9 — Every queue and socket has a ceiling.** Keep the frozen 90 incoming protocol frames/second budget;
   30 Hz is the sole authoritative walking integration rate, at most one input per person per tick. Use the
   existing bounded Colyseus input queue; stale/overflow input cannot buy distance. Explicit uWS caps are
   16,384 inbound bytes and 1 MiB backpressure with `closeOnBackpressureLimit: true`; the payload cap must carry
   bounded legitimate build operations. Bound pending durable
   commands, per-person actions, outbox dispatch batches, DB pool/statement timeouts and reconnect seats; document
   chosen finite values and observable refusal/close behavior. Slow storage holds owned actions rather than
   accepting unbounded promises. Dropped reliable deltas close the connection and require resync. Redact secrets
   and private commands from errors/metrics; health distinguishes process alive from DB/writer/auth ready.
10. **R10 — Districts really filter.** Reuse one `StateView` object per identical district/neighbour interest
    set, attach entities to state before adding them, and never put a unique person's private data in a shared
    view. Prove a person's district crossing with another person left behind: old-interest entities disappear
    from the crossing decoder, the other person's shared view remains intact, and the arriving decoder receives
    the correct new set. Merely assigning `client.view` is not proof of removal. Measure schema-body reuse
    separately from per-socket prediction timing frames; do not claim one shared patch removes all socket cost.
11. **R11 — Test people are named as such.** The Node load driver uses exactly 300 distinct simulated people,
    real SDK joins, `room.input` reliable frames at 30 Hz and the production 200 ms patch interval. At least
    four spatial districts have active walkers and district crossings. No 300 sockets sharing one principal,
    dummy state mutation instead of inputs, absent input timing prefix, or all-to-all view silently passes.
    Simulation has an isolated kingdom/database namespace and explicit SIMULATED origin in every human-facing
    report. No fake Twitch accounts, public Twitch writes or simulated citizens inserted into live data.
12. **R12 — Recovery is demonstrated, never narrated.** Interrupt the owned test server after durable commit
    before reply, during an outstanding reservation and while an outbox batch is in flight; restart/reacquire and
    retry. Prove one outcome/coal spend/attachment, intact old item/provenance, no private public fields, no lost
    ingress, no stale-writer write and current published home restored. Include a bounded shutdown that stops
    entry, closes authority, snapshots/flushes committed work and releases only its own lease. Never kill a host
    process by name or touch other services. Target database-backed room restoration under five seconds and
    report measured duration with event count; a miss is a finding to fix, not an invented pass.

## Contracts

All public/private realm contracts above are imported from `@chatdom/shared/realm`; use main's reducer and
authority implementation unchanged. Internal allocation/auth/persistence classes may be lane-local. A missing
cross-lane type or required repository transaction seam is `needs:` for main; no changes to `packages/shared`
and no duck-typed second authority. In particular, the repository must accommodate allocation verification and
ingress checkpointing in its actual transaction, not a promise callback after COMMIT.

The browser lane consumes the frozen join/principal/receipt/public-delivery protocol, not API source imports.
Document these exact HTTP routes in `apps/api/src/realm-auth/README.md` and consume main's frozen shared DTOs
before consumers start. The API owns OIDC and session/ticket issuance; realm owns ticket consumption
and `current` checks. A shared SQL schema with opaque ticket consumption is sufficient; no new RPC framework
or bearer JWT system is required. Private internal ingress must have service authentication/capability checks.

### API entry protocol

Use `REALM_AUTH_ROUTES` and the exact schemas/types in `packages/shared/src/realm/auth.ts`, imported from
`@chatdom/shared/realm`. The lane implements these handlers without changing the frozen HTTP shapes.

| Route | Request | Success |
|---|---|---|
| `GET /api/realm/session` | Chatdom cookie | `{ version: 1, status: 'anonymous' }` or `{ version: 1, status: 'authenticated', expiresAt: number, resumeScope: string, csrfToken: string }` |
| `GET /api/realm/auth/start` | `returnTo` is a validated local kingdom path | HTTP 302 to Twitch, with server-bound one-use state/nonce |
| `GET /api/realm/auth/callback` | OIDC callback parameters | HTTP 303 to the stored validated local path, with the Chatdom cookie |
| `POST /api/realm/ticket` | Cookie, `X-CSRF-Token`, JSON `{ version: 1, kingdomId: KingdomId, protocol: 1 }` | `{ version: 1, status: 'issued', join: RealmJoin, expiresAt: number }` |
| `POST /api/realm/signout` | Cookie and `X-CSRF-Token` | `{ version: 1, status: 'signed-out' }` |

Replies use `RealmSessionReply`, `RealmTicketReply` and `RealmSignoutReply`; ticket input uses
`RealmTicketRequest`. `csrfToken` is 32–256 characters. `RealmApiError` is the common JSON error:
`{ version: 1, status: 'unauthenticated' | 'refused' | 'unavailable', message: string }`,
with a nonempty message of at most 240 characters,
with HTTP 401/403/503 respectively. Validation errors are HTTP 400 with `refused`. JSON responses and redirects
that contain auth material use `Cache-Control: no-store`. Session replies expose no identity/auth handles;
`csrfToken` authorizes same-session requests only and is not a room ticket. The cookie is the API credential.
`resumeScope` is a random opaque 16–128 character browser storage partition, stable for this Chatdom session
and changed on a new session/account. It is neither a credential nor a person/session handle and grants nothing.
The client keys tab-scoped reconnect storage by endpoint, kingdom and this scope, never by a single-use ticket.
It tries reconnect first and requests a fresh ticket only for fresh entry or expired reconnection. Signout clears
the scope's reconnect storage; session revocation also invalidates its server-side seat.
The realm endpoint is trusted configuration, never an arbitrary URL in the ticket request.

An explicit user Walk action sends anonymous viewers to `auth/start`; after callback, the browser reads the
session, requests a ticket for the chosen kingdom and joins with the returned `RealmJoin`. A signed-in viewer
can request the ticket immediately. Signout revokes the session/tickets and closes or invalidates its current
walkers; the browser clears account/kingdom reconnect storage. Failure remains a truthful entry failure rather
than mounting the simulated reference court or inventing a citizen.

## Scope

Writes: `apps/realm/src/persistence/**`, `allocation/**`, `auth/**`, `ingress/**`, `outbox/**`, `limits/**`,
`diagnostics/**`, `apps/realm/scripts/**`, `apps/realm/README.md`, `apps/api/src/realm-auth/**`,
`apps/api/src/realm-auth/README.md`, and this lane's PRD/progress. With the accepted reference freeze, this lane
also owns realm `src/server.ts` and `src/main.ts` composition, API `src/main.ts`, `vite.config.ts`, and API
`package.json` script entries needed to initialize its real bootstrap. Runtime dependency pins/lockfile remain
main-owned. Put versioned additive SQL migrations under
`apps/realm/src/persistence/migrations/`; the API consumes that schema without a second migration owner.
Tests stay with these modules. `apps/realm/src/ports.ts` is the main-owned dependency injection boundary;
consume its actual exported types. Main additionally grants narrow edits in `apps/realm/src/kingdom-room.ts`
for the shared district-view implementation and lifecycle/rate/recovery enforcement through these existing
ports. This permits replacing the one-court view and completing its interest handoff, lease-loss closure and
bounded lifecycle enforcement. It does not permit changing movement integration/step rules, input/schema
contracts or domain authority. A missing port is `needs:`; do not extend it locally or widen this grant.

Read-only: all `packages/**`, all other apps/API files, realm `ports.ts`, and the room core outside that grant,
root manifests/scripts/config/lockfile, scene and web entrypoints, existing look/place lanes and their PRDs.
Main has scaffolded the API package and pinned dependencies; the lane owns the granted bootstrap/build entries
and reports missing contract wiring as
`needs:`. No broad checkout cleanup. Other workers are present; never revert their edits.

## Acceptance

First runnable result: RS01 starts a durable-backed local room through the frozen composition seam and proves
one real Postgres commit/reload; RS02 supplies a runnable sign-in/session/ticket entry service on 5192. A mock
OIDC provider is marked SIMULATED and validates the same implementation; it never proves a real user signed in.

Core commands after the lane implements the exact test/driver paths below. The two convenience root scripts
are not currently installed; use these direct equivalents until the team integrator adds the Decisions recipe:

```bash
pnpm typecheck
pnpm lint
pnpm exec vitest run apps/realm apps/api/src/realm-auth
REALM_DATABASE_TESTS=1 node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run apps/realm/src/persistence/postgres.integration.test.ts apps/api/src/realm-auth/auth.integration.test.ts
pnpm --filter @chatdom/realm build
pnpm --filter @chatdom/api build
node --env-file-if-exists=.env apps/realm/scripts/walkers.mjs --walkers 300 --seconds 90 --districts 4
pnpm verify
```

The explicit Postgres command requires configured infrastructure and fails on missing configuration; it must
not turn into a skipped/in-memory green run. Ordinary unit verification may omit the infrastructure suite.
Integration tests create/drop only their randomized isolated schema/test kingdom and load credentials through
Node's env-file support; never print connection strings. Never reset the supplied database or existing tables.

Keep tests lean: one focused adversarial test per R1–R12 invariant (several related assertions in that test are
fine), with shared setup. The core cases are competing writers + stale epoch; uncertain commit + idempotency;
snapshot/tail recovery; OIDC/session rejection; ticket replay/identity; four concurrent allocations + stable layout;
ingress/outbox interruption; reconnect/revocation; input flood + bounded slow socket/storage; district crossing;
300 distinct input senders; and interrupted full recovery. Do not expand this into a browser/device/mode matrix.

The 300-walker driver owns only its child process/client connections. Ramp to exactly 300, then record 90
seconds steady state. Assert all 300 remain identified, send input at approximately 30 Hz without extra simulated
distance, receive ordered decoding and approximately 5 Hz patches, and complete district changes without leaked
old entities. Write one concise JSON/text report with completed joins, distinct principals, disconnect causes,
input/patch rates, actual byte totals (including prediction timing), event-loop delay p50/p95/max, tick overruns,
CPU/RSS, district encode counts, queue high-water marks and recovery timings. The report must expose saturation
or missed rates and exit nonzero for failed correctness/rate assertions. Under host noise, explain observed
latency and compare an isolated rerun only when needed; SwiftShader FPS and old fan-out logs are irrelevant.

Backend-only work adds no visual bench or screenshot matrix. Run the existing serial `pnpm verify` screenshots
once at final verification and report their paths; any changed sign-in page uses the normal web 1440×900 and
390×844 captures, inspected with `$look`. The renderer remains outside the load test. Start only owned servers
on 5191/5192 and list them in the README/progress; leave the web preview at 5190 for the team.

## Quality bar

No in-memory live fallback, invented owner, fake save success, simulated-origin promotion, duplicated economic
authority or broad catch that erases recovery errors. A disconnection has an actionable, privacy-safe status.
The signer/browser identity, a durable deed and a presentation slot remain distinct. Returning from absence
never loses a home, occupied placement or earned item. This foundation must support the real Forge consumer;
one successful direct SQL insert is not a substitute for a room/authority transaction.

## References

- `work/references/colyseus-realm.md`: pinned release behavior, input/ack consumption, shared-view identity,
  district-switch decoder caveat, rotated reconnect token timing and real per-socket prediction costs.
- `work/specs/33-realm.md`: main's ownership, durable-before-public boundary and shared contracts.
- `.agents/skills/twitch-dev/references/auth.md` §7: OIDC and separate Chatdom sessions. Verify against
  [Twitch's OIDC documentation](https://dev.twitch.tv/docs/authentication/getting-tokens-oidc/) when implementing;
  official page checked 2026-10-30. The founder chooses `openid` only and discarding Twitch tokens.

## Not now

Production deployment, tunnels, DNS/server configuration; Twitch writes; alternate realm authority; LayerRoom,
DraftRoom or MatchRoom implementations; renderer changes; game rules, full home editor or Forge generation;
editing `apps/codex` or treating it as an owner; moving existing lane-owned scene/look/place modules. This lane
provides the real storage/auth/allocation foundation those consumers require, rather than claiming those full
experiences have shipped.

## Decisions

- **2026-10-30 — Frozen after main acceptance.** Shared declarations, reducer, reference room, typed ports and
  auth DTOs exist as recorded above. Main reports full `pnpm verify` green, real uWS with three SDK clients/reload
  and three-browser Playwright entry passing. This spec and PRD are frozen; team starts the lane once main
  commits this handoff and creates its branch/worktree this turn. This document creates neither.
- **2026-10-30 — Ownership is foundational.** Actual global allocation and immutable founded-layout adoption
  are part of this lane. Browser/Herald slot hints cannot stand in for them. Existing chat rows and OIDC identity
  use the same Twitch subject; sign-in never creates a second person.
- **2026-10-30 — Pinned foundation and integrator-only root scripts.** Main has added `pg: 8.23.1` to realm runtime dependencies and API
  package `@chatdom/api` with runtime `@chatdom/shared: workspace:*`, `pg: 8.23.1`, `jose: 6.2.14`,
  `zod: 4.6.7`, dev `vite: 8.3.5` and package-local `@types/pg: 8.23.1`. The lane adds the Vite Node
  build/bootstrap and startup on 5192 under its explicit grant.
  Keep existing Colyseus exact pins. API uses `jose` for OIDC; opaque DB tickets mean
  realm does not need a JWT dependency. Registry versions checked 2026-10-30. Main owns lockfile changes.
  Once the lane's exact test/driver files exist, the team integrator alone adds root `package.json`
  `scripts["realm:test:postgres"]` with value
  `REALM_DATABASE_TESTS=1 node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run apps/realm/src/persistence/postgres.integration.test.ts apps/api/src/realm-auth/auth.integration.test.ts`
  and `scripts["realm:bots"]` with value `node --env-file-if-exists=.env apps/realm/scripts/walkers.mjs`.
  These convenience scripts are future additions, not existing commands or permission for lane root edits.
  The lane writes those exact paths and supplies this addition recipe in its integration README; explicit
  infrastructure mode errors if `DATABASE_URL` is absent. Use direct Acceptance commands before registration.
- **2026-10-30 — Lean proof.** Nine ordered module tasks, one targeted invariant test each, one steady-state
  300-walker run and one interruption/recovery run. Screenshots remain serial and limited to actual UI changes.
  A failed invariant warrants focused follow-up, not a ceremonial matrix.
- **2026-10-30 — SDK/transport colon support is main-owned.** Keep main's narrow pinned SDK reconnect parser
  patch and uWS colon-path patch, workspace patch registration, lockfile and MIT credit. RS05 tests both SDK reconnect paths with actual
  deterministic `k:<kingdomId>` IDs. Do not work around the SDK by renaming rooms, parsing tokens in the app
  or inventing an alternate reconnect protocol.
- **2026-10-30 — Actual ports and narrow room transfer.** Durable services implement `RealmRoomServices` and
  `RealmRoomHandle` from `apps/realm/src/ports.ts`; typed bootstrap/lifecycle/effects are already supplied.
  Main grants only district views and lifecycle/rate/recovery enforcement in `kingdom-room.ts`. Preserve the
  main-owned movement, schema and domain rules. The payload ceiling is 16 KiB to admit bounded build operations.
  Presence checkpoint and its multi-fact batch commit through `executeIngress`/`loadIngress`, with evidenced
  interval union and current-home requirements consumed from the reducer.
