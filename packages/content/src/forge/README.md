# Forge piece families

Reusable house parts for hands and the Forge, in three families: `hearthfold` (Hearth kit), `tidewake` (Tide kit) and
`grovebough` (Grove kit). Each piece is a `ForgePieceDefinition` from `@chatdom/shared`: a strict `VoxelBlueprint`
(`kind: 'prop'`) plus connectors, clearance boxes and, for doors, a separate hinged leaf. Spec: `work/specs/09-forge-pieces.md`.

Only finished pieces are exported. `createForgePiece(family, form)` takes a family and form from `FORGE_FAMILIES`
and `FORGE_FORMS` and nothing else; unknown input throws, and so does a form that is not finished yet. There are no
optional finishes, numeric inputs or free-form material choices.

| Family | Finished forms |
|---|---|
| `hearthfold` | all fifteen: floor, wall, wall-corner, door (+ leaf), window, shutter-pair, roof-slope, roof-ridge, roof-gable, roof-verge, porch-deck, porch-post, porch-canopy, chimney, trim |
| `tidewake` | all fifteen (+ leaf) |
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
  face stay clear across the rectangle (clearance `[4,8,2]..[12,18,8]`). Windows are unlit content anchors. A
  `shutters` mount sits at `[8, 7, 4]` (bottom centre of the reveal, on the face plane).
- **Shutters:** two 5 × 12 panelled leaves (back boards, a proud frame of stiles and rails round two sunk panels,
  brass straps at the hinge stile), fixed open flat on the face either side of the reveal. The piece's origin is
  window cell `(−2, 7, 4)`, so the leaves cover window x −2..3 and 13..18 one cell proud of the face and bear on
  the bay's two face posts and the sill ends; they reach two cells over the neighbouring bays without touching
  them. They never enter the light rectangle (x 4..12) or its clearance and close nothing: open shutters only.
- **Porch deck:** a 16 × 2 × 12 doorstep module on the floor-tile grid: limestone bed, timber boards flush with
  the floor top (y 2, the door threshold), a 2-deep limestone kerb and a 2-deep step at y 1, so the approach drops
  1 then 1. Modules sit side by side into a terrace; it mates a floor tile's street edge (`floor`). Post seats sit
  at x 7 and 9, z 7 (`seat-7`, `seat-9`).
- **Porch post:** a 2 × 2 timber post, 24 tall from the deck top, on a 4 × 2 × 4 limestone foot, with a stepped
  knee under the beam on its +X side. The right-hand post of a pair is the same piece turned twice, never mirrored.
- **Trim:** a 16-long, 2-deep, 3-tall timber beam under a 4-deep cap board. Its ends frame into post faces (the
  porch bressummer, bottom at post height 21); its feet also meet the wall-head joints so it can cope a free wall run.
- **Porch canopy:** a 20 × 23 × 12 gabled hood in the main roof's 3:2 courses (2 timber under 3 terracotta, five
  a side), 10 deep plus a 2-deep verge band one cell proud above and below, a ridge roll and a small finial. A
  16 × 2 timber ledger bears on the door bay's wall plate (`canopy` on the door, `[8, 22, 4]`), the first courses
  on the post heads and a king-post truss on the beam cap. Its eaves sit 2 above the door head plate; it belongs
  under a gable (the door bay under a gable end), never under a side eave, which hangs into its space.
- **Chimney:** 8 × 24 × 8. A 6 × 6 limestone stack steps onto three roof courses (5, 6, 7), a proud limestone
  drip course marks the set-off, the upper 4 × 4 stack leans one cell along the ridge and a terracotta lid on four
  piers caps the open 2 × 2 flue, whose dark mouth shows between the piers. It seats at the slope's `chimney`
  connector `[8, 23, 7]` (mid-bay, the top of course 6) and stands 8 cells clear of the ridge roll.

### Profiles

Equal profile IDs mate when their transformed points coincide and their normals oppose (`mateConnectors`). The
section is the whole mating cross-section, in cells either side of the connector plane: for horizontal normals `u`
runs along up × normal and `v` up from the point; for up/down normals `u` and `v` are the reading piece's own
turned x and z.

