# Bounded dressing study

Entry: `apps/web/src/grand/artisans/dressing/index.html`. Query `kit=source-fields` or `source-water`, `channel=tobi4s_`, `view=hero|street|coast|dusk`, `hour=17|19`, and optionally `crop=wheat|lavender|cabbage` (missing requested crops fail rather than substituting). The page exposes `__artisanReview.stats` and sets `__chatdomReady` only after compilation, rendering and `gl.finish()`.

It generates the real deterministic channel land and selects a 64×64 source-column region. Ground-top material comes from the existing voxelizer; fields overlay the proposed sampler and plot-relative furrow rule, while other columns retain original producer decor. The water specimen derives its shape from real inland ground and water columns and compiles `GRAND_WATER_DRESS_GLSL` with `GRAND_COMMON`, source-world noise coordinates and the linear land water palette. Its fixed light is a material fixture, not the production PCF-lit scene. The land and producer are not patched. The displayed ground is a one-cell surface slice, water is clipped to eight cells of depth, and the field result is a candidate overlay; it cannot establish production integration, full landscape composition, collision, LOD, shadow or real GPU performance. Counts in the page describe only the reviewed region; crop stats identify the actual chosen plot.

Capture and visual judgment are owned by the parent thread. Scoped ESLint passed; no local capture or server was started.

Parent checkpoint update: see REVIEW-06.md for the later looked evidence, final validation, exact capture limits and paused state. Earlier verification statements above describe the child handoff time.
