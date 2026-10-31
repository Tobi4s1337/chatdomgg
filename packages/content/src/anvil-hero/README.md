# The sleeping dragon chimney

`createAnvilHeroDragon(style)` returns a fresh `MotifGeometry` for `hearth`, `tide` or `grove`.
Its envelope remains `[24,16,18]` and mount `[12,0,9]`; the nose faces the home's +Z street frontage.
The exported `DRAGON_EMITTER` names the actual open nostril. Consumers use that anchor rather than assuming
that a later sculpt keeps an older nose position.

The sculpture is authored on the build lattice and merged into non-overlapping half-open boxes. Each call
returns fresh boxes because the Forge assembler applies the selected native finish and inlay to them.
The pose depends on a large sleeping head on separate forepaws, a rounded curled body, swept horns and a folded
wing around an open masonry flue. The head and paws must read before the chimney from the street.

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
