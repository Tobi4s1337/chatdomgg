# The_AGGman (63920635): GA10 evidence

Captured with `node apps/web/src/genesis/kingdoms/aggman/capture.mjs --views hero,quay,light,atlas --hour 19.6` in the
real `/kingdom/63920635` route: headless Chrome through SwiftShader, adopted-land manifest answered 404 (unfounded
land), presence SIMULATED and empty. Frame timing and the real look of light need a GPU check.

| File | What it shows |
|---|---|
| `before-hero@1920x1080.png` | Where it stood: the shared coastal seat, an empty shore and a bare pier. |
| `after-hero@1920x1080.png` | The hero view at hour 19.6, from the water south-east of the harbour. |
| `before-after-hero.png` | The two side by side. |
| `after-quay@1920x1080.png` | The quay from the water off the pier head. |
| `after-light@1920x1080.png` | The Last Lantern from the west shingle. |

## What is in the frame

- **Land and size.** The broadcaster ID's coastal harbour land and its sixteen homes, at the hamlet's true size.
  Harbour Lane runs down to a stone quay of three graded segments, with a stair to the pier and a slip.
- **Landmarks.** The watchtower keep on the rise (shared seat), The Wren and Willow inn on its pad, and the Last
  Lantern: a 14 m limewashed harbour light named for the channel's own line. Its lancet holds the channel's window.
- **Colours.** The red, gold and cream livery under the Tide style's blue roofs: the founding standard and the crest
  at the lane head, bunting, quay banners, pennants, the coble sails, the fish stall and the light's red band.
- **Emote art, one checked use each.** HYDRAGOOSE as the statue on the quay, LOVE as the stained glass and Bounce
  as the vane on the light (`packages/content/src/genesis-kingdoms/aggman/emotes/CHECKS.md`).
- **Harbour life.** One coble under sail and one furled by the pier, rowing boats, three boats drawn up, nets, pots,
  crates, the capstan and the bollards. Geese on the green, on the shingle, down the lane and swimming by the pier.
- **No light stands in for a person.** The lamps and braziers are keeper fire. They burn only when the stream is
  live, so on unfounded land they are dark, and the window reads by its colour alone.

## Not in the frame

- **The Atlas door.** The current Atlas preview `pv-20261031T133817Z-9303798faebf` holds 3,040 head plus 45,305
  regional settlers, and The_AGGman is not among them. The capture searches the survey and fails honestly; it does
  not invent a mark. See `needs:` in `work/lanes/genesis-aggman/DECISIONS.md`.
- **Sound and keepers.** These are composed (`composeGenesisKingdom` returns `sound` and `keepers`), but the preview
  scene has no Genesis soundscape or keeper mount yet. Both are main's.
- **The opening hour.** Hour 19.6 reaches a visitor only through main's per-kingdom registry. The capture passes
  `?hour=19.6`.

## Doubts

- The vane's mast is the shared design. On the light's finial its iron mast and gilded letters still read a little
  like a hilt from far off.
- The kingdom subtitle reads "hamlet · A home for this chat". The earlier "Unfounded land" wording was dropped in
  main's shared header (`apps/web/src/kingdom/index.tsx:124`). The PRD says unfounded land stays labelled.
- The drawn-up boats lie on grass above a narrow shingle band. That is plausible, but the shore has no stones of its own.
