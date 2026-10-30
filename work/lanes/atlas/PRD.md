# Lane atlas

Spec: `work/specs/01-atlas.md` · Branch: `lane/atlas` · Worker: Codex Sol, high; Terra high for visual subwork.
Status: **ready 2026-10-30**. Spec and first-consumer interchange frozen; later producer seams require main’s freeze when reached.

Scope: `apps/web/src/atlas/**`, `apps/surveyor/**`, this PRD, `progress.txt`, the Atlas spec and
`work/references/atlas-cartography.md`. Everything else is read-only. You are not alone in the codebase: preserve
other people's changes, coordinate integration, and never edit `packages/shared`, root scripts/manifests/config,
web routing/global CSS or the existing Surveyor/prototypes. Main owns worktree setup and integration; the lane
worker commits each green task on its lane branch, and sub-agents never run git. Use `$ralph-lane`,
`$chatdom-vision`, `$look` and the referenced research note.

Every task is done when `pnpm verify` is green; its meaningful tests and real-data evidence pass; all changed
visible states have screenshots taken by the repo shot script or matching Atlas-local Playwright suite and opened
with `view_image`; the box is ticked; one evidence/needs line is appended to `progress.txt`; and the lane worker
records one coherent lane commit. Do not claim the task done if a required real integration is only simulated.
First visible result is A02. Work in order, one task at a time; if blocked by a main-owned contract, write `needs:`
and take an unblocked part/task. Never pick from Backlog without main instruction. No placeholder or fake success.

## Tasks

- [ ] **A01 — Real observations become a reproducible Atlas revision** · evidence: test + log.
  Implement `@chatdom/surveyor` read-only HTTP/source-snapshot adapters, strict shared validation, durable normalized
  raid observations/checkpoints, recorder decoding and coherent provenance/coverage. The existing shared
  first-consumer boundary must be reviewed/frozen; later pulse/auth/travel/season seams freeze with their consumers
  and do not block this task. Add owned `atlas:import`,
  `atlas:check`, `atlas:serve` scripts exactly as the spec accepts; serve `/map-data` on local port 5193. Produce an
  immutable labelled survey preview from actual channels/category minutes/raid observations; implement reviewed
  taxonomy proposal, deterministic language/family land, waiting slots, settled ledger, content-addressed manifest
  and corruption/invariant guards. Official edition founding rejects short observation windows, missing review or
  authorization; source DB and running collector are never written. Include real import/check evidence, source
  freshness, atomic failure recovery and same-input/same-revision checks. Spec R1–R5, R10–R11, R16, R21.

- [ ] **A02 — The real map can be explored on laptop and phone** · evidence: shot + flow test.
  Export default Solid `Atlas` from `apps/web/src/atlas/index.tsx`, with exactly one `[data-chatdom-atlas]` root.
  Build the PixiJS 8/WebGL2 explorer map from A01: ink/watercolour coasts, reviewed licensed stamps, paper,
  heraldry, compass/sea monster, pencil/ink states and honest survey-preview legend. Add float64 anchored
  pan/wheel/pinch/inertia, interruptible flights, four zoom distances, tiered labels, culling/collision, tiles with
  ancestor fallback, seam-free fades and bounded cache. Render actual live classes/dabs with paint and pennants;
  show source as-of/coverage and designed first-load/error/offline/no-WebGL states. Provide real channel
  selection, Unicode search, truthful public card and working Watch link now, through Atlas-owned validated
  adapters (no unapproved global protocol). Main owns route/proxy/package integration. Set ready only after a
  meaningful coherent frame. Run `pnpm shots --area atlas`; open 1440×900 and 390×844 images, check selected
  result remains visible above phone sheet and no foundation bench can satisfy the assertion. Spec R6–R11, R17.

