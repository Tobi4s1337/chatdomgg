# Spec 26: Kingdom light — the town glows from its people

Status: **frozen 2026-10-30.** No `packages/shared` edit is granted.
Main-owned pure types and capture pose now exist; remaining local presentation modules are producer work. Consumer
evidence waits for its actual producer and integrator seam; see the dependency gates. Independent work starts now under the frozen scope.
Vision: `chatdom/ChatDom.md` §5 ("Presence is light"), §6 ("A night"); `chatdom/Artstyle-Soul-Feel.md` §§1, 2
("Light is people"), 6.2, 6.3, 6.5, 13, 16.2 and Decided 4–5; `chatdom/Quality.md` rules 8, 10, 11 and the slop list;
`chatdom/Moments.md` (go live: "the sky spins to dusk and the beacon catches").

## What and why

Light is people, out in the streets too. In the labelled SIMULATED evening you arrive after the community has settled
in; in a real kingdom the visible warmth reflects the actual fresh presence, even when only one person is there.
Each lit window pours a warm pool onto its wall and the cobbles below. Lamps at the junctions and along
the paths come on as people walk past them and fade behind them, so the routes people take glow and an empty lane
stays moonlit blue. The castle is home as well: its arrow slits and hall windows wake when the stream goes live, and
the gatehouse arch glows from inside. Under all of it is a grade that looks like the hour: at dusk, indigo shadows,
gold on the west faces and lilac sky; at noon, a real blue sky with white clouds, a warm sun and cool blue shadows.
When someone opens the town, this is what they see first.

## Current state

- **Grades.** `packages/render/src/atmosphere.ts:19` `grades` sets the sky, fog, ambient and sun for each hour, and
  `getEnvironment(hour)` blends them. Noon is a pale zenith `#6595c1` over a near-white horizon, with near-white
  ambient `#d4e1ea`. Shadows read grey and the frame reads as haze. Clouds are mixed at most 24% toward a
  zenith/horizon blend (`:92–93`), so they come out as grey smudges. The beacon column, halo and base
  (`createAtmosphere`, `:211`) ignore the hour, so at noon a full beam stands in the daylight.
- **Clay shading.** In `packages/render/src/voxel-material.ts` `createVoxelMaterial`, the fragment shader lights a
  surface with cool ambient plus the sun (`:160`). Warm field light is added as `warm*warm*(.4+.6*uNight)*.95`
  (`:171`): squaring the field kills the pool after a metre or two, and at dusk (night ≈ 0.22) it runs at about
  half strength. Fog is fixed at `.00115` with a 0.86 cap (`:183`), and the scene fog density is fixed at `.0016`
  (`apps/web/src/kingdom/scene.ts:275`). Exposure is a constant 1.08 (`scene.ts:43`). Citizens use the same
  material (`apps/web/src/kingdom/citizen-scene.ts:16`), so their faces catch whatever the field gives.
- **Windows.** `packages/render/src/presence-lights.ts` `createWindowLights` draws one instanced pane and one halo
  for each home's first window anchor (`:55`). This is decided: one citizen, one window (`work/DECISIONS.md`,
  2026-10-30). The pane is flat amber and the glass of an absent home is near-black (`:110–124`). `getSources()`
  feeds the light field.
- **Why the town looks empty.** A window lights only after its citizen has walked home: `crowd.lightFrame()`
  (`citizen-scene.ts:59`) gates presence on `homeLit` from `packages/world/src/citizens/motion.ts`. The SIMULATED
  scenario `createSimulatedPresence` (`apps/web/src/kingdom/presence-feed.ts`) brings every citizen in between 1
  and 20 s, and each one then walks 12–30 m home (`packages/world/src/citizens/routes.ts:225`). The standard capture
  is taken at `time=30` (`packages/testing/shots.mjs:49`), so in the hero frame most of the town's 240 homes are
  still dark. `work/DECISIONS.md` ("Inhabited visits") already promises that a SIMULATED visit opens with its
  citizens present, and that "Let them in" replays the dark → one window → whole town wave.
