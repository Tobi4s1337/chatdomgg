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
