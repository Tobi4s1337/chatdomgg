# 56 — Grand kingdom: a whole landscape, the same people's homes

Frozen by chatdom-main · 2026-11-01 · Astra xhigh architecture, Sol high review.
Implementation lane: `grand-kingdom`, GK10 + GK11. This spec covers the whole requested kingdom;
those tasks are ownership boundaries, not reduced product versions. The first core here is the
world/render seam and its executable identity/support proof. It does not claim the renderer is built.

## Result and scope

A Genesis-seeded landscape worth orbiting: mountain ranges, exposed strata and slope-sensitive snow,
cliffs, river basins, waterfalls, coast and sea stacks; species-distinct forests and patchwork fields;
a castle on its rock, streets and tenure quarters, a walled town, harbour, windmills and landmarks;
voxel clouds, golden-hour shadows and the accepted indigo/warm-window dusk. It has tens to hundreds
of millions of represented terrain cells while the frame draws only the detail the camera can see.
The same homes, Forge parts, citizens, moments and raid arrivals inhabit it.

`/-/grand` is an independent entry. Current kingdom, stream, room, API and authored channel views
keep their accepted appearance and behaviour. The lane owns `apps/web/src/grand/**`,
`packages/world/src/grand/**`, additive voxel/render modules and its evidence. Main owns shared
schemas, adoption, exports and current-view integration. This architecture owns only
`packages/world/src/land-interface.ts`, its test, this spec and its reference note.

Read with `ChatDom.md`, `Quality.md`, Art §§6/13/15, Tech §§8.5/9, World-Tree §§5/8 and Moments §1.
The reference images set ambition; Chatdom's clay, real homes and light set the identity.

## Frozen local seam

Exported from `@chatdom/world`; implementation lives in `packages/world/src/land-interface.ts`.
No parallel shared DTO or content dependency is added:

```ts
createKingdomLandInterface({
  scene, // already validated RealmFoundedScene; immutable installed snapshot
  ground: { layoutRevision, collisionRevision, sample: (x, z) => Vec3 | null },
  collision, // optional CollisionWorld for the installed physical region
});
```

`LandGroundSource` reuses the scene's revision types. `KingdomLandInterface` returns:

| Field | Meaning and consumer |
|---|---|
| `scene` | Exact installed `RealmFoundedScene`: plan, public blueprint hashes, ordered voxel operations, placement origins/cardinal turns and fitted parts. Never regenerate from `plan.config`. |
| `groundAt(x,z)` | Physical exterior top in **world metres**, or null. Rejects non-finite results and changed X/Z. No extrapolation from far scenery, water or smoothed LOD. This is not an indoor multilevel query or walking permission. |
| `collision` | Optional exact `CollisionWorld`, including structures/carves and known-space barriers. Scene, ground and collision revisions must agree. |
| `paths` | Original `plan.nodes`, `streets`, `activeStreetIds`, by reference. No alternate render navigation graph. Inactive reservations remain inactive. |
| `forge` | Original market square, existing `foundedAnvilPosition(scene)`, and nullable approach. An approach requires matching physical ground, support and whole-body clearance. |
| `moments` | Nullable supported plaza and castle-gate positions from real plan nodes. Visual anchors do not authorize an interaction. Other spectacle anchors come from installed content, never imagined roof centres. |
| `light` | Original plan/assets/placements for `foundedContent`, windows and light-field occupancy. Join `placement.plotId` to `plan.homes[].id`, then use the actual slot. A fitted chimney is not another citizen light. |

The facade preserves identities and checks revision agreement; it is **not** a substitute for
`decodeFoundedScene`/`validateFoundedScene`, verified geometry hashes or collision-producer tests.
The producer promises immutable ground for these revisions. Changing physical coverage replaces the
facade and requires the movement integration's installed-world handshake. Scene data is caller-owned;
only the facade is frozen. No client sampler can grant authority by choosing matching revision numbers.

All boundaries use +Y-up metres. Source lattices remain terrain **0.5 m**, builds/Forge **0.125 m**,
avatars **0.0625 m**, with **32³** source chunks. Chunk coordinates are integers and negative positions
use floor division. A 16 m terrain chunk, 4 m build chunk and 2 m avatar chunk are different things.
Rendering LOD changes representation, never source units or authoring precision.

### Identity and growth invariants

A lot centre is not a blueprint origin. Preserve each installed `placement.position`; when the
producer fits a deeper approved home, `homeOrigin(plot, depthMetres)` moves the origin back and leaves
the facade/door at the same frontage. Use the exact new founded-geometry hash and refitted attached-part
transforms. Never recompute a replacement from its home tier, variant or asset display ID.

