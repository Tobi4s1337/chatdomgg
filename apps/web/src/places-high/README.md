# Places high: the castle court, Lookout Hill and the forest edge

Spec: `work/specs/30-places-high.md`. Content lives in `packages/content/src/places-high/`, the bench and (later)
cloth/view runtimes here. Nothing in this folder is mounted by the kingdom yet: the integrator owns `scene.ts` and
the package exports, and follows the recipe below.

## What exists

| Piece | Factory | Size (cells) | Notes |
|---|---|---|---|
| Court floor, west/east half | `createCourtFloor(half, style, size?)` | 160 × 2 × 192 for the founded court | Coursed flags a cell proud of an earth/moss bed; worn pale way, stone spine on the axis, kerbs, cracked and patched field, moss in the shaded joints and frayed sides. Halves share courses, so joints meet on the axis. |
| Court well-head | `createCourtWell(style)` | 28 × 30 × 24 | Coursed drum on a round step, pale coping 0.875 m above the step, oak posts and windlass, iron crank, terracotta canopy, one bucket hanging just drawn and one on the step. |
| Court assembly | `createCastleCourtPlace(court, style)` | — | Lays both floor halves, the well west of the way and the existing civic crest plinth east of it (read-only `createCivicProp('crest-plinth', 'tide'|'hearth')`). |

`BLUEPRINTS` lists, per kit (hearth, tide, grove): floor west, floor east, well. The castle kit is `tide` in every
founded kingdom today (`apps/realm/src/founded/native.ts`).

## Conventions

- Local build cells (0.125 m), origin at the blueprint's (0,0,0) corner. World metres +X east, +Y up, +Z south.
  Placements carry `position` (the blueprint origin) and a cardinal `turn` (yaw = `turn * Math.PI / 2`, turn 1 maps
  local +Z to +X, matching `transformCardinalPoint`). Every court placement is on the 0.125 m lattice.
- `PlacePiece` metadata: `footings` (where it bears at local y = 0), `walks` (top = walking height in cells),
  `seats`, `interactions` (`stand` on the walk surface, `look` at the target; the host owns any prompt and
  receipt — none is implied), `texts` (faces reserved for host-drawn text).
- `CourtSite` is structurally `LandPlaces['court']`; content never imports `@chatdom/world`. The court must be an
  axis-aligned rectangle with the gate on its south edge and the keep door north of it, both on the centre axis;
  anything else throws instead of guessing.

## Mount recipe (court, current pieces)

```ts
import { createCastleCourtPlace } from '@chatdom/content/places-high'; // export to be registered by the integrator
const court = createCastleCourtPlace(land.places.court, 'tide');
```

1. Compose `court.placements` with the castle and civic placements **before** light fields, shadows and occlusion
   compile. Each is `{ id, blueprint, position, turn, blocker }`; yaw is `turn * Math.PI / 2`. Mesh through the
   normal `VoxelWorkerPool` → `geometryFromChunks(chunks, 'build')` → clay material path; one instanced draw per
   blueprint.
2. Floors (`blocker: false`): receive shadows, never register as shadow casters or light-field blockers. They sit
   one cell into the ground (origin y = elevation − 0.125) so the flags' top is `court.floorTop` = elevation +
   0.125; the step up from the gate passage is one cell. Walking height on the flags is `floorTop`; joints are
   one-cell recesses in the same surface.
3. Well and crest (`blocker: true`): cast sun shadows and join the near light field's blockers (slot 65534, like
   props). Collision is their drawn cells; the well's coping is a lean height (0.875 m above the step) and its
   canopy posts are solid.
4. `court.interactions` are honest stand/look points (`draw-water`, `read-crest`) on the flags. Bind them only
   through the realm's interaction registry once an owner defines what they do; do not show a prompt that claims
   success.
5. `court.keepClear` lists the processional way, gate passage and keep-stair landing. Ground dressing, lamps and
   any later piece must stay out of them.
6. Dispose: geometries are the caller's; content allocates nothing at runtime.

