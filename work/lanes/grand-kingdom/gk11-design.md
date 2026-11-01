# GK11: the grand kingdom on the grand land

Owner: the second grand-kingdom worker. GK10 (land, streaming, renderer, `/-/grand`) is built in parallel in
`../grand-kingdom`; the land dressing kits are built on `lane/grand-artisans`. This note is the design GK11 builds
to, and what it hands the other two.

## The one decision

**The installed region is exact; the grand land meets its edge.** A kingdom's settlement (an adopted
`RealmFoundedScene`, or a potential Genesis plan) keeps its own metres, placements, cardinal turns, street graph,
Forge square and physical ground. Within its physical region (plan bounds, chunk aligned, plus the terrain padding
the founded collision compiler uses) the grand land's columns *are* `terrainHeight(plan, x, z)`, quantised to the
half-metre lattice, and its waters are the settlement's own waters. Outside, the generated land rises around it,
blended over a band so no seam shows. Walking, doors, Forge, moments and raid arrivals therefore keep working
unchanged inside, and nothing outside pretends to be walkable (spec 56: the far surface never becomes a collider).

Why: it keeps the identity chain intact (no recomputed doors or support), makes the seam a real producer rather than
a renderer guess, and gives main a clean adoption path: the landscape recipe binds around the installed region.

## Frames

- Settlement frame = world metres of the scene (what `KingdomLandInterface` speaks). Never moved.
- Land frame = GK10's grand land: columns `0..size` at 0.5 m, sea at `seaLevel` voxels.
- `GrandSeat.offset` (metres, multiples of 0.5 on every axis) maps settlement → land: `land = settlement + offset`.
  Pure translation; no rotation, so cardinal turns and voxel lattices stay aligned. `offset.y` puts the
  settlement's water level (v1 lake level, Genesis coast level 0) on the grand sea level.
- The renderer places the whole settlement group at `offset`; characters walk in settlement metres as children.

## Pieces

`packages/world/src/grand/kingdom/` (pure, tested in `kingdom.test.ts`):
- `frame.ts`: what a plan asks of the land: the physical region (plan bounds aligned out to 16 m, as
  `sampleFoundedTerrain`), the water level the sea takes, the seaward side, the inhabited centre, the castle. Its
  ground reads the founded compiler's own cached grid for installed landforms; paving is rasterised from the plan.
- `seat.ts`: choose the half-metre offset near the land's town site, toward its sea.
- `grade.ts`: write the exact ground, waters and cover into the land's columns, blend a 48 m band to the natural
  land with no step at the edge, clear and re-seat trees.
- `sites.ts`: the town and castle as drawn (land columns), focus points for the orbit director, and the reserve the
  land's composers keep clear of; `clearKingdomStructures` drops composed boxes that stand on the kingdom.
- `ground.ts`: the seam's `LandGroundSource` (exact inside the region, `null` outside) and `grandKingdomLand()`.
- `walls/`: the town wall circuit around every lot, square and court, closed by the castle and the shore, gated
  wherever a street (active or reserved for growth) leaves, drum towers, build-lattice pieces, banner anchors.
- `index.ts`: `seatKingdomOnLand(land, plan)`, the one call the land worker makes.

`apps/web/src/grand/kingdom/` (three.js and composition):
- `pieces/`: the exact content of each kingdom, the same placements today's views install (tobi4s_ through the
  realm's founding, SIMULATED; Genesis channels through their composers).
- `dress.ts`: walls plus banners in the channel's heraldic cloth (snapped profile colours, cut and charge; neutral
  colours and no charge where nothing was observed).
- `content-worker.ts` / `content.ts`: composes content and dressing off the main thread.
- `mount.ts`: the kingdom layer: instanced voxel meshes with three LODs at the seat offset, window lights from the
  labelled SIMULATED presence study, lit by the land's hour and sun.
- `attach.ts`: mounts the layer on GK10's engine once the land is seated.

## Decisions

- Pure translation, no rotation: cardinal turns and lattices stay aligned, so placements are copied, not
  recomputed. The land's sites follow the kingdom, never the reverse.
