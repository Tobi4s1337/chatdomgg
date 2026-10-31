# Genesis heraldry

A kingdom's colours at founding: a 14 m standard and a carved crest monument, composed from a channel-genesis
recipe on the landscape the monarch selected (spec 41).

```ts
import { composeGenesisHeraldry } from './genesis-heraldry';
const heraldry = composeGenesisHeraldry(recipe, recipe.landscapes[selected]);
// heraldry.standard / heraldry.crest: { blueprint: VoxelBlueprint, lanterns: LanternAnchor[] }
// heraldry.cape: { hem, colours } for citizens' back cloth in the same colours
```

- **Input.** `HeraldryRecipe` is the part of the frozen `ChannelKingdomRecipe` heraldry reads; the real
  deep-readonly recipe is passed as it is. The landscape must be one of the recipe's three candidates. The
  recommendation is never assumed.
- **Neutral proposal.** The output is honestly labelled `treatment.kind: 'neutral'`. It uses the kingdom's base arms
  (the civic kit's chevron over a lozenge), a forked cloth, a heater shield and the land's own colours: undyed
  linen field, the style's roof (Grove: leaf) as charge, and a brass border. `reason` is `no-profile-colours`, or
  `targets-not-snapped` while profile targets exist but have not been snapped to the kit. The recipe's own crest
  shape, charge and cloth cut are carried in `requested`, and `device` records what is carved. Emote works are never
  drawn as a charge. Seed keys, evidence and receipts never reach the output.
- **Land.** The landscape's character dresses both footings: a damp dark course and mooring rings by a harbour,
  moss and forget-me-nots in a river valley, and bedded boulders on a mountain pass.
- **Lanterns.** `LanternAnchor.position` is a build cell inside lantern glass, which passes light: the standard has
  two lanterns hung beside the arms and two on its cornice, and the crest has one on each pillar. In the kingdom
  these are sources that wake for passers-by, like every other warm light.
- **Kits.** Hearth and Tide take their stone, base, band and cords from the civic kit, and Grove reads its style.
  Structure comes from `materials.ts`; nothing here mutates the registry.

Budgets per model (tested): ≤ 1,500 boxes, ≤ 120,000 cells, ≤ 60,000 meshed triangles, one face-connected
structure standing on y = 0.

## Bench

`bench/` is a lane-local, **SIMULATED** stage: an observed recipe's heraldry on a flagged forecourt with core
houses, lit windows and lit lanterns. It uses the production voxel worker, mesher, voxel material, light-field
flood (0.5 m cells, built from carved occupancy), sky and post stack. It proves the models and their light. It does
not prove kingdom integration.

```sh
node packages/content/src/genesis-heraldry/bench/capture.mjs --recipe 0 --land 2   # The_AGGman, coastal harbour (Tide)
node packages/content/src/genesis-heraldry/bench/capture.mjs --recipe 2 --land 0   # MashaD4, mountain pass (Hearth)
```

Shots land in `shots/genesis-heraldry/<style>-<landscape>@1920x1080.png`. The script takes the shared capture lock
and serves on an OS-assigned port.
