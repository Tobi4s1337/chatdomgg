# Founded scene producer

Spec: `work/specs/38-founded-kingdom.md` · Lane: `work/lanes/realm-server-world/PRD.md`.

This folder turns a kingdom's adopted plan and its committed private state into the public `RealmFoundedScene`.
That scene is the town people walk: its castle, streets, homes, garden edges, market, groves, and each citizen's
approved home with its attached Forge parts. The bytes are immutable and identified by SHA-256. The browser decodes
those exact bytes and renders them. It never regenerates the town.

FW01 covers the scene, its validation, its bytes and the current-town artifact. FW02 adds the collision compiler
(`packages/voxel/src/collision`) and this folder's one collision adapter (`collision.ts`), so server and browser walk
the same solids. Still to come: the loaded-state provider with its store, revisions and anchors (FW03), and the
furnisher and GET handlers (FW04).

## Exports (`apps/realm/src/founded/index.ts`)

```ts
// Byte identity. Browser-safe: WebCrypto + TextEncoder, no Node imports.
canonicalSceneJson(value: unknown): string        // sorted keys, -0 → 0, finite numbers only
sha256Hex(bytes: Uint8Array): Promise<string>
assetHashOf(blueprint: unknown): Promise<string>  // SHA-256 of the blueprint's canonical bytes

// Validation and bytes. Browser-safe (zod, @chatdom/shared, @chatdom/shared/realm, world *types* only).
FOUNDED_SCENE_LIMITS  // assets 1024, placements 8192, boxes 1e6, homes 4096, bytes 48 MiB, extent ±4096 m
class FoundedSceneError extends Error { code: 'realm.founded-scene' }
validateFoundedScene(input: unknown): Promise<RealmFoundedScene>
encodeFoundedScene(scene: RealmFoundedScene): Promise<{ bytes: Uint8Array; manifest: RealmFoundedManifest }>
decodeFoundedScene(bytes: Uint8Array, manifest: RealmFoundedManifest): Promise<RealmFoundedScene>

// Server: the adopted plan and native content.
type FoundedLayoutSource = Pick<AllocationService, 'origin' | 'currentLayout' | 'layoutPlan'>
class FoundedUnavailableError extends Error { code: 'realm.founded-unavailable';
  reason: 'unfounded' | 'origin' | 'kingdom' | 'revision' | 'unsupported' }
loadAdoptedPlan(source: FoundedLayoutSource, kingdomId: KingdomId, state: RealmPrivateState): Promise<AdoptedPlan>
interface AdoptedPlan { kingdomId; origin: 'live' | 'simulated'; revision: string; foundedAt: number; adoptedAt: number; plan: SettlementPlan }
createNativeTown(plan: SettlementPlan): NativeTown          // pure; throws FoundedContentError
supportedLandform(plan: SettlementPlan): void               // landform v1 only; v2 waits for its sampler
class NativeTownCache { constructor(limit = 16); get(kingdomId, plan): NativeTown; readonly size: number }

// Server: assembly.
assembleFoundedScene(input: FoundedSceneInput): Promise<FoundedSceneBuild>
interface FoundedSceneInput { kingdomId; plan: SettlementPlan; state: RealmPrivateState; collisionRevision: number;
  native?: NativeTown; materials?: MaterialRegistry /* default MATERIALS */ }
interface FoundedSceneBuild { scene; bytes: Uint8Array; manifest: RealmFoundedManifest; geometryDigest: string;
  homes: readonly FoundedHomeBinding[]; counts: { assets; placements; boxes; ownedHomes; attachments } }
interface FoundedHomeBinding { plotId: string; source: 'native' | 'owned'; revision?: string; digest?: string; attachments: readonly string[] }
```

`simulated.ts` (`foundSimulatedTown`, `simulatedFurnisher`, `SIMULATED_TOWN`), `artifact.ts` and
`write-artifact.mjs` are fixture and evidence tools. They are deliberately left out of the barrel. Never compose
them for a live kingdom.

## How a scene is made

