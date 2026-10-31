# Lane twitch-moments

Spec: `work/specs/20-twitch-moments.md` · Branch: `lane/twitch-moments` · Worker: Codex Sol, high for backend/contracts/integration;
Terra, high for delegated visual work under this lane's disjoint subtrees. Main/team assigns one lane worker; sub-agents never run git.

Scope: `apps/web/src/twitch-moments/**`, `apps/web/src/twitch-moments-bench/**`,
`apps/herald/src/twitch-moments/**`, `apps/api/src/twitch-moments/**`, this PRD and `progress.txt`.
Everything else is read-only, especially shared, existing Herald H01–H05/auth/conduit/source files, API root
auth/router files, packages/twitch, kingdom/stream/panel and other lanes. You are not
alone in the codebase; preserve and accommodate others' work. Main creates branch/worktree, route hooks and
production bindings only; this lane owns actual normalizers, projector, endpoint semantics and action executors. Follow `$ralph-lane`, `$chatdom-vision`, `$look` and the Twitch hub when needed.

Every task is done when `pnpm typecheck`, `pnpm lint`,
`pnpm exec vitest run apps/web/src/twitch-moments/moments.test.ts`, `pnpm test` and `pnpm build` pass;
applicable deterministic captures are taken with the shared capture lock and opened with `view_image`; the box
is ticked; one evidence/needs line is added to `progress.txt`; and the lane worker records one coherent commit.
Main runs `pnpm verify` on integration. No live-producer claim from fixtures, no live Twitch write execution by this lane,
no contract edits outside owned local modules. Work one task at a time; record missing main ports as `needs:` and
continue independent presentation work. Never choose from Backlog without main instruction.

## Current handoff — 2026-10-31

This handoff supersedes earlier task order, parking and per-task verification instructions in this PRD; scope and safety boundaries still apply.

TM01–TM03 merged; real cheer/hype source binding remains with main. Stream view is the stage; chat is the controller and events are the physics. One worker per lane by default. Work one current task at a time; lanes can proceed in parallel where their owned scopes and dependencies are independent. Each lane implements feature-local durable adapters and runtime behavior against existing ports; main owns shared contracts and cross-surface authority and integration bindings. Record a precise `needs:` and continue independent work when a seam is unavailable. Targeted checks for each step: typecheck, affected tests and one viewed stream-first 1920×1080 capture per visual change; main runs wider milestone checks. Existing accepted work and historical evidence remain intact.

## Tasks

- [x] **TM01–TM02 — Support at the right home** · Merged and composed by main; retain evidence and the real-event qualification in progress.
- [x] **TM03 — Sky answers a cheer** · Merged spectacle; real cheer/hype ingestion is still main-owned and unproven.
- [x] **TM08 — Make the sky and parcels read at dusk** · Replace the equal-height aurora with irregular overlapping curtain folds while keeping names legible; give gift parcels warm seal/ribbon contrast. Capture and inspect the real-kingdom staged scene and sound tails; label rehearsal SIMULATED.
- [ ] **TM09 — Stage an observed event together** · Consume the existing approved event and director ports to coordinate sky, light, sound and crowd in one beat, then return camera control. Test interruption/deduplication and capture the stream; report absent actual source as `needs:` rather than presenting a rehearsal as live.
- [ ] **TM10 — Verify the composed event path** · Exercise actual main-provided ingress and observer bindings when available, retaining truthful source identity and delivery/retry semantics. Focused tests plus a viewed stream capture; record separately whether a real Twitch event was witnessed.

## Previous task breakdown (history; not the current queue)

- accepted: **TM01 — A real home banner answers one validated sub** · evidence: contract/privacy scenario + first shots.
  Build the precise local catalogue/action/result schemas on shared helpers, pure clocked controller, unavailable
  real ports and explicit SIMULATED transport. Freeze the server subscription/record/principal/Helix ports and
  implement the first actual subscription normalizer through private identity/record projection into the view;
  fixtures enter as provider notifications, not forged browser success. Add the module/view/host API and runnable bench with one named
  home banner unfurl, anonymous quiet neighbour and procedural horn/cloth cue. Extend one meaningful scenario
  test rather than a schema snapshot suite. Demonstrate expired/recovered/duplicate/private-extra input rejection,
  source reset and cleanup. Ask main for `/-/twitch-moments` route, never edit its router. R1–R3, R11–R12.