There are currently **two hash namespaces**, despite both fields being named `assetHash` in places:
founded assets/placements use `assetHashOf(blueprint)` over sorted canonical JSON; public HOME's
ownership/Forge digest uses SHA-256 over `JSON.stringify(VoxelBlueprintSchema.parse(blueprint))`
in schema field order. They must not be compared as equal. The browser verifies an explicit mapping
from each loaded blueprint's ownership digest to its founded content hash before matching a HOME
receipt to installed geometry. Keep that mapping at the adapter boundary; the seam carries the exact
scene hashes. No guessed digest conversion and no wire-contract change are authorized here.

Ground and node elevations must include actual paving/slab tops. A plan point under a slab is not
supported just because a smoothed renderer height looks plausible; a null approach correctly exposes
that producer error. The current Forge helper retains its installed origin-relative market frame;
moving the square requires updating the authoritative placement/interaction producer, not a renderer offset.

The existing HOME and GROWTH messages refer to the same committed fact sequence, followed by the SSE
revision closure. The entry-owned ceremony queue waits for that verified target geometry and claims a witnessed
ceremony once. Grand's render preparation must not consume a ceremony while hidden, restart it on
LOD changes, or apply a growth shell as persisted geometry. After an interrupted install, keep the
last valid scene and recover the current public checkpoint. This work changes none of that protocol.

## Data model: small source, bounded working sets

**One persisted landscape recipe** describes the world, separate from any render cache. In the lane's
`world/grand` module it contains the full channel/seed identity, generator version, selected Genesis
landscape and style-kit revisions, world bounds, a coarse drainage/composition graph, and immutable
terrain/vegetation parameters. Full broadcaster identity is the key; a 32-bit noise seed is not an
identity. Derive independent random streams from `(seedKey, featureKind, stable region coordinate)` so
adding flowers cannot move a river. Published compiler identity and parameter hashes pin generation.

**A canonical terrain field** combines height/strata columns with bounded additive/subtractive solid
patches where caves, arches, overhangs or authored edits require them. Empty air and solid interiors
are implicit. Resolve occupancy/material on demand into a 32³ chunk plus its one-cell halo. Do not
allocate a kilometre-scale dense volume or feed it through the blueprint rasterizer. A height-only
far representation is allowed only where its recorded error includes the omitted volumetric detail.

**Surface hierarchy**: fixed world-aligned tiles with bounds, material summary, maximum geometric
error, parent key and children. Fine render chunks are 16 m across; parents cover 32, 64, 128 m and
up with bounded samples/vertices. Parent data is derived from the same canonical field and approved
overrides, not a second noise terrain. Critical ridgelines, coast/water contacts and silhouette
features constrain simplification. Snow/material summaries cannot erase a mountain's snowline.

**Placement index**: reuse approved blueprint hashes, actual placement IDs, transforms and plot IDs.
Index in spatial cells (start at 64 m; split dense cells). Mesh caches key by
`(assetHash, materialRevision, lod, mesherVersion)`, never just blueprint ID. Instancing groups also
carry spatial cell, pass and relevant material state. Species/variants share their authored geometry;
wind phases derive from stable placement IDs. Windows remain independent instances tied to plot slots.

**Physical pages**: immutable loaded occupancy/terrain chunks, exact structures and interaction
registries for an installed revision. These have their own residency policy. Camera altitude does not
unload the floor below a walking person, and a far surface never becomes a collider. Querying a missing
physical page is blocked/unknown until the server and client have installed matching data.

**Presentation state**: visible tile selection, worker requests, GPU allocations, shadow/reflection
sets, window texture and fades. Disposable and reconstructible; no source-of-truth ownership, names,
Forge wishes, moderation receipts, or draft voxel edits enter the public landscape recipe.

## Generation and composition

1. Choose large structure from the actual Genesis recipe: coastline orientation and islands, mountain
   spine/saddles, catchments, settlement reserve and castle rock. Author compositional constraints,
   not just noise amplitudes. Preserve a readable castle/town silhouette from several orbit angles.
2. Solve drainage on a bounded coarse regional grid (priority-flood basin treatment then downhill
   drainage/flow accumulation). Cut channels before cosmetic noise. Connect river reaches to an
   outlet or an explicit lake; waterfalls join a higher reach to a lower reach with an actual drop
   and receiving pool. A water sheet does not invent a basin or hide unsupported land.
