# Effects library: handoff to main

The library lives in `packages/render/src/effects` (spec 48). It is not yet exported from `@chatdom/render`; main owns
that export and every `apps/web` call below. Nothing here changes `packages/shared`.

## What it draws

| Family | Input | Look |
|---|---|---|
| Fireflies | `fireflies: EffectSource[]` (hedge or meadow spots) | Sparse warm 2–3 px glints that blink a few times a minute |
| Embers | `embers: EffectSource[]` (just above real flames) | Rising squares that wander, lean with the wind, cool from gold to red and go out; lives differ in lean and brightness |
| Smoke | `smoke: EffectSource[]` (real chimney mouths) | Soft grey voxels: they leave the mouth small and fire-warm underneath, rise about 1.5–2 m, curl, lean with the wind, grow and thin out. Not emissive; the grey takes the hour's hue from `scene.fog` |
| Dust | `dust: ShaftSource[]` (real light leaving a real opening) | Faint pale motes, below the bloom threshold, only inside the cylinder; fade at the rim and both ends. No beam is drawn |
| Sparks | `sparks: SparkBurst[]` (a real impact) | A 0.14 s white-hot flash, then short streaks thrown up and out that cool and fall; all gone within `SPARK_SECONDS` (1.05 s) |
| Flight | `flight: FlightCue` (the real flying piece) | The piece's gold glint with a few rune-pale motes, plus a warm trail of glints pinned where it actually was, fading over 0.75 s |

Two draws in total: one for glints and one for smoke voxels. Both use normal blending, depth test and no depth write, take
the scene's fog, and are clamped in screen pixels per tier. `diagnostics()` reports counts, sources per family, skipped
inputs, remembered bursts and a coverage bound.

## Switching it on in the kingdom (main)

One instance per scene, created once, after the post stack:

```ts
import { createEffects, presenceChimneySmoke, fireEmbers, forgeSparks, forgeFlightCue, createFlightRecorder } from '@chatdom/render';
const effects = own(createEffects({ scene, camera, seed: hashOf(options.seed), quality: canvas.clientWidth < 600 ? 'low' : 'balanced' }));
const flightPath = createFlightRecorder();
```

### 1. The stream cue: presence → chimney smoke (ready to wire now)

Today `apps/web/src/kingdom/home-life/index.ts` draws its own puff quads from the same presence frame. The adapter
gives the same cause (someone present in a home, after a short settle) as library smoke from the same authored mouths:

```ts
// apps/web/src/kingdom/scene.ts, in the frame loop beside homeLife.update(presentationMs, time, lightFrame, hour, camera):
effects.update({
  time, wind: [.45, 0, .15],
  smoke: [...presenceChimneySmoke(lifeSites.homes, lightFrame, presentationMs),
          ...forgeSites.noses.map((position, i) => ({ id: `forge:nose:${i}`, position }))],
  embers: [...fireEmbers(lifeSites.braziers, 'gate'), ...fireEmbers(forgeSites.fires, 'forge')],
});
```

Sample input and output (from the tests):

```ts
presenceChimneySmoke(
  [{ slot: 1, mouths: [[1, 4, 1], [1.6, 4.2, 1]] }, { slot: 2, mouths: [[8, 4, 2]] }],
  { …frame, connection: 'fresh', windows: [{ slot: 1, present: true, since: 9000, … }, { slot: 2, present: true, since: 9800, … }] },
  10_000)
// → [{ id: 'home:1:chimney:0', position: [1, 4, 1] }, { id: 'home:1:chimney:1', position: [1.6, 4.2, 1] }]
// (slot 2 joins once it has been present for HEARTH_SETTLE_MS = 700 ms; a stale or missing frame gives [])
```

Then remove the puff mesh from `createHomeLife` (keep its lanterns and light sources), and remove the `kind: 'smoke'`
landed entries passed to `forgeBreath` for the forge noses. The wide view's distance thinning now comes from the tier
budget: the nearest `smoke.sources` chimneys in view breathe (4 / 8 / 14).

### 2. The Forge: strike sparks, flight trail and landing sparks

```ts
// Where the Forge presentation already has the frame and the piece's animated world position:
const cue = forgeFlightCue(ritualFrame, pieceWorldPosition, time, FORGE_STAGE_TIMING, flightPath.history());
if (cue?.active) flightPath.record(cue.id, time, cue.position);
effects.update({
  time, wind,
  sparks: forgeSparks(ritualFrame, { anvil: anvilWorld, landing: landingWorld }, time, FORGE_STAGE_TIMING, CONTACT),
  flight: cue && { ...cue, history: flightPath.history() },
  /* the ambient families from step 1 */
});
```

`FORGE_STAGE_TIMING` comes from `@chatdom/forge` and `CONTACT` from `apps/web/src/forge/presentation/stage.ts`. Each
burst is named by ritual and impact (`forge:<ritualId>:strike`, `forge:<ritualId>:landing`), so it plays once.

### 3. Dust and fireflies

There are no shaft volumes in the kingdom yet. When main adds authored shafts (golden hour through a gap, the beacon
or an interior window), pass them as `dust`. Fireflies need meadow or hedge spots from the dressing plan at dusk hours.

## needs: for main

- needs: export `createEffects`, the adapter functions and types from `packages/render/src/index.ts` (`export * from './effects'`).
- needs: wire step 1 in `apps/web/src/kingdom/scene.ts`, retire the home-life puff quads and the forge-nose smoke in
  `forgeBreath`, dispose `effects` in the scene's `dispose()`, and call `effects.setQuality` where the post stack
  quality changes.
- needs: wire step 2 in the Forge ritual view and replace the presentation's own flight trail and strike sparks.
- needs: shaft volumes (position, direction, length, radius) from whichever system owns light shafts, before dust
  can appear in the kingdom.
- needs: a real-GPU look at `bench.html?view=stream&time=12` and `?view=street&time=12` (served by `capture.mjs` or
  by any Vite server rooted at `packages/render/src/effects/bench`), at 1920×1080. Check: the smoke reads as grey
  voxel puffs, not boxes; sparks streak and do not flicker; the glint layer's frame cost stays small. SwiftShader
  timings are not evidence.

## Bench

`node packages/render/src/effects/bench/capture.mjs --views street,wide,stream --time 12 [--effects off] [--quality low|balanced|high]`
writes `shots/effects/<view>-t<time>-<quality>@1920x1080.png`. All inputs are SIMULATED and the seal says so: seven
real hearth homes (five present, two dark), the smithy with its dragon flue, two gate braziers, the meadow under the
hedge, the near hut's window light and the forge mouth's light as shafts, and an eight-second cue loop (a strike at
3.7 s, a flight from the forge to the near hut's roof from 2.8 s to 5.4 s, landing sparks at 5.4 s).
