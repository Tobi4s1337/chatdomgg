# Water places: land into place metadata

`packages/world/src/places/water/` turns main's approved land into everything the lake, pier and millstream
need to stand on it honestly. It is pure and deterministic: no clocks, no randomness, no render and no content
imports. It reads the supplied `KingdomLandform` (version 2), its `LandSite`s and the public route nodes, and
**never** routes a course, chooses or moves a site, carves, grades or turns a structure off its cardinal turn.
Anything it cannot honour becomes a `WaterNeed` that names who must act.

The planner is not exported from `@chatdom/world` yet. Until the integrator adds
`export * from './places/water'` to `packages/world/src/index.ts`, consumers import it by relative path.

## `planWaterPlaces(input): WaterPlacePlan`

```ts
interface WaterPlaceInput {
  landform: LandformPlan;                 // v2 required; v1 yields only `land-version`
  sites: readonly LandSite[];             // one each of pier, boathouse, rock, weir, wheel, mill, bridge, sign
  nodes?: readonly Pick<StreetNode, 'id' | 'position'>[];  // routes' land:pier:* and land:bridge:*; absent = joins unchecked
  destinations?: Partial<Record<'castle' | 'market' | 'lake' | 'road', XZ>>;  // only anchors that exist
  specs: WaterPieceSpecs;                 // the real content constants + frame functions (see below)
}
```

`specs` is a structural mirror of the content exports. The host passes the real ones:
`apps/web/src/places/water/land/specs.ts` exports `WATER_PIECE_SPECS`, built from `MILL`, `WHEEL`,
`WHEEL_PIT` + `wheelPitFrame`, `WEIR` + `weirFrame`, `BRIDGE` + `humpbackDeckTop`, `fishingRockTop` and
`FINGERPOST`. The content frame functions throw `RangeError` for parameters their piece cannot be built at, and
the planner turns that into a need instead of clamping it. The plan's `revision` hashes every input, so a land
or piece change gives a new revision.

The plan contains:

| Field | Contents |
|---|---|
| `reaches` | One `WaterReach` per supplied course. Each point keeps its record verbatim and adds `s`, `tangent`, smoothed `slope`, presentation `speed`, `flow` vector and `still`. `source` and `mouth` are `spring`, `water` (with the level `step`), `fall` (a weir drop) or `open`. `openSpeed` is the median moving speed. |
| `lake.water` | The body under the pier head. |
| `lake.pier` | Site frame, `deck` (lake level + `PIER_DECK_HEIGHT`), walk strip x span and length, head spans, `shore` (local z of the first wet point), `headDepth`, `rootGround`, and a 0.5 m `FoundationGrid` of bed and ground heights over the footprint. |
| `lake.boathouse` | Frame, `shore`, `bayDepth` at the open (+Z) end, foundation grid. |
| `lake.rock` | Frame, `water` (whole cells, rounded up so the base never floats), `base` y, and the local extent for centring a variant. |
| `mill.pond` | The body whose level is the weir crest. |
| `mill.weir` | `placement` (origin, turn, size, outline), `factory: {width, drop}` for `createWeir`, the foam-lip `crest` line, pond and tail levels. |
| `mill.wheel` | `pit` and `wheel` placements, `factory: {run, feet}` for `createWheelPit`, `hub`, `axis` and `descending` (positive spin about `axis` carries the top downstream), floor, trough floor, `head`, `troughDepth`, `lipOverWheel`, `lip` and `leatEnd` in world metres. |
| `mill.mill` | Placement with the shaft collar on the axle line at the pit's outer wall, and the world `shaft` point. |
| `mill.bridge` | Placement with the arch axis over the pool centreline and y 0 on the pool bed, `factory: {water, bank}` for `createHumpbackBridge`, the pool's level, bed, width and speed against `openSpeed`, deck `ends` and sampled `landings`. |
| `mill.sign` | Post placement on the lowest ground under its plan, post `axis`, and one `{destination, target, bearing, yaw}` per supplied anchor. Arms point along local +X, so `yaw = bearing - PI/2`. |
| `needs` | `{code, owner: 'land' / 'integrator' / 'content', subject, message}`. A production mount calls `assertWaterPlaces(plan)`, which throws `WaterPlaceError` listing every need. |