- **Light field.** `apps/web/src/kingdom/light-field.ts` `createLightField` runs three occluded six-neighbour flood
  volumes (`light-field-worker.ts` `resolveLightFieldConfig`): a local 0.5 m field round the camera, a 2 m kingdom
  field and a 2 m beacon field of 64 × 48 × 64 m round the castle crown. Together they stay under 12 MiB. Sources
  are `LightFieldSource {position, strength 0..1, normal?}` and are refreshed every 240 ms (`scene.ts:277`). Any warm
  emitter can join these fields at no extra memory cost.
- **Castle.** `packages/content/src/core/castle-modules.ts` `createCastleModule`: the tower, gatehouse and curtain
  slits are painted `darkStone` boxes (`:45`, `:76–77`, `:101–102`), and `windows: []` (`:110`). The keep
  (`createCastle`, `packages/content/src/core/index.ts:89`) has slit anchors (`:124`, `:127`), but no light is
  drawn for them. `apps/web/src/kingdom/castle-content.ts` places the modules at slot 65534. `beaconStrength`
  (`apps/web/src/kingdom/beacon.ts`) is 0 unless the stream is live and fresh, then rises from 0.18 with presence.
- **Props to use.** The civic lane's (spec 10) lantern post (`LANTERN_POST`: 12 × 40 × 12 cells; the glass at
  `[3,19,5]–[9,26,11]`, centre `[6,22,8]`) is in task CP04 on `lane/civic-props`. `packages/content/src/index.ts`
  now exposes finished civic factories only; the lantern builder/constants still require accepted CP04 work.
- **Neighbours and absent seams.** [Places-high (spec 30)](30-places-high.md) owns the castle/place banners and the court/parapet; [kingdom-land (spec 27)](27-kingdom-land.md) owns
  geography, trail edges and reserved place footprints. Main has frozen the pure types; their runtime producers remain lane work. `scene.ts:326` exposes `inspect().fields`, and `index.tsx:33` publishes `stats`, `capture`, `seek`
  and `hour`. Main has now added `pose(eye: Vec3 | null, target?: Vec3, fovDeg?: number)` and the actual
  `lights/types.ts` / `@chatdom/world` land types during handoff. The people-light implementation and actual land
  builders still do not exist; consumers wait for producer commits, not type-only declarations. The actual CP04 lantern builder still remains a producer dependency.

## Rules

1. **R1 — Warm light is people.** Every warm light this lane adds is lit by someone:
   - A home window is lit by its citizen.
   - A lamp is lit by citizens passing it.
   - The castle is lit by the monarch being live.

   An empty place at night keeps at most a dim pilot glow, never a full warm pool. Stale/disconnected authority
   clears people-driven warmth; fading departure silhouettes never relight a lamp. Filter samples against the
   current accepted presence before counting positions. The SIMULATED scenario is the only
   source of simulated people. With a Herald feed, nothing is invented: lights follow `crowd.lightFrame()` and the
   citizen samples, exactly as today. One citizen still has one presence window. Density comes from people being
   home, not from more lit panes.
2. **R2 — The hours look like their names.** Every value below is a starting point; tune it by looking.
   - **Noon:** a saturated blue zenith (about `#3f7fd0`) fading to a pale sky-blue horizon (about `#a8cdec`), not
     white. White clouds with soft blue-grey undersides cover about 25–35% of the upper sky, broken, never in
     stripes. The sun is warm (`#fff0d0`). Shadows are cool blue: the ambient fill is about `#8fb0e6`, weaker than
     the sun, so a shadowed wall reads blue rather than grey. Fog is light and blue, about 40% of today's density,
     so the castle and the far hills keep their colour.
   - **Dusk** (hour 19–19.5): a lilac zenith over a gold horizon band. The sun is low in the west-north-west (shadows
     run east-south-east) and throws gold rim light onto the west faces and roof ridges. Shadow sides are indigo
     (about `#4b4f9a`), never grey-green. Clouds are lilac with gold undersides.
   - **Night:** deep blue to violet, cool moonlit walls, stars. The warm lights are the only warm thing.

   Each hour carries its own fog density and exposure in `Environment`. A dusk frame passes the greyscale test: three
   clear value groups, with the lit windows and the beacon in the brightest.
