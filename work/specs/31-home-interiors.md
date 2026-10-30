# Spec 31: inside your own home

Status: **frozen 2026-10-30.** The local presentation APIs below freeze in
this spec; the lane implements them in its owned folders. They are not existing persisted schemas. Cross-lane
PeopleLight types are main-owned in `apps/web/src/kingdom/lights/types.ts`; its real implementation is a producer
dependency for HI03. No `packages/shared` change is granted.
Vision: `chatdom/ChatDom.md` principles 3, 5, 11, 17–18; `chatdom/Moments.md` §§2, 14;
`chatdom/Artstyle-Soul-Feel.md` §§5, 6.5–6.6, 10, 17 (decision 5); `chatdom/World-Tree.md` §§3, 6 (companions,
growth only forward); `chatdom/Quality.md` rules 4–6, 8–11, 13.

## What and why

Your home is the warm window with your name above it. Walk through your own door and you are in a room built for
you: a hearth in your kit's stone with a kettle on it and boots drying, a window seat under the very window the street
sees lit while you are here, a bed nook with a quilt in your colours, a shelf of keepsakes from forges, raids and
seasons, and a basket by the fire where your pet lifts its head when you come in. A long-time citizen's floor shows a
pale path worn from the door to the hearth, with rag rugs and more shelves. A first-night citizen's room is just as
lovingly made, only newer. Hearth, Tide and Grove homes each furnish in their own hand, and every interior fits
inside the shell the street already shows. Its facade, address and presence window stay the same; through the open
door and real glass you can see the life inside. The room reads as the warm one, the street outside stays cooler.
This lane owns furnishing, the fire and companion presentation, painted room treatment and an honest isolated
bench. The team integrator owns kingdom composition; realm owns persistent life records, entry, actions and
identity bindings. Completing this lane does not claim those experiences are live.

## Current state

- **Shells.** `packages/content/src/homes/hearth/index.ts` exports `createHearthHome(tier, variant)`,
  `buildHearthHome` (returning `HearthHome` from `family.ts`: `entrance`, `exits`, `rooms`, `supports`) and
  `HOME_REVIEW`. Hearth floors are at y=2 (`grammar.ts:FLOOR`), walls three cells thick (`WALL`), doorways 10 cells
  wide and 22 high, and chimneys stand against the outside of a side wall (`grammar.ts:chimney`, e.g. emberfold
  x 3–10, z 84–98 on the west). `packages/content/src/homes/tide/index.ts` exports `createTideHome` and
  `HOME_REVIEW` (entrance only); Tide floors are flags at y=0 and boards at y=1, people stand at y=2, and the stacks
  rise inside the footprint (`gullstep` x 18 z 81, `saltbend` x 24 z 86, `keelcroft` x 28 z 78). There is no Grove
  family: `apps/web/src/kingdom/settlement-content.ts:placeSettlementContent` builds Grove plots with core
  `createHome(tier, 'grove', variant)` (`packages/content/src/core/index.ts`), whose floor is a stone slab to y=4,
  with a 10 × 18-cell lower door opening and a roof-level crooked chimney, but no continuous masonry stack down
  to the room. Hearth/Tide reserve `[64,160,128]`; core Grove has tier-dependent height/depth, so read `shell.size`.
  The street is at +Z for these shells. Never fit to a fictional common bounding box.
- **Presence.** `packages/render/src/presence-lights.ts:createWindowLights` lights only `blueprint.windows[0]`, as a
  pane on the exterior glass face, and publishes light sources with `strength` 0–1. That first window is the
  citizen's presence window. `MAT.glass` is an opaque solid voxel that blocks light (`materials.ts`), so today no
  daylight reaches an interior and nobody can see out.
