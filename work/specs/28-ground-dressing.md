# Spec 28: Meadows, gardens and woods on every slope

Status: **frozen 2026-10-30.** Main freezes the real landform contract and the handoff commit; no fake production stub. Ownership: `work/lanes/kingdom-look-owners.md` overrides the draft OWNERS matrix.
Vision: `chatdom/ChatDom.md` §5 and principles 3, 10, 17–18; `chatdom/World-Tree.md` rules for places (the lot, its
back fence and tended meadow; age is beauty); `chatdom/Artstyle-Soul-Feel.md` §§1 (signature 5), 6.1, 6.3–6.6, 13,
15, 16.2 (wind row); `chatdom/Quality.md` rules 4–6, 8, 10–11 and §4.

## What and why

The kingdom already has natural terrain, three core tree variants and authored doorstep props. Its open ground
still lacks the planted hierarchy, gardens and woodland silhouettes that make a memorable landscape. This
lane dresses every piece of ground people look at so the kingdom feels tended and lived in. Walk out of your door
and grass tufts and wildflower drifts thicken around the doorsteps and the street edges, then thin into open meadow.
Each lot's back fence stands where the home has grown to, with the tended meadow behind it. Old Row has mossy walls,
full gardens and big old trees; the newest street has staked saplings, fresh posts and the treeline close by. Woods
climb the slopes and crown the ridgelines, so the hills behind the castle carry a notched skyline of tree crowns. All
of it sways in one wind and parts around walking citizens. It is instanced and distance-faded, so a whole town of it
costs a few dozen draws.

## Current state

- `apps/web/src/kingdom/scene.ts:182–229` plants about 260 (town) or 115 (hamlet) copies of three core trees
  (`packages/content/src/core/index.ts:createTree`, 64×80×64 cells, under 8 m) through the scene's private
  `instance()`/`updateInstances()` LOD batches (factors 1/2/4, `advanceDetailTransition`). It already honours the rules
  this lane keeps: a 4.25 m crown clearance from every future lot (`layout.reservations`), from public ground
  (`samplePublicGround(...).reservedDistance`), from the castle bounds and from the lake ellipse (×1.19), with
  `rootHeight` grounding on the horizon sampler. The integrator replaces this block with the accepted mount (see Integration recipes).
- `apps/web/src/kingdom/horizon.ts:createHorizonSurface(...).sampleHeight` (in scene.ts: `landHeight`) is the one
  exact ground for the detailed terrain, its collar and the far hills out to ±1100 m. Far land starts rising at about
  330–350 m from the town (`farHeight`). Use it for every placement height; never `naturalTerrainHeight` alone.
- `apps/web/src/kingdom/settlement-content.ts:placeSettlementContent` places each home and its street props
  (`createStreetProp`: flower pot at the facade, trough/shrub/rock at x=6, a short fence or wall on every fourth
  lot at depth+1.75 m), plus `placeMarketContent` (well and two stalls). Its `Dressing {blueprint, position, yaw}` is
  the placement shape the light field and shadows already consume. These pieces are inputs to avoid, not to redo.
- `packages/content/src/props/street/**` (spec 06: fences, low walls, pots, troughs, rock cluster, leafy shrub, in
  Hearth and Tide) and `packages/content/src/civic/**` (spec 10: footbridge, gateway, gift cart, banners, crest,
  market stores) are on main; CP04 noticeboard/sign/bench/lantern-post implementations await the reviewed civic candidate. This lane may place street-prop rocks and shrubs
  in its own drifts, but it never re-authors a garden-edge fence/wall, a cart for goods, a bench or a lamp.
- `packages/world`: `SettlementPlan` (`homes`, `reservations` with `lot`, `quarterYear`, `rotation`; `homes` supplies `allowedDepth`;
  `streets` with `width`/`verge`, filtered by `activeStreetIds`; `nodes` incl. `frontier`; `courts`, `market`,
  `castle.bounds`, `lake`, `landform.ridge`/`castleRise`), `homeFrame`, `homeOrigin`, `currentFootprint`,
  `samplePublicGround`, `randomUnit`, `seedHash`. Read-only.
- Render: `createVoxelMaterial` (`packages/render/src/voxel-material.ts`) has no wind. Its instanced vertex path reads
  `aLodFade` and its fragment shader dithers on `vLodFade` (≥0 incoming, <0 complementary outgoing).
  `VoxelWorkerPool.submit({kind:'blueprint', …, lodFactor:2|4})` + `geometryFromChunks(chunks,'build')`
  build each level. The scene's horizon already derives a material that shares `ground.material.uniforms` and its fragment
  shader with its own vertex shader; this lane uses the same technique for sway.
