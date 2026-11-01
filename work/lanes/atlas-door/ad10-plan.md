# AD10 plan: every channel's kingdom, whole

The working map for AD10, kept so any session can carry on. Decisions live in the Decisions list at the end.

## The path

```
Atlas card "Enter the land"  ─┐
raid link ?from=<raider>     ─┼─▶ /kingdom/:id ─▶ holding from the survey ─▶ facts ─▶ recipe ─▶ landscape choice
direct /kingdom/:id          ─┘                                                         │
                                         adopted manifest? ─▶ /stream (unchanged)       ▼
                                  authored composer (AGGman, PinkKittyRose, MashaD4)  or  generated composer
                                                                                         │
                         parchment door (crest, name cartouche, inked steps) ◀──────────┘ ─▶ kingdom fades in at dusk
```

## Parts

1. **Holding facts** (`apps/web/src/atlas/data/holding.ts`, `apps/web/src/genesis/holding-facts.ts`): find the holding in the pinned survey preview (head, then
   region chunks largest first), read its name, tier, average, dominant game and realm family. Build
   `ChannelGenesisFacts` (observed evidence, the survey's own window hours, the game as the one category, the Atlas
   family). A hand-off record in `sessionStorage` from the Atlas card saves the chunk walk.
2. **Family themes** (`packages/world/src/genesis`): curated game dictionary widened; the Atlas family is the
   fallback theme for a game the dictionary does not know. Existing three fixtures compile byte-identically.
3. **Landscape choice**: biome preference with a seeded draw, so most shooters stand in the mountains but not all.
4. **Generated composition** (`apps/web/src/genesis/generated/`): landmark by landscape (watchtower keep on the coast,
   crown tower in the mountains; river towns keep their bridge and the realm piece, see Decisions), inn, heraldry standards and crest in the Atlas arms, banners and bunting on the
   square, lamp posts with real braziers along the streets, family dressing (stage, stone circle, bell garden in
   `generated/pieces/`), hero camera that frames town, keep and landmark, dusk hour, authored lore line.
5. **The door**: card link on every unwithheld holding; on click the seal stamps, the map glides into the holding and
   fades to parchment; the kingdom page opens on the same parchment cartouche (Atlas arms drawn with the Atlas
   heraldry, the name, inked steps) and the world fades in under it. `?from=<raider>` rides the raid road first.
6. **Contact sheet** (`shots/genesis-door/`): ten seeded-random holdings at 1920×1080, dusk, beside the three
   authored kingdoms; tiled with ffmpeg; copied to `work/evidence/atlas-door/`.

## Decisions

- **Colours are the Atlas arms.** The survey carries no profile colours, so a generated kingdom flies the shield the
  Atlas already draws for the holding (`shieldDesign(id)`), snapped to cloth by `composeGenesisHeraldry`. The map and
  the kingdom agree, and nothing is invented about the channel's branding.
- **Theme falls back to the Atlas realm.** The curated game dictionary is widened (about 90 games); a game it does
  not know takes the theme of its Atlas family (`REALM_THEMES`), and the three recorded fixtures compile unchanged.
- **No emote statues without approval.** Safety.md fails closed: an emote stands only after a Luna check and the
  monarch's confirmation. No arbitrary channel has either, so generated kingdoms raise none (`needs:` to main).
- **Lore is authored grammar**, never description text, because channel descriptions are not judged.
- **No river hall in generated river towns.** The hall only reads when a whole town is laid out around it
  (PinkKittyRose's `composeRiverTown` rewrites the plan for the landing, piers and revetments). Generated river towns
  keep the plan's bridge, the realm piece, the inn and the cathedral site; a generic hall seat is main-side work.
- **Entry is one continuous parchment.** The Atlas glides into the holding and the cartouche stamps over it; the
  kingdom page opens on the same cartouche, inks real progress steps, and fades the world in beneath. Raid arrivals
  ride the Atlas road first (`?from=`).

- **Inputs stay consumable for the grand kingdom.** Everything a generated kingdom is made from is a pure function of
  the holding: `holdingFacts(holding)` → `compileChannelGenesis` (the frozen recipe: land seed, biome, landmark, crest,
  banner, size tier, emote slots) → `chooseLandscape(recipe)`, plus `atlasArmsTargets(id)` for its colours. The grand
  land can take the same recipe and replace only the composer; the door and the hand-off do not change.
- **Captures hold the lock for seconds.** A kingdom loads and settles without the lock; only its last frames and the
  still are taken under it (the capture guard stops lane captures over ten minutes while main waits).

## Needs (for main)

- **A fresh survey import.** The Atlas service on 5193 serves preview `pv-20261031T133817Z` and the Surveyor drops a
  name it has not confirmed within a day, so since about 14:40 on 1 November no holding carries a name and no card
  shows a door (correct behaviour). The generated captures need a newer import; the lane cannot read the production
  Surveyor database itself.
- **Emote approvals for any channel**, so generated kingdoms can raise statues (the Luna check plus the monarch's
  confirmation, failing closed). Until then generated kingdoms raise none.
- **A judged channel-facts adapter** (profile colours, a judged description line) to replace the Atlas arms and the
  authored lore when a channel has been judged.
- **The raid road's gate**: `raid-gate/road/lands.ts` still only knows the three authored channels.

## Status

See `progress.txt` for the last `next:` line.
