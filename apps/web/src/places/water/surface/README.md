# Water surface: depth, shore, foam, flow and reflections

`apps/web/src/places/water/surface/` draws every supplied water of a place (lake, millpond, stream, leat and
tailrace) with one material and at most one planar reflection pass per frame. It reads the land's own records:
`WaterBody` outlines and the `WaterReach` flow that `deriveWaterReaches` derives from the land's streams
(`packages/world/src/places/water`). It never routes, carves or levels anything.

## API

```ts
const water = createWaterSurface({
  bodies,            // readonly WaterBody[]: still basins (at most 4)
  reaches,           // readonly WaterReach[]: deriveWaterReaches(landform)
  ground,            // { data: Float32Array, width, height, origin: [x, z], step }: the caller's terrain heights (bed)
  contacts,          // optional WaterContact[] (≤ CONTACT_CAP = 48): piles, stones, hull sides, weir crests
  quality,           // 'full' | 'reduced'
  reflection,        // optional { scale ≤ 0.5 (default 0.5), maxEdge (default 1024) }
});
scene.add(water.root);

// Every frame, in this order:
water.update({ time, environment, camera, sources }); // sources: WaterLightSource[] from the caller
water.reflect({ renderer, scene, camera, frame, exclusions }); // W-M3: the host's explicit reflection hook
renderer.render(scene, camera);

water.setQuality('reduced' | 'full'); water.setContacts(contacts);
water.waterAt(x, z);   // { id, level, depth } | null, as drawn
water.diagnostics();   // quality, reflection mode/failure/passes/size/format/bytes/pass cost, plane, pillars, bytes
water.dispose();       // removes root; disposes only its own geometries, materials, textures and target
```

`WaterLightSource` is `{ position, strength 0..1, kind: 'window' | 'beacon' | 'lamp', normal?, size? }`. The host
passes what it actually has: `createWindowLights().getSources()` as windows (with their normals), the beacon at
its anchor with the atmosphere's strength, and place lamps from `createPeopleLight().source()`. Strength 0 draws
nothing; no source is invented.

## What it draws

- **Depth and shore.** The bed is the caller's ground grid, sampled with the terrain mesh's own diagonal, so the
  waterline meets the visible bank exactly. Colour is Beer–Lambert absorption along the view through the water's
  thickness, written premultiplied over the real bed: the shallows show the actual bed, pebbles and stones
  through turquoise, and depth turns them blue. Night keeps a cool body, never black. The shore has no rim: only
  coverage antialiasing at depth 0.
- **Ripples.** Three filtered wind waves on still water (stronger on basins than on sheltered courses). Each fades
  as its phase changes faster than about a pixel, so nothing crawls at a distance.
- **Flow.** Two-phase advection of short crossing ripples along each course's derived flow. Each layer jumps to a
  fresh pattern offset only at its zero weight, so neither a reset nor a reach join (equal velocity, by the world
  derivation) shows. Detail scales with speed and slows toward the banks, so the bridge pool stays nearly still.
  Phases and offsets are computed on the CPU in double precision from caller time (`waterPhases`). A backward
  seek gives the same frame.
- **Foam.** Only at supplied contacts (a segment or point with a waterline radius and a strength) and in fast,
  shallow course water. It is broken by advected noise and dimmed at night. No outline is drawn around every prop.
- **Reflections, full quality.** One mirrored camera with an oblique near plane on the chosen water plane, into a
  half-resolution target (half float when the device can render it, otherwise 8 bit). The plane is the visible
  level with the most water per distance². Water within 10 cm of that level samples the target with ripple
  distortion and soft vertical streaking. Roofs keep their silhouettes and lit panes become rippled pillars.
  Between 10 and 25 cm off the plane it fades to the reduced path, so a sloping course shows no seam.
- **Reflections, reduced quality.** The analytic sky (zenith, horizon and the sun-side glow of the hour) plus at
  most `PILLAR_CAP` = 24 analytic pillars a frame. A pillar is drawn only for a lit source whose mirror image is
  in (or streaks into) the view, whose reflection point is real supplied water, and whose emitter faces that
  point. The beacon is always kept. The others are ranked by strength over distance, with ties broken by source
  order. Valid sources over the cap are dropped and counted in `diagnostics().pillars.dropped`. Lamps and the
  beacon are analytic on both paths, because their glow is presentation rather than scene geometry. Windows on
  the reflected plane come from the planar image.
- **Fallback.** If the target cannot be rendered to (incomplete framebuffer, or the pass throws), the surface
  switches to reduced and records `diagnostics().reflection.failure`. `update` invalidates the previous
  reflection every frame, so a host that skips `reflect` gets the reduced path, never a stale or black image.

## W-M3 recipe for the renderer host (integrator)

The integrator owns `scene.ts`. To replace the old water exactly once:

1. Build `bodies` from the adopted `KingdomLandform.waters`, `reaches = deriveWaterReaches(landform)`, and the
   kingdom terrain height grid (`heightData`, `heightWidth`, `heightDepth`, `heightOrigin`, step 1). Remove the
   `createWater` call and its `water.update` and `water.dispose`.
2. Each frame, after the atmosphere, fog and grade updates and the sun-shadow update:
   `water.update({ time, environment: grade, camera, sources: [...windows.getSources() as windows,
   beacon, ...place lamps] })`, then `water.reflect({ renderer, scene, camera, frame: frameCounter, exclusions })`,
   then the normal render. Never call `reflect` from an `onBeforeRender`: a nested call is refused and counted.
3. `exclusions`: the atmosphere's sky dome, beacon shaft, halo and crown billboards (they follow or face the real
   camera; the water draws the sky and the beacon pillar itself) and any presentation-only glow sprites. A
   render-side accessor for the atmosphere's objects is a needs for `packages/render`. The bench finds them as
   the scene children `createAtmosphere` adds.
4. The pass restores the render target, cube face, mip level, viewport, scissor and scissor test, clear colour and
   alpha, clipping planes, local clipping, `autoClear`, `shadowMap.autoUpdate` and `needsUpdate`, `xr.enabled`, and
   every hidden object's own visibility, in `finally`. It never re-renders shadow maps.
5. Choose quality per device: `full` on laptops and the stream view, `reduced` where the pass is too costly.
   Show `diagnostics().reflection.failure` outside the scene.
6. Dispose: `water.dispose()` before the renderer. The ground array, scene, camera and renderer remain the
   caller's.

## Costs (bench, SwiftShader, 1440×900, night; `node apps/web/src/places/water/surface-bench/capture.mjs`)

| View | Water draws | Water triangles | Reflection pass | Main pass | Target | Pillars |
|---|---|---|---|---|---|---|
| lake-postcard | 1 (one basin) | 2 | 17 calls, 368k tris | 21 calls, 371k tris | 720×450 RGBA16F + depth, 3.89 MB | 11 drawn of 13 sources (2 dark), cap 24 |
| bridge-pond | 4 (pond, stream, tailrace, leat) | 338 | 33 calls, 143k tris | 42 calls, 146k tris | 720×450 RGBA16F + depth, 3.89 MB | 0 of 4 lamps: each reflects onto the bank (dry), honestly none |

The ground height texture is the caller's grid at 4 bytes per sample: 313 KB for the lake fixture, 64 KB for the
millrace. Reduced quality frees the target, so its reflection bytes are 0. The pass roughly doubles scene draw
calls, because it re-renders the clay scene from the mirrored camera. That is the main real-GPU question: frame
time on Tobias's machine, the full path at 1440×900 and 1920×1080, and whether a `scale` of 0.35 is needed on
phones.
