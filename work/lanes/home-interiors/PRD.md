# Lane home-interiors

Spec: `work/specs/31-home-interiors.md` · Branch: `lane/home-interiors`
Scope: `packages/content/src/home-interiors/**`, `apps/web/src/home-interiors/**`, this PRD/progress and spec 31.
Ownership: `work/lanes/kingdom-look-owners.md` governs. Renderer/voxel core, canonical shells, materials, shared
contracts, citizens and emitters are read-only. Integrator alone edits kingdom scene/root composition.
Worker: `gpt-6.1-terra`, high effort; hearth/window-seat hero composition may use xhigh as AGENTS permits.
Read `$ralph-lane`, `$voxel-content`, `$look` and the vision before starting.

You are not alone; preserve other workers' changes. If sub-agents help, state model/effort, assign disjoint owned
subfolders, review each result, and never let them run git. Lane worker commits only its lane, never pushes or
merges to main. Team integrator integrates reviewed branches into `lane/integrator`; main judges the candidate
Tobias announces ready.

A task is done when applicable typecheck/lint/scoped Vitest/build checks are green, its named visual evidence is
captured under the capture lock and opened with `view_image`, the box is ticked, one evidence/needs line is appended
to progress, and one coherent commit is on the lane. Use meaningful occupancy/path/source traces instead of a
separate test for each decoration. Final acceptance runs the spec commands and selected looked-at set.

The isolated presentation lane is complete on its actual furnishing/runtime/painted outputs and labelled bench.
It does not claim authoritative home-life records, owner identity, entry or player poses, which realm supplies.
Actual PeopleLight implementation and glass are producer dependencies for named consumer tasks: no copied helper,
private transparent shell, fake readiness or hidden stand-in. Write `needs:` and work on independent content if a
producer is absent. After HI01, HI02 owns family-furniture modules, HI04 owns life-decoration/wear modules and HI03 owns the web runtime/treatment. These can run in parallel with disjoint modules; one lead owns fitter/barrel/bench and PRD/progress. HI02/HI04 can proceed after HI01; HI03 waits for kingdom-light KL01; HI05 follows HI02; HI06
follows completed presentation and the actual glass producer. Never remove the SIMULATED label to improve a shot.

## Tasks

- [ ] **HI01 — A real Hearth cottage with room to live.**
  Build the occupancy fitter, `furnishHome` and `composeFurnishedHome` against the actual shell size, ordered boxes,
  doorway, first presence window and chimney. Furnish all fifteen Hearth shells with supported hearth/kettle,
  window seat, coloured quilt bed nook, shelf and optional basket. Respect 1.5 m figures, 6-cell routes and
  14-cell headroom, and report impossible pieces rather than carving a room into a valid-but-unusable edit.
  Build the labelled bench/capture script with actual worker/material/light readiness and a clearly simulated
  standing scale figure. No claimed seated action or real owner. Preserve shell/fingerprint/windows.
  **Check:** one shared occupancy/path validator across all fifteen shells checks exterior preservation, support,
  approach clearance, unchanged window order and complete-content shell key rejection.
  **Evidence:** Emberfold cottage `door` dusk at 1440×900 and 390×844, captured through the production pipeline.

- [ ] **HI02 — Salt, slate, moss and honey feel like different hands.**
  Furnish Tide with ship-timber mantel, shuttered box bed, sea chest, brass lantern and sea holly. Furnish Grove
  with dark-stone inglenook, bark beam, herbs, jars, green cushion and hollow-log basket. Read Grove's variable
  core size and floor; align its internal supported flue beneath the existing roof stack, or report the exact
  shell/blocked connection rather than inventing an exterior chimney. Keep the same five essentials priority.
  **Check:** extend the actual shell/path validator to all thirty Tide/Grove shells, including real hearth/flue
  alignment and honest omissions. Do not count a roof-only chimney as a proven room connection.
  **Evidence:** three-family `hearth` dusk comparison, plus Tide/Grove door contact sheets.

