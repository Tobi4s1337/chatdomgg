# Lane realm-wiring

Spec: `work/specs/36-realm-wiring.md` · Branch: `lane/realm-wiring` · Worker: Codex Sol, high (xhigh for recovery/realtime evidence).
Scope: `apps/realm/src/wiring/**`, `apps/web/src/realm/adapters/**`, **new files only** `apps/herald/src/realm-sink/**`, this lane's work files.
Status: frozen · 2026-10-30. Start after main commits this handoff and creates this turn's `lane/realm-wiring` worktree.
The executable boundary is verified: full `pnpm verify`, three uWS SDK clients and three Playwright browser clients passed.
This lane never edits shared/world contracts or another lane's files.

Use `$ralph-lane`, `$chatdom-vision`, `$twitch-dev` for Twitch integration, and `$look` for visual acceptance.
You are not alone in the codebase. Preserve all other edits. Realm-server owns persistence/auth/founded manifest;
realm-walk and realm-interactions own their surfaces. Herald owns its unaccepted H05 files. Main/the integrator
alone applies central composition and scene/bench recipes. Never edit those files to unblock yourself.

Every task is done when applicable Spec 36 acceptance passes; `pnpm typecheck`, `pnpm lint`,
`pnpm test -- apps/realm/src/wiring apps/web/src/realm/adapters apps/herald/src/realm-sink` and `pnpm build` are green;
affected existing regressions pass; visible changes have the required captures opened with `view_image`; the box
is ticked; one evidence/needs line is appended to `progress.txt`; and one coherent commit is on the lane branch.
Final integration requires `pnpm verify`. Work one task at a time. Record missing contracts/composition/real human
triggers as precise `needs:` and continue independent tasks. Do not tick real proof on fixtures or wait forever
for a human message. Never pick Backlog without main instruction. Sub-agents never run git.

## Tasks

- [ ] **RW01 — Two room clients share the existing window feed** · evidence: room integration test + first desktop/phone captures.
  Export the programmatic `createRealmWiring` factory over actual `RealmRoomServices`/`RealmRoomHandle` ports.
  Add typed room presence/build/Forge observation adapter skeletons under the allowed directories, using the
  actual frozen client and public delivery. Consume `REALM_AUTH_ROUTES` and the strict shared auth DTOs for
  production session/ticket entry; no guessed endpoints or reference-session fallback. Supply the actual
  `RealmEntry` with session `resumeScope` and a lazy fresh-ticket factory; reconnect never reuses a consumed
  ticket. Implement buffered `RealmBootstrap`/`throughCursor` (independent of domain fact sequence) installation,
  presence freshness/origin/epoch/sequence handling and disposal; snapshot restoration never replays rituals.
  Provide the first exact scene installation recipe, then demonstrate a labelled SIMULATED window
  change through the actual room to two clients. No direct Herald SSE or first-plot fallback. R1–R4, R10.

- [ ] **RW02 — Verified Herald observations enter the room privately** · evidence: ingest-to-room tests + service recipe.
  Add only new `realm-sink/**` service adapter files. Forward validated private presence/stream/moderation input
  and cancellation guards with kingdom-scoped service authority. Use `loadIngress`/`executeIngress` and the
  versioned shared-world presence codec so checkpoint, commands, outcome and public projection commit together.
  Preserve coverage, partial rosters, recovered
  observations, dedupe and every cleanup race. Write exact additive hooks for accepted source/live/ingest files
  and shutdown; main/integrator applies them after H05. Exercise the same sink with real composition and labelled
  protocol fixtures; reject public/browser ingress and private data leaks. R1–R5, R11.

- [ ] **RW03 — Coal comes from ten real minutes in this live kingdom** · evidence: boundary/restart/union tests.
  Bind private `presenceTick` eligibility and closed evidenced intervals to `presence.confirmInterval` inside
  `executeIngress`; consume core `qualification` interval unions and owned-home credit requirements. Prove
  599,999/600,000 ms, nine-minute ten-sample rejection, overlapping sources, late disjoint ranges, atomic rollback/
  retry, gaps/recovered/offline transitions, one stream-night credit and cap three including a reserved coal.
  Persist only closed time, start open evidence afresh after restart and never introduce another ledger. R1–R3, R6.

