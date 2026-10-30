# The forge's mood (public refusal beat)

`createForgeRefusalPresentation({ root, anvil, caption })` draws the forge's nameless public mood: a small soot
cough, a sulk and a clean settle at the anvil, with one line from the shared pool. Spec 18 is the contract.

## Input

Only `{ kind: 'refusal', variant: 0 | 1 | 2 }` from `ForgePublicBeat`. The variant selects the line and nothing
else; every variant has the same movement, length and bounds. Anything else passed to `play()` is ignored.

| Variant | Line |
|---|---|
| 0 | The forge is in a mood tonight. |
| 1 | The bellows need a little breather. |
| 2 | Even the anvil has its moments. |

## Call pattern

The host admits, delays and frames the beat; this adapter never gates, schedules, reads a clock or looks at the
scene or DOM beyond what it is given.

```ts
import { createForgeRefusalPresentation, FORGE_MOOD_CAPTION_CLASS, FORGE_MOOD_DURATION } from './refusal';
import './refusal/caption.css';

// caption: a dedicated empty node with class FORGE_MOOD_CAPTION_CLASS, already placed in the forge shot.
const mood = createForgeRefusalPresentation({ root, anvil: [x, workSurfaceY, z], caption });
mood.play(beat);              // an admitted, delayed public beat; ignored while one is active
mood.update(secondsSincePlay); // every frame, from the host's clock; any value, any order
mood.dispose();               // idempotent; removes only the adapter's own group and clears the caption
```

- `root` has an identity world transform. The adapter adds one group (`forge-mood`) to it and removes only that.
- `anvil` is the anvil's work surface in world metres. On main's ritual stage that is the stage origin plus
  `y = 1.45`.
- Call `update()` past `FORGE_MOOD_DURATION` (or with an invalid value) to end the beat; it hides every owned
  effect and empties the caption. A new `play()` is accepted only after that.
- Before `play()`: clear identity UI and any accepted-request context from the shot. The adapter cannot know
  whether a name is on screen; anonymity of the shot is the host's precondition.

## Timings

| Seconds | What happens |
|---|---|
| 0–0.25 | Anticipation: the forge's embers appear and draw in; three soot crumbs swell at the anvil |
| 0.27 | One cough: up to 20 soot cubes burst up and toward the horn; the embers drop and scatter |
| 0.38–0.66 | The line fades in (6 px rise) |
| 0.8–2.3 | The sulk: the soot lingers and crumbles away; the embers droop low; a tiny sigh of 4 crumbs at 1.5 |
| 2.3–2.95 | Recovery: the embers perk up past normal with a small damped hop |
| 2.95–3.3 | The line fades out |
| 3.0–3.5 | Settle: the embers sink into the anvil and fade |
| 3.6 | Duration. Nothing owned remains visible |

## Budget

Three draws (instanced soot cubes, instanced ember cubes, one small additive glow), 24 soot and 14 ember
instances, no lights, no textures, nothing allocated per frame. Main's stage meshes and lights are never touched.