3. Apply stratified rock bands warped at geological scales, then erosion/ridge detail at successively
   smaller scales. Snow depends on altitude, slope and exposure; cliffs retain exposed rock. Keep
   large colour masses and shelves legible; per-cell random colours destroy both taste and merging.
4. Fit settlement/roads before vegetation. For already adopted worlds, the installed settlement and
   its physical terrain are fixed constraints: blend the surrounding new land to their boundary,
   retaining exact support at lots, active streets, castle and Forge. Do not scale the town to fit.
   For newly founded grand worlds, solve layout and grading together before adoption; keep full future
   lots and tenure-quarter exits dry and accessible. Roads follow traversable grades, bridges are real
   structures, and harbour levels/quays are justified by the water/shore solution.
5. Place species by altitude, slope, moisture and authored grove patterns; enforce clearing masks for
   lots, roads, gates, rivers and sightlines. Gold broadleaf, pine, cherry and native fantasy species
   differ in trunks, branching and canopy silhouette, not just hue. Fields follow usable terrain and
   property boundaries. Stone courses, roof accents, banners and landmarks carry the style kit.
6. Generate candidates and judge fixed hero/street/waterline/silhouette shots. The four proof kingdoms
   are tobi4s_, The_AGGman, PinkKittyRose and MashaD4. Compare geometry and composition as well as colour.
   A category changes a place through approved recipes; it does not put unjudged text/art into it.

Existing authored models, accepted AS10 avatars, dusk exposure, indigo fill, warm ground pools and
beacon survive the move. More terrain cannot justify replacing them with generic cubes. An empty
lot is a tended reserve, not a fake resident. Simulated profiles/crowds remain visibly SIMULATED;
real presence is never invented to fill the wide shot. Seasonal dressing does not reroll the land.

## Hot paths and bounded work

**World installation:** validate receipt/assets → prepare physical region and interaction graph →
prepare the first visible land/settlement set → install one coherent revision. Stream distant tiles
through workers afterwards. Retain the previous valid scene on an error; no partial home/part swap.
A changing physical revision and a changing camera LOD are separate operations.

**Camera update:** hierarchical AABB/frustum selection → projected-error LOD selection → spatial
instance culling → opaque front-to-back submission. Recompute streaming requests when the camera
crosses a tile/LOD threshold, with velocity-based lookahead and shot preload. Reuse arrays and indices.
Per-pass selection is separate for main, water reflection and shadows. A main-camera culled tree may
still cast into the shot or reflect in the sea. Conservative CPU culling is the portable baseline.
GPU culling is an optional measured backend; WebGL2 has no core compute/indirect draw equivalent.
Never wait synchronously for a visibility result or make experimental extensions mandatory.

**Worker work:** generate/sample → material/sky/halo → greedy/continuous surface meshing → transfer
owned results → bounded GPU installation. Priority order is current edits/approaches, upcoming shot
and silhouette gaps, current visible detail, warm neighbours, background refinements. Use the existing
1–4-worker pool with a bounded queue; start at `min(4, max(1, hardwareConcurrency - 2))`, at most 64
waiting chunk jobs and a **16 MiB total queued/result-byte cap**. A queue count alone is not a memory
bound. Reserve slots for edits and do not enqueue a full landscape up front. For large assets split
work into chunk jobs: current whole-blueprint jobs are suitable for small props, not huge castles.

Every job carries generator/source/material/halo revisions and request generation. Discard results
for evicted or superseded tiles; return/reuse buffers. The pool already checks mesh stamps and supports
external `isCurrent`; extend locally where the grand generator needs additional keys. Off-thread
work cannot transfer away authoritative collision storage. Load halos from the same field/overrides;
a border edit invalidates every neighbour whose halo reads it, including diagonals.

**GPU installation:** limit both bytes and elapsed CPU time per frame; retain the old patch until its
successor plus required edge data is complete. Stage large payloads in subranges across frames.
Four-byte-align GPU attribute offsets and strides, including mixed packed integer inputs; a passing
software screenshot cannot prove that layout on a physical GPU. Dispose superseded resources after
fades. Cache by bytes, use a 1.5-tile unload margin and 2-second retention, and evict cold detail before
parent coverage. Never evict the last covering surface to make space for its unfinished children.

## LOD, continuity and shadows

Use screen error, not distance alone: `errorPx = errorMetres * projectionScalePx / nearestDepth`;
`projectionScalePx = viewportHeight / (2*tan(verticalFov/2))`. For orthographic shots use the actual
pixels-per-metre. Intersecting the near plane requests finer detail. Bounds include wind and effects.

