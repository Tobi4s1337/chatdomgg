# GK10 — the grand land: how it is built and why

Spec: `work/specs/56-grand-kingdom.md`. Entry: `/-/grand?channel=<login>&hour=17.6` (see the header of
`apps/web/src/grand/index.tsx` for every parameter).

## Pipeline

1. **Generate** (`packages/world/src/grand/generate.ts`, pure, in worker 0). Genesis recipe → `planGrandLand`
   (island frame, rotation, coast harmonics, bay, cliff coast, mountain spines, castle rock, town flat, fields,
   forest, mere) → `shapeLand` (half-resolution macro and ridged spines, particle erosion and thermal relaxation,
   fine needles and the settlement flats, priority-flood lakes, D8 rivers and waterfalls, banks, coast distance,
   graded beaches, sea stacks) → `classifyCover` (snow, rock, scree, beach, reserved settlement, forest,
   meadow, patchwork plots with hedgerows) → `placeTrees` (grove map, alpine and waterside rules, hero trees)
   → `composeStructures` (dressing kits) → sites. 1280–1792 columns per side, 384 high, 0.5 m cells.
2. **Voxelise and mesh** (`voxelize.ts`, `packages/voxel/src/grand/quad-mesher.ts`, workers). A job is one
   128 m region at one level (×1, ×2, ×4, ×8). Each 32³ chunk is resolved on demand with its one-cell halo
   from the columns, the trees and the placed boxes; coarse levels keep the surface (highest top, top-most
   material). Greedy meshing to 8-byte instanced quads in six face buckets with AO-aware merging.
3. **Stream and draw** (`apps/web/src/grand/engine.ts`, `packages/render/src/grand/*`). Screen-error LOD,
   staged installs, face-direction culling per pass, one fitted shadow map, planar sea reflection, sky dome,
   drifting voxel cloud tiles, height fog, bloom and AgX.

## Decisions

- **Trees are stamped into the voxel grid, not instanced.** Every tree is its own seeded shape and merges with
  the ground's meshing and AO, which is what makes woods read as clay rather than props. Shapes are cached per
  worker (LRU). Coarse levels keep the canopy silhouette by taking the highest cell.
- **A fixed 128 m region with four representations instead of a quadtree of growing tiles.** Same screen-error
  rule as the spec (`errorPx = cell · projection / nearestDepth`), refine above 1.2× target, coarsen below 0.8×
  for 0.5 s, neighbours balanced to one level apart. A region keeps its shown mesh until the replacement has
  fully installed; unused levels are retained 2 s, so an LOD reversal reuses them. Fewer, larger draws suit
  WebGL2 (6 draws per region per pass, ≤ 600 at the capital).
- **Hidden sea fill.** Everything under the sea plane that is not solid is material `M.sea`, which meshes no
  faces and hides the faces against it: the seabed and drowned cliffs are never drawn. The sea's depth colour
  comes from a half-float ground/coast texture instead.
- **Opaque, depth-tinted water** for sea, rivers and lakes; the planar reflection is the sea's only.
- **One fitted orbit shadow map** (4096² high, 2048² laptop and software, none on phones) over the whole
  land, rendered from the shown meshes with sun-facing buckets only. At 640–900 m across this is ~0.2 m per
  texel, finer than the spec's far cascade. The near 128 m cascade belongs with walking (GK11).
- **Pool of `min(4, cores − 2)` workers**, ≤ 64 waiting jobs, ≤ 16 MiB committed result bytes, installs
  limited per frame by bytes and milliseconds per tier, stale results (superseded job id, evicted level)
  dropped and counted.
- **Software evidence stills** (`tier=software&capture=1`) lift the interactive pixel and install limits for
  a still nobody interacts with. Without `capture=1` the software tier honours its 0.5 Mpx budget.
- **A quality governor holds the main-view triangle budget** (3 M high, 1.5 M laptop, 600 k phone, 250 k
  software): over budget it coarsens the LOD target by 1.2× (up to 4×), well under it relaxes, at most twice a
  second. The full-detail hamlet is 2.29 M quads, so the orbit view at 1 px would otherwise draw ~3.4 M.
- **Software draws once the land has settled.** A SwiftShader frame of the full land takes ~16 s on this host;
  drawing while streaming starved the workers (200 s to mesh). The loading plaque is DOM and keeps counting.
- **Coarse levels (×4, ×8) share one tree shape per species and scale step**: same silhouette and coverage,
  a third of the cost (whole-land ×8 cover 3.5 s → 1.15 s).
- **Mountains stay under the world's ceiling.** Nominal peaks 150–175 cells (mountain pass), 130–150
  (river valley), 115–138 otherwise, ×1.12 highland; crest, needles and relief add ~60 %. Wider spine bases
  (0.6–0.68 of the island's minor radius) give flanks and foothills rather than walls (first light had
  clipped, flat-topped mesas: `work/evidence/grand-kingdom/gk10-first-light-*`).
- **The sun rakes from the camera's shoulder** (sunset bearing = harbour bearing ± 0.36π), so the faces we see
  are lit and shadows run across the frame.
- **Portrait frames widen the lens before pulling back, and stay under the clouds.** 16:10 is the composed
  frame (38° vertical). Narrower frames go up to 62°, then dolly back only as far as the land needs to fit
  across, and lower their pitch rather than rise into the cloud deck (a phone at 2.5× pull-back looked down
  through the clouds and saw none of the land). Views composed above the deck (`high`) keep their height.
- **The plaque counts the land's own cells**, fixed by the seed; stamped tree voxels depend on which regions
  meshed at ×1 and live only in the stats panel.
- **Raised lands are kept between visits** in IndexedDB keyed by the content-hashed worker URL plus the seed
  identity, newest six kept. Development builds always raise afresh.
- **Grand modules are imported by relative path** from `apps/web`; `@chatdom/world` exports are main's.

## Dressing kits: the plug-in point (lane grand-artisans)

Types live in `packages/world/src/grand/types.ts` ("Dressing kits"); the registry is `kits.ts`. A module at
`packages/world/src/grand/artisans/index.ts` exporting `GRAND_ARTISAN_KITS: Partial<GrandDressingKits>` is
picked up automatically:

- `trees: { extent(species, scale), shape(species, seed, scale) }` replaces the built-in tree generator for
  the same `TreeSpecies` names (placement, buckets, bounds and the sky map all read `extent`).
- `compose: GrandComposer[]` runs on the finished land (`GrandComposeInput`: heights, water, cover, plots,
  coast, trees, sites) and returns `{ piece, at, turns }` placements of `{ id, boxes: {min,size,colour}[],
  anchors }` pieces, the same shape as the artisans' `KitBuilder.finish`. Boxes are stamped over the
  terrain at every level; up to 128 distinct colours become materials `M.structureBase + i` (stone kind).
  Kits run in the deterministic generator: seed-key streams only, no clocks or `Math.random`.

## Measured here (9-core shared server, SwiftShader; no GPU figure)

- Generation: hamlet 1280² ≈ 7.3 s (shape 6.2 s), city 1536² ≈ 8.6 s, single thread.
- Full-detail quads, hamlet: ×1 2.29 M (18 MB), ×2 0.60 M, ×4 0.15 M, ×8 34 k; ~7 ms per 32³ chunk at ×1.
- Hamlet: 75.6 M solid terrain cells, 1,841 trees (13 species incl. two heroes), 6,030 river cells,
  18,161 lake cells, 412 fall cells, 19 field plots, 6 sea stacks.