| Profile | Where | Section |
|---|---|---|
| `hearthfold-wall-side` | bay and corner-arm ends, foot centreline | foot and plate solid across 4; middle 2 solid full height |
| `hearthfold-wall-foot` | post feet (down), floor seats at 7/9 along each edge, 2 in (up) | 2 × 2 |
| `hearthfold-wall-head` | plate top at bay ends and arm ends (up), slope seat and gable feet (down) | 4 × 4 |
| `hearthfold-floor-edge` | floor tile edge midpoints, porch deck back edge | 16 × 2 |
| `hearthfold-roof-section` | slope eave-tip ends, verge (covers) | ten 2 × 5 courses rising 3; chiral |
| `hearthfold-ridge-seat` | slope crest (up), ridge (down) | 4 × 4 |
| `hearthfold-ridge-section` | ridge ends, verge apex | roll 4 wide (2 at the crown) with 2-wide saddles |
| `hearthfold-gable-apex` | gable top (up), slope underside at the crest (down) | 4 × 4 |
| `hearthfold-shutter-mount` | window face (south), shutter pair (north) | the two face posts, 1 × 12 each, behind the leaves |
| `hearthfold-porch-foot` | deck seats (up), post foot (down) | 4 × 4 |
| `hearthfold-beam-end` | post inner face (east), trim ends | beam 2 × 3 |
| `hearthfold-porch-head` | post head (up), hood eave bearings (down) | 2 × 2 |
| `hearthfold-beam-top` | trim cap (up), hood truss (down) | 2 × 2 |
| `hearthfold-canopy-ledger` | door bay plate over the door (south), hood ledger (north) | 16 × 2 |
| `hearthfold-chimney-seat` | slope course 6 (up), chimney base (down) | 6 along the ridge × 2; chiral, read from the slope |

## Tidewake

Salt-pale weatherboard over a grey stone plinth, long-and-short stone quoins, a low 1:1 slate roof whose long eaves
flare out at a 1:2 kick, braced post-and-lintel timber and ledged windows. All measures are fixed in `TIDEWAKE`
(`tidewake.ts`); the slope's column profile is `tideUnder(d)`. Tide shares only the common measures with Hearth:
its roof, corner, porch structure, openings and every profile are its own.

- **Wall:** a 3-tall stone plinth, a cream field set one cell back from the face and a timber plate (y 22..24).
  The bottom row of every 3-row board course (y 4, 7, 10, 13, 16, 19) stands one cell proud: weatherboard laps that
  run unbroken across bay joints. No posts at the bay ends, so a run of bays reads as one broad pale wall.
- **Corner:** the same 8-arm L as Hearth (so the same `8 + 16n + 8` sides and running bond), closed by stone quoins
  flush with the laps: each course alternates a 5-cell and a 3-cell block on the two faces.
- **Roof:** column `d` (cells from the crest) has its underside at `18 − d` for the sixteen columns inside the wall
  face (1:1), then `2, 2, 1, 1, 0, 0` for the six-cell eave: the kick. Each column is 1 timber sarking under 2
  slate. The slope seats on the wall head at slope y 3; the eave tip hangs 3 below the plate and 6 cells out.
  The crest is 18 above the plate (Hearth: 26), the span the same two bays. Timber sprockets fill from the plate to
  the slab over the wall's four cells.
- **Ridge:** a stepped slate saddle thickening the three crest columns each side, under a 2 × 2 timber ridge board.
- **Gable:** 24 wide between the side walls, one column per roof column (15 − d tall), weatherboard laps continuing
  the walls' courses, a timber sill beam, a king post and two struts climbing to the rafters.
- **Verge:** one band across the whole roof end (46 wide, one past each eave tip), 2 deep: a 2-tall timber bargeboard
  under every slab column and slate one cell proud above it; the apex covers the ridge saddle and board ends.