- `packages/content/src/materials.ts`: flora uses registered `grass, earth, leaf, goldLeaf, moss, bark, petal,
  blueFlower, cream, thatch, terracotta` and kit `stone`/`trim` (`STYLES.hearth|tide|grove`). There is no heather,
  buttercup or conifer-needle ramp yet (main registers new ramps only on evidence).
- `packages/content/src/catalogue.ts` globs `./props/*/index.ts`; a new `props/dressing/index.ts` is found by the
  glob but needs its collection name registered by main.
- **Neighbours running beside this lane.** Kingdom-land (spec 27) decides where landscape trees grow. `generateKingdomLand` returns `treeZones` (ridge, forest wall, clearing ring, stream and lake
  alders, groves), two `landmarks` (`elder-oak`, `summit-pine`), site and place footprints and real path edges. `waterKeepOut` queries `land.plan.landform`;
  `waters` is only a derived alias of that landform, never independent geography. Main freezes the actual types first. Isolated benches use a typed, explicitly SIMULATED fixture until real zones land; production never substitutes a fixture. Places-high (spec 30) and places-water
  (spec 29) build the places and place this lane's forms nowhere except the court's `pear-espalier`; reeds,
  lilies and shore pebbles are places-water's.

## Rules

1. **R1 — Real forms, authored like the street kit.** Deliver the forms below as pure TypeScript `VoxelBlueprint`s
   (version 1, build lattice 0.125 m, half-open boxes, y=0 ground, registered materials only, `windows: []`). Every
   connected component reaches y=0. Silhouettes come from broad stepped masses with authored asymmetry, never voxel
   noise or confetti. Kit forms resolve stone/trim through `STYLES` for Hearth, Tide and Grove.

   | Group | Form | Max cells XYZ | What it must read as |
   |---|---|---|---|
   | Cover | `meadow-tufts` | 16×5×16 | A 2 m patch of 4–7 soft tufts in two greens, tips catching light |
   | Cover | `wildflowers-petal`, `-blue`, `-gold`, `-cream` | 16×6×16 | Tufts with one flower colour in a loose drift, heads 2×2 cells |
   | Cover | `clover-pebbles` | 16×2×16 | Low clover and three or four rounded pebbles; lawn texture |
   | Cover | `heather-drift` | 24×6×24 | Low domed cushions for slopes and the castle rise |
   | Cover | `fern-bank` | 24×10×24 | Arching fronds for woodland edges and shade |
   | Garden | `garden-bed` (kit) | 24×6×12 | A raised bed with a kit edge, soil and mixed planting; no ripe crop or harvest affordance |
   | Garden | `woodpile` | 20×12×10 | Split logs with end-grain faces under a short bark lean-to |
   | Garden | `barrels` | 14×10×8 | Two hooped barrels, one slightly turned |
   | Garden | `crates` | 12×12×10 | Two stacked crates and a sack |
   | Garden | `handcart` | 24×14×12 | A parked two-wheeled garden cart resting on its legs, shafts down |
   | Field | `field-wall` (kit) | 32×7×5 | A 4 m dry-stone run with an uneven top and rounded ends that overlap |
   | Field | `rail-fence` (kit) | 32×10×4 | A 4 m split-rail run with leaning posts and overlap at the ends |
   | Field | `back-fence` (kit) | 64×9×3 | The lot's 8 m back fence: low pales on two rails, a post every 2 m |
   | Path | `stepping-stones` (kit) | 24×2×8 | Three flat, worn stones flush with the turf |
   | Path | `edge-stones` (kit) | 16×3×4 | A row of rounded kerb stones for a path edge |
   | Tree | `oak-old-a`, `oak-old-b` | 96×112×96 | 12–14 m broad old trees, rounded crowns over visible branching |
   | Tree | `beech` | 96×112×96 | 11–13 m smooth grey trunk, a high domed crown, the forest wall's fifth variant |
   | Tree | `elder-oak` | 128×144×128 | One 18 m landmark with a crooked crown, roots that form a bench facing the meadow and a few carved marks in the bark (no readable names) |
   | Tree | `pine-windbent` | 72×88×72 | 10 m pine bent toward local +X, roots gripping |
   | Tree | `fir` | 56×96×56 | 10–12 m conifer, tiered skirts |
   | Tree | `birch` | 48×80×48 | 8–10 m slender pale trunk, light gold-green crown |
   | Tree | `alder` | 56×72×56 | 7–9 m waterside tree, darker crown, low split trunk |
   | Tree | `sapling-staked` | 16×28×16 | A 3 m young tree tied to a stake, for the newest street |
   | Tree | `bramble-hedge` | 32×12×10 | A 4 m meandering hedgerow run for field edges |
   | Tree | `pear-espalier` | 48×40×6 | A pear trained flat on a wall in tiers, for places-high's castle court |
   | Far | `woodland-clump` | 192×120×192 | Five to seven crowns as one mass, made for the far hills at LOD 4 |

   IDs are `dressing-<form>` and `dressing-<style>-<form>` for kit forms. `BLUEPRINTS` lists every finished form in
   table order (kit forms Hearth, Tide, Grove). Initial per-form budgets, recorded as actuals in the owned README:
   cover ≤ 1,500 meshed triangles at full detail, garden/field/path ≤ 6,000, trees ≤ 24,000 (`elder-oak` ≤ 40,000),
   `woodland-clump` ≤ 8,000 at LOD 4; ≤ 2,000 source boxes each. Box counts stay well inside shared limits.
