# Spec 02b: A town gathered below its castle

Status: implementation authorized, 2026-10-30. Main accepts the direction; the generator awaits tested freeze.
The cardinal placement helpers and twelve-module castle group are tested and frozen for the content/bench consumers. The old production layout remains until consumer migration. Small tested geometry/castle groups may freeze
as their first consumers start; the complete generator is not frozen by this proposal.

Parent: [Spec 02](02-kingdom-light.md), especially R1, R6, R10–12 and the natural-ground decision.
Vision: `chatdom/ChatDom.md`, `chatdom/World-Tree.md` §5, `chatdom/Quality.md`,
`chatdom/Artstyle-Soul-Feel.md`; founder GPU feedback recorded in `work/PLAN.md` §10.

## The change and its limits

The founder accepts the light, rolling land, lake and beacon. The repeated parallel rows break the spell.
Build a winding street network which meets in a real market below a larger castle on a rise. Small residential
courts gather along its branches; the oldest quarter begins closest to the castle. Streets follow the shape of
the land, and the land is graded locally where people actually built. A curve painted over the old rows fails.

Keep the current terrain representation, materials, lake carving, shoreline sampler and light semantics.
Full reservations remain 8 × 16 × 20 m; growth changes the occupied depth inside the same address. Cardinal
home orientation is a design choice for this settlement, not a restriction imposed by the vision. It allows
exact existing build-cell occupancy while courts and short approaches reconcile homes with winding lanes.

This replaces the simulated layout once, under an explicit layout version. From that plan onward, activation,
home-tier growth, new tenure years and late arrivals must not move existing addresses or roads. Do not claim
the new generator preserves the coordinates of the old demonstration's straight rows.

## Minimal world contract

These types live in `packages/world`; no shared voxel/presence schema change is required. Fields shown below
replace the geographic parts of the current layout. Existing home tier, style, variant and presence-slot fields
remain. Arrays crossing the worker boundary contain plain serializable data, never caches or Three objects.

```ts
type CardinalTurn = 0 | 1 | 2 | 3;
type XZ = readonly [number, number];
type BoundsXZ = { minX: number; maxX: number; minZ: number; maxZ: number };

interface StreetNode {
  id: string;
  position: Vec3;
  kind: 'junction' | 'market' | 'court' | 'frontage' | 'castle-gate' | 'frontier';
}
interface StreetEdge {
  id: string;
  from: string;
  to: string;
  kind: 'main' | 'lane' | 'approach';
  name: string;
  points: readonly Vec3[]; // centreline, from node through to node; graded world metres
  width: number;          // complete paved width, not radius
  verge: number;          // reserved public ground beyond each paved edge
  quarterYear?: number;
}
interface PublicSquare {
  id: string;
  boundary: readonly XZ[]; // simple counter-clockwise polygon, no repeated closing vertex
  elevation: number;
  nodeId: string;
}
interface PlotReservation {
  id: string;             // plot:<followYear>:<ordinal>
  quarterYear: number;
  ordinal: number;
  street: string;         // human-readable address, retained
  streetId: string;
  courtId: string;
  approachId: string;     // a real edge joining frontage to the public graph
  position: Vec3;         // centre of FULL reservation at immutable foundation elevation
  rotation: CardinalTurn;
  lot: BoundsXZ & { height: 20; depth: 16; frontage: 8 };
}
interface HomePlot extends PlotReservation {
  slot: number; tier: HomeTier; allowedDepth: number;
  style: 'hearth' | 'tide' | 'grove'; variant: number;
}
interface TenureQuarter {
  year: number; name: string;
  rootNodeId: string;
  courtIds: readonly string[];
  growthNodeIds: readonly string[];
}
interface CastleModulePlacement {
  id: string;
  kind: 'keep' | 'gatehouse' | 'curtain' | 'tower';
  position: Vec3;        // authored blueprint origin, not its centre
  rotation: CardinalTurn;
  size: Vec3;            // blueprint dimensions in metres; each <= 32, multiples of .125
}
interface CastlePlan {
  centre: Vec3;          // landmark at foundation height, for framing/distance queries
  bounds: BoundsXZ;      // complete reserved compound; not one giant terrain pad
  modules: readonly CastleModulePlacement[];
  court: PublicSquare;
  gateNodeId: string;
  beaconModuleId: string;
}
interface LandformPlan {
  version: 1;
  seed: number;
  ridge: { origin: XZ; bearing: number; length: number; width: number; height: number };
  castleRise: { centre: XZ; radius: number; height: number };
  lake: { x: number; z: number; radiusX: number; radiusZ: number; level: number };
}
interface KingdomLayout {
  version: 2;
  revision: string;      // deterministic hash of geometry, grades, activation and built depths
  config: KingdomConfig;
  landform: LandformPlan;
  homes: readonly HomePlot[];            // active, actually rendered residents
  reservations: readonly PlotReservation[]; // includes the protected dormant sites
  quarters: readonly TenureQuarter[];
  nodes: readonly StreetNode[];
  streets: readonly StreetEdge[];        // canonical plan, including dormant extensions
  activeStreetIds: readonly string[];   // connected prefix needed by active sites/civic places
  market: PublicSquare;
  courts: readonly PublicSquare[];     // courtId references these; each connects through nodeId
  castle: CastlePlan;
  bounds: BoundsXZ;                     // current detailed render request, not world ownership
  lake: LandformPlan['lake'];            // compatibility view of the same founding lake data
}
```

