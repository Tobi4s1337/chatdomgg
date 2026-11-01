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
places a harbour only where its actual water, piles, quay join and lighthouse base are supported;
otherwise it proposes a separately grounded lighthouse and/or deep-water ships. Its boxes grant
no collision or interaction authority. It does not alter the canonical surface or drainage.

`sitePlacements(land, guard)` exposes those conservative proposals to an installed-scene owner.
With no guard it returns no placements. GK11 must pass a guard checking **all** real scene lots,
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