1. **The address book.** `loadAdoptedPlan` reads `AllocationService.currentLayout`, then the exact stored
   `layoutPlan` for that revision. It refuses in these cases:
   - no founded head: `unfounded`. Entry never founds a kingdom and never waits for a Genesis ritual.
   - the state's kingdom differs: `kingdom`.
   - the state's origin differs from the allocation's: `origin`.
   - the stored plan has a different revision: `revision`.
   - the landform has no installed sampler: `unsupported`.

   Nothing on this path is generated.
2. **Native content** (`createNativeTown`) follows the current dusk town's recipes. Placement IDs are stable:

   | Placement ID | What it is |
   |---|---|
   | `home:<plotId>` (with `plotId`) | the plot's reviewed native home (`createNativeForgeHost`) |
   | `garden:<plotId>:<n>` | front-garden pot, shrub or trough, and fence or wall, grounded on the plan's terrain |
   | `market:well`, `market:stall:0`, `market:stall:1` | the market's well and two stalls |
   | `castle:<moduleId>` | Tide castle modules at their adopted transforms |
   | `tree:<n>` | groves around inhabited courts plus seeded woodland, never in a reservation, castle, lake or public ground |

   The recipes come from `apps/web/src/kingdom/settlement-content.ts`, `castle-content.ts` and the grove planting in
   `scene.ts`. Native content is pure in the plan, so it can be cached (`NativeTownCache`) outside an opening's
   critical window.
3. **Committed overrides.** Each `state.homes[plotId]` replaces that plot's native home. It is never drawn on top of
   one. Its origin is `homeOrigin(plot, approvedDepth)`, using the plot's own cardinal frame. Only parts listed in
   `home.attachments` with `attached: true` are rebuilt, from their committed `draft.plan` and registered kit, against
   the socket that `findForgeSockets` finds on the committed home. Each is checked with `checkForge` and placed at
   `transformCardinalPoint(homeOrigin, rotation, origin × 0.125)`. Its ID is `forge:<attachmentId>` and it carries the
   home's `plotId`. A displaced part that is retained but not attached is absent.
   Anything inconsistent throws `FoundedSceneError`: a home on an unknown plot, a slot mismatch, a listed part that
   is not attached, an attached part that is not listed, a moved socket, an unregistered kit, a fingerprint mismatch,
   or a part that no longer assembles.
4. **Allowlist and bytes.** The scene is built field by field. Owner IDs, allocation, approval or judge receipts,
   names, words and rights never enter it. A test greps the encoded bytes for each of them. The scene is then:
   - canonicalised and passed through `validateFoundedScene`.
   - encoded. `assetHash` is the SHA-256 of each blueprint's canonical bytes; assets are deduplicated by that hash
     and keep their semantic IDs, so two versions sharing one ID stay two assets. `sceneHash` is the SHA-256 of the
     exact response bytes.
   - given its `geometryDigest`: a SHA-256 over every geometry input except `collisionRevision`. The revision owner
     (FW03 store) maps one digest to one uint32 and never reuses a revision for another digest. FW02 binds its
     compiler version there too.

`validateFoundedScene` checks:

- the exact top-level and plan key sets, and the receipt fields.
- the material registry.
- every blueprint: its schema, its bounds, known materials only, and its recomputed hash.
- unique placement IDs, finite bounded positions and cardinal turns.
- that every asset and plot reference resolves.
- exactly one `home` placement per plan home, and no unreferenced asset.
- count and byte bounds.

It never repairs anything. `decodeFoundedScene` also requires the bytes' SHA-256 and the receipt's kingdom, origin
and both revisions, so an old receipt cannot pick up new bytes.

## The current-town artifact (SIMULATED)

| File | What |
|---|---|
| `artifacts/simulated-town.scene.json` | exact immutable scene bytes, **1,390,717 B** |
| `artifacts/simulated-town.manifest.json` | its receipt (`origin: "simulated"`, `collisionRevision: 1`) |
| `artifacts/simulated-town.evidence.json` | SIMULATED evidence: counts, hashes, timings, memory, absent dependencies |