A residential court is installed when at least one active home references it. Its canonical polygon and node
already exist in the plan; activation does not change their shape. Castle court and market are always installed.

`castle` deliberately changes from a centre tuple to the compound. Remove `layout.beacon`: it currently
contains an approximate legacy height. Resolve the beacon once from `beaconModuleId`, its actual blueprint
anchor and that module's placement, and use the resulting world anchor for every consumer.

An edge ID and its endpoints are permanent. A new junction on an existing edge may reference a stable
arclength attachment; if graph storage splits the edge, retain the old route ID and its unchanged ordered
geometry. Adding a link must never refit an existing curve. Node/edge map caches are local implementation data.

## Shared geometry helpers and precise orientation

`homeFrame(plot)` returns `{ front, right, outward }`, using exact integer quarter turns. `front` is the
frontage midpoint, `plot.position + outward * 8`. Right is rotated local +X; outward is rotated local +Z.
`homeOrigin(plot, blueprintDepthMetres)` returns `front - right * 4 - outward * blueprintDepthMetres`.
This handles all four turns and the authored Hearth buffers, which remain 16 m deep even for a small active
tier. No caller may derive a frontage from a guessed `streetZ`.

`currentFootprint(plot)` returns the axis-aligned rectangle extending `allowedDepth` behind that frontage.
The reservation is 8 × 16 for turns 0/2 and 16 × 8 for turns 1/3. `transformCardinalPoint(origin, turn, local)`
is also the only placement arithmetic needed for props and castle modules. Their dimensions stay at .125 m.

Replace material callers of `roadDistance` with `samplePublicGround(layout, x, z)`, returning undefined outside
the indexed influence region, otherwise `{ id, kind, height, pavingDistance, reservedDistance }`. Distances are
signed metres to the union of the active paved/reserved footprints: negative inside. Height is the local
designed grade. Market and castle court are polygons; roads/approaches are swept polyline corridors. Curves
are sampled once at <= 1 m segment length, with a <= .1 m geometric chord error. Junction grades agree at the
shared node. The existing smooth worn-edge material may perturb the paving boundary slightly; it must not
shrink guaranteed walkable clearance. Tree placement uses reserved distance, not one global road radius.

`naturalTerrainHeight(landform, x, z)` excludes roads, houses and court grading. `terrainHeight(layout, x, z)`
adds the installed public grades and exact current footprints with rounded Euclidean feathers. This separation
prevents road planning from following a height field which the same roads are changing.

## Planning the place

1. **Freeze geography.** Seed and immutable founding configuration create one rolling ridge, castle rise and
   irregular lake. Population tier and the latest follow year do not move or widen them. Preserve the current
   low-frequency land character, lake bays and soft shore fade. Current code changes ridge width with tier and
   lake position with the last quarter; retaining that hidden dependency would contradict persistent place.
2. **Place the civic meeting.** Locate a roughly 30 × 24 m market at the castle foot, with a clear central
   walkable area and at least three distinct approaches. Join the main ridge route, a cross-contour route and
   the castle approach there. The graph explicitly connects through the square; paths do not merely end
   nearby. Keep the castle/market sight corridor free of full-height reserved home envelopes.
