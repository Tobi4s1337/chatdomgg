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
  --recipe shots/grand-world/adopted-recipe-g3.json \
  --directory shots/grand-world/land-bake-g3 --report shots/grand-world/bake-g3-report.json
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
  --recipe-hash 71f6888b7ad0b405f949e19203e221520d7a2ee11c2ed2675a7c2ae4eac9d1cd \
  --directory shots/grand-world/land-bake-g3 --report shots/grand-world/publication-report.json
```

The publication executable imports no generator, mesher or artisan registry. Use exact historical scene bytes
and their matching receipts when preparing history, one explicit receipt at a time. This command does not
make a derived test receipt authoritative or change which scene the realm adopts.

`createLandPublicationGuard({store, recipeFor})` returns `(bytes, receipt, signal?) => Promise<result | null>`.
`recipeFor` is the host's adopted kingdom-to-pinned-hash mapping, never a value chosen by the incoming receipt.
Null means this kingdom retains its existing land path. `withLandPublication(foundedStore, guard, signal?)`
is a typed loader-store adapter: it retains one owned byte/receipt snapshot, waits for the guard, checks
cancellation, then calls the original founded `put`. Revision/native calls retain the original store receiver.

## In the realm: bound on publication, baked on founding

`createRealmLand` (`realm.ts`) is composed by the realm host when `REALM_LAND_DIRECTORY` is set
(`openRealmLand` in `main.ts`, `beforeFoundedPublication` in `bootstrap/durable.ts`). Each founded scene the loader
writes is first offered to `beforePublication`: an adopted kingdom's new receipt of an already baked plan is bound
from the catalogue with `verification: 'catalogued'` (metadata decoded, every blob present at its size; the bake
verified every byte before cataloguing) before the receipt can become public. A plan without land is queued and
baked once in a child process (`childLandBake`, `dist/land-bake.mjs` from `build:land`, priority 19, two threads, no
realm environment); the write never waits for it and never fails because of land. The deploy steps are in
[SEAMS.md](../../../../work/lanes/grand-world/SEAMS.md) under "deploy:". Historical Chronicle receipts still need
their exact bytes published with the command above.

## Sketches of unfounded channels

A channel that has not founded its kingdom still has its own world: `/-/grand?channel=<login>` shows the land its
kingdom will stand on (GW13). The browser makes the expected recipe from the channel's Atlas holding
(`grandSeedForHolding` → `grandSketchRecipe`, `packages/world/src/grand/sketch.ts`: generator `grand-land-2`, every
region at every level, no installed town) and asks for exactly that recipe hash. It never generates land.

The realm never takes a channel's world from a request. Before it pins one it reads the channel's facts from the
Atlas itself (`atlas-world.ts`, `REALM_ATLAS_BASE`, the same `readDoorHolding` → `grandSeedForHolding` path, answers
kept ten minutes) and makes the recipe: a proposal that matches is raised; one that does not (forged traits or name,
or a survey that drifted between the page's read and the realm's) is answered `409 pinned` with the realm's own
world, which the realm pins and raises, and the page then draws that one. A channel the Atlas does not list publicly
gets no world (`400 invalid`); when the Atlas cannot be read, or `REALM_ATLAS_BASE` is unset, nothing new is pinned
(`503 resting`).

- `GET /api/realm/land/<channel>/<recipeHash>` serves the sketch record (`application/json`, immutable, at most
  512 KiB) and `GET …/<recipeHash>/<blobHash>` a blob named by that record. A channel with a bound founded land
  serves only that land; a sketch never stands in for it.
- `POST /api/realm/land/<channel>/<recipeHash>` with the canonical recipe as the body (at most 8 KiB) asks the realm
  to raise it: `200 {"state":"ready"}`, `202 {"state":"raising","ahead","stage","done","total"}` with the bake's own
  counts (poll it; the browser waits 1.5 s), or a refusal: `400 invalid` (not this channel's recipe, not canonical,
  not this hash, a foreign seed key, a colour outside the banner clay), `409 pinned` (the channel already has another
  world; the answer carries its `pinnedHash`), `409 founded` (a founded kingdom gets no sketch), `429 busy`,
  `503 resting` (no bake command installed, or the realm cannot tell whether the channel is founded) or `503 failed`.
  Every status answer is `no-store`.
- `GET /api/realm/land/<channel>/world` serves the channel's world: the first sketch recipe the realm accepted for
  it (`worlds/<channel>.json`, written once, canonical JSON, `max-age=3600`, ETag the recipe hash), 404 while it has
  none. A later survey whose facts drifted never rerolls it; the browser asks for this first and draws it.
- **Founding on the world.** When a kingdom that is not adopted (`adopted.ts`) publishes its first live founded scene
  and its channel has a world, `realm.ts` makes the land recipe from that world's seed and the founding plan's
  frame (`createGrandLandRecipe`), pins it (`recipes/<channel>.json`, written once) and queues the bake. Every later
  receipt, after a restart too, reads that pinned recipe; it is never recomputed from today's homes. A kingdom whose
  channel nobody looked up first gets the world its Atlas facts give at that publication (read by the realm; an Atlas
  that cannot be read is asked again at the next one). Only a channel the Atlas does not list keeps today's land.
- `GET /api/realm/land/<kingdom>/recipe` serves that pinned `grand-land-2` land recipe (`no-cache`, ETag, 404 while
  none), so the kingdom page, walk and stream of a kingdom outside the build's adopted registry know which land to
  draw; the land itself stays bound to each receipt by this recipe's hash.
- `sketches.ts` (`createSketchService`) raises one land at a time in the same serial chain as founded bakes, in a
  niced child (`dist/land-bake.mjs --sketch-recipe FILE`, priority 19, two threads, 1.5 GB heap). Limits: eight
  waiting and 240 raised a day; one world per channel. A world is pinned only for a channel the realm's layout heads
  say is unfounded (`land.knowFounded(...)` in `main.ts`), and only for a request the realm will really raise, so a
  `busy` refusal pins nothing.
- Records are content-addressed (`sketches/<channel>/<recipeHash>.json`, written once, every blob checked present
  first); the gateway's existing `/api/realm/land/<id>/<64hex>(/<64hex>)?` allowlist carries them unchanged.

Decision 3 called sketches private: no one is shown a kingdom that is not founded. We read it as "no people and no
claim": the page shows the land only, says plainly that it is not founded yet and that its town will be raised on
this land when the streamer founds it on stream, and draws no homes, citizens or names. A sketch is the promise of
the land, not a kingdom, and the realm keeps that promise: the world is pinned before anyone is shown it, and the
founding raises the kingdom on it. The page asks the realm's founded receipt first (`/api/realm/founded/<id>`): a
founded kingdom is never shown a sketch, only a door into the kingdom; when the realm cannot say, nothing is
promised and the visitor can try again.

The offline command for one channel stays: build with `work/lanes/grand-world/build-sketch.mjs`, run
`UV_THREADPOOL_SIZE=2 nice -n 19 node shots/grand-world/sketch-cli/sketch.mjs --channel ID --name NAME --directory DIR --report FILE`.

Evidence: [GW10 offline bake](../../../../work/evidence/grand-world/GW10-bake.md),
[native consumer](../../../../work/evidence/grand-world/GW10-baked-client.md),
[receipt publication](../../../../work/evidence/grand-world/GW10-publication.md).
