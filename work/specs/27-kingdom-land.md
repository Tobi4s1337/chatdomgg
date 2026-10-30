# Spec 27: land that gathers a kingdom

Status: **frozen 2026-10-30** · Branch: `lane/kingdom-land`.
Vision: `chatdom/ChatDom.md` principles 3, 5, 6 and §5; `chatdom/Artstyle-Soul-Feel.md` §§6, 13;
`chatdom/Quality.md` §§1–3; `chatdom/Moments.md` §§5, 7, 9.
Parent: Spec 02b. Cross-lane ownership: `work/lanes/kingdom-look-owners.md` (takes precedence on seams).

## What and why

A kingdom should look as though people made their homes together on this particular land. Streets bend past
neighbours and arrive at a market square; the town gathers below a castle that crowns its rise. A lake catches
the sky beyond the roofs. Following its stream finds a mill, an arch bridge and a pier. A path climbs to a
lookout; another passes an elder oak into the campfire clearing. Each destination has a silhouette you can spot
and a view worth reaching. The task is a composed, walkable landscape, not a street algorithm demonstration.
Townscaper's warm clustering is the minimum reference; passing our earlier town shots is insufficient.

This lane owns **where**: natural land, water courses, public routes, fixed plots, sites and planting zones.
It authors no trees, place buildings, lamps or hero anvil. Those have their own owners.

## Current state

- `packages/world/src/settlement/generator.ts:generateSettlementPlan` is the installed generator. Its contour
  crescents still produce long rows, four-turn frontages and broad empty greens. It emits canonical plot IDs,
  slot IDs, approaches, a market and the castle compound. Keep these identity and access rules.
- `settlement/terrain.ts:naturalTerrainHeight`, `settlementTerrainHeight`, `samplePublicGround` are shared by
  rendering, worker terrain and ground contact. A separate visually lowered surface would break that agreement.
- `settlement/geometry.ts` and `routing.ts` supply home frames, spatial queries, traced routes and grade helpers.
  Reuse them; improvements must preserve existing accepted routes and the v1 sampler.
- `apps/web/src/kingdom/scene.ts` chooses the installed plan and scatters old trees; the integrator composes it.
  `terrain-worker.ts` receives only a serialized plan, not a `KingdomLand` wrapper.
- `castle-content.ts` requires module size to match actual blueprint size. The keep is itself a compound shell:
  its real inner door sill is not its bounding box edge. Derive the transformed anchor from actual geometry.
- Main has committed the v2 types, trail kind and type exports, not a placeholder generator or fictional sites.
  Actual factories/samplers are this lane's work. See `packages/world/src/kingdom-land/types.ts`.

## Rules

1. **R1 — Founded once.** Land and fixed civic sites derive from seed and founding revision, independent of
   active population. A hamlet prefix and a town, and a later-year append, preserve existing geometry, slots,
   plot IDs, quarter order, paths and foundations within this generator. Oldest tenure stays nearest the castle.
   A new generator must never silently relocate an already founded kingdom. Existing v1 layouts remain valid.
2. **R2 — Streets belong to the land.** Trace useful connected routes along the terrain, with irregular
   neighbourhood greens and occasional short straight passages. No crescent/spoke template repeated across
   every quarter, no sinusoid pasted over a grid, no ornamental road with no destination. Main streets are
   roughly 6 m, lanes roughly 4 m, and Spec 02b grade/access rules hold. Compose bends and junctions around
   landmark views and terrain; do not distort a road merely to satisfy a heading histogram.
3. **R3 — Homes belong to the street.** Preserve full 8×16×20 m reservations, stable `plot:<year>:<ordinal>`
   and `quarterIndex*1024+ordinal`, allowed-depth growth and a 1.5 m entrance route. Keep four exact cardinal
   turns. Fit roads/frontages together: real front doors and presence windows face their own street, with
   varied setbacks, corner lots and all four orientations represented. No long identical lines or blank backs
   offered as the town's face. A varied heading count alone is not acceptance.
