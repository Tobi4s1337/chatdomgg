# Spec 29: the lake, pier and millstream

Status: **frozen 2026-10-30; dependent implementations below remain producer work.**
This document freezes the experience and ownership. It does not claim proposed host APIs exist or make the lane ready to ship.
Vision: `chatdom/ChatDom.md` principles 2, 8–10, 17–18 and §5; `chatdom/Artstyle-Soul-Feel.md` §§6.1–6.5, 13, 16.2;
`chatdom/Quality.md` rules 8, 10–12 and the world slop list; `chatdom/World-Tree.md` §§3, 5–6;
`chatdom/Moments.md` §7. Ownership: `work/lanes/kingdom-look-owners.md`; this replaces the provisional the submitted draft ownership table advice.

## What and why

Water should be a reason to leave the street. From a dark timber pier, a citizen looks across gold and lilac water to
coloured roofs and the castle beacon. At night the actual lit windows return as shimmering pillars. Beside the town,
a stream runs through a millpond, over an overshot wheel and under a humpback stone bridge; the bridge and its reflection
close into a circle in the quiet pool. Planks creak, ducks paddle, a fish breaks the surface and the wheel keeps its slow
rhythm. These are lovely places with nine people and readable places with a capital behind them. Warm pools say someone
is there. The lane makes the water, its buildings and its wild creatures; main decides the land and binds real people,
walking, actions and sound. A beautiful bench is art evidence, never evidence of a live interaction.

## Current state

- `packages/render/src/water.ts:createWater` renders one terrain-masked lake plane, filtered analytic ripples, sky
  reflection and restrained sun glint. No scene reflections, window pillars, stream, mill or pier exist. Its `update`
  takes environment and seconds; `apps/web/src/kingdom/scene.ts` owns construction, updates and disposal.
- `packages/world/src/settlement/types.ts` retains the legacy ellipse landform and now unions it with the frozen
  `KingdomLandform` v2 data types in `kingdom-land/types.ts`; the current generator still produces legacy geography.
  `settlement/generator.ts` currently fixes it near `[200,225]`, radii 34/29 m, level −0.5 m. `settlement/terrain.ts`
  carves it; the worker's waterbed paint and the scene's shore/tree exclusions assume that single lake.
- `apps/web/src/kingdom/settlement-content.ts:Dressing` is `{blueprint,position,yaw}`. `castle-content.ts` produces
  `WindowHouse` placements for geometry, shadows and occlusion. There is no general place mount API yet.
- `packages/render/src/presence-lights.ts:createWindowLights().getSources()` provides position, normal, strength,
  slot and nullable name. `apps/web/src/kingdom/light-field.ts` accepts finite `LightFieldSource` strengths 0..1;
  it cannot by itself provide scene reflections, spatial sounds, seats or routes.
- `packages/shared/src/voxel.ts` provides `Vec3`, `VoxelBlueprint`, ordered half-open boxes, build 0.125 m and avatar
  0.0625 m lattices. Build assets have each dimension ≤256 cells; a long assembly must be split at real joints.
  `packages/content/src/materials.ts` is the registered palette; `core`, `civic` and their bridge/heraldry stay read-only.
- `packages/content/src/catalogue.ts` now registers `places-water` and its dynamic glob/path; content arrives from this lane. The new `kingdom-land/index.ts` exports types only, without a generator or sampler. No people-light helper,
  water interaction authority, seated citizen API or place-audio bridge exists at this review. Other lane specs are
  agreements, not installed exports. Existing `anvil-hero` owns the hero anvil and sleeping dragon; this lane never touches them.

## Rules

1. **R1 — The course belongs to main's landform.** Consume the main-approved lake, millpond, stream, earth leat,
   tailrace, bed/surface profiles, widths, weir drop and bridge pool. Do not generate a route, choose a lake position,
   carve, grade, reserve land, move a site or derive a competing course from town growth. Missing/contradictory inputs
   produce an explicit error and `needs:`. The world module validates and derives flow along the supplied course only.