2. **R2 — Honest scenery.** Nothing looks usable that is not: no seat, gate, stile, ladder, well, lamp, flame,
   sign, ripe fruit, berries, mushrooms or anything that looks gatherable. The elder oak's root bench is a real seat supplied by places-high: publish its exact local seat transform with the tree; the integrator must bind the seat before production mounting. A bench fixture says SIMULATED and does not claim a saved seat. A handcart is parked and empty except a
   sack; barrels are closed. Solid pieces are solid in occupancy and are listed as blockers (R6). Ground cover is
   passive, non-solid in the mount's blocker list, and never hides a solid edge a citizen could trip on.
3. **R3 — Place by rules, deterministically.** `planGroundDressing` is pure: same plan, seed, tier and inputs give
   identical placements, using `randomUnit(seedHash(...))` only; no `Math.random`, clocks or frame order. Heights use
   the host's `ground` sampler. All structural garden/field/path blockers have `turn: CardinalTurn`, yaw exactly `turn * Math.PI / 2`, with
   `position` the blueprint placement origin. Cover and visual crowns may use free yaw. Solid trunks/roots/hedges
   must use an accepted cardinal collision representation or an explicit tested cardinal proxy matching their
   occupied envelope; never round a free yaw in the blocker path. Compute the placement origin from the authored
   pivot/centre, as `placeSettlementContent` does, rather than putting the blueprint corner at a desired centre.
   - **Clear ground.** Nothing where `pavingDistance ≤ 0.25 m`. Solids only where `reservedDistance ≥ 0.6 m`
     (outside each street's verge), out of every home's current footprint and entrance band, and never between a
     facade and its street above 0.6 m tall, so every presence window and name reads from the street. Nothing
     inside the castle bounds + 12 m above 1 m tall; nothing in host `keepClear` circles (the Forge plaza
     among them), host `keepOut` polygons (the place assemblies' `keepClear`, kingdom-land's site and place
     footprints) or the market, castle court and court polygons; no solid whose footprint intersects an occupied footprint expanded by 1.5 m (not origin-to-origin distance). Exceptions are only deliberate, tested overlaps within one authored garden assembly.
   - **Lots.** Trees keep their full actual crown envelope plus ≥0.25 m clear of every future lot, public corridor and roof. The old 4.25 m expansion was for the old ≤8 m core tree; it is not sufficient for an 18 m elder oak. Use authored per-form crown/trunk bounds and transformed footprint checks. Each home's `back-fence` stands behind its current open depth (`SettlementHome.allowedDepth`), across the lot's
     8 m, wherever ≥ 0.5 m clears the home's actual occupied rear; use the local home frame, not the reservation AABB axes. If the remaining rear strip cannot hold that clearance, omit that run, with a report reason; when the home grows, it moves with it. Behind it, to the 16 m lot
     line, lies the tended meadow: cover only, never solid. Growing a home changes only placements inside that lot.
   - **Slopes.** Cover up to 35°; garden pieces only where the ground under their footprint varies ≤ 0.125 m; field
     runs follow contours and may sink ≤ 1 cell; trees on 0–30°, with a true ground-reaching trunk/root envelope across sampled root contact points. Reject/relocate a placement when a rigid root flare cannot meet the actual rendered slope: a lowest sample alone can leave half the root floating or bury it. No piece floats or buries its face.
   - **Density.** Open-ground cover per eligible open area by distance `d` to the nearest facade or path edge: one patch per ~4 m²
     for `d < 6 m`, falling to one per ~16 m² at 30 m, then one per ~40 m² in drifts. Older quarters (smaller
     `quarterYear`) carry fuller gardens and mossier walls; the newest quarter carries saplings and the treeline.
   - **70 / 20 / 10.** The landform, woods and town are the big shapes; trees, hedges and garden vignettes are the
     medium band, in groups of 2–5 with calm space between; cover is the small sprinkle, in drifts of 5–15 patches
     of one flower colour, 3–6 m across, never an even scatter. At least 40% of open meadow keeps no cover within
     2 m. Garden vignettes (woodpile + barrels, bed + crates, the handcart) average one per 1.5 homes, at lot sides,
     court corners and row ends, never in the front apron the street props already use.
   - **Woods.** This lane is the only one that plants landscape trees. The host supplies kingdom-land's actual `land`;
     old trees, firs, birches and alders go into its zones and nowhere else on the detailed terrain (saplings and
     hedges keep their own rules): ridge stands that break the skyline, the forest wall of old trees (`oak-old-a/b`,
     `beech`, `fir`, `birch`, crowns overlapping into one mass with dark gaps between trunks, ferns and shrubs at
     their feet, no tree identical to its neighbour in yaw or form), the clearing ring (all crown/root envelopes outside `land.places.forest.clearing.radius + 1.4 m`, with the radius ≥9.6 m from spec 27; preserve the ≥8 m gap toward its actual supplied bearing), alders along the
     stream and the lake shore, and groves on the greens; the `elder-oak` and the summit `pine-windbent` stand
     exactly on the landmarks; nothing inside `waterKeepOut(land.plan.landform, x, z, 3)`. A fully populated typed land fixture exercises every zone and both landmarks before the generator lands.
     Production reads the actual land data; empty zones mean no landscape trees there, never a guessed alternate
     forest. `pine-windbent` leans along its supplied landmark yaw. Direction and seasonal hue belong to the kingdom,
     not an assumed universal sun bearing. Field
     fences and hedges stop at the forest site, where places-high's stile carries the path over.
   - **Lookout Hill.** Heather drifts, blue-flower drifts and wind-flattened `meadow-tufts` cover the summit and
     its shoulder, clear of places-high's `keepClear`; the switchback edge stones are places-high's.
   - **Far hills.** On the far land beyond kingdom-land's zones (about 120–900 m out), `woodland-clump` belts follow
     crest lines and the upper slopes with gaps, so the hills behind the castle carry tree crowns along at least 40%
     of their skyline, broken into groups with sky between, never a uniform fur.
4. **R4 — Batched, faded, bounded.** Index placements in 32 m tiles. Do not create a mesh for every tile or blindly allocate every form × style × LOD: that exceeds the draw budget before anything moves. Use visible instanced batches for repeated flora and bounded combined geometry pages for rigid assemblies or distant form families, preserving source placement metadata. A still camera performs no per-instance visibility or matrix rewrite; time/walker uniforms may update. Camera or lot visibility changes update only affected prebuilt tile blocks, with bounded installs. Detail levels and the far cut fade by distance in the shader, using the
   existing complementary dither, so two levels never double or leave holes and nothing pops. Initial bands
   (portrait in brackets): cover full detail to 26–34 m (18–24 m), flower drifts at LOD 2 to 90 m (60 m) and at
   LOD 4 to 180 m (110 m) so the town still reads flowered from the castle; garden/field pieces LOD 1/2/4 to 180 m;
   trees LOD 1 under 32 m (22 m), LOD 2 under 95 m (55 m), LOD 4 beyond. Ground cover casts no sun shadow; trees and
   solid pieces register their nearest level through `registerShadow`. Added primary-colour cost in any view: ≤ 48 draw calls; report shadow calls separately and aggregate them with the full scene. This is a starting target, not a reason to delay the first lovely tree or strip necessary forms. Measure a representative integrated view once; justify any higher cost with the resulting visible improvement and phone behavior. Do not build a synthetic all-families budget proof in GD01. Report actual triangles, CPU/GPU geometry bytes and instances per view through `stats()`. Instance caps: hamlet ≤ 12,000 cover patches,
   town ≤ 40,000; trees ≤ 1,500 near and ≤ 4,000 far clumps.
5. **R5 — One wind, people make way.** A material derived from the kingdom clay material (shared `uniforms` object
   and fragment shader, one anchored insertion into its vertex shader that fails loudly if the anchor moves) sways
   cover and canopies by local height², phase by world position, with gust bands travelling east-south-east at about
   3 m/s every 6–9 s. Tips move ≤ 0.06 m (cover) and ≤ 0.08 m (canopy); trunks, walls, fences and garden pieces do
   not move. Cover within 0.9 m of a walking citizen leans away by ≤ 0.12 m. Motion is driven only by the caller's
   `time`, so a seek reproduces the frame. Window light, fog, beacon light and grades come unchanged from the shared
   uniforms; no lane-local lights, exposure or fog.
6. **R6 — Solids, light and the building lot.** `blockers` lists opaque garden, field, path-edge and back-fence pieces in the existing `{blueprint, position, yaw}` shape for the light field. `collisionPieces` includes every solid, including real tree trunks and hedges, while cover is passive. Every structural blocker/proxy carries its exact cardinal turn; freely rotated visual canopy geometry cannot silently become an inaccurately rotated blocker. Do not equate “not in the light volume” with walk-through geometry. Main/integrator consume these through the actual world/camera clearance system; no shipped walk route may gain an unbound solid. A test or static bench alone does not prove that binding. `hideLot(slot)` removes all
   dressing inside that lot on the next update (build mode owns the lot), and `hideLot(null)` restores it.
7. **R7 — Paths wear where people walk.** Wear follows only real routes: the active streets and each home's approach.
   At route bends and doorsteps the verge is trodden (cover thins, earth shows through `wornGround`, Contracts),
   `edge-stones` line the inside of bends on older quarters, and `stepping-stones` cross the verge where an
   approach leaves the paving. Older quarters wear more. Host-supplied `footways` (polylines of real routes to
   places) get the same treatment, starting as trodden grass and becoming packed earth with edge stones near the
   street. No path is drawn where nobody walks. Kingdom-land's trails are footways (their earth
   surface is kingdom-land's seam; their verges and edge stones near the street are this lane's).

