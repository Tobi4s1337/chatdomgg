# Spec 30: the castle court, Lookout Hill and forest edge

Status: **frozen 2026-10-30; dependent consumers wait for the actual inputs below.**
Independent content and isolated fixture benches can start. This is not a claim that neighbouring lane exports exist.
Vision: `chatdom/ChatDom.md` §5 and principles 2, 8–10, 16–18; `chatdom/Artstyle-Soul-Feel.md` §§1–2, 6, 13, Decided;
`chatdom/Moments.md` §5; `chatdom/World-Tree.md` §§3, 5–6; `chatdom/Quality.md` rules 8–11 and world slop list.
Ownership: `work/lanes/kingdom-look-owners.md`; this replaces the provisional the submitted draft ownership table advice.

## What and why

Three places reward the walk and make the kingdom a home. Through the gatehouse, a generous court leads to worn keep
steps and two tall standards. From its parapet, actual lit windows become the people a citizen knows. Across the lake,
a wind-bent pine marks Lookout Hill: a bench, stone cairn and brass telescope frame the town like a postcard. At the
forest edge an elder oak marks the way under tall trees to the campfire, the warm room beyond the last street. Each
place can be found by its silhouette, enjoyed on stream and visited by walking. None needs a pretend resident to feel
alive. The lane authors what stands there, cloth and the two view calculations; main decides land, and the integrator
binds input, people, cameras, collision, sound and the existing campfire.

## Current state

- `packages/world/src/settlement/castle.ts:createCastlePlan` currently places the keep at `[-16,20,-80]`, gatehouse
  at `[-8,20,-46]`, front curtains `castle:front:0|1` at x −20/8, z −39. The court is 40×12 m, x −20..20,
  z −48..−36, elevation 20. A 40×24 m court and moved keep are proposed land changes, not today's geometry.
- `packages/content/src/core/index.ts:createCastle` contains the existing keep stair and two small banners;
  `core/castle-modules.ts` supplies towers/gatehouse/curtains. `apps/web/src/kingdom/castle-content.ts` enforces
  module dimensions and creates the common geometry/shadow/occlusion placements. A 1.75 m parapet cannot silently
  replace a 10 m curtain through that dimension-checked factory.
- `apps/web/src/kingdom/settlement-content.ts:Dressing` carries blueprint, position and yaw. Scene composition,
  instancing/LOD, blockers, collision, lights and input are separate paths; adding an extra field does not wire them.
- `packages/render/src/presence-lights.ts` yields lit sources with nullable names; `kingdom/visibility.ts` can test
  actual window occlusion. These are the inputs for views, never a right to query hidden owners or fabricate presence.
- `apps/web/src/citizens/capes.ts` demonstrates a thin cloth shader sharing `VoxelRenderState` uniforms. It is a
  pattern to read, not a seekable banner API. `packages/content/src/civic/heraldry.ts` supplies arms/crest source.
- Shared voxel rules fix build cells at 0.125 m, avatar cells at 0.0625 m and build asset dimensions ≤256 cells.
  `packages/content/src/catalogue.ts` now registers `places-high` with its dynamic path; content arrives from this lane. `packages/world/src/kingdom-land/types.ts` now freezes `KingdomLand`, `LandPlaces`, cardinal `LandSite` and
  view/path types, exported type-only by `@chatdom/world`. There is no installed land-place generator,
  ground-dressing form library, people-light helper or campfire mount in this checkout. Spec 21 is the campfire
  agreement; its implementation must be read when available, never guessed from draft calls.
- Existing anvil-hero owns the hero anvil and sleeping dragon. Existing homes, public names and citizen light rules
  remain authoritative; a change of terrain generator is not permission to move anyone's dwelling.

## Rules

1. **R1 — Read from 60 m; reward at 2 m.** Court banners, the summit pine and elder oak mark the three places.
   Broad silhouettes, a few middle forms and useful small details form a 70/20/10 hierarchy. Richer cloth sits inside
   quieter stone and vegetation. Every place has a real seat facing its best view and a name/text plane supplied to
   the host. No giant sign, saturation patch or spotlight rescues a weak landmark. Old stone/wood has deliberate
   wear, sag and repairs; straight formal castle axes remain deliberate.
