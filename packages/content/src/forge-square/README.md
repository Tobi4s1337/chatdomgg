# The forge hearth

`createForgeHearth(style)` makes a fresh, grounded civic blueprint for the three style kits. Its 24 × 37 × 18
build-cell envelope is 3 × 4.625 × 2.25 m. The furnace mouth faces +Z; the ground placement pivot is
`FORGE_HEARTH_PIVOT` at `[12, 0, 9]`. The firebox has a recessed coal bed, open arch, low iron grate,
stone curb, copper keystone and binding, diagonal brace, and tools on the right flank. Its stepped stone flue
directly supports the unmodified `createAnvilHeroDragon(style)` sculpture, translated up 21 cells.

The caller supplies fire, smoke, illumination and placement. `FORGE_HEARTH_FLAME` is `[12, 6, 15]` in the
open firebox; `FORGE_HEARTH_CHIMNEY_NOSE` is `[0, 23, 9]`, at the dragon's open nose. These coordinates are
local build cells, before the caller's transform. For nearby braziers, reuse `createGateBrazier` from
`arrival-lights`; this asset deliberately contains neither an anvil nor a duplicate brazier.

The three-angle CPU occupancy preview is in `shots/forge/hearth/hearth-cpu.png`; it does not show production shaders or lighting.
`hearth.test.ts` checks the strict blueprint schema, open anchors and face-connected ground support in each kit.