2. **R2 — Water carries the actual light.** Noon reveals pebbles through turquoise shallows that deepen to blue;
   dusk reflects gold/lilac sky; night is cool with warm window pillars and the beacon's longer pillar. Use thickness
   absorption, Fresnel and filtered low-amplitude normals. No black deep water, ocean breakers, white rim, static noise
   or subpixel crawling. Foam is broken and restrained in shallow contact regions, including piles, stones and hulls;
   it follows real occupancy/waterline, never an outline around every prop.
3. **R3 — Two quality paths, one place.** Full quality may use one selected planar reflection per frame, a mirrored
   camera and oblique clip, at half resolution or below. Its soft vertical streaking preserves roofs and makes warm
   panes into rippled pillars. Reduced quality uses sky reflection plus a bounded set of analytic light pillars,
   selected deterministically by projected contribution, retaining the beacon and visible focal windows. Report the
   source limit and over-cap behavior; do not claim all 50,000 lights are individually drawn. Windows outside a valid
   reflected view do not draw false pillars. Compare both modes in the same night composition. No capability probe or
   failed target silently yields black water; use the coherent reduced path and expose diagnostics outside the scene.
4. **R4 — Flow follows the bed.** Derive tangents and speed from supplied reach geometry; still pools remain still,
   narrows move faster and the bridge pool's ripple/flow is ≤15% of the open reach. Two-phase advection must not jump
   at the reset or a reach join. The final timber leat trough meets the supplied earth leat and wheel lip without a
   water step. White water stays at the weir and descending buckets. An impossible hydraulic head is a land `needs:`,
   never grounds for moving the wheel or inventing a tributary.
5. **R5 — The lake place.** A roughly 28 m ×2.5 m pier with an 8×4 m T-head stands 0.6–0.8 m above water, in the
   supplied direction. Split it into supported modules within schema bounds. Dark plank ends, a gently sagged deck,
   uneven rail and one missing plank give age; the missing plank sits outside the continuous accessible walk strip.
   Piles terminate on sampled bed, with waterweed at the waterline. The end has a seat edge, a 6 m lantern/bell pole
   and an unobstructed view. A Tide boathouse has an open water bay and a steep slate roof ≥8 m above water; an upturned
   boat rests on trestles. Two faded 3.5 m rowing boats bob/yaw out of phase. Reeds with blue flowers, lilies, pebble
   shoals and stepping stones lead to a flat fishing rock. Main supplies the lake name for the pier-foot plaque.
   Alders and all trees belong to ground-dressing. The postcard eye is scaled to the actual citizen, with water in
   front, roofs in the middle and castle/beacon on the upper third; main's site/view must make this physically possible.
6. **R6 — The mill place.** A Grove mill about 9 m tall has a crooked chimney, flour-dusted door and sacks; its
   windows never fabricate citizen presence. A 5 m overshot wheel has 16–24 readable buckets, about 5 rpm, a real hub
   and supported axle; the supplied leat lip sits 0.3–0.5 m above its top. Water sheds from the descending side;
   trestles drip; a 0.5–1 m weir has a foam lip. A 4 m wide humpback bridge spans about 7 m, with a usable deck,
   sitting-height parapet and an open arch/reflection. Reuse the civic crest on the keystone; moss stays in shade.
   At its foot a ≥2.6 m fingerpost points at actual supplied destinations. Castle court, market, lake/pier and road
   out receive arms only when those anchors exist. Emblems read at 10 m; supplied names read at 4 m at 390 px through
   the host's approved text treatment. No made-up road, destination, sign font or secret name.
7. **R7 — Warmth means people.** Pier and bridge lamps consume the shared people-light result supplied by the host,
   with about 4 m reach at the pier end and the actual bridge-deck envelope. Empty lamps retain at most 15% pilot;
   full warm pools require present real people and fade on the common curve. Main supplies activity history for
   seekable fade; evaluating only current positions cannot reconstruct past occupancy. Do not implement a substitute
   helper or add scene lights. Expose emitter anchors/strengths for the existing field and reflection inputs. Fireflies
   stay smaller and dimmer than a presence window; the beacon remains the kingdom's light.