Terrain targets start at **1 px** high, **1.5 px** laptop, **2 px** phone/software. Refine above 1.2×
target; coarsen only below 0.8× for 0.5 seconds. Require a ready parent/child group and balance adjacent
levels to at most 2:1. Shared world-grid boundary samples and a transition band (at least one parent
cell) morph the fine edge onto the actual parent surface. Normal/material interpolation must match
as well. Use boundary-locked simplified volumetric patches for cliffs/arches; naive height downsampling
cannot preserve their silhouettes. Test wet edges and opposing cliff faces explicitly. Skirts may be
hidden insurance below opaque ground, never the sole seam solution visible from a harbour camera.

Homes use existing factor-2/factor-4 render meshes plus district proxies at distance, preserving exact
asset origin. Full detail starts at 40/30/20 m (gaming/laptop/phone), also pinned for the selected home,
Forge action and director close-up. Reject a coarse roof if its measured silhouette error exceeds the
pixel target. Conservative occupancy reduction can close doors: it must never replace collision,
window anchors or a close interaction view. Fade representation with complementary object-stable
coverage over **0.4 seconds**; budget both meshes and keep opaque depth. The dither pattern must be
stable under camera motion, and identical geometry is not drawn twice at full opacity. Tree canopies
retain species silhouette and approximate coverage; far forest patches retain gaps and colour masses.

District proxies bake geometry/albedo/occlusion, **not live window state**. Draw window points/cards
from the same real slot texture with bounded pixel size, fading into a presence-derived district glow
below readable size. A shader cannot turn a physically distant one-metre window into a giant star.
Use stable light selection with hysteresis and fades; camera sorting must not abruptly exchange lights.

The existing `createSunShadows` is a cached bounded-settlement map, not a grand-world cascade system.
Add a grand shadow owner: near stable receiver region (start 128 m / 2048²) plus far region
(start 512 m / 1024²), texel-snapped with bounded overlap and continuous receiver blend. Fit each to
its receivers and all potential casters along the light, not simply the main frustum. Cached far maps
refresh for source/sun/region changes; changed near casters refresh as required. Choose shadow LOD
from **shadow texel error**, normally factor 4 or a dedicated silhouette proxy, independently of
colour LOD. Avoid storing camera-culling transforms in the shadow owner. Sun changes interpolate
between valid cached results or refresh before the receiver changes; never leave visibly stale light.
Farther terrain gets coarse baked sky/horizon occlusion. Phone/software keep contact AO and sky
shading without a shadow map. Map detail/features change at a cut/loading transition, not during an orbit.

## Water, atmosphere and presence light

One environment owns sun direction, sky, grade, fog, sea response and all time-of-day uniforms.
Preserve the accepted HDR stack and one tone-map/output conversion. Baked AO/sky and the voxel light
field establish clay depth; any existing optional post contact effect is supplemental and budgeted,
not a reason to discard offscreen occlusion. No per-window realtime point lights or full-world flood.

Reuse canonical shore/depth/flow fields for coastal colour, foam and river/waterfall joins. Separate
water surfaces from solid occupancy. One dominant planar reflection is enough per frame; select actual
reflecting surfaces, cull with the mirrored camera and lower reflection geometry/shadow detail. Smaller
waters use the common sky and analytic warm-light pillars. The windows remain visible on weaker tiers.
Start high reflection at 512² and 15 Hz, changing only with a measured visibility/motion need; never
redraw the entire 6M-triangle frame for each pond. No synchronous GPU height readback for gameplay.

Voxel clouds are authored volume silhouettes, meshed/instanced in bounded groups with coherent drift,
not tens of thousands of independent transparent cubes. Aerial perspective cools distant mountain
layers but never disguises a missing horizon. Keep golden shafts restrained and bloom source-sized.
The light-field working set stays camera-local (0.5–5 MiB), uses exact near occupancy/attachments,
and swaps revision-matched volumes with stable blending. Presence updates touch window/light data;
they do not regenerate terrain, rebuild buildings or invalidate static shadows.

## Budgets and acceptance measurements

These are initial **implementation limits and measurement targets**, not performance claims. The
reference's reported 5–6M visible quads means roughly 10–12M triangles before other passes; copying
that submission cost would contradict our device budgets. Count source cells, decoded cells, unique
resident mesh bytes, submitted triangles and all-pass draws separately. At current packed 8-byte
vertices plus uint32 indices, an unshared quad costs about **56 bytes**; 19M quads would exceed 1 GB
for geometry alone. Greedy meshing, LOD and instancing must reduce the actual resident workload.