3. **Trace the hierarchy.** Establish landmark guides, then trace between them using midpoint integration
   through a direction field blending broad terrain contours, destination pull and heading continuity. Use
   blurred natural heights for direction, exact water/slope/keepout tests for acceptance. Broad S-bends around
   the rise and lake create the composition. Reject straight parallel strips with periodic offsets. Primary
   paving starts near 6 m wide; residential lanes near 4 m, with 2 m public verges. Uphill routes gain length
   around the hill instead of making a cliff. Target ordinary road grades <= 12%, castle approach <= 15%.
4. **Make quarters from courts.** Choose successive quarter roots on the connected frontier, ordered outward
   from the castle/market. Protect a compact catchment for each quarter's canonical sites before allocating
   the next. Branch local lanes along suitable contours into small asymmetric courts. Each court serves
   approximately 3–6 homes, with unequal arms, local greens and occasional useful loops. A quarter comprises
   several courts, not a single road coordinate. No forced rectangular blocks, repeated rings or global rows.
5. **Fit whole reservations.** Propose cardinal frontages facing the adjacent court/lane, snap them to whole
   metres, and reserve the entire 8 × 16 footprint before accepting a site. Cardinal facing must point toward
   its public connection (at most 45 degrees from the connection direction); the short approach is real
   public ground, not a decorative gap. Protect a 1.5 m clear entrance route and the authored side-prop strips.
   Reject intersection with another reservation, public carriageway, market, castle or water keepout. Reject
   grading conflicts rather than compressing a lot or changing a neighbour's base elevation.
6. **Grade locally.** Solve road elevation against fixed junction heights, natural terrain and the grade bound.
   Give each built footprint and its 2 m front apron exact contact at its stable foundation height. The rest
   of an approach interpolates to road grade; nearby residential frontages use a gentle grade, targeting <= 4%.
   Preserve the current rounded 12 m feather principle with spatial indexing; do not flatten a whole quarter,
   all future rear reservations, or the castle's enclosing bounding rectangle. Carve the lake before mandatory
   built pads. At intersecting mandatory surfaces, the planner must have assigned compatible heights.

The targets are authoring constraints to prove, not measured results. A winding lane can legitimately have
short straight stretches. Its topology, terrain response and connected places matter more than curvature noise.

## Stability and growth

The demonstration creates each quarter's canonical 48-site plan before activating its 12-home hamlet or
48-home town prefix. It reserves all sites and the growth exits, but draws/grades only connected roads needed
by installed sites and civic destinations. Vacant reserved ground stays meadow. Sequential quarter planning
considers complete earlier reservations, so increasing the visible population never displaces a later quarter.
Increasing the latest year appends a quarter and cannot reconsider older geometry or grade anchors.

Home ID remains `plot:<year>:<ordinal>`; home-tier changes preserve its full reservation, frontage and floor.
The current `q * 1024 + ordinal` slot rule can remain for these fixtures. It is a bounded visual mapping under
R10, not a permanent identity or an unlimited quarter capacity. Persistence keys are plot IDs.

For arbitrary live arrival histories, store the generated settlement plan and append accepted sites/road
extensions from the quarter's protected growth frontier. A pure regeneration from population totals is not
a substitute for that ledger. New branches route around claimed land; completed geometry is locked. Existing
streets cannot undergo whole-graph smoothing, lot re-subdivision or removal of supposedly unused branches.
Growth can leave the present render window: the 32-chunk packed-coordinate limit describes one render request,
not the kingdom's maximum age or ownership extent. Main must freeze persistence/streaming contracts before
their consumers; this spec defines the geometry invariants they preserve rather than inventing new event types.

## A castle at the right scale

Use one castle assembled from a central keep, curtain walls, a gatehouse and towers. A compound around
56–64 m wide and 40–48 m deep, with its foundation near 20–22 m and market near 8–10 m, is the composition
target. Keep every authored module <= 32 m per axis and every build cell .125 m. Do not scatter duplicate
complete castles or silently enlarge the existing blueprint. The hill and approach provide the elevation;
the keep and towers provide a single stepped silhouette. Actual module dimensions must match their plan.

The world plan owns placements, reserved ground and the gate connection. Content owns the module blueprints
and the one real beacon anchor. Render, ordered-box light blockers, label/camera occlusion, directional shadow
casters and camera-clearance proof all consume the same placed module list. World grading uses actual module
footprints plus court/access ground, not the compound AABB. Modules must leave the authored gate passage open.

