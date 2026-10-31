# Lane kingdom-light

Spec: `work/specs/26-kingdom-light.md` · Branch: `lane/kingdom-light`
Ownership: `work/lanes/kingdom-look-owners.md` governs; spec Scope enumerates the render, glass-semantic,
castle-content and owned `lights/**` files. `scene.ts`, `index.tsx`, shared types and other lane folders are read-only.
Worker: `gpt-6.1-terra`, high effort for judged visual work; main reviews core glass semantics.
Read `$ralph-lane`, `$look`, `$voxel-content` and the vision before starting.

You are not alone in the codebase. Preserve others' changes. No sub-agent runs git; lane worker commits only its
lane, never pushes. Team integrator alone composes scene/root code and integrates reviewed branches into
`lane/integrator`; main judges only the candidate Tobias announces ready. Never merge into main yourself.

Main freezes actual cross-lane PeopleLight types in `apps/web/src/kingdom/lights/types.ts` and land types in
`@chatdom/world`. Import them; never recreate them privately. Producer commits and the integrator's real adapters
must exist before their consumer evidence is marked complete. No local runtime stand-ins or fake flags.

A task is done when its applicable checks pass, its named visible evidence is captured under the machine-wide
capture lock and opened with `view_image`, the box is ticked, an evidence/needs line is appended to progress and
one coherent commit is on this lane. KL01 has meaningful deterministic tests instead of a cosmetic screenshot.
Run `pnpm typecheck`, `pnpm lint`, relevant scoped Vitest and `pnpm build` for coherent steps; the selected final spec set and
candidate `pnpm verify` are required at completion. Keep the code runnable while a producer/integration gate waits.

Order: KL01 is independent and first, as an early separately reviewed producer commit. KL02, KL03 and the castle
shell part of KL07 can proceed independently. KL04 owns glass end to end. KL05 follows grade/glass, KL06 waits for
actual civic/land dependencies and KL01, KL08 follows the rest. Sub-agent write sets must be disjoint; grade/pane/
glass tasks touch shared render files and cannot silently run overlapping edits.

## Tasks

- [x] **KL01 — One real people-lit helper for every place.**
  Implement `createPeopleLight` in `lights/people-light.ts` using main's actual types. No three.js, civic, land,
  scene, clock or presence-source dependency. Validate input, use caller-space positions, rise/hold/fade, bounded
  pilot/full/capacity, source reuse and `clear()`. Explicit history: same-time calls are idempotent; reverse seek
  settles at current accepted target; exact replay requires clear plus the same recorded input trace. One compact
  trace test covers crossing, partial capacity, fade, pilot, repeated time, reverse seek and authority clear.
  Commit this task alone so places-high, places-water and home-interiors can consume its accepted implementation.
  **Evidence:** trace test output, exact import/call recipe and no copied stand-ins.

- [x] **KL02 — A blue noon and an indigo dusk.**
  Author coherent sky, sun, cloud, ambient, shadow tint, hour-dependent fog and exposure. Noon is clear blue with
  white broken clouds; dusk has lilac sky, gold rims and indigo shadows; night stays cool around warm people.
  Restrain the daylight beacon to its crown. Preserve existing Environment consumers; give the integrator the
  exact exposure/fog application recipe. Build capture tooling using actual readiness and the accepted pose seam.
  **Evidence:** hero noon/dusk at 1440×900 and 390×844, with dusk greyscale. If the adapter is absent, record
  integrated captures pending; a modified bench is not evidence that the real town changed.

- [x] **KL03 — An honest evening already under way.**
  Implement `createSimulatedEvening` through the existing reducer and motion contracts. Seed past fixture stays
  so 80–90% of the labelled simulated homes are already settled; witnessed arrivals/departures continue. Explicit
  `replayArrival()` starts the dark → one named window → town wave in a new epoch. Never alter Herald frames,
  invent live occupants, force `homeLit` or suppress the SIMULATED label. Integrator selects this only for the
  simulated source and binds the existing replay control.
  **Evidence:** one reducer-backed seek/arrival/departure trace; actual town open and replay at 0/30 s after mounting.