4. **R4 — A gathering square.** At the castle foot, four or more meaningful approaches meet an irregular
   roughly 30×24 m market with a clear heart at least 12 m across. Reserve an off-centre 6×6 m focal emote
   statue pad, two smaller pads, a well, stalls, benches and a Forge yard backed by roofs. These are actual
   non-overlapping footprints and connected routes, not labels on occupied lots. Keep the anvil screenshot
   silhouette and the castle visible from the main approach. Emotes and the hero anvil remain their lanes.
5. **R5 — A castle on a rise.** Expand the court to about 40×24 m by moving the keep and rear compound back
   roughly 12 m, and closing the sides with supported modules. Use actual factory sizes and exact foundations.
   Preserve `castle:front:0|1` identity and XZ footprint for places-high's replacement parapets. Derive keep
   door and beacon anchors from transformed geometry. Crown Road climbs naturally, with switchbacks and a
   final gate reveal. From the front parapet, roofs, mill wheel and lake stack into a composed view.
6. **R6 — One water geography.** Place an irregular lake roughly 68×58 m where it appears beyond the roofs.
   A millstream rises north-east of the castle, skirts the town and bends into the lake. Plan stream, pond,
   earth leat and tailrace together: downhill surfaces, softened banks, 3–5 m stream width with wider pools,
   actual bed below each surface, a 10×14 m or larger still pond, weir drop around 0.5–1 m, and at least 5.5 m
   pond-to-tailrace head at the wheel. End the earth leat 8–16 m short of the wheel for the timber trough.
   The crossing has a level pool, explicit landings and a clear span the interim civic bridge actually spans.
   Homes/reservations never collide with water, banks or civic routes. Use masked bodies: the upper pond must
   not draw over unrelated lower land. No bright shoreline rim, floating sheet or terrain stair bank.
7. **R7 — Sites at real scale.** Reserve the pier (about 28×2.5 m with 8×4 m head), boathouse and fishing rock;
   mill, wheel, weir, bridge and fingerpost; high court; lookout plateau; forest entry and clearing. Structural
   site turns are cardinal, while cameras may look northwest across the water. Fit at least six Tide homes
   to the lake frontage without changing anyone's existing style on an adopted plan. Raise the lookout around
   26–30 m above water and shape its shoulder for the trail. Sites supply exact origins, footprints and anchors.
8. **R8 — Groves, not scatter.** Emit coherent ridge stands, forest wall, stream/lake alders, small groves,
   elder-oak and summit-pine landmarks. Ground-dressing plants them. Clearing radius must accommodate the
   existing campfire's 9.6 m envelope, plus furniture/egress; crowns keep outside that envelope with a margin,
   and a gap at least 8 m wide frames roofs and beacon. A trunk at 11 m is not sufficient for a broad crown.
   Sites, homes, full future lots, water and public ground remain clear. Founding sites do not move as town grows.
9. **R9 — Worth the walk.** Connect plaza→court, plaza→bridge→pier, shore→lookout, treeline→clearing→town.
   Aim for 30–60 s between reveals at 4 m/s, with a meaningful bend/bench/sign/tree about every 15–20 s.
   These are pacing guides, not a command to stretch a good compact street into a 240 m detour. Each destination
   reveals the next marker: parapet→lake, pier→summit pine, summit→elder oak/clearing, clearing→beacon.
   Trails are actual public earth paths with graph connectivity, not surface paint alone.
10. **R10 — One physical surface.** The v2 sampler, grading, water mask, rendered terrain, worker, contact and
    light occupancy agree. Grading never fills a channel beneath a bridge; the bridge deck carries the walk.
    Preserve v1 values and dispatch by version. The current worker supports a 512×512 m request; compose the
    supported town and places within it, with padding. This is a request limit, not the realm's permanent size:
    spatial streaming and adoption of larger founded layouts belong to realm work. Do not increase packing
    limits casually, shrink the full reservations or silently drop places when a layout does not fit.
