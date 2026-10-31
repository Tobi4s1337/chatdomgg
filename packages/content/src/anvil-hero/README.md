# The sleeping dragon chimney

`createAnvilHeroDragon(style)` returns a fresh `MotifGeometry` for `hearth`, `tide` or `grove`.
Its envelope remains `[24,16,18]` and mount `[12,0,9]`. The exported `DRAGON_EMITTER` (`[0,3,12]`) is the cell just
outside the open nostril at the left end of the head; the nostril runs into the snout toward +X. Consumers use that
anchor (with `DRAGON_SIZE` and `DRAGON_MOUNT`) rather than assuming a nose position.

The sculpture is authored on the build lattice and merged into non-overlapping half-open boxes (about 140 per kit).
Each call returns fresh boxes because the Forge assembler applies the selected native finish and inlay to them.

- **Pose.** At dusk the street sees the roof against the sky, so the dragon is drawn as a skyline first. The head
  lies in profile along the front-left of the roof (nose toward −X): a skull with cheeks, a two-cell step down at the
  brow, then a long narrower muzzle. Its light jaw rests on the inner edges of two forepaws with air between them,
  and a closed dark lid sits under a jutting brow on each flank. The neck dips to the shoulder, and the horns sweep
  back over that dip as the brightest small shapes, short and low (to row 8) so they stay clear of the stack.
  The body lies across the roof in front of the stack, its weight settled flat on the roof, with five spine plates
  shrinking toward the haunch. The far wing folds flat along the back as one triangle that peaks at row 9 with a claw.
  The tail leaves the haunch, wraps the front of the roof and lifts into a spade, so the roof shows inside its loop.
  The crooked grey stack, 12 rows with a corbel and a dark lip, stands behind as the tallest shape, with its flue
  walled and open to the sky.
- **Kits.** The back is never the roof material. Hearth: brick back, limestone belly and horns, terracotta plates.
  Tide: darkStone back, cream belly and horns, slate plates and lip. Grove: moss back, cream belly, goldLeaf horns,
  bark plates. Every kit has a grey stone stack, so the horns stay the brightest small shape. Each kit cuts its own
  plates (hearth: broad, tide: raked, grove: leaf-split) and its own wing edge (hearth: scalloped, tide: one long
  sweep, grove: a goldLeaf vein).
- **Checks.** `dragon.test.ts` checks the final occupancy, bounds, registered palette, support from the mount, the
  open nose and flue, the stack as the tallest shape, chin on paws with closed lids, and horns and the tail loop.
  `apps/web/src/forge/anvil-hero/bench/roof.test.ts` mounts it through the real `assembleForge` on all nine
  authored kit homes, under the Forge fit rules.
- **Finishes.** `ANVIL_HERO_DRAGON_SURFACE[style]` is the coil's back, the broad surface a composed copper or ceramic
  finish recolours (main's assembler selects it).

Main owns the package export (`@chatdom/content/anvil-hero`, in place) and the motif selection in
`packages/forge/src/assembly.ts` (in place for `sleeping-dragon`).