| Budget | Gaming / high quality | Everyday laptop | Phone | OBS | Software interactive |
|---|---:|---:|---:|---:|---:|
| Frame target | 60+ fps | 60 fps | 30+, 60 sustained if possible | 1080p60 beside game | no fps claim |
| GPU time target | ≤10 ms | ≤12 ms | ≤20 ms | ≤4 ms | instrument pacing only |
| Internal pixels | ≤2.1 M | ≤1.45 M | ≤0.85 M | 75–100% linear 1080p | ≤0.5 M |
| Main-view triangles | ≤3 M | ≤1.5 M | ≤600 k | ≤1.25 M | ≤250 k |
| Whole-frame triangles, including shadows/reflection/fades | ≤6 M | ≤2 M | ≤800 k | ≤2 M | ≤350 k |
| Whole-frame draw calls | ≤500 | ≤300 | ≤150 | ≤250 | ≤100 |
| Owned GPU resources, including all targets | ≤512 MiB | ≤256 MiB | ≤128 MiB | ≤256 MiB | ≤96 MiB |
| CPU decoded terrain + meshing working set | ≤128 MiB | ≤64 MiB | ≤32 MiB | ≤64 MiB | ≤16 MiB |
| Total tab target | ≤1.5 GiB | ≤1.2 GiB | ≤768 MiB | ≤900 MiB | ≤512 MiB |
| Mesh install per frame, bytes and CPU (first limit wins) | ≤2 MiB / 1 ms | ≤1 MiB / .75 ms | ≤.5 MiB / .75 ms | ≤.5 MiB / .5 ms | ≤.25 MiB / .5 ms |

High-quality GPU allocation: opaque terrain/building/forest draw ≤5 ms, shadow updates ≤1.5 ms,
water/reflection ≤1 ms, post/atmosphere ≤2 ms, ≥.5 ms reserve. Main-thread grand selection/update
≤1 ms and installation ≤1 ms leave CPU room for the existing app, characters and input. Profile
p50/p95/p99; no normal frame above twice its device interval. Worker p95 per 32³ mesh target ≤8 ms,
visible edited chunk ready ≤50 ms including queue/transfer; report misses rather than declaring that
old prototype timings satisfy these targets. Frame draw counts include fallback multi-draw calls.

At least 25% of geometry/cache budgets is reserved for in-flight replacements and fades. CPU totals
include transient clones, halos, result queues and collision data, not just typed arrays still in a
cache. Keep compressed CDN/disk cache separate from decoded resident state. A 118M-cell source need
not exist as a 236 MB Uint16Array; source count is not permission to allocate one.

Network targets for grand additions: compressed versioned recipe/manifest ≤256 KiB; initial visible
terrain/landmark additions ≤4 MiB on laptop (≤2 MiB phone), with the installed settlement budget
reported separately; hard cap 4 asset requests and 8 MiB pending compressed bytes. Aim for designed
loading within 1 s and explorable loaded settlement within 5 s on a normal laptop connection.
Generate untouched far terrain locally or fetch immutable pre-baked tile artifacts by hash;
prefetch upcoming director shots, cancel stale demands, and reuse content across visits. Land/sky
has **zero per-frame network traffic**. Do not serialize procedural voxels into realtime patches.
Existing presence/world transport and room interest limits remain separately measured; no new public
network schema is introduced by this core.

Quality governor measures CPU/GPU pressure separately. Dynamic resolution adjusts the viewport inside
preallocated targets, with hysteresis; quality features change at cuts/loading. Drop distant sampling
cost, reflection rate, shadow cost and particles before clay/window readability or the horizon. Check
actual accepted post-target memory: its high mode alone can own ~160 MiB. Software quality is a
coherent lower-cost composition, not an all-features-at-full-resolution fps assertion. High-detail
software still captures may run slowly for visual evidence; that is distinct from interactive quality.

## Production adoption and scale

The current public scene validator accepts **landform v1 only**; the founded terrain compiler limits
its footprint to **32 × 16 m per axis**. The existing scene also caps homes at 4,096. Expanding a bounds
number, attaching `genesisSurface`, or passing a custom height function does not upgrade those contracts.
`/-/grand` stays honest: orbit works independently; walking/interactions stay disabled outside a real
loaded supported region. It never labels an unadopted generated scene as an authoritative live kingdom.