- **Door:** a 12 × 20 opening between timber jambs under a timber lintel. The leaf (`forge-tidewake-door-leaf`) is
  ledged and braced: 12 × 20 boards one cell thick against the inner face, and an outer layer of three ledges and
  two climbing braces that stops one cell short of the latch edge, with iron (darkStone) straps on the hinge-side
  ledges and a brass latch. Hinge `[2, 0, 0]`, `openQuarterTurns: 1` (inward). A one-cell rebate in the latch jamb's
  inner face lets the boards' corner clear it. The open leaf stands 2 thick against the hinge side, so the passage
  is `[4,0,−12]..[14,20,4]` (10 × 20). Swing reservation: `[2,0,−13]..[15,20,1]` for the boards and
  `[2,0,1]..[14,20,2]` for the ledge layer; threshold `[8, 0, 2]`.
- **Window:** an 8 × 12 one-over-one sash (glass `centre [8,13,2]`, facing south) with a heavy 2-row meeting rail,
  a timber casing round the reveal, a stone sill through the wall projecting two cells on two corbels, and a
  stepped slate drip hood above. Clearance `[4,7,2]..[12,19,8]`. A `shutters` mount sits at `[8, 6, 4]`.
- **Shutters:** two 5 × 14 board leaves with two proud ledges each, ending in iron straps at the hinge, fixed open
  flat on the face. Origin is window cell `(−2, 6, 4)`: they cover window x −2..3 and 13..18, bear on the casing at
  x 2 and 13, sit between the sill and the hood, and never enter the light rectangle.
- **Porch deck:** a 16 × 2 × 12 boardwalk module: timber boards flush with the floor top on three stone sleepers
  (z 0, 4, 8), so the open bays show from the side, and a 2-deep timber tread one cell down. Seats at x 7 and 9, z 7.
- **Porch post:** a 2 × 2 timber post, 21 tall from the deck top, on a 3-tall stone pier of its own section (so it
  stands beside the doorway without narrowing the passage), with a two-step knee brace climbing outward (−X) to the
  hood's outer eave column (`knee`, `[1, 23, 2]`). The right-hand post is the same piece turned twice.
- **Trim:** a 16-long lintel: a 2 × 2 timber beam on two 3-long bolsters that rest on post heads (`post-west`,
  `post-east`), under a 4-deep slate cap. Its ends also meet wall-head joints, so it can cope a free wall run.
- **Porch canopy:** a 20 × 14 × 12 gabled hood at the main roof's 1:1 pitch with the same 1:2 kicked eaves, so it
  nests 2 cells under the main verge's bargeboards everywhere. 1 timber under 2 slate, a front verge of a 1-tall
  barge under slate one proud, and a ridge board. Its ledger bears on the door bay's plate, weatherboard fills to
  the rafters over the door bay, a king post and two struts carry the crest on the beam cap, and the outer eave
  columns bear on the post knees. Its lowest member over the doorway is the beam, 22 above the deck.
- **Chimney:** 6 × 19 × 6, narrow and wind-shaped. A 4 × 4 stone stack steps onto slope columns 3..6 near the
  ridge, a slate string course rings it, and a dark cowl closes the windward (ridge) side and the top, leaving the
  flue's mouth open down the slope. It seats at the slope's `chimney` connector `[8, 17, 4]`.

### Tidewake profiles

