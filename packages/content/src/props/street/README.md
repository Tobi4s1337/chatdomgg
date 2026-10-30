# Street props

Ten passive forms that edge a front garden, each in the Hearth and Tide kits (spec 06). `index.ts` exports
`createStreetProp(form, style)`, `BLUEPRINTS` (finished forms only, Hearth then Tide, in form order),
`STREET_PROP_FORMS`, `STREET_PROP_SIZES` and the bench-only `JOIN_FIXTURES`. Structure uses the kit's `trim`
(timber) and `stone`; accents are registered moss, earth, bark, leaf, petal or blueFlower. All units below are
0.125 m build cells, half-open, with y=0 the ground.

## Join planes

Every run lies along local +X with its centre line at z=2. Straight pieces join on x=0 and x=16. A corner's
arms end on x=0 and z=16, around a corner square at x 12..16, z 0..4. An end piece receives a run on its x=0
face. Rotate any piece by positive-Y quarter turns about its local origin, then translate. A quarter turn maps
the cell `(x, z)` to `(z, −x−1)`.

| Kit piece | Section crossing every running join plane (y × lateral) |
|---|---|
| Fence rails | y 3..5 and y 8..10, each z 1..3 (2×2 timbers) |
| Wall plinth | y 0..2, z 0..4 |
| Wall body | y 2..6, z 1..3 (set back one cell each face) |
| Wall cap | y 6..8, z 0..4 |
| Wall crown | y 8..9, z 1..3; cope joints at x 5 and 10, so stones pair across a join |

- **fence-straight** 16×12×4: one bay. A line post sits mid-bay (x 7..10) on a footing stone, leans one cell along
  the run above y 6 and has a rounded top. Placing it mid-bay means a run never puts a line post against a
  strainer.
- **fence-corner** 16×12×16: a strainer post at x 12..16, z 0..4, with rails out to x=0 (z 1..3) and to z=16 (x 13..15).
- **fence-end** 4×12×4: the same strainer: stone plinth y 0..2, a chamfered timber whose rail-bearing faces are
  solid at cells 1..3, a cap at y 10 and a finial.
- **wall-straight** 16×9×4: the three-course section above, with moss in one cope joint.
- **wall-corner** 16×9×16: the same section turned, still one wall thick. Alternating quoins (y 2..4 along X,
  y 4..6 along Z) bond the corner, and the corner cope is a single L stone.
- **wall-end** 4×10×4: a pier whose x=0 face is solid across the whole wall section. Its outer edges are
  chamfered and its cap (y 7..9) sits one course above the wall cap, so the wall visibly stops.

## Review assemblies

`JOIN_FIXTURES` holds one front garden per kit. The core house stands behind z=0 and the street edge is at
z 32..36. Each side runs end → straight → corner from the path to the street edge, then straight → end back
toward the house. The path opening at x 20..40 stays clear in front of the door. Hearth puts the wall on the
left and the fence on the right; Tide swaps them, so every piece is checked in several orientations. The plant
transforms reserve full row footprints clear of the edges.

`street.test.ts` checks the transformed occupancy:
- no overlaps;
- exactly the expected straight–corner–straight and straight–end contacts;
- running sections that match across every plane, and are covered by the end piece's face;
- rails continuous along the street edge, and no doubled cope joint;
- everything grounded and at z ≥ 0;
- a clear path.

These transforms are bench data, not placement sockets.

## Commands

```sh
pnpm content:validate --collection street-props --partial   # omit --partial once all ten forms exist
pnpm exec vitest run packages/content/src/props/street
pnpm build && pnpm content:render --collection street-props --style hearth   # and --style tide
pnpm content:render --collection street-props --scene joins-hearth           # needs all ten forms
```

Measured costs per model, the same in both kits (validator): fence-straight 254 cells / 370 tris / 6 boxes,
fence-corner 340 / 320 / 9, fence-end 148 / 150 / 5, wall-straight 414 / 180 / 7, wall-corner 770 / 454 / 15,
wall-end 138 / 110 / 5. Each renders in one measured draw.
