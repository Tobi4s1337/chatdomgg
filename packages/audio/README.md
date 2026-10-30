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

`light`, `wave` and `beacon` share one palette (D major pentatonic, `src/palette.ts`), the same glass panes and the
same wick, and rise in loudness gently: about +0.5 dB from a window to the street and +6 dB to the beacon's crest.
`step`, `place`, `remove` and `material` throw `kingdom audio: the … sound is not finished yet` until they are
built. Nothing is registered as a stand-in.

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
  28 sources, building cues 12 / 36, the light ceremony 13 / 40, the beacon 15 / 58, controls everything. So the
  beacon (18 sources) and a control (3–6) always fit beside a full ceremony, and a control still answers during
  the beacon. A cue that does not fit returns `false`; nothing is cut or queued.
- **Coalescing:** the same cue on the same surface within 40 ms plays once.
- **Variation:** never the same variation twice in a row for one family on one surface.
- **Placement:** `pan` is clamped to [-1, 1]; `distance` (metres, ≥ 0) attenuates by `1 / (1 + distance / 8)`:
  full gain at 0 m, −6 dB at 8 m, −12 dB at 24 m. UI cues should pass neither.

## Diagnostics

`inspectKingdomAudio(audio)` reports the context state, decoded recordings and failures, live voices and sources,
last variations and the live output peak. `renderKingdomAudio(script, { duration })` renders a timed script
through the same families, mixer and mix path in an `OfflineAudioContext`. Both are for the bench and checks;
consumers only need `createKingdomAudio`.