## Contracts

Lane-local, frozen by main's handoff commit; no `packages/shared` edits.

`packages/content/src/props/dressing/index.ts` exports:

```ts
export const DRESSING_FORMS: readonly DressingForm[];           // R1 table order
export type DressingForm = /* union of the R1 form ids */;
export const DRESSING_ROLES: Readonly<Record<DressingForm, {
  band: 'big' | 'medium' | 'small'; solid: boolean; sway: 'none' | 'cover' | 'canopy'; kit: boolean;
}>>;
export function createDressing(form: DressingForm, style?: StyleKey): VoxelBlueprint; // style required iff kit
export const BLUEPRINTS: readonly VoxelBlueprint[];
```

`apps/web/src/kingdom/ground-dressing/index.ts` exports:

```ts
export interface GroundPiece { id: string; blueprint: VoxelBlueprint; position: Vec3; yaw: number; lotSlot?: number }
export interface GroundBlocker extends GroundPiece { turn: CardinalTurn } // yaw === turn * PI/2
export interface GroundDressingInput {
  land: KingdomLand; seed: string; tier: KingdomTier; // layout is land.plan; exact type from spec 27
  ground(x: number, z: number): number;          // the horizon surface's sampleHeight
  waterKeepOut(x: number, z: number, margin: number): boolean; // host binds real landform query; bench fixture only in bench
  occupied: readonly Pick<GroundPiece, 'blueprint' | 'position' | 'yaw'>[]; // real host placements
  keepClear: readonly { x: number; z: number; radius: number }[];
  keepOut?: readonly (readonly (readonly [number, number])[])[];   // polygons: place assemblies' keepClear, site footprints
  footways?: readonly (readonly [number, number])[][];
}
export interface GroundDressingPlan {
  pieces: ReadonlyMap<string, readonly GroundPiece[]>;   // by blueprint id
  blockers: readonly GroundBlocker[];
  collisionPieces: readonly GroundBlocker[];
  seatAnchors: readonly { id: string; treeId: string; position: Vec3; yaw: number }[];
  report: { counts: Record<string, number>; homesWithVignette: number; omissions: readonly string[] };
}
export function planGroundDressing(input: GroundDressingInput): GroundDressingPlan;
export function createGroundDressing(host: GroundDressingInput & {
  plan: GroundDressingPlan; // consumes the already computed plan, never replans
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; pool: VoxelWorkerPool; clay: VoxelRenderState;
  registerShadow(mesh: THREE.Mesh): () => void; signal: AbortSignal;
}): {
  ready: Promise<void>;                 // every level meshed and added
  blockers: readonly GroundBlocker[];
  collisionPieces: readonly GroundBlocker[];
  update(frame: { time: number; walkers: readonly Vec3[] }): void;   // every frame, cheap
  hideLot(slot: number | null): void;
  views(): Record<'street' | 'garden' | 'edge' | 'ridge', { eye: Vec3; target: Vec3 }>;
  stats(): { drawCalls: number; shadowDrawCalls: number; instances: number; triangles: number; geometryBytes: number };
  dispose(): void;                      // frees owned geometry/material/meshes only
};
// The integrator replaces old planting only when this whole module is accepted; no runtime readiness flag.
```