- `sceneHash` `6ead01954728f974a1969ed835a9888df858519db1ec0ae87298c82347421a99`
- `geometryDigest` `8f1122605164f55c39724a58c1dd6096b602d4ff649dca47a97425c14474d905`
- kingdom `900000001`, layout `settlement:2:23b3c1b5`, seed `simulated-founded-town`, tier `town`, 2022–2026.
- 240 plan homes, 924 placements, 49 unique assets, 8,241 voxel boxes.
- 683 native fixtures: 408 garden edges, 260 trees, 12 castle modules, 3 market pieces.
- 1 owned home (`plot:2023:8`, an approved rebuild in another reviewed form) with its attached part
  `simulated-run-2`. The part it displaced, `simulated-run-1`, is retained in state and absent from the scene.
- The plan is 804,412 B of the scene.
- Timings on this shared host, in milliseconds, under varying host load. `evidence.json` holds run 3.

  | Step | Run 1 | Run 2 | Run 3 |
  |---|---|---|---|
  | load the adopted plan | 13 | 19 | 15 |
  | native content (cacheable) | 811 | 1,481 | 899 |
  | assemble, validate and encode | 328 | 599 | 286 |
  | decode and verify | 83 | 102 | 76 |

- RSS grew by 59–62 MB while founding, assembling and decoding. Heap use was 102–106 MB.
- All three runs gave the identical `sceneHash`. The bytes do not depend on database time or the schema.

All of this is a fixture authority:

- SIMULATED kingdom and adopted plan. Native generation is used here only, as spec 38 allows.
- SIMULATED citizen, signed tenure, names approval, build approval and judge receipts.

It is committed through the real `AllocationService` (adopt, allocate, prepare) and the real fenced
`PostgresRealmRepository` writer, then read back with `currentLayout`/`layoutPlan`. It is not live founding, naming,
sign-in or Twitch evidence.

To regenerate it, run this from the repository root. It needs `DATABASE_URL`, uses a fresh throwaway schema, drops
that schema afterwards and prints no connection details:

```sh
node --env-file-if-exists=.env apps/realm/src/founded/write-artifact.mjs
```

## Renderer installation recipe (main/integrator)

The browser mount already takes `<Kingdom founded={scene} presenceFeed={...} walk={...} />`
(`apps/web/src/kingdom/README.md`). `foundedContent(scene)` installs every placement by asset hash and treats the
plot's `kind: 'home'` placement as its window house. The installed path draws no legacy castle, trees, market or
gardens. Every one of those is a placement here, so nothing else needs adding.

1. **Decode in the browser with this producer's module.** `validate.ts` and `codec.ts` import only `zod`,
   `@chatdom/shared`, `@chatdom/shared/realm` and *types* from `@chatdom/world`. They need a registration from main;
   choose one:
   - (a) Recommended: relocate the two files unchanged into `packages/world/src/founded-world/` and export
     `validateFoundedScene`, `decodeFoundedScene`, `encodeFoundedScene`, `FoundedSceneError` and
     `FOUNDED_SCENE_LIMITS` from `@chatdom/world`. This lane then re-exports them.
   - (b) Add a subpath to `apps/realm/package.json`: `"./founded-scene": "./src/founded/validate.ts"`.
2. **Entry, live.** Once FW04 serves the routes:

   ```ts
   const manifest = RealmFoundedManifestSchema.parse(await (await fetch(`/api/realm/founded/${kingdomId}`, { cache: 'no-store' })).json());
   const bytes = new Uint8Array(await (await fetch(`/api/realm/founded/scenes/${manifest.sceneHash}`)).arrayBuffer());
   const scene = await decodeFoundedScene(bytes, manifest);   // throws on any mismatch; never regenerate
   const collision = compileFoundedCollision(scene, { terrain: terrainFromRenderField(field) }); // see "Collision"
   // then join with the actual ticket, with collision.revision === manifest.collisionRevision
   ```

3. **Entry, now (SIMULATED).** Read the two artifact files instead of fetching, then call the same
   `decodeFoundedScene(bytes, manifest)`. For example, `packages/testing/kingdom-walk.mjs` can replace its test-only
   scene with this one. Keep the SIMULATED label visible: `manifest.origin === 'simulated'`.
