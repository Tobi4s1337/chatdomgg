# Artisan review bench

A standalone development-only entry, `/src/grand/artisans/review.html`, renders the art kit in this checkout.
It is a simulated model review, not the grand renderer, an inhabited kingdom, production LOD, a collision
or presence demonstration. The standalone HTML uses the Vite dev server. For the grand entry, the builder may mount the exported
`ArtisanReview` Solid component behind `artReview=1`; that owner controls routing and production registration.
Acquire the shared capture lock around each individual still or clip.

`?kit=forest|tree|geology|water|fields|windmill|harbour|ship|lighthouse|quay|pier|landing|citadel|walls|composition`
selects a kit. `channel`, `seed`, `species`, `view=hero|street|coast|dusk`, `hour`, and `lod=0|1|2|3`
fix the review parameters. `tree` and `forest` accept `species=gold|pine|cherry|teal|birch|willow`.
The default channel is `tobi4s_`. Unknown or missing kits fail visibly instead of showing substitute content.

The review-only mesher builds an opaque union of the ordered half-metre boxes, removes internal faces and
merges coplanar rectangles only when material and all four sampled corner-occlusion values agree.
Corner shading darkens contacts and flips the triangle diagonal across occlusion saddles; it is bench lighting,
not proof of the production renderer’s ambient-occlusion or bevel shading. Above 64 million cells it increases its review LOD until bounded;
`window.__artisanReview.stats` reports both the requested and actual levels. This coarse union can hide thin
features and is not a seamless or error-bounded production LOD. It does not prove grand streaming or motion
through LOD transitions. Camera motion can be scripted with `window.__artisanReview.setOrbit(angleRadians,
distanceScale)`. `window.__chatdomReady` is set only after the first frame finishes. All captures are labelled
SIMULATED because they do not represent installed channel geometry or live presence.

Composition studies include unoccupied accepted cottage geometry at each `home-N` anchor, using the native
0.125 m build lattice and ordered air carves. These are shared mesh instances of three variants, with the
channel's review style, not claims about installed homes or live occupancy; their windows remain unlit.
The four named anchors `hero`, `street`, `coast`, and `dusk` set the corresponding camera focus where present.

`mountArtisanReview(root, params)` is also exported for host integration; it scopes DOM lookups to `root`
and resolves to a cleanup function that removes resize listeners and disposes GPU resources. The component
handles cleanup even if it unmounts during asynchronous kit loading.
