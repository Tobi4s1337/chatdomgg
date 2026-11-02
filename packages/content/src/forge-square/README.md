# The forge hearth

`createForgeHearth(style)` makes a fresh, grounded civic blueprint for the three style kits. Its 24 × 37 × 18
build-cell envelope is 3 × 4.625 × 2.25 m. The furnace mouth faces +Z; the ground placement pivot is
`FORGE_HEARTH_PIVOT` at `[12, 0, 9]`. The firebox has a recessed coal bed, open arch, low iron grate,
stone curb, copper keystone and binding, diagonal brace, and tools on the right flank. Its stepped stone flue
directly supports the unmodified `createAnvilHeroDragon(style)` sculpture, translated up 21 cells.

The caller supplies fire, smoke, illumination and placement. `FORGE_HEARTH_FLAME` is `[12, 6, 15]` in the
open firebox; `FORGE_HEARTH_CHIMNEY_NOSE` is `[DRAGON_EMITTER[0], 21 + DRAGON_EMITTER[1], DRAGON_EMITTER[2]]`, at the dragon's open nose. These coordinates are
local build cells, before the caller's transform. For nearby braziers, reuse `createGateBrazier` from
`arrival-lights`; this asset deliberately contains neither an anvil nor a duplicate brazier.

The three-angle CPU occupancy preview is in `shots/forge/hearth/hearth-cpu.png`; it does not show production shaders or lighting.
`hearth.test.ts` checks the strict blueprint schema, open anchors and face-connected ground support in each kit.

## The forge remembers: the ledger wall

`createForgeLedgerWall(style)` (`ledger-wall.ts`) makes the freestanding memorial wall for the forge square, a
`prop` of 40 × 36 × 9 build cells (5 × 4.5 × 1.125 m). +Z is the read face. The stone footing is 7 cells deep
(z 1–8); the roofs overhang it by one cell front and back. `FORGE_LEDGER_WALL_PIVOT` `[20, 0, 4.5]` is the ground
centre of the footing. The wall has stone end piers, timber posts carrying kit pennants on brass rods, a hammer and
tongs hung on the outer flanks, low shoulder roofs over the posts and a raised centre roof over the title board,
each with a brass verge. The back is a dark plank skin with a timber frame and a cross brace in each half.

The wall holds no pieces and no lettering; the caller draws them. `FORGE_LEDGER_WALL_NICHES` lists twelve niches
in reading order (rows top to bottom, columns left to right seen from +Z). Each `floor` is the centre of the shelf
top, at the front-to-back middle of an empty `size` of 7 × 7 × 4 cells, in front of a dark lining (bark, or
iron-dark stone in Grove). Each `plaque` is the 7 × 2 raised name plank at the front of that shelf: its centre lies
on the front plane z = 8, between brass bosses. `FORGE_LEDGER_WALL_HEADER` is the 28 × 4 raised title board face,
centre `[20, 31, 8]`. The shape is identical in every kit; only the materials change.

The three-angle CPU occupancy previews are in `shots/forge-wish/ledger-wall/` (`ledger-wall-<style>.png`; the
`-pieces` variants stand plain blocks in the niches to judge contrast). They do not show production shaders or
lighting. `ledger-wall.test.ts` checks the strict schema, identical shape across kits, open niches over solid
shelves, solid boards behind the plaque and header planes, reading order and face-connected ground support.
