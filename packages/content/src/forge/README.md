# Forge piece families

Reusable house parts for hands and the Forge, in three families: `hearthfold` (Hearth kit), `tidewake` (Tide kit) and
`grovebough` (Grove kit). Each piece is a `ForgePieceDefinition` from `@chatdom/shared`: a strict `VoxelBlueprint`
(`kind: 'prop'`) plus connectors, clearance boxes and, for doors, a separate hinged leaf. Spec: `work/specs/09-forge-pieces.md`.

Only finished pieces are exported. `createForgePiece(family, form)` takes a family and form from `FORGE_FAMILIES`
and `FORGE_FORMS` and nothing else; unknown input throws, and so does a form that is not finished yet. There are no
optional finishes, numeric inputs or free-form material choices.

| Family | Finished forms |
|---|---|
| `hearthfold` | floor, wall, wall-corner, door (+ leaf), window, roof-slope, roof-ridge, roof-gable, roof-verge |
| `tidewake` | none yet |
| `grovebough` | none yet |

## Frame and transforms

All cells are 0.125 m build cells and boxes are half-open. Every piece is authored with its exterior toward +Z. A
review instance turns by positive-Y quarter turns about its local origin (three.js `rotation.y`), then translates:
a point `(x, z)` becomes `(z, −x)` for one turn, `(−x, −z)` for two and `(−z, x)` for three. Normals turn the same
way (east → north → west → south → east for one turn each). A piece's own air boxes carve only that piece: the
composer (`composeForgeFixture`) rasterizes each piece and adds its final solid cells, so no carve reaches a neighbour.

## Common measures

A bay is 16 cells long, a wall 24 tall and 4 thick. A floor tile is 16 × 2 × 16; when mounted, wall y = 0 is the
floor top (world y = 2 on open ground). Walls run over the outer four cells of the floor grid.

## Hearthfold

Broad steep terracotta gables, plaster panels set one cell back between one-cell timber posts, a limestone foot
four cells high and a two-cell timber wall plate. All measures are fixed in `HEARTHFOLD` (`hearthfold.ts`).

- **Corner:** an L of two 8-cell arms around a 2×2 post, so a house side is `8 + 16n + 8` cells and wall joints fall
  between floor-tile joints (a running bond). Each corner closes both faces once; no wall overlaps another.
- **Roof:** courses rise 3 for every 2 across, each slab 5 thick (2 timber sarking under 3 terracotta). Ten courses
  cover a 16-cell half span and a 4-cell overhang, so a roof spans exactly two bays (32 cells, wall face to wall
  face) and runs any whole number of bays along its ridge. The slope bears on the wall head at slope y = 6 through a
  4-cell timber seat; the eave hangs 6 below the head. The underside reaches 27, the crest 32.
- **Ridge:** a terracotta roll on the crest with saddles over the second course, 16 long.
- **Gable:** a stepped end infill 24 wide between the side walls, on the end wall plates: plaster with a king post
  and collar beam below hung terracotta tiles. It meets the slope underside at every course.
- **Verge:** one terracotta band across a whole roof end, one cell proud of the slab above and below and two cells
  thick; its apex covers the ridge end and carries a small terracotta finial. It is the ridge's finished terminal.
- **Door:** a 12 × 20 opening between timber jambs under a limestone lintel. The leaf (`forge-hearthfold-door-leaf`)
  is a 12 × 20 × 1 board door with brass straps, closed against the inner face behind a three-cell reveal. Hinge
  `[2, 0, 0]`, `openQuarterTurns: 1` (it swings inward). A one-cell rebate in the latch post's inner face lets the
  leaf's corner clear it. Passage `[3,0,−12]..[14,20,4]` (11 × 20 into the room); swing reservation
  `[2,0,−13]..[15,20,1]`; threshold `[8, 0, 2]`.
- **Window:** an 8 × 10 light, glass one cell in from the inner face (`centre [8,13,2]`, facing south), a timber
  frame and cross, a timber lintel and a limestone sill one cell past the face. The reveal and four cells beyond the
  face stay clear across the rectangle (clearance `[4,8,2]..[12,18,8]`). Windows are unlit content anchors.

### Profiles

Equal profile IDs mate when their transformed points coincide and their normals oppose (`mateConnectors`). The
section is the whole mating cross-section, in cells either side of the connector plane: for horizontal normals `u`
runs along up × normal and `v` up from the point; for up/down normals sections are squares about the point.