- [x] **KL04 — Glass passes sight and light without losing its frame.**
  Implement the complete approved glass path in the spec's narrow files: glass material flags distinct from
  collision solidity, visible interior-facing surfaces, appropriate voxel rendering, presence panes that allow
  sight, sun-shadow transmission and ordered light-field blockers. Reuse existing material flags and formats;
  ask main before a new protocol or packing change. Keep opaque walls occluding and glass collision solid.
  Never remove a wall, draw a second fake transparent shell or disable shadows to make a flattering bench.
  **Evidence:** reciprocal inside/outside noon and dusk views through a real window, including a sunlit floor,
  warm field passing glass, an adjacent wall that still blocks and a lit pane that still reads from the street.
  A compact wall/glass/carve test covers actual sky/mesher/field/shadow semantics affected by the change.

- [x] **KL05 — Windows and faces carry soft warm pools.**
  Keep one citizen/one presence window, the 0.7 s fade, disclosure, dither and sources. Make the pane brightest
  low/centre and amber at edges, with dark mullions, source-sized halo and cool sky reflection while absent.
  Replace the squared warm falloff with a capped soft knee readable 3–5 m onto the wall and street. Faces and
  cloth visibly warm without white clipping or a diamond pool. Capture street and citizen poses through the real
  integrator seam, never rewrite first-look cameras. Report flood-shape needs beyond approved glass changes.
  **Evidence:** window/citizen dusk desktop; street dusk/night at both sizes; hero night.

- [ ] **KL06 — Walked streets glow behind their people.**
  Use the accepted land street/trail/site data and actual civic lantern post. Deterministically reserve clear
  verges at junctions/market/gate and spaced approaches; respect lots, places and door routes. No court lights
  or private replacement geography. Use KL01 for 7 m proximity, 0.6 s rise and 30 s fade; pilots only at market/gate
  while fresh live state permits. Filter absent/stale/departure samples before counting. Emit into the existing
  local and kingdom fields, with exact mount/update/source/dispose instructions for the integrator.
  **Evidence:** street with a walker and dark empty lane, hero night route glow, placement trace and measured costs.

- [ ] **KL07 — The live castle wakes, even for a hamlet.**
  First complete and separately expose the keep stair-envelope cut and removal of its two small banners, before
  places-high mounts. Then author real recessed slits and two/three hall windows between accepted banner drops,
  gate arch lamp and transformed anchors, preserving module dimensions/silhouette. All banners/parapets remain
  places-high's. Sequence from gate to keep over about 4 s after fresh live state; use sequence progress for hall
  warmth, modulated by beacon, rather than waiting for a 0.9 audience threshold. Stale/resting state clears warmth.
  Civic castle light claims no extra citizen/window name. Supply castle sources for the existing beacon volume.
  **Evidence:** castle noon/dusk at both sizes, hero night and hamlet live sequence; actual opening/anchor checks.

- [ ] **KL08 — Judge the whole town and deliver an exact integration recipe.**
  Run the selected final spec evidence and look at every desktop/phone frame and thumbnail; fix weak values,
  saturation, glass readability, source halos and pools against the best genre work, not old prototype benches.
  Record draw calls, triangles, field bytes/worker diagnostics with and without lamps, source provenance, and
  explicit real-GPU questions. README includes exact imports, construction, per-frame update order, source
  aggregation for all three fields, clear/disposal, castle shell handoff and producer commit dependencies. No
  pseudo imports, local helper stand-ins or absent hooks described as installed. Review standard affected benches
  on the integrator candidate. Unmounted features remain integration limitations, not fake passed screenshots.
  **Evidence:** full looked-at set, scoped commands, exact adapter recipe and remaining doubts.

## Backlog

The worker adds ideas here and never picks from them.
