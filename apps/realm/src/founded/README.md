# Founded town producer

The production path reads the current adopted revision and its exact stored `SettlementPlan`. It never calls
`generateSettlementPlan`. `assembleFoundedScene` replaces each committed owned plot's native home and retains
only its currently attached approved parts. Public scene fields are explicitly allowlisted and validated,
including nested plan records. Ownership, wishes, names, receipts and private state are absent from scene bytes.

Real exports in `index.ts`:

```ts
assembleFoundedScene({ kingdomId, plan, state, collisionRevision, native?, materials? })
  // Promise<{ scene, bytes, manifest, geometryDigest, homes, counts }>
decodeFoundedScene(bytes: Uint8Array, manifest: RealmFoundedManifest): Promise<RealmFoundedScene>
createFoundedWorld(scene: RealmFoundedScene)
  // { scene, world: CollisionWorld, anchors: readonly Vec3[], options: DurableKingdomOptions }
createFoundedWorldLoader(source: FoundedLayoutSource, store: FoundedWorldStore)
  // { prepare(kingdomId), load(kingdomId,state), options(kingdomId,state), current(kingdomId) }
new FileFoundedStore(configuredSharedDirectory, { scenes: 4096 })
  // native(kingdomId,plan,origin), revision(kingdomId,geometryDigest), put(bytes,manifest), get(sceneHash)
prepareFoundedWalkerPositions(plan, nextWorld, walkers)
  // ReadonlyMap<walkerId, Vec3>; all input walkers covered, clear supported peers retained
```

`loadAdoptedPlan`, `createNativeTown`, `NativeTownCache`, canonical JSON/hash helpers and validation limits/errors
are also exported. `validate.ts`/`codec.ts` are browser safe. The collision wrapper is shared at
`@chatdom/world/founded-collision`, re-exported by realm `collision.ts`; it imports no realm, Node or content code.

## Installation

```ts
const store = new FileFoundedStore(configuredSharedDirectory);
const loader = createFoundedWorldLoader(allocationService, store);
await loader.prepare(kingdomId); // native baseline + terrain before acquiring the existing kingdom writer
// Existing createDurableRealmServices receives kingdom: loader.options.
// Its existing held writer supplies committed RealmPrivateState; no second writer is opened here.
const prepared = loader.current(kingdomId);
// After a trusted registry hold and preparePublicCheckpoint(), use the actual authority's public checkpoint:
const manifest = prepared?.manifestFor(realPublicCheckpoint); // null until public versions agree
```

`loader.load(kingdomId,state)` also returns the prepared world for composition/adoption. Bytes can be prospective;
`manifestFor` requires matching kingdom/layout/collision revisions and every current public owned-home revision,
content digest and attached part IDs. The composition owner must also enforce actual adoption and access policy,
retain/release the existing registry and prepare its public checkpoint before exposing a receipt.

Read handlers call `store.get(manifest.sceneHash)` and return those exact checked bytes. The host owns route
registration, access/withdrawal policy and no-store manifest responses. A content hash grants no read permission.
The file store bounds individual scene bytes and configured scene count, checks SHA-256 on reads, and inserts
immutable files atomically with file/directory sync. Its collision catalog assigns checked uint32 numbers to
full geometry identities; no hash truncation or process-local revision authority. Native baseline scenes are
pinned per kingdom/origin/layout and checked against the exact plan, so factory upgrades do not replace native
homes on restart. Attached Forge geometry is still assembled through its committed registered kit/version;
reloading a stored accepted full-scene receipt uses `decodeFoundedScene`, not another assembly.

For initial composition from any checked scene:

```ts
const scene = await decodeFoundedScene(bytes, manifest);
const { world, options } = createFoundedWorld(scene);
// Feed scene to <Kingdom founded={scene} ... /> and this same world to walking/server options.
```

Renderer `foundedContent(scene)` already mounts all placements by asset hash, suppressing duplicate legacy homes,
castle, market, trees and gardens. Turns rotate about the local blueprint origin, yaw `rotation * Math.PI / 2`,
then translate in world metres. Retain the existing warm materials, visible terrain, water and horizon.

Terrain uses the renderer's 16 m chunk footprint, exact 0.5 m cell centres and rounded half-metre occupancy.
The smoothed visible metre triangles may differ from physical contact; visual easing remains with walking.
Known terrain ends at the render footprint, including vertical bottom -16 m/ceiling 496 m; unknown space blocks.
Lake-bed heights remain below the animated water sheet. Only landform v1 has installed terrain dispatch today;
future versions fail explicitly. A four-entry cache compares exact plan text and returns defensive height copies.
Prewarming removes the expensive first sampling from the writer-opening window. Safe arrival search is bounded;
after its finite anchor capacity is consumed, arrival fails explicitly. The authority must recheck current poses
and revision before adopting prepared safe positions; this producer does not publish or move walkers itself.

## Current fixture and verification

`artifacts/simulated-town.scene.json` and `.manifest.json` are the inherited **SIMULATED** adopted-town fixture:
240 homes, 924 placements, 49 assets, 8,241 source boxes, 1,390,717 exact bytes. SHA-256:
`6ead01954728f974a1969ed835a9888df858519db1ec0ae87298c82347421a99`.
It includes one replacement home, one attached Forge part and a retained displaced part omitted from the scene.
The original fixture was recorded through allocation/persistence; these focused tests verify its exact bytes,
not live founding, naming, Twitch or authentication. No regeneration script or audit artifact is installed.

Focused checks: `pnpm exec vitest run apps/realm/src/founded` and scoped ESLint/typecheck. The full-town parity
case compiles the same fetched bytes at both ends and compares stable queries and the existing `stepPlayer`,
terrain/lake/unknown-space behavior, safe spawn and changed-geometry bystander placement. Store/loader checks cover
restart receipts, changed approved home revisions, concurrent revision identities, corruption, private-field
exclusion and held public readiness. Last measured parity case: 10.1 s; loader/store case: 5.5 s on this host.
Compiler workspace is per unique asset (at most one Uint16 + one Uint8 per 16,777,216 cells), not a dense fine town
grid; terrain is one bounded half-metre column field. Screenshots and the three-browser journey belong to main.

The adopted fixture has no accepted pier/landing, tavern, campfire or civic-place sites. None is manufactured to
claim plaza-to-pier acceptance. No kingdom-level approved public name is currently in the realm contract.
