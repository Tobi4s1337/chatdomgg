# Genesis heraldry

A kingdom's colours at founding: a 14 m standard and a carved crest monument, composed from a channel-genesis
recipe on the landscape the monarch selected (spec 41).

```ts
import { composeGenesisHeraldry } from './genesis-heraldry';
const heraldry = composeGenesisHeraldry(recipe, recipe.landscapes[selected]);
// heraldry.standard / heraldry.crest: { blueprint: VoxelBlueprint, lanterns: LanternAnchor[], arms: string[] }
// heraldry.treatment: neutral, or a snapped proposal; heraldry.cape: { hem, colours } in the same colours
```

- **Input.** `HeraldryRecipe` is the part of the frozen `ChannelKingdomRecipe` heraldry reads; the real
  deep-readonly recipe is passed as it is. The landscape must be one of the recipe's three candidates. The
  recommendation is never assumed.
- **Device.** The crest carves the recipe's own shape (heater, roundel, or swallowtail standing on two points) and
  charge (an oak eradicated, a five-pointed star, three wavy bars, or a snow-capped trimount); the cloth is cut
  square (five tassels), forked (two) or as a pennant (one at its point), and carries the same charge level with its
  lanterns. `arms.ts` draws every combination as a mirror-symmetric grid (B border, F field, C charge) and each piece
  returns its `arms`. Emote works are never drawn as a charge. Seed keys, evidence and receipts never reach the
  output.
- **Colours.** With no profile colour targets the proposal is `treatment.kind: 'neutral'`: undyed linen field, the
  style's roof (Grove: leaf) as charge, brass border, claiming nothing. With targets it is `kind: 'snapped'`,
  `status: 'proposal'`: `snapTargets` picks registered tinctures in OKLab (linen and the gold dye as metals, the six
  clear and six muted dyes, hair black as sable). The first target sets the field; the charge is the tincture nearest
  a later target that keeps at least 3:1 contrast on the field, else the metal that reads best; the border is brass
  unless it would melt into either. The treatment records which target each colour honours. Nothing is tinted or
  added to the registry, and every tincture is an avatar swatch, so the cape wears the same colours (field cloth,
  charge lining, border trim; the hem follows the cut: straight, notched, rounded).
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
node packages/content/src/genesis-heraldry/bench/capture.mjs --recipe 1 --land 2 --targets profile   # PinkKittyRose, snapped
```

`--targets profile` adds the channel's profile palette proposal (`fixtures.ts`) as targets. Shots land in
`shots/genesis-heraldry/<style>-<landscape>-<shape>-<charge>-<cut>[-snapped]@1920x1080.png`. The script takes the shared capture lock
and serves on an OS-assigned port.
