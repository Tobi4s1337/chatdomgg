# Lane realm-server

Status: frozen · 2026-10-30

Spec: `work/specs/34-realm-server.md` · Branch: `lane/realm-server`
Scope: `apps/realm/src/{persistence,allocation,auth,ingress,outbox,limits,diagnostics}/**`,
`apps/realm/scripts/**`, `apps/realm/README.md`, `apps/api/src/realm-auth/**`, this PRD/progress.
With the accepted reference freeze: realm `src/{server,main}.ts` composition and narrow `src/kingdom-room.ts` grant below;
API `src/main.ts`, `vite.config.ts`,
and `package.json` bootstrap scripts. Runtime dependency pins and lockfile remain main-owned.
Worker: `gpt-6.1-sol`, high; xhigh for fencing, realtime and recovery. Follow `$ralph-lane`.

**Ready for the team once main commits this frozen handoff and creates the lane branch/worktree this turn.**
Main accepted green full verification, real uWS/SDK clients/reload and the three-browser flow. The exact typed
ports and shared auth DTOs exist; the actual durable/API services are this lane's work. Root manifests, shared contracts,
main's `src/ports.ts`, reducer and every renderer/scene file are read-only. The room file's narrow grant is only
district views and lifecycle/rate/recovery enforcement through existing ports; movement integration, schema
and authority rules stay main-owned. You are not alone
in the codebase; preserve other workers' changes. Use the frozen `ports.ts` types for owned composition; send
missing lifecycle seams as `needs:` to main and integration recipes to the team integrator; never make a second
authority or a whole-repo cleanup to make a task pass.

Every task is done when its focused test/log is real, `pnpm typecheck`, `pnpm lint` and affected tests/build are
green, its box is ticked, one progress line is added and one coherent commit is on the lane branch. Postgres
tests use an isolated schema/kingdom and fail explicitly when requested infrastructure is absent. Credentials
load from ignored environment configuration and never reach output. Use one targeted core test per invariant,
sharing fixtures; do not build a mode/device matrix. No new screenshots for backend modules. Final `pnpm verify`
uses the existing serial screenshots; inspect any changed sign-in surface at 1440×900 and 390×844 with `$look`.

## Tasks

- [ ] **RS01 — A committed fact survives a room restart** · evidence: test/log. Implement additive migrations
  and the actual `RealmRepository` in `src/persistence/`, with fenced DB-time writer leases, expected sequence,
  command digest/outcomes and atomic private fact/state/ledger/outbox commit. Wire through the frozen startup
  injection and run a durable local room on 5191 by the end of this task. Focused R1/R2 test uses two competing
  writers, stale-epoch retry and lost COMMIT reply; prove one spend/fact/outcome after `lookup`/reload. Document
  local start/migrate commands and connection-safe failure. No live fallback to main's simulated memory adapter.
- [ ] **RS02 — Twitch sign-in issues a checked room ticket** · evidence: test/log. Implement OIDC code/state/
  nonce verification, claimed person identity, hashed expiring/revocable Chatdom sessions, protected logout and
  opaque single-use kingdom tickets under `apps/api/src/realm-auth/`. Implement `RealmAuthenticator` under
  realm `src/auth/` using the same database. API runs on 5192 using main's scaffold. Focused R4/R5 tests use
  `REALM_AUTH_ROUTES` and `RealmSessionReplySchema`, `RealmTicketRequestSchema`, `RealmTicketReplySchema`,
  `RealmSignoutReplySchema`, `RealmApiErrorSchema` from shared `realm/auth.ts`, so an explicit Walk action
  completes real sign-in and obtains the room ticket. Session replies include stable opaque `resumeScope`
  (a storage partition, never a credential); new sessions/accounts rotate it. Tickets remain single-use. Tests use
  an explicitly SIMULATED provider through production verification logic: reject wrong issuer/audience/nonce,
  expired/revoked sessions, replay/cross-kingdom tickets and client-selected identities. Live mode has no bypass.
- [ ] **RS03 — Three real deeds, with streets that stay put** · evidence: test. Implement global allocation and
  immutable founded-layout adoption in `src/allocation/`. Persist person/kingdom/plot constraints, verified
  tenure evidence, original placement, receipt and pending-install recovery; validate `home.installAllocated`
  inside the durable write transaction. Focused R6 test races one person into four kingdoms and restarts during
  allocation: at most three citizen deeds, castle excluded, guest retained, occupied plot transforms unchanged
  and old layout cannot be overwritten by a regenerated plan. No fixture ownership in live paths.
