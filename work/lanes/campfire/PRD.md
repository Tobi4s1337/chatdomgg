# Lane campfire

Spec: `work/specs/21-campfire.md` · Branch: `lane/campfire`
Scope: `packages/games/src/dusk-court/**`, `apps/web/src/campfire/**`,
`apps/realm/src/campfire/**`, `apps/api/src/campfire/**`
Worker: **gpt-6.1-sol, high effort** for the authored family and integration,
**xhigh** for CF03/04 session/voice race correctness; use
**gpt-6.1-terra, high effort** for disjoint scene/pose/visual tasks and **medium** for focused checks.

Read `AGENTS.md`, `$ralph-lane`, `$chatdom-vision`, `$look`, the spec's Decisions first, then its complete body,
and the coordinated spec 22. You are not alone. Keep the owned subtrees disjoint from tavern's engine and
all other lanes; preserve their changes. Campfire owns its actual session/seat/private-view application handlers,
domain persistence semantics, browser SDK adapter and LiveKit permission supervisor. Main owns shared, route
registration, SDK pins/dependencies, trusted principal/storage/LiveKit infrastructure bindings, world ledger and
the final kingdom/stream/panel mount. Never fill a missing
service with a success-shaped stub or create a second game reducer. Local typed ports are this handoff's
boundary; prospective engine names are documented honestly and must be tested against the real engine.

Main registers `/-/campfire` before the branch's first visual run. CF01 creates a labelled SIMULATED injected
session for early scene work; it proves presentation, not authenticated play. Real mode stays unavailable
until the lane's real handlers are bound to main's trusted infrastructure. Record exact `needs:` and continue independent parts of the
current task; do not loosen privacy or check a box for a blocked outcome. Tasks remain in order.

Every task is done when `pnpm typecheck`, `pnpm lint`,
`pnpm exec vitest run packages/games/src/dusk-court apps/web/src/campfire apps/realm/src/campfire apps/api/src/campfire`,
and `pnpm build` pass; its focused
screenshots are taken/opened with `view_image` where the task is visual; the box is ticked; one progress line
states decisions, evidence and unresolved `needs:`; and the coherent change is committed on the lane branch.
Use `$ralph-lane` for commits; sub-agents never run git. Do not push. Main runs `pnpm verify` and integration.
Use the shared capture queue and existing/assigned server; never cancel another lane's capture or server.

## Current handoff — 2026-10-31

This handoff supersedes earlier task order, parking and per-task verification instructions in this PRD; scope and safety boundaries still apply.

CF01 merged; CF02 is lane work and has not been accepted by main. Stream view is the stage; chat is the controller and events are the physics. One worker per lane by default. Work one current task at a time; lanes can proceed in parallel where their owned scopes and dependencies are independent. Each lane implements feature-local durable adapters and runtime behavior against existing ports; main owns shared contracts and cross-surface authority and integration bindings. Record a precise `needs:` and continue independent work when a seam is unavailable. Targeted checks for each step: typecheck, affected tests and one viewed stream-first 1920×1080 capture per visual change; main runs wider milestone checks. Existing accepted work and historical evidence remain intact.

## Tasks

- [x] **CF01 — Gather beside the Wilds** · Merged clearing and SIMULATED bench; retain known nameplate/fire readability follow-up.
- [ ] **CF06 — Make the gathering readable on stream** · Improve crowded nameplates and fire visibility in the accepted clearing, with streamer clearly leading; inspect one stream-first 1920×1080 capture. Fixtures are visibly SIMULATED.
- [ ] **CF07 — Chat votes around the fire** · Build a lighter Dusk Court round with clear prompt, bounded voting and result through approved existing ports. Enforce one person one vote using authoritative identity, preserve streamer leadership and keep private information private. Test duplicates and late votes; label simulated rounds.
- [ ] **CF08 — Show the round through the real room** · Consume main-provided room, chat and vote bindings, with honest unavailable and reconnect states; inspect a stream capture and test interrupted rounds. Record the missing identity/authority seams as `needs:`; do not claim real votes from fixtures.

## Previous task breakdown (history; not the current queue)

