# Kingdom light

Warm light in the kingdom is people (spec 26). This folder holds the lane's presentation modules. `types.ts` is
main-owned and read-only.

## The people-lit light (`people-light.ts`)

Every light that wakes for passers-by, in every lane, runs on `createPeopleLight`, so lamps, place lanterns and
interior glows all rise, hold and fade the same way. It has no runtime imports (only the PeopleLight types and
`Vec3`), so place lanes can import the module directly without pulling in three.js, the scene or the light field.

```ts
import { createPeopleLight } from '../lights/people-light';   // or from '../lights' (the lane barrel)
import type { PeopleLight } from '../lights/types';

// Once, at mount. Positions are in whatever space the caller samples people in (usually world metres).
const lamp: PeopleLight = createPeopleLight({
  position: [x, y + 3.1, z],   // where the light is emitted: source().position
  near: [x, y + 1, z],         // optional: where reach is measured from (defaults to position)
  reach: 7,                    // metres, a sphere round `near`
  pilot: 0,                    // strength with nobody near (0–1, ≤ full)
  full: 1,                     // strength at capacity
  capacity: 1,                 // people at which it is full; fewer give a proportional share above pilot
  rise: .6, fade: 30,          // seconds pilot → full and full → pilot
});

// Every frame, with only accepted, visible, non-leaving people (filter stale and departure samples first).
const strength = lamp.update(time, positions);   // time: presentation seconds; positions: readonly Vec3[]
glow.opacity = strength * nightCurve(hour);      // callers apply their own hour curve and draw their own glow
sources.push(lamp.source());                     // stable object, structurally a LightFieldSource

// On epoch change or loss of fresh authority:
lamp.clear();                                    // strength 0, pilot included, until the next update
```

Defaults: `near = position`, `pilot = 0`, `full = 1`, `capacity = 1`, `rise = 0.6`, `fade = 0.7`. Construction
throws `RangeError` for non-finite vectors, a reach or capacity that is not positive, strengths outside 0–1,
`pilot > full` or negative/non-finite durations; `update` throws for a non-finite time or person position.

History is explicit:

- The first update after creation or `clear()` settles at the current target (a town opened mid-evening shows
  the people already there; it does not fade every lamp in).
- A repeated time never advances a rise or fade. A same-time call with different people redoes that frame's step
  from where it started.
- An earlier time is a seek: it settles at the target for the people given and does not reconstruct an unknown
  past fade.
- Exact replay of a capture: `clear()`, then feed the same recorded `(time, people)` trace.

`pilot` is unconditional while the light has history. A pilot that should only show while the stream is live
(the market and gate lamps) is gated by its caller: build the light with `pilot: 0`, take
`max(strength, live ? .12 : 0)` and emit that strength in the caller's own stable source.

The trace test (`people-light.test.ts`) covers a crossing, partial capacity, the fade, the pilot, repeated time,
reverse seek, replay after clear and input validation.

## The hours (KL02)

`getEnvironment(hour)` in `packages/render/src/atmosphere.ts` carries the whole grade. Noon is a saturated blue
zenith over a sky-blue horizon, with broken white clouds over about a third of the upper sky, a warm sun and blue
shadows. Dusk (19.25 h) is a lilac zenith over a gold band, with the sun low in the west-north-west, gold on the
west faces and indigo shadow sides. Night is deep blue to violet with a high moon. Besides the existing fields,
`Environment` gains `shadow` (what unlit surfaces sink toward), `glow` (the warm horizon band), `cloud`, `cloudShade`,
`cloudCover`, `fogDensity` and `exposure`. No field was removed, so every existing consumer still compiles and
reads the same values. By day the beacon is a small fire on the crown; its column and sky halo grow with dusk.

Most of the grade reaches the town through code the scene already runs: `createAtmosphere().update` (sky, clouds,
beacon), `clay/ground/forge.setEnvironment(grade)` (shadow tint, the hour's voxel fog, read straight from
`grade.fogDensity`) and `water.update(grade, …)`. Two scene lines are still constants. The integrator replaces them in
`apps/web/src/kingdom/scene.ts`:

```ts
// In the frame loop, after `const grade = getEnvironment(hour);` (scene.ts:257):
renderer.toneMappingExposure = grade.exposure;   // replaces the fixed 1.08 at scene.ts:49 (keep it as the initial value)
// scene.ts:289, beside the existing fog colour:
fog.color.set(grade.fog); fog.density = grade.fogDensity;   // was .0016
```

