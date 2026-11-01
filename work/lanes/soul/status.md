# SO10 current checkpoint

The first and only PRD task remains open. Commits on `lane/soul`: `4d1de96` (world), `02cead7` (presentation/sound/needs), `95468be` (checkpoint record). No main branch writes and no push. Correction checkpoint: `71ddc57` (dusk alignment, looked-at framing fixes, single-case capture tooling).

## What is real

Owned modules exist under `packages/world/src/soul`, `packages/audio/src/soul`, and `apps/web/src/soul`. The single authorized `lanePaths` entry loads `/-/soul` lazily. Local source imports avoid out-of-scope manifest/export changes.

Fifteen focused tests pass: deterministic calendar/weather/routes, audio lifecycle/harbour gating/fades/duck, scene-host context ownership/arrival deduplication, reversible surface wetting/snow, and two-batch district lamps with instance-buffer disposal. Final whole typecheck and lint passed (`/tmp/soul-typecheck-handoff.log`, `/tmp/soul-lint-handoff.log`); whole workspace build and subsequent final web builds passed (`/tmp/soul-web-perspective.log`). The last focused result is `/tmp/soul-tests-handoff.log`. The full repository suite was attempted once and stopped after unchanged out-of-scope failures; see `work/evidence/soul/repository-check.txt`. It was not green and no outside test was edited.

Lamplighting is now at `SOUL_DUSK_HOUR = 18.75` (18:45), matching the renderer's dusk grade, with lamps switching on actual visits. The review's fixed picture clock has a continuing simulated audio clock, so holding an hour no longer stops all scheduled calls/music. Biome selection initially applies its palette and omits an inland harbour master.

## Looks and listens

Two actual stills were opened with `view_image`, retained under `work/evidence/soul/first-look/`. Their review records the defects and subsequent corrections. The latest review uses a perspective camera, opaque distant peaks, distance fog and three bounded review-only civic lights. Those final corrections still need recapture. The reusable scene adapter creates no point lights; its host supplies civic emitters to main's existing field.

There is no final dawn-to-night matrix or verified audio matrix yet. Do not copy old `/tmp/chatdom-soul-audio` WAVs without per-case JSON and the final `measurements.json`. Audio cases and checks now carry a build fingerprint; finalization rejects mixed or missing builds. Subjective listening and real-GPU timing remain unverified.

The shared capture guard interrupted two legacy series commands and wrote its notes in `progress.txt`; preserve those notes. Both remaining legacy parent runners were explicitly stopped. The tools now capture exactly one still or one clip per invocation, build audio before taking the lock, close the preview/browser before releasing, and bound the queue to 60 seconds. A busy queue returns 75 and explicitly reports no browser launched. Recent bounded attempts returned 75. There are no long-lived owned preview or audio servers to preserve.

## Next iteration

1. Follow Ralph sync first: main has advanced while this task ran. Resolve only within scope; keep the single route entry and other lanes' changes.
2. Rebuild if needed. Capture and inspect the corrected dusk first: `node work/lanes/soul/capture.mjs dusk`. Then do `phone`, `stream`, and each remaining named day still as separate invocations. Never pass multiple names or hold a browser across captures. Per-still JSON is written immediately.
3. One audio case per invocation: `node packages/audio/src/soul/bench/listen.mjs coastal-6-walk`. The README names all 21 clips and `lifecycle`, `stall`, `duck`. `--finalize` is CPU-only and refuses incomplete/stale results; afterward run `bench/analyze.mjs`, then `node work/lanes/soul/evidence.mjs` once the still matrix is also complete.
4. `needs-main.md` and `main-soul.patch` are the exact outstanding live integration seam. The patch applies cleanly to this lane's base, but is a proposal, not applied/live-tested code. Main must supply actual civic sites and demonstrate the real walk/stream. Do not invent a site binding or claim the review district is a live kingdom.

SO10 must not be ticked or `LANE COMPLETE` written before actual integration and its evidence are demonstrated. Keep progressing on this first task; never take a Backlog item.
