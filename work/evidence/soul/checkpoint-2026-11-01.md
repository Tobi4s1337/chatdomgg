# SO10 working checkpoint

Final source was checked after the merged-main checkpoint `51db20a`. All edits in this iteration stayed inside the soul lane scope. No push and no main branch writes.

## Passed

- `pnpm typecheck` — exit 0, `/tmp/soul-checkpoint-typecheck.log`.
- `pnpm lint` — exit 0, `/tmp/soul-checkpoint-lint.log`.
- `pnpm build` — exit 0, `/tmp/soul-checkpoint-build.log`.
- `pnpm exec vitest run apps/web/src/soul packages/world/src/soul packages/audio/src/soul` — 6 files, **25 tests passed**, exit 0, `/tmp/soul-checkpoint-focused.log`.
- The production review-home worker bundle ran two real Node worker-thread messages with transferred geometry arrays. `built-worker-check.json` records its built-file hash and results. This is CPU protocol evidence, not a browser screenshot or GPU measurement.
- `git apply --check work/lanes/soul/main-soul.patch`, script syntax checks, and `git diff --check` pass.

## Full repository test limit

`timeout 240s pnpm test` ended with exit **124**. Before that bound it reported 5-second timeouts in unchanged outside-scope files:

- `apps/web/src/twitch-moments/moments.test.ts`: normalizes, records, projects and presents real support input with honest refusals and cleanup (8319 ms).
- `apps/web/src/kingdom/light-field.test.ts`: uses settlement civic ground for local occupancy and removes light without rebuilding it (8799 ms).

A later light-field case took 108772 ms. The full suite did not finish and is **not green**; the focused result above is not a claim that `pnpm verify` passed. No outside test, timeout configuration or implementation was changed. Full-run log: `/tmp/soul-checkpoint-tests.log`.

## What changed

The scene host accepts newly witnessed ship-arrival snapshots without remounting, consumes overlaps/temporary gaps/mute/seeks without replay, and retains weather caching for equal snapshots. The exact main proposal carries the corresponding arrival callback.

The review now meshes actual ordered blueprint cuts, including door/window openings, instead of skipping air operations. One owned module worker prepares the three families serially, transfers their buffers and settles pending work on teardown/error. Material batches preserve baked AO/sky shading. Snow follows exposed upward roof faces and seasonal peak caps. Mist has feathered edges and owned texture disposal; the rain shader uses defined smoothstep bounds. Runtime scene counters are available to the still runner.

## Visual and audio boundaries

No new still was taken in this iteration. Both the audio and still runners waited ten minutes for their own FIFO ticket and timed out **before starting a server or browser** (audio 16:48:55 UTC; dusk still 16:49:35 UTC). No shared lock was bypassed or removed. Each invocation still owns one still or one short clip only; the queue wait now keeps its place longer without a browser. No owned server/browser remains.

The most recent opened image remains `second-look/dusk@1440x900.png`, an intermediate older build. The new geometry, haze, snow, horizon and loading presentation require fresh looks at desktop, phone and stream sizes. Seven existing original-graph Opus clips remain linked under `audio/README.md`; no full audio matrix, subjective listening or new loudness analysis is claimed.

The PRD remains open. Main must install real civic anchors/routes, coordinate its authoritative clock with live dusk, supply real witnessed arrivals and demonstrate the actual walk and stream. `needs-main.md` and `main-soul.patch` are a checked proposal only. The latest instruction is to land this checkpoint without adding new sub-scopes.