11. **R11 — Deterministic data.** No Three/content/web imports in world; no clocks or random globals. Plans
    and descriptors serialize. Target today's scene budgets (800k phone/2M desktop triangles, current shadow
    and 12 MiB field workspace); measure actual added geometry at integration. Do not spend the lane proving
    invisible bounds repeatedly. One meaningful regression test plus looked-at views judges this work.

## Contracts

Actual compiled declarations: `packages/world/src/kingdom-land/types.ts` and `settlement/types.ts`, re-exported
by `@chatdom/world`. They are the source of truth, not a duplicated shape in a draft.

- `LandformPlan = LegacyLandformPlan | KingdomLandform`. V1 is unchanged. V2 extends the same base with
  `hills`, `waters` and `streams`. Each `WaterBody` carries its own `depth` and level. Each stream has ordered
  `points: {position: XZ; bed; level; width}[]` and `bank`; no parallel arrays that can drift in length.
- `KingdomLand` carries the actual plan, sites, places, tree zones, landmarks, dressings, paths and views.
  `waters` aliases `plan.landform.waters`; `plan.lake` equals the designated lake body geometrically.
- `LandSite.position` is the blueprint placement origin in world metres, local +Z forward; `turn` is a
  `CardinalTurn`, not arbitrary yaw. `footprint` is a simple CCW polygon. Named place anchors are explicit.
- `LandDressing` is civic pacing furniture/fences only. Living scenery and ornamental rocks are ground-dressing's;
  waterline rocks/reeds/lilies are places-water's. No anonymous substitute content at a reserved site.

The lane implements and exports these pure functions (absent until implemented; no fake imports):

```ts
const EXPLORE_PACE_MPS = 4;
function generateKingdomLand(config: KingdomConfig): KingdomLand;
function naturalLandHeight(landform: KingdomLandform, x: number, z: number): number;
function sampleLandWater(landform: LandformPlan, x: number, z: number): LandWaterSample | null;
function waterSurfaceAt(landform: LandformPlan, x: number, z: number): number | null;
function waterKeepOut(landform: LandformPlan, x: number, z: number, margin: number): boolean;
```

`sampleLandWater` returns the nearest relevant water/bank envelope: surface, bed and signed wet-edge distance
(negative inside). It returns null outside its defined bank envelope. `waterSurfaceAt` returns a level only
inside wet ground, not the whole bank. `waterKeepOut` considers every body/channel plus caller margin, even when
outside the sample envelope. Require finite coordinates/levels, positive sizes/depth and nonnegative margins; world coordinates and water beds may be negative. For overlaps, define deterministic ID tie-breaking
and physical junction levels; never select a distant elevated pond by level alone. V1 uses its exact existing
irregular shore. The same analytic irregular-rim/bank query supplies the renderer's water mask and terrain carve.

`apps/web/src/kingdom-land/index.ts` exports `placeLandContent(land, ground): Dressing[]` and
`landPlanSvg(land): string`. Keep lane modules separate: `generator.ts`, `geography.ts` (water/sites),
`planting-zones.ts`, `routes.ts` and `views.ts`, so independent tasks have disjoint ownership.

## Scope

Write `packages/world/src/kingdom-land/**`, `apps/web/src/kingdom-land/**`, this spec and lane PRD/progress.
Granted existing world seams: `settlement/terrain.ts` v2 dispatch, public trail grading and channel protection;
`settlement/types.ts` only necessary v2/trail refinements consistent with frozen types; `world/src/index.ts`
exports of implemented helpers. Do not rewrite the existing generator or frozen geometry/routing helpers.
Everything else is read-only, including `packages/shared`, scene, terrain worker, content, manifests and lockfile.
Report a real helper limitation as `needs:`; integrator coordinates any shared-file change explicitly.