3. **R3 — A lit window looks like a lamp-lit room.** The pane is brightest low and centred, and warms to amber at
   its edges. The frame and mullions stay dark, and the reveal and sill catch the light. Its halo is sized to the
   pane (at most 1.3× its size) and is never a blob. A lit window still reads from the hero camera across the town.
   An absent home's glass reflects the cool sky: a dark blue-grey gradient, never a black hole. By day, every pane
   reads as glass, not as a light. The 0.7 s fade, the LOD dither partition and the named sources stay as they are.
4. **R4 — Light spills.** A lit window makes a soft warm pool on its own wall and the street below, readable 3–5 m
   out, with a warm core falling through amber into the indigo. The warm term reads fully from hour 18.5 onward.
   Replace the squared falloff with a soft-knee curve that carries the pool further. Cap the warm contribution so
   lit plaster never clips to white after tone mapping, even where several pools overlap. Faces and clothes of
   citizens in a pool warm visibly. If the flood's six-neighbour shape shows as diamond pools, report `needs:`:
   report to main before changing flood transport beyond the narrow glass semantics granted here.
5. **R5 — Lamps are lit by passers-by.**
   - **Where they stand:** lantern posts at every junction, at the market and outside the castle gate, and along
     main streets and the castle approach every 18–24 m on alternating sides. Lanes get them only at bends;
     kingdom-land's `'trail'` edges get them only where they leave a street. The court's own lights are
     places-high's. Every post stands on the verge, never on the carriageway, inside a reserved lot, a kingdom-land
     site footprint or within 2 m of a door approach. Placement is deterministic for each layout. These are the
     only street lantern posts: no other lane places one.
   - **When they light:** each lamp is a `createPeopleLight` (Contracts) with a 7 m reach: it comes up over 0.6 s
     while any citizen sample is within reach, holds while people are near, then fades over 30 s after the last one
     leaves, so a route glows behind the people who walked it.
   - **Pilot glow:** the market and castle-gate lamps keep a 12% pilot glow while the stream is live.
   - **Day:** lamps are dark by day, following the same hour curve as the windows.
   - **The light itself:** a warm core inside the glass and a halo sized to the glass. Each lamp is an emitter in the
     air just below its lantern, in both the local and the kingdom field.
6. **R6 — The castle is home when the monarch is live.**
   - **Openings:** the painted slits become real recessed glass slits, with anchors on the exterior plane: two
     cells wide, five to six cells deep in the wall. The keep's town face gains two or three tall hall windows. The
     gatehouse passage gets a lantern hung inside the arch.
   - **Waking:** a fresh live monarch state starts a roughly 4 s sequence from the gate up the towers to the keep.
     Use that sequence's elapsed progress for hall warmth, modulated by the actual beacon strength. A small live
     kingdom still receives the whole ceremony; never wait for beacon > 0.9 (which a hamlet may never reach).
     Stale live state or a resting stream fades the castle. Castle slits remain civic live light, with no citizen
     name or extra presence window assigned to slot 65534.
   - **Light into the town:** castle emitters join the beacon field, so the arch soffit and the court paving warm.
   - **Silhouette:** the castle still reads first as limestone against the sky. Its windows are small and warm, not
     a lit office block.
   - **Shared castle.** This lane edits `castle-modules.ts` and `createCastle` (openings only). Places-high's
     parapet is its own blueprint in its own folder and replaces `castle:front:*` at integration, so the front
     curtains' slits stop showing there. This lane first cuts the keep stair's envelope and removes the keep's two small cloth
     banners in `createCastle`, then publishes that shell handoff before places-high mounts. Places-high pins its two long
     drops on the keep's town face near today's banner positions (local x 59 and 186): the hall windows sit
     between the drops, clear of them.