2. **R2 — Scale to the actual citizen.** Match the current avatar rig before freezing seats, eyepieces or cameras;
   the draft's competing 1.25/1.4 m eye assumptions are not a new avatar contract. Seat height about 0.5 m, lean sill
   about 0.875 m, telescope eyepiece at the real standing eye. Use 0.125 m props, registered material ramps and actual
   production meshing/shading. Every occupied piece has a path of support to its declared foundation or mount;
   actual openings/approaches remain clear. Colliders and usable surfaces match the drawn geometry.
3. **R3 — The court and the castle that crowns it.** On the supplied 40×24 m reserved court, author a broad keep stair within the light lane's
   released envelope, 13 shallow one-cell treads with gentle central wear, flared foot about 8 m wide, moss in shaded
   joints and seats along the cheeks. No one-cell hollow may erase the only walk support. Studded oak door leaves
   stand open inside the approved keep-door envelope. Place a terracotta-canopied well-head and existing civic
   crest plinth, plus two ground-dressing pear espaliers on the sunward curtain, using their real dimensions.
   The well is a place prop with an honest interaction anchor; no fake usable prompt.
   **The castle must stop reading as a grey box.** Own a sculpted architectural treatment in the lane's
   `castle-architecture.ts`: a deliberate keep/tower/gate silhouette, stepped roof/coping rhythms, deep stone
   reveals, strong corners, restrained buttresses and warm worn limestone variation in the registered kit.
   Prefer changes that read at 60 m over a thousand tiny scratches. Author a real replacement/dressed blueprint
   from the accepted core module, preserving its exact dimensions, supports, actual door/beacon anchors and
   light lane's openings/stair cuts. Do not replace it with an unrelated grey shell or cover a real window.
   These factories live in the owned folder; no core-file fork or extra all-opaque wall overlay. The integrator
   resolves their effective blueprints before creating content/blocker/shadow lists. Judge a market-distance dusk
   silhouette and a close stone/roof view. Banners and lighting complement the sculpture, not disguise a box.
4. **R4 — A crenellated brow.** Front parapet modules keep the supplied 12×3 m footprints, with sills about 0.875 m,
   merlons about 1.75 m, ≥1.25 m crenels, three 0.5 m benches facing out, lantern bays and a founding-night plaque.
   A seated eye must actually clear the sill. The land/host provides the load-bearing wall or raised walk below;
   no floating parapet cap, cliff-edge route or gap left by removing a 10 m curtain. Integrator replaces module
   geometry and blocker/shadow/collision entries together, preserving gate/tower joins and the castle silhouette.
   Resolve the replacement **before** calling the dimension-checking `createCastleContent` path: preserve the
   `castle:front:0|1` IDs and XZ origins, but provide the actual effective 12×1.75×3 m cap dimensions and correct
   support/walk elevation. Do not overlay a short cap on a retained 10 m solid or leave a fictitious 10 m blocker.
   The door join uses the actual authored sill/threshold anchor, never the keep AABB's front edge.
5. **R5 — These castle banners are cloth.** Own the keep's two ~2.25×8 m drops, gatehouse ~1.5×4 m drop and two
   7 m court standards. This is not ownership of every banner in Chatdom: civic/street/wardrobe/raid/Forge owners
   remain intact. Thin smooth cloth carries readable civic/channel arms, pinned edges, folded shading, weighted
   swallowtail hems and small seekable wind ripples. Keep/hall-window openings never overlap drops. Reuse supplied
   registered field/charge colours and approved arms; no invented Genesis API or material. A still cloth surface is
   lovely too. At market distance and 390 px the keep drops must read; wind cannot turn them edge-on forever.
6. **R6 — Lean toward people.** `leanView` eases from an explicit starting camera to a safe level parapet view over
   about 1.2 s. It may name at most six lit, supplied named, unoccluded windows, ordered left to right on the actual
   screen. Never derive a name from a slot, target an unlit window or look through intervening roofs/merlons. Main
   supplies approved collision/occlusion queries; the function stays pure. Leaving/interrupting returns control
   through the host rather than storing another camera mode.
7. **R7 — Lookout Hill.** The supplied summit/trail/pose frame lake in front, roofs and millstream in the middle,
   castle/beacon on the upper third, dusk sun left of the castle where geography permits. Ground-dressing owns and
   plants the wind-bent pine (~10 m); this lane keeps clear of its measured roots/crown. Add a waist-high dry-stone
   cairn (~0.75–1 m high, 1.4 m across) with a lantern niche, a worn bench, a brass telescope and low switchback-edge
   stones. Trail geometry/grading belongs to land. Cairn stone count is a bounded persisted world fact supplied by
   main; it does not grow from browser visits, localStorage or an invented action endpoint.
