# Ground dressing

The living and garden forms that dress open ground (spec 28, R1). `index.ts` exports `createDressing(form, style?)`,
`BLUEPRINTS` (finished forms only, in R1 table order; kit forms Hearth, Tide, Grove), `DRESSING_FORMS`,
`DRESSING_ROLES` and `DRESSING_SIZES`. Non-kit forms are built in Grove and have `kind: 'flora'`. All units below
are 0.125 m build cells, half-open, with y=0 the ground.

So far the collection holds the six cover forms in `cover.ts`. The heather, fern, garden, field, path, tree and
woodland forms will join the same index as they are authored and reviewed. Until then `createDressing` throws
for them.

## Cover

Cover is passive scenery: it sways with the kingdom wind and blocks nothing. Every patch keeps a one-cell margin
of open ground inside its 16×16 footprint, so neighbouring patches never fuse into a carpet. Tufts and drifts
stay four cells (0.5 m) tall or less, so they can stand in front of a facade under the 0.6 m rule.

Each patch is drawn as a **height map**: one row per Z and one mark per column. A digit is a leaf column that
many cells tall, and `a`–`d` are the same heights with a moss top cell. `F`/`H` are flower-head columns with or
without a two-cell leaf stem, and `f`/`h` are the same with the head's top cell left open. `o`/`O` are pebble
stone one or two cells tall. The whole composition of a patch is visible in its plan. Columns never overhang,
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

Budget: ≤ 1,500 triangles per cover form.

## Commands

```sh
pnpm exec vitest run packages/content/src/props/dressing
pnpm build && pnpm content:render --collection ground-dressing --hour 19   # and --hour 12
```

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
