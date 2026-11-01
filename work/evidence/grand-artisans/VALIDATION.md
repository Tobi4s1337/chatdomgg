# GA10 draft evidence — 2026-11-01

This is a source checkpoint, **not visual acceptance**. GA10 remains unchecked.

- Read spec 56, the provided world-generation research, the vision, and the builder's current pipeline;
  inspected all six reference stills with view_image. Terra high agents owned separate kit folders.
- `pnpm exec vitest run packages/world/src/grand/artisans apps/web/src/grand/artisans`: **41 passed**,
  eight files. See kit-tests.txt. Includes seeded geometry, clearing envelopes, snow on slopes, native
  home support, open passages, rotated ship projections, mill stoop and exact lighthouse footprints.
- Repository `pnpm lint` and `pnpm build` passed. Scoped ESLint and strict kit TypeScript passed.
- Final repository `pnpm typecheck` rerun passed; see typecheck.txt.
- The disposable builder + artisans + adoption.patch candidate web production build passed; see
  candidate-build.txt. No builder source was changed. The full patch dry-runs on the sibling checkout.
- Isolated producer smoke generated a 1280² source with **1,055 trees**. A pre-final-placement fixture
  produced 2,887 structure boxes / 14 colours; do not use that box count as a final acceptance measure.
  Separate cache smoke verified count/byte eviction, oversized non-caching and deterministic replay.
- Broad `pnpm test` did **not** pass. It was interrupted after failures/timeouts in unchanged Twitch
  moments, kingdom light fields, Herald source/acceptance, and ground dressing. No out-of-scope source
  was changed to suppress those failures. PostgreSQL integration fixtures also reported unavailable.

## Remaining proof

No artisan screenshot has yet been captured or visually accepted. The shared-lock queue has remained
occupied; the runner waits without starting a server/browser. It acquires/releases around one still
or short orbit. Captures go to `shots/grand-artisans/**`; selected looked evidence will be copied here.
The independent bench is labelled SIMULATED and cannot prove production LOD, shadows, hydrology,
collision, settled home identity, window presence or GPU/OBS cost. Those require actual in-land review.

`adoption.patch` is a concrete needs patch for the builder: geology sampling, palette overflow,
source-order halo replay, an 8 MiB per-worker typed-array tree cache, and /-/grand artReview mounting.
The adapter's default clearance mask is for the independent GK10 render land. GK11 must bind it to
actual installed lots, Forge, roads, growth envelopes and physical supports. Castle/composition studies
must never replace the exact installed scene. Their current look and scale are still unjudged.