`apps/web/src/kingdom/ground-dressing/wear.ts` exports `wornGround(layout: SettlementPlan, x: number, z: number):
boolean`, pure and cheap per sample. A companion owned `surface-art.ts` exports a deterministic sampled wear/cover
mask and shader hook description for kingdom-light to compose into its shared ground shader. No terrain shading
fork, shader patch in `packages/render`, or private exposure/fog/light is allowed. The integrator owns the terrain
worker choice, with waterbed/paving taking precedence over wear. `footways` uses the exact supplied path polylines;
if they extend wear, publish `createWearSampler(layout, footways)` so planning and worker use one prepared index.

`KingdomLand`, `KingdomLandform`, `CardinalTurn` and `XZ` use the actual main-owned
`packages/world/src/kingdom-land/types.ts` / `settlement/types.ts` exports via `@chatdom/world`. The real type has
`LandSite.turn` (no site-facing field), forest clearing radius `number`, and streams of
`{position: XZ, bed, level, width}` points. Main has created type exports; generator/water query implementations
arrive from spec 27, not imaginary imports. Isolated benches may import real types and inject typed fixture
values plus the same explicit water-keep-out host callback until those implementations land; that callback is a
bench-only dependency, not a production alternative. The lane cannot duplicate land types or ship a generator fallback. The draft's
`waterKeepOut(land, …)` call is withdrawn: water queries take the main-frozen landform, as spec 27 defines.
Type-only fixtures live in the owned bench and are visibly SIMULATED. `registerShadow` returns a release callback;
disposal releases every registration before freeing only lane-owned geometry/materials. Materials derived for sway
share caller lighting uniforms and preserve the production fragment shader; they never dispose caller textures.