4. **Transforms.** A placement sets `yaw = rotation × π/2` about the blueprint's local origin, then translates by
   `position`, in metres. This matches `transformCardinalPoint` and the existing `foundedContent`.
5. **Terrain.** The renderer keeps sampling `terrainHeight(scene.plan, x, z)` from the exact plan. Its existing 1 m
   surface, half-metre worker occupancy, water, horizon and warm materials stay as they are. Collision reuses the
   renderer's own sampled field (below), so both ends stand on the same half-metre ground.
6. **Do not** add the procedural anvil, local saved homes or parts, or a seed or tier from a URL to a founded mount.

## Collision (FW02)

The same decoded scene compiles to the same immutable `CollisionWorld` on both ends. The pure compiler lives in
`packages/voxel/src/collision/` and imports only `@chatdom/shared` and `@chatdom/shared/realm`, with no world, content,
web, Three or Node modules. `collision.ts` in this folder is the one founded adapter. It is browser-safe too: a trial
browser bundle is 164 KB minified with no `node:` imports.

```ts
// packages/voxel/src/collision/index.ts (main registers it as @chatdom/voxel/collision)
COLLISION_COMPILER_VERSION = 1;  COLLISION_LIMITS;  class CollisionCompileError { code: 'voxel.collision-compile' }
collisionSolidity(materials: readonly { id: number; solid: boolean }[]): CollisionSolidity
compileCollisionAsset(blueprint: CollisionBlueprint, solidity: CollisionSolidity): CollisionAsset
class CollisionAssetCache { constructor(limit = 512); resolve(key, blueprint, solidity): CollisionAsset; readonly size }
terrainFootprint(terrain: SampledTerrain): TerrainFootprint;  terrainBoxes(terrain, out: number[]): number
compileCollisionWorld(input: { revision: number; materials; blueprints: ReadonlyMap<string, CollisionBlueprint>;
  placements: readonly { id; blueprint; position: Vec3; rotation }[]; terrain: SampledTerrain; cache?: CollisionAssetCache }): CompiledCollisionWorld
interface CompiledCollisionWorld extends CollisionWorld { footprint: TerrainFootprint; stats: CollisionWorldStats }
interface SampledTerrain { cellMetres; originX; originZ; columns; rows; heights /* tops in cells */; bottom; ceiling }

// apps/realm/src/founded/collision.ts (also in this folder's barrel)
FOUNDED_TERRAIN_SAMPLER = 1;  FOUNDED_TERRAIN  // 0.5 m cells, 16 m chunks, bottom -16, ceiling 496, ground > -4
class FoundedCollisionError { code: 'realm.founded-collision' }
sampleFoundedTerrain(plan: SettlementPlan): SampledTerrain       // server: pure, cache per plan revision
terrainFromRenderField(field: RenderedTerrainField): SampledTerrain // browser: reuse prepareTerrainField(plan)
compileFoundedCollision(scene: RealmFoundedScene, options?: { terrain?: SampledTerrain; cache?: CollisionAssetCache }): CompiledCollisionWorld
foundedCollisionKey(geometryDigest: string): string             // `${digest}:c${compiler}:t${sampler}`
```

What the compiler guarantees:

- **Final cells decide.** Each blueprint's ordered operations resolve on a coordinate-compressed grid. That grid is
  cut only where an operation starts or ends, so it is exact at the asset's own lattice (build 0.125 m, avatar
  0.0625 m) and never larger than the asset's dense volume.
  - Later operations overwrite earlier ones, and material zero carves.
  - Solidity is `VoxelMaterial.solid` of the final material, so glass is solid to bodies.
  - An unknown material ID anywhere in a blueprint refuses it.
- **Openings survive.** Final solid cells are coalesced greedily: along X, then Z, then Y, only over solid cells. The
  boxes are disjoint and cover exactly the solid cells, so a door, passage or one-cell pane stays as authored.
  Boxes are rotated by the placement's cardinal turn (`transformCardinalPoint`) and translated, never resnapped.