| Profile | Where | Section |
|---|---|---|
| `tidewake-wall-side` | bay and corner-arm ends, foot centreline | plinth (3) and plate solid across 4; middle 2 solid full height |
| `tidewake-wall-foot` | plinth feet (down), floor seats at 7/9 along each edge, 2 in (up) | 2 × 2 |
| `tidewake-wall-head` | plate top at bay and arm ends (up), slope seat, gable and trim feet (down) | 4 × 4 |
| `tidewake-floor-edge` | floor tile edge midpoints, deck back edge | 16 × 2 |
| `tidewake-roof-section` | slope eave-tip ends, verge (covers) | twenty-two 1 × 3 columns on the kicked 1:1 line; chiral |
| `tidewake-ridge-seat` | slope crest (up), ridge (down) | 4 along the ridge × the two crest columns |
| `tidewake-ridge-section` | ridge ends, verge apex | stepped saddle over three columns each side, 2 × 2 board |
| `tidewake-gable-apex` | gable top (up), slope underside at the crest (down) | 2 × 2 |
| `tidewake-shutter-mount` | window face (south), shutter pair (north) | the casing, 1 × 14 each side, behind the leaves |
| `tidewake-porch-foot` | deck seats (up), post pier (down) | 2 × 2 |
| `tidewake-porch-head` | post head (up), lintel bolsters (down) | 2 × 2 |
| `tidewake-porch-knee` | knee brace top (up), hood outer eave column (down) | 1 outward × 2; chiral, read from the post |
| `tidewake-beam-top` | lintel cap (up), hood king post (down) | 2 × 2 |
| `tidewake-canopy-ledger` | door bay plate over the door (south), hood ledger (north) | 16 × 2 |
| `tidewake-chimney-seat` | slope column 4 (up), chimney base (down) | 4 along the ridge × 1; chiral, read from the slope |

## Review cottages

`FORGE_REVIEW` holds one bench-only assembly per finished family: instance IDs, piece IDs, integer positions,
quarter turns and the entrance focus. Composed windows are named `<instanceId>-<windowId>`. The Hearthfold cottage
stands gable to the street on a 32 × 48 footprint (x 16..48, z 68..116) inside the hut's active depth (z 64..128):
six floor tiles, four corners, a door, two shuttered windows, three walls, three bays of roof each side, three
ridge segments, two gables and two verges, a chimney at the back of the west slope (it faces the review camera),
and a porch: two deck modules make a 32 × 12 terrace to the lot edge, two posts 18 apart (x 22..24 and 40..42)
frame the 12-wide door with a trim beam between them, and the gabled hood (x 22..42) joins the wall plate over
the door. The hood stays 3 cells under the main verge, its truss and beam leave 20 cells of headroom over the
deck, and the posts, feet and knees stay outside the door's width. Thirty-eight instances use all fifteen forms.

The Tidewake cottage shares that shell layout (the same ten wall instances and six floor tiles, gable to the
street) so the two hands compare directly; everything above the plates and in front of the door is its own. Its
slopes sit at y 23 and kick out to x 10..54, the ridge board crowns them at y 46..48, the verges carry bargeboards
across both roof ends, and a cowled chimney stands near the ridge at the back of the west slope. The porch is post
and lintel: two boardwalk modules, two posts on stone piers beside the door (x 24..26 and 38..40), the lintel on
their heads (x 24..40) and the nested hood (x 22..42) on the door plate, the lintel cap and the two knee braces. The
hood keeps 2 cells under the main bargeboards, the lintel leaves 22 cells over the deck, and the piers stand
outside the 10-wide passage. Thirty-eight instances use all fifteen forms. The same test runs over both fixtures; each
family names the porch connectors its construction must mate.

`forge.test.ts` rasterizes the real definitions with the published turns and checks: no shared cells and nothing
behind the hut depth; every wall, roof and end connector mated, with each mate's documented section solid on both
sides and owned by the mating pieces; ground support with the leaf open and closed; a sealed room with the door
shut; a supported passage from the street over the deck and step through the open door, with rises of at most
two cells and 20 cells of headroom; glass and two clear outward cells for every window (shutters included); clearance boxes clear; and the leaf inside its swing reservation through
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
| shutter-pair | 16 | 196 | 296 |
| porch-deck | 3 | 352 | 128 |
| porch-post | 4 | 132 | 124 |
| porch-canopy | 51 | 1,616 | 1,584 |
| chimney | 13 | 564 | 528 |
| trim | 2 | 160 | 66 |
| door-leaf | 4 | 240 | 56 |

Each component renders in one measured draw. The composed fifteen-form cottage meshes to 13,010 triangles with the door open (12,898 closed) in one draw; the window view adds the two draws of the presence layer.