The concrete adoption work for main is a versioned public scene/manifest extension binding the landscape
recipe/artifact hash and generator/physics compiler identities into the same validated scene receipt.
Server and client resolve the same canonical physical samples and exact reviewed placements. Install
collision pages and registry before acknowledging that world revision; reconnect rejects mismatched
compiler/hash data. Preserve settled IDs, frontage, citizen history and attachments during migration;
new mountains fit around adopted support. Checkpoint/replay includes the landscape identity, not its GPU cache.

The collision service must grow to a sparse page index: query the pages intersecting the swept body,
combine structures minus carves, and return barriers for unknown pages. Do not union multiple current
`compileCollisionWorld` instances: each treats the exterior of its own region as solid. Reuse its
cell/structure rules inside a dispatcher that owns the overall known-space boundary. Keep a movement
lookahead/preload margin and pin the current floor, route and recovery destination. Physics residency
follows authoritative interest, not render LOD; the exact outside boundary and loading response are
visible to the client. Cross-region walks and recovery need paired-client/server tests before enablement.

Capital geography extends append-only quarters with stable allocations, not a larger monolithic
bootstrap. Shard public scene assets/indexes by district while retaining globally stable plot/placement
IDs and a root version/hash; version the current 4,096-home/byte limits deliberately. Presence-window
textures and district proxies allow 15–25k homes without 15–25k characters. The current authoritative
room remains one writer with its existing approximately 1,000-walker / 5 Hz constraints. Renderer
capacity is **not** room capacity. Larger physical populations require interest-managed region services
under an explicit authority contract; do not manufacture walkers for every chatter. Real people remain
real people and a few plainly identified keepers remain the only townsfolk.

### Main-owned adoption core: physical page boundary (2026-11-01)

The first migration core is `packages/world/src/grand-adoption/pages.ts`, behind the existing shared
`CollisionWorld` interface. This is an internal implementation seam, **not** a second public manifest,
an adopted grand realm, or a change to today's scene/compiler. Its local index exports are awaiting
main's review; no current realm or renderer consumes it yet.

Prior art remains the existing [grand streaming study](../references/grand-world-streaming.md) and
[voxel walking study](../references/walking-voxel-worlds.md). Reinspection of the referenced MIT
`webgpu-voxel-engine/src/world/chunk-manager.ts:56–74,302–325` confirms independent bounded pools and
stale-job rejection, but also missing-neighbour-as-air rendering. We retain the bounds/revision idea;
physical unknown space must remain solid. No upstream code is copied into this core.

**Data model.** `PhysicalCollisionPage` has an integer XYZ page coordinate, the installed collision
revision, and already resolved world-space solid boxes clipped to that page. A page is **16 m cubed**,
matching a 32³ terrain source chunk, while contained build/Forge geometry keeps its original precision.
The page grid uses the settlement's existing world frame, including negative coordinates. Empty loaded
pages mean known air; omitted pages mean unknown solid space, at every height. Solids are immutable
copies and exactly repeated boxes are deduplicated. The constructor rejects duplicate page addresses,
mixed revisions, nonfinite/inverted boxes and boxes crossing their declared page boundary. A producer
must split a crossing solid without changing its occupied volume; it must resolve ordered writes,
air carves and placement transforms **before** handing solids to this dispatcher.

**The important separation.** This dispatcher owns unknown-space barriers once. Its input cannot be
a union of independently compiled `CollisionWorld`s: those worlds include their own exterior walls.
The eventual page compiler must reuse the existing ordered-write/material/cardinal-transform rules
as raw interior-solid production, then partition those solids. The focused test extracts interiors
from one existing compiler over its complete known region; that is test setup, not the proposed
large-world production compiler. Terrain generation and rendering remain grand-lane ownership.

**Hot query.** Floor-divide query minima and ceil-divide maxima by 16 to address half-open page ranges.
Check the entire page count before enumerating; then inspect only addressed pages, emit their actual
intersecting solids or full missing-page barriers, and sort by all six box coordinates. Input ordering
cannot affect motion. An exact maximum on a page edge does not include the neighbouring unknown page.
Degenerate queries return no intersection; malformed queries throw. Oversized queries return one
conservative box covering the query before unbounded enumeration or scanning can happen. This follows
the current founded collision query's conservative overload convention.

