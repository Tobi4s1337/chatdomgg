# The sleeping dragon chimney

`createAnvilHeroDragon(style)` returns a fresh `MotifGeometry` for `hearth`, `tide` or `grove`, as a drop-in
replacement for `createForgeMotif('sleeping-dragon', style)`. It has the same envelope `[24,16,18]`, mount `[12,0,9]`
and emitter `[0,2,9]`, so the chimney assembler's offset, plinth and supports stay as they are. The nose points −X,
the near flank faces +Z (the home's front) and the wing lies on the far flank (−Z).

The dragon is carved on a grid and then merged into non-overlapping half-open boxes (about 170–200 per kit), so box
order has no effect. Each call returns new box objects, because the assembler recolours and mirrors them in place.

- **Pose.** A crooked grey stack, 14 cells tall with a corbel course, a lip and an open flue. The coil is one band
  round its base with a shoulder hump at 7. The neck dips to 3 and the wedge head rests on crossed forearms, with air
  under the chin tip and in the crook of the paws. The horns sweep back over the dip, two cells at the root and one at
  the tip, up to 8. The wing folds one cell proud of the far flank, peaks at 9 and has a spar and two finger ribs. Five
  spine plates shrink toward the tail, which tapers round the front to a spade by the paws.
- **Kits.** The back is never the roof material. Hearth: brick back, limestone belly and horns, terracotta plates.
  Tide: darkStone back, cream belly and horns, slate plates and lip. Grove: moss back, cream belly, goldLeaf horns,
  bark plates. Every kit has a grey stone stack, so the horns stay the brightest small shape. Each kit cuts its own
  plates (hearth: broad, tide: leaning back, grove: leaf-split) and its own wing edge (hearth: scalloped, tide: one
  long sweep, grove: a goldLeaf vein).
- **Checks.** `dragon.test.ts` checks the final occupancy, bounds, registered palette, support from the mount, open
  nose and flue, and the sleeping read. The bench test `apps/web/src/forge/anvil-hero/bench/roof.test.ts` mounts it
  through the real `assembleForge` on all nine authored kit homes, under the Forge fit rules.

- **Finishes.** `ANVIL_HERO_DRAGON_SURFACE[style]` is the coil's back, the broad surface a composed copper or ceramic
  finish should recolour. The assembler's current set (the roof, moss, brass, goldLeaf) misses it; see the integration
  checklist in `apps/web/src/forge/anvil-hero/README.md`.

Main owns the package export (`@chatdom/content/anvil-hero`, in place) and the motif selection in
`packages/forge/src/assembly.ts` (in place for `sleeping-dragon`).