8. **R8 — The water is alive, never a fake audience.** Wild ducks paddle in pairs; a heron rests in reeds; a fish
   jumps on a seeded 20–40 s schedule with splash/rings (≤8 concurrent rings); a kingfisher flashes along the stream,
   dragonflies hover at noon and fireflies appear at dusk. Mist after hour 21 stays low and ≤0.35 opacity, preserving
   pillars and lantern pools; wheel spray may catch a faint noon rainbow and flour dust drifts near the door. No
   miller, ferryman or citizen is invented. Creature geometry uses the actual avatar-lattice asset/mesher path, not
   a `VoxelBlueprint` with an illegal avatar lattice. No new pet ownership or creature-authoring grammar.
9. **R9 — Seek, cancel, dispose.** Boats, wheel, wildlife, rings, particles, flow and optional named floaters are
   deterministic from caller seed/time and finite supplied actions; backward seek gives the same frame. Floater
   labels are public-safe caller data, and lifetime/count are bounded. No local timer authority, accumulating
   particles or per-frame geometry/material allocation. Caller material/pool/scene survive disposal. No global grade,
   exposure, fog, bloom or terrain-shader changes to rescue the assets.
10. **R10 — Honest usable shapes.** Walk strips and bridge/rock/pier joins have continuous support and clearance;
    seats and solid collision envelopes match visible geometry. Structural pieces use registered ramps, real air
    gaps and occupied support to their declared foundation/attachment. Dynamic wheel/boat parts attach to their
    actual mounts, rather than faking y=0 support. Use modular civic budgets (spec 10) and report exceptions for main
    before exceeding them. Record actual boxes/cells/triangles/draws/targets/bytes, never an invented beauty score.

## Contracts

**Existing inputs:** `VoxelBlueprint`, `Vec3`, material registry and lattices from shared; existing `StyleKey`,
`VoxelWorkerPool`, `VoxelRenderState`, `Environment`, `WindowHouse`, `Dressing`, `LightFieldSource`. Keep package
layers: world is pure and imports no render/content; content imports no world/render. Use relative source imports
inside the bench until main grants package exports. No shared protocol change is authorised to this lane.

**Actual world data types are frozen in `packages/world/src/kingdom-land/types.ts` and exported by `@chatdom/world`;
implementations belong to the land lane.** The agreed seam is
`KingdomLandform` version 2, retaining current seed/ridge/castleRise/lake and adding hills, `waters` and `streams`.
`WaterBody` is `{id,x,z,radiusX,radiusZ,level,depth}`. `LandStream` is
`{id,kind:'stream'|'leat'|'tailrace',points:readonly {position:XZ,bed:number,level:number,width:number}[],bank:number}`;
use the point records, never invented parallel arrays. `sampleLandWater(landform:LandformPlan,x,z)` returns
`{id,surface,bed,shoreDistance}|null`; `waterSurfaceAt` and `waterKeepOut` also take the **landform**, not the whole
land result. These pure helper implementations are LAND's work; no fake imported implementation is assumed.
`LandSite` has `position` as placement origin in world metres and `turn:CardinalTurn`, local +Z front. Static
structural yaw is only `turn*Math.PI/2`, matching the cardinal collision/occlusion compiler. Northwest pier/camera
composition comes from approved sites/view bearing, not freely yawing structural buildings. Boats/critters may turn
freely and do not become static blockers. Confirm the actual exported source before writing its consumer.
No generator stub is required or permitted. The local factory APIs below remain concrete; there is no universal
place-assembly protocol. Integrator owns the shared renderer seams and documents their actual mount recipe.

