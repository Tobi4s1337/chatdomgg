# Lane tavern-tables

Spec: `work/specs/22-tavern-tables.md` · Branch: `lane/tavern-tables` · Worker: Codex `gpt-6.1-sol`, high;
engine/privacy core design and review `gpt-6-astra`, xhigh/high; visual work `gpt-6.1-terra`, high; tests Terra medium.
Scope: `packages/games/**` except `src/dusk-court/**`; `apps/taster/**`; `apps/web/src/tavern/**`;
`apps/realm/src/matches/tavern/**`; `apps/codex/src/games/**`; this PRD/progress and spec 22.

Read `AGENTS.md`, `$ralph-lane`, spec 22 and `work/references/table-games.md` before work. You are not alone;
preserve others' work. Main creates the branch/worktree and registers dependencies/routes/shared contracts.
No edits outside scope. Report `needs:` for missing shared groups, provider ports, integration or art. The engine
APIs are lane-local new implementation, not an invented shared network contract. Coordinate compatible API delivery
with `campfire`; never edit `packages/games/src/dusk-court/**`. No fake production success or fallback crowd.

Every task is done when root `pnpm typecheck`, `pnpm lint`, scoped Vitest from spec 22 and `pnpm build` are green,
its behavioral evidence is saved, visual changes are captured and looked at using `$look`, the box is ticked,
one progress line is added and one coherent commit is on the lane branch. Main reviews/merges; sub-agents never
git. For the worker, follow the lane protocol's one-task commit rule. Captures serialize through the host lock.

## Tasks

- [ ] **TT01 — Step through a real tavern door and sit at its first table** · evidence: bench + room/threshold/seat shots.
  Build the actual traversable voxel room, bar/hearth/notice board, blocked furniture/working seats and miniature
  anchors, with painterly blend, host-injected citizens/camera/audio and reduced motion. Publish the small exact
  local engine API/types and bounds required by TT02/campfire without claiming a live protocol. The owned HTML bench
  is visible in this task; label fixtures SIMULATED. No game-menu lobby or fake viewers. Main/art board dependency
  is recorded early, never filled with shippable placeholder art.
- [ ] **TT02 — A total rule interpreter runs, resumes and keeps secrets** · evidence: engine + host privacy/replay tests.
  Implement finite Chalk AST/types/effects/reveals, compile checks and taint, injected seed/time, bounded state,
  phase/timeout/round semantics, safe audience/legal-action/event projection and durable Trestle ports. Include
  Dusk Court's simultaneous-role-choice primitives. Exercise actual local storage across restart, idempotent move
  and result outbox; keep server snapshots out of browser-safe exports. Main reviews the core before downstream use.
- [ ] **TT03 — Five named table games play from first move to witnessed result** · evidence: real playouts + five board shots.
  Finish quiz, chalk drawing/guessing, legal chess, private-cup dice and regatta rule manifests/helpers, tutorials,
  timeouts, scoring/result classification, miniature projections and Tableware. Use the supplied reviewed board
  art/styles and physical sounds. Verify wrong/private inputs and complete rules rather than scripted rounds.
- [ ] **TT04 — The authored family shelf covers the finite prompt vocabulary** · evidence: settings-grid reports + play traces.
  Finish the roughly twelve distinct families specified in R5, settings/house-rule menus, authored safe packs,
  deterministic presentation references and testable promises. Implement the Royal Taster worker/jobs: whole-grid
  checking, paired-seed/rotated-seat fairness, termination bounds, illegal fuzz and two-world trace checks. Require
  planted privacy/control-flow leaks to fail. Persist reports bound to exact manifest/runtime/check hashes.
- [ ] **TT05 — People share tables and chat plays in four ways** · evidence: two-client + spectator + 50,000-voter harness.
  Implement the table directory/1 Hz safe miniatures, seat lease/resume, same table across layers, audience views,
  explicit live/stale/unavailable states, one/many/teams/seats participation, trust-gated lottery and public chat-cup
  semantics. Use injected authenticated ingress, delay/ad-pause and dedupe ports; production adapters consume only
  main's frozen shared schemas. Test small-room warmth and high-volume input without copying matches per layer.
- [ ] **TT06 — A sentence dresses an empty table with a genuinely checked game** · evidence: real provider/gate flow + hostile tests.
  Implement shelf reuse, real game spell family selection and safe skin/promise plan, table-dressing observations,
  external input/final judges, Taster admission and private soften/hold/refuse/timeout/retry states. Implement the
  bounded new-rules path and real-100-prompt activation evidence switch, default off. Mocks cannot count as live
  provider success, a judge pass, a real prompt corpus or a published table.
- [ ] **TT07 — Played games stay, and only a ready game can earn the monarch's crown** · evidence: durable shelf/crown/revocation tests.
  Persist immutable manifests/reports/provenance and played shelf; implement deep Taster + Codex polish/changelog,
  human-play evidence and monarch-only crown. Preserve author/lineage on cross-kingdom export/adoption through
  required recipient safety and unresolved re-crown policy port. Test hide/revoke/derivatives and exactly-once
  practice/result delivery across crash. Main owns ledger effects and outbound Twitch actions.
- [ ] **TT08 — Demonstrate the whole night and hand main a clean integration** · evidence: locked capture suite + restart/privacy logs.
  Run spec 22's multi-client/restart/host-crash/result/privacy matrix and exact checks; capture/view all standard
  sizes, named boards, threshold, prompt wait/success, crown and reconnect, including reduced motion. Fix the
  room/controls/sound and secret leaks found by review. Supply production host integration instructions, costs,
  all required dependency/asset/license information and unresolved `needs:`. Main completes integrated `pnpm verify`
  and kingdom/stream/panel review; a green isolated bench is not a claim of live Twitch or production readiness.

## Backlog

Workers record discovered ideas here; never pick from this list without main's brief.