8. **R8 — Telescope: who is home.** `telescopeView` narrows from the actual eyepiece toward supplied lit, named,
   unoccluded windows within ±60° of the view bearing. Targets sort by bearing with stable identity tie-breaking;
   about 0.8 s glides never jump when an unrelated source reorders. Explicit previous/next target poses make backward
   seek deterministic. If a target goes dark/hidden, remove its name immediately and let the host reselect safely.
   Empty input returns no names and a calm castle target. Main owns controls, camera transitions and label overlay;
   this lane never creates another nameplate system or reveals an owner's hidden information.
9. **R9 — Forest threshold.** Ground-dressing owns the 10–14 m old-tree wall, ~18 m elder oak, root bench and clearing
   ring. This lane owns the stile and short adjoining fence run, a mossy flame/arrow waymarker, oak-seat anchor,
   switchback stones and forest place pieces: fallen log with shelf fungus, red-cap ring and berry gathering spot.
   These are authored gathering locations, never new inventory/economy or decorative fake harvest buttons. The
   stile has a continuous traversable route under the real locomotion rules; if no climb exists, include an accessible
   opening beside it. Ground-dressing's fences stop at the actual site boundary. Path lanterns are this lane's only
   forest lamps; street lamps remain kingdom-light's.
10. **R10 — Keep the whole campfire.** Preserve at least the existing 9.6 m clearing footprint from the campfire
    agreement, plus its actual seat/camera/approach envelope. Never shrink it to the draft's radius 8. Land supplies
    the centre and approach; the tree ring keeps trunks **and crowns** outside the measured clear area and a real
    ≥8 m gap toward the beacon (11 m trunk radius alone cannot prove crown clearance). Main coordinates exact
    geometry with spec 21/ground-dressing. This lane builds no replacement fire, logs, game seats, seat lanterns,
    clearing floor, Magistrate or game. Its oak-seat anchor refers to the root bench, not a second bench.
11. **R11 — People bring warm light.** Parapet, cairn and path lanterns consume the common people-light input with
    shared hour/fade policy. Empty lights have ≤15% pilot and no full warm pool; cool stone/bark/moon cues guide the
    empty walk. No source exceeds the common presence-window reference or competes with the beacon. Keeper logic
    cannot light these places; no steward, guide, watcher or fake citizen is added. Current positions alone cannot
    reconstruct a fade after seek: host supplies history/result. No local stand-in helper ships.
12. **R12 — The real material, all hours.** Noon court is warm stone with cool shadows, dusk cloth catches gold,
    night court looks over true windows. Pine reads black against gold; forest remains darkest, with dappled green
    at noon. Do not alter global grade, fog, exposure, bloom or tree pipeline to make assets pass. Cloth and view
    calculations are deterministic/seekable; no timers, per-frame geometry/material creation or retained caller
    resources after disposal. Use spec 10 civic ceilings (1,024 boxes/120,000 occupied cells/120,000 triangles per
    module); stair exceptions require measured justification against content limits. Count actual draw/target costs.

## Contracts

Use existing `VoxelBlueprint`, `Vec3`, material registry, `StyleKey`, `VoxelRenderState`, `Dressing`, window source
and light-field types. Content never imports world/render. Main has frozen actual world land types in `packages/world/src/kingdom-land/types.ts`, without generator
stubs; consumers use isolated fixtures typed to those actual types. No lane writes `packages/shared`. `LandSite` uses `position` as placement origin in world metres, local +Z front,
and `turn:CardinalTurn`; static structural yaw is `turn*Math.PI/2`. `viewBearing` is separate camera data. Do not
freely rotate a structural assembly beyond the existing cardinal occlusion/collision compiler. Main freezes these
world types; LAND implements the pure helpers/generator without any production stub.

The concrete lane-local factory surface is:

- `packages/content/src/places-high/index.ts`: `createCastleCourtPlace(site, style, colours)`,
  `createCourtParapet(style)`, `dressCastleModule(base, style)` (preserves accepted openings/anchors/dimensions), `createLookoutHillPlace(site, stones)`, `createForestEdgePlace(site)` and `BLUEPRINTS`.
  Each returns its specific court/lookout/forest assembly, with explicit blueprint placements, supports, seat/text/light
  anchors, keep-clear regions and any banner mounts. Common field shapes may be local implementation details; do not
  promote a universal `PlaceAssembly` mega-port. Site coordinates and ground samples are caller inputs, never guessed.