| Need | Required data/behavior and owner |
|---|---|
| W-M1: land | Main/kingdom-land: stable revision; water-body ellipses and levels; ordered reach points with bed, surface, width and joins; real foundation sampler; `lake:pier`, `lake:boathouse`, `lake:rock`, `mill:mill`, `mill:wheel`, `mill:weir`, `mill:bridge`, `mill:sign` origins, cardinal turns and footprints; lake/pier reveal poses; public path endpoints. Validate deck/arch/head clearances before supplying them. |
| W-M2: concrete mount | Lane defines `createWaterPlaces` and its concrete return values; integrator documents how its static placements join existing geometry/LOD, occlusion, shadows and collision, and how walks/seats/lights/sounds are registered. Keep static cardinal transforms separate from free moving meshes. No universal `PlaceAssembly` mega-port. |
| W-M3: reflection frame | Integrator renderer host: explicit hook receiving renderer, scene, actual camera, frame/revision and exclusions before the normal render; maximum one pass shared among water planes. Water owns its target/materials; host owns render order and quality selection. Restore target, viewport/scissor, clipping, shadow state and hidden objects in `finally`; prevent recursive reflection. Do not hide a second render in mesh `onBeforeRender`. |
| W-M4: people and light | Kingdom-light/main: real present positions plus seekable occupancy/fade result, public reflection sources including beacon, common light strengths/hour curve. Missing source names remain absent. The field needs water-place blockers plus supplied emitters, not new per-lamp lights. |
| W-M5: collection | Main has registered `places-water` collection/glob/path and its narrow material roles; integrator adds public exports when consumed; lane exports nonempty `BLUEPRINTS` with representative supported assemblies. Any new palette/credit rows are main-owned. |
| W-M6: actual bindings | Integrator: replace old water exactly once; remove temporary civic bridge at the same site; feed walk/collision/seat graph, Raid Gate crossing anchors and actual crowd history; bind bounded sounds/actions to their owners. Existing citizen routes cannot consume new seats/walk surfaces automatically. |

Lane-local implementation folders: `packages/world/src/places/water/` derives/validates water-place metadata from the
frozen land input; `packages/content/src/places/water/` exports pure factories for pier modules, boathouse, boats,
shore forms, bridge, mill, wheel, trough, weir and fingerpost plus local attachment/emitter/seat/text planes;
`apps/web/src/places/water/` supplies `createWaterPlaces`, the water renderer, wildlife and local bench. Its concrete mount accepts supplied
place metadata, caller material/pool, actual terrain samples, names and quality; returns root, readiness, static
placements, emitter/sound anchors, walks/seats and bounded floater presentation hooks plus update/dispose. The
renderer receives explicit caller time/environment/camera, actual people-light results and reflection light sources;
its reflection method receives renderer/scene/camera through W-M3. Caller resources remain caller-owned.
Factories take explicit foundation heights/site dimensions; `planWaterPlaces` must never become a land generator.
Write exact exported signatures against W-M1/2 in the lane README before runtime consumers are implemented. The
integrator is the sole `scene.ts` owner; supply exact import/order/update/teardown and bridge replacement recipes.

**Isolated fixture bench:** `/src/places/water/bench/index.html`, visibly **SIMULATED · WATER PLACE BENCH**.
Fixture geography/people/names are allowed only in bench/test files, never imported by production exports. It may
exercise the actual frozen type shapes; it must not export a fake `KingdomLand` or people-light module for production.
Compose actual production mesher, material, atmosphere, light field, shadows and existing town content, not a competing
engine. Views: `lake-postcard`, `lake-reveal`, `lake-60m`, `pier-deck`, `bridge-pond`, `mill-wheel`, `fingerpost`,
`stream-60m`, `parapet`. Params: explicit `view`, `hour`, `time`, `quality`, `seed`, `tier`, `style`, fixture occupancy;
invalid values fail visibly. Adopt approved land poses when available. Publish `window.__chatdomReady` after workers and one meaningful rendered frame; optional compileAsync completion hints never delay it; no loading timer masquerading as readiness.

## Scope

Write only `packages/world/src/places/water/**`, `packages/content/src/places/water/**`,
`apps/web/src/places/water/**`, this spec and `work/lanes/places-water/{PRD.md,progress.txt}`.
These folders include tests, bench, `capture.mjs`, credit/mount README. Ignored output: `shots/places-water/**`.
Everything else is read-only: shared, existing render/water, settlement/landform, scene/terrain worker, materials,
catalogue/barrels/manifests, ground-dressing, civic, light helper, citizens, Forge and anvil-hero. You are not alone;
preserve other workers' changes. Disjoint artisans may own content, pure metadata and web folders, with one bench
owner; sub-agents never run git. Worker commits only `lane/places-water`. The integrator is the sole `scene.ts` owner. The team integrator accepts reviewed lane
commits into `lane/integrator`; main judges Tobias's announced candidate. No direct lane merge into main.