- **Terrain.** Equal-height half-metre columns merge into rectangles. Each is solid from `bottom` to its own top,
  so every half-metre step keeps its face. Water is the real lake bed with the visible sheet above it, never a
  floor and never filled in.
- **Unknown space blocks.** Six barriers enclose the known volume: west, east, south and north of the terrain
  footprint, below `bottom` and above `ceiling`. Their outer faces are at ±Infinity, which the solver and camera
  occlusion handle. Bounds that cannot be read (NaN, or min > max) return the barriers, never air.
- **Queries.** A query returns every box that intersects or touches its bounds, without duplicates. The order is
  stable: placements by ID in code-unit order, each in asset order, then terrain, then barriers. Boxes and arrays
  are frozen and created once per box.
  - The index is a horizontal bucket grid with 4 m buckets. Its edge doubles if the grid would pass 1M buckets.
  - A query's only workspace is one mark per box, allocated with the world. There is no dense fine grid over the
    kingdom.
- **Identity.** `revision` must be a uint32. A cache key is the caller's immutable asset key (`assetHash`), the
  compiler version and the set of solid material IDs. A change in solidity therefore recompiles, and FW03's
  recompile after one home changes reuses every other asset.

**Terrain: occupancy versus the visible ground.** Collision samples exactly what the renderer's terrain worker
samples, with the same recipe:

- 16 m chunks from the floored plan bounds.
- 0.5 m columns sampled at their centres with `terrainHeight`.
- Tops rounded to the half-metre lattice.
- A base at -16 m and a ceiling 32 chunks above it.

The visible ground is a 1 m tessellation of the continuous `terrainHeight`, so it can sit up to about a quarter
metre above or below a column top. Walking eases the feet onto the visible surface; collision never turns a step
into a ramp.

Home plinths keep the rounded terrain at or below every interior floor. In the artifact this holds for all 240
homes, sampled under every floor-level carve, and in the worst case the two are exactly level. The parity test's
walker stands on the owned home's floor at `position.y + 0.25`.

Only plan v2 with landform v1 has a sampler. Anything else is `FoundedCollisionError`, never flattened ground.
`foundedCollisionKey` binds the compiler and sampler versions to FW01's `geometryDigest`. That digest already covers
the plan, materials, assets and placements. FW03 maps one key to one uint32 and never reuses it. The FW01 digest
formula and the artifact are unchanged.

### Browser recipe (main/integrator)

1. Register `"./collision": "./src/collision/index.ts"` in `packages/voxel/package.json`. Then change the single
   relative import at the top of `collision.ts` to `@chatdom/voxel/collision`.
2. Give the browser `collision.ts` by the same route chosen for `validate.ts`/`codec.ts`. Either move it with them
   into `packages/world/src/founded-world/`, which adds `@chatdom/voxel` as a world dependency (voxel does not depend
   on world, so there is no cycle), or add the realm subpath `"./founded-collision": "./src/founded/collision.ts"`.
3. In the entry adapter, after `decodeFoundedScene`:
   - Take the field the terrain worker already builds for this plan: `prepareTerrainField(scene.plan)` in
     `apps/web/src/kingdom/terrain-worker.ts`.
   - Call `compileFoundedCollision(scene, { terrain: terrainFromRenderField(field) })`. Reusing the field avoids a
     second sampling pass.
   - Without a field, `compileFoundedCollision(scene)` samples the plan itself and gives the identical world.
4. Pass the result as `KingdomWalkBinding.collision` / `KingdomEntryConnection.collision`. Its `revision` is
   `manifest.collisionRevision`. It replaces the test-only market-floor `CollisionWorld`. No other change to
   movement or the room is needed.

### Evidence (SIMULATED authority, actual town geometry)

`parity.test.ts` decodes the FW01 artifact bytes twice:

- as the server would: it samples the plan itself.
- as a browser would: a separate copy of the bytes, the renderer's own terrain field and its own asset cache.

It compiles both and checks:

- **Same world.** The terrain, stats and 3,000 deterministic queries across the footprint and past its edges are
  identical on both ends. Queries are stable and duplicate-free.