Explicit uniform scale could work only if every occupancy, ray, emitter, shadow and camera transform also
handled that scale. It would change build voxels and doorway dimensions; that challenges R1 and the art scale
rule. Modular construction achieves the desired silhouette without that extra contract or hidden disagreement.
The raised crown also requires checking the current kingdom field's fixed Y range and beacon volume bounds;
do not enlarge geometry and assume those volumes still cover it.

## Caller migration and ownership

| Caller | Required change |
| --- | --- |
| World generator/tests — terrain architect | Graph, reservations, market, founding landform, castle plan, indexed geometry/grade helpers, stability/contact/clearance tests. Export through the existing world entry point when main authorizes it. |
| `settlement-content.ts` and tests — main | Four-turn `homeFrame`/`homeOrigin`; transform all prop positions with the same frame. Replace front-Z/quarter-Z assertions with actual frontage and public-ground assertions. |
| `terrain-worker.ts` — main | Material selection from `samplePublicGround`, including market and variable road widths. Keep .5 m occupancy and conforming 1 m triangles. Include `layout.revision` in terrain job/cache identity; config/bounds alone no longer identify edited terrain. |
| `scene.ts` — main | Use castle module placements and one resolved beacon anchor. Replace quarter-Z grove anchors with courts/public greens. Exclude full reservations and public corridors when planting. Reframe around market/castle and preserve existing light/sky/water look. |
| Light field worker/tests — main | Existing compiler already supports all four cardinal turns. Test the actual designated frontage normal instead of selecting only Z-facing panes. Use every castle module, recheck volume bounds and the combined 12 MiB guard. |
| Visibility/shadows — main | Supply the same module/house placements. Existing inverse-yaw label rays need no new algorithm for cardinal turns. Preserve ordered carve semantics and authoritative full-detail casters. |
| `packages/testing/kingdom-camera.mjs` — main | Replace the hard-coded single `castle - 16` placement; derive the street arrival route from graph/approach geometry and redo exact continuous camera clearance. |
| Content — main/team | Authored keep/gatehouse/curtain/tower module factory with tested size and beacon anchor. Do not couple `world` to Three or import content factories into the generator. |
| Horizon/water | No representation change. Their exact triangle-ground samplers continue to consume `terrainHeight`; verify new render bounds and complete lake coverage. |

Arbitrary home yaw is not a harmless alternative to the four-turn migration. The field compiler currently
rejects it and relies on axis-aligned transformed solid/carve boxes. Supporting it correctly requires OBB versus
cell overlap/containment, inverse-local exact air rays and non-cardinal emitter projection. World-AABB expansion
would seal valid doors and corners. Existing label rays already accept arbitrary yaw; that does not make the
other consumers ready. Cardinal courts are chosen deliberately, with visual acceptance still required.

## Hot paths and budgets

- Generation/road integration runs once per immutable snapshot, off the animation path. Target <= 500 ms CPU
  for the 240-home fixture and < 1 MiB serialized graph/plot metadata; measure rather than promise those values.
- Spatial buckets around 16 m index complete lots, street segments, court polygons and pad influences. Sampling
  terrain/public ground inspects nearby candidates; never scan all roads or homes for every terrain cell.
- No new per-frame planning or network traffic. A persistent service sends plan revisions/append operations;
  presence remains the existing complete public projection. Immutable visual worker jobs include plan revision.
- Keep the existing .4 m terrain occupancy/contact guard and 2 m packed displacement envelope. Current 1 m
  terrain topology remains two triangles per square metre; street curves do not add geometry density.
- Keep phone 800k/desktop 2M scene triangle guards, current shadow budgets and combined field workspace < 12 MiB.
  Castle silhouette is not permission to bypass them. Report active bounds, module triangles and field coverage.

## Evidence required

1. Deterministic plan and exact prefix stability across hamlet → town, year append, late old-quarter activation
   and home-tier changes: IDs, full lot corners, frontage, floor height, installed road geometry/grades, founding
   lake, market and castle. A changed render bound may grow; existing geography may not.
2. Full non-overlapping reservations with exact dimensions for all four rotations and all allowed depths;
   public corridors/market/water/castle exclusion; sufficient clear entrance path; no inaccessible cosmetic lots.