- accepted: **TM02 — Support arrives at the right door with truthful names** · evidence: sub/gift sequence contact sheet.
  Complete the real sub/gift notice/badge normalizers, canonical source selection, transactional entitlement/
  wrapping updates and group correlation. Complete all tiers/month ribbons, quiet lapses/rejoins and constant
  warm-core tint; build single parcels, gift
  cart/ward waves, anonymous/pay-it-forward seals and stable group coalescing with partial disclosed recipients.
  Do not allocate a home, grant an entitlement or create a giver counter. Frame the actual supplied home and
  demonstrate cloth/parcel anticipation/action/settle at desktop/phone and stream distance. R2–R4, R11–R12.

- deferred: **TM03 — Cheers fill the sky and the earned train brings its dragon** · evidence: ladder/train/battle shots.
  Implement the real Bits/Hype normalizers and read recovery plus every cheer threshold and mapped Power-up using approved-effect lookup with exact revision/origin;
  author train/carriages/bunting and all supplied dragon forms, telegraphs, retreat/victory presentation. Add
  world strike/haul/fireworks-chant command adapters on the authoritative port; the Wyrm Bell shares the same
  battle. Show unavailable battle honestly, never local damage/victory or paid-only rewards. Inspect each
  sequence, both scales, anonymous credit and interruption sound tails. R5–R6, R11–R12.

- deferred: **TM04 — Real support consumers and action executors run through authenticated ports** · evidence: one integrated scenario.
  Finish `apps/herald/src/twitch-moments/**`: exact authorized subscription plan, provider payload parsers,
  private PersonId/home mapping, all matrix normalizers, dedupe/reordering, record-backed current projection/feed
  and bounded honest reconciliation. Implement `apps/api/src/twitch-moments/**` application/HTTP handlers and
  actual Helix method/path/body/status transformations for every non-raid action, owned reward pack/redemption,
  authenticated principal/preview checks, crier standing-permission/budget policy, redemption resolution,
  record-backed dispatch idempotency and unknown/reconcile/crash recovery.
  A 200 unsent chat is rejected; ambiguous mutation is never blindly resent. Main binds grants/root auth/router/
  transports/core, not mapper/executor logic. Existing H01–H05/auth files stay read-only. Extend the same useful
  scenario test from source notification through real normalizer/application and public output, including
  concurrent duplicate submit, crash after dispatch and revoke before reconcile. R1–R2, R7, R10–R12.

- deferred: **TM05 — Every other Twitch cause has a place and every write has an honest result** · evidence: matrix + actions.
  Complete goals, redemptions, decree/prediction board, shared-session bridge dressing, shoutouts/signposts,
  ad/category/title, office ceremony, charity well and existing-clip still/link adapters. Implement exact public
  previews and the real backend client adapter for every action kind; own-account walker chat,
  prediction refund and unknown-after-dispatch paths are mandatory. Gate affordance delegates Spec 23 without a
  second writer. Test accepted versus witnessed, revocation and double press with the same controller. R7, R10.

- deferred: **TM06 — A raid of three is a night to remember, and the camera always gives control back** · evidence: caravan + director.
  Render incoming `AtlasRaid` as bounded logarithmic wagons/source pennant, real observed chain banners when
  supplied and approved tribute when available, with no invented riders or roads. Implement director priorities,
  actual camera leases, safe areas, stage/window/strip compositions, Calm/Show/Busy, five-second auto-open cancel,
  ad wide and labelled approximately 20-second earlier reconstruction. Twitch moments never wait for Busy;
  player/build/Forge takeover cancels and restores safely. R8–R9, R11–R12.

- deferred: **TM07 — Prove the whole surface matrix under bursts, gaps and interruption** · evidence: complete acceptance.
  Finish scenario test and locked capture runner; inspect desktop/phone, 1080p/720p stage, corner and strip plus
  action unavailable/unknown and five/nine-person versus capital-shaped bursts. Check bounded pools/queues,
  hidden disposal, context loss/remount, epoch/source reset and no stale replay or private export/log fields.
  Listen to sound and inspect timed motion sheets. Provide precise production integration example and unresolved
  main binding needs; the lane supplies the real source/executor implementation, while main binds existing
  auth/grants/transports/records/scene and runs final `pnpm verify` before shipping. Record
  screenshot paths, visual doubts and real-GPU/OBS request. All rules and every matrix row.


## Backlog

Worker discoveries with evidence go here. They do not authorize new Twitch grants/writes, a second producer,
shared-contract changes, road/passport work, a parallel renderer or expansion into other lanes.