Stable `GroundPiece.id` values derive from semantic site/lot/placement identity, not iteration order; they bind
seat anchors and selective build hiding. `seatAnchors` are world metres; the content factory also documents the
exact local root-seat transform places-high uses. `hideLot` toggles only placements tagged with that actual slot;
it does not hide neighbouring public dressing or change original collision/lighting data without notifying the
host. Integrator must synchronize build visibility with light/collision inputs, not render visibility alone.

`views()` returns capture poses computed from the plan: `street` (eye 1.6 m above the arrival home's street, looking
along the frontage), `garden` (a vignette and back fence at an Old Row home), `edge` (the newest street toward the
treeline), `ridge` (from the market toward the hills behind the castle). The material shares the clay uniforms
object; the mount never disposes caller-owned materials, pool or scene.

## Scope

Write only `packages/content/src/props/dressing/**`, `apps/web/src/kingdom/ground-dressing/**` (including tests, isolated typed-fixture bench, capture script and concise README), the narrowly scoped ground-dressing branch in `scripts/content-validate.mjs`, this spec and `work/lanes/ground-dressing/{PRD.md,progress.txt}`. Ignored
outputs go to `shots/ground-dressing/**`. Everything else is read-only: scene.ts and the rest of `kingdom/`,
`packages/render`, `packages/world`, `packages/shared`, materials, catalogue, all other validator branches, street-props, civic and core
content, routes, root scripts and manifests. You are not alone in the codebase; preserve others' edits. Sub-agents
never run git; if you fan out, one owns the content folder and one the web folder.

### Integration recipes and start gate

`work/lanes/kingdom-look-owners.md` is authoritative. The team integrator alone edits `scene.ts` and
`terrain-worker.ts`; this lane supplies exact imports, call order, teardown and proof in its README, never line
hunks against stale numbers. Main freezes real spec 27 types and adds the collection's dynamic catalogue path
before a branch starts; absence is `needs:`, never a fake production stub.