- [ ] **RW04 — The room owns Forge reservations and final attachment** · evidence: actual repository authority/fault tests.
  Implement the shared `KingdomForgeAuthority` binding over the room's serialized domain commands: real owned
  home/rights/live session, approved attribution, available coal/anvils, one active work, attempt uniqueness and
  expiry. Revalidate current native geometry and exact digest; atomically commit consume/attach/provenance/
  displaced-item retention/public outbox. Test stale home, cancellation while awaiting locks, other-attempt
  release, duplicates and writer change. R1–R3, R5–R8. Depends on RW03 and realm-server transaction ports.

- [ ] **RW05 — The existing gated Forge runs and uncertain commits recover** · evidence: coordinator-to-room tests + privacy report.
  Bind the existing Codex coordinator and real provider factory to RW04, private audit and room outbox observation.
  Adapt Herald's private wish sink and authenticated browser wish to the same authority. Neither API key nor
  model-approved event authorizes placement. Resolve lost/late commit replies by repository lookup before
  private status; unknown stays recovery-needed, committed stays committed. Verify refusal/cancellation and
  callback failure expose no words/candidate, replay no ritual and never charge/refund twice. Preserve the actual
  event envelope (`seq`/times/type/actor/cause/body), state `sequence`, and simulated attachment provenance.
  Fixtures cannot label their source live. R5, R7–R8.

- [ ] **RW06 — An owned private build becomes an approved durable street home** · evidence: reviewer/ownership/race tests.
  Bind service-owned drafts and operations to authenticated plots/revisions. Implement the service
  `BuildPublicationReviewer` with actual policy/name/six-angle checks and durable approval evidence, then the
  room's approved replacement/asset/collision handoff through `bindRoom`/`RealmRoomEffects.adoptWorld`, with
  safe current poses for every affected walker and the actual founded layout revision. Holds keep the draft and
  last approved home. Prove cross-
  owner rejection, forged receipt/candidate rejection, and simultaneous build/Forge CAS races. R1–R3, R8–R9.
  Independent of model-run task RW05 once the room/approval ports exist.

- [ ] **RW07 — Existing tools and rituals use room receipts** · evidence: client tests + integrated screenshots.
  Complete browser Build reviewer/tools and Forge ritual adapters and exact bench/scene recipes. Compose
  `lifecycle` and `bindRoom` with interactions; use `context.current()` after awaits rather than a second context.
  Resolve the
  signed-in person's founded plot; install only committed assets, handle private pending/held outcomes, dedupe
  ritual delivery and restore snapshots. Bench sessions explicitly use SIMULATED rooms; live path has no local
  publish/direct development API fallback. Bind ephemeral bubble expiry/cleanup
  and safe rendering through `RealmTransientMessage` and `CitizenChatCueSchema`, including deletion/clear races. R2–R3, R8–R11.
  Depends on RW05/RW06 and main/integrator's composition installation.

- [ ] **RW08 — Restart and failure evidence covers the complete composition** · evidence: runnable check/capture scripts + reports.
  Deliver owned `check.mjs`/`capture.mjs` using actual accepted entrypoints and scratch durable storage. Include
  the frozen `RealmRoomServices`/`createRealmWiring` composition test through `createKingdomRoom`, not a fake room.
  Exercise
  two authenticated clients plus stream observer through publish/forge/presence, disconnect/reconnect/reload and
  real server restart. Inject reply loss and moderation/provider races; inspect public network/replay/log privacy.
  Capture and look at all Spec 36 states/sizes. Run existing affected regressions and final integrated
  `pnpm verify`; no alternate scene or in-memory live durability. Depends on RW02–RW07 and integration recipes.

- [ ] **RW09 — Demonstrate real tobi4s_ chat and the genuine Forge path** · evidence: redacted real-source/provider report + multi-client captures.
  Run the authorized existing real Herald source through the private room sink, collect real Chatters/coverage
  evidence and the first actual human message lighting the same window in all clients. Observe for a bounded
  documented period; if nobody types, finish the watcher/trigger recipe and all independent checks, record the
  missing human timestamp explicitly and leave that real proof open. When live/home/presence/rights conditions
  actually hold, run one genuine wish through real providers and demonstrate one durable charge/part after
  restart. No forged grants, artificial coal, fake-account message or labelled fixture passed off as real. Keep
  outstanding human/provider prerequisites separate from passing infrastructure evidence. R4–R8, full Acceptance.

## Backlog

Workers add discoveries here and never select them without main instruction.
