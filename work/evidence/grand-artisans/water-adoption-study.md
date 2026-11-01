# Grand water dressing — adoption study

Terra high, 2026-11-01. This is a candidate, **not accepted visual evidence**. The parent owns the capture queue; no screenshot or service was started here.

## Grounded problem

I looked at `shots/grand-artisans/in-land/tobi4s_-orbit-hour17.6@1440x900.png` and the harbour still beside it: numerous bright, nearly uniform vertical bands dominate the ridges and distract from the river and coast. These are older proof shots, not evidence for the current merged producer's appearance.

In the current `packages/render/src/grand/terrain-material.ts`, **every vertical kind-9 face** is treated as a waterfall. Its mix factor to near-white is `.45 + .5 * foam`, so even zero foam drives the result 45% toward near-white, and full foam 95%. `voxelize.ts` uses `M.water` for above-sea water without distinguishing a river's banks, face of a drop or water exposed by coarse sampling. `terrain.ts` keeps a temporary `Shaped.fall` mask, but `generateGrandLand` discards that mask and the D8 receiving-edge graph. Therefore the renderer does not have evidence to classify every vertical water face as a waterfall. Reducing foam's dominance can improve the image, but it cannot fix hydrological joins or prove a receiving pool.

## Candidate

`packages/world/src/grand/artisans/geology/water.ts` exports:

- `GRAND_WATER_DRESS_GLSL`: world-position-stable water dressing. Vertical kind-9 faces retain their water body, with at most 40% pale turbulence (rather than a 45–95% near-white wash); time scrolls a coherent field down the face. Horizontal water retains the existing sky/Fresnel model with a more restrained glint. It introduces no new light or fake presence. It is explicitly an appearance candidate: the numerical cap is on the **mix coefficient**, not a promise about output luminance after lighting, HDR and tone mapping.
- `createWaterDressSampler({size, ground, water})`: deterministic observations of the producer's existing source column fields. It reports wetness/depth, known dry neighbours and a lower adjacent wet neighbour. This is diagnostic presentation data, **not** a directional flow solution, connected-drop proof, a collision query or a substitute for the original fall/receiving-edge data. Coordinates and heights are half-metre source cells; top values are y+1. Out-of-range coordinates return null; missing neighbours at bounds are unknown, not dry shores. A row never wraps into the next one.

`water-adoption.needs.patch` is an exact minimal renderer-side integration patch against the current `packages/render/src/grand/terrain-material.ts`; `patch --dry-run -p1 -i work/evidence/grand-artisans/water-adoption.needs.patch` passed. It imports the candidate GLSL, injects it after `GRAND_COMMON`, and replaces only the kind-9 shading branch. It does not alter the producer, canonical water, occupancy, sea reflection, collisions, water material IDs, or shared contracts. There is no safe producer patch here that can recover discarded flow direction by inspecting adjacent water heights: ordinary stepped reaches and overlapping surface fields can present the same local evidence.

## Producer need

`needs:` grand builder: retain a bounded, versioned **source-derived** drop/receiving-edge description when compiling `Shaped` to `GrandLand`; carry it coherently through worker generation, cache invalidation, halo and LOD so the renderer can distinguish a real waterfall face from a river bank. A valid edge must name existing wet upper and lower reaches, encode world-aligned endpoints and levels, and be generated from the actual `down`/`filled` path, including outlet and pool. Do not generate a drop from the observer's `largestWetDrop`. Determine whether this is an internal typed array or compact indexed record after measuring byte cost: one extra byte per full 1536² land is 2.25 MiB per copy, and the current worker flow clones land to the main thread and each worker. This needs a separate producer/worker patch and cache-version migration, not a speculative local write here.

Required producer regressions: follow every emitted drop to a wet receiving reach; no downstream rise; no interior void or invented water at dry banks, chunk/region boundaries or mouths; matching world-position source/halo results across neighbouring regions and LOD; stable output under seed; invalidation when source changes. Visual proof must show the same fixed waterfall, lake, river mouth, coast and dusk views before/after, plus an orbit across LOD transitions. Real GPU measurement is still needed for cost and motion.

## Verification

`pnpm exec vitest run packages/world/src/grand/artisans/geology/water.test.ts`: 4/4 passed, covering real column conventions, no fabricated receiving pool, no row wrapping, unknown outer bounds and malformed arrays. Scoped ESLint passed. The GLSL candidate has **not** been compiled in a browser, visually reviewed in the actual land, timed on a GPU, or accepted; do not call GA10 complete on the strength of these tests.

Parent checkpoint update: see REVIEW-06.md for the later looked evidence, final validation, exact capture limits and paused state. Earlier verification statements above describe the child handoff time.
