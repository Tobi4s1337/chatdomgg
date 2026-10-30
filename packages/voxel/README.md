# Voxel core

This package implements deterministic CPU voxel preparation, meshing and light propagation. It owns no scene,
camera, presence authority or network connection. Shared data contracts live in `packages/shared`; the source
decisions are [Tech §§8–9](../../chatdom/Tech.md), [Quality](../../chatdom/Quality.md) and the
[meshing/light reference study](../../work/references/voxel-meshing-light.md). These algorithms were written here;
no external source code was copied. The study supplies techniques, not browser performance guarantees.

## Data and first consumers

- Scene boundaries use metres and +Y up. Terrain/build/avatar lattices are exactly 0.5/0.125/0.0625 m. A chunk
  is 32³ cells, indexed `x + 32 * (y + 32 * z)`; negative coordinates use floor division. Vertices are chunk-local
  integer corners in 0..32, including the far boundary.
- Authoritative voxels are `Uint16Array` material IDs, with zero as air. Collision solidity, face occlusion,
  AO occlusion and light blocking are distinct material properties. A palette index never becomes a material ID.
- `encodeVoxelChunk`/`decodeVoxelChunk` implement canonical, sorted per-chunk palettes and 0/1/2/4/8-bit indices.
  A single-material chunk has no index buffer. This is the frozen chunk interchange; it is not a guessed CVOX
  file container. Publication, hashes, compression, placed pieces and carves remain their own contracts.
- `rasterizeBlueprint` executes authored half-open boxes in order. Material-zero boxes carve openings. The
  asset is a reusable immutable definition, so hundreds of houses can share meshes and material data.
- `MeshStamp` carries identity, own revision, material revision and dependency revisions. Finite assets declare
  their outside air; terrain must supply real neighbours. A null neighbour revision defers meshing. A corner
  edit invalidates every chunk whose halo reads it, including diagonal neighbours.

`prepareAssetChunks(asset, materials, materialRevision)` computes whole-asset sky, then gives every occupied chunk
a full 34³ halo, including edges and corners. A roof in the chunk above therefore occludes the chunk below.
An asset revision also revises the full-sky dependency. `meshVoxelChunk(request)` returns packed vertices,
32-bit triangle indices, bounds and the same stamp. The shader scales by the lattice and adds `coordinate * 32`.

## Meshing and packed vertices

Visibility masks are built by visiting occupied cells once. Only visible faces run corner-shading work. Faces
merge when material and corner shading agree, and only along an axis where both AO and sky are constant. This
permits long shaded strips while preserving every original unit face's interpolation. Repeating an arbitrary
four-corner tuple is insufficient: stretching it would change shading. Two-axis gradients remain unit quads.

Corner AO uses two neighbours and their diagonal in the face's outside plane. Two occupied sides give zero
accessibility; otherwise accessibility is `3 - side1 - side2 - diagonal`. Triangle diagonals use opposite-corner
sums, with tests for all six outward windings. Static sky is averaged over accessible corner cells; changing the
time of day changes the sky colour/intensity uniform, not voxel data or geometry.

Each vertex is two unsigned 32-bit words, exactly eight bytes:

| Word | Bits | Value |
|---|---|---|
| 0 | 0–5, 6–11, 12–17 | local x, y, z |
| 0 | 18–20 | face: +X, -X, +Y, -Y, +Z, -Z |
| 0 | 21–22 | AO accessibility, 0..3 |
| 0 | 23–26 | sky openness, 0..15 |
| 0 | 27–31 | reserved, zero |
| 1 | 0–15 | material ID |
| 1 | 16–31 | reserved, zero |

WebGL2 consumes these as integer attributes; do not reinterpret the words as float values. Material colour,
wood/stone patterns and clay variation belong in world-space shading, preserving mergeability. Presence windows
are separate instances/geometry with a plot-indexed presence texture, so presence never enters a mesh key.

## Workers and hot paths

`VoxelWorkerPool` defaults to two same-origin module workers and allows one through four. Its default factory uses
the literal `new Worker(new URL(..., import.meta.url))` form checked by Vite. Production bundling was tested to
emit a separate worker asset. There is no SharedArrayBuffer or cross-origin isolation requirement.

The submission queue has a default cap of 128 waiting jobs. Each accepted submission snapshots buffers and
metadata immediately; editing an authoritative buffer afterwards cannot change a queued job. Dispatch transfers
the pool-owned snapshot buffers, and responses transfer worker-owned result buffers; caller buffers stay attached.
A newer job with the same key terminates obsolete active work and starts a worker
replacement. Old promises settle as null, crashes reject, and disposal settles all promises and terminates workers.
Metadata checks and the caller's `isCurrent` predicate prevent an old neighbour/asset/light revision installing.

For small reusable assets, `kind: 'blueprint'` prepares and meshes the whole asset. For large assets use the
bounded pipeline:

1. Submit `kind: 'prepare'` with blueprint, asset revision, materials and material revision.
2. Receive `kind: 'prepared'` with chunk coordinates and complete meshing requests. This solves sky once.
3. Submit individual `kind: 'mesh'` requests, nearest visible chunks first, with only a small number queued.
4. Install each current result within the renderer's upload budget. Release its halo/sky buffers after use.

Do not enqueue a 250-chunk castle as 250 promises at once: queue admission is deliberately bounded. Cached mesh
templates can be instanced across a settlement. Asset preparation is not the same thing as a visible ready scene;
loading claims must follow actual installed geometry. Urgent lights should have a separate one-worker pool or
reserved scheduling capacity, so expensive preparation cannot sit in front of presence updates.

## Dynamic light field