- The castle keeps the ground its plan gives it; a rock raised under it would break exact support inside the
  region. Its rock is drawn where the land is ours: within 72 m of the castle the blend band does not ease, the
  castle's ground breaks off at the region edge as a broken rock face a few metres deep (`CASTLE_CRAG_REACH`), and
  steep graded ground everywhere (≥ 2 voxels to a neighbour) is dressed as rock. Cover only inside the region; not a
  single exact height changes. MashaD4's castle already stands at 60 m on its own mountain.
- The seat is growth-stable. It is judged over the plan's *envelope* (every plot built or reserved, every street
  active or reserved, castle and water, 16 m aligned) and centred on the plots and square, each address counted once.
  A hamlet that becomes a town on its reserved addresses keeps the same offset and land size, so its land never moves
  under it and the homes already built stand at the same land position (`the grand kingdom as it grows` tests).
  Only the exact region and its band are re-graded as the region grows.
- The land is sized for the envelope with its band (`landColumnsFor`), but growth room is capped at
  `LAND_COLUMNS_CAP` (3072 columns, 1536 m): MashaD4's reserved mountain roads run 1056 m and would ask for 5120
  columns, a land a software renderer cannot raise in a capture. The built region and its band are never capped. Below
  the cap the size is growth-stable; above it, it stays stable while the built region fits the cap.
- Walls on steep ground: a gate, tower or curtain piece whose footing reaches deeper than one blueprint (256 build
  cells, 32 m) is laid in courses, each its own piece directly below the last (`<id>:footing<n>`), so the masonry meets
  the ground on a mountainside. Only width and depth split a piece sideways.
- Citizens: a SIMULATED kingdom (Willowmere with no adopted bytes read) mounts today's `createKingdomCitizens` on the
  same plan in settlement metres under the seat, walked by the kingdom view's own labelled SIMULATED producer
  (`createSimulatedPresence`), and its windows light from `crowd.lightFrame` as people arrive home. A potential
  kingdom has no citizens: its windows are the Genesis light study and nobody walks (that study never enters
  citizens by contract).
- Walls are presentation in the grand view until main adopts them as founded placements (they would then need
  collision and gate approaches); they never cross a lot, square, castle module or water, and keep every growth
  street a gate, so growth never has to break them.
- tobi4s_ (Willowmere): today's generator refuses the 2019 founding (eight quarters, five allowed), so the
  SIMULATED plan falls back to first year 2022, the kingdom view's own default; main swaps in the adopted plan.

## Hand-offs (exact `needs:`)

- GK10: adopt `gk11-gk10-hook.py` (or its equivalent) into the grand engine, worker and entry: `generate` takes
  `settlement?`; the worker calls `seatKingdomOnLand` after raising, clears composed structures from the reserve,
  takes the kingdom's sites and focus points, never caches a seated land under the bare seed; the engine gains
  `GrandLayer` (`setLight`, `update`, `isReady`, `dispose`), `addLayer`, `invalidate`, and layers join readiness;
  the entry composes the kingdom first and attaches it after `start()`. Also: a `Cover.paved` material for the
  `paved` mask the grade returns (setts), and, for a better fit, `seed.settlement` (span, seaward bearing) to size
  the island to the town and face its bay.
- Main (build config): the kingdom content worker composes Genesis kingdoms whose modules use top-level await
  (The_AGGman's emote derivatives), so the web build needs module workers: `worker: { format: 'es' }` in
  `apps/web/vite.config.ts`. Without it `vite build` fails once the grand entry imports `kingdom/content`.
- GK10 (camera): `setView` caps the orbit eye with the nominal `reach`, not `reach · fit`, so on a land sized up for
  its town (`--size`, ≥ ~1900 columns) the orbit eye (15°, nominal height 266 m against a 235 m deck) counts as
  "composed above the deck" and rises over the clouds. Make above-the-deck an explicit flag of the `high` view and
  cap every other view at `ceiling`.
- Artisans: composers read the kingdom reserve (`SeatedKingdom.sites.reserve`) and place windmills, harbour,
  lighthouse outside it, on the land the grade left.
- Main: adopt the walls as founded placements with collision when the grand view becomes the kingdom view.

## Proof

tobi4s_ (realm founding config `tobi4s_`/town/2019, SIMULATED where no adopted bytes are read), The_AGGman,
PinkKittyRose and MashaD4: before (today's `/kingdom/<id>` or `/?seed=`) and after (`/-/grand?channel=`) stills.
