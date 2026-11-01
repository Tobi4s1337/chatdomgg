# WT10 checkpoint evidence — 2026-11-01

WT10 is **open**. These are SIMULATED component reviews, not three authenticated people in the production town.

## Second checkpoint

Main synced cleanly at ac12111. Flat-ground planted legs, stop/seat/tiptoe transitions, current-update footfall events and fenced wardrobe saves are implemented. The exact main-owned consumer patch now also connects footsteps to gait touchdowns; it remains unapplied in this lane.

- `motion/motion@390x844.png` was opened with view_image. Three whole citizens render and their clothes are readable, with no browser errors in the paired JSON. The plain bench has excessive empty space and no contact shadows; it is not a product composition or terrain-contact proof. It predates the final transition fixes. No clip was successfully captured or watched this iteration.
- Final focused verification passed **85 tests** across the citizen, builder, controller, label and movement files. See `checks/scoped-final.log`. This is a focused pass, not a full-suite pass.
- Final `pnpm typecheck`, scoped ESLint and `pnpm build` passed. Build retains the repository's chunk/timing warnings. The full typecheck completed without diagnostics.
- Full-town CPU diagnostic passed for three supported bodies, 659 native placements and forward/reverse/stop movement with no solid entry or support loss. See `checks/town-collision.log`. It does not render the town or use a network connection. Compilation took about 83 s.
- `checks/aggregate-before-fixes.log` preserves the 172/174 pass aggregate. The coherent motion fix to the style-adapter test subsequently passed. The unchanged SDK camera correction assertion remained red; `checks/prediction-isolated-red.log` preserves the isolated failure. It directly perturbs exact predicted state, so pre-ack injected drift still needs to be distinguished from actual correction. No assertion was weakened and no green SDK correction result is claimed for this checkpoint.
- `git apply --check work/lanes/walking-together/integration.patch` and `git diff --check` passed.

Phone wardrobe and wave-clip component captures terminated with `No free review port`; a later read-only probe found every allowed capture port occupied. Existing services were untouched. The new `capture-town.mjs` has only been linted/reviewed and has not run: its real-time three-connection town evidence remains outstanding. Phone wardrobe status changes and the final gait transitions still need visual judgement. Main's appearance, gesture, tool, terrain and crowd contracts are still required for the whole task.

## Looked at

- `controls/selector@1440x900.png`, `controls/selector@390x844.png`: opened with view_image. Six consistent engraved icons, legible parchment choices, 44+ px targets, and the phone's left-thumb band remains clear. The component-only backdrop is deliberately not a kingdom.
- `motion/motion@1440x900.png`: opened with view_image. Three whole styled citizens render together, hats/clothing/boots remain readable, the cloth shader links without browser errors. The plain review ground has no contact shadows and is not evidence for world grounding. No network gestures are claimed.

## First checkpoint checks

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
