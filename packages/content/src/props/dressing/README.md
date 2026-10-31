# Ground dressing

The living and garden forms that dress open ground (spec 28, R1). `registry.ts` exports `createDressing(form, style?)`,
`DRESSING_FORMS`, `DRESSING_ROLES`, `DRESSING_SIZES` and `ELDER_OAK_SEAT`; `index.ts` re-exports it and adds
`BLUEPRINTS` (finished forms only, in R1 table order; kit forms Hearth, Tide, Grove). Import the registry where
only a few forms are wanted (the kingdom's planner and the tree sheet do): `BLUEPRINTS` grows every form at once,
about a second of work for the trees alone, while `createDressing` grows a form the first time it is asked for
and hands every caller its own copy after that. Non-kit forms are built in Grove. Cover and canopy forms have
`kind: 'flora'`; garden, field and path pieces and the trained pear have `kind: 'prop'`. All units below are
0.125 m build cells, half-open, with y=0 the ground.

So far the collection holds the six meadow cover forms, the `seedling-bed` and the `cutting-bed` in `cover.ts`;
the garden pieces (`garden-bed`, `woodpile`, `barrels`, `crates`, `handcart`) in `garden.ts`; the field runs
(`field-wall`, `rail-fence`, `back-fence`) in `field.ts`; the `stepping-stones` kit form in `path.ts`; and the
twelve trees, hedges and woods in `trees/`. The seedling bed and stones make the tended doorstep; with the
cutting bed they make the market stall's garden. The heather, fern and edge-stone forms will join the same index
as they are authored and reviewed. Until then `createDressing` throws for them.

**Palette.** The validator's ground-dressing palette applies to every form: the kit's trim and stone, plus
`earth`, `bark`, `leaf`, `moss`, `petal`, `blueFlower`, `grass`, `goldLeaf`, `cream`, `thatch` and `terracotta`.
Kit forms use only their own kit's stone. Non-kit pieces are built in Grove (trim is `bark`) and may use any
kit's stone, but never `timber`, `plaster`, `slate` or `glass`.

## Cover

Cover is passive scenery: it sways with the kingdom wind and blocks nothing. Every patch keeps a one-cell margin
of open ground inside its 16×16 footprint, so neighbouring patches never fuse into a carpet. Tufts and drifts
stay four cells (0.5 m) tall or less, so they can stand in front of a facade under the 0.6 m rule.

Each patch is drawn as a **height map**: one row per Z and one mark per column. A digit is a leaf column that
many cells tall, and `a`–`d` are the same heights with a moss top cell. `F`/`H` are flower-head columns with or
without a two-cell leaf stem, and `f`/`h` are the same with the head's top cell left open. `o`/`O` are pebble
stone one or two cells tall (the kit's stone in a path form). `e`/`E` are turned earth one or two cells tall.
`s` is a seedling leaf on one earth cell, `t` is a seedling heart (leaf and moss tip) on one earth cell, and `m`
is one cell of moss. The whole composition of a patch is visible in its plan. Columns never overhang,
except for a head's stemless cells, which its own head holds up. So every patch is grounded by construction.
`plan` throws on a mark in the margin, a column that is too tall, or a head that is not a proper 2×2.
`toBoxes` merges runs along X, then along Z, and writes each cell once.

- **meadow-tufts** 16×4×16: six tufts in two loose pairs and two singles, with the middle left open. Each is a
  pinched clump of blades at uneven heights, tallest off-centre. Bodies are `leaf` (#4c7554), which stays darker
  than the terrain's `grass`. The tallest blades carry a `moss` tip (#74835b), the light catching them. The
  patch covers 22% of its ground course.
- **wildflowers-petal / -blue / -gold / -cream** 16×4×16: one loose drift from front left to back right,
  recoloured with exactly one of `petal`, `blueFlower`, `goldLeaf` or `cream`. It has seven heads. At each of
  its two hearts, two heads stand corner to corner. Singles thin it out at both ends and to one side. Each head
  sits on the third and fourth courses on a short leafy stem. Leaves stand as high as the head's lower course
  around it, so the bloom sits in its foliage. One plain tuft keeps the back left green.
- **clover-pebbles** 16×2×16: two rounded clover mats in `leaf` with `moss` along their sunny rims, plus five
  raised leaves. Four pebbles in `stone` (#aaa49b) are bedded into the lawn: a domed 4×4 at the back right, a
  2×2 tucked against the larger mat, a soft 3×3 at the left and a low one at the front.

- **seedling-bed** 24×3×8: a front-garden bed being planted. A strip of turned `earth` one course deep, with
  ragged ends, holds two staggered rows of seedlings. Each is a cross of `leaf` around a `moss` heart. The back
  row is full (five). The front row stops after three, then one seedling only just set, then the soil from the
  planting holes heaped two cells high. There is no tool and nothing to harvest. It is passive and lies flush,
  so it may stand in a forecourt.

- **cutting-bed** 24×4×10: a grower's cutting bed, the stock of a market stall. A continuous edge of turned
  `earth` holds three staggered rows of 2×2 heads in three blocks of one colour each: five `petal`, four `cream`,
  five `goldLeaf`, never mixed, so it reads as planted rather than wild. `plan` takes a colour per head, named by
  its even corner. Leaves bank against every head. Between the cream and the gold one head has been cut for the
  stall: its bare stems stand with `moss` cut ends, and a single heaped clod lies on the edge beside them. It
  is half a metre tall, passive and flush, with nothing to pick, sit on or step up.

## Garden

Garden pieces are solid props that make the medium-band vignettes against a home's open lot side or the back of
its lot (woodpile and barrels, bed and crates, the handcart). They are seven cells deep, tighter than the R1
maxima, so they fit the narrow margins outside the lots. Each is carved cell by cell with `sculpt` (`garden.ts`): a later
write replaces an earlier one, writing outside the size throws, and `toBoxes` from `cover.ts` writes each cell
once. Solid pieces may touch their box edges; the one-cell margin is for cover only. Back pieces stand with low Z
against a wall or lot line and +Z facing away from the home.

- **garden-bed** (kit) 24×5×12: a raised bed. Soil (`earth`) lies two courses deep inside an edge whose top is
  one course above it. On the soil stands mixed leafy planting, drawn as a height map: a tall leafy mass at the
  left end, a lower clump at the right, low clumps between them with `moss` tips, one bare patch with a turned
  clod, and two 2×2 flower heads on leaf stems. There is no crop, fruit or anything to harvest.
  - Hearth: a `timber` board edge on a `limestone` footing course, with corner stakes and one mid-front stake a
    cell proud. Flowers in `petal`.
  - Tide: a kerb of rounded `stone` cobbles, each crowned a course above its joints. Flowers in `blueFlower`.
  - Grove: rounded `bark` logs two cells thick, the front and back logs running past the ends with `thatch` end
    grain, moss along their tops and a `darkStone` boulder at the back right corner. Flowers in `cream`.
- **woodpile** 20×12×7: round split logs, each a `bark` body three cells across whose end shows a plus of end
  grain inside its bark rind. The rinds of neighbouring logs meet, so no daylight shows through. They are stacked three courses
  on the left and stepping down to two on the right. Their end grain shows on the +Z face in `thatch`, three
  freshly split in `cream`; some ends stand proud, one is set back, and one split half lies flat side down on
  top. Above them is a short `bark` lean-to: two back posts at z=0 carry its high edge, two front posts its eave,
  the slabs overlap down the slope with a ragged eave, and `moss` has taken the upper left.
- **barrels** 14×10×7: two closed barrels with a cell between them. The tall one has `thatch` staves; the shorter,
  darker one in `bark` is set a cell forward with its bung on the other side. Each is a round voxel profile that
  bellies out between `darkStone` hoops and carries a flush lid of its own wood with a stopped bung.
- **crates** 12×12×7: a 7×6×7 crate with `bark` corner battens, a mid rail across its front and `thatch` plank
  panels recessed a cell, and a flush closed lid. A smaller 5×5×6 crate sits on it, turned the other way, set back
  and to the right, with a diagonal brace. A tied `cream` sack with a `thatch` cord slumps against the bottom
  crate's side.
- **handcart** 24×14×12: a parked two-wheeled garden cart. Its wheels are eleven cells across, with a `darkStone`
  tyre, a `bark` felloe, four spokes and a hub cap, and they stand on the ground at z=1 and z=10. The box has a
  `thatch` floor, `terracotta`-painted boards (the one painted accent) in a `bark` frame, and corner stakes. Its
  front rests on two short legs, and the shafts run down to the ground toward +X, joined by a low crossbar. It is
  empty except for one tied sack.

## Field

Field runs are solid kit pieces laid along +X.

- **field-wall** (kit) 32×7×5: a 4 m dry-stone run in the kit's stone. It is battered from five cells at the foot
  to a ridge one cell wide. Its faces are laid in two-cell courses, drawn as marks per X (`course`): the lowest
  course is all proud, and above it stones are proud or set back a cell, with an open cell at joints. That gives an
  uneven top and faces that read stone by stone. Front and back are laid differently. Moss sits on top stones
  only.
  - Hearth: upright cope stones on the ridge and a few patches of `goldLeaf` lichen.
  - Tide: flat slabs, two of them through-stones lipping both faces, and a tuft of `petal` sea thrift on a ledge.
  - Grove: a turf cap of `moss` and `leaf` over the ridge and ferns at its feet.

  **Join:** runs are laid at a pitch of 30 cells with the same base height. The ends are rounded and authored
  column by column (`LEFT_END`, `RIGHT_END`). The left end is lower and narrower and lies strictly inside the right
  end: every occupied cell (x, y, z) with x < 2 has (x+30, y, z) occupied. Every open face of the left end, other
  than its ground face, is covered by a cell of the right end, so two joined runs share no coincident face.
- **rail-fence** (kit) 32×10×4: a 4 m split-rail run. Two posts are set in from the ends, at x=2 and x=27, and
  each leans a cell toward +X above its fifth course. Rails overrun both ends by two cells, and some spans thin to
  one cell deep where the wood was split.
  - Hearth: three `timber` rails, with `limestone` packed round the post feet.
  - Tide: two salt-bleached `thatch` rails on `timber` posts, with `stone` at the feet.
  - Grove: three `bark` rails, moss on the post tops, a `darkStone` boulder and a fern at the feet.

  **Join:** same 30-cell pitch. Each rail drops a cell where it passes through the left post, so its left end rides
  one cell above the right end of the run before it. No left-end cell coincides with a cell 30 on, and each one
  rests on that run's rail end, against its end post (x=29). Double posts and stacked rail ends at every joint
  read as an alpine paired-post fence.
- **back-fence** (kit) 64×9×3: the lot's 8 m back fence. Posts two cells wide span the full depth at x = 0, 16, 32,
  48 and 62 (a post every 2 m and at both ends). Two rails run the whole length on the house side (z=2, at y=2 and
  y=5), and low pales stand in front of them at z=1, a cell above the ground.
  - Hearth: `timber` pales in a gentle arch across each bay, on `limestone` post pads.
  - Tide: `cream`-painted pales cut level, every fourth one taller, on `timber` posts capped with `stone`.
  - Grove: rustic `bark` staves of uneven height and spacing, a few fresh `thatch` ones, posts with `moss` tops,
    `darkStone` at two feet and ferns.

  Neighbouring lots' fences stand 1 m or more apart, so the ends need no overlap.
  On the garden side the planner runs one flower drift (4.4–6 m, the home's kit colours) 1.9 m behind it, tagged
  with the lot, so it moves with the fence and hides with the lot; Old Row and the arrival home almost always have one.

## Path

- **stepping-stones** (kit) 24×2×8: three flat stones a stride apart, two courses of the kit's stone (Hearth
  limestone, Tide stone, Grove dark stone). One is broad and square-shouldered, one is a narrower oval and one is
  long and turned off the line. Turf worn to `earth` lies where feet land between them, and `moss` holds a few
  joints. It is passive: walked over, never a blocker. The planter beds it so only a worn lip shows,
  even where up to 0.14 m of grade relief runs under it.

## Trees

`trees/grammar.ts` grows a tree in a cell grid, and `trees/forms.ts` holds one builder per form. A builder
lays a trunk and limbs (`limb`, `bough`: evenly tapered capsules), roots (`root` arches from the bole to a
foot; `flare` spreads a set of them), then the crown (`lobe` is a flat-bellied ellipsoid; `cloud` is a lobe
with bumps around its upper shoulder). `light` warms the sunlit top of the crown, and `overgrow` lays moss in
patches on roots and limbs. `piece()` tidies, buries and merges the cells into boxes:

- **Crown grain.** A crown is grown in blocks, never single cells, so its surface steps like terraces, not
  noise. The four big broadleaf crowns (`oak-old-a`, `oak-old-b`, `beech`, `elder-oak`) and the
  `woodland-clump` use 0.5 m blocks. The smaller crowns use 0.25 m blocks. Every crown ends up with about the
  same number of steps across. A lobe that the form's box would slice throws; it never ships flattened.
- **Limbs.** Limbs of radius 2.5 cells and more are laid in 2-cell blocks on the same lattice, and twigs taper
  to a single cell. A limb that leaves the box throws, and so does one thinner than 0.9 cells.
- **Tidy and bury.** Foliage fragments under 8 cells (4 for the espalier) take the wood they rest on, so no
  confetti or floating leaves survive. Wood buried deep inside foliage takes the foliage colour, so the merger
  never cuts a crown into stripes around a hidden branch. Boxes merge greedily, up Y, then X, then Z.

| Form | Size (cells) | What makes it |
|---|---|---|
| oak-old-a | 96×112×96 | Short, thick bole with mossy root flare, five limbs, one broad asymmetric fused crown and satellite clouds; its crown base sits low |
| oak-old-b | 96×112×96 | Twin-stemmed and wider than it is tall, a flatter crown pushed to one side |
| beech | 96×112×96 | Smooth stone-grey bole and limbs under a high dome crown |
| elder-oak | 128×144×128 | The forest-edge landmark: a crooked 2.5 m bole, seven flare roots, a great level limb to the west, 18 m tall. Two arm roots hold a worn thatch-topped root seat on its +Z side, with a few small marks cut in the bark above it |
| pine-windbent | 72×88×72 | Leans along +X with roots braced on the windward side, terracotta upper bark, flat cloud pads on bare branches |
| fir | 56×96×56 | Seven whorled skirts narrowing to a spire, sunlit tips |
| birch | 48×80×48 | Two cream stems banded in dark stone over a dark foot, a light moss-green crown touched with gold |
| alder | 56×72×56 | A rounded, leaning crown with side clouds |
| sapling-staked | 16×28×16 | A one-cell stake with a cream tie, in a turned earth ring |
| bramble-hedge | 32×12×10 | Arching canes and five humps, lower at both ends, below stile height |
| pear-espalier | 48×40×6 (`prop`) | Trained flat in four tiers of arms with spurs and a little cream blossom, no fruit |
| woodland-clump | 192×120×192 | Six fused crowns (one a birch) and a fir spire on seven short trunks: one mass at LOD 4 |

**The elder seat.** `ELDER_OAK_SEAT` is a `ContentSeat` (`{ id: 'root-seat', position: [64, 4, 68], approach:
[64, 0, 80], rest: [64, 0, 72], facing: 0 }`, build cells, facing +Z) for the place that binds it. Seats belong
to civic blueprints, so it is published as a constant, not on the blueprint. The kingdom turns the oak by its
landmark yaw so the seat faces its meadow; the tests check the worn top, the bole behind the sitter, open air
above the sitter, and clear rest and approach cells.

**LOD.** The trees, hedge and espalier are made to mount at full detail with LOD 2 and LOD 4 from
`createRenderLodAsset`; the tests hold the LOD-4 silhouette to the full one, and the sheet's lower row is the
LOD-4 copy. The woodland clump stands only far from the eye, so it mounts at LOD 4 only, and its budget is
measured there. Planting (GD04) owns where each form stands; places-high binds the elder seat.

## LOD design

Render LODs (`packages/voxel/src/lod.ts`) keep the non-air mode of each 2×2×2 or 4×4×4 block, and ties go to
the lower material ID. Leaf (10) is lower than every flower (goldLeaf 11, cream 18, petal 20, blueFlower 21),
so a flower only survives where it outnumbers the leaf in its block.

- **LOD 2:** every head is 2×2 on even X and Z, on courses 2–3 (an even Y), so it fills exactly one coarse cell
  and nothing else shares that cell. A chipped head still holds it, 7 cells to 0, because air does not vote. All
  seven heads stay the top of their columns.
- **LOD 4:** the whole drift is one coarse course tall, so flower and leaf compete in the same block. The two
  paired hearts sit inside one 4×4 block each (x 4–8, z 8–12 and x 8–12, z 4–8). Their stems are thin, and the
  leaves banked against them stand just outside the block. That gives 14 flower cells to 12 leaf, so the flower
  wins both blocks. Farther out, the singles read as green.

`dressing.test.ts` checks all of this on the rasterized occupancy, and both LODs through `createRenderLodAsset`.

## Measured costs

Full detail, from the mesher (confirmed by `render-stats.json`); each renders in one draw.

| Form | Cells | Triangles | Boxes |
|---|---|---|---|
| meadow-tufts | 100 | 538 | 45 |
| wildflowers-* (each) | 219 | 956 | 93 |
| clover-pebbles | 96 | 502 | 37 |
| seedling-bed | 182 | 590 | 39 |
| cutting-bed | 351 | 1,098 | 106 |
| garden-bed Hearth / Tide / Grove | 800 / 758 / 802 | 1,030 / 1,192 / 1,034 | 105 / 109 / 118 |
| woodpile | 614 | 1,928 | 164 |
| barrels | 522 | 722 | 71 |
| crates | 398 | 698 | 71 |
| handcart | 427 | 1,496 | 157 |
| field-wall Hearth / Tide / Grove | 718 / 786 / 726 | 1,014 / 1,034 / 956 | 89 / 76 / 99 |
| rail-fence Hearth / Tide / Grove | 241 / 183 / 244 | 568 / 444 / 594 | 30 / 34 / 32 |
| back-fence Hearth / Tide / Grove | 584 / 544 / 586 | 1,716 / 1,558 / 1,818 | 245 / 213 / 254 |
| stepping-stones (each kit) | 182 | 324 | 37 |

Trees, from `trees-stats.json` (the sheet's own meshes):

| Form | Triangles full | Triangles LOD 4 | Boxes |
|---|---|---|---|
| oak-old-a | 17,878 | 3,094 | 784 |
| oak-old-b | 20,502 | 3,358 | 771 |
| beech | 13,716 | 2,356 | 585 |
| elder-oak | 35,888 | 5,790 | 1,597 |
| pine-windbent | 13,092 | 1,384 | 677 |
| fir | 13,300 | 1,244 | 551 |
| birch | 8,960 | 780 | 383 |
| alder | 11,434 | 1,020 | 513 |
| sapling-staked | 1,114 | 134 | 64 |
| bramble-hedge | 658 | 94 | 83 |
| pear-espalier | 4,778 | 410 | 139 |
| woodland-clump | (38,192, never mounted) | 7,374 | 953 |

The back fence spans two mesher chunks; it is still one model draw. Budget: ≤ 1,500 triangles and ≤ 400 boxes
per cover form, ≤ 6,000 triangles and ≤ 2,000 boxes per garden, field or path form, ≤ 24,000 triangles per tree,
hedge or espalier, ≤ 40,000 for the elder oak and ≤ 8,000 for the woodland clump at LOD 4, all ≤ 2,000 boxes. The flush forms are mounted at full detail
only: a coarse level would stand a one-course stone up as a slab.

## Commands

```sh
pnpm exec vitest run packages/content/src/props/dressing
pnpm build && pnpm content:render --collection ground-dressing --hour 19   # and --hour 12
node apps/web/src/kingdom/ground-dressing/capture.mjs --trees   # tree sheets: trees-sheet, -grey, -silhouette, elder-dusk
```

The tree sheet is `apps/web/src/kingdom/ground-dressing/trees.html`, served by the Vite dev server only:
`?mode=sheet` (full detail above, LOD 4 below, one representative angle, true scale), `mode=silhouette`,
`mode=elder` (the oak at 18:00, turned so its seat looks into the low sun), `grey=1` and `forms=a,b`.

## Review rounds

Each round was rendered in the production bench at dusk and noon. What was rejected:

- **Tufts as fans of single-cell blades** on a flared second course: at stream size they broke into loose cubes,
  which is confetti. Height-map clumps replaced them.
- **Tall drifts:** heads at 0.5–0.75 m on four-cell leafy stems. They read as lollipops and broke the facade
  height rule. Heads moved down to courses 2–3.
- **Cube heads on bare tufts:** the 2×2×2 heads read as sugar cubes set on the foliage. Leaves now bank against
  each head's lower course, and most heads have one chipped top corner.
- **Three heads in one LOD-4 block:** at least two would share a face and become a 4×2 slab. The pairs touch
  corner to corner instead.