**Initial implementation bounds and budgets.** Each immutable working set admits at most **4,096 pages**
and **65,536 input solids**; a query visits at most **64 pages** and examines at most **8,192 solids**.
Those are local guards, not new wire contracts or kingdom population limits. The current dispatcher
scans each addressed page's solids; it is intentionally not a claim that the movement hot path now
meets a frame budget. Target page-query p95 **≤0.25 ms** within the existing movement budget; measure
the doorway/dense-house route before integration, and add a page-local broadphase when needed without
changing page ownership or unknown-space semantics. Large route queries must divide their work;
they must not interpret the conservative overload box as empty land.

The maximum solids contain **3 MiB of numeric coordinates** before JavaScript object/array/map overhead;
installation also owns a copy while the producer input still exists. These are not measured heap bytes.
Reserve a **16 MiB laptop / 8 MiB phone** physical working-set target inside the existing decoded-terrain
budget, account for both installed and preparing revisions, and measure actual allocation before making
an adoption claim. No network messages or per-frame network work are introduced. Future page transport
shares the scene/manifest and pending-request bounds above; it must not serialize this JavaScript shape
as an unreviewed public protocol. Installation/compilation runs while preparing a revision, never in a
movement query or render-LOD change.

**Atomic installation and identity still required.** Creating a new dispatcher cannot mutate the old
one. All pages share its revision; the existing `stepPlayer` refuses a world whose revision differs
from the walker/input. The caller still owns preparation, registered interactions, the installed-world
acknowledgement, rollback and floor/route/recovery pins. Revision numbers alone do not verify a recipe,
page's provenance, or identical server/client coverage. This core deliberately does not mint authority.

Inspection of the current grand producers found a full `GrandLandSeed` and generated typed arrays,
but no validated immutable public recipe/compiler binding yet. Main must freeze that producer seam
before extending `RealmFoundedManifest`/scene validation. The root scene hash must bind the exact
landscape recipe or baked-artifact hash, generator/physics identities, and coordinate frame together
with the existing settlement geometry. Persistent adoption/checkpoint/replay and reconnect must verify
the same chain. Exclude generation timing (`stats.millis`) and disposable render caches from source
identity. Do not hash only the 32-bit noise seed, silently modify the v1 scene allowlist, or compare
HOME ownership digests to founded geometry digests.

**Preserving one kingdom.** The current grand seat says `settlement metres + offset = land metres`.
For live adoption, applying its inverse to the landscape keeps existing scene placements, doors,
plot slots, fitted parts, Forge targets, walkers and replay coordinates unchanged. A render-only seat
translation is not permission to rewrite those records. Grade around exact adopted support first;
preserve scene/land-interface identities and light slots. Once the recipe and raw interior page
compiler are frozen, main can install verified sparse coverage, then connect the same landscape to
walk and stream consumers under their existing revision handshake. This replaces the surroundings
of the real realm rather than creating another realm with copied homes.

**Focused proof.** One invariant test, `grand-adoption/pages.test.ts`, uses the existing voxel compiler
to resolve a wall and its ordered door carve. Server/client dispatchers receive reversed page/solid
order; existing movement crosses the actual doorway at X=0 with identical states, the adjoining wall
blocks, and missing land at X=16 stops the whole body. It also checks negative and exact half-open edges,
huge-query bounded fallback, mixed/duplicate/misplaced-page rejection, immutable preparation of the
successor, stale-revision movement hold, resumed walking after matching installation, and copied input
geometry. This does not demonstrate networked page installation, ground sampling, migration of a
persisted citizen record, or a real-GPU/frame target.

Core check evidence: `pnpm exec vitest run packages/world/src/grand-adoption/pages.test.ts` passes
**1 test**; scoped ESLint passes. The repository typecheck reports no adoption-core diagnostic but
is currently blocked by `growth-history/scene.test.ts:30` accessing `plotId` on the civic milestone
variant; that separate owner's file was not changed here. No capture, service or Git command was run.

**Handoff.** Main owns the reviewed export and public identity/adoption extension after the producer
exists. The grand builder supplies versioned reproducible land artifacts and support-preserving frame
data; the physics builder extracts raw compiled interiors, spatially indexes them and supplies identical
verified page sets on both ends. Integration then proves a real saved home/Forge part, door, citizen and
growth receipt survive a landscape adoption and reconnect. Artisans continue existing terrain/composition
work against the same immutable seat; this core requests no new visual surface.

## Build partitions and review evidence

The existing grand lane implements both tasks; do not reopen other lanes for this architecture.
Order within its work is dictated by dependencies: canonical land/composition and cost diagnostics;
worker meshing/hierarchical coverage; stable light/water/shadows; installation of the exact settlement;
then the existing social consumers and shot/growth continuity. Each checkpoint keeps the entry usable.
No checkpoint reduces the requested landscape/community scope.

