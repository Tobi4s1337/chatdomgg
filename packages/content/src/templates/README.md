# Editable starting shapes

Spec: `work/specs/14-build-templates.md`. A starting shape is an ordinary `VoxelBlueprint` on the full
`[64,160,128]` reserved lot, street at +Z. Main's `BuildDraft.insertBlueprint(blueprint, [0,0,0])` turns it into
the citizen's own cells in one undoable step; nothing here is a mesh, prefab or privileged object.

- `plan.ts`: `TemplatePlan` refuses any solid box behind the tier's active rear or at/above the tier height as it
  is written; `onFace`/`anchor` place reveals and README-convention window anchors relative to a wall plane.
- `hearth.ts`: Hearth & heather geometry. `labels.ts`: titles, hints, kit and tier names. `index.ts`: the finite
  factory, `BLUEPRINTS` (finished entries only until all forty-five exist) and `TEMPLATE_REVIEW`.
- `templates.test.ts` executes the boxes and walks the declared threshold/room/court points with a 10-cell wide,
  20-cell high clearance that climbs at most two cells, and checks a clear 16 × 16-cell (2 m) standing square at
  every room point. `apps/web/src/template-bench/insertion.test.ts` inserts into main's actual tier policy, edits,
  undoes and redoes, rejects a rear-land source unchanged, and inserts every finished shape into its own tier.

## Review bench

`/-/templates?style=hearth&form=gable&tier=hut&angle=front|side|back|cutaway&hour=19&seed=chatdom-templates`.
Previews render a prospective copy of the local review plot; only “Begin with this shape” calls
`insertBlueprint`. The cutaway lifts compiled cells above feet + 12 for review only. Capture after `pnpm build`:
`node apps/web/src/template-bench/capture.mjs --partial` writes `shots/templates/` and `report.json`.

## Hearth & heather

Palette: plaster walls, terracotta roofs, timber posts/plates/floors/frames, limestone plinths/sills/thresholds/
flags/chimneys, glass, and leaf/petal/earth only in window troughs and one court bed. Every Hearth plan is made of
gabled **wings** (`hearth.ts:Wing`) that share wall thickness, plate height and span, so crossing ridges meet at one
height. They are raised in one order — all shells, all hollows, all gables, all roofs, then each wing's attic is
cleared up to the underside of its own tiles — so where wings cross, the outside shows the higher roof and the
rooms below share one open roof. Roofs climb 3 cells per 2 (56°). Tiles show four cells deep at the eaves, over
the walls and at each course's stepped edge, and are one tile thick between: the same outside for about a third
fewer cells. Doors are open frames 12 cells wide with 20 cells of headroom; a door in an eave wall needs a
24-cell plate so its lintel is the plate.

- **Gable** — one room open to its roof, gable and door to the street, a flank chimney with a real fireplace,
  gable eyes front and back. Walls 3 cells. Hut 28 × 38 cells (3.5 × 4.75 m), plate 21; cottage 32 × 56, plate
  24, pentice hood and one framed bay; house 36 × 72, plate 27; manor 42 × 90, plate 30; hall 48 × 108, plate 33,
  a second chimney on the east flank. Bays carry timber posts outside and tie beams across the room.
- **Corner** — a street wing (gable and parlour window to the street) and a back wing that turns east behind it,
  crossing at the north-west. The door is in the back wing's south wall, off a flagged path in the dooryard the
  two wings shelter; a timber frame marks the turn. Walls 2 cells at hut/cottage, 3 above. Spans 22/26/30/32/34;
  plates 24/24/27/30/33. House and manor divide the street wing with one cross wall, the hall with two.
- **Courtyard** — the hut's court opens straight onto the street between two gabled side wings, with a back range
  behind: each side room is the narrowest real room (2 m clear) so the court keeps 2.25 m of sky. An 8 m lot
  has no depth for more. From the cottage up, the west range runs from a back range to the street, a street range
  stands across the east half, and an open gate under a tiled beam leads between them into a flagged court closed
  on the east by a limestone garden wall. The street range's door opens off the gate, the back range's door faces
  the gate across the court, and the west range has its own court door. Walls 2 cells; spans 20 (hut, cottage)
  and 22; plates 24/24/24/27/30; the west range has one cross wall at the house, two at the manor, three at the
  hall.

Window IDs are stable for the windows a form keeps as it grows (`gable-eye`, `west-ingle`, `east-garden`,
`north-loft`; `street-parlour`, `dooryard`, `north-hearth`; `street-west`, `street-east`, `west-ingle`,
`east-garden`, `north-hearth`, `west-parlour` for the street-end west room); added windows get new IDs.

### Review facts

Coordinates are build cells (0.125 m). Feet stand on the first air cell above the floor boards or flags.
Rooms are listed in the order the route test walks them from the threshold.

