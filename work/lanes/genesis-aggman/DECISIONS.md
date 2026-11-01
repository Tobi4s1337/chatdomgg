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
- **The inn is "The Wren and Willow", the innkeeper Rowan's place,** on a level pad west of the lane foot. It faces
  the sea, its back kitchen cut a course into the slope.

## Channel identity

- **Colours.** The profile colours are a red field, gold and cream, and a deep blue (`#075E86`). The Tide style's
  slate-blue roofs stay, because they are the blue. Red, gold and cream go into everything made of cloth and paint:
  the heraldic standard and crest from the shared heraldry, harbour pennants, quay banners, bunting across the lane,
  coble sails, awnings, doors and the inn's sign. Cover the labels and it is the red-and-gold harbour with blue roofs.
- **Geese are harbour life, not emotes.** The channel's emotes are geese (HONK, MoonGoose, HYDRAGOOSE…). We do not
  have approved derivatives, so no emote art appears. Domestic white geese, authored here as ordinary farmyard
  fauna, graze the green, sit on the shingle and swim by the pier. Everyone who knows the channel will read them, and
  none of them pretends to be a channel emote. If approved derivatives arrive, they go on the statue site and in the
  glass, and the geese stay.
- **Emote art only through approval.** `composeGenesisEmoteArt` gets `emoteDerivatives` from the composer input.
  With none, the statue site on the quay (east of the stair head) stays open paving. No generic statue stands in.

## needs (main)

- `needs: main mount createGenesisSoundscape(kingdomAudioHost(audio), {recipe, landscapeId}) in the Genesis preview scene; The_AGGman's recipe already selects the coastal soundscape (gulls, surf, rigging).`
- `needs: main render Genesis keepers in the preview (avatar rig is scene-owned); AGGman exposes keeperSites: Rowan at the inn door (door fixture), Brindle on the quay lamps (lamp fixtures).`
- `needs: main a per-kingdom hour on PotentialKingdomView (camera already flows through the composer); AGGman asks for hour 19.6, low sun over the sea to the south-west.`
- `needs: main export "./genesis-kingdoms/aggman" (and genesis-heraldry, genesis-emotes, genesis-keepers) from @chatdom/content; then swap apps/web/src/genesis/kingdoms/aggman/content.ts to the package specifier.`
- `needs: art-approval approved, channel-bound derivatives for theagg5HONK (statue) and theagg5MoonGoose (glass) through the facts adapter into GenesisKingdomInput.emoteDerivatives.`
- `needs: main merge seam: the genesis/index.tsx composer fallbacks are the same lines the PinkKittyRose and MashaD4 lanes touch; take one copy.`