- [ ] **A03 — Real raids leave roads and a night can be replayed** · evidence: shot + test + log.
  Reconcile shared live/dab manifests and real SSE, persist cursor/dedupe/restart state and hold coherent dated
  state on a gap rather than inventing life. A partial sweep cannot zero missing live channels, publish an unknown
  class as offline, or refresh older bytes' observation time; retain the previous complete frame and its original
  as-of, expose the partial gap separately, and test this behavior. Draw actual caravans, first/thickened/faded roads, sea lanes and
  selected-road stories; distinguish pair aggregates from new events and recovered history from live animation.
  Derive real raid trains/branches and permanent factual line records; ingest the founded bridges/embassies/
  signposts/path/trade projections only through approved public facts, with ≥20 bands where derived from people.
  Add real recorder history scrubber, seek/speed/date/gap labels and isolated replay transport. Demonstrate
  desktop+phone live/stale/road/replay states, duplicate/reordered/restart reconciliation, old-road retention,
  no synthetic event/identity filling and binary alignment failure. Missing advanced producers become explicit
  needs, not fake events. Spec R11–R14, R21–R22.

- [ ] **A04 — People discover good neighbours and a kingdom's public story** · evidence: shot + flow test.
  Finish mapped/waiting/founded cards, approved drawing/hero descriptor consumption with valid stamp fallback,
  real founding metadata/roads/crowns/embassies/aggregate bands, share/tell and authorized settler actions. Add
  small-neighbour road discovery, notices from genuine quality/life facts, common-bracket season board, permanent
  crowns/citations and factual crowning presentation. Add all `/map/*` deep-link parsers/view restoration and
  server-rendered share/still assets; main wires root routes/metadata/endpoints. Enforce hiding/deletion/name
  moderation/content-label policy and daily raw-content expiry in every search/card/share/projection. Unknown
  labels/quality facts have an explicit truthful state, never fabricated ratings or winners. Declare minimal
  producer seams to main before integration; don't edit shared or infer approval for collector expansion.
  Prove no money/spectacle input can alter discovery and public exports contain no person data. Spec R13–R17, R22.

- [ ] **A05 — Go home, visit and march through the actual entry coordinator** · evidence: integration test + shot.
  With main-frozen identity/auth/entry/travel/action seams, build the current-viewer homes/realm/tent ribbon,
  consented friend pins and ephemeral My Twitch overlay. Prove three-home cap plus castle, no foreign royal
  authority, consent revocation and no follows/private overlays in public caches. Implement wax-seal response,
  saved auth resume, hero-drawing loading scene with true progress/raven, matched two-canvas ready reveal,
  role-correct destination and reversible M/Back return with world-retention coordination. Implement road ride,
  raid-arrival links and monarch-only Raid Gate finder/preview/confirmed/cancel/unknown states through main's
  actual authorities. No direct Twitch writes or invented travel/passport success. A SIMULATED integration
  fixture tests unavailable states but cannot close this task until real producer evidence exists. Spec R18–R20.

- [ ] **A06 — The whole Atlas holds up in motion, on stream and after failure** · evidence: shot + test + cost log.
  Complete the shared Atlas/director presentation for raid in/out, tonight's roads and season crowning; preload
  it and omit private state/tiny counts. Finish material-specific varied sounds and crafted motion across input,
  cards, paper, seal, pennant, road and notices. Exercise every loading/empty/stale/refused/denied/offline/context
  loss/WebGL-free state, hostile Unicode/long names, 5-viewer and 50,000-viewer cases, delayed tiles, malformed
  feeds, replay gaps, import failure and reconnect without false success. Inspect 1440×900, 390×844,
  1920×1080 and 1280×720 evidence plus a motion/audio review. Measure public bundle isolation, request/culling/
  cache/transfer budgets and no Twitch/realm calls from browsing; run all acceptance commands and produce an
  honest remaining real-GPU/phone/OBS timing report. Confirm immutable full-level Edition I tooling and
  long-tail land-by-raid behavior exist without founding/publishing an official edition. Close all producer
  dependencies or leave the lane explicitly incomplete with needs. All spec rules and quality acceptance apply.

## Backlog

Worker discoveries go here with the rule/problem and evidence. These are not authorization to widen scope or skip
any task above. There are no invented future features to implement from this list.
