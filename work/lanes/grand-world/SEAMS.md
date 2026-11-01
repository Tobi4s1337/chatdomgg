# grand-world: our side of each seam

The seams are frozen for this round. A seam changes only when both lanes write the change into their SEAMS.md.
When another lane or the integrator must act, grand-world writes `needs: <who> <what>` in its progress with the
exact patch, and keeps going on work that does not depend on it.

## 1. Ground and collision (grand-world to play)

grand-world owns the land and the query that tells a walker the ground height, the surface material and the solids
at a point. play owns the controller, camera, input and footsteps that use it. play never edits land generation;
grand-world never edits the controller.

### The query today, exactly

| What | Module and function | Notes |
|---|---|---|
| Solids | `compileFoundedScene(scene: RealmFoundedScene): CollisionWorld` in `packages/world/src/founded-world/collision.ts`, imported as `@chatdom/world/founded-collision` | Compiles the founded scene's terrain (`sampleFoundedTerrain(plan)`, half-metre cell centres rounded to the half-metre lattice, landform v1, at most 32 x 32 chunks of 16 m) plus every placed asset, through `compileCollisionWorld` in `packages/voxel/src/collision`. The realm re-exports the same module (`apps/realm/src/founded/collision.ts`) and uses it for room authority (`apps/realm/src/founded/provider.ts`). The client walk gets its world from the entry adapter (`apps/web/src/kingdom-entry/live.ts` and `simulated.ts`, front-door's files) and `scene.ts`. |
| The solids interface | `CollisionWorld { revision; query(bounds: SolidBox): readonly SolidBox[] }` in `packages/shared/src/realm/movement.ts` | Frozen shared contract. |
| Ground height | `foundedGroundAt(plan, x, z): Vec3` in the same module | Physical ground at the half-metre lattice. A caller still checks support and body clearance in the compiled world. |
| Ground facade | `createKingdomLandInterface({ scene, ground, collision }).groundAt(x, z)` in `packages/world/src/land-interface.ts`, exported from `@chatdom/world` | Physical exterior top in world metres, or null outside the installed physical region. Not an indoor multilevel query and not walking permission. Also carries `forge`, `moments` (plaza, castle gate), `paths` and `light` anchors. |
| Surface material | Only `createHomeStepMaterial(scene)` in `apps/web/src/kingdom/walk-footsteps.ts` (play's file), for accepted home geometry | There is no terrain surface query yet. |
| Movement law | `stepPlayer(state, input, dt, world)` in `packages/world/src/movement/step.ts` | The consumer. grand-world does not edit `packages/world/src/movement/**`. |
| Visual height only | `HostedGrandLand.height(x, z)` in `apps/web/src/kingdom/grand-land/index.ts`, and the `ground`/`landHeight` passed to moments and cover in `scene.ts` | Drawn land height for cameras, dressing and visual anchors. Never a walking surface. |

### What grand-world guarantees

1. **The drawn floor is the walked floor.** Inside the walkable region (the known region of the current collision
   world), every half-metre column's drawn top equals `foundedGroundAt(...)[1]` and the top of the compiled terrain
   solid, on the old land and on the grand land, at whatever level of detail is drawn. Grand regions that touch the
   walkable region are pinned to full detail. A test checks every column on tobi4s_'s real founded scene.
2. **Stable entry points.** The signatures and meaning of `compileFoundedScene`, `foundedGroundAt`,
   `createKingdomLandInterface` and `CollisionWorld` stay as they are. Server and client call the same code, so the
   room and client prediction agree bit for bit.
3. **Unknown space stays solid.** Outside the walkable region the query returns barriers, never air. A far or
   smoothed surface never becomes a collider.
4. **Nothing solid-looking without a collider.** Inside the walkable region, anything drawn that looks solid (castle
   rock, walls, trees, bridges, quays) is in the collision world, or it is not drawn there.
5. **Revisions tell the truth.** Any change to physical coverage or to how ground is sampled changes the collision
   revision and the `FOUNDED_PHYSICS_VERSION` identity, and arrives through the existing installed-world handshake.
   `stepPlayer` already holds a walker still on a mismatched revision.
6. **Cost.** The query inside the walkable region costs what it costs today. If grand collision pages are installed
   (`createPagedCollisionWorld` in `packages/world/src/grand-adoption/pages.ts`), the target is p95 at or under 0.25 ms
   per query, measured on the doorway route.

### What grand-world adds (additive, announced here when it lands)

- **A terrain surface query** for footsteps, in `packages/world/src/founded-world/collision.ts` (proposed
  `foundedSurfaceAt(plan, x, z)` returning `'grass' | 'stone' | 'earth' | 'sand' | 'snow' | 'wood' | 'water' | null`, in the
  same audio material names as `createHomeStepMaterial`). The exact name is written here when it lands; play
  adopts it in its footsteps.
- **A land map for the minimap and the lantern path** (decision 36): a small top-down raster of height, cover, water,
  roads and the walkable and revealed extent, in settlement metres, exported from `packages/world/src/grand/`
  (name written here when it lands).
- **A wider walkable land** (GW13 and Backlog), only when grand collision pages from the baked recipe are installed
  on both ends under a new revision. That needs the realm room and the founded scene receipt to change:
  `needs: integrator` with the patch, never a silent change.

### What play may rely on, and must not do

- play may rely on guarantees 1 to 6 on every kingdom, old land or grand land.
- play never samples render meshes, `HostedGrandLand.height` or depth buffers for walking, and never edits files
  in this lane's scope.
- If the controller ever sees the drawn floor and the walked floor disagree, play writes a `needs: grand-world
  ground mismatch <kingdom> <x,y,z>` line; grand-world treats it as a bug in this seam.

## 2. Scene mounting (grand-world to everyone)

`apps/web/src/kingdom/scene.ts` (`createKingdomScene(options: SceneOptions)`) and its composition belong to
grand-world. The stream view mounts it through `apps/web/src/stream/mount.ts`; the kingdom page through
`apps/web/src/kingdom/index.tsx`. There is one scene, one camera owner at a time, one renderer and one render loop.
Other lanes mount through the existing hooks: the `SceneOptions` callbacks (`onProgress`, `onReady`, `onNames`,
`onSpeech`, `onMomentCaptions`, `onBuild`, `onWalkers` and the rest), `createKingdomWalk` (play's
`walk-scene.ts`), `createKingdomMoments`, the Forge owners, and the debug handle `__chatdomKingdom` (`pose`,
`inspect`). A lane that needs a new mount point asks with a `needs: grand-world mount <what>` line; grand-world adds
a small typed mount that hands over caller-owned scene, camera, ground and tick, resize and dispose.

Files in `apps/web/src/kingdom/` that are not grand-world's: `walk-scene.ts`, `walk-footsteps*`,
`walk-interactions*`, `walker-*`, `observed-walkers*`, `citizen-scene*`, `window-camera.ts` (play); raid files in
`moments/` and `arrival-director*` (raid-show).

What each lane gets from the scene host:
- **play:** typed mounts in the kingdom host for the in-world HUD, the Esc menu and the minimap (`apps/web/src/play/**`);
  the ground seam above; the land map.
- **forge-wish:** the Forge square, anvil and approach from `land.forge`; forged pieces keep their installed
  positions on the grand floor; the Forge panel mounts in play's HUD slot, not in the scene.
- **raid-show:** arrival and raid moments get the plaza and castle-gate anchors from `land.moments` and supported
  points along the raid road. The `ground` passed to moments is visual outside the walkable region; any point
  where a raider stands must come from the physical query.
- **front-door:** the loader (B05) is one module this lane owns (proposed `apps/web/src/kingdom/loader/**`), driven
  by real step events. front-door mounts it in its entry gate (`apps/web/src/kingdom-entry/`), so the loader runs
  without a break from the gate into the open scene. For the front page, `/-/grand` keeps its query (`channel`,
  `hour`, `view`, `still`) stable, and grand-world can export a `mountGrandView(el, options)` on request.
- **panel-window:** the loader is offered for the panel; a kingdom picture from the baked land can follow on request.
- **The studio lane (`apps/studio`):** reads `/-/grand`, `/stream` and the walk; their query parameters stay stable.
  Staged crowds stay on benches.

## 3. HUD shell (play to forge-wish and raid-show)

Not grand-world's. grand-world only hosts play's HUD through the typed mount above.

## 4. Atlas embed and picker (atlas-map to front-door and raid-show)

grand-world reads the Atlas data (channel categories and identity) for Genesis landforms in GW13 and edits nothing
in `apps/surveyor/**` or `apps/web/src/atlas/**`. Kingdom placement on the Atlas stays atlas-map's.

## 5. Shared contracts

grand-world may add one new file, proposed `packages/shared/src/land.ts`, with the land manifest schema (kingdom id,
the founded scene hash and revisions it belongs to, recipe version and hash, seat and bounds, and per region and
level the blob hash and byte size) and its GET routes, exported additively. No existing export changes. Binding the
land recipe hash into `RealmFoundedManifest` or the founded scene receipt, and changes to
`packages/world/src/founded-world/validate.ts`, `codec.ts` or `types.ts`, are `needs: integrator` lines with the
patch written out.

## 6. Shared entry files

- `apps/realm/src/server.ts` or `main.ts`: one additive line that registers the land routes from
  `apps/realm/src/land/**`, and one that hooks the bake into founding if the founding module offers a hook. If
  founding itself must change (`apps/realm/src/founded/**`), that is a `needs: integrator` line.
- `apps/web/vite.config.ts`: one additive proxy line for the land routes, if they are not under an existing proxy.
- Deploying the land routes and data to the live realm and the public gateway is the integrator's and Tobias's:
  `needs: deploy` with the data directory, the bake command and the routes.
- No new dependencies are expected (Node's `zlib`, the browser's `DecompressionStream`).

## GW10 checkpoint — 2026-11-01

The host now resolves an explicit pinned recipe in `kingdom/grand-land/recipes.ts`; only kingdom `129634568`
has one. `packages/world/src/grand/recipe.ts` holds the detached immutable recipe and its SHA-256 identity.
The scene inspector exposes `land.identity.recipeHash` separately from the installed `parameterHash` and
`planRevision`. No walking or scene-receipt contract changed, and the query entry points in seam 1 are unchanged.
The real founded scene at collision revision 11 passed an exhaustive 772,096-column drawn/physical/collision
check. Evidence and remaining interaction proofs are in `work/evidence/grand-world/GW10.md`.

## GW10 stream source boundary — 2026-11-01

`/stream` requires a live founded realm receipt; staged stream playback is registered at `/-/stream` with
one additive entry-map line. The existing internal source/provenance values and shared contracts are unchanged.
The bench also accepts explicitly selected local realm receipts for revision/ceremony rehearsals.

needs: integration update shared capture URLs (these files are outside this lane's write scope):

```diff
--- packages/testing/shots.mjs
+++ packages/testing/shots.mjs
@@
-      await capture('/stream', 'stream', [[1920, 1080], [1280, 720]], true);
+      await capture('/-/stream', 'stream', [[1920, 1080], [1280, 720]], true);
```

In `packages/testing/growth-handoff.mjs`, replace the middleware predicate `path==='/stream'` with
`path==='/-/stream'` and the capture URL suffix `/stream?source=realm&kingdom=999000001` with
`/-/stream?source=realm&kingdom=999000001`. Make those same two literal replacements in
`packages/testing/growth-ceremony.mjs`. These staged receipts deliberately retain their original provenance;
do not change it to live to bypass the public-stream guard. Comments referring to the capture route should
use `/-/stream` as well.

needs: signed-in walk check `http://localhost:5192/?walk=1&kingdom=129634568` during our GPU lease, with an
authenticated isolated realm and Tobias's actual deed mapping. The private public scene proves the floor,
representative doorway/wall and Forge/moment/raid support but cannot identify the broadcaster's owned plot.

## Gather: exterior portal, campfire and camera — 2026-11-01

The latest portal decision supersedes the earlier tavern interior footprint request. The founded tavern asset,
placement and footprint remain unchanged. No tavern interior mounts into the kingdom scene.

Implemented additive API in `packages/world/src/land-interface.ts`:

- `places.tavern?: TavernDoorAnchor` contains `position: Vec3` (supported feet outside the porch),
  `facing: number` (world radians, zero +Z, facing **into** the doorway), `placementId` and `assetHash`.
  Both old/common and grand land facades use the same installed growth-civic door adapter. It verifies the
  authored aperture after ordered voxel writes, then checks full-body clearance and physical support.
  Unknown, closed or unsupported geometry yields no anchor and a diagnostic. Gather derives the return
  facing by reversing this yaw and checks its return feet against the current collision world.
- `PlaceSite { origin: Vec3; turn: CardinalTurn; footprint: readonly [number, number] }` uses a blueprint's
  local corner as origin, with local +Z as the open side. `places.campfire` is optional. Planning an empty
  18 × 18 m footprint is explicit installation-time work through `placeSites` options / `planPlaceSites`;
  it is not a per-frame search. All reserved lots, roads, civic spaces and installed solids are excluded.
  Every intersecting terrain column must agree, and real collision tops must cover the entire footprint.
  Pass a previously accepted clearing as `pinned`; failure never silently relocates it. This planner reserves
  or grades nothing itself. The founded installer must persist the choice before adding campfire content.

Real Willowmere receipt revision 11 provides tavern feet `[6,9,-5.625]`, inward yaw π. The bounded campfire
search examined 512 candidates and found none: 247 reserved-lot, 44 uneven-ground, 74 placement-overlap,
92 civic-overlap, 55 road-overlap. This is not proof that no possible clearing exists. No campfire anchor is
claimed for this revision; gather/integration need an authored, validated candidate or an explicit ground
migration. No lot, home, road, asset or placement was moved.

Implemented scene hooks, exported from `apps/web/src/kingdom/scene.ts`:

```ts
interface PlaceMount {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly placements: readonly { id: string; position: Vec3; rotation: CardinalTurn; assetHash: string }[];
  localFeet(): Vec3 | null;
  hour(): number;
  quality(): 'high' | 'balanced' | 'low';
  claimPlacement(id: string): void;
  onTick(fn: (dt: number, now: number) => void): () => void;
  onResize(fn: (w: number, h: number) => void): () => void;
}
type PlaceMounter = (mount: PlaceMount) => () => void;
// SceneOptions.places?: readonly PlaceMounter[]
```

`claimPlacement` is a necessary additive refinement of gather's original proposal. After mounting its visual,
a provider explicitly claims an exact installed `gather:campfire:*` ID during synchronous initialization.
Only successful claims remove host drawing; no mounter/no claim leaves normal geometry visible. Missing,
duplicate, late, tavern and home claims fail initialization and roll back owners. Original collision and light
blockers remain. The host owns tick, resize and teardown; a mounter must release partial GPU allocations if
it throws before returning a disposer. The callbacks use frame `dt` in seconds and `now` in monotonic ms;
`hour()` reads the actual shared scene hour. `capture` post quality maps to `high` for this interface.

Implemented kingdom-scene game cues in `apps/web/src/stream/director.ts`:

```ts
interface DirectorCue {
  readonly id: string;
  readonly priority: 'game';
  readonly shot: PlaceShot; // existing { eye: Vec3; at: Vec3 }
  readonly until: number | null; // epoch ms; null until withdrawn
}
interface DirectorCueSource {
  subscribe(receive: (cue: DirectorCue | null) => void): () => void;
}
```

A source publishes its current cue on subscription and null on withdrawal/connection loss. Sources passed to
`StreamView` via optional `directorCues` props must belong to that verified kingdom; optional `places` props
forward the same mounters into each scene revision. Subscriptions are replaced with the visible scene and
released on hiding/disposal. `director.connect(source)` also supports explicit composition. Equal game
priorities use stable subscription order. Snapshots detach mutable producer arrays; invalid/expired updates
withdraw the previous cue. The temporary shot cancels pending tour shutters and resumes the underlying tour
when withdrawn. Walking, capture, Forge, build, arrival, major moments, growth, dock and handoff retain priority.

The host API is `scene.setPlaceShot(PlaceShot | null)`; it never cancels raids or changes the camera mode.
`inspect().placeShot` reports requested/active. **These cues frame the kingdom only.** Selecting and mounting
an independent tavern-room scene for the stream is still pending; it cannot be implemented by pointing this
kingdom camera at tavern-local coordinates. needs: gather a public tavern spectator/mount contract (source
scene, readiness, disposal and room identity) for the stream's source-scene switch. Campfire cue composition
can use the implemented hook now. needs: gather mirror these accepted hook details in its SEAMS before
calling the seam frozen. Package-root reexports of the new land types are an integration-owned additive line;
the owned land-interface module already exports them directly.

Exact additive root export requested for `packages/world/src/index.ts`:

```ts
export { planPlaceSites, validatePlaceSite, findTavernDoor, type PlaceSite, type TavernDoorAnchor, type PlaceSitePlanningOptions, type KingdomPlaceSites } from './land-interface';
```

## Pier anchors and kingdom layers — 2026-11-01

Read pier's section 3. Its proposed `apps/realm/src/fishing/site.ts` was absent at the start of this checkpoint
and appeared during verification; the new implementation and `packages/content/src/pier/layout.ts` were
then read. The land seam adds validation of authored candidates, not a second production candidate search.

`KingdomLandInterface.piers?: readonly PierAnchor[]` uses pier's exact shape: stable `id`, dry supported
`root`, cardinal `turn` (local +Z over water), `waterY`, centreline `depth` at 1 m steps including dry root
depth 0, `water: 'lake' | 'river' | 'sea'`, and producer-supplied `biome`. The shared old/grand facade accepts
optional `water: LandWaterSource` and `pierSites: PierSitePlanningOptions`; no options means no planning work.
The new modules are exported directly from `packages/world/src/land-interface.ts`.

Planning requires explicit deck dimensions (`width`, integral `length`, `landingDepth`, `waterStart`,
`minDepth`, `minFreeboard`) and authored candidates or an exact saved `pinned` anchor. Store dimensions with
the anchor. The full rectangle must avoid every reserved lot, road including verge, civic site and existing
solid placement. Actual collision must continuously support the dry landing and clear the entire standing
volume. Unknown ground/collision fails closed. Pins never relocate; existing `pier:*` placements stop
empty-site planning and require a separate installed-content adapter.

`LandWaterSource` is revision-bound and supplies `sample(x,z)` plus a continuous `coverage(bounds)`:
explicit dry, wet with level/depth/kind/biome, or unknown. Coverage additionally supports `shore` for a known
mixed shoreline. The complete deck requires a known shore certificate; landing must be entirely dry and
the wet extension entirely wet at one level. Thus tiny unknown/dry holes cannot hide between probes.
`apps/web/src/kingdom/grand-land/water-source.ts` adapts the actual renderer's basin/raster inputs and
physical half-metre bed columns. Depth uses physical ground, never the shader's interpolated bed. Metadata
is explicitly supplied and detached; no lake, sea or biome is inferred. Multi-basin/reach continuous coverage
is not yet implemented and returns unknown. Installed arrays remain producer-owned and immutable.

The effects host is exported from `apps/web/src/kingdom/scene.ts`:

```ts
registerKingdomLayer(id: string, mount: KingdomLayerMounter): () => void;
// KingdomLayerMounter = (host: KingdomLayerMount) => () => void
// host: scene, camera, mode, kingdomId, founded, hour(), waterHeight(x,z),
//       onTick(listener), quality, signal, active()
```

This implements pier's requested mount plus `active()`. Registration mounts into existing and future founded
kingdom scenes; unregister/abort disposes every associated mount. Mode/quality/hour are live getters. Stream
hosts declare `mode:'stream'`; other hosts report walking/watching. `waterHeight` queries the current visible
water owner, including replacement by the grand raster; hidden old water never supplies a fallback. Tick `dt`
is seconds and `now` monotonic ms. Effects must check `active()` before witnessing live events: it is false
for replay, hidden warming canvases, unloaded scenes, suspended rendering and hidden documents. No geometry
claims are made; founded pier planks and collision remain owned by the normal scene. A throwing initializer
must release its own partial GPU/network resources; the host clears its callbacks and new roots.

The newly arrived pier uses a 2.5 m walk, an 8 m T-head, a bank ramp and a deck datum 0.75 m above water;
`root.y` is physical ground, not that raised datum. Its whole geometry cannot be authorized by passing the
2 m × 12 m flat rectangle used in our initial diagnostic probe. **The current flat rectangular validator is
not yet an adapter for that authored pier.** The probe found no valid common site among 512 candidates;
this is evidence of that probe's failure, not proof that Willowmere has no possible pier.

needs: grand-world/pier compose the authored T footprint and ramp/deck-height validation with the real
renderer-backed water source, preserve pier's stable candidate order, and use the pinned recipe's `woodland`
biome rather than deriving a biome from a landform or defaulting to meadow. Persist accepted anchors with
their geometry, add the consumer registration once `mountPierLayer` exists, and mirror the accepted contract
here in pier's SEAMS. No production pier is installed by this checkpoint. First/rare director attention,
the shared kingdom clock and water-mood adoption remain pending; the campfire game cue is not a replacement
for a first/rare attention contract. Main owns the additive package-root export:

```ts
export { planPierSites, validatePierSite, type PierAnchor, type LandWaterSource, type PierSitePlanningOptions, type PierPlanningDimensions } from './land-interface';
```

### Authored pier proof (GW10 follow-up)

The flat rectangle above is now accompanied by an additive exact-content validator:

```ts
validateAuthoredPier(context, proposal, { pinned?: AuthoredPierCertificate }): AuthoredPierResult;
createFishingPierProposal({ site, pieces, fishing, groundAt, biome }): AuthoredPierProposal | null;
fishingPierCandidates(plan, groundAt, shoreHint): Generator<FishingPierGeometry>;
```

These are exported from `packages/world/src/land-interface.ts`. The facade accepts
`authoredPier: { proposal, pinned? }` and exposes `authoredPier` evidence and, only on success, `piers`.
Do not pass both the old flat `pierSites` option and `authoredPier`. Neither installs or publishes content.
`pieces` are the actual factory blueprints with their world transforms; `fishing` is the factory's actual
build-cell fishing anchors. The mapper keeps the separate `deckY`, the 2.5 m approach, full T-head and
casting rectangles. The biome comes from the pinned recipe, not the fallback landform character.

The validator preserves every founded placement, future reservation, road and civic exclusion, verifies
continuous water coverage and the physical bed, compiles the supplied ordered voxel writes, and runs the
shared walking controller from the dry approach through the gateway to every fishing position and back.
It checks full-body bank support and actual rails/furnishings, including unknown collision barriers.
Explicit work budgets bound parsing, voxel compilation, queries and movement. A certificate contains the
exact detached/frozen proposal and material-solidity identity; it is local evidence, **not** a founded scene
receipt or permission to walk on an uninstalled deck. Persist the geometry with an accepted anchor and
revalidate that exact installation; never rerun candidate search to move an existing pier.

Candidate enumeration preserves the current fishing producer's seed/turn/lateral/back/walk order (at most
540 proposals). Its shoreline callback is only a search hint. Every proposed site still requires the renderer
water certificate and actual compiled geometry. The actual factory's bank-step rejection remains binding.

Point water evidence additionally distinguishes `shore` with `depth: 0` when visible water meets the known
physical bed **exactly**. A surface buried below the physical bed remains unknown. The authored validator
allows zero-depth contact only in the first four metres of the bank approach, never at the root, wet head
or casting area. Wet samples require positive depth; missing bed, metadata or coverage remains unknown.

needs: integrator add these package-root exports when composing the pier owner:

```ts
export { validateAuthoredPier, createFishingPierProposal, fishingPierCandidates,
  type AuthoredPierCertificate, type AuthoredPierProposal, type AuthoredPierResult,
  type FishingPierGeometry } from './land-interface';
```

needs: pier mirror this additive proposal in its SEAMS when adopting it, supply actual factory pieces and
fishing anchors, persist only an accepted certificate, and keep using one producer. The external-factory
integration check is opt-in through `GRAND_PIER_PRODUCER`; production code has no cross-worktree imports.

**Real receipt result:** proposal 328 of the preserved candidate sequence passes on both old and grand
water: `root:[172,0.5,217]`, `turn:1`, `waterY:-0.5`, `deckY:0.25`, `walk:20`, `water:'lake'`,
`biome:'woodland'`. Its six actual factory modules contain 1,949 ordered voxel writes and compile to 461
solid boxes. All three fishing positions pass a 560-tick there-and-back route without jumping. Both facades
return the same anchor and depths. Details: `work/evidence/grand-world/gw10-authored-pier.json`.
The original fallback root `[238.25,0,229]` fails a body-volume collision check at its bank; centre-point
support alone is insufficient. This validated alternative is a **founding proposal**, not authorization to
relocate a pier that has already been published. No existing scene or production pier was changed here.

needs: pier/integrator determine whether a pier has already been published before adopting the new proposal;
if it has, revalidate its saved geometry and repair through an explicit migration, never silently reroll it.
The full local certificate is generated by the opt-in acceptance check under ignored `shots/grand-world/`.
`GRAND_PIER_CERTIFICATE` runs exact saved-certificate revalidation without the neighboring factory or a search.

## Public grand view: the installed kingdom (GW10)

`/-/grand?channel=tobi4s_` now opens the same verified founded scene, live watch and pinned grand recipe as the
native stream. The view no longer generates a substitute channel profile or town. `channel` accepts the adopted
login or full kingdom ID; `kingdom` is an equivalent explicit ID parameter. Conflicting/unknown identities and
kingdoms without an adopted recipe show an unavailable state, never another kingdom. Fixture query flags have
no authority. The existing four-land landscape study moves to `/-/grand-bench`; the main entry mapping has one
additive line. That route is an explicit bench, not a live kingdom or additional public gateway request.

The public viewer uses `createSceneMount` and `createRealmSpectatorSource`, retaining verified receipt decoding,
revision replacement, shared presence/Forge/growth/moment/walker/chat feeds, and failure/cancellation cleanup.
Only a live scene and matching live manifest are accepted. It exposes no join, input or movement authority.
The dock connection has optional `{ readOnly: true }`; the grand observer uses it and cannot acknowledge a royal
act, even if the current browser has a presenter grant. Existing stream callers retain their prior behavior.

The native host adds optional `SceneOptions.overview` and explicit `mode:'watching'`. A bounded orbit owner is
created only for founded scenes with a pinned grand recipe. It uses the hosted land's world-space bounds and
actual installed blueprint extents, then updates inside the host's existing render loop. No second renderer,
world or animation loop is added. Walking and explicit evidence framing take precedence; cinematic camera
owners do not move the overview lens. Existing non-overview stream/kingdom cameras keep their behavior.

`scene.overview` is optional and exposes `orbit(yaw,pitch,distance)` (radians, pitch above horizon; null preserves
a component), `reset()` and `inspect()`. Scene revision handoff preserves its true eye/target/FOV; it does not
replace the target with a point 16 metres ahead. Controls release on suspension, walking or disposal.
The UI readiness flag follows the native loaded draw; the map/hour/reset shell never claims an unloaded world
is ready. `still=1` hides chrome only after readiness, never hides a loading or failure state.

needs: gather provide a public tavern spectator transport before source-scene switching is composed. The current
`mountTavern(...).games(GatherFrame)` accepts public snapshots, but `connectTavern` is the authenticated walker
adapter; no public observer connection was found. The exterior door and campfire seam remain unchanged.