- [ ] **RS04 — Ingress cannot vanish and committed public delivery can resume** · evidence: test. Implement
  authenticated capability/evidence-checked ingress in `src/ingress/` and committed ordered delivery in
  `src/outbox/`. Implement `loadIngress`/`executeIngress`: persist source dedupe, private checkpoint and all
  capability-tagged facts plus public presence outbox in one transaction. Closed evidenced interval unions survive
  restart without doubling overlap or inventing coverage gaps; qualified-night credit needs actual ten-minute
  coverage and a current owned home. Implement typed synchronous bootstrap at `throughSequence`, existing
  `lifecycle` and `bindRoom` effects, plus separate transient/owner delivery. Keep stable event IDs, current
  projection restoration and explicit at-least-once retry. Focused R7 test interrupts after commit/before delivery
  acknowledgement, then resumes: one applied ingress result, same public event ID, no replayed economic change,
  no raw creation words/rights/tokens in the public payload. Supply browser dedupe/cursor wiring instructions.
- [ ] **RS05 — Reconnect returns the same person and honors revocation** · evidence: test/log. Add the auth/
  lifecycle adapter through main's existing handshake-time `onReconnect`, periodic revocation and drop guards,
  with explicit 30-second grace, immediate drop-input stop, current-session recheck, one-person seat policy and
  writer-epoch invalidation. Focused R8 harness demonstrates drop/reconnect and
  SDK reload reconnect with rotated token, then revocation/expiry/restart rejection and authenticated fresh join.
  Exercise both explicit and automatic SDK reconnect with colon-containing `k:<kingdomId>` IDs through main's
  pinned SDK parser and uWS colon-path patches; do not parse tokens in application code or rename rooms to hide a failure.
  Document tab-scoped account/kingdom token storage, rotation timing and exact errors for the browser lane;
  browser source files remain read-only. Never add application input sequence/ack state.
- [ ] **RS06 — Slow or abusive clients have finite costs** · evidence: test/log. Implement configuration and
  readiness diagnostics in `src/limits/` and `src/diagnostics/`: 90 frames/s, existing bounded input queue,
  one integration per tick, 16 KiB incoming frames for bounded build operations, 1 MiB backpressure with closure, bounded action/work/DB/outbox
  queues and timeouts. Focused R9 test combines input flood with controlled slow socket/storage: distance cannot
  increase, ceilings hold, dropped deltas close/resync, and unhealthy dependencies hold actions. Report measured
  high-water marks and secret-safe close reasons. Supply exact transport/room composition to the integrator.
- [ ] **RS07 — Crossing a district removes the old district** · evidence: test/log. Add the isolated SDK
  district/decoder harness under `apps/realm/scripts/` and integration tests alongside diagnostics; consume the
  actual production room's `StateView` implementation. Extend the one-court view under the narrow room-file
  grant with shared district/neighbour views and explicit decoder-safe handoff. Focused R10 test crosses one person while
  another stays behind: old-interest entities are removed only from the crossing decoder, arriving state is
  complete and shared-view identity is retained. A fix outside the room grant is `needs:` with a failing test;
  do not edit movement/domain rules or substitute a bench-only room. Record body reuse and per-socket
  timing-frame costs separately.
- [ ] **RS08 — Exactly 300 simulated walkers exercise the actual transport** · evidence: log. Implement
  `apps/realm/scripts/walkers.mjs` using real SDK joins/input at 30 Hz, 300 distinct injected simulated people,
  four active districts with crossings, production 5 Hz patches and 90 steady-state seconds. No WebGL, same-ID
  socket pile or fake mutation loop. Focused R11 assertions prove distinct principals, bounded distance, ordered
  decoding, expected rates and correct interest. Record joins/causes/bytes, tick and event-loop timing, queue
  high-water marks, RSS/CPU and encode counts in one SIMULATED report. Fail correctness/rate misses honestly.
- [ ] **RS09 — Kill, reacquire and retry without losing anybody's work** · evidence: test/log. Finish snapshot
  scheduling, contiguous-tail validation, expired-reservation recovery and bounded graceful shutdown in
  `src/persistence/`/diagnostics. Focused R3/R12 test interrupts owned processes at commit-before-reply,
  reservation and outbox boundaries; reacquire with a new epoch and prove one spend/attachment, retained displaced
  item/provenance, complete ingress/public projection and fenced old process. Measure recovery against five
  seconds with dataset size. Run spec 34's direct Postgres and 300-walker Acceptance commands plus `pnpm verify`; write a
  short README integration recipe, exact evidence paths, owned ports/processes and remaining doubts for the
  team integrator. Do not merge lanes, deploy, alter server configuration or call simulated evidence live proof.
  Include the exact future root `realm:test:postgres`/`realm:bots` addition recipe from spec 34; the integrator
  registers those scripts only once the files exist. They are not present now and the lane cannot edit root manifests.

## Backlog

Ideas discovered while working go here; do not pick from this list without main's brief.