7. **R7 — Honest cost.** No full-screen post-processing and no new render targets: glow stays as source-sized
   quads plus the field. Batch repeated emitters/props; a small hero mesh is acceptable when its visible value justifies the cost. No geometry/material allocation per frame. Everything this lane creates is
   disposed. Report the added draw calls and triangles in the hero view, plus `inspect().fields.*.lastWorkerMs`
   with and without lamps. SwiftShader timings prove nothing: ask for a real-GPU check in the evidence block.

## Contracts

Main freezes actual cross-lane PeopleLight presentation types in `apps/web/src/kingdom/lights/types.ts`; import
`PeopleLightOptions`, `PeopleLightSource` and `PeopleLight` from that file. The signatures below describe their
use; the actual main-owned type module wins if it differs. Remaining lane-local APIs freeze with this spec.
They are not persisted schemas or protocol changes.
Existing authority is `KingdomPresenceFrameSchema` in `packages/shared/src/presence.ts`, `CitizenMotionSample` in
`packages/world/src/citizens/types.ts`, `VoxelBlueprintSchema` in `packages/shared/src/voxel.ts`, and
`LightFieldSource` in `apps/web/src/kingdom/light-field.ts`. Preserve their semantics. `Environment` in
`packages/render/src/atmosphere.ts` may gain `fogDensity`, `exposure` and `shadow` tint without removing fields;
update actual consumers, not a copied private Environment. The team integrator owns consumers outside the granted render files.

`apps/web/src/kingdom/lights/index.ts` exports the following local APIs, importing `KingdomLand`,
`SettlementPlan` and `CitizenMotionSample` from `@chatdom/world`, `SimulatedPresence` from `../presence-feed`,
`Dressing` from `../settlement-content`, and existing render/shared types from their actual packages:

```ts
/** SIMULATED only: an evening already under way. It goes through the world reducer, like createSimulatedPresence. */
export function createSimulatedEvening(
  layout: Pick<SettlementPlan, 'homes' | 'config'>, options: { firstSlot: number },
): SimulatedPresence & { replayArrival(): void };

export interface LampAnchor { id: string; position: Vec3; pilot: boolean; style: 'hearth' | 'tide' }
export function placeKingdomLamps(land: KingdomLand, ground: (x: number, z: number) => number):
  { props: Dressing[]; lamps: readonly LampAnchor[] };

export function createKingdomLights(scene: THREE.Scene, input: {
  layout: SettlementPlan; lamps: readonly LampAnchor[];
  castle: readonly (WindowHouse & { id: string })[]; beaconPosition: Vec3;
}): {
  update(input: { dt: number; hour: number; time: number; beacon: number;
    live: boolean; liveSince: number | null; // seconds, observed visual transition time, not claimed stream history
    citizens: readonly CitizenMotionSample[]; camera: THREE.Camera }): void;
  lampSources(): readonly LightFieldSource[];          // into the local and kingdom fields
  castleSources(): readonly LightFieldSource[];        // into the beacon field
  clear(): void; dispose(): void;
};

export function kingdomLightViews(layout: SettlementPlan):
  Record<'street' | 'castle', { eye: Vec3; target: Vec3; fov: number }>;
```

**The people-lit light,** the one shared mechanism for every warm light that wakes when someone comes near. It lives
in `apps/web/src/kingdom/lights/people-light.ts`, is re-exported from the lane barrel, and has no imports beyond
the main-owned pure PeopleLight types and shared `Vec3` (its source return is structurally compatible with `LightFieldSource`, without a runtime import
cycle). The lamps use it, and places-high, places-water and home-interiors import this actual module for theirs:

```ts
import type { PeopleLightOptions, PeopleLightSource, PeopleLight } from './types';
export function createPeopleLight(options: PeopleLightOptions): PeopleLight;
```

