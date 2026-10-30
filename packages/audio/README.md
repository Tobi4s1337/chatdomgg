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
- `suspended`: the browser or device paused a context that was running. Every voice is stopped at that moment
  and the mix front is replaced (below), so nothing replays when it comes back, not even the room's tail; cues
  return `false` until it runs again.
- `cue()` returns `true` only when the sound was scheduled audibly. It returns `false` when locked, suspended,
  unavailable, disposed, muted, at zero volume, when a needed recording is not decoded, for a non-finite `pan`
  or `distance`, and when the mix budget or duplicate coalescing holds it back. It never queues.
- `setSettings()` ramps the master over 30 ms. Muting (or volume 0) fades to exactly zero; every ringing voice and
  the mix front fade out with it, so unmuting, however soon, starts from silence. `volume` is clamped to [0, 1]; a
  non-finite volume throws.
- `dispose()` stops all sources, disconnects the graph and closes the context. An unlock still pending resolves
  `false` and cannot bring the instance back.

## Mix

Voices → bus → 35 Hz rumble guard → glue compressor → front fader → master (volume²) → soft ceiling (linear to
0.7, never above 0.91) → output, with a send into a short authored wooden room. Conservative cue gains and the voice
budget keep the mix far below the ceiling; the ceiling is a guarantee, not the level control. At full volume the
complete demo sequence, including the crowd burst, peaks at 0.47 (−6.5 dBFS).

- **Interruptions:** everything before the master that remembers sound (the room's 0.8 s convolution, the filters,
  the compressor's gain reduction) is the front. Muting retires it under the same 30 ms fade as the master and
  builds a fresh one; a browser suspension cuts it at once, while nothing is rendering. Old voices finish on the
  old front, new voices start on the new one. The retired front is released when its fade has passed in render
  time, so the same thing happens live and offline.

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

## Phrases (the Forge)

A consumer that needs its own short phrase, such as a Forge phase, plays it through the same instance instead of
reaching for the context:

```ts
import { noteHz, playKingdomPhrase, type KingdomPhrase } from '@chatdom/audio';

const strike: KingdomPhrase = { key: 'forge:strike', tier: 'beacon', build(voice) {
  const body = voice.gain(1); voice.chain(body, voice.out); voice.room = 0.2;
  voice.partial(body, 'triangle', noteHz('D2'), voice.t, 0.004, 0.2, 0.3);
} };
playKingdomPhrase(audio, strike, { delay: 0.1 }); // true only if scheduled audibly
```

`build(voice, variation)` gets the voice's own authoring tools (`gain`, `filter`, `chain`, `osc`, `noise`,
`envelope`, `partial`, `bloom`, `pan`, `room`, the start time `t` and its input `out`), never the context, master or
output. A phrase is bounded: at most 24 oscillator/noise sources over 6 s, scheduled at most 2 s ahead
(`PHRASE_LIMITS`); a larger one throws `RangeError`. It sits in the `ceremony` tier by default (`beacon` for a
kingdom-wide moment), counts in the same 16 / 64 budget, coalesces by key, fades on mute, stops on interruption and
closes on disposal. It answers like `cue()`: `false` when locked, muted, suspended, held back or given a non-finite
delay, pan or distance. Recordings are not available to phrases. `renderKingdomAudio` accepts phrase steps, so a film
of the Forge can be rendered through the same graph.

## Cost

44 recordings, 817,370 bytes shipped as mono 16-bit WAV (limit 4 MiB); once decoded, 9.05 s of mono float:
1,596,180 bytes in a 44.1 kHz context (measured in Chrome), about 1.74 MB at 48 kHz (limit 16 MiB); plus about
0.69 MB of authored buffers per instance at 48 kHz (noise and room). One context per instance; each
recording is decoded once and shared by every voice; finished voices disconnect themselves.

## Diagnostics

`inspectKingdomAudio(audio)` reports the context state, decoded recordings and failures, live voices and sources,
last variations and the live output peak. `renderKingdomAudio(script, { duration })` renders a timed script
through the same families, mixer and mix path in an `OfflineAudioContext`. Both are for the bench and checks;
consumers only need `createKingdomAudio`.

`pnpm --filter @chatdom/audio demo` runs the library in real Chrome on its own Vite dev server (the first free port
in 5170–5199, stopped at the end) and checks the browser behaviour end to end: locked, a parked and a rejected
resume (SIMULATED, as headless Chrome does not enforce the autoplay policy), a trusted click, every family audible at
the live output, mute and zero volume, the beacon interrupted by mute and by a real context suspension, the phrase
bridge, the crowd, disposal (also during an unlock) and the console. It then renders the complete sequence at full
volume offline through the same graph and writes `shots/audio/kingdom-sequence.wav` (75.5 s: controls, light, wave,
beacon, walking and building on six surfaces, the four together, the crowd burst, a mute and an interruption),
`kingdom-waveform.png`, `kingdom-sequence.json` (peak, duration, per-segment levels, every check) and the bench at
1440×900 and 390×844. It exits non-zero if a check fails.

`pnpm --filter @chatdom/audio check` runs the one focused regression (`src/budget.test.ts`): two seconds of a
footstep flood on every surface against the real families and mixer, counting the source nodes a Web Audio context
would actually be running, while a control, the beacon, your own nearby steps and a placed block must still play.