- `apps/web/src/places-high/index.ts`: `createPlaceCloth(parent, material, registry, banners)` with
  `update({time,wind})` and `dispose()`; pure `leanView(input)` and `telescopeView(input)` return camera pose and
  allowlisted names, never mutate the actual camera or DOM. Place-light adapters consume the actual kingdom-light
  API once available. Until then content exports anchors and benches feed explicit simulated light results.
- Document exact TypeScript signatures, origin/yaw/pin conventions, per-piece collider/walk surface semantics and
  lifecycle in the lane README as consumers start. Metres, +Y up, +X east, +Z south, yaw 0 faces +Z; structural transforms remain cardinal. Keep package
  dependencies unchanged; bench relative source imports precede integrator-owned export registration.

| Dependency / seam | Required before its consumer task can finish |
|---|---|
| H-M1: court/land inputs | Main's actual land types and kingdom-land result: reserved court boundary/elevation, keep-door sill/envelope, gate/tower/front-wall interfaces, exact parapet sites/supports; lookout summit/bearing/trail and postcard pose; forest oak/path/clearing/approach, measured clear envelope and gap; stable revision and foundation sampler. Realm adoption preserves existing dwelling addresses/positions rather than rerolling a live kingdom. |
| H-M2: keep release | Kingdom-light owns the existing keep stair-envelope cut and removal of the two small banners before opening/hall-window changes. Agree exact released bounds first. This lane only fills that envelope; no separate main patch or unconditional guarantee is assumed. |
| H-M3: vegetation | Ground-dressing's actual pear-espalier, elder-oak root-seat frame, pine geometry/placement and ring margins. Existing `createTree` may appear in a labelled composition fixture only, never as a shipped tree replacement. |
| H-M4: lights | Actual people-light API with history/seek semantics, hour curve and reference strengths; real positions and light-field emitter/blocker registration supplied by host. |
| H-M5: host recipe | Integrator alone edits `scene.ts`: compose static placements through mesher/LOD, shadows/blockers/collision; replace front curtain caps/supports coherently; mount cloth; bind views to real input/camera/name overlay; mount actual campfire at agreed site; register walking/seats and bounded sound cues. Lane README supplies exact imports/order/disposal and flags missing ports. |
| H-M6: collection | Main has registered `places-high` collection/glob/path and its narrow material roles; integrator adds consumed exports; main supplies registry changes on `needs:`. No catalogue fallback assets. |

**Isolated bench:** `/src/places-high/bench/index.html`, visibly **SIMULATED · PLACE BENCH**. Fixture sites, occupancy,
window names and cairn count stay under bench/tests, never production exports. Compose actual mesher/material,
atmosphere, light field, shadows, homes and castle; adopt the real land/tree/campfire exports when available. A fixture
must explicitly mark missing dependencies in its controls/report. No fake module with the production import name.
Params: `place=court|lookout|forest`, `view=court-town|court-arrive|court-lean|hill-far|hill-summit|hill-telescope|forest-meadow|forest-oak|forest-gap`,
`hour`, `time`, `occupied`, `stones`, `target`, `tier`; invalid values fail visibly. Readiness follows required workers and one meaningful drawn frame, not a timeout or optional shader completion hint. Controls stay outside composition.

## Scope

Write only `packages/content/src/places-high/**`, `apps/web/src/places-high/**`, this spec and
`work/lanes/places-high/{PRD.md,progress.txt}`. Include local tests/bench/capture/mount README; ignored outputs
`shots/places-high/**`. Everything else is read-only: world/shared, core/civic/materials/catalogue, scene/terrain,
citizens/capes, ground-dressing, kingdom-light, campfire, all Forge/anvil-hero files, routing/manifests/scripts.
You are not alone; preserve others' edits. Disjoint court/lookout/forest artisans may author modules with one index,
web runtime and bench owner; sub-agents never run git. Worker commits only `lane/places-high`. Reviewed commits go
through the team integrator into `lane/integrator`; main judges Tobias's announced integration candidate. No direct
lane branch merges into main and no lane-owned shared scene hunks.

