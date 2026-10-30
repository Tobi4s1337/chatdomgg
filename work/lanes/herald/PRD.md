# Lane herald

Spec: `work/specs/03-herald-presence.md` · Branch: `lane/herald` · Worker: Codex Sol, high.
Status: **H01 merged by main; H02–H05 remain with the lane. Main's integration fixes are recorded below.**

## Main integration notes — 2026-10-30

- H01 review correction: token invalidation/replacement immediately disables reported capabilities. Failed
  validation stays blocked until validation plus fresh grants succeed; an obsolete in-flight inspection cannot
  republish success. Six regression cases were added in main; no new real Twitch reads are claimed.
- H02 browser seam fixed in main: `createHeraldPresence(url, kingdomId, expectedOrigin)` defaults to `live`.
  Replay explicitly selects `simulated`, reports `SIMULATED`, and retains strict schema, kingdom, epoch,
  sequence and local freshness guards. Cross-origin frames fail closed in both modes. Open
  `/?source=herald&presenceOrigin=simulated` (also `/stream`) for the replay SSE producer; real mode is
  `/?source=herald`. Neither connection-open nor a simulated frame can establish LIVE.
- Main ran `pnpm install` to register `@chatdom/herald` and `@chatdom/twitch` in the root lockfile. Lane workers
  should merge main's integration fixes before completing the next task; do not overwrite them.
- Review followups for the first long-running consumer: RequestBudget queue admission needs an actual deadline
  timer and a deadline check before execution; transport must cap streamed response bytes before buffering the
  whole body. Track these with the H04/H05 bounded-load acceptance, rather than claiming current code proves them.

Scope: `apps/herald/**`, `packages/twitch/**`, this PRD, `progress.txt`, the Herald spec and
`work/references/herald-presence.md`. Everything else is read-only. You are not alone in the codebase: preserve
others' work. Never edit `packages/shared`, `packages/world`, root manifests/lockfile/scripts, web integration or
the running Surveyor. Main owns those seams and worktree setup. Use `$ralph-lane`, `$chatdom-vision` and Twitch
skills. Use `$look` when reviewing integration screenshots. Sub-agents never run git.

Every task is done when applicable Spec 03 acceptance passes; `pnpm typecheck`, `pnpm lint`,
`pnpm test -- apps/herald packages/twitch` and `pnpm build` are green; the box is ticked; one evidence/needs line is
added to `progress.txt`; and the lane worker records one coherent lane commit. Visual integration also requires
repo-script captures opened with `view_image`; final integration requires `pnpm verify`. No real-read task is done
with only simulated evidence. Work in order, one task at a time. A main-owned seam/grant dependency gets `needs:`;
continue an independent task, never invent the missing authority. Never pick from Backlog without main instruction.

## Tasks

- [x] **H01 — Know exactly which real reads are authorized** · evidence: tests + redacted auth check.
  Add `@chatdom/herald`/`@chatdom/twitch` package manifests within scope and the narrow typed read client. Implement
  `check:auth`, in-process external-env loading, Get Users, app token acquisition/validation and Get Authorization
  By User. Implement the minimal interactive `authorize` helper with existing registered redirect, CSRF, expected
  account verification and token discard; no runtime user token store. Report exact missing grants/registration
  without exposing values. Test wrong user/client/scopes, denial, 401 single-flight and redaction. R2–R4, R14.

- [ ] **H02 — Publish one honest source through the frozen presence path** · evidence: source tests + first shots.
  Implement source composition around main's reducer/public projection and persistent private `PresenceBinding`
  table; expose
  `/presence-data/stream` SSE and local redacted health on 5194. Add `dev`, `replay`, `check:source` scripts and
  synthetic SIMULATED inputs using the same path. Bound subscriber buffering and send only current public frames.
  Main wires its single adapter/proxy; jointly capture desktop/phone/stream simulated and unavailable states and
  inspect them. No private person IDs, Chatters names or raw inputs on SSE. R1, R9–R10, R13–R14.

- [ ] **H03 — Receive real chat once and remove it when Twitch does** · evidence: protocol tests + real log.
  Implement `provision:source` to explicitly provision/reuse only the configured owned development conduit,
  attach one outgoing shard and create the seven
  exact subscriptions. Validate conditions/version and required cleanup coverage, map chat/clear/delete/revoke into
  shared trusted inputs and enforce TTL/tombstones plus the finite `moderated` protective hold on user clear.
  Global clear never erases all lights. Implement watchdog, controlled handover, shard repair, idempotent
  subscription reconciliation, dedupe, backoff and shutdown. Demonstrate a real `tobi4s_` message through SSE once
  grants exist; keep only redacted timestamps/counts. Missing grant leaves real integration incomplete. R2–R7, R10.

- [ ] **H04 — Quiet chat users and the castle follow observed state** · evidence: sweep/stream tests + shots.
  Implement bounded complete Chatters sweeps every minute and Get Streams startup/gap/minute reconciliation.
  Preserve prior freshness under partial pages or 429; expire evidence through the shared reducer and keep
  offline/unknown/recovered distinct. Join real named/unnamed presence through the same durable slot mapping;
  never identify a quiet user publicly or infer viewing from viewer count. Demonstrate stable slots after restart,
  unnamed projection, offline beacon and stale-source states with main's view. R7–R9, R11–R12.

- [ ] **H05 — Demonstrate the source under interruption and real load shapes** · evidence: acceptance + shots.
  Finish synthetic 50,000-identity, overload, repeated cursor, reconnect overlap, stalled SSE, deletion-before-
  delivery, restart and revocation scenarios; inspect logs/output/disk for real chat text or secrets. Run complete
  acceptance and `pnpm verify` with main's integration. Open the standard screenshot set and record actual real
  message-to-window latency, gap behavior and known grant/device limitations. Resolve required integration `needs:`
  before marking the lane complete; no test mode impersonates live or writes to Twitch. All R1–R14.

## Backlog

Worker discoveries go here with evidence. They do not authorize outbound Twitch actions, scope expansion or a
second presence adapter.
