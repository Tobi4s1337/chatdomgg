# Final lane landing round — 2026-11-01

All 84 lane refs were reconciled against main, their progress and checked-out dirty work. The complete disposition and preserved-path inventory is in `work/HANDOFF-LANES.md`; next-turn state is in `work/PLAN.md` §10. No lane worker was started and no managed service was restarted, moved or rebuilt.

## What entered the actual product

- Live-Twitch runtime checkpoint `25a1844` via `0f1c72f`: follow settlement, sub/tenure, redemptions/polls, going-live welcome, reconciliation and retry/fencing. Rehearsal caught a real interrupted-source ordering bug; `0f103bc` moves homecoming after approved committed presence and keeps the inbox retryable. Twenty-four focused tests cover actual Postgres source loss/restart, duplicate delivery, storage/fencing recovery and later uncommitted-name/redaction races. Review: `work/reviews/live-homecoming-ordering-2026-11-01.md`.
- Atlas A06 `8d4d867` via `61f8830`, Atlas-door `fd0499d` via `b27682b`, public projections/Chronicle proxy `895a045`. Real Surveyor holding → card → generated kingdom works.
- Latest grand artisans `70818b7` and castle/town W2 `3e5061f` merged. Public grand entry allowed in `b8b3c0d`. Hosted native adoption remains off main at `52bb8cc`.
- Interactions source `3a8eb6c` merged; main owns checked own-door spawn/adoption `cd8fc2c` and revision-correct installed-home entry `87e354a`.
- Physical tavern/market/court/bridge sites `1cef1d3`, directed dock authority/presentation `26edce7`, native Chronicle/civic light-water/Soul host `69cee8f`, live render hold `3747507`, promoted historical scene lifetime `f9c4f5c`.
- Authored growth sequence merged in `cb14dbf`, including a tested bootstrap floor so a delayed old beat cannot replay a housewarming. Native geometry, door/Forge anchors and earned publication are retained.

## Looked-at evidence

- `atlas-card@1440x900.png`: actual mapped MOTHERv3 card from the live Surveyor; names, roads and Enter/Watch/Share are legible. Main inspected the image.
- `atlas-kingdom@1440x900.png`: clicking Enter reached actual generated `/kingdom/848110685` through the real realm's unfounded response, with SIMULATED provenance. Main inspected it. The town has broad roads and sparse ground; this is not the complete variety review.
- `work/evidence/growth/hut-cottage-street-pair.png`: inspected main's merged authored same-plot pair. The second storey and roofline read; this does not prove the current native Chronicle can replay it quickly.
- `work/evidence/chronicle-native/chronicle-durable-first@1440x900.png` and `chronicle-durable-simulated-30s.webm`: actual native product route, reconstructed from 42 isolated simulated nights/170 ordered facts/three guarded home constructions. Main reviewed all 60 half-second frames in contacts `chronicle-durable-30s-01.png` through `-03.png`. The encoded clip stays at entry27 while the next whole scene prepares. **CH02 is not complete.** No historical lights/chat are invented and no audio is verified. Detailed review: `work/reviews/chronicle-native-2026-11-01.md`.
- `work/evidence/dock-round/native-gate-close-diagnostic.json`: actual simulated OIDC → API → native supported gate → authenticated HTTP witness → SQL witness/public undo receipt. Main inspected the 1920×1080 UNCONFIRMED PNG: it is the full native town after the act, with fresh SIMULATED presence, not a readable gate ceremony. The initial API reply remained unknown; draw arrived about ten seconds after commit. Visual act acceptance remains open. The snapshot lacked the render-hold debug exposure; `32db7e2` supplies that seam on main without claiming a new looked-at frame.

- `work/evidence/live-twitch/homecoming-native-reviewed@1920x1080.png` and adjacent JSON: main inspected the final corrected path. A fresh signed mock chat produced exact public homecoming seq17 in155ms, then an actually ready/drawn native frame with fresh presence and SIMULATED provenance. The warm cottage reads, but the framing has too much empty sky and no caption/neighbor-relight is visible; this is rendered integration evidence, not signature-beat timing acceptance. No camera, actor or clock was forced.

## Green checks

- Full `pnpm typecheck` and full `pnpm lint` passed across the integrated source. The final homecoming correction passed another complete typecheck plus focused lint/24 tests.
- Final compact focused run: 47/47 tests across public routing, growth ledger, Chronicle controller and candidate lifetime.
- During integration: 87 focused join tests; native home authority19 plus retained-native-town rerun; live-Twitch69; Atlas A06 route/history47 plus directory8; Atlas-door23; civic59 content +4 site/provider +10 complete-scene +3 client light/water tests. Counts overlap; these are not a whole-suite total. Dock's three isolated Postgres tests passed.
- Exact committed source snapshot `f9c4f5c`: offline frozen install, complete `pnpm build` (all eight apps), complete `pnpm public:build`, panel zip/hosted-asset checks: passed. The final changed realm at `0f103bc` and changed web facade at `32db7e2` also passed isolated Vite builds; the latter passed a fresh full typecheck/scoped lint. Temporary builds left managed `apps/*/dist` untouched.
- No fresh full-suite screenshot matrix, real-GPU timing, live Twitch write or production deployment is claimed.

## What remains genuinely open

Native grand adoption has no judged loaded frame (exact target reaches readiness in about56s but screenshot still timed out). Chronicle reconstructs real geometry but rebuild cost prevents watchable playback; cache meshes and retain its renderer, then verify atomic placements/shadows/light and backward restoration. Forge civic upgrade art is incompatible with the accepted workshop, which was preserved. Soul lacks real bakery/lamps/quay/ship topology and per-Genesis profile. Walking still needs trusted look/tool/gesture and deterministic neighbour producers. Card/passport production public subject/disclosure and share-image handlers are absent; the panel adapter's empty travel arrays are not a passport authority. Realm-server has an unresolved dirty merge; incomplete interiors, civic furnishing, table host and duplicate old W2 sources remain untouched on their branches.

Accepted Forge/window-wave/dusk/avatar appearance was preserved. This round did not silently mark these remaining outcomes done.

## Clean stop

Final capture helpers exited; browsers, owned ports5198/5199/5182 and Dock's own loopback/Unix listeners are closed, the shared capture lock released, and Dock's disposable schemas dropped. The isolated 42-night rehearsal schema is retained only as reproducible test evidence, not served on the public site. All source changes are committed separately; this final record accompanies the preserved lane inventory. No new work should restart automatically.
