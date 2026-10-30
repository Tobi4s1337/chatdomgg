# The kingdom scene and walking

Main owns composition here. Entry/public-state adapters stay in the realm-wiring lane; immutable scene and
collision production stay in realm-server-world. This is the existing dusk kingdom, not another court renderer.

`Kingdom` accepts `{ founded?: RealmFoundedScene, presenceFeed?: PresenceFeed, walk?: KingdomWalkBinding }`.
The entry adapter fetches the current manifest, verifies the exact scene bytes/hash and producer validation,
compiles that same scene's collision world, then connects using the actual session/ticket adapter. Render
`<Kingdom founded={scene} presenceFeed={roomPresence} walk={binding} />` after those steps. A live founded scene
requires its injected room feed; it never falls back to simulated lights or direct Herald SSE. The ordinary
spectator bench retains its existing explicitly labelled scenario.

`KingdomWalkBinding` is in `walk-scene.ts`:

```ts
{ client: RealmClient, collision: CollisionWorld | RealmCollision,
  manifest: RealmFoundedManifest, hud?: HTMLElement, heading?: number,
  onSceneNeeded?: () => void }
```

The component supplies its own HUD element. `heading` is arrival camera framing in radians, not an authority
pose. The mount rechecks kingdom/origin/layout/collision before and after preparing people. The scene installs
the exact adopted plan and all supplied placements, batches by asset hash (distinct bytes may share a semantic
blueprint ID), and adds no legacy scatter, local saved home/parts or unlisted procedural anvil. Scene validation
and hash verification belong to the producer/entry adapter; this browser composition is not an auth boundary.

For an already drawn scene, `engine.attachWalk(binding)` attaches the same runtime asynchronously;
`detachWalk()` removes its controller/people, and `selectWalk(boolean)` switches between walking and the
existing spectator views. The caller owns the network client and disposes it after detaching/unmounting.
`walkDebug()` exposes the existing controller's observed state. The component's existing development hook
`window.__chatdomKingdom` exposes attach/detach/debug too; it cannot issue identity, rights or publication.

The controller ticks once per frame, including idle ticks while a camera owner has released it. Build,
housewarming, Forge and evidence cameras take precedence; returning to walking clears the old projection
offset. Fixed presentation time still draws walking motion. People are culled against the final camera, with
nearby names checked against the actual shells. First-person turning invalidates building frustum selection.

An authority geometry change releases controls, removes the old walker presentation and calls
`onSceneNeeded` once. The component covers the old scene until entry supplies/remounts a newly verified bundle;
it never enables walking against a different scene revision. RW06/main still own coherent authority adoption.
No client-side publication fallback is enabled by this mount.

`node packages/testing/kingdom-walk.mjs` runs three real SDK browser clients in this actual town component.
Its labelled **SIMULATED** scene and memory authority are test-only. The temporary `CollisionWorld` knows only
an open, sampled market rectangle and treats outside space as solid. That check demonstrates the browser
integration, WASD/phone input and shared movement, not the finished collision producer, live identities,
house entry or plaza-to-pier acceptance. It uses free owned ports and the serial machine-wide capture lock.