The actual main-owned types are present. Defaults: `near = position`, `pilot = 0`, `full = 1`, `capacity = 1`,
`rise = 0.6` s, `fade = 0.7` s. Reach/capacity are positive; seconds, vectors and strengths must be finite;
strengths are bounded 0–1, `pilot <= full`, rise/fade are nonnegative. Distance and source positions use the
caller's coordinate space. A stable source object prevents per-frame allocation. `clear()` flushes to zero,
including pilot, until the next accepted update.


Callers scale by their own hour curve and keep their own glow meshes. KL01 is this helper alone, with no civic,
land, renderer or scene dependency; make it an independently reviewable commit. Other lanes wait for its accepted
producer commit before implementing their consumer task. They may continue content and unlit geometry work.
No copied helper, fallback implementation, dummy module or unconditional-on stand-in may enter the integration
candidate. A seek backwards settles to the current accepted people (it does not reconstruct an unknown past
fade); deterministic capture first replays the producer's recorded inputs. Repeated same-time calls do not advance
a fade. `clear()` on the owning light set removes cached warmth on authority loss.

`createSimulatedEvening` details:

- **On open:** at `advance(0)`, 80–90% of homes are present, with stays that began 3–45 minutes earlier, so their
  citizens are already home and lit through the same motion/reducer path. All generated IDs and names belong only
  to the explicitly SIMULATED feed, never copied from live viewers. One name in three is disclosed as fixture data,
  and `firstSlot` is present and named. Never backdate a live observation, set `homeLit` by hand or bypass motion.
- **Through the evening:** every 20–40 s someone arrives and walks home, and their window warms. Every 45–90 s
  someone leaves, and their window fades.
- **Determinism:** it is deterministic for each seed, and seeking backwards reproduces the same frames.
- **`reset()`** returns to the evening.
- **`replayArrival()`** runs today's dark → one window → whole-town wave on the same feed, with a new epoch so the
  crowd clears.
- **Label:** the feed's label and every frame's origin stay `SIMULATED`.

`street` is eye height at the busiest junction near `firstSlot`, looking down its main street towards the castle.
`castle` is about 60 m from the gatehouse at the market, with the castle on the upper third.

## Scope

Write only:
- `packages/render/src/atmosphere.ts`, `packages/render/src/presence-lights.ts`, and in
  `packages/render/src/voxel-material.ts` its lighting, fog and grade terms. The packed vertex layout,
  `surfaceField` and `groundContact` stay as they are. Also these files' existing tests.
- Glass semantics only: `packages/content/src/materials.ts` for the existing glass flags (no palette addition),
  `packages/render/src/sun-shadows.ts`, `apps/web/src/kingdom/light-field-worker.ts`, `apps/web/src/kingdom/visibility.ts`,
  `packages/voxel/src/mesh.ts` and `packages/voxel/src/asset.ts`, and directly corresponding tests. Preserve
  existing packed vertices, worker protocols, collision solidity, material IDs and ordered-air carve behavior.
  `mesh.ts`/`asset.ts` already consume registry face/light flags; change algorithms only if actual glass evidence
  requires it. Visibility rays use existing registered `surface: glass` sight policy; light uses `blocksLight`, face culling
  uses `occludesFaces`, AO uses `occludesAo`, and collision still uses `solid`. No invented sight field/schema. Never set the shared clay
  material transparent or fade all opaque geometry to obtain glass. Material flags alone must not make opaque
  walls transparent. No wider core rewrite is granted.
- `apps/web/src/kingdom/lights/**` except main-owned `types.ts`: the modules above, their tests, the capture
  script and a README. `types.ts` is read-only; report a needed contract change to main.
- `packages/content/src/core/castle-modules.ts`, `createCastle` in `packages/content/src/core/index.ts` (castle
  openings, keep stair-envelope cut and removal of the two replaced keep banners only), and existing tests under
  `packages/content/src/core` that cover those edits.
- No `scene.ts` or `index.tsx` edits: the team integrator owns adapters listed under "Dependency gates and
  integrator recipe". The lane provides typed exported modules and an exact integration checklist. A later explicit main grant must name a disjoint hunk.
- This spec and `work/lanes/kingdom-light/{PRD.md,progress.txt}`.

