# Grand adoption seam — read-only integration recon

2026-11-01. Reviewed PLAN §10, spec56, current main renderer/founded compiler, and
uncommitted source in `../worktrees/grand-kingdom` and `../worktrees/grand-kingdom-w2`.
No code changes, git changes, tests or captures performed. This is source evidence, not readiness proof.

## Recommendation

Keep `createKingdomScene` as the production renderer and insert a **hosted grand land owner** into
it. This is the smallest integration surface shared by signed-in walking and stream, retaining the
accepted homes, Forge, castle, windows, avatars, live feeds, native growth and camera handoffs.
It must include the exact graded town floor as well as the surrounding terrain; a backdrop alone
does not fulfil the requested outcome. Do not replace production with the standalone `GrandEngine`
or mount another copy of the town on top of the existing one.

Native settlement coordinates must stay unchanged. GK11 currently defines settlement + seat.offset
= land metres. For the hosted owner, translate land by **minus seat.offset**, leaving every native
placement, walking body, Forge anchor, light source and scene handoff in its existing coordinate system.
The shader's map UVs and heights must explicitly convert world coordinates back to land coordinates;
a negative Object3D offset alone is insufficient (see compatibility below).

## Exact main integration files/functions

- `apps/web/src/kingdom/scene.ts:createKingdomScene` is the central seam. Lines 97–98 already choose
  the exact `options.founded.plan`; lines 125–134 use `foundedContent` and content hashes. Preserve them.
  The existing renderer/post/atmosphere at 99–114 and grade at 441–452 remain the single owners.
- Replace the terrain preparation at 600–605 (`loadTerrain` → terrain batches) with the hosted
  grand owner's readiness promise once its exact town surface is demonstrated. Replace the old
  `createHorizonSurface`/horizon mesh at 322/385–393, and coordinate water at 394–409 with grand water
  so there is only one visible surface. Do not keep overlapping old/new terrain or sea.
- `landHeight` at 322 currently drives cover, groves and moments; use the installed physical sampler
  inside the loaded settlement and grand visual sampling outside it, with separate APIs so the far
  visual query cannot authorize walking or Forge. Existing accepted cover/groves should not be
  duplicated by procedural grand trees in that region.
- Add the owner's frame call around the existing camera/grade update and dispose it in `dispose`
  at 607. Include its initial visible coverage in existing `tasks` before `loaded=true`; surface
  errors through the same error/abort path. Its camera update cannot start another RAF or controls.
- `apps/web/src/kingdom/index.tsx` already calls this function for web; `apps/web/src/stream/mount.ts`
  calls it for stream at 172. A default founded-scene integration here reaches both. Preserve the
  stream's hidden replacement lifecycle/first-loaded-draw gate and growth-ceremony activation.
- `apps/web/src/kingdom/founded-content.ts:foundedContent` remains the exact geometry adapter.
  It preserves asset hashes, placement positions/turns and plot-to-slot joins, and excludes fitted
  attachments from additional presence windows. No replacement from a tier/config is necessary.
- `apps/web/src/kingdom-entry/live.ts` validates receipt bytes and compiles the matching collision
  before walking; `spectator.ts` validates the stream scene. Neither currently resolves a grand
  landscape identity. If physical coverage changes, extend this installation together with server
  manifest production; do not bypass the validation in either entry.

## Producer present versus missing

GK10 worktree has `GrandEngine` (`apps/web/src/grand/engine.ts`), `worker.ts`, regional LOD selection,
quad meshing, field generation, water/sky/shadow/post and bounded-result diagnostics. Its constructor
creates its own WebGLRenderer, camera, OrbitControls, AgX grade and RAF. There is no hosted terrain
owner accepting the existing production scene/camera/renderer. `generate` messages carry only
`GrandLandSeed`; `raise()` calls `generateGrandLand(seed)` without an installed settlement plan.

GK11 worktree has pure, useful source modules:

- `packages/world/src/grand/kingdom/frame.ts`: `frameSettlement`, `settlementGround`, `pavingMask`.
  Reads the exact founded compiler grid for landform v1 and chunk-aligns the region to 16 m.
- `seat.ts:seatSettlement`: translation-only half-metre seating, returned `fits`, sea matching.
- `grade.ts:gradeSettlement`: exact physical heights/water inside the region, 48 m outer blend,
  clears procedural trees, returns a separate paved mask.
