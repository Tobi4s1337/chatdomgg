# Third-party sources

All runtime/build dependencies retain their distributed license notices. Exact versions are in pnpm-lock.yaml.
The Atlas ships the credited art and fonts below. Kingdom sound combines licensed CC0 recordings and original procedural instruments; see Kingdom audio below. Future sound sources must be CC0 or permissive, credited here with their individual licenses; procedural sounds are authored in this repository.

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

Reference research is indexed in work/references/. The realm compatibility patches below modify pinned dependency source; other reference studies inform original implementations. Crowdbake has no verified reuse license and is ideas only. Any future adaptation requires a source header and its own entry here, including upstream notices and separate asset rights.

Kingdom sound uses the credited CC0 sources and original synthesis below. Forge phrases are original procedural instruments routed through that same mix. Atmosphere, water and voxel shaders are original implementations informed by the credited reference notes.

## Atlas art and fonts

| Source | Shipped assets | License and provenance |
|---|---|---|
| K. M. Alexander, #NoBadMaps | 81 stamps, cropped/scaled and recoloured to sepia, plus generated silhouettes in `apps/web/src/atlas/assets/stamps.webp` | CC0 1.0; [original packs](https://www.kmalexander.com/free-stuff/fantasy-map-brushes/). Exact packs, versions, source paths and modifications are recorded in [the asset inventory](apps/web/src/atlas/assets/LICENSES.md) and `stamps.json`. |
| Igino Marini, IM Fell English and English SC | Subset Roman, Italic and Small Caps WOFF2 fonts | SIL OFL 1.1; [pinned source](https://github.com/google/fonts/tree/6157dfaa640ca5738b4d1a7070fe389c3036d7fc/ofl/imfellenglish). Full license notices accompany the fonts in `apps/web/src/atlas/assets/fonts/`; exact inputs and subsetting recipe are in the asset inventory. |
| The Alegreya Project Authors | Subset variable Roman/Italic WOFF2, Latin/Cyrillic/Greek | SIL OFL 1.1; [pinned source](https://github.com/google/fonts/tree/6157dfaa640ca5738b4d1a7070fe389c3036d7fc/ofl/alegreya). Full license notice accompanies the fonts; exact inputs, Unicode coverage and subsetting recipe are in the asset inventory. |

Atlas heraldry and charge paths are authored here. No game-icons.net charges or prototype texture atlas were imported.

- **Codex mark (OpenAI)** — official monochrome SVG, unchanged, from OpenAI's VS Code extension `openai.chatgpt` version `26.51021.22027`, asset `extension/webview/assets/codex_new-f14177b03534.svg`. [Official distribution](https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.51021.22027/1792788319200/Microsoft.VisualStudio.Services.VSIXPackage); [brand guidelines](https://openai.com/brand/). Copyright and trademark OpenAI. Used as the forge's physical engraving for the Codex service; original paths and proportions are retained, with metal depth and heat light only.


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

## Realm networking

| Source | Version/license | Treatment |
|---|---|---|
| [Colyseus core and SDK](https://github.com/colyseus/colyseus) | colyseus 0.18.10, core 0.18.23, SDK 0.18.8 · MIT, Endel Dreyer | Used directly for rooms, schema synchronization, Predict and reconnection. `patches/@colyseus__sdk@0.18.8.patch` changes reconnect-token parsing to the final colon so `k:<channelId>` IDs work; original distributed license retained. |
| [Colyseus schema](https://github.com/colyseus/schema) | 5.0.42 · MIT, Endel Dreyer | Schema builders and shared district views; original license retained. |
| [Colyseus uWS transport](https://github.com/colyseus/colyseus/tree/master/packages/transport/uwebsockets-transport) | 0.18.4 · MIT, Endel Dreyer | `patches/@colyseus__uwebsockets-transport@0.18.4.patch` permits colons in the room path. Its distributed license is retained. uWebSockets.js v20.52.0 retains its Apache-2.0 notices. |
| [uwebsockets-express](https://www.npmjs.com/package/uwebsockets-express) | 2.0.4 · MIT | Transport peer dependency, original notices retained. |
| [jose](https://github.com/panva/jose) | 6.2.14 · MIT | Pinned for the realm-server lane’s Twitch OIDC verification; no provider credentials in browser bundles. |

The reference court and shared player integrator are authored here. Collision and camera research is recorded in `work/references/walking-voxel-worlds.md`; that note does not itself adapt upstream implementation.
