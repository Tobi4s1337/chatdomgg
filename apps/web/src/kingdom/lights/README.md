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
- **The pool** (`voxel-material.ts`) replaces the squared field with `pow(field, 1.6) × 1.15`, coloured from a warm
  core through amber. With the flood's linear falloff, it reads about 0.55 at 3 m and 0.2 at 5 m in the 0.5 m local
  field, then rolls to zero without a ring. It reads fully from night ≥ 0.2 (about 18.5 h in today's grades) and
  is absent by day. Pool and beacon light share one soft cap (identity to 0.6, then asymptotic to 1.2), so
  overlapping warmth never clips plaster to white. Citizens use the same material, so faces and cloth in a pool
  warm with it.
- **Voxel glass** (`surface: glass`) no longer shows its amber albedo, which read as a lit window where nobody was.
  It reflects the same sky as an absent pane, plus a faint share of any nearby pool.

`createVoxelMaterial` gains `uSkyZenith` and `uSkyHorizon`, which `setEnvironment` sets from the existing
`Environment` fields. If KL02 retunes `night`, keep about 0.2 at 18.5 h, or move the `smoothstep(0., .2, uNight)`
pool gate with it.