Helpers: `placePieceAnchors(frame, piece)` carries a content piece's walks, seats, emitters, sounds, texts,
mounts and footings into world metres. Emitter `reach` is in cells in content and metres once placed.
`floatingFootings(landform, anchors)` lists footings that stand off the real ground. Also exported:
`sampleFoundation`, `foundationAt`, `centredOrigin`, `toWorld`, `toLocal`, `cellToWorld`, `directionToWorld`,
`deriveWaterReaches` and `flowAlong`.

### What is checked (each failure is a need)

- **Sites:** each one is present and unique. The datum is the lake surface for pier, boathouse and rock, the pond
  surface for the weir and the tailrace surface for the wheel. The weir faces down its course. The mill's shaft
  face faces the wheel. The bridge spans its course square.
- **Reaches:** every mouth arrives at its water's level within half a cell. The leat leaves the pond. A course
  falls over the weir. The tailrace begins inside the pit and ends in water.
- **Mill:** the leat ends on the wheel's line. The leat bed meets the trough floor and its surface fits inside
  the trough walls. The lip stands 0.3–0.5 m over the wheel. Trestle feet stand on real ground within the
  launder's range. The mill floor sits where the shaft meets the axle.
- **Bridge:** pool depth and bank height are within the bridge's range. Both landings are within two cells of
  the deck end. The arch spans the wet width. Pool flow is at most 15% of the open reach.
- **Lake:** the head is wholly over water with at least 0.6 m of depth. The pier root meets the deck within
  0.5 m. The boathouse bay has water and its back stands on the shore. The rock faces open water.
- **Footprints:** pieces stay within 1 m of their site or within 1.5 m of the water they stand in, and off
  other sites.
- **Path joins:** the routes' pier and bridge nodes lie on the deck walk.

### Flow model

Each course carries one discharge (0.45 m/s through its mean cross-section), so it quickens through narrows and
slows where it widens. The surface fall, read over ±5 m, scales that speed by √(slope/1%), clamped between 0.15
and 3. Riffles run, level stretches creep, and the bridge pool stays under 15% of the open reach. A course eases
over 8 m out of still water and into its receiving water. A tributary's last point takes the receiving course's
own velocity, so two-phase advection never jumps at a join. Overfalls start under way. White water belongs to
the weir crest and the wheel's descending side.

## `createWaterPlaces`: the web mount contract (PW04–PW06 implement it)

```ts
// apps/web/src/places/water/index.ts
export function createWaterPlaces(options: {
  plan: WaterPlacePlan;                         // assertWaterPlaces(planWaterPlaces({... specs: WATER_PIECE_SPECS }))
  style: StyleKey;                              // the kingdom's kit; the mill is always Grove's, the bridge a civic kit
  pool: VoxelWorkerPool;                        // caller-owned, survives dispose
  material: THREE.Material;                     // caller-owned voxel material, survives dispose
  renderState: VoxelRenderState;
  names: { lake?: string; destinations?: Partial<Record<FingerpostTarget, string>> };  // public-safe caller text
  quality: 'full' | 'reduced';
}): WaterPlaces;

export interface WaterPlaces {
  root: THREE.Group;
  ready: Promise<void>;                         // workers meshed every static piece
  revision: string;                             // = plan.revision
  /** Static, cardinal pieces for geometry/LOD, occlusion, shadows and collision. */
  placements: readonly { id: string; blueprint: VoxelBlueprint; origin: Vec3; turn: CardinalTurn }[];
  /** Free-moving parts: wheel about plan.mill.wheel.hub/axis, boats, fingerpost arms. Never static blockers. */
  moving: readonly { id: string; object: THREE.Object3D }[];
  walks: readonly PlacedWalk[]; seats: readonly PlacedSeat[];
  emitters: readonly PlacedEmitter[];           // lamp glass for the shared people-light result and LightFieldSource
  sounds: readonly PlacedSound[]; texts: readonly PlacedText[];
  reaches: readonly WaterReach[];
  update(frame: { time: number; environment: Environment; camera: THREE.Camera;
    people: /* kingdom-light's seekable people-light result */ unknown;
    reflectionSources: readonly { position: Vec3; strength: number; normal?: Vec3 }[] }): void;
  /** W-M3: called by the host once per frame before the main render; at most one planar pass. */
  renderReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
    frame: { revision: number; exclusions: readonly THREE.Object3D[] }): void;
  dispose(): void;                              // frees only what it created
}
```

