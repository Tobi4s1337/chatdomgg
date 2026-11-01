# WT10 checkpoint evidence — 2026-11-01

WT10 is **open**. These are SIMULATED component reviews, not three authenticated people in the production town.

## Third checkpoint

Source checkpoint `d416c69` follows main sync `160bf83` (through `96b544d`). It adds measured shared name/speech UI, animated head/hair/hat anchors, a reversal/strafe foot-snap fix, and keyboard radio navigation in the wardrobe. The six-file main-owned consumer patch remains unapplied; it passed an in-memory workspace typecheck via `check-integration.mjs` as well as `git apply --check`.

Verified checks:

- Final focused suite: **25 files, 182 tests passed** (`checks/third-focused.log`). It includes the six real-room SDK tests. Main's `e2512e1` fixes the earlier test's injection/warmup ambiguity; the previous correction failure is no longer an active blocker.
- Full typecheck, workspace lint and final build passed. The initial post-merge typecheck/build could not resolve the new dock package; `pnpm install --frozen-lockfile` restored workspace links without changing tracked manifests or lockfiles, and both checks passed afterward.
- `checks/integration-typecheck.log` records a passing typecheck with the exact six proposed consumer files overlaid in memory. This verifies types, not production runtime behavior.
- A fresh full `pnpm test` was attempted and stopped with exit 130 after failures outside lane scope: two kingdom light-field cases, a Herald presence case, a ground-dressing slope case, and two avatar-content cases. Several were timeouts. The complete observed output is retained in `checks/third-full-tests-stopped.log`; this is **not a green full-suite or pnpm verify result**.

Inspected with `view_image`:

- `labels/labels@1440x900.png` and `labels/labels@390x844.png`: actual measured component layout, no browser errors, and automated bounds checks pass. Bubble tails were corrected to meet the marked head anchors and both final stills were inspected. These use SIMULATED anchors, not a kingdom scene.
- `wardrobe/wardrobe@390x844.png`: full-body wardrobe, earned/lapsed pieces, and visible Unsaved changes status. Browser checks use real arrow-key presses in both tile and swatch radiogroups and confirm one tab stop, one selection and retained focus. The screenshot is mid-list after navigation; it proves the actual current UI.
- `motion/motion-none-turns-detail-clip@1440x900.mp4`: exactly three seconds/186091 bytes. A derived eight-sample-per-second contact sheet (`motion/turns-contact.png`) and one full-resolution frame were inspected. Forward, reverse, strafe and cloth poses render with no browser errors. **Normal-speed playback and real-GPU feel were not accepted.** A deterministic component clip cannot prove network interpolation or actual town contact. Its runner printed an unroute-after-close cleanup warning after saving; the lock was released and exit was zero. Cleanup order has since been corrected.

The desktop wardrobe (16064), detailed phone motion still (11635) and new one-port town capture (77952) each reported registration and remained live, while a fresh read of `/tmp/chatdom-capture.lock.queue` found **zero** registered tickets. The shared guard registers only once and cannot acquire after its ticket disappears. All three stranded jobs were deliberately canceled and returned exit 130; no pending capture or owned server remains. Their logs are retained in `checks/capture-queue-*.log`. This matches the earlier Chronicle lane report in main commit `91bf5ad`; the cause of removal is unconfirmed and no other process or lock file was touched. Main must repair ticket recovery across the sandbox PID namespaces before more retries.

Offline component captures bind no listener. The town's new offline-page mode would use a real temporary realm on one allowed port, but its canceled job never reached setup, so neither its runtime nor three-person town/stream acceptance has been demonstrated. Main's contracts and owned-door selection also remain required. WT10 is unchecked; no LANE COMPLETE claim.

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