1. **Collection.** Main adds `ground-dressing` to `packages/content/src/catalogue.ts` and the dynamic map. This
   lane may edit only the `ground-dressing` conditional palette/manifest branch in `scripts/content-validate.mjs`.
   Permit registered flora/garden roles from R1, including cream, goldLeaf, thatch and terracotta where authored;
   preserve all other collection rules and reject arbitrary registered colours. Final validation checks the full
   ID/order manifest; `--partial` accepts only finished members, never blank assets. New registry colours remain main-owned.
2. **Plan then mount.** Integrator obtains the actual rendered surface sampler before planning; supplies
   `land.plan`, all occupied houses/castle/street/land/lamp/place pieces and their reserved polygons. Run the pure
   planner before preparing light/collision inputs; mount its exact plan once to avoid planning twice or changing
   blocker IDs during readiness. Bind `update` with real walker positions, the build visibility callback with the
   exact hidden slot, shadow release callbacks, readiness and error cancellation. Integrator awaits `ready` before
   announcing a meaningful first frame. Accepted module mounting replaces old core-tree planting atomically.
3. **Capture pose.** Main has supplied one `__chatdomKingdom.pose(eye, target, fov?)` override shared by all
   landscape lanes. It holds until explicit `pose(null)`, normal camera selection, a seek with an explicit view, capture choreography or replay; it is an evidence override, never product player control.
   Expose this lane's `views()` and `stats()` under `__chatdomKingdom.dressing`; do not invent parallel capture URLs.
4. **Wear and surface art.** Integrator composes the actual worker sampler in the one terrain hunk shared with
   spec 27. Waterbed and paved cells win; kingdom-land owns trail earth; ground-dressing supplies only route wear
   masks and verge dressing. Kingdom-light owns `packages/render/src/voxel-material.ts`, including ground shader
   composition, and reviews the owned hook/mask. No last-writer shader replacement by this lane.
5. **Real seats/solid world.** Places-high binds the elder-oak seat from its returned anchor. Integrator binds
   `collisionPieces` to citizen and camera clearance before production; solids cannot be knowingly shipped as
   pass-through scenery. If this consumer is missing, continue in the isolated truthful bench and report `needs:`.

Main may register heather, buttercup, needle or fern ramps after reviewing swatch evidence. Existing registered
keys can deliver the content meanwhile; no palette mutation is authorized in this lane.

## Acceptance

```sh
pnpm content:validate --collection ground-dressing        # --partial until GD06
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/content/src/props/dressing apps/web/src/kingdom/ground-dressing
pnpm build
pnpm content:render --collection ground-dressing --asset dressing-elder-oak --hour 19
# For other changed forms use --asset; the owned capture script assembles selected sheets.
node apps/web/src/kingdom/ground-dressing/capture.mjs [--base-url http://127.0.0.1:<port>] [--views ...]
```

The capture script owns a temporary preview on a free 5170–5199 port or reuses `--base-url`, takes the shared
capture lock (`packages/testing/capture-lock.mjs`), waits for `__chatdomReady` and `lightingReady`, fails on console
or shader errors, and stops only what it started. Use one or two task-specific frames, with a reused loaded scene. Final chosen evidence is a street and a
hero dusk frame at 1440×900/390×844, a tree/form contact sheet and a noon garden/forest detail sheet. Reuse task
evidence; recapture only changed views. Before integration use the owned SIMULATED typed-fixture bench; actual
land/placement input is required for integrated acceptance. No production fixture path substitutes for a generator.
Outputs are `shots/ground-dressing/**`; record actual representative counts once, not a separate budget-proof
suite. Open the selected images with `view_image`, judge at full size and thumbnail, and fix noise/floating/empty ground.

Tests cover the real risks, once each: placement determinism; clearances (paving, entrance bands and fronts, lots
for trees, castle, lake, `keepClear`, `keepOut`, `occupied`); with a fixture `land`, trees only inside zones, the
clearing ring's actual-radius-plus-crown clearance and 8 m gap, and the landmarks exactly placed; growth stability (a deeper
`allowedDepth` moves the back fence and changes nothing outside that lot); the density falloff (cover within 6 m of
homes/paths ≥ 3× the density at 30–40 m) and drift clustering with the 40% open-meadow share; every form grounded
within budget in every kit; `update` allocation-free with a still camera; `dispose` frees owned resources and leaves
caller resources alive; the vertex-shader anchor present. The team checks real-GPU frame-time targets by device tier after integration: laptop 60 fps, phone ≥30 fps,
with p95/p99 and spikes reported for hero/street. No universal 16.7 ms phone threshold. SwiftShader proves
rendering/behavior, never target-device performance.