## Acceptance

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/world/src/places/water packages/content/src/places/water apps/web/src/places/water
pnpm content:validate --collection places-water
pnpm build
node apps/web/src/places/water/capture.mjs
```

Collection/glob and its narrow registered place-material palette are present in main. Run commands after actual BLUEPRINTS exist; do not bypass them with fake assets. Tests prove supplied-site adherence,
foundations, actual walk continuity, clear arch/bay, wheel/trough alignment, bounds/palette/support, reach joins and
flow direction across approved land seeds/tiers. Fixture tests do not prove land integration. Renderer tests cover
seek-back, bounded resource/action counts, reflection-state restoration and fallback, light-source honesty and
caller resources surviving disposal. Avoid tests that just restate coordinates.

The capture script follows `$look`, takes `packages/testing/capture-lock.mjs:acquireCaptureLock` before browser/server
start, captures serially with Chrome/SwiftShader, and stops only its own server on an unused 5170–5199 port; accept
`--base-url` and `--only`. Fail on console/page/shader errors. Capture one or two relevant views per task, serially. Final selection: lake postcard dusk at 1440×900 and
390×844; bridge/mill dusk as one contact sheet; the same lake night view at full/reduced quality side by side;
one noon shore detail and one occupied/empty pier comparison. Reuse these task captures at final acceptance,
do not run all nine cameras at both sizes/hours. A changed reflection path merits its own targeted recapture.
Open every selected image with `view_image`; revise cheap results and record doubts. A stream adoption is checked
at 1920×1080 by its owner when mounted, not as an extra bench matrix here.
After integration the team integrator runs `pnpm verify`; main reviews real kingdom framings, not bench shots alone.
Real-GPU reflection quality and frame-time evidence remain Tobias-machine checks; SwiftShader fps is not evidence.

## Quality bar

The dusk lake is a postcard, the night water names life by reflected warmth and the mill is recognisable before
its details. Every scene works in greyscale and at 390 px. Medium roof/wheel/bridge shapes sit inside broad calm
water and land, with reeds and tool wear as the small accents. No flat blue plane, grey stream ribbon, white shore
ring, box mill, synchronized boats, floating piles, invisible walk gaps, giant halos or full lamps in empty places.
Townscaper/A Short Hike are taste references, never imported assets or a license claim.

## References

- `work/references/water.md`: already studied Ultra-Water (MIT, pinned revision); take bounded reflection,
  thickness colour, filtered roughness/contact foam and graceful quality paths, leave FFT ocean/breakers behind.
  Its note explicitly says the many-window pillar solution still needs a local experiment; R2/3 require that proof.
- `work/references/voxel-meshing-light.md`: production mesher/material, occupied support, AO and authored variation.
- `work/references/sky-fog-time.md`: shared warm subject/cool depth; no forked atmosphere.
- Spec 27 (`work/specs/27-kingdom-land.md`) owns the actual world types, course/site plan and realm adoption seam.
- `work/references/settlement-streets.md`: public ground/reservations belong to land and settlement owners.
  Any further third-party flow/foam code needs source/license study before adaptation, headers and main-owned
  `THIRD_PARTY.md` entries. The unverified `water-stylised.md` and repositories in the old draft are not frozen evidence.

## Not now

Other owners retain land generation/carve/paint/reservations, trees, global renderer/lighting, shared contracts,
authenticated fishing/rowing/floater commands, gathering/economy, NPCs, seated poses, audio engine, weather, Atlas
bridges and input/director policy. This is ownership, not a promise to ship decorative buttons for unimplemented actions.
The lane exposes honest presentation hooks; no fake success or runtime fixture fallback.

## Decisions

- **2026-10-30 — Main owns actual world land types; integrator owns renderer seams.** Old draft imports are requirements, not installed
  APIs. Dependent consumers wait for W-M1–5; independent authored content and labelled fixture benches can proceed.
  Existing dwellings cannot move on generator switch: realm adoption must preserve their recorded positions/addresses.
- **2026-10-30 — No second course planner.** Water derives flow and builds on supplied sites; it cannot route a stream.
- **2026-10-30 — Explicit reflection scheduling.** Integrator owns a single reflection hook/order; no hidden scene render.
- **2026-10-30 — Fixtures stay isolated.** No production stand-in helper, stub land generator or fake people. No new
  keeper is needed; wild critters provide the life. Existing anvil-hero remains untouched.