3. Graph reachability from every active frontage to market and castle gate. Crossings are actual shared
   junctions or intentionally separate in height, never accidental painted intersections. Road grade, swept
   clearance and market continuity tests use the generated geometry, not duplicated formulas in assertions.
4. Exact foundations for actual authored Hearth ground boxes, all tiers/turns, and transformed street props.
   Approach/court terrain agrees with the rendered 1 m triangle sampler. Retain manifold terrain/chunk joins,
   .4 m contact, 2 m displacement and water-plane coverage checks on multiple seeds.
5. All 240 production-selected presence fronts emit through their actual opening at local and coarse field
   scales; sources turn off; castle modules occlude and admit the gate correctly; real beacon anchor and field
   bounds agree. No relaxation of flood semantics or replacing occupancy with radial brightness.
6. One compound castle with module size assertions and contact; joined wall/gate topology; actual camera paths
   clear ordered home/castle/prop solids and terrain. Reserved 20 m future home envelopes protect the main civic
   route/sight corridor without treating vacant air as a present-day light blocker.
7. Inspect standard desktop/phone shots, including low market/street views and castle skyline. Anti-row metrics
   can reject degenerate plans but cannot certify charm. Founder GPU review decides whether this arrangement
   keeps the accepted light/land and ends the suburb impression. No visual acceptance is claimed by this spec.

## Reference study and decisions

Study: [symbios-tensor](https://github.com/TheJanusStream/symbios-tensor),
[MIT license](https://github.com/TheJanusStream/symbios-tensor/blob/main/LICENSE). Read-only source study with
a Luna low scout; no upstream code copied or executed. Its useful techniques are contour/gradient direction
fields, midpoint streamline integration, spatial intersection indexes and graph-based roads before plots.
Destination guidance combined with an undirected direction field can use `(cos(2θ), sin(2θ))`, avoiding a
false sign flip when two equivalent headings blend. Broad smoothed terrain guides direction; raw terrain still
tests real slopes and water. These are techniques to reimplement, not a dependency or an art template.

Leave behind whole-graph Laplacian smoothing, global simplification/filleting after allocation, pruning unused
roads and re-extracting/subdividing occupied blocks. Those operations can move old addresses. Append-only locked
geometry is Chatdom's persistence decision, not a stability guarantee made by that library. See the
[pinned source study](../references/settlement-streets.md) for exact algorithm/source pointers, spatial indexing,
grade and snap pitfalls, and the techniques we take into this implementation.

- **2026-10-30:** Replace the implementation's single `streetZ` per quarter with an explicit connected public
  graph and market. A tenure quarter is a stable community of courts, not an axis-aligned row.
- **2026-10-30:** Choose four cardinal frontages with real short approaches; genuine road curves come from
  terrain-directed routes and civic destinations. Avoid introducing arbitrary-yaw field approximation errors.
- **2026-10-30:** Freeze natural geography independently of display tier/year. Keep the accepted terrain style
  while removing the population-dependent ridge/lake movement hidden in the current generator.
- **2026-10-30:** Preserve the .125 m build scale through a modular castle. Its compound placement becomes the
  source for rendering, collision/occlusion, lighting, shadows and the beacon rather than a scene-only scale.

Evidence at proposal: repository/source inspection and reference study only; no implementation, tests, captures
or commits in this pass. Main owns acceptance and releases the source-edit freeze.


### First consumer freeze: cardinal frames and castle, 2026-10-30

`packages/world/src/settlement/geometry.ts`, its all-turn fixtures, and `settlement/castle.ts` supply the first
content consumers. The actual plan is twelve modules,64×48m at floor20m; `beaconModuleId` resolves the real
keep anchor at[0,50.5,-66] through `apps/web/src/kingdom/castle-content.ts`. The same helper supplies the compound
review bench. No whole-castle scale transform exists. New tower/wall joins are physically face-adjacent; the
outer gate and existing keep approach have a supported clear route. Main viewed the six production-worker
front/side/back captures at both web sizes in `work/evidence/kingdom/castle-compound/`.

The complete `SettlementPlan` generator remains under review. Its first six-home court template was rejected
by main after inspecting actual generated geometry: repeated pods are another suburb. Plan real connected
roads first, then fit individual street frontages and occasional irregular greens. The small castle/helper
freeze does not certify the new town's roads, density, grading, light field or camera.
