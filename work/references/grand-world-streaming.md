# Reference: bounded voxel worlds and continuous distant land

For: [56 — Grand kingdom](../specs/56-grand-kingdom.md). Studied 2026-11-01 by the
Astra architecture thread with a `gpt-6-luna` / low reference scout; source claims checked by the architect.
No third-party implementation or art copied. The brief's `/tmp/chatdom-refs/grand/worldgen-at-scale.md`
was absent. This note records what was actually available instead of attributing claims to that file.

## What it is

The supplied Eldermere images (`grand-ref-1.jpg`, `grand-ref-4.jpg`, `grand-ref-6.jpg`, viewed locally)
set a composition bar: mountain silhouettes behind a legible castle, dense distinct tree canopies,
a complete town and harbour, and enough water/sky to read the land as a place. The brief reports
118 million voxels, 205 homes, 3,065 trees and 73–84 fps; these are unverified reference measurements,
not a Chatdom benchmark. Do not import its white highlights, noisy snow, oversized castle-to-home
ratio or castle design as our art direction.

The useful implementation references separate logical world size from resident voxel/mesh capacity.
None establishes an off-the-shelf WebGL2 renderer that meets all of Chatdom's requirements.

## What we take

- [JamesKevinJones/webgpu-voxel-engine](https://github.com/JamesKevinJones/webgpu-voxel-engine),
  MIT, checkout `8abdc9140e076d1d092028d3c74ac274261d8e9c`,
  `/tmp/chatdom-refs/webgpu-voxel-engine`. `src/world/chunk-manager.ts:56–74` separately bounds
  voxel and mesh slots (1,536 / 640), loads radius 8, unloads with a 1.5-chunk margin.
  `:261–293` prioritizes nearest columns then top-down work; `:302–325` rejects stale generation
  tokens before installation. `src/core/engine.ts:395–424` performs AABB frustum tests and
  front-to-back opaque ordering. Take bounded caches, priority, hysteresis and generation tokens.
  Its GPU compute path and missing-neighbour-as-air convention are unsuitable for our physics.
  Its scheduler does **not** prove crack-free terrain LOD; no such implementation was found.
- [cgerikj/binary-greedy-meshing](https://github.com/cgerikj/binary-greedy-meshing), MIT,
  checkout `af8c688ed3af63e98f9631c05774f30e1350a021`, `/tmp/chatdom-refs/binary-greedy`.
  `src/mesher.h:46–73` uses a padded neighbourhood and occupancy masks before merging faces;
  the 62³ interior / 64³ halo is its native layout, not a reason to change our 32³ core.
  `src/rendering/chunk_renderer.h:147–184` batches packed quad draws with desktop indirect
  rendering and an SSBO. Take compact surface representation, never one cube mesh per voxel.
  WebGL2 cannot directly reproduce those desktop calls. See [our AO/halo study](voxel-meshing-light.md)
  for why merge keys must also preserve lighting and material interpolation.
- [Asirvatham and Hoppe, GPU-based geometry clipmaps](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry),
  GPU Gems 2, chapter 2, §§2.1–2.3. Nested elevation grids retain bounded resident detail;
  outer transition bands interpolate to the parent surface so level boundaries remain continuous.
  Take that continuity invariant for our hierarchical surface patches. A height field alone cannot
  preserve overhangs or arbitrary voxel edits. We keep exact volumetric patches where those matter.
  Historical performance is not evidence for our browser/device targets. Ideas only; no code license
  established for the chapter's listings.
- [Three.js BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html), MIT, installed **0.186.1**.
  Same-material meshes can share buffers; input attribute layouts must agree. Per-object frustum
  culling and depth sorting are available. Installed `src/objects/BatchedMesh.js:1527–1665`
  contains the per-camera batch selection. `src/renderers/webgl/WebGLIndexedBufferRenderer.js:22–43`
  distinguishes ordinary indexed/instanced draws and extension multi-draw. Take spatial batching
  and real submitted-draw accounting; do not treat a batch object as one guaranteed GPU call.
  Our packed integer vertex material needs explicit batch-transform support before this is a
  drop-in option. Ordinary spatially merged patches/InstancedMesh remain the portable path.

## What we do differently

Use WebGL2 as the implementation baseline, CPU hierarchical culling and workers for generation and
meshing. Optional GPU visibility/indirect submission must have the same conservative visible result;
it is a measured optimization, not a dependency. Never read back GPU visibility synchronously.

Our world is generated as a compact, versioned field with sparse reviewed overrides. The resident
render cache contains only visible surface detail plus a bounded warm margin. Houses/trees share
meshes by actual asset hash and LOD, in spatial batches small enough to cull. The exact installed
settlement and loaded collision chunks remain authoritative regardless of camera LOD. Presence
lights remain tied to real plot slots, including in far-town proxies.

The hard test is continuous motion: preserve mountain/roof silhouettes, shorelines, front doors,
terrain boundaries and window positions while the camera moves and assets change. Retain the old
valid patch until its complete successor is ready. Budget both during a fade. Culling, reflection
and shadow passes must each select what *their own* camera sees.

## Leave behind and license

No blind full-world rasterization, no all-home remesh on a presence update, no forest represented as
millions of independent cubes, no automatic assumption that more voxels improve a shot. GPU compute,
SSBOs and indirect commands from the references do not become WebGL2 features through an adapter.

MIT references permit adaptation with notices and attribution; none was adapted in this seam.
The source URLs and revisions above were verified against the local checkout metadata without
running git. Reference screenshots have no established reuse license and remain research only.
Existing [water](water.md), [post stack](post-stack.md), [sky/fog](sky-fog-time.md) and
[settlement streets](settlement-streets.md) notes supply the complementary techniques.
