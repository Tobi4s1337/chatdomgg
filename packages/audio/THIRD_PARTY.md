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

The glass panes are also the castle windows of `beacon` and the street windows of `wave`, the ring of a glass
floor tile in `step` and the nail on glass in glass `material`. The light wood knocks are also the timber lifted out
in wood `remove` and handled in wood `material`.

Added in SO03 for the six material surfaces:

| Shipped file (`src/assets/kenney/`) | Original file (`Audio/`) | Used in | Gain | Bytes |
|---|---|---|---|---|
| `footstep-wood-000.wav` | `footstep_wood_000.ogg`, kept 0.00–0.11 s | `step` wood | +4.76 dB | 6,890 |
| `footstep-wood-002.wav` | `footstep_wood_002.ogg` | `step` wood | +0.82 dB | 6,818 |
| `footstep-wood-004.wav` | `footstep_wood_004.ogg` | `step` wood | +1.53 dB | 6,498 |
| `impact-wood-medium-000.wav` | `impactWood_medium_000.ogg` | `place` wood | +1.74 dB | 19,648 |
| `impact-wood-medium-002.wav` | `impactWood_medium_002.ogg` | `place` wood | +1.88 dB | 22,418 |
| `impact-wood-medium-004.wav` | `impactWood_medium_004.ogg` | `place` wood | +2.19 dB | 22,504 |
| `footstep-concrete-000.wav` | `footstep_concrete_000.ogg` | `step` stone; heavier as `place`, lighter as `remove`/`material`; the heel under metal and glass steps | +0.85 dB | 5,874 |
| `footstep-concrete-002.wav` | `footstep_concrete_002.ogg` | as `-000` | +0.92 dB | 6,042 |
| `footstep-concrete-003.wav` | `footstep_concrete_003.ogg` | as `-000` | +0.85 dB | 5,926 |
| `impact-soft-medium-000.wav` | `impactSoft_medium_000.ogg` | `place`/`remove`/`material` earth; the fold landing in fabric `place` | -0.16 dB | 10,088 |
| `impact-soft-medium-002.wav` | `impactSoft_medium_002.ogg` | as `-000` | +0.21 dB | 11,658 |
| `impact-soft-medium-003.wav` | `impactSoft_medium_003.ogg` | as `-000` | +0.76 dB | 11,666 |
| `impact-metal-medium-000.wav` | `impactMetal_medium_000.ogg` | `place` metal | +0.78 dB | 16,812 |
| `impact-metal-medium-001.wav` | `impactMetal_medium_001.ogg` | `step`, `place`, `remove`, `material` metal | +0.95 dB | 9,076 |
| `impact-metal-medium-002.wav` | `impactMetal_medium_002.ogg` | `step`, `remove`, `material` metal | +0.74 dB | 6,976 |
| `impact-metal-medium-003.wav` | `impactMetal_medium_003.ogg` | `place` metal | +1.10 dB | 15,674 |
| `impact-metal-medium-004.wav` | `impactMetal_medium_004.ogg` | `step`, `remove`, `material` metal | +0.66 dB | 6,514 |
| `impact-glass-medium-000.wav` | `impactGlass_medium_000.ogg` | `place`, `remove` glass | +2.01 dB | 35,606 |
| `impact-glass-medium-001.wav` | `impactGlass_medium_001.ogg` | `place`, `remove` glass | +1.60 dB | 34,516 |
| `impact-glass-medium-004.wav` | `impactGlass_medium_004.ogg` | `place`, `remove` glass | +1.26 dB | 35,948 |
| `footstep-carpet-000.wav` | `footstep_carpet_000.ogg`, kept 0.00–0.13 s | `step` fabric | +1.08 dB | 7,776 |
| `footstep-carpet-001.wav` | `footstep_carpet_001.ogg` | `step` fabric | +0.96 dB | 7,064 |
| `footstep-carpet-003.wav` | `footstep_carpet_003.ogg` | `step` fabric | +1.04 dB | 6,562 |

**Edits to the wood and glass files (SO01):** decoded from Ogg Vorbis, stereo folded to mono, attenuated by 3 dB (the
decoded Vorbis overshoots full scale by up to +2 dB), trailing audio below −66 dBFS trimmed, stored as 16-bit PCM
WAV at the original 44.1 kHz so every browser decodes it without encoder padding. Recipe:

```sh
ffmpeg -i <original>.ogg -ac 1 -af "volume=-3dB,areverse,silenceremove=start_periods=1:start_threshold=-66dB,areverse" -c:a pcm_s16le <shipped>.wav
```

**Edits to the metal and plank files (SO02):** the same, except the gain is set per file: −3.07 dB (`metal-light-001`),
−2.73 dB (`004`), −2.64 dB (`002`), −2.80 dB (`plank-medium-000`), −3.05 dB (`002`), −3.07 dB (`004`). These gains
were meant to bring the peak to −1 dBFS, but ffmpeg's own `-ac 1` fold rescales by a further −3 dB when it writes
integer PCM, so the shipped SO01 and SO02 files actually peak at about −4 dBFS (0.62–0.63). Their runtime gains were
set by measurement against those files, so they stay as they are:

```sh
ffmpeg -i <original>.ogg -ac 1 -af "volume=<gain>dB,areverse,silenceremove=start_periods=1:start_threshold=-66dB,areverse" -c:a pcm_s16le <shipped>.wav
```

**Edits to the material files (SO03):** decoded from Ogg Vorbis, the channels folded explicitly with
`pan=mono|c0=0.5*c0+0.5*c1` (no hidden rescale), a 20 Hz high-pass to remove DC, sliced where noted (4 ms fade in,
50 ms fade out), the gain in the table, trailing audio below −66 dBFS trimmed with a 12 ms fade, stored as 16-bit PCM
WAV at the original 44.1 kHz. The written peak of every file was checked at −1 dBFS (±0.1 dB).
`footstep_wood_000` and `footstep_carpet_000` are cut at 0.11 s and 0.13 s because each recording ends with a
separate low bump.

```sh
ffmpeg -i <original>.ogg -af "pan=mono|c0=0.5*c0+0.5*c1,[atrim=start=<a>:end=<b>,asetpts=N/SR/TB,afade=t=in:d=0.004,afade=t=out:st=<b-a-0.05>:d=0.05,]highpass=f=20,volume=<gain>dB,areverse,silenceremove=start_periods=1:start_threshold=-66dB,afade=t=in:d=0.012,areverse" -c:a pcm_s16le <shipped>.wav
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

Added in SO03 (edited as described for the SO03 Impact Sounds files above, at the original 48 kHz):

| Shipped file (`src/assets/kenney/`) | Original file (`Audio/`) | Used in | Gain | Bytes |
|---|---|---|---|---|
| `footstep-earth-00.wav` | `footstep00.ogg` | `step` earth | -0.39 dB | 23,968 |
| `footstep-earth-02.wav` | `footstep02.ogg` | `step` earth | +1.10 dB | 23,046 |
| `footstep-earth-07.wav` | `footstep07.ogg` | `step` earth | -0.38 dB | 21,676 |
| `cloth-1.wav` | `cloth1.ogg`, kept 0.12–0.36 s | `place`, `remove`, `material` fabric | +3.99 dB | 23,118 |
| `cloth-2.wav` | `cloth2.ogg`, kept 0.06–0.30 s | as `cloth-1` | +8.84 dB | 23,630 |
| `cloth-3.wav` | `cloth3.ogg`, kept 0.10–0.34 s | as `cloth-1` | +9.71 dB | 23,118 |

**Edits to the book pages (SO02):** decoded from Ogg Vorbis, stereo folded to mono, gain set per file (the same −3 dB
fold applies, so they peak at about −4 dBFS), trailing audio below −66 dBFS trimmed, 16-bit PCM WAV at the original
48 kHz. `bookFlip3` is used whole (+1.80 dB). `bookFlip2` keeps
its first page turn, 0–0.20 s with a 50 ms fade-out (+5.73 dB). `bookFlip1` keeps its main turn, 0.55–0.77 s with
a 50 ms fade-out (−4.28 dB):

```sh
ffmpeg -i bookFlip1.ogg -ac 1 -af "atrim=start=0.55:end=0.77,asetpts=N/SR/TB,afade=t=out:st=0.17:d=0.05,volume=-4.28dB,areverse,silenceremove=start_periods=1:start_threshold=-66dB,areverse" -c:a pcm_s16le book-flip-1.wav
```

At runtime the pages are high-passed at 340 Hz, shelved down 8 dB above 4.2 kHz and low-passed at 7.2 kHz, so the
paper's air never hisses over a voice.

At runtime the material files are band-limited per surface (high-pass 70–320 Hz, low-pass 2.4–6.8 kHz), the
brightest grit and air shelved down; metal strikes are tuned by playback rate so their strongest partial (996, 1044,
1023, 1093, 1007 Hz) lands on D5, E5, A5, B5 or B4 and are damped by a gain envelope; the glass blocks (903, 1033,
899 Hz) are tuned to F♯5, A5 and E5 and damped within ~0.4 s. Each family has a fader in dB next to its definition.

The fishing pier (`apps/web/src/fishing/sound/`) reuses shipped files from both Kenney packs above, adding none:
`book-flip-1..3` for the catch tag, `cloth-1..3` with `impact-wood-light-*` for taking and stowing the rod, and
`footstep-wood-*`, `impact-wood-medium-*` and `impact-soft-medium-*` for the fish landing on the planks.

### Auditioned, not shipped

Measured and inspected as spectrograms on 2026-10-30, all CC0 per their archives' `License.txt`:

- Kenney Impact Sounds, the rest of the pack. `impactWood_light_001/003` are near-duplicates of the chosen knocks;
  `impactPlank_medium_*` ring too long for a control (three of them became the beacon's torch instead);
  `impactMetal_light_000/003` duplicate the chosen brass taps; `impactBell_heavy_*` is a tolling bell, the
  status sound the beacon must not be; `impactTin_*` is thin and boxy. For the material cues (SO03):
  `footstep_carpet_002/004` are byte-for-byte duplicates of `001/003`; `footstep_grass_*` run 0.6–0.8 s of loose
  rustle, too long and hissy for a step; `footstep_snow_*` is a 0.37 s crunch that reads as snow, not soil;
  `impactMining_*` rings with the pick's metal partials at 2–6 kHz for most of a second, the sound of mining rather
  than setting stone; `impactPlate_light/medium_*` wash for 0.5–0.65 s; `impactGlass_light/heavy` and
  `impactGlass_medium_002/003` were measured and the clearest three single-partial blocks kept;
  `impactGeneric_light_*` rings like plastic; `impactPunch_*` is a body blow; `impactWood_heavy_*` is
  mostly below 150 Hz.
- Kenney RPG Audio, the rest of the pack. `metalLatch` and `metalClick` were considered as the lantern contact for
  `light` and as the brass tick, and not chosen: their spectral centroids sit at 6–8 kHz, a hard click. `metalPot*`
  was considered as the beacon's brazier and not chosen: each file is several clanging hits, not one contact.
  `beltHandle*` and `clothBelt*` are mostly air above 8 kHz. For SO03: `footstep03/04/09` start with a scuff
  before the heel and `footstep01/05/06/08` were not needed beside `00`, `02` and `07`;
  `cloth4` peaks at 0.22 with most of its energy as air; `dropLeather`, `handleSmallLeather*` and `bookPlace*` read
  as leather and paper rather than cloth or stone; `handleCoins*` is coins.
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
- the shared white-noise buffer every noise layer reads from, the distance and air law, the budget and footstep
  replacement (`src/mixer.ts`);
- for the six material surfaces (`src/cues/materials/`): the palm and fingertip touches, the lift, grit, crumbling
  soil and falling grains, the weight under stone, metal and glass, the hollow of floorboards, the ring of a timber
  block and its seating tock, the iron plate's hum and the fitting's clink, the slab ring under a glass step, the
  scrape of stone into its bed, and the weave's whisper under a step on cloth.

## Budget

Measured by `pnpm --filter @chatdom/audio demo` (2026-10-30). The decoded figure is what Chrome actually holds
after decoding every recording into its 44.1 kHz context; recordings are resampled to the context's rate, so a
48 kHz device holds about 9% more.

| | Now | Limit |
|---|---|---|
| Shipped recordings | 44 files, 817,370 bytes (Impact Sounds 35 files, 621,782 bytes; RPG Audio 9 files, 195,588 bytes) | 4 MiB |
| Decoded recordings | 1,596,180 bytes (9.05 s of mono float at 44.1 kHz); about 1.74 MB at 48 kHz | 16 MiB |
| Authored buffers per instance | 691,200 bytes at 48 kHz: the 2 s noise buffer (384,000) and the 0.8 s stereo room (307,200) | — |

## For the root THIRD_PARTY.md

Ready to paste under `## Kingdom audio` in the repository's `THIRD_PARTY.md`, replacing the sentence "No sampled
third-party sound has been shipped" and the paragraph that calls the kingdom sounds purely procedural:

```md
## Kingdom audio

The kingdom's sounds (`@chatdom/audio`) combine 44 selected recordings with original Web Audio synthesis authored in
this repository. Every recording is one layer of a cue, never a whole cue. Per-file inventory (original and shipped
names, edits, gains, sizes and where each is used): [packages/audio/THIRD_PARTY.md](packages/audio/THIRD_PARTY.md).

| Source | Shipped | License and provenance |
|---|---|---|
| Kenney Vleugels, [Impact Sounds](https://kenney.nl/assets/impact-sounds) 1.0 | 35 mono 16-bit WAV files in `packages/audio/src/assets/kenney/` (621,782 bytes): light wood, glass and metal taps, medium wood, soft, metal, glass and plank impacts, wood, concrete and carpet footsteps | CC0 1.0, per the archive's `License.txt`, kept beside the files. `kenney_impact-sounds.zip`, downloaded 2026-10-30, SHA-256 `029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8`. Decoded from Ogg Vorbis, folded to mono, gain-adjusted, sliced or trimmed as recorded in the inventory. |
| Kenney Vleugels, [RPG Audio](https://kenney.nl/assets/rpg-audio) | 9 mono 16-bit WAV files in the same folder (195,588 bytes): three book page turns, three dirt footsteps, three cloth slices | CC0 1.0, per the archive's `License.txt`, kept beside the files. `kenney_rpg-audio.zip`, downloaded 2026-10-30, SHA-256 `6dbeaf8544da958d8f2adcb4a4a4b76c1ade34a05f8ab9edccd327da7375f38b`. Edited as recorded in the inventory. |

Credit is optional under CC0; Chatdom credits these anyway. Everything else in the kingdom's sound (the resonances,
glows, wick and fire, the beacon chord, the D major pentatonic palette, the room impulse, the mix and the budget) is
original synthesis authored here. Phrases played through `playKingdomPhrase` (the Forge's) can only use synthesis.
```