`buildLightVolume` performs a bounded six-neighbour max-light flood, rebuilding from current emitters. Removal,
changed walls and overlapping sources are therefore correct without maintaining fragile dependency trees. It
does not remesh houses. Window sources sit outside their facade in air; all warm cores use the same source level.
Subscriber tint belongs at a window's edge and does not enter this volume.

The result is R8 levels 0..15. The renderer binds a WebGL2 3D texture and a shared warm RGB uniform. Occupancy is a
separate byte grid. `rasterizeLightOccluders` conservatively marks every cell overlapped by a blocker, including
walls thinner than a light cell. This can close a sub-cell opening but cannot leak through a thin wall. Derive
blockers from occupied geometry after carves, not the enclosing box of an entire furnished building.

Nearest sampling plus an outward surface-normal bias avoids filtering light through walls. Arbitrary trilinear
filtering is not a safe replacement. A renderer may add an occlusion-aware smoothing kernel or probe interpolation
only with wall/leak tests. Retain the previous field until the matching new origin/revision is ready; origin and
texture install together. A moving field needs a designed edge blend, and the rendering integration must verify it.

## Budgets and evidence

The dynamic field defaults to 64×32×64 cells at the caller's chosen spacing (normally 0.5 m, a 32×16×32 m region).
The hard cap is 524,288 cells. At that cap the conservative algorithm working set is 4,784,128 bytes: worker
occupancy/output/FIFO/queue bits plus caller occupancy and the currently held CPU/GPU field. This assumes one
field job in flight and disposal of obsolete resources. Double-buffer transitions, garbage-collector retention,
driver allocation and queued snapshots require separate observation; this number is not total process memory.
128×64×128 RGBA8 plus occupancy alone consumes 5 MiB before worker scratch and is deliberately not the default.

Sky preparation uses full-asset scratch, so it is a baking/worker hot path, not a per-frame operation. Sky sources
are seeded only at unequal-height open-column edges; tests compare the result with a full-source flood on seven
irregular structures. The full-asset sky array is discarded after chunk preparation. A large castle can temporarily
need tens of megabytes of preparation and halo data; limit preparation concurrency to one on phones, cache finished
meshes, and discard raw requests. Content delivery ultimately needs immutable pre-baked near/far geometry so each
visitor does not repeat the same heavy bake.

On this shared CPU host, profiling the current content gave the following diagnostic ranges, not device promises:

| Asset | Triangles | Preparation | All chunk meshes |
|---|---:|---:|---:|
| Hearth hut | 9,812 | 180–220 ms | 210–230 ms |
| Hearth castle | 44,122 | 2.8–3.2 s | 2.4–3.3 s |

The original conservative mesher produced 15,164 hut quads; directional shading-safe merging produces 4,906.
The castle went from about 93,000 quads to 22,061. Chunk p95 on these runs was 25–47 ms off-thread. These numbers
do not meet an assumed 2.2 ms browser target and must not be presented as real-GPU frame evidence. Instancing
reduces draw calls, not submitted triangles: 240 near huts still cost about 2.35 million triangles before culling.
Near/far LODs and culling remain necessary for a town.

Render targets remain 16.7 ms at 60 fps and 33.3 ms at 30 fps on phones, with no normal frame over twice target.
Reserve roughly 1 ms/frame for mesh/texture installation and record upload spikes; those are targets for the
integration, not measured here. The voxel/light package makes no network requests. Chunk data uses 0–32 KiB of
indices plus at most 512 palette bytes before outer compression; mesh vertices and light fields are local products,
not per-presence network payloads.

Tests cover malformed palettes, negative coordinates, packed layout, outward winding, halo culling, unknown
neighbours, shading-equivalent merges, multi-chunk roofs, wall/doorway lighting against a shortest-path oracle,
source removal, input snapshots, stale work, queue caps, cancellation, worker failure and actual worker bundling.
A headless Chrome integration check also executed the real module worker through Vite: the source was level 15,
the other side of a complete wall was zero, the returned revision was correct and caller occupancy stayed attached;
there were no browser errors. Its temporary server on port 5198 was stopped. No renderer screenshots or real-device
performance are claimed by this package.

## Decisions and next consumers

- Float-free integer geometry plus immutable revision stamps keeps rendering independent of authority and edits.
- Baked static AO/sky and dynamic camera-local light are separate because presence changes frequently.
- Conservative directional merging preserves shading rather than baking random voxel colour to hide artifacts.
- Full bounded light rebuilds prove removal and overlapping sources before incremental propagation is introduced.
- Real worker termination handles cancellation during synchronous heavy CPU work; a promise flag cannot stop it.
- The prepared-chunk pipeline permits visible chunk priority without recomputing whole-asset sky for each chunk.

Builders should integrate progressive chunk installs, instance culling/LOD, geometry caching and camera-volume
updates on these APIs. Artisans can author homes and civic pieces against the frozen blueprint/material/lattice
contracts and inspect actual meshed silhouettes and nocturnal lighting. Main should freeze publication/CVOX,
carves, sky invalidation across terrain and GPU upload budgets when their consumers start. The unresolved risks
are large-asset bake latency/memory, terrain sky propagation beyond a single halo, conservative light-cell opening
loss, camera-volume transitions, and actual WebGL2/OBS/mobile rendering cost.

Render-only detail jobs may set `lodFactor: 2 | 4` on a blueprint request. The worker executes all ordered
boxes first, then conservatively reduces final occupied cells; registered material mode wins with stable ID
ties. Result identity stays the source asset while mesh/dependency stamps include the detail factor. Scale
render instances by that factor. These meshes can expand up to 0.375 m, so retain original occupancy for
lights/collision and original window anchors; do not substitute coarse geometry into domain state.
