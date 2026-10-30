# Reference: voxel meshing and light

For: voxel world meshing, local lighting and worker contracts. Studied 2026-10-30:

- [Binary Greedy Meshing v2](https://github.com/cgerikj/binary-greedy-meshing), MIT, revision `af8c688ed3af63e98f9631c05774f30e1350a021`; reference checkout `binary-greedy`.
- [WebGPU voxel engine](https://github.com/JamesKevinJones/webgpu-voxel-engine), MIT, revision `8abdc9140e076d1d092028d3c74ac274261d8e9c`; reference checkout `webgpu-voxel-engine`.
- [0fps: ambient occlusion for Minecraft-like worlds](https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/), 2013; [voxel lighting](https://0fps.net/2018/02/21/voxel-lighting/), 2018. No code license established: take the described ideas, write our own.
- Local pre-repo `d-voxel-diorama/src/mesher/greedy.ts` and `worker.ts`: useful prototype evidence, not an external licensed dependency. Revision not established; do not copy wholesale.

## What it is

Binary Greedy cheaply finds visible surfaces with bit masks, then merges only equal voxel types; its v2 does **not** include baked AO (README points to v1 for that). The WebGPU engine demonstrates portable CPU light propagation and a separate GPU mesher; its CPU mesher is an oracle for the same corner AO and smooth light rules. 0fps explains both the local AO approximation and why a quad's triangle diagonal matters. Together these are a useful starting point, not evidence of Chatdom's performance on a phone.

## What we take

- **Visibility and rectangles.** Binary `src/mesher.h:46-70,116-135,136-174,208-240`: the input includes a one-cell neighbour halo; binary occupancy columns produce six oriented face masks using bit operations, then rectangles extend only through visible faces of the same type. Its example uses 62³ interior in a 64³ padded volume, not our chunk size; its 64-bit native code and desktop 50–200 µs README figures are not browser estimates. For Chatdom start with 32³ chunks and 32-bit columns; consider binary masks only after profiling.
- **AO.** For a face corner sample the two sides and diagonal in the outside plane: if both sides occlude, accessibility is 0; otherwise it is `3 - side1 - side2 - corner` (0fps and prototype `greedy.ts:107-116`). Compute four ordered values, choose the two-triangle diagonal using the opposing-corner sums; the exact comparison direction depends on corner order and which diagonal is called the default (prototype `:151-177`). Test both face windings and the asymmetric pattern, rather than copying a sign without its convention.
- **Merge equality.** A rectangle is limited to one face direction, render pass and compatible material, with equal four AO values in consistent order; prototype `:95-135`. WebGPU reference `src/world/mesher.ts:79-86,190-215` additionally keys four independently smoothed corner light bytes. Match all shader-visible properties including material, orientation, opacity/cutout, texture mapping and emission. Shared edge values and the resulting interpolation must agree; exact tuples are conservative for local AO, and arbitrary changing light fields need additional interpolation checks or splitting. Compare merged against unmerged shading, not only quad count.
- **Flood light.** WebGPU `src/world/lighting.ts:14-21,206-255,294-322,373-406`: independent 4-bit sky and block channels; BFS over six neighbours, taking the brighter candidate after material attenuation. Open-sky level 15 travels straight down unattenuated through clear cells; lateral/upward travel decays. On removal or increased opacity, clear dependent lower levels (including level-15 downward beams), collect surviving brighter boundaries and emitters, then re-flood; seed adjacent light on opening a voxel. Preserve multiple-source contributions and cross-chunk propagation. Separate sky intensity/colour from the stored openness so time of day does not force a world remesh. `mesher.ts:211-220` averages each channel over transparent corner-neighbour cells for smooth vertex light.
- **Boundaries and work.** Snapshot the chunk plus a real one-cell neighbour halo including edge/corner cells for AO and light, not invented solid side walls. A border edit dirties every chunk whose halo reads it, including diagonal neighbours; a propagated light change dirties affected consumers. Treat unknown/unloaded neighbours explicitly and reconcile both sides when they arrive. Worker jobs carry chunk identity, content and neighbour/light revisions; discard stale results and atomically swap meshes. Transfer owned typed arrays and return buffers where useful; do not transfer away authoritative collision data. Prototype `worker.ts:18-40,43-64` and `pool.ts:17-50` show same-origin module workers and transferable results but do not establish a stale-result protocol.
- **Independent collision.** Query authoritative voxel occupancy and placed-piece carves, never visual greedy triangles or AO/light. This preserves identical client/server walking and immediate edit correctness while a mesh is pending. A palette index is not a material ID: resolve the chunk palette to kingdom `u16` material properties before comparisons; material visibility and light transmission are distinct from collision solidity.

## What we do differently

Chatdom's `Tech.md` §§8.5, 9.4–9.5 specifies 32³ terrain and plot chunks, 0.5 m terrain and 0.125 m plot lattices, per-chunk packed palettes, baked corner AO and sky occlusion, worker meshing, 8-byte vertices and per-chunk swaps. The reference's expanded CPU vertices and WebGPU buffers do not establish that 8-byte format; design and verify packing for material and lighting rather than silently exceeding it. Clay variation, bevels and grain belong in world-space shader material, not random voxel colours that prevent merges.

Citizen windows change through a presence texture without remeshing. The specified camera-local 3D flood-lit volume (0.5–5 MB) makes warm pools, respects walls, and lights characters; use the propagation algorithm as a starting point, not the reference's permanently baked torchlight as a substitute. Avoid baked dynamic-light keys when they would require remeshing on every presence change. A small real-light pool is reserved for fire, Forge and spells. Account for the volume's allocation, uploads and worker copies in that budget; keep window lights, clay, horizon and animation on phones. Phones omit shadow maps; control distance and effects rather than removing the signature light. No screen-space AO in play.

The source quotes ~0.8 ms per initial light chunk and 6 ms per-frame budget on its own implementation, and the old Chatdom prototype measured ~2.2 ms per 32³ mesh (`Tech.md` §9.5); neither is a mobile guarantee. Measure actual p50/p95/p99 worker latency, queue depth, upload spikes, memory, draw calls and triangles on target devices, including edits across borders and a dense lit street. `Quality.md` asks for at least 30 fps on a mid-range phone, 60 where sustained, and no normal frame over twice target time. Budget worker execution and main-thread installs separately and prioritize visible edits; no visible seams or popping while results settle.

## Leave behind

Native OpenGL indirect multi-draw, 64-bit-only layout, WebGPU-only shader pipeline, benchmark claims as target-device promises, indiscriminate full-world relighting, and the reference art style. A fixed moving light volume needs a considered transition at its edge and walls must not leak under filtering; verify visually at dusk and night.

## License

Binary Greedy and WebGPU voxel engine are MIT: adapted code needs its original copyright and permission notice, a source/license header and a `THIRD_PARTY.md` entry. 0fps licensing for code is unverified: ideas only. Prototype is a read-only internal reference; reimplement rather than wholesale copy.

## Current consumer decisions — 2026-10-30

The terrain renderer keeps the 0.5 m voxel field and actual mesher as occupancy/AO/sky evidence, then emits
conforming 1 m surface patches in its worker. Displacing unconstrained greedy corners was rejected after a
measured 0.355 m crack at a T-junction. Shared-grid deformation, as used in Three's `PlaneGeometry` and the
studied Ultra-Water terrain, informs this original implementation; no source was copied. Ground contact must
sample the same triangle planes (`sampleRenderedTerrainHeight`), not the quantized top cells.

Render-only factor-2/4 detail is reduced from final painted occupancy in the voxel worker. Any occupied source
cell retains its coarse cell, with deterministic material mode, so thin walls/roofs survive. The caveat from
[0fps on isosurface simplification](https://0fps.net/2012/08/20/simplifying-isosurfaces-part-2/) applies: coarse
sampling changes topology. Original occupancy/window anchors remain authoritative; coarse envelopes may grow
0.375 m and close narrow gaps. This is an original implementation informed by the technique, not imported code.