| Owner | Concrete next work and proof |
|---|---|
| Grand builder, GK10 | Implement the field/region hierarchy, scheduler and render owner above. Prove deterministic generation at negative coordinates, bounded residency after a complete orbit, stale-job rejection, border agreement and LOD reversals without gaps. Instrument all-pass costs and memory. |
| Grand builder, GK11 | Consume this seam with installed assets/IDs; grade around exact support, mount accepted homes/castle/Forge/avatars and real channel-specific content. Prove no shifted door/attachment on growth and no unsupported path/interaction. |
| Grand artisans | Species silhouettes, rock/snow strata, river mouths/waterfalls, harbour/fields, castle-town scale and the four channel compositions. Preserve accepted palette/dusk. Fixed hero, street, coast and dusk images for each, then moving LOD/shadow review. |
| Main | Review/freeze/export seam; integrate schema/adoption/physical paging and native growth queue as separate tested changes. Do not infer these exist from the orbit view. |
| Checker / device owner | Noon/golden/dusk/night, 1440×900 web, 390×844 phone and 1920×1080 stream; orbit through all LOD boundaries, street/door/Forge route, growth with fitted part, context loss/reconnect and 6-hour OBS soak. Real GPU frame percentiles and whole-frame costs. |

Capture one still/short clip per shared-lock acquisition, then release so other work proceeds. Respect
reserved service/capture ports; this architecture starts no service. Keep before/after views of the
same kingdom/camera. Diagnostics must expose source versus submitted geometry, active workers,
queue/result bytes, mesh uploads, cache eviction, draw counts, each pass cost and selected quality.
Visual sign-off requires viewing the images, not just saving them. Software fps is never GPU evidence.

## Decisions and why

- **Large render domain, exact installed settlement.** Preserves belonging, saved builds and current live
  integrity while making the whole landscape visible. It also gives a clear production migration path.
- **Compact canonical source + surface hierarchy.** World scale is cheap when air/interiors stay implicit;
  the hard costs are visible surfaces, passes, transfer and residency. Avoid paying for all source voxels.
- **WebGL2 baseline with CPU culling.** Matches current stack, OBS and weaker devices. GPU culling can help
  when measured, but cannot be the unimplemented prerequisite for a beautiful working scene.
- **Error-bounded LOD and independent shadow detail.** Distance rings alone lose spires and cliffs;
  full-detail shadows consume a frame even when the camera never sees the casters.
- **One public identity chain.** Geometry hashes, stable plot slots and immutable revisions connect the
  renderer, doors, Forge, growth, presence and replay. An impressive independent scene cannot replace it.
- **No rendering rewrite in existing views.** The new lane can demonstrate its costs and its look without
  undoing accepted light/models or interrupting the growth integration currently being captured.

## References, evidence and doubts

- [Grand world streaming study](../references/grand-world-streaming.md): bounded source/resident work,
  stale-job handling, continuous surface transitions, portable batching and visual reference judgment.
- [Voxel meshing and light](../references/voxel-meshing-light.md): AO merge keys, real halos, independent collision.
- [Settlement streets](../references/settlement-streets.md), [organic towns](../references/organic-towns.md):
  street/lot planning and append-only tenure. [Water](../references/water.md),
  [sky/fog](../references/sky-fog-time.md), [post](../references/post-stack.md): retain established techniques.

First-core evidence: `pnpm exec vitest run packages/world/src/land-interface.test.ts` passes **2 tests**;
scoped ESLint and repository `pnpm typecheck` pass. The fixture goes through real asset hashing/public scene
validation, retains exact home/published-attachment transforms, proves the front-door invariant across deeper geometry, rejects stale ground and
collision, and demonstrates unknown ground outside a 64 m physical region even with a 9 km query.
It also rejects buried/unsupported targets, invalid samples and missing body clearance. The attachment
position is deliberately constructed; this is not proof of Forge refitting, provenance or entitlement.
Existing native-growth/Forge tests own those proofs. The public export is in `packages/world/src/index.ts`.
No renderer, captures, room scaling or 60 fps claim is implied by this seam test.

Open engineering risks: watertight LOD around volumetric cliffs and shorelines; district proxies that
preserve window identity under changing presence; long golden shadows at steep camera angles; float/
integer attribute correctness on physical GPUs; actual 4 ms OBS cost beside a game; and the schema/
collision migration that makes the distant place genuinely walkable. These need the specified lane
and main proofs, not a larger synchronous generation demo. The missing research markdown was not used.