- accepted: **CF01 — Put the gathering beside the Wilds.** Export the default Solid surface and public-only stream
  entry, versioned local ports/strict decoders, and a deterministic injected SIMULATED session. Build a grounded
  night clearing, fire, logs, game lanterns and kingdom/Wilds horizon with shared palette/materials; mount
  actual authored avatar parts in 6-seat and 12-seat arrangements. Show waiting/text-only/closed states and
  a small clear explanation of Dusk Court. Add the scoped capture entry. Look at desktop/phone circle and
  public stream shots immediately; no engine or mic is needed to demonstrate this place.
  · evidence: `circle` desktop/phone + `stream` 1080/720, decoded public fixture and clean code checks
- deferred: **CF02 — Author the whole Dusk Court family.** Author all five roles, 5–11-player distributions,
  both timing presets, simultaneous night choice/protection/attack/inspection, equal ballots/runoff, Fool and
  faction outcomes, eight-day draw and interrupted result as a Chalk manifest. Export rules/settings/trace
  corpus through the owned subtree. Check the agreed manifest schema, settings coverage and declared
  information/reveal boundaries. Consume spec 22's actual engine/Taster as soon as available, without a second
  reducer; until then use the typed injected game port for handler/scene work and record the exact engine
  `needs:`. Author the hostile/expiry/two-world trace corpus now; actual interpreter completion/taint/fairness
  reports remain a mandatory CF05 gate, never marked passed by an injected fixture.
  · evidence: complete manifest/settings/trace corpus, actual Taster reports or explicit CF05 engine dependency
- deferred: **CF03 — Give every person their right seat and private hand.** Implement the actual realm host and API
  application handlers through injected principal/storage/clock/delivery ports: offers/declines, equal lottery,
  seat generations/leases, match lifecycle, private-view owner checks, moves/receipts, persisted deadlines,
  rehydration and result outbox. Bind the web hand through `CampfireSessionPort`; make text seats fully playable.
  Aggregate authenticated Gallery `!sus` at the host, keeping voter records outside Chalk. Run the spec's
  six-seat secret scenario against the real handlers and local durable harness, including retry/wrong-owner
  and mid-night restore. Run the 50,000-voter dedupe/output check once. Separate public/self import graphs and
  disposal; no private card reaches stream or public recorder. Main binds routes/infrastructure.
  · evidence: runnable durable handler scenario, privacy trace + one private fixture phone shot
- deferred: **CF04 — Let invited voices speak and stop safely.** Implement the replaceable browser voice adapter
  against main's installed SDK/infrastructure ports, and actual server grant/join/control handlers and independent
  permission supervisor. Derive/reconcile permissions, cutoff/rejoin validation and authority-lease expiry;
  implement consent and eligibility states, PTT/blur/cancel/visibility
  release, desktop mutual open-mic choice, public seat spatial mix/limiter, text alternative and monarch-track
  exclusion. Bind death/night/moderation/unseat/offline/absent-monarch permission transitions and immediate
  local silence, with honest enforcement/reconnect status. Extend the same six-seat scenario with a removed
  speaker and malicious republish/stale-token/rejoin against the actual supervisor through injected ports.
  Repeat that voice segment against configured LiveKit when available; log no audio. Domain handlers remain
  runnable now; record a concrete infrastructure `needs:` rather than pass fake transport as real revocation.
  · evidence: supervisor/PTT scenario, real LiveKit revocation when configured, consenting mix check
- deferred: **CF05 — Make the fire feel like a night worth remembering.** Finish weighted sit/stand, grounded feet,
  face/head listening and level-driven mouth motion using the common avatar rig; varied quiet fire/wood/brass
  cues through the injected shared bus; checked public narration/captions, camera suggestions and truthful
  still/result callbacks. Complete denied/empty/reconnecting/stale/interrupted/ended states, responsive
  controls, corner/strip framing and cleanup. Play a complete integrated game with real authenticated people,
  a Gallery chat vote and moderator mic removal; look at the spec's small final image set, listen/watch the focused
  tour. Complete the actual engine/Taster full settings and privacy/termination/fairness reports if unavailable
  at CF02; fix findings rather than inherit a fixture pass. Record source/retention limits, missing main
  integration and exact real-GPU checks. No fixture-only
  success closes this task.
  · evidence: full-game public result + final shots/sound/motion + no-secret/no-voice recording proof


## Backlog

Ideas found while building go here; do not pick them without main's direction.
