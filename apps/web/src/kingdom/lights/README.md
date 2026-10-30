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
