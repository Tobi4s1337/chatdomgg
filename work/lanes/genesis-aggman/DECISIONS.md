# The_AGGman: decisions

The_AGGman (63920635) is the hamlet of the Genesis triptych: sixteen homes on a south-facing coastal slope, a
watchtower keep on the rise, and a working harbour on the shore below. These are the calls made building it.

## Composition

- **One composer per kingdom, through a registry.** `apps/web/src/genesis/kingdom-composer.ts` globs
  `./kingdoms/*/index.ts` and the preview asks it for the broadcaster's composer before falling back to the shared
  seat. A channel without a composer looks exactly as before. Each kingdom owns its folder, so the three Genesis
  lanes never edit each other's files. The only shared lines are the three `composed?.… ??` fallbacks in
  `genesis/index.tsx`.
- **The harbour is public ground added to the plan, not dressing painted over it.** `withHarbourPrecinct` adds the
  harbour lane (market to quay), the quay and the inn's pad as active streets with their own nodes. It keeps every
  proposed id and bumps the revision. The terrain grader then really cuts and fills them, trees keep off them, and
  paving follows them. The quay level is the natural ground 15.5 m inland of the shore, snapped to a quarter metre,
  so the quay stands clear of the 4 m bank band where grading returns to the natural shore.
- **The quay wall is one authored piece in three segments.** A blueprint caps at 32 m. Each segment samples the
  graded ground, so its face stands down to the real shingle and bed. A stair is cut on the lane's axis down to the
  pier deck, and a slip ramps into the water at the east end for the boats.
- **The harbour works from a beach.** A strand of pale shingle runs along the waterline from x 14 to 112, in four
  pieces of 24.5 m (`createShingleStrand`). It follows the graded ground one stone proud, runs on under the shallows
  as a dark wet bed, carries weed and driftwood on the wrack line, and thins into the turf at a wandering edge
  instead of stopping on a line. The quay paving, the slip and the Last Lantern's base stay bare. Before it the
  turf ran straight into the sea, and the boats drawn up on it read as wreckage.
- **Boats are hauled up from where the water actually is.** The waterline curves about 5 m seaward west of the
  lane, so the drawn-up boats are placed four to six metres above the local waterline (`waterlineAt`), not from the
  lane's shore. A test holds that each one lies on stones.
- **A ground skin packs in one sweep.** The strand is a thin 196 × 124 cell skin; the harbour grid's six-order box
  search cost ~0.9 s each at load. The packer now indexes by strides, and the strand packs in one order (x, z, y):
  ~60 ms warm, ~4,000 boxes and ~46,000 triangles per piece. The mesh comes from the voxels, so the look is unchanged.
- **The inn is "The Wren and Willow", the innkeeper Rowan's place,** on a level pad west of the lane foot. It faces
  the sea, its back kitchen cut a course into the slope.

## Channel identity

- **Colours.** The profile colours are a red field, gold and cream, and a deep blue (`#075E86`). The Tide style's
  slate-blue roofs stay, because they are the blue. Red, gold and cream go into everything made of cloth and paint:
  the heraldic standard and crest from the shared heraldry, harbour pennants, quay banners, bunting across the lane,
  coble sails, awnings, doors and the inn's sign. Cover the labels and it is the red-and-gold harbour with blue roofs.
- **Geese are harbour life, and the channel's own geese are its art.** Domestic white geese, authored here as
  farmyard fauna, graze the green by the inn, sit on the west shingle, walk down Harbour Lane and swim by the pier;
  one honks at the stair head. They are not emotes. The channel's emotes appear only as checked derivatives, each
  for one use (`packages/content/src/genesis-kingdoms/aggman/emotes/CHECKS.md`, the same path main accepted for
  PinkKittyRose): HYDRAGOOSE is the painted-stone statue on the quay apron east of the stair, facing the sea;
  LOVE (a goose hugging a heart) is the stained glass of the Last Lantern; Bounce is the gilded vane on its finial.
  HONK was refused (the word is baked in) and MoonGoose's static frame is empty. A raster whose hash no longer
  matches its check composes as absence: no generic statue, a plain leaded lancet, no vane.