## Quality bar

Stand at a doorstep at dusk and the ground looks cared for: tufts catch the window spill, a drift of one flower
colour runs along the fence, a woodpile leans against the side of the house. Look from the castle and the town is
flowered and gardened, with woods gathering on the slopes, a treeline beyond the newest street and crowns notching
every far ridge against the gold. Aim for the landscape care, readability and composition of the genre's best crafted worlds. Existing Chatdom screenshots are regression evidence, never the artistic ceiling. The small sprinkle never turns to noise in the thumbnail or on a phone; every frame keeps calm meadow
between drifts. No uniform carpets, no confetti flowers, no lollipop trees on sticks, no straight rows of anything,
no piece floating on a slope, no pop as you walk. Trees are soft and round; their trunks show only below the crown.

## References

- `work/references/voxel-meshing-light.md`: real occupancy, AO and the production material; detail is not noise.
- `work/references/sky-fog-time.md`: fog and aerial perspective hide the far fade; no new environment pipeline.
- `work/references/settlement-streets.md`: plan against the natural landform, which is how woods find crests.
- `work/references/living-ground.md`: main-reviewed source/license study for coherent tree skeletons, LOD silhouettes and anchored wind; clustering is our landscape composition, not an upstream implementation claim.
The central research owner supplies the living-ground note. No imported tree-generator code or external asset
may appear without its precise license and main's THIRD_PARTY credit. Our authored voxel forms remain original.

## Not now

Owned elsewhere or not part of this lane: the terrain's own shading and grade, the street layout and where the tree
zones lie (kingdom-land), water, shore foam, reeds and lilies (places-water), sky and lamps (kingdom-light); the
places (pier, mill and bridge, campfire clearing, Lookout Hill, castle court, the stile, waymarker and gathering
spots) beyond the trees and cover around them; gathering, berries and mushrooms; seasons and snow; trees chat plants
with channel points; benches, gates, stiles and anything sat on or opened.

## Decisions

- **2026-10-30 — Placement is a lane-owned pure plan; the integrator owns the mount call.** The lane delivers the plan, the
  instanced mount and the wear sampler; the integrator composes their consumers into scene.ts and the terrain worker; main reviews the candidate.
- **2026-10-30 — Complement, never duplicate.** Garden-edge fences/walls, pots, troughs, rocks and shrubs stay in
  spec 06; carts for goods, benches and lamps stay in spec 10. The lane may place spec 06 rocks and shrubs.
- **2026-10-30 — Every living form, one planter.** Every tree, hedge, shrub and cover form is authored here, and
  this lane alone plants landscape trees into kingdom-land's real zones/landmarks. Typed fixture zones live only in its isolated SIMULATED bench. Place lanes use the forms by name only where their place needs one (the court's pears).
- **2026-10-30 — The back fence is the tenure line.** World-Tree's moving back fence and tended meadow are drawn
  by this lane from `allowedDepth`, so growth is visible from the street behind.

- **2026-10-30 — Reviewed ownership replaces draft hunks.** Main freezes the actual landform/type exports; the
  team integrator alone composes scene/terrain calls. Isolated typed fixtures are SIMULATED. No guessed production
  land, core-tree fallback, or `?land=next` alternate world is a handoff dependency.
- **2026-10-30 — Surface and collision contracts are distinct.** Light blockers exclude passive cover; real solid
  trunks still collide. Ground exports wear/art hooks under its own folder; kingdom-light composes render changes.
- **2026-10-30 — Full source palette is validated narrowly.** Only this new collection's validator registration
  is writable here. Broad validator relaxation, new material IDs and shared schemas remain forbidden.
- **2026-10-30 — Draw budget counts rendering, not intentions.** Batching must fit the 48 added primary-draw cap
  with all required forms preserved. Report actual shadows/geometry bytes; escalate measured failure before changing scope.
- **2026-10-30 — Structural transforms are exact.** Garden/field/path blockers carry cardinal turns; a free-yaw
  visual crown/cover never creates a silently rounded blocker. Solid trees require a tested cardinal collision
  representation/proxy before production binding. Full crown bounds clear lots and the clearing's actual radius.
- **2026-10-30 — One authoritative placement plan.** `createGroundDressing` consumes the exact precomputed plan
  already used for blockers; no second RNG pass. Stable IDs and lot tags keep growth/build toggles local and
  host visibility updates synchronize geometry, collision and light rather than merely hiding the mesh.