- **Doorway.** `stepPlayer` carries a walker from the owned home's front garden (`plot:2023:8`, the approved
  rebuild) through its carved doorway. The walker lands grounded on the interior floor and is not stuck. Two
  metres along, the same walk stops at the solid front wall. Both ends give bit-identical states.
- **Glass and the attached part.** Every one-cell glass pane of that home is solid. The attached part
  `forge:simulated-run-2` adds solids only inside its own bounds; a world compiled without it lacks them.
- **Cardinal turns.** For each of turns 0 to 3, the smallest placement standing clear of all others matches its
  replayed final cells, cell for cell, above the ground.
- **Terrain and edges.** A walker climbs and descends a real half-metre step in open ground. At the west edge it
  stops exactly at `minX + 0.28`. Space beyond the footprint, below the bottom and above the ceiling is solid.

Measured on this shared host, with load average 12 to 19 on 9 cores:

| Measure | Value |
|---|---|
| Boxes | 174,392: 155,787 structure, 18,599 terrain, 6 barriers |
| Placements and assets | 924 placements, 49 assets |
| Index | 15,946 buckets of 4 m, 327,647 entries, 10.4 MB packed |
| Heap growth | about 27–29 MB, including decode |
| Terrain sampling (`sampleFoundedTerrain`) | 7.1–12.3 s for 772,096 columns |
| Compile with sampled terrain | 0.48–0.77 s |
| Recompile, cold asset cache | 0.38 s |
| Body-sized query | 2.2 µs mean, 3 boxes mean, 56 at most (200,000 queries) |
| Renderer's `prepareTerrainField` in Node | about 41 s (the browser already pays this to draw the ground) |

**For FW03.**

- Terrain sampling dominates, because `terrainHeight` grades about 193k corners. Sample once per plan revision,
  outside an opening's critical window, and keep it, for example next to `NativeTownCache`. An opening then
  compiles in under a second.
- Keep one `CollisionAssetCache` per kingdom, so a home or Forge change recompiles only its own assets.

## Needs and absent dependencies

- **Kingdom name.** Realm authority has no kingdom-level approved public name. The only approved names are
  per-home `attribution.kingdomName`/`makerName`, and their `approvalId` is private.
  - The scene therefore serializes no name.
  - Main needs to freeze a public field, for example `kingdomName` on `RealmFoundedScene` or `RealmBootstrap`. It
    must be sourced from a naming-approval record that the Genesis/naming owner supplies.
  - Until then, live entry has no approved name to show, and must not fall back to a seed or URL name.
- **Realm bundling.** When main composes this producer into `apps/realm/src/main.ts`, `vite.config.ts` needs
  `ssr.noExternal` to include `@chatdom/content`, `@chatdom/forge` and `@chatdom/voxel`. They are TypeScript source
  packages. A trial SSR build of this barrel with those entries bundles (269 KB).
- **Readiness comparison (FW03).** Public `home` views carry `assetHash: home.digest`. That digest is chosen by the
  furnisher or build publisher; Codex hashes `JSON.stringify(home)`, which is not canonical. It is not this scene's
  `assetHash`. Readiness compares each `FoundedHomeBinding` (plot, committed `revision`, `digest`, attached part IDs)
  with `RealmBootstrap.current`, not the asset hash.
- **Opening cost of owned parts (FW03).** Each owned home with attached parts needs one socket survey,
  `assembleForge` and `checkForge`: a few hundred milliseconds on this host. FW03 should cache the verified part
  geometry by the home's canonical asset hash and the committed attachment, so an opening rebuilds only what changed.
- **Absent accepted places:** the full list is `ABSENT_PLACE_DEPENDENCIES` in `artifact.ts`. None is stood in for.

  | Missing | Status |
  |---|---|
  | Pier or landing | No accepted site or content, so plaza→pier acceptance waits for it. |
  | Forge anvil | A browser presentation, not adopted static content. |
  | Civic places | Reviewed blueprints exist, but no adopted site places them. |
  | Tavern, campfire and interiors | None adopted. |
