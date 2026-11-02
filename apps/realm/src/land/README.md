# Offline land bake and immutable store

`bakeFoundedLand` accepts exact scene bytes, their validated live receipt, the pinned recipe, an isolated
`LandArtifactStore`, cancellation and real progress callbacks. It never fetches or mutates a live realm. It
validates the receipt and recipe/compiler/dimension identity before allocating the land, then uses the same
installed-floor preparation and packed mesher as the native worker.

The bake writes one normalized gzip blob at a time. Physical regions have level zero only; every other region
has all four levels. Once every surface and mesh has been reopened and verified, the producer pins the recipe
and publishes a receipt binding. Timings are returned separately and never enter content identity.

`store.ts` uses flushed temporary files and atomic hard links. Existing bytes, recipe pins and receipt bindings
cannot be overwritten. A failed or interrupted bake can leave unreferenced blobs, but no partial binding. A
different recipe requires an explicit future migration, not another invocation of this command. The store has
no latest pointer and does not infer a current scene from timestamps.

Build and run from the worktree root:

```sh
nice -n 10 node work/lanes/grand-world/build-bake.mjs
UV_THREADPOOL_SIZE=2 nice -n 19 node shots/grand-world/bake-cli/bake.mjs \
  --scene /tmp/grand-world-scene.json --receipt /tmp/grand-world-manifest.json \
  --recipe shots/grand-world/adopted-recipe.json \
  --directory shots/grand-world/land-bake-a --report shots/grand-world/bake-a-report.json
```

Inputs must already exist. The receipt/scene are private local copies of the public founded GET and remain out
of version control. The recipe file is the exact serialized adopted recipe in the web recipe registry. The
bundler preserves the existing eager artisan registry; plain Node TypeScript imports do not implement its
`import.meta.glob`. No dependency or shared package export was added. The CLI bounds the background pool to two;
the mesher is single-threaded and compression jobs are sequential. Do not bake while holding a capture/GPU lease.

The directory contains `recipes/<kingdom>.json`, `blobs/<raw-sha256>.gz`,
`bindings/<kingdom>/<scene-hash>.json` and `plans/<kingdom>/<recipe-hash>/<source-plan-hash>.json`.
The last is an immutable catalogue of completely verified plans, not a latest/current pointer. New bakes
publish it after full verification and before the receipt binding. Store limits are 128 MiB raw / 8 MiB compressed per blob. The stricter
format limits apply during codec validation. Gzip headers have mtime zero and OS 255; both compressed and raw
digests and lengths are verified. See the [format](../../../../packages/world/src/grand/baked/README.md).

`readLandRoute` is a read-only HTTP adapter. Source registration uses `mountLandRoutes` when
`REALM_LAND_DIRECTORY` is explicitly set; no live service has been configured by this lane:

- `/api/realm/land/<kingdom>/<scene-hash>`: the complete immutable receipt binding.
- `/api/realm/land/<kingdom>/<scene-hash>/<raw-blob-hash>`: only a blob referenced by that binding's validated
  metadata, returned as `application/gzip`. There is no `Content-Encoding`: clients verify gzip bytes before
  bounded decompression. Successful responses have immutable caching, ETags and HEAD/304 support.
- Unknown/unpublished content is 404. Corrupt or missing published bytes are 503, never a generation request.

The serving host must use the same store directory and forward status, headers and bytes. The adopted native
renderer now uses a bounded verified download/cache source with no grand generator. A land binding is visual
artifact provenance, not an expanded collision region or an amendment to `RealmFoundedManifest`.

## Reusing a complete plan across receipts

`publishFoundedLand({sceneBytes, receipt, recipeHash, store, sourceSceneHash?, signal?})` verifies the exact
scene bytes against their live receipt, owns its input snapshot, and requires the original pinned recipe hash.
It hashes the entire decoded plan, not only its revision label. It selects either the target's existing binding,
an explicitly named published source binding, or the exact plan catalogue entry. It reopens and verifies every
referenced blob before cataloguing and binding the target. Home/Forge assets can change while the land's plan
stays identical; no terrain blob is rewritten. Changed plans throw `LandNeedsBakeError` (`land.needs-bake`).

For an older store without a catalogue, first publish its already-bound original receipt, or explicitly give
that receipt's hash as `--source-scene` when publishing a new receipt of the same plan. There is no directory
scan, timestamp selection or fallback to an arbitrary bake. Conflicting immutable content fails closed.

```sh
nice -n 10 node work/lanes/grand-world/build-publication.mjs
UV_THREADPOOL_SIZE=2 nice -n 19 node shots/grand-world/publication-cli/publish.mjs \
  --scene /tmp/grand-world-scene.json --receipt /tmp/grand-world-manifest.json \
  --recipe-hash 86e07b05766f3e69994b9418e58a4bfb250bd7874ebe74d339a3b87f09d9b05d \
  --directory shots/grand-world/land-bake-a --report shots/grand-world/publication-report.json
```

The publication executable imports no generator, mesher or artisan registry. Use exact historical scene bytes
and their matching receipts when preparing history, one explicit receipt at a time. This command does not
make a derived test receipt authoritative or change which scene the realm adopts.

`createLandPublicationGuard({store, recipeFor})` returns `(bytes, receipt, signal?) => Promise<result | null>`.
`recipeFor` is the host's adopted kingdom-to-pinned-hash mapping, never a value chosen by the incoming receipt.
Null means this kingdom retains its existing land path. `withLandPublication(foundedStore, guard, signal?)`
is a typed loader-store adapter: it retains one owned byte/receipt snapshot, waits for the guard, checks
cancellation, then calls the original founded `put`. Revision/native calls retain the original store receiver.

**The lifecycle adapter is not wired into bootstrap.** The integrator must compose it before adopted scenes
can publish, and prepare historical bindings before exposing their receipts. Full re-verification costs real
CPU and memory (see evidence); schedule preparation outside the held writer's time-sensitive adoption window.
Do not deploy the frontend alone or make a GET run a bake. The exact proposed integration changes are in
[SEAMS.md](../../../../work/lanes/grand-world/SEAMS.md).

Evidence: [GW10 offline bake](../../../../work/evidence/grand-world/GW10-bake.md),
[native consumer](../../../../work/evidence/grand-world/GW10-baked-client.md),
[receipt publication](../../../../work/evidence/grand-world/GW10-publication.md).