Everything else is read-only:
- `packages/shared`, `packages/world`, and voxel files except the glass-only grant above
- light-field worker code outside the glass-only grant, `presence-feed.ts`, `citizen-scene.ts`, the citizen renderer
- the civic, street and home content lanes
- the Forge, build and stream code
- the root manifests and scripts

Other workers are editing this codebase too: keep their changes. Sub-agents never run git.

## Dependency gates and integrator recipe

| Gate | Exact owner/seam | Tasks blocked until it exists |
|---|---|---|
| M1 — Real scene adapter | The team integrator owns `apps/web/src/kingdom/scene.ts` and the debug wrapper in `index.tsx`. It selects `createSimulatedEvening` only in simulated mode; `play()` calls `replayArrival()`; applies `grade.exposure`/`fogDensity`; mounts/disposes lights; transforms castle anchors; appends lamp and castle sources to the correct three fields; supplies fresh live state, live start and only authoritative visible people. | KL02 integrated grade evidence; KL03 scenario mounting; KL06/KL07 runtime proof. Standalone render changes can proceed. |
| M2 — Capture pose | Main has added `__chatdomKingdom.pose(eye: Vec3 | null, target?: Vec3, fovDeg?: number): void`, updating real camera matrices/field invalidation. Captures use simulated mode; null restores production camera control. First-look owns hero/window/citizen camera recipes. | Custom street/castle captures in KL05–KL08. No alternate query camera or camera rewrite in this lane. |
| M3 — Geography | Main-owned land types now exist under `@chatdom/world`; kingdom-land must implement its actual producer before the team integrator mounts it. Lamp placement reads actual streets, lots, sites and door approaches. | KL06 complete lamp placement. Do not locally re-create future sites or plant lamps from a private land fixture in the kingdom. |
| M4 — Civic post | The team integrator brings reviewed civic CP04 into `lane/integrator`; the integrator's content barrel seam exports the actual `createCivicProp` and lantern contract after reviewing that candidate. | KL06 lantern geometry. No copied post. KL01 helper and other lighting tasks are independent. |
| M5 — Castle shell handoff | This lane cuts the keep stair envelope and removes the keep's two small banners in the first castle task, before places-high mounts. Places-high owns all cloth and the front parapet. | Places-high mounting until KL07 shell handoff, which must precede places-high mounting. Keep hall windows between accepted banner attachment positions, not guessed screen coordinates. |
| M6 — Glass and interior treatment | Kingdom-light owns visibility/transmission, mesher faces, sun blockers and light occupancy under the narrow file scope below. The shared painterly room treatment is coordinated with home-interiors/tavern through the integrator. | Home-interiors clear-window evidence until KL04 glass commit; no separate main glass patch. Main freezes shared presentation types; realm later binds persistent records and door entry. |

Main freezes the presentation signatures before dependent tasks start. When a gate is absent, write `needs:` and
continue independent tasks; mark the dependent task blocked, never complete. Read-only fixtures used for placement
unit checks are labelled and test-only; they cannot become scene data or imitation contracts.

The team integrator merges reviewed lane branches into `lane/integrator`, one at a time, and resolves shared-file
conflicts in its composition adapters. Main judges only the candidate Tobias announces ready. Main does not merge these
individual lane branches. `pnpm verify` and standard kingdom/Forge/content views are checked on that candidate,
because the grade is shared beyond this lane. An unfrozen consumer gate is visible in the final evidence.

The integrator recipe must use the actual lane exports below. This is the target call order after the producer
commits exist, not a claim that these new modules are implemented at handoff:

```ts
import { createSimulatedEvening, placeKingdomLamps, createKingdomLights } from './lights';
// land is the accepted KingdomLand producer output, not a type-only placeholder.
const { props: lampProps, lamps } = placeKingdomLamps(land, groundAt);
// Append lampProps BEFORE compiling content/near blockers and shadow casters.
const lights = createKingdomLights(scene, {
  layout: land.plan, lamps, castle: castleBuildings, beaconPosition,
});
// Only options.source === 'simulated' selects this producer's feed.
const evening = createSimulatedEvening(land.plan, { firstSlot });
```