## Integration and realm boundary

The team integrator alone edits scene composition, terrain-worker surfaces, market-site wiring and old-tree/water
replacement. The lane supplies an exact mount recipe with imports, ordering, source lists, readiness and disposal.
`?land=next` is an opt-in SIMULATED layout preview only after the v2 sampler and grading are implemented. It is
not offered as a live Herald switch. Keep the current accepted plan/slot configuration on real feeds.

Realm work owns persistent founding revisions, deed/plot coordinates, migrations, accepted growth, chunk streaming
and publishing a shared adopted layout to Herald and clients. No default generator switch until that adoption is
explicit. A stable slot number is not proof that a citizen's home stayed in place.

The integration recipe must: compile wear/trail/waterbed from the same plan; replace fixed market offsets with
sites; reserve all place envelopes; aggregate dressed blockers/shadows once; remove the interim `mill:bridge`
footbridge only when the reviewed stone crossing supplies a continuous walk; and never mount duplicate scenery.
Castle replacement resolves reviewed geometry BEFORE blocker/shadow/content lists and validates actual dimensions.

## Acceptance

Run `pnpm typecheck`, `pnpm lint`, `pnpm exec vitest run packages/world/src/kingdom-land`, `pnpm build`.
One regression test covers deterministic v1/v2 sampling, existing geometry across growth, access/connectivity,
water downhill/head/keep-outs and supported request fit. Reuse the existing settlement audit rather than clone
it; report exceptions honestly. Reject collisions/floating foundations, but do not build a new proof framework.

Own `apps/web/src/kingdom-land/capture.mjs`, use the shared capture lock before browser/server creation, a free
5170–5199 port or `--base-url`, and stop only owned processes. Capture narrowly per task; reuse loaded scenes.
Set readiness after assets and one meaningful drawn frame, never wait on compileAsync hints indefinitely.
One or two shots per task at 1440×900/390×844, looked at, are sufficient. At final integration: town dusk both
sizes, a street, and a contact sheet of court/pier/bridge/lookout/clearing reveals. Use the main
`__chatdomKingdom.pose(eye, target, fov?)` seam for integrated poses; `pose(null)` releases it. New pure land
benches may use the same poses in their own cameras. Fail console/page/shader errors. Outputs
`shots/kingdom-land/**` are ignored. Integrator runs `pnpm verify` once on the assembled candidate.

## Quality bar

A town on a particular piece of land, with intimate streets and a skyline you remember. Castle, roofs, woods and
lake make clear large/medium/small masses and three value groups. Empty ground is a composed meadow, never a
placeholder green carpet. Street fronts, roofs and pockets of open space make an asymmetric rhythm; every place
has a distinct silhouette and reveal. Judge at thumbnail size and in the street. No heading metric certifies charm.

## References

- `work/references/organic-towns.md`: plaza as a real polygonal place and meaningful topology; water-aware route
  proposals. Copyleft sources are ideas only, not imported generator code.
- `work/references/settlement-streets.md`: existing contour/routing helpers and immutable accepted geometry.
- `work/references/water.md`: one shore surface/mask; this lane changes geography, not the water shader.

## Not now

Trees/ground forms, place structures, lamps/grade, hero anvil, emote statues and campfire furniture are other lanes.
Persistent adoption/authority and larger render-window streaming are realm work, not missing fake implementations.

## Decisions

- **2026-10-30:** No placeholder generator. Freeze actual types, then build the real generator on typed fixtures.
- **2026-10-30:** Physical continuity wins over silently switching a seeded generator. New geometry is a preview
  until realm adopts a founded revision; old homes never move as a side effect of a renderer upgrade.
- **2026-10-30:** Water queries consume serialized landform, not the renderer-only land wrapper. Cardinal
  structural sites preserve existing occupancy. Camera bearings can be free.
- **2026-10-30:** Integrator owns composition. No adjacent `scene.ts` line grants across seven worktrees.