- [ ] **HI03 — The room warms into paint when its owner is present.**
  Import the accepted `createPeopleLight` implementation and main-owned types; build `createHomeInterior` for
  explicit presence/arrival/stoke inputs, analytic fire/embers/flames/steam, sources and optional companion.
  Do not import Forge's anvil runtime as if it were a generic kettle emitter. Author bounded owned steam with
  the existing analytic pattern. The explicit stray body breathes, lifts its head, perks ears and greets on the
  supplied arrival time, then settles; no pet is granted by default and no NPC conversation or fake visitor fills
  the room. Clear authority/history correctly and release only owned resources.
  Deliver the reusable painted room treatment, using the production voxel material and threshold zone: soft ink,
  brush shading, candle/hearth colour on faces/walls and restrained colour bleed. Coordinate any missing shared
  renderer hook with main; never mark a plain-lit or bench-only alternate shader finished. Runtime motion seeks
  analytically; PeopleLight exact replay follows its documented trace/clear semantics.
  **Check:** one forward/reverse presentation trace checks fire/pet transforms, absence/authority source clearing,
  explicit pet selection, actual preparation failures and disposal ownership.
  **Evidence:** hearth at night, present with explicit simulated pet mid-greeting and absent banked embers;
  threshold comparison proving painted treatment blends into the same real exterior. Named glass evidence waits
  for the actual kingdom-light producer.

- [ ] **HI04 — A shelf remembers witnessed things and a floor remembers years.**
  Consume explicit tenure, colours and keepsake presentation input. Draw newest-first keepsake tokens by kind
  with restrained tags; keep overflow IDs in the chest without loss. Never generate a fake real award/story or
  infer tenure from a slot/name. Continuous monotone wear saturates over four years: boards by the door, path
  to hearth, rugs/shelves/indoor ivy. First-night and old homes are equally cared for, with no paid progression.
  **Check:** one deterministic dataset verifies monotone wear and lossless keepsake allocation across capacities.
  **Evidence:** 0/30/365/1460-day strip and phone shelf close-up, all visibly SIMULATED.

- [ ] **HI05 — Lofts and second rooms fit the actual home.**
  Add supported beams, loft decks/accessible ladder only where real headroom allows, and secondary bed chambers
  for manor/hall rooms where the shell provides them. A second hearth needs its real stack. Reachability applies
  to every anchor and both ladder ends. All forty-five shells furnish the essentials or give precise `dropped`
  reasons. Fit at least one valid build-edited shell and one valid shell whose air cannot hold an essential;
  neither may be silently replaced with a canonical stock home.
  **Check:** use the occupancy/path validator, including view eyes in real air, anchor approaches and unsupported
  edit omissions. Record worst-case boxes/meshed triangles/draw costs from actual outputs.
  **Evidence:** house `loft` view where supported and one representative family/tier furnishing sheet; all 45 shells run the fitter regression test.

- [ ] **HI06 — Look through the window and deliver the room honestly.**
  Finish `zone`, `views`, anchors, painted treatment and exact imports/calls/update/source-transform/disposal
  recipe for integrator/realm. Capture the selected final spec set at desktop/phone, including reciprocal noon window-seat/
  street views through the actual accepted glass. Preserve exterior occupied cells and canonical shell identity;
  paired street shots intentionally show furnishing through existing doors/glass, not fictional pixel identity.
  Fix clutter/value/saturation against the best genre work; do not use the old bench as the ceiling. Show a seat
  unoccupied if no accepted seated pose exists and document that realm integration seam plainly.
  README records coordinate transforms, input provenance, readiness, producer commits, fitting omissions,
  resource/mesh cost, source/pet clear behavior, treatment sharing and real-GPU doubts. Main/realm records and
  walking are not claimed shipped by this presentation lane. Integrator candidate later proves live mounting.
  **Evidence:** window-seat dusk at both sizes, noon transmission pairs, final looked-at set and exterior comparison.

## Backlog

The worker adds ideas here and never picks from them.
