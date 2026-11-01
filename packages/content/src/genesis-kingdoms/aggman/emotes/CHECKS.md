# The_AGGman emote checks

Three of The_AGGman's (broadcaster 63920635) own Twitch channel emotes become carved art in the harbour hamlet,
each checked for **one use only**. A check named here covers exactly the derivative raster whose hash it pins
(`index.ts`, `AGGMAN_EMOTE_CHECKS`); `loadAggmanEmoteDerivatives` refuses to carve any raster whose hash no
longer matches. Approval IDs are references to the records below, not authority: the Genesis gates still apply
before anything is founded (see "What still waits").

Source: public Helix `GET /chat/emotes?broadcaster_id=63920635`, read 2026-11-01, static format, light theme,
scale 3.0 (112 × 112 PNG). All three are first-party subscriber emotes (tier 1000) that Twitch itself reviewed for
the channel; no 7TV, BTTV or FFZ emote is used. Source bytes are embedded in `sources.ts` with their SHA-256.

## What was set aside

The channel has 33 first-party emotes. Every one was looked at before choosing; these were refused for any use:

- **Text baked in**: `theagg5HONK` (the word HONK above the goose), `theagg5CHAOS`, `theagg5HYPE`,
  `theagg5CODEYELLOW` (a jar labelled PEE), `theagg5EASY`. A carving must never carry lettering.
- **Third-party marks or memes**: `theagg5Friedgoose` (a fried-chicken bucket parody with initials),
  `theagg5EASY` (a retail button), `theagg5DoIT` (a film villain's hood), `theagg5DealWithIT` (meme sunglasses).
- **Weapons, crude or suggestive**: `theagg5Blastin` (a goose with a rifle), `theagg5DANCE` (a figure in tactical
  gear), `theagg5MEWBhole`, `theagg5Ohhhh`, `theagg5Buff`, `theagg5Gasm`.
- **Photographs of a real person**: `theagg5Dancey`, `theagg5Gasm`, `theagg5Pet`, `theagg5Shrug`. A likeness is
  not ours to carve in stone.
- **Not a carving in this rendition**: `theagg5MoonGoose` is an animated walk whose static rendition is an empty
  first frame; there is nothing to carve. `theagg5RAID` fails the compiler's aspect check (`unsupported-aspect`).
- **Tried and passed over**: `theagg5Cozy`, `theagg5Salute` and `theagg5Landduck` as glass (carved, but the plaid,
  the helmet and the dark bird turn to a muddle of came and dark panes at lancet size); `theagg5HYDRAGOOSE` as a
  vane (three heads close into a blob at 14 cells).

## the_aggman.ga10.statue.hydragoose.1

| | |
|---|---|
| Emote | `theagg5HYDRAGOOSE` · `emotesv2_12048d0ce39f4db087ecec37bcde102b` · tier 1000 |
| Source SHA-256 | `932cb300435cd3693bc6dc7c7eb79a0a5cc16f89abe32653b61152e758e8877c` |
| Use | `statue`: the painted-stone monument on the quay, east of the stair head, facing the town |
| Derivative raster hash | `b6a7eb0e15fee9829607d6d6b48459a2952b9863f3f54b768b0db94d0065d79f` |
| Drawing | A white goose with three heads and necks, wings half raised, standing square on two orange legs and webbed feet. No text, no symbols, no marks |
| Checked | Content: playful channel lore, nothing sexual, violent, hateful or mocking, nothing that reads badly enlarged to 5 m. Carved through the real composer (Tide kit, harbour footing): 41 × 40 × 6 cells on a 65 × 34 pedestal, 55 cells (6.9 m) to the top head. Silhouette at carved scale: the three beaks, the two legs and the feet on the cap read from across the quay; it is unmistakably a many-headed goose |
| Finding | The source has no dark outline, only a pale grey edge, so in stone the lower two necks merge into the raised wings and the heads are told apart by their gilded beaks and eye dots rather than by contour. The beaks snap to gold and muted red (painted stone has no clear orange), so they read gilded rather than orange. The domestic white goose is drawn in the manner of a popular game's goose, but carries no logo, name or mark; the judge at statue scale should see that |
| Result | Passed for the statue only |

## the_aggman.ga10.glass.love.1

| | |
|---|---|
| Emote | `theagg5LOVE` · `emotesv2_f204a49c5d204a6d8b4524c0d89be539` · tier 1000 |
| Source SHA-256 | `e67b61e6a64c528655179c47066560724f71d501f1fe5b653cd191aa8fb947c2` |
| Use | `stained-glass`: the lancet window in the gable of The Wren and Willow, the harbour inn, lit from within at dusk |
| Derivative raster hash | `9d5006bae5c149472c49a07162bc772aa06d93b9218529ad6709ab8c1401041b` |
| Drawing | The channel's goose, blushing, hugging a big red heart, two small hearts floating beside it. No text |
| Checked | Content: affectionate, nothing to flag. As glass (24 × 24 cells in a 44 × 64 lancet): the goose's head, beak and eye, the rose-pink heart and both small hearts read as panes against the window's blue field; the inn's window says welcome |
| Finding | The emote's outline is a thin red-brown, not black, so little of it becomes leading: the goose's head and wings are one large cream pane, and the wings meet the heart without a came line between them. The heart carries the colour; the goose is told by its beak and eye |
| Result | Passed for stained glass only. Glass approval is not a statue approval |

## the_aggman.ga10.vane.bounce.1

| | |
|---|---|
| Emote | `theagg5Bounce` · `emotesv2_03880224167d491abb427b80bb4d1fe3` · tier 1000 |
| Source SHA-256 | `97004b0ab0becf807495b478d18402ebd1b0da779316d84ad815340888f231ad` |
| Use | `weathervane`: cut sheet metal, gilded, turning over the inn's ridge |
| Derivative raster hash | `0581ae0e8aaf922cecdad6cfa922e4a02c046beb990c6e0debe245f2a9d0cec0` |
| Drawing | A white goose in profile, neck up, tail cocked, one foot lifted mid-strut (the static rendition of an animated bounce). No text |
| Checked | Content: nothing to flag. As a vane: only the silhouette survives in gold, brass and copper. Carved 10 × 14 cells, the goose stands on the arrow facing its head, the neck, beak (copper), breast and lifted leg clear against the sky; a goose is the oldest drawing for a harbour vane |
| Result | Passed for the weathervane only |

## What still waits

These are the lane's visual checks. They are not the streamer's consent and they do not found anything.

- **The judge at statue scale.** `chatdom/Safety.md` (emotes as voxels) sends the extruded version to the judge at
  statue scale. That runs in the server's publishing gate on the composed derivative, not here.
- **The monarch's confirmation.** The_AGGman confirms each statue, window and vane live during Genesis. Until
  then the hamlet stays labelled unfounded land, and these pieces are a proposal of what it could raise.
- **Changes at the source.** If the channel retires or redraws an emote, its source hash changes. The check no
  longer covers it, and the piece is not carved.
