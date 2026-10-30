# Third-party sources

All runtime/build dependencies retain their distributed license notices. Exact versions are in pnpm-lock.yaml.
The Atlas ships the credited art and fonts below. No sampled third-party sound has been shipped. Future sound sources must be CC0 or permissive, credited here with their individual licenses; procedural sounds are authored in this repository.

| Package | Version | License | Source |
|---|---|---|---|
| @eslint/js | 10.0.1 | MIT | [package](https://www.npmjs.com/package/@eslint/js) |
| @playwright/test | 1.64.1 | Apache-2.0 | [package](https://www.npmjs.com/package/@playwright/test) |
| @types/node | 22.19.15 | MIT | [package](https://www.npmjs.com/package/@types/node) |
| eslint | 10.13.0 | MIT | [package](https://www.npmjs.com/package/eslint) |
| pg | 8.23.1 | MIT | [package](https://www.npmjs.com/package/pg) |
| pixi.js | 8.22.0 | MIT | [package](https://www.npmjs.com/package/pixi.js) |
| redis | 6.3.1 | MIT | [package](https://www.npmjs.com/package/redis) |
| three | 0.186.1 | MIT | [source](https://github.com/mrdoob/three.js) |
| @types/three | 0.186.0 | MIT | [source](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/three) |
| solid-js | 1.9.18 | MIT | [package](https://www.npmjs.com/package/solid-js) |
| typescript | 5.9.3 | Apache-2.0 | [package](https://www.npmjs.com/package/typescript) |
| typescript-eslint | 8.72.1 | MIT | [package](https://www.npmjs.com/package/typescript-eslint) |
| vite | 8.3.5 | MIT | [package](https://www.npmjs.com/package/vite) |
| vite-plugin-solid | 2.11.14 | MIT | [package](https://www.npmjs.com/package/vite-plugin-solid) |
| zod | 4.6.7 | MIT | [package](https://www.npmjs.com/package/zod) |
| vitest | 5.0.5 | MIT | [package](https://www.npmjs.com/package/vitest) |

Reference research is indexed in work/references/. No source from those external repositories was copied into product code. Crowdbake has no verified reuse license and is ideas only. Any future adaptation requires a source header and its own entry here, including upstream notices and separate asset rights.

Kingdom sounds in `apps/web/src/kingdom/sound.ts` are original procedural Web Audio synthesis (oscillators, envelopes and a compressor), authored in this repository. They contain no sampled recordings. Atmosphere, water and voxel shaders are original implementations informed by the credited reference notes.

## Atlas art and fonts

| Source | Shipped assets | License and provenance |
|---|---|---|
| K. M. Alexander, #NoBadMaps | 81 stamps, cropped/scaled and recoloured to sepia, plus generated silhouettes in `apps/web/src/atlas/assets/stamps.webp` | CC0 1.0; [original packs](https://www.kmalexander.com/free-stuff/fantasy-map-brushes/). Exact packs, versions, source paths and modifications are recorded in [the asset inventory](apps/web/src/atlas/assets/LICENSES.md) and `stamps.json`. |
| Igino Marini, IM Fell English and English SC | Subset Roman, Italic and Small Caps WOFF2 fonts | SIL OFL 1.1; [pinned source](https://github.com/google/fonts/tree/6157dfaa640ca5738b4d1a7070fe389c3036d7fc/ofl/imfellenglish). Full license notices accompany the fonts in `apps/web/src/atlas/assets/fonts/`; exact inputs and subsetting recipe are in the asset inventory. |
| The Alegreya Project Authors | Subset variable Roman/Italic WOFF2, Latin/Cyrillic/Greek | SIL OFL 1.1; [pinned source](https://github.com/google/fonts/tree/6157dfaa640ca5738b4d1a7070fe389c3036d7fc/ofl/alegreya). Full license notice accompanies the fonts; exact inputs, Unicode coverage and subsetting recipe are in the asset inventory. |

Atlas heraldry and charge paths are authored here. No game-icons.net charges or prototype texture atlas were imported.
