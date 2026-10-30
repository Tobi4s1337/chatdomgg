# Lane forge-pieces

Spec: `work/specs/09-forge-pieces.md` · Branch: `lane/forge-pieces` · Scope: `packages/content/src/forge/**`, `apps/web/src/forge-bench/**`
plus this lane's spec/PRD/progress · Worker: **Codex `gpt-6.1-sol`, high** (explicit group choice).

Read the spec's Decisions first, then the whole spec, `packages/content/README.md`, and the named vision sections.
Follow `$ralph-lane`, `$voxel-content` and `$look`. Main implements the approved shared sidecar and wires the
production collection/review-route hook before lane start. The worker owns its small review adapter/capture
under `forge-bench/**`, using existing production modules. Everything else is read-only. You are not alone;
preserve others' work. The worker owns its lane commits; sub-agents never run git. Never push or touch main.

Every task is done when `pnpm typecheck`, `pnpm lint`, `pnpm exec vitest run packages/content/src/forge apps/web/src/forge-bench`,
`pnpm build`, and the applicable collection validation are green; changed content's production screenshots are
taken and opened with `view_image`; the task box is ticked, one line with decisions/doubts/evidence is appended
to `progress.txt`, and one coherent commit is on the lane branch. Intermediate collections use `--partial` and
contain only finished assets. Final acceptance uses the full commands in spec 09. Do not repeat unrelated
checks or add tests that mirror declared constants. Missing main-owned contracts/tooling are `needs:`; continue
independent content work. Keep discoveries in Backlog without picking them up.

## Tasks

- [ ] **FP01 — A first Hearth cottage made from real parts** · Author the floor, wall, corner, open door frame
  and separate hinged leaf, window, roof slope/ridge/gable/verge. Export finished definitions/blueprints and
  assemble a supported, enclosed small shell with clear entry and correct glass anchors. Demonstrate the finite
  connector profiles with a focused real-occupancy join check and invalid input rejection. Build the scoped
  `/-/forge` Solid adapter and `capture.mjs` using production worker/material/light and existing capture helpers;
  expose readiness and measured state so captures cannot silently show a stale fixture. Capture the production
  three-angle component sheet and shell at desktop/phone sizes immediately; inspect threshold and roof closures.
  Do not spend this task on an empty catalog or a private rendering engine. · evidence: test + partial validation + looked-at sheet/shell
- [ ] **FP02 — Hearth has a cared-for doorstep and crooked chimney** · Finish Hearth shutters, porch deck/post/
  canopy, chimney and trim. Complete its fifteen-form fixture with clear entrance, shutter/window clearance,
  supported canopy and finished roof contact. Record profiles, finite geometry choices, budgets and hinge/clearance
  conventions in the owned README. Capture the changed pieces and finished cottage; fix weak seams or silhouette.
  · evidence: test + partial validation + looked-at Hearth sheet/cottage
- [ ] **FP03 — Tide is an architectural family of its own** · Author all fifteen Tidewake forms and its leaf,
  with swept slate roof, braced timber, ledged windows and wind-shaped chimney. Build the same useful room/porch
  from Tide definitions; match its own profiles and common measures without recoloring Hearth geometry. Review
  the contact sheet and assembly in greyscale/thumbnail judgment as well as color. · evidence: test + partial validation + looked-at Tide sheet/cottage
- [ ] **FP04 — Grove has soft shoulders and strong roots** · Author all fifteen Grovebough forms and its leaf,
  with substantial thatch, rounded openings and bark/dark-stone support. Assemble its complete cottage, leaving
  real window and door clearances. Complete the collection in the exact family/form order, with no unresolved
  fallback or missing end piece. · evidence: test + full validation + looked-at Grove sheet/cottage
- [ ] **FP05 — The complete families fit and hold up to the eye** · Finish one parameterized assembly test over
  all three fixtures: real transformed mating cells, grounded assembled support, roof closure, threshold route,
  window rectangles, leaf open/closed occupancy/swing reservation and hut active-depth
  bounds. Do not build an exhaustive combination harness. Run full acceptance once. Inspect all three family
  sheets, desktop/phone/stream assemblies, noon/night assembly comparisons, door detail pairs and one labelled
  SIMULATED window off/on pair per family. Polish defects, report rejected designs, actual costs, screenshot paths
  and remaining doubts, then write `LANE COMPLETE`. · evidence: focused test + full validation/checks + looked-at final sheets/details

## Backlog

Ideas discovered while working go here. They are not authorization to expand this lane.