- `index.ts:seatKingdomOnLand`: combines those; `ground.ts:grandKingdomLand` consumes the frozen seam.
- `apps/web/src/grand/kingdom/pieces/index.ts:foundedKingdomContent`: reads actual founded content
  and carries exact placement/hash/slot information. The separate `loadGrandKingdomContent` path
  regenerates a labelled SIMULATED Willowmere or potential channel fixture; production must use the
  former function with installed bytes, never the latter.
- `mount.ts:mountGrandKingdom`: a static model/window layer with blueprint worker LOD, not the full
  production citizen/Forge/growth integration. It is not called by GK10 engine yet.

No caller currently joins `seatKingdomOnLand`, the GK10 worker and engine, or `mountGrandKingdom`.
GK11 ground tests use a synthetic island. They do not prove full generated pipeline integration.
GK10 voxelization does not consume GK11's paved mask, and still adds `decorHeight` above ground.
`Cover.reserved` permits decoration. At coarse LOD it max-reduces a block and rounds up; this cannot
replace an exact walkable near floor unless near physical coverage is pinned to exact resolution.
Generated structural kit boxes must be suppressed/recomposed around adopted placements; otherwise
the independent grand castle/town kit produces a second settlement with no authority.

The GK11 mount's `blueprintKey = id:size:box-count` is weaker than the content hash. Different ordered
operations or same-size same-count grown/edited models can share a batch and render wrong geometry.
Main's production renderer already keys installed assets by their content hashes. Do not introduce
that mount into production until it uses the real hash (or canonical blueprint content key).

## Geometry, light and collision compatibility

All modules use +Y up; terrain is 0.5 m, authored build models 0.125 m. Seat translation preserves
positions and cardinal yaw. Keep exact installed `placement.position`, never home centre as origin.
Reject an unfitting seat or height-clamped grade instead of silently accepting clipped town geometry.
`gradeSettlement` currently clamps heights into `[1, field.height - 2]`; that is a potential mismatch.

Grand terrain uses packed quad attributes and a RawShaderMaterial, while production's voxel material
uses chunk geometry/material IDs from the installed registry. Grand palette IDs are independent;
do not pass them through the founded registry. A shader adapter is needed, not a material substitution.
Grand's fragment samples sky AO using `vWorld.xz / uLandMetres`, compares its heights with `vWorld.y`,
and uses land-level sea/fog uniforms. With translated terrain those need a land-origin uniform or
explicit land-local varying. Shadows, sea floor textures and clipping need the same transform.

Production uses ACES and `createPostStack`, grand standalone uses AgX and its own post/grade. Share
one accepted production environment/time and HDR/output pipeline for both native content and grand
land. Grand's current sun/shadow uniforms are not production voxel receiver uniforms. Bind/update
the material from the actual production grade; preserve accepted indigo fill/window pools/beacon.
Grand land currently has no native window light-field binding, so terrain under homes would lose
the existing warm pools unless that binding is added. Do not duplicate sky/post/sea/reflections.

`packages/world/src/founded-world/collision.ts:sampleFoundedTerrain` accepts v1 landform only and
at most 32×32 terrain chunks per axis (512 m), producing the physical half-metre grid.
`compileFoundedScene` combines that grid and the exact structures/carves. `foundedGroundAt` is only
a sampler, not clearance or loaded-space authority. `checkWalkBinding`/`createKingdomWalk` in
`apps/web/src/kingdom/walk-scene.ts` correctly require matched revisions and compiled collision.

Thus an exactly graded grand surface can replace the town's visible land **without changing its
existing walkable region**. This is already one actual kingdom under the real homes. It does not
enable walking into the new mountains. The full beyond-town promise still needs spec56's versioned
landscape hash/compiler binding, sparse collision-page dispatcher and matching server/client install
acknowledgment; unioning existing bounded collision worlds is invalid because each blocks its exterior.

## Concrete producer needs

`needs: GK10/GK11 must expose one hosted, abortable terrain-only owner taking the exact installed
RealmFoundedScene/plan and existing Three scene/camera/renderer/environment (no renderer/RAF/controls
or second town); carry absolute source identity (full broadcaster/seedKey, Genesis recipe/landscape
revision/hash, generator identity, immutable parameter/artifact hash) and an explicit settlement↔land
seat frame; join seating+grading into worker generation before meshing, return seat/paved/exact-region
data with revision-bound adopted physical support, suppress duplicate settlement
kits and above-floor decoration, pin exact near support, and demonstrate the actual founded
street→home→Forge/castle floor with native identities unchanged. Main can then install it in
createKingdomScene for both walk and stream without adopting a second renderer.`

Evidence: targeted source reads only. Commits: none. Screenshots: none. Doubts: producer source is
actively changing; no integration/cost/visual/real-GPU claims from this review.
