# Actual grand land: field decor adoption

The producer's `classifyCover` creates half-open, terrain-cell plots on an existing dry,
gentle field zone, assigns `plot` and `Cover.field` per accepted column, and independently
marks only some north/west edge cells `Cover.hedge`. The voxelizer reads each real column's
`ground`, `water`, `cover` and plot index. For most crops it currently paints one-cell-high
continuous rows; hedges randomly omit some cells a second time. The renderer asks that
same voxelizer for chunk and halo data. The flat `createFields`/`createFieldPlot` study is
not safe to place wholesale onto those plots: it supplies its own slab, dimensions, and
hedges at one elevation, ignoring individual ground heights, water and reserved cells.

`packages/world/src/grand/artisans/fields/decor.ts` provides an independent deterministic
sampler on the *existing* field arrays. It returns packed palette IDs for contiguous
above-ground voxels (maximum three half-metre cells), or `FIELD_DECOR_FALLBACK`. Wheat
and lavender grow in short planted runs with gaps, lavender has leafy lower cells, and
cabbage uses leaf crosses with smaller heads. Existing dry hedge cells get coherent
foliage while non-hedge cells, including the producer's existing gaps, are untouched.
Other crop and cover types retain the original producer rules. The sampler does not move
plots, write arrays, flatten land, add ground, create a path or assert collision authority.
Its random stream uses the full seed key and world-aligned plot coordinates, so requesting
neighbouring chunk halos in another order returns the same column profile.

`fields-adoption.needs.patch` is the exact minimal proposed change to the **builder-owned**
`packages/world/src/grand/voxelize.ts`. It caches a sampler per context and uses it only
for field/hedge decor height and material; the original fallback remains for other crops.
The producer's `chunkColumnRange` already includes four cells above terrain, covering this
sampler's maximum of three. Structures still override decorative cells in the existing voxel
order. `patch --dry-run -p1 -i work/evidence/grand-artisans/fields-adoption.needs.patch`
passes against the inspected producer. The patch has **not** been applied to this checkout.

Five sampler tests pass: bounds, wet/reserved/missing plot suppression, unmodified ground,
existing hedge/gap behavior, crop fallback, bounded solid profiles, row orientation, and
halo requests in reverse tile order. Scoped ESLint and strict scoped TypeScript pass.
The test does not exercise the patched voxelizer, actual generated channel lands, real
settlement/reservation overlap, GPU costs, or in-land appearance. `hash2` is run for each
sample (and the proposed producer asks for a profile at height and material stages); benchmark
worker cost under actual loads before adopting. The existing coarse-LOD reducer picks the
highest source column and may fill thin crop gaps; these tests do not prove LOD continuity.
Inspect real hero, street, coast and dusk shots after the builder evaluates the patch;
no capture was taken in this pass. No change to the mill or its kit geometry was made.

For the composed geology candidate, `fields-adoption.after-geology.needs.patch` is based on
an isolated temporary copy after `work/lanes/grand-artisans/adoption.patch`. Its dry run
also passes. It is separate from the standalone patch, which remains based on current main.

Alignment correction: both proposed patches call `fieldDecorFurrow` only for the handled
wheat/wheat-pale/lavender/lavender-dark profiles. Their bare furrow is plot-relative row
band 2, matching the sampler's unplanted band. Other crops return `null` and retain the
producer's original soil rule. Both revised patches dry-run cleanly on their respective
bases; six focused sampler tests, scoped ESLint and strict scoped TypeScript pass. The
new alignment test covers every column in both row orientations and checks the empty band.
The proposed producer patches remain unapplied and have not been visually reviewed.

Parent checkpoint update: see REVIEW-06.md for the later looked evidence, final validation, exact capture limits and paused state. Earlier verification statements above describe the child handoff time.