## Acceptance

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/content/src/places-high apps/web/src/places-high
pnpm content:validate --collection places-high
pnpm build
node apps/web/src/places-high/capture.mjs
```

Collection/glob and its narrow registered place-material palette are present in main. Run commands once actual BLUEPRINTS exist. Tests prove real support, clear approaches, parapet joins/safe walking, root-seat
alignment, bounded cairn growth, actual ring/crown and gap clearance, deterministic seek and named-window visibility.
Check telescope transition across darkening/reordered/hidden sources and view cancellation; disposal leaves caller
resources alive. Avoid hundreds of assertions copied from geometry literals.

Capture script uses `$look` and `packages/testing/capture-lock.mjs:acquireCaptureLock` before browser/server startup,
Chrome/SwiftShader, serial captures, `--base-url`/`--only`, an unused 5170–5199 port if needed, and stops only what it
started. Console/page/shader errors fail capture. Capture one or two relevant views per task, not a nine-view Cartesian matrix. Reuse final chosen task
captures: court-town dusk at 1440×900 and 390×844; court arrival/lean as a detail sheet; hill summit and forest gap
dusk as a sheet; one night populated/empty telescope comparison, plus a noon cloth/stone crop. Inspect them with
`view_image`; fix weak silhouettes and joins. Fixture trees/ground do not certify integrated sightlines. The
stream owner checks adopted place framings at 1920×1080 when mounted. Do not repeat unchanged captures.
Integrator runs `pnpm verify` with real dependencies; main checks actual kingdom views. Real-GPU cloth/light/frame-time
checks belong on Tobias's machine; SwiftShader fps cannot certify device targets.

## Quality bar

Each place deserves a screenshot: castle standards visible from town, a court of warm worn stone, a parapet that
turns windows into neighbours; one wind-bent pine against gold, a brass eyepiece at a citizen's height; an old forest
threshold taller/darker than town with a visible way into the real campfire. No grey box, flat lawn, default lone tree,
paper-flat banner, floating wall cap, false name, fake resident or full lamp in an empty place. The scene works in
value before colour, at phone width as well as stream size. Detail rewards a walk without turning the skyline to noise.

## References

- `work/references/voxel-meshing-light.md`: actual occupancy, support, production AO/material and deliberate variation.
- `work/references/sky-fog-time.md`: shared hourly light, cool depth and restrained warm focus.
- `work/references/settlement-streets.md`: public-ground approaches, reservations and stable growth.
- Existing cape source is a local shading/pinning reference; it does not grant permission to alter the citizen rig.
- Spec 27 (`work/specs/27-kingdom-land.md`) owns the actual world land types/site plan and adoption constraints.
- Specs 10/21 and civic heraldry are read-only inputs. Reuse the crest and actual campfire; do not fork them.
  This is original place art using studied tools, not a new vegetation/cloth engine or imported asset library.

## Not now

Landform/site generation, terrain grading/paint, moving existing dwellings, all landscape tree forms/planting,
global grade, castle windows, street lighting, authenticated cairn/gathering actions, input/director policy, sound
engine, interiors, campfire/game/voice authority, new townsfolk, shared contracts and production deployment remain
with their owners. No decorative action may claim it succeeded without that owner binding it.

## Decisions

- **2026-10-30 — Concrete places, shared land.** Main freezes actual world data types; these lane-local factories
  describe their own assemblies. Integrator owns the mounting recipe and every `scene.ts` change.
- **2026-10-30 — No runtime stand-ins.** Labelled fixture benches support independent work. Dependent consumers wait
  for actual land/tree/light/campfire APIs; record `needs:` and continue independent tasks instead of inventing imports.
- **2026-10-30 — Light releases the keep envelope.** Stair cut/banner removal is kingdom-light's coordinated prerequisite,
  not a separate main patch. Court parapet replacement must preserve support and dimension-checked host behavior.
- **2026-10-30 — Keep the whole campfire.** At least 9.6 m plus measured crown/camera/approach margin, never radius 8;
  ground-dressing owns trees/root bench, this lane the matching seat anchor and approach place pieces.
- **2026-10-30 — No new residents or global banner claim.** Citizens are actual people. These castle banners are this
  lane's; other banner owners and existing anvil-hero remain intact.
- **2026-10-31 — The court is paved by this lane.** "A court of warm worn stone" had no owner: the founded court is
  bare terrain. Places-high lays two 20 × 24 m flagstone halves on the supplied court boundary (one cell into the
  ground, flags one cell proud), never beyond it; land keeps grading and paint everywhere else. Floors are not
  shadow casters or light-field blockers. The bench runs on the actual founded land/castle with kingdom-land's
  SIMULATED town fixture, because real founded geography exists while its street generator does not.
