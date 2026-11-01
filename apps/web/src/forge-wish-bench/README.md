# Forge piece review

A standalone art review entry, not a wish submission or kingdom route. It assembles an authored plan against
the real home/socket, runs `checkForge`, meshes through the voxel worker and uses the production voxel material
and environment palette. It has no people, model gate, coal or authority. It omits the kingdom's post effects
and placement emitter effects; a still here cannot establish an end-to-end wish or full dusk lighting.

After building the web package, open:

`/src/forge-wish-bench/index.html?view=home&style=hearth&motif=crescent-moon&hour=14`

`view` accepts `home` or `piece`, `style` accepts `hearth`, `tide`, `grove`, and `motif` accepts the seven
registered Forge motifs. Home view stands twelve horizontal metres from the actual front facade; the camera
fits the viewport without changing that distance. Piece view frames occupied geometry, including its support.
Readiness is `window.__chatdomReady`; errors are `__chatdomForgeWishError`. `__chatdomForgeWish` exposes the
actual socket, origin, bounds, camera distance and viewport for capture inspection.

The lane's `work/lanes/forge-wish/capture-art.mjs` captures production builds on an owned preview inside the
GPU lease. Its fallback takes one still under the host capture lock only when the GPU tunnel is down. It
closes only its own preview/browser. The main preview is never used or replaced.
