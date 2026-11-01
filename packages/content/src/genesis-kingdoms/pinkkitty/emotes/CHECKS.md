# PinkKittyRose emote checks

Three of PinkKittyRose's (broadcaster 4363967) own Twitch channel emotes become carved art in the river town, each
checked for **one use only**. A check named here covers exactly the derivative raster whose hash it pins
(`index.ts`, `PINKKITTY_EMOTE_CHECKS`); `loadPinkKittyEmoteDerivatives` refuses to carve any raster whose hash no
longer matches. Approval IDs are references to the records below, not authority: the Genesis gates still apply
before anything is founded (see "What still waits").

Source: public Helix `GET /chat/emotes?broadcaster_id=4363967`, read 2026-11-01, static format, light theme,
scale 3.0 (112 × 112 PNG). All three are first-party subscriber emotes (tier 1000) that Twitch itself reviewed for
the channel; no 7TV, BTTV or FFZ emote is used. Source bytes are embedded in `sources.ts` with their SHA-256.

## pinkkittyrose.gp10.statue.heart.1

| | |
|---|---|
| Emote | `pkroseHeart` · `306925729` · tier 1000 |
| Source SHA-256 | `b1015033a1b0d7ee1b427396a05803e43d6792a99bfe49447635de734e67ca04` |
| Use | `statue`: the painted-stone monument in Bell Court, on the stair's axis, facing the river hall |
| Derivative raster hash | `42899dc29ba4af5f258fc3d153e3dd39a05033b6aaa79bb91ded170943a14416` |
| Drawing | The channel's pink-haired mascot, eyes closed and smiling, hugging a big red heart. No text, no symbols, no third-party marks |
| Checked | Content: affectionate, nothing sexual, violent, hateful or mocking, nothing that reads badly when enlarged to about 3 m. Silhouette at carved scale: the heart and the two hands read from across the square; the face reads up close. From the hero view the statue is a small accent, not a landmark |
| Finding | The hair snaps to the statue pigments' muted red, so at dusk it reads maroon rather than pink. The figure stays readable (heart, hands, face), but its signature colour is lost. Painted stone deliberately keeps the clear festival dyes for glass; a pink stone pigment would be a shared palette decision, not this kingdom's |
| Result | Passed for the statue only |

## pinkkittyrose.gp10.glass.ohoho.1

| | |
|---|---|
| Emote | `pkroseOhoho` · `307470781` · tier 1000 |
| Source SHA-256 | `e8f6727efa4c67249a4c790fd5b3cc5f69aa6bf7a7ca22f121b5321f1b077fa6` |
| Use | `stained-glass`: the lancet window in the glass screen that closes Bell Court's north side |
| Derivative raster hash | `accb4b050a9524eb5607d9b2c03ec0c0c9493db6044725d428fe6976eba60b20` |
| Drawing | The mascot laughing behind a hand, a red rose with green leaves in her hair. No text |
| Checked | Content: playful, nothing to flag. As glass: the emote's dark outline becomes the leading, the rose and the hair carry the window's colour, and the drawing stays legible as a lancet seen from across the square |
| Result | Passed for stained glass only. Glass approval is not a statue approval |

## pinkkittyrose.gp10.vane.topspin.1

| | |
|---|---|
| Emote | `pkroseTopSpin` · `emotesv2_90d764d9991b44bea9530235fd092df8` · tier 1000 |
| Source SHA-256 | `57a064535699853f304bbbfd212021fc52ad2e76e18e139d60e2461781fca934` |
| Use | `weathervane`: cut sheet metal, gilded, turning over the river hall's far gable |
| Derivative raster hash | `8198b52b17ccddf20c4b0cdd1f2a7c5282374b1c55597cfe41167bbfcdadf2ab` |
| Drawing | The mascot spinning on one foot, arms out, a blue swirl around her feet. No text |
| Checked | Content: nothing to flag. As a vane: only the silhouette survives in gold, brass and copper. The outstretched arms and the swirl give it a clear profile against the sky, and a spinning figure is the right drawing for a thing that turns |
| Result | Passed for the weathervane only |

## What still waits

These are the lane's visual checks. They are not the streamer's consent and they do not found anything.

- **The judge at statue scale.** `chatdom/Safety.md` (emotes as voxels) sends the extruded version to the judge at
  statue scale. That runs in the server's publishing gate on the composed derivative, not here.
- **The monarch's confirmation.** PinkKittyRose confirms each statue, window and vane live during Genesis. Until
  then the town stays labelled unfounded land, and these pieces are a proposal of what it could raise.
- **Changes at the source.** If the channel retires or redraws an emote, its source hash changes. The check no
  longer covers it, and the piece is not carved.