| Profile | Where | Section |
|---|---|---|
| `hearthfold-wall-side` | bay and corner-arm ends, foot centreline | foot and plate solid across 4; middle 2 solid full height |
| `hearthfold-wall-foot` | post feet (down), floor seats at 7/9 along each edge, 2 in (up) | 2 × 2 |
| `hearthfold-wall-head` | plate top at bay ends and arm ends (up), slope seat and gable feet (down) | 4 × 4 |
| `hearthfold-floor-edge` | floor tile edge midpoints | 16 × 2 |
| `hearthfold-roof-section` | slope eave-tip ends, verge (covers) | ten 2 × 5 courses rising 3; chiral |
| `hearthfold-ridge-seat` | slope crest (up), ridge (down) | 4 × 4 |
| `hearthfold-ridge-section` | ridge ends, verge apex | roll 4 wide (2 at the crown) with 2-wide saddles |
| `hearthfold-gable-apex` | gable top (up), slope underside at the crest (down) | 4 × 4 |

## Review cottages

`FORGE_REVIEW` holds one bench-only assembly per finished family: instance IDs, piece IDs, integer positions,
quarter turns and the entrance focus. Composed windows are named `<instanceId>-<windowId>`. The Hearthfold cottage
stands gable to the street on a 32 × 48 footprint (x 16..48, z 68..116) inside the hut's active depth (z 64..128):
six floor tiles, four corners, a door, two windows, three walls, three bays of roof each side, three ridge
segments, two gables and two verges.

`forge.test.ts` rasterizes the real definitions with the published turns and checks: no shared cells and nothing
behind the hut depth; every wall, roof and end connector mated, with each mate's documented section solid on both
sides and owned by the mating pieces; ground support with the leaf open and closed; a sealed room with the door
shut; a supported passage from the street through the open door, with rises of at most two cells; glass and two
clear outward cells for every window; clearance boxes clear; and the leaf inside its swing reservation through
the whole quarter turn.

## Review route and captures

`/-/forge` (`apps/web/src/forge-bench`) composes a fixture and renders it with the production worker pool,
`geometryFromChunks`, voxel material, environment grade and window-light layer. Inputs: `family`, `view=assembly|door|window`,
`door=closed|open`, `presence=off|on` (window view only, labelled SIMULATED) and `hour=0..23`; defaults are
hearthfold, assembly, open, off, 19. Unknown input fails visibly. `window.__chatdomForge` reports the state, model
fingerprint, boxes, windows, triangles and draws once the GPU frame is finished.

```sh
pnpm build
node apps/web/src/forge-bench/capture.mjs                     # every finished family
node apps/web/src/forge-bench/capture.mjs --family hearthfold # one family
node apps/web/src/forge-bench/capture.mjs --base-url http://127.0.0.1:5190
pnpm content:render --collection forge-pieces --style hearth  # three-angle component views and sheets
```

Capture output for each family under `shots/forge-pieces/<family>/`:

- `assembly/dusk-desktop@1440x900.png`, `assembly/dusk-phone@390x844.png`, `assembly/dusk-stream@1920x1080.png`
- `assembly/noon-desktop@1440x900.png`, `assembly/noon-phone@390x844.png`, `assembly/night-desktop@1440x900.png`, `assembly/night-phone@390x844.png`
- `door/door-closed@1440x900.png`, `door/door-open@1440x900.png` (dusk)
- `window/window-off@1440x900.png`, `window/window-on@1440x900.png` (21:00, SIMULATED presence)
- `review-sheet@1440.png` (all of the above) and `capture-stats.json`

The capture holds the shared capture lock, owns a temporary preview unless `--base-url` is given, fails on browser
errors, and fails when the bench reports a different state or a fingerprint other than the current source (a stale
build). Component sheets land in `shots/content/forge-pieces/style-<kit>/`.

## Costs (Hearthfold, measured)

| Piece | Boxes | Cells | Triangles |
|---|---:|---:|---:|
| floor | 2 | 512 | 138 |
| wall | 11 | 1,296 | 164 |
| wall-corner | 7 | 972 | 190 |
| door | 10 | 556 | 150 |
| window | 12 | 1,092 | 332 |
| roof-slope | 25 | 1,728 | 1,152 |
| roof-ridge | 4 | 480 | 306 |
| roof-gable | 13 | 1,132 | 366 |
| roof-verge | 25 | 664 | 638 |
| door-leaf | 4 | 240 | 56 |

Each component renders in one measured draw. The composed cottage meshes to 7,930 triangles with the door open (7,304 closed) in one draw; the window view adds the two draws of the presence layer.
