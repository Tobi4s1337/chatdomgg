# Kingdom audio: sources and credits

Every sound in `@chatdom/audio` is one of two things: a selected recording listed below, or original synthesis
authored in this repository. The recordings are only ever one layer of a cue; each cue combines them with original
resonance, noise shaping and tuned tails written in `src/cues/`.

## Recorded foley

### Kenney, Impact Sounds (1.0)

| | |
|---|---|
| Author | Kenney Vleugels, [kenney.nl](https://www.kenney.nl) |
| Pack page | <https://kenney.nl/assets/impact-sounds> |
| Archive | `kenney_impact-sounds.zip`, Impact Sounds 1.0 (creation date in the archive: 19-12-2019), downloaded 2026-10-30, SHA-256 `029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8` |
| License | Creative Commons Zero (CC0 1.0), as stated in the archive's own `License.txt`, kept beside the files as [`src/assets/kenney/impact-sounds-License.txt`](src/assets/kenney/impact-sounds-License.txt). Credit is optional under CC0; Chatdom credits it anyway. |

| Shipped file (`src/assets/kenney/`) | Original file (`Audio/`) | Used in | Bytes |
|---|---|---|---|
| `impact-wood-light-000.wav` | `impactWood_light_000.ogg` | `wood` control, centre knock | 23,248 |
| `impact-wood-light-002.wav` | `impactWood_light_002.ogg` | `wood` control, edge knock | 23,248 |
| `impact-wood-light-004.wav` | `impactWood_light_004.ogg` | `wood` control, corner knock | 23,248 |
| `impact-glass-light-004.wav` | `impactGlass_light_004.ogg` | `light`, F♯ window pane | 18,308 |
| `impact-glass-light-003.wav` | `impactGlass_light_003.ogg` | `light`, A window pane | 18,308 |
| `impact-glass-light-000.wav` | `impactGlass_light_000.ogg` | `light`, D window pane | 18,108 |

**Edits, the same for every file:** decoded from Ogg Vorbis, stereo folded to mono, attenuated by 3 dB (the
decoded Vorbis overshoots full scale by up to +2 dB), trailing audio below −66 dBFS trimmed, stored as 16-bit PCM
WAV at the original 44.1 kHz so every browser decodes it without encoder padding. Recipe:

```sh
ffmpeg -i <original>.ogg -ac 1 -af "volume=-3dB,areverse,silenceremove=start_periods=1:start_threshold=-66dB,areverse" -c:a pcm_s16le <shipped>.wav
```

At runtime the knocks are high-passed at 170 Hz (removing a low rumble in the recordings), softened at 2.6 kHz and
low-passed at 7.2 kHz. The glass taps are tuned into the palette by playback rate (an octave above each window's
note, from their measured strongest partials of 919, 981 and 1081 Hz) and band-limited to 480 Hz–3 kHz.

### Auditioned, not shipped

Measured and inspected as spectrograms on 2026-10-30, all CC0 per their archives' `License.txt`:

- Kenney Impact Sounds, the rest of the pack. `impactWood_light_001/003` are near-duplicates of the chosen knocks;
  `impactPlank_medium_*` ring too long for a control; `footstep_*` and other materials wait for the material cues.
- [Kenney RPG Audio](https://kenney.nl/assets/rpg-audio) (`kenney_rpg-audio.zip`, SHA-256
  `6dbeaf8544da958d8f2adcb4a4a4b76c1ade34a05f8ab9edccd327da7375f38b`). `metalLatch` and `metalClick` were considered
  as the lantern contact for `light` and not chosen: their spectral centroids sit at 6–8 kHz, a hard click, where
  a tuned glass pane can sit inside the light's chord. The book, cloth and footstep files wait for later families.
- [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) (`kenney_interface-sounds.zip`, SHA-256
  `f2193d072726d6758a5f7871b2dcc54dcce0d5c35c6f0a62f92549b327c81232`). Synthetic UI blips: not the carved,
  physical character Chatdom's controls need. Nothing selected.

## Authored here

Original Web Audio synthesis, written for Chatdom and not derived from any sampled library:

- the modal ring and body thock of the wooden control (`src/cues/control.ts`);
- the wick puff, breath sweep and glow partials of the window light (`src/cues/light.ts`);
- the D major pentatonic palette (`src/palette.ts`);
- the small-room impulse response, the glue compressor settings and the soft ceiling (`src/mix.ts`);
- the shared white-noise buffer every noise layer reads from (`src/mixer.ts`).

## Budget

| | Now | Limit |
|---|---|---|
| Shipped recordings | 6 files, 124,468 bytes | 4 MiB |
| Decoded recordings | 1.41 s mono, about 270 KB as 48 kHz float | 16 MiB |
