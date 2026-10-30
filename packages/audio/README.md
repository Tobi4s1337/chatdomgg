# @chatdom/audio

The kingdom's cue library: one Web Audio context per instance, a single mix path, selected CC0 foley combined with
original synthesis. Sources and edits: [THIRD_PARTY.md](THIRD_PARTY.md).

```ts
import { createKingdomAudio } from '@chatdom/audio';

const audio = createKingdomAudio({ volume: 0.65 }); // no context, no sound yet
button.onclick = async () => { if (await audio.unlock()) audio.cue('light'); };
```

## Finished families

| Cue | Surfaces | Variations |
|---|---|---|
| `wood` | `ui: 'wood'` (default) | centre, edge and corner knocks of one carved block, gone in ~120 ms |
| `wood` | `ui: 'brass'` | a brass lever in a wooden mount, tuned to A6, A6, B6 and finger-damped within ~200 ms |
| `wood` | `ui: 'parchment'` | three page turns of one sheet, each with a slide and a soft settle, ~200 ms |
| `light` | — | three windows on F♯4, A4 and D5, ~1.8 s |
| `wave` | — | five windows lighting along a street (left to right, right to left, from the middle), ~2.5 s |
| `beacon` | — | the torch, the fire catching and a broad D-major chord that crests at ~1.1 s and is silent by 4.95 s |
| `step` | `material`: 6 surfaces | a foot on floorboards, flagstones, a packed path, an iron plate, a glass tile or a rug; 40–200 ms |
| `place` | `material`: 6 surfaces | a palm, then a timber block, dressed stone, clod of soil, iron fitting, glass block or folded cloth settling into place; 50–220 ms |
| `remove` | `material`: 6 surfaces | the same piece unseated and lifted: a light contact of the material, a soft breath of lift, grit or soil falling back; never a smash |
| `material` | `material`: 6 surfaces | the piece handled in the fingers when it is chosen: a small knock, two pebbles, a pinch of soil, a damped clink, a nail on glass, a corner of cloth |

`light`, `wave` and `beacon` share one palette (D major pentatonic, `src/palette.ts`), the same glass panes and the
same wick, and rise in loudness gently: about +0.5 dB from a window to the street and +6 dB to the beacon's crest.
For `step`, `place`, `remove` and `material`, an omitted `material` means wood. Each surface keeps its own
recordings and resonance (`src/cues/materials/`); the palm, fingertips, lift and grains are shared
(`handling.ts`), so building with stone and with cloth sounds like the same person at work. Tuned materials (metal,
glass) sit in the same D major pentatonic palette as the light. Every family has three takes and never repeats a
take twice in a row on one surface.

Levels, set across all six surfaces at volume 0.65 (approximate momentary loudness, 400 ms window): footsteps about
−39 LUFS (cloth −42), choosing a material −40, lifting −38, setting a piece −33 to −35, beside the wooden control at
−35.6 and a window lighting at −32. Footsteps stay under a voice; setting a piece answers like a control press. Each
material family has a fader in dB next to its definition.

Mapping real world or build data to a surface belongs to the consumer, as does not calling `step` while an avatar
stands still.

## State

- `unlock()` must be called from a user gesture. It makes and resumes the context synchronously inside the
  gesture, decodes the foley, and resolves `true` only when a resume has resolved and the context is running.
  A browser that parks the resume (Chrome does when there was no gesture) gets an answer of `false` after
  2.5 s; status stays `locked`. A later gesture's unlock still works. Repeated unlocks are safe.
- `suspended`: the browser or device paused a context that was running. Every voice is stopped at that moment,
  so nothing replays when it comes back; cues return `false` until it runs again.
- `cue()` returns `true` only when the sound was scheduled audibly. It returns `false` when locked, suspended,
  unavailable, disposed, muted, at zero volume, when a needed recording is not decoded, for a non-finite `pan`
  or `distance`, and when the mix budget or duplicate coalescing holds it back. It never queues.
- `setSettings()` ramps the master over 30 ms. Muting fades to exactly zero and stops ringing tails under the
  fade. `volume` is clamped to [0, 1]; a non-finite volume throws.
- `dispose()` stops all sources, disconnects the graph and closes the context. An unlock still pending resolves
  `false` and cannot bring the instance back.

## Mix

Voices → bus → 35 Hz rumble guard → glue compressor → master (volume²) → soft ceiling (linear to 0.7, never above
0.91) → output, with a send into a short authored wooden room. Conservative cue gains and the voice budget keep the
mix far below the ceiling; the ceiling is a guarantee, not the level control.

- **Budget:** at most 16 voices and 64 source nodes per instance, counting every layer until it has stopped. Each
  tier may only fill the whole mix up to its own ceiling, which reserves the room above it: footsteps 8 voices /
  28 sources, placing, lifting and choosing 12 / 34, the light ceremony 13 / 40, the beacon 15 / 58, controls
  everything. So the beacon (18 sources) and a control (3–6) always fit, and a control still answers during the
  beacon. A cue that does not fit returns `false`; nothing is queued.
- **Footsteps give way:** when the mix is full, a building cue may fade out the quietest footsteps, and a footstep
  may fade out footsteps at least 3 dB quieter than itself (your own feet walking past a crowd). They fade over
  20 ms, never a hard cut. While they fade they are left out of the step and build ceilings only, within an
  allowance (step 6 voices / 12 sources, build 2 / 6) that keeps those tiers at or below 14 voices and 40 sources,
  so the beacon and control reserve above still holds. They always count against the hard 16 / 64.
- **Coalescing:** the same cue on the same surface within 40 ms plays once, unless the newer call is at least 3 dB
  nearer (a step beside you is not a duplicate of one across the square).
- **Variation:** never the same variation twice in a row for one family on one surface.
- **Placement:** `pan` is clamped to [-1, 1]; `distance` (metres, ≥ 0) attenuates by `1 / (1 + distance / 8)`:
  full gain at 0 m, −6 dB at 8 m, −12 dB at 24 m. Beyond 1 m the air also softens the top: a low-pass at
  `18 kHz / (1 + distance / 6)`, never below 1.2 kHz (7.7 kHz at 8 m, 3.6 kHz at 24 m). A non-finite `pan` or
  `distance` makes `cue` return `false`. UI cues should pass neither.

## Diagnostics

`inspectKingdomAudio(audio)` reports the context state, decoded recordings and failures, live voices and sources,
last variations and the live output peak. `renderKingdomAudio(script, { duration })` renders a timed script
through the same families, mixer and mix path in an `OfflineAudioContext`. Both are for the bench and checks;
consumers only need `createKingdomAudio`.

`pnpm --filter @chatdom/audio check` runs the one focused regression (`src/budget.test.ts`): two seconds of a
footstep flood on every surface against the real families and mixer, counting the source nodes a Web Audio context
would actually be running, while a control, the beacon, your own nearby steps and a placed block must still play.