Per frame, advance simulated presence only in simulated mode, apply the accepted frame to motion, sample motion,
then pass only currently present slots with visible non-leaving samples to `lights.update`. `live` is
`frame.streamLive && frame.connection === 'fresh'`; `liveSince` is the presentation-clock second when that live
state was first observed in this epoch, not an invented historical stream start. On epoch/authority loss call
`lights.clear()` and reset the observed transition. Apply `renderer.toneMappingExposure = grade.exposure` and
`fog.density = grade.fogDensity` alongside existing Environment updates, and preserve other consumers.

```ts
lights.update({ dt, hour, time, beacon, live, liveSince, citizens: acceptedCitizens, camera });
// Preserve existing window/build sources. Interior/place sources join their accepted owner routes.
field.update(centre, [...windows.getSources(), ...build.getSources(), ...lights.lampSources(), ...interiorSources]);
farField.update(centre, [...windows.getSources(), ...build.getSources(), ...lights.lampSources()]);
beaconField.update(beaconPosition, [
  { position: beaconPosition, strength: beacon, normal: [0, 1, 0] }, ...lights.castleSources(),
]);
// Existing explicit replay clears windows/crowd and presentation history, then:
evening.replayArrival();
// Teardown (also in failure/abort cleanup):
lights.dispose();
```

`centre`, `groundAt`, `acceptedCitizens`, `interiorSources`, scene ownership and light throttling are integrator
variables derived from actual accepted producers. The lane README must replace them with the exact final imports
and calls for that candidate. Never add placeholders to runtime to make this illustrative recipe compile.

