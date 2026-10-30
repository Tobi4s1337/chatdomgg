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
| `impact-metal-light-001.wav` | `impactMetal_light_001.ogg` | brass control, tip | 22,034 |
| `impact-metal-light-004.wav` | `impactMetal_light_004.ogg` | brass control, middle | 18,644 |
| `impact-metal-light-002.wav` | `impactMetal_light_002.ogg` | brass control, heel | 20,618 |
| `impact-plank-medium-000.wav` | `impactPlank_medium_000.ogg` | `beacon`, torch into the brazier (with E) | 37,986 |
| `impact-plank-medium-002.wav` | `impactPlank_medium_002.ogg` | `beacon`, torch into the brazier (with B) | 41,634 |
| `impact-plank-medium-004.wav` | `impactPlank_medium_004.ogg` | `beacon`, torch into the brazier (open) | 37,844 |

The glass panes are also the castle windows of `beacon` and the street windows of `wave`.

**Edits to the wood and glass files (SO01):** decoded from Ogg Vorbis, stereo folded to mono, attenuated by 3 dB (the
decoded Vorbis overshoots full scale by up to +2 dB), trailing audio below −66 dBFS trimmed, stored as 16-bit PCM
WAV at the original 44.1 kHz so every browser decodes it without encoder padding. Recipe:

```sh
ffmpeg -i <original>.ogg -ac 1 -af "volume=-3dB,areverse,silenceremove=start_periods=1:start_threshold=-66dB,areverse" -c:a pcm_s16le <shipped>.wav
```

**Edits to the metal and plank files (SO02):** the same, except the gain is set per file so the decoded peak sits at
−1 dBFS: −3.07 dB (`metal-light-001`), −2.73 dB (`004`), −2.64 dB (`002`), −2.80 dB (`plank-medium-000`), −3.05 dB
(`002`), −3.07 dB (`004`):

```sh
ffmpeg -i <original>.ogg -ac 1 -af "volume=<gain>dB,areverse,silenceremove=start_periods=1:start_threshold=-66dB,areverse" -c:a pcm_s16le <shipped>.wav
```

At runtime the knocks are high-passed at 170 Hz (removing a low rumble in the recordings), softened at 2.6 kHz and
low-passed at 7.2 kHz. The glass taps are tuned into the palette by playback rate (an octave above each window's
note, from their measured strongest partials of 919, 981 and 1081 Hz) and band-limited to 480 Hz–3 kHz. The metal taps are tuned by playback rate so their strongest partials (2343, 2404 and
2998 Hz) land on A6, A6 and B6, band-limited to 520 Hz–5.2 kHz and damped by a gain envelope within ~200 ms. The
planks play at their own pitch, band-limited to 75 Hz–1.3 kHz and kept low under the fire.

### Kenney, RPG Audio

| | |
|---|---|
| Author | Kenney Vleugels, [kenney.nl](https://www.kenney.nl) |
| Pack page | <https://kenney.nl/assets/rpg-audio> |
| Archive | `kenney_rpg-audio.zip` (license file dated 2017-10-28, audio files 2014-03-17), downloaded 2026-10-30, SHA-256 `6dbeaf8544da958d8f2adcb4a4a4b76c1ade34a05f8ab9edccd327da7375f38b` |
| License | Creative Commons Zero (CC0 1.0), as stated in the archive's own `License.txt`, kept beside the files as [`src/assets/kenney/rpg-audio-License.txt`](src/assets/kenney/rpg-audio-License.txt). Credit is optional under CC0; Chatdom credits it anyway. |

| Shipped file (`src/assets/kenney/`) | Original file (`Audio/`) | Used in | Bytes |
|---|---|---|---|
| `book-flip-3.wav` | `bookFlip3.ogg` | parchment control, first page | 22,212 |
| `book-flip-2.wav` | `bookFlip2.ogg` | parchment control, second page | 19,058 |
| `book-flip-1.wav` | `bookFlip1.ogg` | parchment control, third page | 15,762 |

**Edits:** decoded from Ogg Vorbis, stereo folded to mono, gain set so the decoded peak sits at −1 dBFS, trailing
audio below −66 dBFS trimmed, 16-bit PCM WAV at the original 48 kHz. `bookFlip3` is used whole (+1.80 dB). `bookFlip2` keeps
its first page turn, 0–0.20 s with a 50 ms fade-out (+5.73 dB). `bookFlip1` keeps its main turn, 0.55–0.77 s with
a 50 ms fade-out (−4.28 dB):

```sh
ffmpeg -i bookFlip1.ogg -ac 1 -af "atrim=start=0.55:end=0.77,asetpts=N/SR/TB,afade=t=out:st=0.17:d=0.05,volume=-4.28dB,areverse,silenceremove=start_periods=1:start_threshold=-66dB,areverse" -c:a pcm_s16le book-flip-1.wav
```

At runtime the pages are high-passed at 340 Hz, shelved down 8 dB above 4.2 kHz and low-passed at 7.2 kHz, so the
paper's air never hisses over a voice.

### Auditioned, not shipped

Measured and inspected as spectrograms on 2026-10-30, all CC0 per their archives' `License.txt`:

- Kenney Impact Sounds, the rest of the pack. `impactWood_light_001/003` are near-duplicates of the chosen knocks;
  `impactPlank_medium_*` ring too long for a control (three of them became the beacon's torch instead);
  `impactMetal_light_000/003` duplicate the chosen brass taps; `impactBell_heavy_*` is a tolling bell, the
  status sound the beacon must not be; `impactTin_*` and `impactPlate_*` are thin and boxy; `footstep_*` and the
  other materials wait for the material cues.
- Kenney RPG Audio, the rest of the pack. `metalLatch` and `metalClick` were considered as the lantern contact for
  `light` and as the brass tick, and not chosen: their spectral centroids sit at 6–8 kHz, a hard click. `metalPot*`
  was considered as the beacon's brazier and not chosen: each file is several clanging hits, not one contact.
  `beltHandle*` and `clothBelt*` are mostly air above 8 kHz. The cloth, book-place and footstep files wait for
  later families.
- [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) (`kenney_interface-sounds.zip`, SHA-256
  `f2193d072726d6758a5f7871b2dcc54dcce0d5c35c6f0a62f92549b327c81232`). Synthetic UI blips: not the carved,
  physical character Chatdom's controls need. Nothing selected.

## Authored here

Original Web Audio synthesis, written for Chatdom and not derived from any sampled library:

- the modal ring and body thock of the wooden control, the brass lever's ring, mount thock and detent edge, and the
  parchment's finger slide and desk settle (`src/cues/control.ts`);
- the wick puff, breath sweep and glow partials of the window light (`src/cues/light.ts`);
- the street wave's phrases, shared wick bursts, travelling glows and gathering undertone (`src/cues/wave.ts`);
- the beacon's whoomph, sparks, the six-note chord with its opening and closing filter, and its timing
  (`src/cues/beacon.ts`);
- the D major pentatonic palette (`src/palette.ts`);
- the small-room impulse response, the glue compressor settings and the soft ceiling (`src/mix.ts`);
- the shared white-noise buffer every noise layer reads from (`src/mixer.ts`).

## Budget

| | Now | Limit |
|---|---|---|
| Shipped recordings | 15 files, 360,260 bytes | 4 MiB |
| Decoded recordings | 4.02 s mono, about 772 KB as 48 kHz float | 16 MiB |
