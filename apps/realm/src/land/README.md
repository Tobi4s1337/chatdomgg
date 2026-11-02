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

The directory contains `recipes/<kingdom>.json`, `blobs/<raw-sha256>.gz`, and
`bindings/<kingdom>/<scene-hash>.json`. Store limits are 128 MiB raw / 8 MiB compressed per blob. The stricter
format limits apply during codec validation. Gzip headers have mtime zero and OS 255; both compressed and raw
digests and lengths are verified. See the [format](../../../../packages/world/src/grand/baked/README.md).

`readLandRoute` is a read-only HTTP adapter, **not registered on a live service in this checkpoint**:

- `/api/realm/land/<kingdom>/<scene-hash>`: the complete immutable receipt binding.
- `/api/realm/land/<kingdom>/<scene-hash>/<raw-blob-hash>`: only a blob referenced by that binding's validated
  metadata, returned as `application/gzip`. There is no `Content-Encoding`: clients verify gzip bytes before
  bounded decompression. Successful responses have immutable caching, ETags and HEAD/304 support.
- Unknown/unpublished content is 404. Corrupt or missing published bytes are 503, never a generation request.

The serving host must use the same store directory and forward status, headers and bytes. Registration, the
browser's bounded verified loader, cache and receipt replacement still need composition. In particular, the
browser still generates land today. A land binding is visual artifact provenance, not an expanded collision
region or an amendment to `RealmFoundedManifest`.

Evidence: [GW10 offline bake](../../../../work/evidence/grand-world/GW10-bake.md).
