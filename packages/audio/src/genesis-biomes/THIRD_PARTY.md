# Genesis land sound: sources and credits

Every sound in `genesis-biomes/` is original procedural synthesis authored in this repository. It ships **no recordings,
samples, impulse responses or third-party code**. Every bed, texture, call and room is made at runtime from a
seed: wind, sea, lap, river and rush beds, rain, foliage, insects, the ground floor, 27 call designs (birds, frog, water,
rigging, hull, mooring, bell buoy, chimes, flag, scree, stones, drips, thunder, branches, the mill wheel) and the three
spaces (open air, valley, mountain echo). It does not use the kingdom's recorded foley either (`packages/audio/THIRD_PARTY.md`).

## Published techniques (ideas only, no code taken)

| Technique | Where | Source | Terms |
|---|---|---|---|
| Physically based liquid sound: a bubble rings at its Minnaert frequency, damped by viscosity and radiation, and its pitch rises as it surfaces | `textures.ts`: brook babble, weir rush, rain on water | K. van den Doel, "Physically-based models for liquid sounds", *ACM Transactions on Applied Perception* 2(4), 2005, pp. 534–546. [doi:10.1145/1101530.1101554](https://doi.org/10.1145/1101530.1101554) | Published research. Our implementation was written from the paper's equations, as a re-tuned damped rotation rather than the paper's formulation. |
| Pink noise from white through a bank of one-pole filters ("refined" coefficients) | `voice.ts`: the pink noise buffer | Paul Kellet, "Filter to make pink noise from white", musicdsp.org archive, 2000 | A published algorithm with seven filter coefficients, offered for free use. Only the coefficients and structure are used; the code is our own. |
| Biquad band-pass coefficients | `textures.ts`: grasshopper stridulation | Robert Bristow-Johnson, "Cookbook formulae for audio EQ biquad filter coefficients" (Audio EQ Cookbook), [W3C Audio EQ Cookbook note](https://www.w3.org/TR/audio-eq-cookbook/) | Published formulae, also the definition behind Web Audio's `BiquadFilterNode`. |

Bird and animal designs (gull, oystercatcher, curlew, skylark, blackbird, wren, woodpigeon, woodpecker, tawny owl,
raven, chough, buzzard, frog) are original synthesis shaped by ear against general field knowledge of each species'
call: pitch range, rhythm and contour. No recording was traced, sampled or analysed into a template.

## Listening bench only (not shipped)

`bench/listen.mjs` uses these tools on the developer machine to measure and mix the offline renders. None of them is
bundled, imported by shipped code or distributed with Chatdom.

| Tool | Use | License |
|---|---|---|
| [FFmpeg](https://ffmpeg.org/) | EBU R128 loudness (`ebur128`), spectrograms (`showspectrumpic`), the SIMULATED stream mix (`amix`, `loudnorm`) | LGPL 2.1+ / GPL 2+ (system binary) |
| [CMU Flite](http://www.festvox.org/flite/) | The SIMULATED streamer voice for the stream-mix check, synthesised at run time and never stored in the repo | BSD-style (Carnegie Mellon University / Festvox licence) |
| [Playwright](https://playwright.dev/) with Chrome | Runs the offline `OfflineAudioContext` renders headlessly | Apache-2.0 (already a repo dev dependency) |

## For the root `THIRD_PARTY.md` (main consolidates this during integration)

> **Genesis land sound** (`packages/audio/src/genesis-biomes/`): original procedural synthesis only; no recordings or
> third-party code. Bubble textures follow K. van den Doel, "Physically-based models for liquid sounds" (ACM TAP 2005);
> pink noise uses Paul Kellet's published filter coefficients; band-pass coefficients follow R. Bristow-Johnson's
> Audio EQ Cookbook. Implemented from the publications. Details: [packages/audio/src/genesis-biomes/THIRD_PARTY.md](packages/audio/src/genesis-biomes/THIRD_PARTY.md).
