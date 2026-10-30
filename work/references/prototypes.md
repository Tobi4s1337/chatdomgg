# Reference: the earlier Chatdom prototypes

Studied 2026-10-30, read-only at `/root/chatdomgg/prototyping/kingdoms/`. These are local design references,
not an imported codebase. Luna scouts inspected source; main reviewed representative store, Forge, map-camera
and mesher code. No prototype code was executed, copied, modified or committed here. No git revision was captured.
This is an orientation note, not a replacement for `$study-reference` before implementation specs.

## Lanternmere — `f-lanternmere`

- `src/systems/store.ts:46`: FIFO event → reducer → effects, injected clock and scheduled follow-up events.
  Take the explicit seam; reimplement it around authoritative durable facts, not tab-owned state.
- `src/systems/reducer.ts`: beats, story/feed updates and presence reactions show the useful shape. Reject its
  single `ME_ID`, legacy reward assumptions and identity mixing; use Person/Citizen/Kingdom/Local state.
- `src/systems/director.ts:79`: focused beat queue, priorities, expiry and cut cooldown; study shot composition
  and interruption/return behavior. Do not carry random paths or a cinematic that can retain player control.
- `src/content/choreo/index.ts`, `boss.ts`: presentation adapter and telegraphed spectacle choreography. Keep
  choreography out of the simulation. The dragon obeys current earned-only, no-loss rules.
- `src/content/forge-grammar.ts`, `src/systems/forge/pipeline.ts:60`: plan → authored assembly → quantise/budget
  → six views → provenance is useful. Its creature bases, rarity, placeholder fallback and heuristic approval
  are incompatible with the actual Forge. `moderate.ts` is not a production safety gate.

## Building — `d-voxel-diorama`, `b-townscaper`

- D `src/editor/editor.ts`: stroke-level undo, mirror, fill, templates, preview and settling feedback. Rebuild
  as durable domain operations with shared validation; its small local volume is not a networked draft.
- D `src/editor/pick.ts`: voxel DDA with face normals and a floor fallback. Rework traversal limits for real lots.
- D `src/mesher/greedy.ts:1`, `pool.ts`: merge only matching material and four AO corners, choose diagonals to
  avoid AO artifacts, use boundary samples and worker buffers. Add chunk invalidation and stale-job rejection.
- B `src/mesher.ts:1`: cached corner-occupancy pieces with bilinear shared-edge matching; useful for authored
  architectural detail. Its constrained stacked geometry does not solve arbitrary voxel auto-detail.
- B `src/island.ts`, `editor.ts`: support/walkability constraints and triangle-to-pick metadata. Neither prototype
  supplies the complete solid occupancy and swept avatar/camera collision required here.

## Atlas — `e-atlas`, `g-atlas-live`

- E `src/view/overlay.ts`: static baked tiles plus crisp live overlay, label collision and batching.
- E `src/view/camera.ts:1`: anchored wheel zoom, inertial pan and interruptible van Wijk flight; a useful feel
  reference. Its deep town-editor zoom is superseded by Atlas.md's stop at the kingdom drawing.
- E `src/world/heraldry.ts`: deterministic shields and tincture contrast. Check charge licenses separately
  (the inspected subset is described as CC BY 3.0); never assume source-code and asset rights match.
- G `surveyor/README.md`, `src/sweep.ts`, `src/raids.ts`: collection, viewer/category-minute aggregation,
  raid observation and recorder shape. G contains the Surveyor, not a completed Cartographer or map client.
- Leave behind E's old social-force layout, fake feed, plot editor, night/glow presence, category layout and
  people graph. The current Atlas is fixed editions, language/game-family geography, day wash/pennants, real
  observed events and privacy-bounded public projections. The existing production Surveyor is an external input;
  rebuilding the adapter does not authorize altering that service.

## Further study needed

Find and inspect current open-source examples for voxel lighting/meshing, water/sky/weather, animation/crowds,
netcode, cartography and physical UI motion. Record revisions, licenses, exact techniques and visual evidence in
separate reference notes, then cite those in the relevant specs. This turn makes no external-code or asset
license claim beyond the observations above.