- **The Last Lantern.** The channel's line ("At the harbour's last lantern, there is always room for one more
  wanderer") becomes the hamlet's second landmark: a 14 m stone harbour light at the quay's west end, its seaward
  face one tall lancet holding the channel's window, lit from within by a brazier, a glazed lantern room above. It
  is sized to the Genesis window unit, so plain glass fits it exactly when no derivative is approved.
- **The crest moved to the head of Harbour Lane.** On the quay the 9 m carved crest read as a tombstone over the
  water and crowded the statue. It now pairs with the founding standard either side of the lane mouth at the market,
  facing the sea, so the arms greet whoever comes up from the boats.
- **The working quay is dressed, not paved.** Bollards along the coping, two lanterns at the stair head, the fish
  stall and crates under bunting by the lane mouth, nets on the rack and pots on the apron, the capstan at the slip
  head, quay banners either side of the lane, pennants at both ends streaming west on one wind. A coble runs in under
  sail, another lies furled by the pier, rowing boats at the pier root, three boats drawn up on the shingle. A test
  holds that no two pieces stand in one place (cloth overhead excepted) and that boats float on the sea.
- **Keepers at the places built for them.** Rowan keeps The Wren and Willow from its door (the inn's own door
  fixture); Brindle's lamp round is the quay's lamps (stair-head lanterns, banner lamps, pennant lamp, the stall and
  the statue's lamps), centred on the quay head. The recipe calls Brindle's place Bell Court (`plaza`); in a hamlet
  the quay is that place. Their lamps burn as fire, never as presence.
- **The first view is a long lens over the boats.** Eye 47 m east and 47 m seaward of the lane's shore, 22 m up,
  on 38° aimed at the quay: about 10° down, so the dusk sky and the keep on the rise stay in frame, while the
  narrower lens brings the quay's dressing (statue, banners, stall, stair lanterns, the inn's sign, the lit lancet)
  close enough to read. A steeper, nearer pose was tried and lost the sky and cropped the sailing coble.
- **Its own dusk.** The hamlet opens at hour 19.6, low sun over the sea to the south-west (`AGGMAN_HOUR`).
- **Registered with main's per-kingdom registry.** The one additive line in `apps/web/src/genesis/kingdoms.ts`
  (`'63920635'`) is the registry entry the PRD allows, so the real route opens at hour 19.6 with the channel's line.
- **Two seams, one composition.** `index.ts` serves both the shared composer registry (`kingdom`, sync: the
  derivatives are decoded once with a top-level await as the module loads, and the recipe gets exactly the emote
  works `compileChannelGenesis` writes for the approved facts; a test holds them equal) and main's per-kingdom
  registry (`composeGenesisKingdom({ facts, character })`, async, returning recipe, plan, seat, camera, hour, lore,
  keepers and sound).

## needs (main)

- `needs: main mount createGenesisSoundscape(kingdomAudioHost(audio), {recipe, landscapeId}) in the Genesis preview scene; The_AGGman's recipe already selects the coastal soundscape (gulls, surf, rigging).`
- `needs: main render Genesis keepers in the preview (avatar rig is scene-owned); AGGman's composeGenesisKingdom returns keepers (proposal, site, round) in main's shape: Rowan at the inn door, Brindle on the quay lamps.`
- `needs: main export "./genesis-kingdoms/aggman" (and genesis-heraldry, genesis-emotes, genesis-keepers) from @chatdom/content; then swap apps/web/src/genesis/kingdoms/aggman/content.ts to the package specifier.`
- `needs: main merge seam: the genesis/index.tsx composer fallbacks are the same lines the PinkKittyRose and MashaD4 lanes touch; take one copy.`
- `needs: main the Atlas preview pv-20261031T133817Z-9303798faebf no longer holds The_AGGman (63920635) among its 3,040 head + 45,305 settlers, so its Atlas door cannot be captured; either the survey keeps the three Genesis showcase channels or the Atlas pins them. capture.mjs --views atlas runs as soon as it is drawn.`
- `needs: main the potential kingdom subtitle (apps/web/src/kingdom/index.tsx:124) dropped "Unfounded land"; the PRD keeps unfounded land labelled.`