| ID | Threshold feet | Room feet | Court feet | Windows |
|---|---|---|---|---|
| `template-hearth-gable-hut` | 32,1,120 | 32,1,104 | — | gable-eye, west-ingle, east-garden, north-loft |
| `template-hearth-gable-cottage` | 32,1,120 | 32,1,100 | — | gable-eye, west-ingle, east-garden, east-orchard, north-loft |
| `template-hearth-gable-house` | 32,1,120 | 32,1,96 | — | gable-eye, west-ingle, east-garden, east-orchard, west-settle, north-loft |
| `template-hearth-gable-manor` | 32,1,120 | 32,1,88 | — | gable-eye, west-ingle, east-garden, east-orchard, west-settle, east-well, north-loft |
| `template-hearth-gable-hall` | 32,1,120 | 32,1,80 | — | gable-eye, west-ingle, east-garden, east-orchard, west-settle, west-dais, north-loft |
| `template-hearth-corner-hut` | 44,1,102 | 44,1,93 · 16,1,112 | — | street-parlour, west-ingle, dooryard, east-garden, north-hearth, gable-eye |
| `template-hearth-corner-cottage` | 45,1,90 | 45,1,79 · 17,1,106 | — | street-parlour, west-ingle, dooryard, east-garden, north-hearth, west-pantry, gable-eye |
| `template-hearth-corner-house` | 47,1,78 | 47,1,65 · 19,1,89 · 19,1,110 | — | street-parlour, west-ingle, dooryard, east-garden, north-hearth, west-pantry, west-hall, dooryard-hall, gable-eye |
| `template-hearth-corner-manor` | 48,1,64 | 48,1,50 · 20,1,81 · 20,1,110 | — | street-parlour, west-ingle, dooryard, east-garden, north-hearth, west-pantry, west-hall, dooryard-hall, gable-eye |
| `template-hearth-corner-hall` | 49,1,46 | 49,1,31 · 21,1,60 · 21,1,85 · 21,1,110 | — | street-parlour, west-ingle, dooryard, east-garden, north-hearth, west-pantry, west-hall, dooryard-hall, west-solar, dooryard-solar, gable-eye |
| `template-hearth-courtyard-hut` | 32,1,90 | 32,1,82 · 13,1,100 · 51,1,100 | 32,1,100 | street-west, street-east, west-ingle, east-garden, north-hearth |
| `template-hearth-courtyard-cottage` | 29,1,120 | 48,1,112 · 29,1,66 · 13,1,87 · 13,1,110 | 44,1,87 | street-west, gable-eye, street-east, west-ingle, east-garden, north-hearth, court-north, court-south, west-parlour |
| `template-hearth-courtyard-house` | 31,1,120 | 49,1,111 · 31,1,50 · 14,1,76 · 14,1,106 | 44,1,76 | street-west, gable-eye, street-east, west-ingle, east-garden, north-hearth, court-north, court-south, west-parlour |
| `template-hearth-courtyard-manor` | 31,1,120 | 49,1,111 · 31,1,34 · 14,1,58 · 14,1,83 · 14,1,108 | 44,1,83 | street-west, gable-eye, street-east, west-ingle, east-garden, north-hearth, court-north, court-south, west-room-1, west-parlour |
| `template-hearth-courtyard-hall` | 31,1,120 | 49,1,111 · 31,1,18 · 14,1,41 · 14,1,64 · 14,1,86 · 14,1,109 | 44,1,64 | street-west, gable-eye, street-east, west-ingle, east-garden, north-hearth, court-north, court-south, west-room-1, west-room-3, west-parlour |

### Measured cost and room left

Executed cells from the ordered boxes, the tier allowance from main's `HOME_BUILD_LIMITS`, triangles from the
production mesher (`content:validate`); each is one model draw. The test refuses any shape that leaves less than
15 % of its allowance. The hut's three-sided court is the tightest: three wings, two court doors and a back door on
an 8 × 8 m lot cost 84 % of its 32,768 cells even with 2-cell walls and one-tile roof fields, leaving 5,101.

| ID | Boxes | Occupied cells | Left of the allowance | Meshed triangles |
|---|---:|---:|---:|---:|
| `template-hearth-gable-hut` | 235 | 17,284 of 32,768 | 15,484 (47 %) | 7,402 |
| `template-hearth-gable-cottage` | 273 | 26,668 of 49,152 | 22,484 (46 %) | 8,286 |
| `template-hearth-gable-house` | 306 | 36,106 of 81,920 | 45,814 (56 %) | 9,680 |
| `template-hearth-gable-manor` | 352 | 48,842 of 131,072 | 82,230 (63 %) | 10,994 |
| `template-hearth-gable-hall` | 396 | 67,552 of 196,608 | 129,056 (66 %) | 13,704 |
| `template-hearth-corner-hut` | 372 | 22,171 of 32,768 | 10,597 (32 %) | 11,076 |
| `template-hearth-corner-cottage` | 425 | 28,102 of 49,152 | 21,050 (43 %) | 12,376 |
| `template-hearth-corner-house` | 488 | 44,595 of 81,920 | 37,325 (46 %) | 14,702 |
| `template-hearth-corner-manor` | 512 | 54,414 of 131,072 | 76,658 (58 %) | 15,288 |
| `template-hearth-corner-hall` | 551 | 67,864 of 196,608 | 128,744 (66 %) | 16,936 |
| `template-hearth-courtyard-hut` | 510 | 27,667 of 32,768 | 5,101 (16 %) | 15,570 |
| `template-hearth-courtyard-cottage` | 542 | 39,197 of 49,152 | 9,955 (20 %) | 16,698 |
| `template-hearth-courtyard-house` | 578 | 44,270 of 81,920 | 37,650 (46 %) | 17,534 |
| `template-hearth-courtyard-manor` | 588 | 52,122 of 131,072 | 78,950 (60 %) | 18,638 |
| `template-hearth-courtyard-hall` | 598 | 60,522 of 196,608 | 136,086 (69 %) | 19,174 |
