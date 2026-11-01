# WT10 checkpoint evidence — 2026-11-01

WT10 is **open**. These are SIMULATED component reviews, not three authenticated people in the production town.

## Looked at

- `controls/selector@1440x900.png`, `controls/selector@390x844.png`: opened with view_image. Six consistent engraved icons, legible parchment choices, 44+ px targets, and the phone's left-thumb band remains clear. The component-only backdrop is deliberately not a kingdom.
- `motion/motion@1440x900.png`: opened with view_image. Three whole styled citizens render together, hats/clothing/boots remain readable, the cloth shader links without browser errors. The plain review ground has no contact shadows and is not evidence for world grounding. No network gestures are claimed.

## Checks

- `pnpm typecheck`: passed, including the final controller/label changes.
- `pnpm lint`: passed; the final capture runner also passed scoped ESLint.
- `pnpm build`: passed. Existing large-chunk and ineffective-dynamic-import warnings remain.
- `pnpm exec vitest run apps/web/src/walk/labels.test.ts apps/web/src/walk/index.test.ts apps/web/src/citizens/worn-look.test.ts packages/world/src/movement/step.test.ts --testTimeout=20000`: 47 passed.
- `pnpm exec vitest run apps/web/src/walk/index.test.ts apps/web/src/walk/realm-predict.test.ts apps/web/src/citizens/style-adapter.test.ts --testTimeout=20000`: 33 passed, including the additional controller lifecycle test. The sets overlap and must not be summed.
- Gesture state: 4 tests passed; animation/cape/worn bridge and builder checks passed in focused runs.
- Gesture browser checks exercised text-field Escape retention, menu Escape, Wave selection and unavailable-state guarding. Parent inspected both resulting selector screenshots.
- `git apply --check work/lanes/walking-together/integration.patch`: passed. This checks the optional main-owned consumer patch without applying it.
- `git diff --check`: passed.

`pnpm test` was attempted and stopped after becoming red: the host's default five-second timeouts fired in existing moment and light-field cases; later moment sky assertions also failed after those timeouts. It was not a green full-suite run. An initial focused aggregate run also hit timeouts, an SDK correction assertion, and a stale test while the agent was changing cape paint; the final focused runs above passed after edits settled and with explicit test timeouts. The isolated moments file subsequently passed all 5 tests with `--testTimeout=20000`, including the two sky assertions; its first case took 5.4 s. No failing out-of-scope production code was modified or tests weakened to hide these results.

## Doubts and remaining acceptance

Distance-driven leg animation is not a proof of horizontal stance-foot planting. The current 1.8 m stride cannot keep a half-cycle stance inside the small leg's reach; true planting needs a deliberately chosen walk/run stance, IK, touchdown anchors, and turn/stop/correction tests. The visible smoothed terrain and half-metre collision surface are also different, so exact slope contact needs main's surface seam.

The public room/stream still consumes starter appearance IDs, not saved full-body recipes, and has no authenticated gesture transient. Main-owned needs and the exact consumer patch are in `work/lanes/walking-together/needs.md` and `integration.patch`. Tools/keepsakes need an approved persisted tool slot. Crowd soft-push must be in shared prediction/authority, not a browser-only force that falsifies observed positions.

Phone motion, wardrobe and short wave-clip review runs are queued separately; each owns at most one still or one clip per lock. No clip has been called watched here. Full founded-town movement, live Twitch identity/owned-door entry, a public stream finding these walkers, full-body wardrobe propagation and real GPU performance still require demonstration.