- **Light.** `apps/web/src/kingdom/light-field.ts:createLightField(layout, houses, onVolume)` floods light from
  `LightFieldSource {position, strength, normal}` through house occupancy in 0.5 m cells at up to 5 Hz;
  `scene.ts:277` feeds it window and build sources. `packages/render/src/voxel-material.ts` (`createVoxelMaterial`,
  `geometryFromChunks`) is the one voxel shader. There is no shared painterly interior pass in `packages/render`;
  the tavern lane (spec 22) blends its own room's treatment.
- **Identity of a home.** `packages/forge/src/assembly.ts:homeFingerprint` hashes the full shell blueprint, and
  Forge placements, `findForgeSockets`, build-mode drafts (`apps/web/src/kingdom/build-scene.ts`, which can publish
  a replacement shell through `onStreetHome`) and the homes lanes' validators all key on the shell. The shell
  blueprint must stay byte-identical.
- **People.** `packages/world/src/citizens/types.ts:CitizenMotionSample` ends at `state: 'home'` by the door. No
  sit, lie, climb or crouch action exists, and `scene.ts:CameraName` has no interior camera.
  `apps/web/src/citizens/index.ts:createCitizenRenderer` draws supplied citizen samples; it does not authenticate
  or create people, and it has no arbitrary seated-pose input. `packages/content/src/avatars/rig.ts` exports
  `AvatarPose` and `REST_POSE`, which are asset helpers, not a live action contract. No companion body or persisted
  home-life record exists. `apps/web/src/forge/emitters/index.ts:createForgeEmitters` is Forge-specific, not a
  generic kettle emitter. Do not silently use an anvil input to claim room steam support.
- **Tooling.** `packages/testing/capture-lock.mjs:acquireCaptureLock` serialises captures. Existing benches
  (`apps/web/src/content-bench`, `avatar-bench`) show how to mesh blueprints with `VoxelWorkerPool` and publish
  `window.__chatdomReady`.

## Rules

1. **R1 — Fits the shell, changes nothing outside.** An interior is a list of boxes appended after the shell's
   own boxes. It only fills shell air inside the home, plus the top floor layer of a room (for the worn path). It
   never touches walls, roof, glass, frames, the doorway reveal or anything outside. The exterior occupied-cell
   mask, silhouette, windows and their order are unchanged. Furniture visible through a real opening is intentional,
   so pixel-identical street shots are not promised. The integrator must keep a visible room resident while it can
   be seen through an aperture; swapping a furnished view to an empty room is a visible pop and fails. The canonical
   shell blueprint and Forge fingerprint remain unchanged; composition is a separate presentation asset.
2. **R2 — Sized for 1.5 m people.** A citizen is 1.5 m (12 build cells), with a head of about 0.6 m. Seats are
   3 cells high (0.375 m). The table is 5 cells, and the mattress top 4 cells, under a bed 14 × 8 cells
   (1.75 × 1 m). Shelves sit at 6, 10 and 14 cells (top shelf within reach). Tie beams sit 22 cells (2.75 m) above
   the floor and bear on both walls, and above them the room opens to the steep roof. The window seat's top is at
   3 cells, or at the sill minus 6 cells where the sill is higher, with a step if it climbs past 4 cells. It is
   5 cells deep and at least the window's width plus 4 cells long, so a seated citizen's eyes reach the glass.
   Keep a clear route at least 6 cells wide, with 14 cells of headroom, from the door to the hearth, the window
   seat, the bed, the shelf and every further room. Keep 10 cells inside the doorway empty. Furniture is solid
   and supported, and nothing floats.
3. **R3 — Five things that make it yours, in this order.** The fitter always places them in this priority:
   - the hearth
   - the window seat in the presence window (`windows[0]`)
   - the bed nook
   - the keepsake shelf
   - the pet basket within 1.5 m of the fire, but not in front of the firebox

   Then it adds a small table with a candlestick and stools, a chest and a rag rug where room allows. The hearth is
   a chimney breast that stands proud of the wall and is crooked by a cell or so per lift. It has a firebox opening
   about 8 × 7 cells, a hearthstone, a mantel near 10 cells, a kettle and boots drying, and it lines up with the
   shell's real chimney masonry. Anything that does not fit is reported in `dropped`, with a reason, and is never
   squeezed in. A hut or cottage is one room. A house adds a loft up a climbable ladder wherever there are at least
   14 cells of headroom over 2 × 2 m (the bed moves up there). A manor or hall furnishes its second room as the bed
   chamber, with its own small hearth or brazier if it has a stack.