Day and dusk exposure stay at the shipped 1.08, so the noon and dusk frames below are already the integrated
look; night gains the 1.12–1.16 lift once the first line is in. Only three.js's built-in fogged materials
(today, the citizens' contact shadows) read the scene `FogExp2`, so the second line changes nothing else.

Evidence, captured from the real town (simulated Willowmere, `time=30`) with
`node apps/web/src/kingdom/lights/capture.mjs --views hero --hours noon,dusk --sizes desktop,phone`:
`work/evidence/kingdom-light-kl02/hero-{noon,dusk,dusk-grey}@{1440x900,390x844}.png`. The dusk greyscale has three
value groups: sky and beacon brightest, gold west faces and roofs in the middle, indigo shadow streets and grass
dark. Still weak: from the hero, the lit windows do not yet stand among the brightest values (KL05's pane and
pool), and the castle reads as a cool silhouette under its beacon until KL07 wakes its openings.

## Windows and warm pools (KL05)

No adapter change is needed: this lives inside the existing `createWindowLights` and `createVoxelMaterial`, which
the scene already constructs, updates with the hour and feeds with `getEnvironment(hour)`.

- **The presence pane** (`packages/render/src/presence-lights.ts`) is still one pane per citizen, with the 0.7 s fade,
  the LOD dither partition and named sources unchanged. A lit pane shows a lamp-lit room: brightest low and in the
  centre, amber at its edges, with dark frame and mullions whose inner edges catch the light. When the pane is only
  a few pixels across the town, it settles to its bright warm average so it can still be counted. An absent pane
  reflects the sky it faces (dark blue-grey at night, pale sky by day), using the hour's zenith, horizon and fog.
  The warmth follows `windowGlowForHour` (0 until 16.2 h, full from 18.5 h until dawn). By day a lit room shows only
  as a faint warmth behind the reflection.
- **The halo** is `WINDOW_HALO_SCALE` (1.3) × the pane. It is a thin warm spill on the reveal and frame, heavier on the
  sill, and never a blob on the wall. It is drawn only after dusk.
- **The pool** (`voxel-material.ts`) replaces the squared field with `pow(field, 1.3) × 1.3`, coloured from a warm
  core through amber. With the flood's linear falloff, it reads about 0.65 at 3 m and 0.3 at 5 m in the 0.5 m local
  field, then rolls to zero without a ring. The gentler power is for the ground: the flood is Manhattan, so the
  grass and path under a window sit a metre or two further from its source than the wall beside it, and a 1.6
  power left them barely warm. It reads fully from night ≥ 0.2 (about 18.5 h in today's grades) and
  is absent by day. Pool and beacon light share one soft cap (identity to 0.6, then asymptotic to 1.2), so
  overlapping warmth never clips plaster to white. Citizens use the same material, so faces and cloth in a pool
  warm with it.
- **Voxel glass** (`surface: glass`) no longer shows its amber albedo, which read as a lit window where nobody was.
  It reflects the same sky as an absent pane, plus a faint share of any nearby pool.

`createVoxelMaterial` gains `uSkyZenith` and `uSkyHorizon`, which `setEnvironment` sets from the existing
`Environment` fields. If KL02 retunes `night`, keep about 0.2 at 18.5 h, or move the `smoothstep(0., .2, uNight)`
pool gate with it.

### Evidence (current tree, SIMULATED willowmere town, time 30)

`work/evidence/kingdom-light-kl05/final-*.png`: window and citizen dusk at 1440×900 (the existing `camera=window`
and `camera=citizen` views); street dusk and night at 1440×900 and 390×844 through `__chatdomKingdom.pose` with
eye `[-104, 9.4, 64]`, target `[-104, 8.2, 32]` (fov 50 desktop, 64 phone) on the main street by Juniper's home;
hero night at 1440×900. The lane `capture.mjs` and `kingdomLightViews` belong to KL02/KL08; until then this pose is
the street recipe. Lit plaster peaks at about 210/255 next to a pane at night, so the cap holds. Still weak: green
grass takes warm light as olive rather than gold, so the ground pool reads best on paths and steps; the flood's
diamond shape is not visible at these distances, so no flood change is requested.
## Glass (KL04)

No adapter change is needed: glass lives inside the registry, the mesher, the field worker, `createVoxelMaterial` and
`createSunShadows`, which the scene already constructs. The near field must stay on `clay.setLight(volume)` (it is).

- **Registry** (`packages/content/src/materials.ts`, revision 4): glass stays `solid` for collision and is the only
  material with `occludesFaces`, `occludesAo` and `blocksLight` false. The mesher draws the reveal and room behind it,
  baked sky reaches the floor through it, and a wall in its place closes both.
- **Clay pass:** glass stays in the one opaque pass. Its fragments write fractional alpha-to-coverage (sky reflection,
  Fresnel, sun glint); without a multisampled target the same coverage becomes a 4×4 ordered pattern. No blending,
  no sorting, no second shell.
- **Sight:** visibility rays treat `surface: glass` as air; the wall and mullion beside it still occlude.
- **Field:** a half-metre cell that a glazed opening reaches is open when at least half its face has a clear straight
  line of build cells along the glass's wall normal; unglazed carves keep the conservative rule.
- **Sun casters** discard the glass kind, so frames and walls still cast.
- **Sun indoors** (`sunLine` in `voxel-material.ts`). The town sun map is 0.375 m per texel (0.75 m on phones), too
  coarse to find a window, and the baked sky factor `(.15+.85*vSky)` that hides its leaks also dimmed real sun. Under
  a roof (`vSky` below 0.85, fully below 0.55) a sun-facing fragment walks the near field's half-metre blockers toward
  the sun for up to 48 cells. A slab of whole blocker cells always costs at least one cell of path, so under 0.8
  cells of blocked path is treated as an opening's quantised edge and fades the line (a real 0.4 m reveal is not
  read as a one-metre tunnel; a solid wall or roof never leaks). The map then answers only for casters beyond where
  the line stopped (`sunShadowInAir`, no receiver plane, safe in the branch). The result can only raise the existing
  sun term. Fields without corner samples (ground, horizon, citizens) return 0 and keep today's light.
- **Cost:** one branch for every fragment; only sheltered, sun-facing ones pay up to 48 `texelFetch` steps plus one
  16-tap map read. No new render target, texture or draw. Wanted on a real GPU: frame time with the camera inside
  a sunlit room at 16 h (the `sun` pose of the evidence command) against the same pose at noon.

Evidence: `node apps/web/src/kingdom/lights/glass-capture.mjs --hours noon,afternoon,dusk --views street,room,sun`
after `pnpm build` (slot 44, the emberfold cottage, the deepest presence window facing the late sun).