The mount builds each piece from the plan's factory parameters: `createWeir(style, width, drop)`,
`createWheelPit(style, run, feet)`, `createMillWheel('grove')`, `createMill('grove')`,
`createHumpbackBridge(civic, water, bank)`, `createFishingRock(style, variant, water)` and
`createFingerpost(style, plan.mill.sign.arms.map(a => a.destination))`. It sets each one at its plan placement
(the rock with `centredOrigin`) and yaws fingerpost arms by `arm.yaw`. Every anchor goes through
`placePieceAnchors`. The pier and boathouse modules (PW01) read `plan.lake.pier` and `plan.lake.boathouse`:
deck height, shore and foundation grid. The mount draws nothing while the plan has needs.

## Integrator recipe (sole owner of `scene.ts`)

1. **Plan:** after the land result exists, call
   `assertWaterPlaces(planWaterPlaces({ landform, sites, nodes: [...town.nodes, ...routes.nodes], destinations, specs: WATER_PIECE_SPECS }))`.
   For destinations, use the court gate for `castle`, the market node for `market`, the pier landing node for
   `lake`, and `road` only once land supplies the road out. If it throws, show the needs in diagnostics outside
   the scene and keep the old water.
2. **Construct** `createWaterPlaces` after the voxel pool and material exist. Add `root` to the scene.
3. **Static pieces:** add `placements` to the same static geometry, LOD, occlusion, shadow and collision path as
   `WindowHouse` and `Dressing`, using the cardinal transform `turn * PI/2`. `moving` objects are never blockers.
4. **Walks and seats:** remove the interim civic footbridge dressing (`form: 'footbridge'`, `siteId: 'water:bridge'`)
   at the same site. Rebind `land:bridge:west/east` to the humpback deck `ends`, and register `walks` and `seats`
   with the walk and collision graph and the Raid Gate crossing anchors. Existing citizen routes do not pick them
   up automatically.
5. **Light:** feed `emitters` to the shared people-light result and to `LightFieldSource` (strength 0..1 from
   that result, at most 15% pilot when empty). Add no scene lights.
6. **Sound:** bind `sounds` (wheel, weir, trough, arch, creak, reeds) to the host's audio mix.
7. **Frame order:** call `renderReflection(...)` once per frame before the main render, then
   `update({ time, environment, camera, people, reflectionSources })`. Use the caller's seekable time, never a
   local clock.
8. **Replace the old water exactly once:** remove `createWater` from `packages/render/src/water.ts` for this land,
   and the scene's shore and tree exclusions that assume the single legacy lake.
9. **Teardown:** call `dispose()` before disposing the pool and material. Caller resources survive.

## Needs on today's founded land (all seeds checked, `chatdom` quoted)

These come from the real land and the real PW02 pieces. They are not fixture artefacts:

- `head` (land): the leat arrives 1.00 m over the trough floor, and its bed is 0.38 m above it. With the pit
  floor at the tailrace surface, the wheel wants the leat end's bed at floor + 5.625 m and its surface within
  0.375 m above that. Today's head is 6.6–7.5 m.
- `trestle` (land): the launder's last trestle, at the leat mouth, stands in the leat's bank (the ground there
  is above the trough floor). On some seeds trestle 2 needs a 37-cell foot, over the launder's 36.
- `mill-shaft` (land): the shaft meets the axle only with the mill floor 0.75 m above the dell's level ground.
- `footprint` (land): the humpback bridge is 18 × 4 m against the 8 × 4 m interim site, so the land must
  reserve 5 m of bank at each end.
- `bridge` (land): one landing sits 0.25–0.26 m off the deck end on some seeds.
- `path-join` (integrator): the footbridge's `land:bridge:*` nodes sit 1.25 m below the humpback deck.
