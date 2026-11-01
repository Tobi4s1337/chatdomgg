# Grand artisan adoption

`../index.ts` exports `GRAND_ARTISAN_KITS`, matching the builder's local tree/composer seam.
It adapts all builder species to the six authored silhouette families; oaks and limes use the
broadleaf shape and their existing green foliage IDs, while gold, red, pine, birch, cherry, teal
and willow use the builder's corresponding bark/leaf palette IDs. These palette colours differ
from the isolated art-bench colours and must be judged again in the grand renderer. A bounded
cache holds up to 16 geometry variants for each family; seeded rotations/reflections and sizes
produce independent forms. The returned sparse arrays preserve 0.5 m source cells. The builder
owns placement, cache eviction, meshing, streaming and LOD behavior.

The default composer is explicitly for GK10's uninhabited, independent render domain only. It
rejects canonical cover reservations, and padded town/castle footprints. It fits a windmill at a
dry, gently sloping location using foundation columns reaching the sampled solid surface. It
searches a bounded area for a dry shore join and fits the quay to the actual seabed, extending
stone foundations and timber piles only beneath their own footprints. If the full quay cannot
fit, it searches for a continuous run of whole, independently checked 16-cell sections including
a pier and landing; a stepped shore carries each section’s end offset into its neighbour. The
port requires boundary-connected deep seawater, a ship-sized berth and a supported stair and
dry apron to land. Candidate orientation, search work and terrain checks are bounded; accepted
pieces also exclude one another. A
headland lighthouse and ships are fitted independently; each ship first tries a berth near the quay. Its boxes grant
no collision or interaction authority. It does not alter the canonical surface or drainage.
The quay currently requires sea-level water in its wet footprint: a higher sampled surface may
belong to a perched river or lake, and this input does not identify a connected navigable water
body or furnish a second ship datum. The low landing steps must also remain above local water.

`sitePlacements(land, guard)` exposes those conservative proposals to an installed-scene owner.
With no guard it returns no placements. An optional third diagnostics object collects per-orientation
work and exhaustion plus access-attempt counts; exhaustion means the bounded search stopped, not
that no valid shoreline exists. GK11 must pass a guard checking **all** real scene lots,
roads, Forge, castle, growth space, clearances and physical-region revisions; the GK10 default
is not such a guard and is not sufficient for a live founded scene. It must also supply physical
collision and approve safe approaches, rather than interpreting an art anchor as permission.

The builder already owns spatial indexing, palettes and chunk stamping. The companion
`work/lanes/grand-artisans/adoption.patch` applies to the builder checkout after the artisans are
present: it uses the geology sampler for consistent warped strata and snow by height and slope,
rejects structure-palette exhaustion, replays overlapping structures in source order across
chunk halos, and caps each worker’s tree-shape cache at 8 MiB of typed-array payload while
retaining the existing entry limit. Oversized individual shapes are generated for the current
stamp without being cached; their generation remains counted in `treeVoxels`. `cacheBytes`
reports the cached arrays, not transient shapes, object overhead, or total worker memory.
The owner must still budget the combined caches across all workers and other working data. Review and test that patch in the builder's branch; it has not been applied there.
The watercourse study is not a hydrology solver and must not replace canonical drainage.

The per-call local kit-bounds cache was compared against the frozen grand candidate using the
`tobi4s_` and `the_aggman` producer seeds. For both, SHA-256 matched for the generated structure
array, ordered structure-colour table, tree array and complete post-flora placements including
all boxes. On the shared host, single-pass pre/post placement timings were 1.205/0.970 s before
and 0.605/1.305 s after for `tobi4s_`, and 2.219/2.366 s before and 2.243/1.646 s after for
`the_aggman`. These noisy, unpaired measurements do not establish an end-to-end speedup. The
exact comparison data and script for this run are `/tmp/adoption-aabb-results.json` and
`/tmp/adoption-aabb-compare.mjs`.
