# SO10 — live kingdom seam

`main-soul.patch` is an exact proposed patch against the lane's base. `git apply --check work/lanes/soul/main-soul.patch` passes. It is a proposal, not an applied or live-tested change: kingdom, stream, and renderer source remain main-owned.

## What the patch connects

- `Kingdom` and `SceneOptions` accept `SoulSceneBinding`. Stream mounting forces its stream mix.
- The scene owns `createSoulSceneHost`, advances it with absolute time and real present windows, supplies the current camera listener, feeds civic emitters to its existing light field, and disposes the layer with the scene.
- The sound owner exposes its existing, unlocked, audible host. Soul creates no context and replaces the old air/water ambience only while mounted. Hidden, muted and closed hosts return null.
- Witnessed moment sounds duck the land/music for their bounded cue duration. The host also exposes `duck({ depthDb, seconds })` for main's Voice consumer; a rendered frame never cancels an active duck.
- Existing clay shader uniforms receive wetness and snow. The proposed shader extension darkens exposed roof/stone/terrain and applies snow to upward exposed roof/terrain faces. Zero weights retain the existing scene. This shader proposal still needs main's real scene compilation and visual review; the soul review demonstrates the independent standard-material surface adapter.
- The director's sky hour stays authoritative. Keepers and weather follow absolute kingdom time, rather than a client's elapsed animation. Only explicitly simulated fixed scenes may supply `soulEpochMs` for evidence.

## needs: supply installed civic sites, then demonstrate the actual walk and stream

Main must construct and pass a `SoulSceneBinding` from the founded kingdom's actual civic geometry: connected public routes, civic street-lamp anchors with measured progress along the lamplighter route, the bakery chimney mouth, and a real open forge/quay. The topology validator accepts local circuits up to 1,000 metres / 100 segments; the presentation accepts 64 lamps per district. Larger places need local district bindings, never default demo coordinates stretched across the town. The actual audience count is internal only; it must never appear on stream.

`config` carries the kingdom's stable numeric seed, biome, local UTC offset and topology. `config.shipArrivals` contains only witnessed arrival epochs. Omit absent places, particularly a harbour; never repurpose a citizen's home as a civic bakery without an authored civic placement. Optional `surfaces` refers to distinct, caller-owned standard-material roofs, snow caps and puddles; the existing packed voxel material uses the shader proposal instead.

This binding is deliberately not guessed from a plot count, a random street or an undocumented shared-contract field. No shared contract has been changed in this lane. The review route is an explicitly simulated district using the same world/audio modules and surface adapter; it is not proof that main's public kingdom has mounted them.

After applying and binding, main should look at the existing kingdom and stream at dawn, rain, dusk, night and winter (1440×900, 390×844 and 1920×1080), walk both keeper routes, check collisions and civic-light cost, and hear the stream mix under a real voice. Until that seam is installed and demonstrated, the PRD's whole-kingdom SO10 checkbox remains open.
