# Picture trees: what main swaps in

The lane ships the tree family, a private site adapter and the canopy wind. Root owns planting in `kingdom/scene.ts`,
the renderer, sun shadows and the stream (spec 47, Decisions). Nothing here plants a tree on its own.

## Exports

From `apps/web/src/kingdom/trees` (`index.ts`):

| Export | What it is |
|---|---|
| `TreeSite`, `TreeZone` (`'court' \| 'grove' \| 'water'`) | One existing planting site, as the caller classifies it. `position` is the trunk root, y on the sampled ground; `room` (optional) is the clear crown radius in metres |
| `plantGrove(sites)` / `plantTree(site)` | Site → `GroveTree` (`id 'tree:<site>'`, species, variant, blueprint, `position` = blueprint origin as a `GroundPiece`, `yaw`, `root`, `canopy`, `reach`, `height`). Pure: the same site always grows the same tree; it never adds, drops or moves a site |
| `groveBatches(trees)` | Placements grouped by blueprint (first-appearance order), one instanced mesh per form and detail level |
| `toGroundPiece(tree)` | The same placement for ground-dressing footprints and clearance |
| `createCanopyMaterial(clay.material)` | `{ material, sync(), setWind(time, [dx, dz], strength 0..1), dispose() }`. Shares the clay's uniforms object and fragment shader; only the vertex shader gains the anchored offset |
| `attachCanopy(geometry, canopy, [size0/2, 0, size2/2])` | Per-form constant attributes (`aCanopy`, `aCanopyMotion`, `aCanopyRoot`); attach to every detail level's geometry before drawing or registering it |
| `canopyOffset(...)` | The CPU mirror of the shader offset, for anything that must agree with the picture |
| `TREE_SINK` | The root flare sits one course (0.125 m) into the turf |

From `packages/content/src/trees` (re-exported above): `TREE_SPECIES`, `TREE_VARIANTS` (oak 4, pine 4, birch 4,
willow 3, elder 2, per style), `createPictureTree`, `selectTree`, `allPictureTrees`, `treeBlueprints`, `treeId`
(`tree-<species>-<style>-<variant>`), `CanopyMotion`, `PictureTree`. 51 blueprints across hearth, tide and grove.

## needs: (root)

1. **Sites.** In `scene.ts`, keep the existing court-ring and grove rules, then map each planted site to a `TreeSite`
   instead of `createTree(0..2)` at `[x-4, rootHeight, z-4]`, yaw 0. `apps/web/src/kingdom/trees/bench/sites.ts`
   (`toTreeSites`) is the exact mapping the bench uses:
   - `zone`: `'water'` when the lake ellipse distance is under 1.55, else `'court'` or `'grove'` by the rule that planted it;
   - `room`: the smallest clear distance to lots, public ground and the castle, plus 1 m;
   - `yaw`: seeded per site (`seedHash(\`${seed}:tree-yaw:${id}\`)`);
   - `position`: `[x, rootHeight(x, z), z]`; `style`: the kingdom's kit; `seed`: the kingdom seed.
   Then `plantGrove(sites)` and `groveBatches(...)` replace `trees` and `treePlaces`.
2. **Material.** One `createCanopyMaterial(clay.material)` for all trees. Call `canopy.sync()` after any receiver
   injection, and `canopy.setWind(time, direction, strength)` each frame. The bench uses `[0.8, 0.6]` at 0.8. A future
   weather owner sets this; there is only one wind.
3. **Geometry.** `attachCanopy` on each LOD 1, 2 and 4 geometry, next to the existing `aLodFade` attribute.
4. **Shadows.** Register the LOD-2 mesh of each form as the sun caster, as today. It compiles the same vertex
   shader, so shadow depth moves with the crown. The cached map can lag the live crown by at most about 12 cm.
5. **Collision.** Trunk collision, if walking avatars need it, comes from `GroveTree.root` and a 0.5–1.2 m radius
   (elders about 1.6 m).
6. **Package export.** `packages/content/src/index.ts` is outside the lane's scope, so the web side imports the
   trees by relative path (`../../../../../packages/content/src/trees`). Export `./trees` from `@chatdom/content`
   (or as a subpath) and switch the imports in `apps/web/src/kingdom/trees/`.
7. **Stream still.** After the swap, capture the integrated 1920×1080 stream view and compare it with the bench
   stills in `work/evidence/picture-trees/`.

## Decisions

- Trees are sculpted volumes, not hand-placed boxes. Wood is drawn per cell (heavy elder wood on a 2-cell grain);
  foliage is drawn in 2×2×2 blocks on even cells, so crowns survive LOD 2 and LOD 4 without coming loose. Crops are
  on whole 4-cell columns, so the trunk stays centred at every level.
- Each species reads by silhouette first: an oak's broad domed clumps; a pine's whorls of toothed fronds and a spire;
  a birch's narrow oval on a cream, dashed stem; a willow's arches with curtain strands and open sectors; an elder's
  heavy limbs, roots, hollow and moss. Colour comes second, and each kit has its own tones.
- Willows grow only by water. Elders grow only in the woods, about 3% of woodland sites. When a site has too little
  room, the tree steps down to a narrower species, never into a lot.
- The wind is horizontal only, zero below the crown pivot, and smooth in space, so wood and leaves stay joined. Each
  tree takes its phase from its own origin, and gusts travel along the wind direction. The motion is small, at most a
  voxel, so the silhouette holds and a cached shadow never visibly detaches.
- Motion data stays outside `VoxelBlueprint` (the schema is strict), in `PictureTree.canopy`.

## Doubts

- SwiftShader stills are not GPU evidence. On a real GPU, check the crown motion and the shadow lag at 1920×1080
  on the bench (`/src/kingdom/trees/bench/kingdom.html?trees=picture&view=grove`).
- At LOD 4, beyond 95 m, distant woods read lacier and darker than the old lollipops. The warmer palette helps; the
  ground fog does the rest.
