# Editable starting shapes

Spec: `work/specs/14-build-templates.md`. A starting shape is an ordinary `VoxelBlueprint` on the full
`[64,160,128]` reserved lot, street at +Z. Main's `BuildDraft.insertBlueprint(blueprint, [0,0,0])` turns it into
the citizen's own cells in one undoable step; nothing here is a mesh, prefab or privileged object.

- `plan.ts`: `TemplatePlan` refuses any solid box behind the tier's active rear or at/above the tier height as it
  is written; `onFace`/`anchor` place reveals and README-convention window anchors relative to a wall plane.
- `hearth.ts`: Hearth & heather geometry. `labels.ts`: titles, hints, kit and tier names. `index.ts`: the finite
  factory, `BLUEPRINTS` (finished entries only until all forty-five exist) and `TEMPLATE_REVIEW`.
- `templates.test.ts` executes the boxes and walks the declared threshold/room/court points with a 10-cell wide,
  20-cell high clearance that climbs at most two cells. `apps/web/src/template-bench/insertion.test.ts` inserts
  into main's actual tier policy, edits, undoes and redoes, and rejects a rear-land source unchanged.

## Review bench

`/-/templates?style=hearth&form=gable&tier=hut&angle=front|side|back|cutaway&hour=19&seed=chatdom-templates`.
Previews render a prospective copy of the local review plot; only “Begin with this shape” calls
`insertBlueprint`. The cutaway lifts compiled cells above feet + 12 for review only. Capture after `pnpm build`:
`node apps/web/src/template-bench/capture.mjs --partial` writes `shots/templates/` and `report.json`.

## Finished shapes

Coordinates are build cells (0.125 m). Feet stand on the first air cell above the floor boards.

| ID | Walls (x × z) | Wall plate / ridge cap top | Threshold feet | Room feet | Windows |
|---|---|---|---|---|---|
| `template-hearth-gable-hut` | 18–46 × 84–122 | y 21 / y 48 (exclusive) | 32,1,120 | 32,1,104 | gable-eye, west-ingle, east-garden, north-loft |

Measured (hut, `report.json` and `content:validate`): 136 boxes, 18,004 occupied cells of the hut's 32,768
(14,764 left, 45 %), 7,282 source triangles and 8,168 after main's draft shaping, one draw. The core derives six
window anchors from the glass because the two mullioned windows read as two panes each.