## Measured keep footprint (for the stair, door and banner release)

Read from the actual `createCastle('tide')` blueprint at the founded keep placement `[-16, 20, -92]`, turn 0:

| Feature | Cells (keep-local) | World metres |
|---|---|---|
| Keep module | 256 × 248 × 256 | x −16..16, z −92..−60, y 20..51 |
| Front terrace: stone foundation, then paving | x 12..244, y 0..8 to z 246; x 20..236, y 8..13 to z 238 | x −14.5..14.5, 1 m stone face at z −61.25; paving top 21.625 set back to z −62.25 |
| Existing 13-course stair cut | x 111..145, y 0..13, z 202..254 | x −2.125..2.125, z −66.75..−60.25, 20.0 → 21.625 |
| Entrance arch through the terrace wall | x 111..145, y 0..45 (stepped to 55), z 202..247 | 4.25 m wide, ~5.6 m clear |
| Inner keep door opening | x 116..140, y 13..42, z 163..170 | x −1.5..1.5, sill 21.625, face z −70.875 (`KEEP_DOOR_LOCAL_METRES`) |
| Small banner buttresses (two) | x 59..69 / 186..196, y 18..62, z 208..217 | x −8.625..−7.375 / 7.25..8.5, y 22.25..27.75, z −66..−64.875 |

The court boundary stops at z −60, the keep module's face; the terrace face is at −61.25, so a 1.25 m strip of the
keep's own footprint lies between the flags and the terrace. The court rises 1.625 m (13 cells) to the keep's
inner paving: exactly the spec's 13 one-cell treads.

**needs (kingdom-light, H-M2):** release the stair envelope x −4..4, z −66.75..−60, y 20..21.625 (the flared 8 m
foot runs onto the court strip; the 4.25 m cut widens to the flare), remove the two small banner buttresses and
their cloth, and keep the inner sill at 21.625. Until that release is agreed, places-high writes no keep consumer
and the court floor stops at the supplied boundary.

## Bench and capture

`/src/places-high/bench/index.html`, served by the Vite dev server only; the shipped app never loads it. It is
sealed **SIMULATED · PLACE BENCH** and its seal lists every dependency it is still waiting for.

- Land, castle and court: the actual founded geography (`foundKingdomGeography`, `createKingdomCastle`) and this
  lane's real factory. Town homes are the kingdom-land geography fixture (today's homes re-seated on the new land)
  and their lit windows a SIMULATED evening (`occupied=0` darkens them). The production renderer: terrain worker,
  horizon, clay, near/far/beacon light fields, window presence, sun shadows, fog and grade.
- Params: `place`, `view`, `hour`, `time`, `occupied`, `stones` (lookout), `target` (telescope), `tier`. Unknown,
  repeated, mismatched or unfinished inputs fail visibly. Built views: `court-arrive`, `court-town`.
- Readiness (`window.__chatdomReady`) waits for every mesh, the terrain worker, a first published volume from each
  light field, shader compilation and one finished frame. Failures set `window.__chatdomPlacesError` and show an
  alert; the report is `window.__chatdomPlaces`.

```sh
node apps/web/src/places-high/capture.mjs [--only court-arrive,court-town] [--size desktop|phone] [--hour 18.5] \
  [--time 30] [--occupied 1|0] [--tier town|hamlet] [--base-url http://127.0.0.1:5190]
```

The script takes the host capture lock before any server or browser, serves `apps/web` on the first free port in
5170–5199 (unless `--base-url`), captures serially with Chrome/SwiftShader, fails on console/page/shader errors or a
report that disagrees with the request, writes `shots/places-high/*.png` and `capture-stats.json`, and stops only
the server and browser it started.

## Dependencies still missing

- Keep stair envelope and small-banner removal (kingdom-light, H-M2), above.
- Castle standards and drops (PH03), parapets replacing the front curtain caps (PH02).
- Pear espaliers on the sunward curtain (ground-dressing, H-M3).
- The package export for `places-high` (integrator, H-M6). The bench and tests import the source relatively.