4. **R4 — Three hands, one family.** Use only registered materials and each kit's own stone, trim and wall, plus
   fabric for cloth. There is no emissive material, and no new colour or registry edit. Composition goes 70/20/10:
   the hearth breast and window alcove, then the bed, shelf and table, then the kettle, boots, tags and sill plant.
   - **Hearth & heather:** a limestone breast under a timber bressummer, a terracotta-tile hearthstone, a copper
     kettle on an iron crane, heather (`petal`) in a jug on the sill.
   - **Salt & slate:** a stone and slate stack face with a ship's-timber mantel, a box bed with shutters as the
     nook, a rope-bound sea chest, a brass lantern, sea holly (`blueFlower`) on the sill.
   - **Moss & honey:** a dark-stone inglenook under a crooked bark beam, herb bundles hung from the beams, honey
     jars (`goldLeaf`/`brass`) on the shelf, a moss-green cushion, a hollow-log basket.

   Each is lovely in greyscale. The floor is warm timber, the plaster takes the soft bounce, and the candlesticks
   are brass. Your colours appear only in fabric: the quilt, the cushion and the rug.
5. **R5 — Warm light is you.** The hearth, the window-seat lamp and at most one candle are the interior's light
   sources, in the light field's own `LightFieldSource` form and strength scale. They are lit only while the owner
   is present, each through kingdom-light's shared `createPeopleLight`
   (`apps/web/src/kingdom/lights/people-light.ts`, its spec's Contracts), with the owner counted while `present`.
   HI03 waits for the accepted helper implementation; no copied helper, fallback or unconditional-on stand-in.
   Owner presence is an explicit input, never inferred from opening the bench or the home. An empty home may keep
   banked embers below presence brightness, with no named source or full warm pool; authority loss clears it. The
   window-seat lamp is the inside of the light the street sees. Warmth comes from the real light field through the
   composition's own occupancy, and the fire is real animated geometry. Rooms receive the vision's painted light:
   soft ink edges, restrained brush shading, warm face bounce and colour bleeding at the edge of a pool, blended
   continuously at the threshold from `zone`. Use one reusable treatment suitable for the tavern too, not a flat
   image pretending to be a walkable room. Share the treatment recipe with the integrator; its absence is not a
   waiver of the painted quality bar. There are no scene-wide exposure, fog or bloom changes, or default lit
   three.js furniture materials. If the 0.5 m field is too coarse for the room to feel
   warm, report `needs:` with a looked-at shot. Don't build a second light system.
6. **R6 — Alive, seekable, cheap.** The fire and candle flicker, the kettle steams through a bounded analytic owned
   emitter using the existing effect pattern, and the pet breathes. When the owner arrives the pet lifts its head toward the door, perks its ears and
   thumps its tail, then settles back to sleep over about 6 s. Stoking makes the fire flare and then ease back.
   Every visual motion is a pure function of `time`, `arrivedAt` and `stokedAt`, so it can seek backwards.
   PeopleLight's smoothing follows its explicit history contract; clear and replay its accepted input trace for
   exact reverse-seek captures, rather than claiming unknown history is recoverable. There are no
   clocks, accumulated particles, per-frame geometry or material creation, or listeners that outlive `dispose()`.
   The optional pet is one plush, bouncy curled stray, built at the 0.0625 m avatar lattice through the production
   mesher. It is a companion waiting at home, never a citizen, chat speaker or townsfolk. Runtime defaults to no
   pet unless its caller supplies an explicit companion presentation; authoring a body does not grant one to
   every real citizen. No invented keeper, visitor, owner avatar or chat response fills an empty room. The furnished home stays one
   draw. The runtime initially targets 4 added draws per open interior; justify a measured exception by a visible improvement rather than flattening its motion.
7. **R7 — Grows only forward.** Tenure (whole days) wears the path continuously along a curve that saturates at
   four years:
   - first a few paler boards by the door
   - then a clear pale path to the hearth
   - then rag rugs, a second and third shelf, and ivy trailing from a sill pot inside

   More days never remove wear (the cells at d+1 contain those at d). This is presentation, not a reward: there
   is no unlock, gate or purchase. Keepsakes take the shelf newest-first, each with a tiny parchment tag. Those
   beyond the shelf's capacity go into the chest, which gets its own anchor. None is lost or reordered between
   fits. Everything is deterministic from `(shell, family, tier, life)`.

## Contracts

These are **lane-local presentation APIs**, frozen by this spec when main marks it ready. The lane creates the
actual modules below; no runtime schema is claimed to exist. Nothing goes into `packages/shared`. Existing
`HomeTier`/`VoxelBlueprint` and `VoxelBlueprintSchema` are from `packages/shared/src/voxel.ts`. Presentation life
inputs are not authority: no generated title becomes a real award, no fixture tenure becomes earned tenure, and
no named owner is inferred from a slot. Realm's future binding must supply authoritative records explicitly.

`packages/content/src/home-interiors/index.ts` exports:

```ts
import type { HomeTier, VoxelBlueprint } from '@chatdom/shared';
import type { StyleKey } from '../materials';
type Cell3 = readonly [number, number, number];          // lot cells, 0.125 m, +Z = street
type Facing = 'north' | 'east' | 'south' | 'west';

export interface Keepsake { id: string; kind: 'forged' | 'raid' | 'season' | 'honour'; title: string; earnedAt: number }
export interface InteriorLife {
  tenureDays: number;                           // 0 on the first night; never negative
  colours: { quilt: number; trim: number };     // registered fabric MAT ids (the owner's colours)
  keepsakes: readonly Keepsake[];               // in earned order
  pet: boolean;                                 // explicit presentation input; false when no known companion
}
export type InteriorAnchorKind = 'hearth' | 'window-seat' | 'bed' | 'keepsake' | 'chest' | 'basket' | 'ladder' | 'table';
export interface InteriorAnchor { id: string; kind: InteriorAnchorKind; use: Cell3; approach: Cell3; facing: Facing; top?: Cell3; keepsakeId?: string }
export interface InteriorLight { id: string; kind: 'hearth' | 'window-seat' | 'candle'; at: Cell3; normal: readonly [number, number, number] }
export interface InteriorView { id: 'door' | 'hearth' | 'window-seat' | 'bed' | 'shelf' | 'loft'; eye: Cell3; target: Cell3; fovDeg: number }
export interface HomeInterior {
  shellId: string; shellKey: string; family: StyleKey; tier: HomeTier;
  companion: 'hearth-stray' | null;             // explicit life.pet presentation only
  boxes: VoxelBlueprint['boxes'];               // appended after shell.boxes, in order
  zone: readonly { from: Cell3; to: Cell3 }[];  // interior air, for the painterly blend and camera bounds
  anchors: readonly InteriorAnchor[]; lights: readonly InteriorLight[]; views: readonly InteriorView[];
  hearthStack: { from: Cell3; to: Cell3 } | null; // verified existing stack connection, never an invented exterior
  dropped: readonly { piece: string; reason: string }[];
}
export function furnishHome(shell: VoxelBlueprint, family: StyleKey, tier: HomeTier, life: InteriorLife): HomeInterior;
export function composeFurnishedHome(shell: VoxelBlueprint, interior: HomeInterior): VoxelBlueprint;
```

- `furnishHome` works from the shell's actual occupancy: floor level, rooms, doorway, `windows[0]`, chimney
  masonry and headroom. It accepts any valid home shell, including a build-mode replacement. Authored family
  facts (Hearth `rooms`, `HOME_REVIEW.entrance`) may only sharpen composition.
- Invalid input throws, and so does a `shellKey` mismatch in `composeFurnishedHome`. Use a deterministic digest
  over the complete ordered shell content, not its id alone. A structurally valid edited shell may have no room,
  route, window or flue: return explicit `dropped` reasons and omit impossible anchors/views; never fabricate air,
  carve the shell, clip furniture or label an unsupported fit successful.
- `composeFurnishedHome` returns id `<shell.id>-furnished`, the same size, style, kind and `windows` array, and
  `shell.boxes` followed by `interior.boxes`. It validates against `VoxelBlueprintSchema`.
- Budgets: interior boxes at most 1,500 and composition still within `VoxelBlueprintSchema`'s 20,000-box limit.
  The composed mesh adds at most 60,000 triangles to the shell's; measure worst-case hall rather than multiplying
  one cottage estimate. Preserve lattice, material revision and worker stamps.
- Anchors, views and lights are in lot cells, so the integrator applies the same `homeOrigin`/yaw as the house.
- Keepsake stories stay outside the geometry: anchors carry `keepsakeId` only.

`apps/web/src/home-interiors/index.ts` exports:

```ts
export function createHomeInterior(parent: THREE.Object3D, options: {
  interior: HomeInterior; material: VoxelRenderState; pool: VoxelWorkerPool;
  origin: 'simulated' | 'realm';              // caller declares provenance; not proof of real authority
}): {
  root: THREE.Group;                      // lot-local, identity transform; caller parents it with the house transform
  ready: Promise<void>;
  update(input: { time: number; present: boolean; arrivedAt: number | null; stokedAt: number | null }): void;
  clear(): void;                           // clear accepted people and history on authority loss
  sources(): readonly { position: [number, number, number]; strength: number; normal: [number, number, number] }[];   // lot-local metres
  dispose(): void;                        // owned meshes/geometry only; caller's material and pool survive
};

export function createHomeInteriorTreatment(input: {
  material: VoxelRenderState;               // a dedicated caller-owned room state, never global clay
  interior: HomeInterior; worldFromLot: THREE.Matrix4;
}): {
  update(input: { time: number; weight: number }): void; // 0..1 threshold blend, spatially bounded by zone
  dispose(): void;                         // unbind own changes; caller's material survives
};
```

It owns only the animated parts: the fire and embers, the candle and lamp flames, the kettle steam through the
existing analytic bounded-particle pattern (without importing Forge's anvil runtime), and the optional pet with
its basket blanket. Static furniture is in the composition. Runtime readiness resolves only after actual owned
mesh jobs complete successfully; disposal during preparation rejects or resolves a documented cancelled result,
never a successful-looking empty scene. Treatment uses caller-owned material clones and releases only its own
resources; report exact imports, bind/update/dispose calls and thresholds in the integration recipe.

`apps/web/src/home-interiors/bench/index.html` is a standalone Vite bench at
`/src/home-interiors/bench/index.html`, with no root route edit. Its params:

| Param | Values | Default |
|---|---|---|
| `family` | `hearth`, `tide`, `grove` | `hearth` |
| `variant` | 0–2 | 0 |
| `tier` | `hut`, `cottage`, `house`, `manor`, `hall` | `cottage` |
| `view` | `door`, `hearth`, `window-seat`, `bed`, `shelf`, `loft`, `street` | `door` |
| `hour` | 0–23 | 19 |
| `tenure` | days | 0 |
| `present` | 0 or 1 | 1 |
| `pet` | 0 or 1, explicit simulated companion | 0 |
| `colour` | `red`, `orange`, `gold`, `green`, `blue`, `violet` | |
| `time`, `arrived`, `stoked` | seconds | |

Invalid values are rejected visibly. The bench composes the real shell, `composeFurnishedHome`, the production
mesher and material, and the existing near light field over a generated hamlet layout from `@chatdom/world`, with the
neighbours outside. It uses the production `createCitizenRenderer` for one explicitly simulated scale figure,
with a local fixture sample id and no Twitch PersonId or invented claim to a real name. The renderer currently
accepts standing/walking samples, not arbitrary seated poses; seat evidence requires a real accepted pose seam,
otherwise show the seat unoccupied and report that integration limitation. The bench is labelled
**SIMULATED · INTERIOR BENCH** throughout, including captures. Fixtures of keepsakes, tenure, presence and pet are
visibly disclosed as simulated and never written to a live record. It invents no interior conversation or NPCs.
It publishes `window.__chatdomReady` only after required workers, initial real light publication and a successful
meaningful rendered frame (including actual shader compilation). Optional shader completion hints or background
refinement are never extra readiness gates. Missing dependencies, failed workers and shader errors leave a visible failure and ready
false; never set a fake flag, remove error overlays for screenshots or mark an unlit placeholder ready. Captures
fail on console, page or shader errors. Every interior `view` eye lies in interior air; `street` is exterior. The camera is never inside a wall.

## Scope

The lane writes only:
- `packages/content/src/home-interiors/**`
- `apps/web/src/home-interiors/**`
- this spec, `work/lanes/home-interiors/{PRD.md,progress.txt}`

Ignored outputs go to `shots/home-interiors/**`. The owned folders include the tests, the bench, the capture
script and a short README.

Everything else is read-only:
- shells and their families (`homes/**`, `core/**`)
- `materials.ts`, the package index and the catalogue
- `packages/render`, `voxel`, `world`, `forge`, `shared`
- the kingdom scene, citizens, build mode, emitters, `apps/web/src/kingdom/lights/**` (imported read-only)
- other lanes' folders (tavern, forge, wardrobe, civic, street props)
- root scripts, manifests, the lockfile

The bench imports read-only modules by relative path. You are not alone, so preserve others' work. If you split the
work, one artisan owns the content folder and one owns the web folder, and only one owns the bench. Sub-agents never
run git.

## Dependencies and integration responsibilities

`work/lanes/kingdom-look-owners.md` governs ownership if this draft disagrees. The lane has a complete separable
brief: deliver furnished presentation assets, painted room treatment, explicit runtime inputs and an honest bench.
Persistent records, player entry and interaction authority belong to realm. They are not simulated to claim a full
experience, and their absence does not block completing the isolated presentation brief.

| Dependency or seam | Owner and exact responsibility | Effect on this lane |
|---|---|---|
| People-lit helper | Main freezes `apps/web/src/kingdom/lights/types.ts`; kingdom-light KL01 implements `createPeopleLight` in `people-light.ts`. Import those actual types/helper read-only. | HI03 waits for its accepted commit. Content fitting, tenure presentation and unlit geometry proceed. No local stand-in. |
| Glass and transmission | Kingdom-light owns registry glass flags, rendering, mesher semantics, sun shadow blockers and `light-field-worker.ts` occupancy; glass stays collision solid. | Final daylight/window-seat acceptance waits for actual glass. Capture current failures honestly; no private transparent wall, cutaway shell or duplicate material masking a missing dependency. |
| Painted room treatment | Home-interiors authors one reusable owned treatment/threshold recipe with the production voxel pipeline and coordinates tavern consumers with the team integrator. Main freezes any new renderer hook first. | HI03/HI06 includes painted finish. A missing hook is `needs:`, not permission to declare a plain-lit room finished or build a hidden bench-only shader. |
| Castle/kingdom mounting | Team integrator alone edits `scene.ts` and root surfaces, imports `furnishHome`, `composeFurnishedHome`, `createHomeInterior` and the treatment, parents by the house's exact origin/yaw, routes transformed sources to the near field and updates composition blockers/shadows as needed. | Lane README provides exact calls, readiness, update order, input provenance and disposal. No lane scene hunks. Integration candidate, not bench, proves visible transitions. |
| Home-life and interactions | Realm supplies real tenure/keepsakes/colours/companion records, owner presence, arrival/stoke times and actual entry/sit/lie/climb/stoke actions. Missing data is explicit; no default fake owner or earned history. | Inputs are local presentation values until bound by realm. Keep source flag visible in bench and recipe; do not call production records or live actions implemented. |
| Grove stack | Core Grove has a roof stack. The fitter aligns an internal supported hearth/flue under it without changing exterior cells, or emits a precise `dropped` reason. Exterior shell changes, if essential, require its owner. | No fictional new chimney. A missing flue blocks that hearth's complete fit, not other furnishings; report affected shell ids and evidence. |
| Public package export and stories | Integrator adds content/runtime exports if needed, without giving the lane barrel ownership. Realm/citizen-card/Chronicle resolves `keepsakeId` to witnessed stories. | Relative bench imports are valid; no forged story or pretend click success in lane UI. |

The team integrator merges reviewed lane branches into `lane/integrator`, one at a time, and resolves conflicts.
Main judges the candidate Tobias announces ready. The worker never merges lane work into main or edits another
owner's files to unstick a consumer. Report `needs:` for actual producer/hook blockers and keep working on the
independent tasks.

The integrator and realm recipe uses actual exported presentation modules after their producer commits exist:

```ts
import { furnishHome, composeFurnishedHome } from '../../../../packages/content/src/home-interiors';
import { createHomeInterior, createHomeInteriorTreatment } from '../home-interiors';
// shell and life come explicitly from the caller; life fixture values stay SIMULATED in the bench.
const interior = furnishHome(shell, family, tier, life);
const composed = composeFurnishedHome(shell, interior);
// Compile composed with the production worker/geometryFromChunks before publishing it.
// houseRoot carries the exact homeOrigin/yaw; its local axes are the shell's build-cell axes in metres.
const runtime = createHomeInterior(houseRoot, { interior, material: roomMaterial, pool, origin });
const treatment = createHomeInteriorTreatment({ interior, material: roomMaterial, worldFromLot });
await runtime.ready;
// Every frame, explicit records provide these values; no slot/name-derived owner or pet.
runtime.update({ time, present, arrivedAt, stokedAt });
treatment.update({ time, weight: interiorBlend });
```

`roomMaterial` is a dedicated production `VoxelRenderState` carrying the same Environment/light uniforms as the
world; paint treatment never changes the global clay state. `worldFromLot` is the house's actual matrix. Convert
`runtime.sources()` from local metres to world positions through that matrix, transform normals by its rotation,
and append them to the existing near-field sources (never replace windows/build/other place sources). Use the
composition as the corresponding near occluder and shadow geometry; retain the canonical shell for Forge/build
identity. On authority loss call `runtime.clear()`; on scene exit, cancellation or failure dispose treatment and
runtime before the caller releases its room material/pool. Keep a room resident while visible through apertures.
The README must supply the final candidate's exact worker/field/mount calls; a named source above is not a fake
existing realm API. Realm later owns entry and actions; this recipe never manufactures their records.

Related lanes: [kingdom-light, spec 26](26-kingdom-light.md), [kingdom-land, spec 27](27-kingdom-land.md),
[ground-dressing, spec 28](28-ground-dressing.md), [places-water, spec 29](29-places-water.md),
[places-high, spec 30](30-places-high.md) and [first-look-polish, spec 32](32-first-look-polish.md).

## Acceptance

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/content/src/home-interiors apps/web/src/home-interiors
pnpm build
node apps/web/src/home-interiors/capture.mjs            # --family/--view/--tier/--hour/--tenure narrow a pass
```

The capture script (task HI01) works like this:
- It owns a temporary Vite server on a free port from 5170–5199, or reuses `--base-url`.
- It records the port and stops only the process it started.
- It takes `acquireCaptureLock` before starting the browser or the server, and releases it after both close.
- It reuses one loaded scene per family and size, and each pass after the first recaptures only the changed views.

Capture one or two frames per visual task, reusing a loaded bench. The final selected set is a warm door/hearth
composition for each family (desktop, with the strongest and tightest also at 390×844), a noon window-seat/street
pair through actual glass, one night absence/greeting comparison, and a compact first-night/four-year shelf/wear
strip. One loft/second-room detail proves the additional tier. Reuse those task shots at acceptance.
All 45 shells get the one fitter regression check; do not render 45 full-room shots merely to prove a fitted box.
Select failures or materially different shells for additional visual judgment. Exterior cells/canonical fingerprint
remain unchanged; views through real apertures intentionally differ, so no pixel-identical street requirement.

Open every shot with `view_image`, fix what looks weak, and record what changed and what still looks weak in the
README and progress. Standalone shots don't certify integrated walking, framing or real data. SwiftShader timing
is not device performance; real-GPU doubts go to main.

## Quality bar

You'd want to sit in it. Townscaper's warmth, Animal Crossing's lived-in clutter in moderation, Tiny Glade's
care for built shapes, with Tunic's purposeful composition and the best genre examples as the bar,
never a furniture catalogue. Existing benches and old prototypes diagnose regressions; matching their weaknesses
is not acceptance. The production walkable room receives the painted treatment, not just a flattering target
frame. The hearth is the room's heart and its light. The window seat feels like the place you wait for the stream. A four-year home and a first-night home
both feel loved; the old one simply remembers more. Nothing reads as grey boxes, scattered props, floating
shelves, a bed you could not lie in, a ladder to nowhere, a dark room with one orange blob, or a dollhouse whose
outside breaks.

## References

- `work/references/voxel-meshing-light.md`: real occupancy, AO and the production material. Detail is shape at
  interior distance, not random voxels.
- `work/references/sky-fog-time.md`: keep main's warm-subject/cool-depth grade. The room is the warm one.
- Specs 04 and 05 and the homes READMEs: the shells' floor, wall and doorway conventions, read-only.
- Spec 22's room rules: one painterly pass, furniture blocks and nobody blocks a door.
- the read-only `f-lanternmere` prototype (location in `AGENTS.md`) night look: learn from it, re-implement.

## Not now

These are owned elsewhere:
- arranging furniture in build mode
- visitors, the guestbook and the plaque inside
- new sounds (`sources` and anchors give the audio owner its hearth and kettle positions)
- exterior patina and ivy
- companion species, stages and behaviour beyond the basket greeting
- tavern and throne rooms
- interactive doors and authoritative movement actions, registry changes, shared protocols
- raster assets used as walkable geometry; generated painted target frames may guide the room, while game boards
  keep their own authored art styles under the founder's decision

## Decisions

- **2026-10-30 — The shell stays canonical.** Interiors compose for drawing, collision and light only, so Forge
  fingerprints, sockets, build drafts and the homes validators never see a changed shell.
- **2026-10-30 — One fitter for every shell.** Interiors are fitted from occupancy, not hand-placed per blueprint, so a
  published rebuild, Tide's inner stacks and Grove's open shells all furnish under the same rules.
- **2026-10-30 — A companion is explicit.** No companion body exists yet. The lane authors one optional plush
  stray for explicit presentation input; it never grants ownership or pretends to have an authoritative companion
  system. Other companions may use the same anchors once their actual records and body contract exist.
- **2026-10-30 — Honest apertures and scope.** Preserve exterior cells and canonical shell identity, not pixels
  through real open doors/glass. No imaginary sit API or generic emitter. Painterly light remains part of the
  finish. The isolated lane is complete on its presentation outputs and bench evidence; persistent life/entry
  stays with realm and scene composition with the team integrator.