## Acceptance

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/render apps/web/src/kingdom packages/content/src/core packages/voxel
pnpm build
node apps/web/src/kingdom/lights/capture.mjs [--views hero,street,castle,window,citizen] [--hours noon,dusk,night] [--base-url URL]
```

**The capture script** is written in KL02:
- It takes the machine-wide capture lock (`packages/testing/capture-lock.mjs`) before it starts a browser or server.
- It starts its own Vite preview on a free port in 5170–5199, or reuses `--base-url`, and records the port. It stops
  only what it started.
- It loads `/?source=simulated&seed=willowmere&tier=town&time=30` with `camera=hero|window|citizen` for those
  views, and sets `street` and `castle` through `__chatdomKingdom.pose` from `kingdomLightViews`. It sets the hour
  and waits for the actual `__chatdomKingdom.stats.ready` and `lightingReady` flags. At a fixed capture time it
  may additionally wait for the actual `fieldSettled` revisions. It never sets these flags, replaces failed jobs,
  hides error UI, disables workers or treats continuous live queue idleness as public readiness. See
  `work/DECISIONS.md` (Inhabited visits). Missing pose/readiness APIs fail visibly.
- It fails on any console, page or shader error.
- It writes `shots/kingdom-light/<view>-<hour>@WxH.png` and a greyscale copy of each dusk shot.

**Selected final set:** hero dusk at 1440×900/390×844; a street/window/face pool detail sheet; castle dusk and
a small live-hamlet sequence; hero noon/night as a compact comparison. Reuse task frames. Per iteration take only
one or two shots needed to judge the change, not the full view/hour/size matrix. Glass has its one reciprocal
inside/outside regression view. No repeated field-budget proof or capture of unchanged benches.

**Looking:** open every shot with `view_image` at full size and as a thumbnail, and judge it against
`Artstyle-Soul-Feel.md` §§1, 2 and 6.2 and the Quality slop list. Fix what looks cheap. Write what changed, and
what still looks weak, in the README and the progress line.

**Tests** cover only real risks, with one solid test each:
- The evening scenario: one reducer-backed trace checks open occupancy, leave/rejoin, reverse seek and explicit
  wave replay; outputs validate against `KingdomPresenceFrameSchema` and remain `origin: 'simulated'`. Include
  live-source isolation in the adapter review, not a mock claiming that an unmounted module affects the town.
- Lamps: placement legality and determinism; `createPeopleLight` lighting on a pass, the fade, the pilot glow and
  the seek-back settle, same-time stability and clearing on authority loss.
- The castle openings: real air or glass behind every anchor, an anchor on the exterior plane, and module sizes
  unchanged. Glass regressions exercise the same wall/glass/ordered-carve scene through actual meshing, sky,
  light blockers and sun casters; do not prove only that a copied flag table says transparent.

## Quality bar

- **The thumbnail test:** a dusk hero frame should read as "a handmade toy kingdom lit by its people" at thumbnail
  size, the way Townscaper's lit dusk towns read: a warm field of windows to count under a lilac sky, pools of light
  on the streets, a crowned castle with warm slits, and indigo everywhere no one is.
- **Street level:** aim at the best warmth and spatial clarity of Townscaper, Tunic, Tiny Glade and Animal Crossing,
  translated into Chatdom's richer saturation and toy clay. Prototype shots diagnose the old implementation; they
  are not the quality ceiling. It should feel like a street you want to return to at night. Warm on the faces and cobbles
  near people, cool blue elsewhere, and lamps glowing ahead along the route you are on.
- **Noon:** it should look like a clear summer day, not fog.
- **Never:** white blow-outs, halos bigger than their source, a lit window where nobody is, grey-green shadows, or
  a grey sky.

## References

- `work/references/sky-fog-time.md`: authored cyclic grades, fog coherent with the sky, and stars fading by contrast;
  a stylised sky, not a physical one.
- `work/references/voxel-meshing-light.md`: bounded coloured light through the grid, and the warm core shaded the
  same for everyone.
- `work/references/prototypes.md`: Lanternmere's night look and its warmth at street level, reimplemented here.
- Spec 02 (the light field and its decisions), spec 10 (civic lantern post), and
  `work/DECISIONS.md` ("One citizen, one presence window", "Inhabited visits").

Related lanes: [ground-dressing, spec 28](28-ground-dressing.md), [places-water, spec 29](29-places-water.md),
[home-interiors, spec 31](31-home-interiors.md) and [first-look-polish, spec 32](32-first-look-polish.md).

## Not now

These belong to other owners:
- castle/place banners, the court and its parapet lanterns (places-high; other cloth stays with its existing owners)
- the pier lantern and mill lamp (places-water), the place lanterns (places-high) and interior lights
  (home-interiors), all built on this lane's `createPeopleLight`
- the water's light pillars and the lake
- terrain texture, ground cover, trees and ridgelines
- street layout and the facing of homes
- citizen faces, hair and capes
- interiors and the campfire's light
- fireflies and moths
- sub tier tints on light edges
- the stream view's framing
- any change to presence semantics, the light-field flood or its budgets

## Decisions

- **2026-10-30 — One citizen, one window stays.** Coverage in the labelled simulation comes from a real reducer-backed fixture evening already under way and from
  light that spills. Live coverage is always its actual witnessed presence, with no additional citizen panes.
- **2026-10-30 — Lamps and the castle are lit by people.** Passers-by light lamps. The monarch's live stream lights
  the castle. Absence leaves at most a pilot glow.
- **2026-10-30 — No full-screen post-processing.** Source-sized glow and the shared field carry the look on every
  device tier; bloom is not part of this lane.
- **2026-10-30 — One people-lit light.** Every light that wakes for passers-by, in every lane, runs on
  `createPeopleLight`, so they all rise, hold and fade the same way.

- **2026-10-30 — Review corrections, accepted in this freeze.** KL01 is the dependency-free helper. No local
  consumer stand-ins; no copied future contracts. The team integrator owns scene/debug adapters; this lane owns glass. Home-interiors
  coordinates the reusable painted-room treatment; missing producer evidence stays visibly pending. A small kingdom's live castle sequence completes without
  an audience-strength threshold. Capture readiness comes from real completed work. The team integrator owns
  lane integration, and main judges the announced candidate.
