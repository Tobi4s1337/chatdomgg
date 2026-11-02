# Kingdom build checkpoints — 2026-10-30

Historical sequence, superseded by the current state in `work/PLAN.md` §10. Paths in checkpoint text are repository-relative. Pauses and unfinished status below describe their original checkpoint only.

## 10. Handoff state — 2026-10-30 active dusk composition

- Pushed: `d73c342` froze the small shared/world/voxel consumer contracts and Herald spec; `095c967` recorded its verified worktree. `lane/herald` / `../worktrees/herald` are ready at that boundary. No real Twitch authorization or chat success is claimed. Atlas remains with its team at `lane/atlas` / `../worktrees/atlas`; main does not edit its implementation.
- Content specs 04–06 and PRDs are now frozen: `homes-hearth` (15 homes), `homes-tide` (15 homes), `street-props` (20 records / ten forms in two kits). Main reviewed the production bench, actual validator, mixed desktop/phone fixtures, doorway and SIMULATED window on/off. All 51 core baselines validate; lane assets are deliberately absent and missing collections fail. Committed and pushed in `2c407d8`. Branches `lane/homes-hearth`, `lane/homes-tide`, `lane/street-props` and worktrees `../worktrees/homes-hearth`, `../worktrees/homes-tide`, `../worktrees/street-props` exist at that green commit, with frozen-lockfile dependencies installed. Worker startup belongs to the team.
- Implemented kingdom: deterministic 24-home hamlet and 240-home town from one generator; immutable reserved tenure lots, roads/castle, worker meshing with baked AO/sky, conforming terrain, factor-2/4 render meshes, sky/fog/time, warm panes and real occluded R8 field. SIMULATED input goes through world presence; the strict public SSE adapter uses the same feed seam. Original procedural action sounds are credited in `THIRD_PARTY.md`.
- Runtime evidence: 0 → 1 → 240 → 0 active windows without rebuilding geometry; nearby Juniper label; six real workers observed and all terminated on a context-loss event. Desktop town: 30 draws, 945,506 triangles, 4,850,692 light-field bytes. Full `pnpm verify` passed: typecheck, lint, 201 tests, build and 19 standard captures (twelve kingdom, six stream, one panel).
- Screenshots: all twelve hamlet/town noon/dusk/night fixed-camera desktop/phone views exist under `shots/kingdom/`. Main has inspected representative desktop/phone/noon/night and close-window frames; the final full visual audit and wave capture are still required. The current world is functional but **does not yet meet the final art bar**: too regular a town layout, washed daylight/dusk, thin beacon and empty distant land. Improve those here; do not treat the handoff commit as completed kingdom acceptance.
- Correctness fixes from Astra high review: retired producer epochs cannot restore withdrawn names; healthy offline remains “STREAM RESTING”; caller abort and construction failure clean resources; runtime rendering errors show a recovery gate. Greedy-displacement cracks were replaced by conforming worker topology. Ordered shell occlusion now prevents nearby names showing through houses. Pane speckle was traced to fractional slot texture addressing and fixed by rounding the slot index.
- Remaining: finish composition/material/shadow/landscape look, detail transitions and distant light coverage; verify real WebGL context loss, failed/cancelled construction, source loss/reconnect and light removal in browser; inspect all final fixed shots, capture the arrival ripple, update exact evidence, commit/push green steps. Walking avatars and build mode remain the next brief. No real-device FPS claim is made from SwiftShader.
- Ports: web dev 5170, preview 5190, Atlas reserved 5193, Herald reserved 5194, optional registered auth callback 5195. Capture previews now request an OS-assigned free port atomically; `CHATDOM_SHOT_PORT` / `CHATDOM_CONTENT_PORT` may pin one explicitly. Two simultaneous capture servers were verified to bind different ports. Existing infrastructure and secrets remain untouched.
- Founder decisions remain: a citizen's own warm window is their presence light, named nearby; the castle beacon is the kingdom's light. Sound uses original procedural or credited permissive sources. Freeze small contract groups as their consumers start. New committed build-memory paths are repo-relative.

### Active art pass after `2c407d8`

- Content lane worktrees are handed off; main will not author their owned batches. `256a7bd` records their setup and is pushed.
- Current uncommitted pass lowers the hero/near cameras, groups baseline trees into groves, replaces the pale elliptical water with terrain-depth shoreline and analytic sky reflection, deepens dusk values and strengthens the beacon. Warmth now has a bounded kingdom-wide 2 m occluded volume alongside the 0.5 m near volume; tests cover all 240 street facades. Combined estimated light workspace is 9.13 MiB with a 12 MiB automated cap. Original occupancy remains authoritative; coarse side alleys can close.
- Renderer now fades detail meshes over 0.4 s, reuses light textures, catches frame failures, disposes instance buffers, and advances presentation by elapsed time without slowing on a slow frame. These changes need integrated visual/runtime verification before the next commit. Final visual approval, wave capture and real-GPU timings are still outstanding.
- Preview 5190 was restarted after its previous owned session had exited (143); current owned session is 58259. Capture helpers use free localhost ports. No unrelated process or service was touched.

### Pause checkpoint — after the second composition capture

- Founder paused the active goal. Stop implementation until resumed. Content handoff milestone `2c407d8` and setup record `256a7bd` are confirmed pushed. All three content worktrees exist with installed dependencies. The exact handoff milestone passed `pnpm verify` (201 tests and 19 standard captures); port allocation was demonstrated with two simultaneous previews.
- Preserve the uncommitted art/runtime pass described above. Latest global typecheck, lint and build passed after integrating two light fields, water, detail fading and frame-error handling. Far-field focused tests passed 18/18. The final full verify has NOT been repeated for these uncommitted changes.
- Main viewed `shots/kingdom/composition-town-dusk.png` and `composition-town-night.png`. Both rendered without browser errors: 240 homes active, seven workers, 73 geometry builds, 33 draws, 1,005,754 triangles, 9,569,616 combined field bytes, both fields settled. Every quarter now receives warmth. Main has not approved final art: coarse ground-light squares are conspicuous, facades may be too uniformly bright, the castle remains dark, and the layout is still repetitive. The lower camera, terrain-shaped water and stronger beacon are improvements, not final acceptance.
- Runtime script `packages/testing/kingdom-checks.mjs` was strengthened for actual WEBGL_lose_context, runtime/construction worker failures, public Herald stale/live/offline/disconnect, field removal and error UI. Its latest source passes lint but has NOT run against this build. The checker was interrupted at founder pause before starting Chrome. There is no client-side route unmount, so construction-unmount browser evidence remains explicitly unproven.
- Remaining before completion: review and tune the integrated look; inspect actual phone/noon/hamlet/stream changes; run strengthened runtime checks and full verify; record short arrival-wave capture (deterministic `__chatdomKingdom.capture(seconds)` now exists); update evidence and commit/push the next green milestone. No real-GPU frame-time evidence exists. Preview 5190 remains the owned session 58259 unless its live status changes; revalidate on resume. No temporary capture process was still running at pause.

### Resumed on Sol — dusk acceptance

- Founder resumed the same goal on Sol. Content hearth and street-prop lanes are running with the team; Herald is on H03, Atlas is addressing review. Main retains core integration and look ownership.
- Active disjoint reviews: Astra xhigh on occlusion-aware distant-field reconstruction, reversible LOD transitions and exact terrain/water contact; Terra high on atmosphere/beacon and water. Main is lowering the town view toward its central street.
- Strengthened runtime checks passed against the resumed build: actual WebGL context loss, construction/runtime worker failures, source expired/live/offline/disconnect and wave field reuploads. The final look build still needs the complete verify and capture matrix.
- Owned temporary look server: localhost 5186. Attempt to start 5178 failed because occupied; no process on that port was touched. Preview 5190 must be checked after rebuilding.

### Continuous light and contact checkpoint

- The three real occluded volumes now cover nearby streets, all town quarters and the castle crown. Shared corner reconstruction removes square pools; raw flood values stay unchanged. Cached occupancy masks reduce worker reconstruction time. Combined estimated field workspace is 11.60 MiB under a 12 MiB guard. Coarse cells can still close narrow alleys; this is conservative darkness, not fabricated illumination.
- First arrival now lights exactly one designated window, with Juniper over it. Content inspection explicitly lights every authored anchor. Specs 04/05 and DECISIONS record this consumer policy without changing shared schemas.
- Manor foundations and full reserved lots are flat. The horizon no longer overlaps detailed ground, and its conforming collar/sampler grounds the groves. Water samples the exact terrain triangle diagonal. Detail meshes and panes share reversible fades. Constructor failures now release previously allocated scene resources as well as asynchronous failures.
- This coherent look step passed `pnpm verify`: typecheck, lint, 230 tests, build and 19 standard captures. Main inspected the twelve kingdom views as desktop/phone contact sheets, plus close-window renders. The build is served on 5190 for founder hardware review. A separate cached actual directional-shadow module is being developed for the next integration. Final art acceptance and wave capture remain open; daylight is still flat, the shoreline material edge is too faceted and castle walls remain dark.

### Shadow integration and final capture in progress

- `a684496` is pushed: the continuous-light/contact milestone passed 230 tests and 19 standard shots. Its strengthened browser checks also passed: eight workers created, seven live before context loss, all released afterward; an injected synchronous Worker constructor failure released all four earlier workers.
- The next look pass integrates cached actual directional shadows (20 MiB desktop / 5 MiB phone), full-detail home/castle casters and factor-2 flora, plus a continuous bank material bounded to the actual lake. Main inspected hamlet noon/dusk: cast shadows improve grounding and the jagged shore material edge is gone. Astra's real Chrome proof measured shaded RGB 38 versus sunlit 174, complete R8/depth framebuffers at both sizes, no GL errors.
- Beacon policy is now identical across feeds: quiet fresh-live pilot plus community strength, zero when stale/offline. The film path now samples actual presentation time so panes retain their 0.7 s fade and detail transitions; it cannot capture a live Herald feed as if it were a simulation.
- Current scripts/tests are still being verified against that final combined source. Remaining: final complete shot audit, browser rerun for shadow caching/removal/recovery, 160-frame offline arrival film and visual review, selected committed evidence, green commit/push. Founder was told 5190 is available; frame times and Noon→Dusk update costs still need hardware evidence. Content/Herald/Atlas remain with their teams, with uncommitted lane work visible; do not merge their unfinished files.

### Historical pause checkpoint — resumed; see lane integration below

- Goal is paused. Terrain architect and evidence checker were interrupted. No film was started. Preserve all uncommitted source.
- Confirmed pushed: `a684496` continuous light/contact milestone (230 tests and 19 captures), and `f7313e1` cached sun-shadow module, four focused tests and real Chrome depth proof at `work/evidence/kingdom/sun-depth-proof.png`. The latter is a module checkpoint; its kingdom integration remains uncommitted.
- Uncommitted integration includes shadows, bounded continuous shoreline material, unified beacon pilot policy, exact offline presentation sampling/LOD clock, public-green groves and root grounding, stronger HDR beacon appearance, testing scripts, and Spec 02 updates. Latest typecheck/lint/unit run passed 236 tests. An earlier integrated shadow checkpoint passed a full verify with 234 tests/ 19 captures; the newest full verify reached stream capture and failed the default 30 s SwiftShader screenshot timeout. The operator now allows 120 s and fails fast on error gates, but that latest harness has not completed a full run.
- Browser runtime passed on the last production build: window field 0 → positive → 0, shadow update count stayed 1 through presence/camera changes, real live-frame field illumination followed by fully cleared window+beacon fields on offline/disconnect, actual context loss and constructor/asynchronous worker-failure cleanup. Town main pass: 44 draws / 1,104,438 triangles; cached shadow pass: 26 draws / 3,853,892 triangles / 21,003,584 bytes. Field workspace 12,162,420 bytes. These are counts, not hardware timing claims.
- Main and Terra still reject final acceptance: repeated blank gable backs hide too many presence windows, and the hamlet ground reads as a rectangular plinth. Astra proposed a rolling ridge with exact current-built-footprint pads, soft Euclidean feathers and a spatial pad index, preserving every address/reserved lot. It was interrupted before any new world/layout edits landed. Full-reserved-lot-flat was our implementation overconstraint, not a frozen rule; future growth may terraform inside its fixed lot. Revisit those tests explicitly without losing actual foundation/threshold contact.
- Camera experiment: main viewed `shots/kingdom/camera-raised-dusk.png` and `camera-raised-phone.png` (higher east oblique; more fronts but still repetitive). Source now contains an **unreviewed west-oblique experiment**: town desktop eye [-150,42,235], phone [-60,47,285], targets [0,14,50]/[0,14,25]. It was built to an owned temporary snapshot only; no west screenshot or approval exists. Review or replace it on resume.
- Stronger beacon was viewed by Terra at `shots/kingdom/beacon-full-dusk.png` / `beacon-full-night.png`; main has not yet inspected that final appearance independently. The raised-camera trial includes the stronger beacon and main did inspect it.
- Preview 5190 (owned session 58259) serves the last production snapshot, **not** the latest west camera or strongest beacon source. Temporary dev 5186 is owned session 25398. Owned camera-trial snapshots are temporary only; no production service was changed. Recheck process status on resume.
- Next, only after resume: solve camera/terrain acceptance blockers, then freeze source long enough for full `pnpm verify`, inspect final twelve kingdom plus stream/panel shots, rerun runtime if engine changes require it, capture the 160-frame/20 s offline wave (1440×900 CSS / 960×600 physical by default), encode/review it, commit selected evidence and green integration, push. Real-GPU timing remains outstanding; founder was given 5190. Content, Herald and Atlas lanes remain with their teams and have unfinished work; do not merge uncommitted files.

### Lane integration — current authoritative checkpoint

- Founder resumed the goal, then prioritized the team's committed work before further dusk changes. Main locally
  merged `lane/street-props` at `66c522a` (all twenty authored models; SP03 assembly acceptance still unchecked),
  `lane/homes-hearth` at `9e316ff` (HH01 **and HH02**, nine models through house tier), and `lane/herald` at
  `da2d1d9` (H01). Their later uncommitted files remain in their worktrees and were not copied or merged.
- `pnpm install` registered the Herald/Twitch packages in the root lockfile. Astra high reviewed H01 and main's
  integration correction now blocks capabilities on token loss/failed validation and obsolete inspections. Six
  regression cases pass. No new live Twitch reads or H02/H03 success are claimed.
- The browser's single SSE adapter now explicitly accepts either configured `live` or `simulated` origin,
  labels replay SIMULATED and rejects cross-origin frames; existing freshness, sequence, epoch and realm guards
  remain. H02's PRD records the option and `/?source=herald&presenceOrigin=simulated` route.
- Main's uncommitted scene integration selects the nine reviewed Hearth forms for their actual matching plots;
  other styles and unfinished manor/hall tiers still use explicitly authored core assets. Passive garden edges,
  pots, troughs, shrubs and stones sit outside home reservations and clear of approaches. Addresses/presence
  slots do not change. Props join actual shadow/light occupancy as well as worker-built instanced geometry.
- Latest source passes typecheck, lint, build and all 415 unit tests, run with at most two CPU cores. A single
  full verify/capture run follows before push. Capture runs must be serial and lean on this shared host. Fixed
  evidence views now skip identical redraws while keeping the presence feed/watchdog alive. No film is running.
- The previous dusk integration is preserved in the working tree and a local safety stash. The stash operation
  could not remove a read-only mount, so tracked edits stayed in place; the two untracked beacon files were
  restored explicitly. No source was lost. The stash contains only this main work, not lane files or secrets.
- Remaining art blockers are still open: repetitive rear gables and the terraced hamlet plinth. Terrain architect
  remains interrupted while this integration lands; no rolling-ridge proposal has been implemented. The west
  camera experiment and stronger beacon need the new integrated shot review. Wave film and final acceptance
  remain required. Goal stays active after this integration checkpoint.

### Green content/Herald integration; Atlas unblock next

- Main's combined integration passed `pnpm verify`: typecheck, lint, 419 unit tests, build and 19 standard shots.
  Main opened all twelve kingdom views, both stream matrices and panel bench. Full props validation (20) and
  partial Hearth validation (9) passed. The original phone triangle limit caught an overage; tested 20 m distant
  horizon cells saved 37,484 triangles without changing the 1 m ground join or removing content. All 240 actual
  production-selected home sources pass the field/removal test. Small props occlude the local field and shadows;
  the distant approximation resolves buildings so sub-cell décor cannot falsely seal a street.
- The replay adapter browser proof passed on one serial page: Juniper's new Hearth window/name at both sizes,
  SIMULATED label, opposite-origin rejection with all light fields cleared, then recovery. Images and JSON are in
  `work/evidence/kingdom/integration/`. No real Twitch/Herald producer success is implied. Main looked at them;
  the phone is tightly cropped, and the wide backs/plinth remain unacceptable. No final wave film yet.
- Founder then requested Atlas A01/A02 unblocked immediately. Its lane contains the reviewed real importer and
  survey-preview map, but the main-owned lockfile lacks `apps/surveyor`. Main is adding that importer on
  `lane/atlas`, checking a frozen offline install, then will commit A01/A02 together as explicitly authorized,
  credit the shipped CC0/OFL assets and merge. No more repeated blocked worker/review rounds are needed.
- Keep captures serial and CPU-bounded; full kingdom matrix is already proven for this source. After the Atlas
  merge, check its actual two map views instead of needlessly recapturing the unchanged kingdom matrix. The
  preview on 5190 serves the current integration build. Return next to the natural terrain and a dusk viewpoint
  where the actual windows face the camera, then capture the wave once that composition works.

### Atlas unblocked — authoritative latest state

- A01/A02 are committed on `lane/atlas` as `0a3ba03`: the real Surveyor importer and first survey-preview map,
  the main-supplied Surveyor lockfile importer, asset credits and checked PRD boxes. Tobias explicitly authorized
  their combined commit. Historical repeated lockfile failures are condensed in the progress log; A03 is next.
- Main resolved the two routine merge conflicts by retaining all Herald/Twitch dependencies and adding Surveyor
  through pnpm, plus combining the art/font inventory with the kingdom's dependency/audio credits. Frozen offline
  install passes on the lane and main. The lane passed 363 tests; combined main passed `pnpm verify --area atlas`
  with 760 tests and two real Atlas captures, both opened by main. Review: `work/reviews/2026-10-30-atlas-integration.md`.
- The actual export integrity check passed on `obs-20261030T042315Z-d5a9af3c1cf2` (199,095 observed channels;
  254 sweeps, 12.64 hours, zero rejected/gaps). No source writes or official founding. The Atlas service on 5193
  belongs to the lane and was only read, not restarted or reconfigured. The web preview remains on 5190.
- Kingdom milestone `b4e0049` and Herald seam/auth fix `7b8e2eb` are pushed. Its full 19-shot matrix and two close
  replay captures passed and were inspected. All new look/content work is committed; the old safety stash can be
  discarded after confirming this checkpoint. No wave film yet. No real-GPU timing claim.
- **Next remains the founder's look brief:** remove the hamlet's terraced plinth, compose the dusk view so the
  actual designated windows face us, preserve the personal street-level arrival, then capture the ripple/beacon.
  Do not call the existing west-oblique camera accepted: main and Terra still reject blank backs and overly dark
  separation. The close Hearth view proves the content/adapter but is tightly cropped on phone and needs better
  warm spill. The terrain architect's rolling-ridge/current-footprint-pad proposal is still unimplemented.

### Pause checkpoint — latest; stop until founder resumes

- Founder paused the goal again. Main set goal status paused and interrupted its owned targeted verify process
  (exit 130). Terrain/light architects have completed their turns; no new capture was started for their changes.
  Preserve all uncommitted files. Do not resume because this context is fresh.
- Confirmed pushed main: `082232a` Atlas merge, `b4e0049` Hearth/props/shadow/look integration, `7b8e2eb` Herald
  auth/replay seam correction. Atlas A01/A02 are committed as `0a3ba03`; main fast-forwarded `lane/atlas` and its
  worktree to `082232a` and completed its frozen offline install for all ten packages. **A03 can proceed.**
  Herald and content lanes retain their later uncommitted work; main did not copy it.
- Last committed evidence: full `pnpm verify` passed 419 tests + 19 standard shots for the kingdom integration;
  replay browser proof passed with two close Hearth images, origin rejection/withdrawal/recovery. Full props20
  and partial Hearth9 validation passed. Combined Atlas main passed `pnpm verify --area atlas`: 760 tests + two
  actual survey map shots, both opened by main. All captures ran serially on the same two CPU cores at low
  priority. See the two integration review docs and `work/evidence/kingdom/integration/`, `work/evidence/atlas/`.
- **New uncommitted natural terrain:** `packages/world/src/layout.ts`, its tests and `terrain-worker.test.ts`.
  Astra xhigh replaced quarter-wide plateaus with a rolling ridge, current-depth footprint pads, exact street/
  castle contacts, rounded 12 m feathers and a spatial pad index. Lake bays carve before mandatory contact pads.
  Addresses/reservations/slots do not move. 49 focused tests, typecheck and scoped lint passed, including actual
  Hearth/prop contact, all 240 sources and horizon joins. Maximum capture-seed contact offset .346 m under .4 m;
  displacement 1.313 m under 2 m. Terrain topology/transfer unchanged. Visual acceptance is unproven.
- **New uncommitted local-light correction:** the three light-field files. Recessed Hearth glass put a valid
  source inside a conservative 0.5 m cell; the local path dropped its normal and skipped exact-air projection.
  All modes now preserve normals and use the same bounded guarded projection. Real replay case local visits
  rise 0 → 1,736; combined 31 → 1,767; removal clears to zero and memory stays unchanged. 43 focused tests and
  scoped lint passed, including all eighteen family/tier/yaw combinations and thin/second-wall rejection.
- **Unreviewed camera experiment in `scene.ts`:** town eye [180,130,265], phone [-80,130,285], target [0,14,50].
  A CPU study in `shots/kingdom/camera-candidates.json` tested actual ordered-home occlusion/framing (not terrain,
  LOD or pixels): 86/44 visible front sources versus far fewer in low-angle candidates. It is evidence for choosing
  a shot, not art approval. The increased height may push the beacon-cloud moment out of frame; inspect and
  adjust before keeping it. The personal opening remains at its actual street window.
- `packages/testing/shots.mjs` now has uncommitted `--tier hamlet|town`, `--hour noon|dusk|night`, `--size
  desktop|phone` filters for lean targeted checks. Defaults retain all standard shots. The interrupted command was
  `pnpm verify --area kingdom --tier hamlet --hour dusk --size desktop`; do not claim it passed.
- On resume only: review these diffs, update Spec 02's obsolete full-reservation-flat decision to current-built
  footprint contacts (growth terraforms a new snapshot without moving the address), finish verification, then a
  small serial dusk batch: natural hamlet, town window-facing composition, close Hearth spill. The wave film and
  final complete art acceptance remain open. Last committed shots still show blank backs/plinth; don't call the
  latest source demonstrated. Preview 5190 is live but may serve an unreviewed build from the interrupted run;
  recheck before asking for hardware timings. No real-GPU timing evidence yet.

### Resumed — terrain, recessed light and dusk composition

- Founder resumed the same goal. The preceding turn made authoritative progress: pushed Atlas/content/Herald integration and recorded evidence; the pause preserved the next terrain/light work. Main reviewed those diffs and is running a CPU-bounded verify with only two desktop dusk captures. Capture work remains serial.
- Spec 02 now records current-depth footprint grading rather than flattening the entire future reservation. All addresses and growth space remain fixed. Recessed local emitters now use the same guarded exact-air projection as the distant field. Both changes still await the integrated visual check.
- The 130 m town camera is an experiment, not acceptance. Main is reviewing its roof clearance and cloud framing plus the opening camera arc before finalizing it. Final matrix, wave film and real-device timing remain open.

- Natural-ground/local-emission milestone passed `pnpm verify --area kingdom --hour dusk --size desktop`: typecheck, lint, 787 tests, build and both desktop dusk captures. Main opened both. The hamlet plinth is gone; exact built contacts remain grounded. Its accepted terrain evidence is `work/evidence/kingdom/natural-ground/hamlet-dusk@1440x900.png`. Camera acceptance is separate: the town exposes many warm fronts but is still too overhead, and the hamlet still hides fronts behind the near row. The local-light regression is now covered across all eighteen Hearth tier/family/yaw combinations. Vitest is capped at two workers; capture selectors preserve the full default matrix.

- Next composition check: town desktop [210,110,310] toward [0,20,50], phone [-75,85,285] toward [0,17,60]. Main viewed these actual dusk images: the near quarter fits, front windows read and the phone beacon reaches a visible cloud catch. A too-wide phone trial failed the unchanged 800k triangle cap. The cause was one monolithic ground mesh drawing offscreen terrain; render-only 64 m tiles now cull that ground without changing any source triangles, fields or contacts. Both town views and both hamlet views passed the serial dusk capture budget after tiling. A final hamlet-only framing trial rises to85 m and moves closer to show more fronts; it remains unreviewed.
- Astra xhigh verified the prior camera endpoints and the gradual22 m street-rise/pull against exact ordered homes, castle, props and rendered terrain at5 ms samples, plus conservative continuous bounds: near-plane solid margin≥1.09 m and terrain≥3.74 m; trees excluded. The hamlet endpoint adjustment requires the same recheck. Terra high reviewed the actual dusk framing. Full tests and final film/matrix remain in progress.

- The complete unit suite passed 788 tests in 43 files after terrain tiling. The new regression preserves every packed vertex and rebased triangle, including vertical layers and 64 m boundaries. The actual browser replay now reports 1,767 visited light cells and shows warm Hearth plaster at both sizes; source rejection/recovery still clears and restores correctly. Main opened both images. Final `pnpm verify` is capturing the unchanged standard 19-shot matrix serially. The wave film follows after that process releases Chrome. The 5190 response matches the current built index; founder was given the town route without fixed time for GPU checks.

### Green dusk composition; founder requests final content integration

- Full `pnpm verify` passed: typecheck, lint, 788 tests and 19 standard captures. Main opened all twelve kingdom views, six stream views and panel bench. Selected contact sheets, close warm-window proof and camera-clearance report live in `work/evidence/kingdom/dusk-composition/`; review is `work/reviews/2026-10-30-dusk-composition.md`. Hamlet ground now rolls naturally, more fronts face us, and the 35 m aim leaves room for the beacon/cloud. Town phone stays inside the 800k triangle cap through render-only terrain culling. The gradual personal street-rise remains, with the exact CPU sweep passing eight cases.
- Founder then prioritized SP03 / HH04 uncommitted lane work plus committed HH03. Main will review, commit those lane-owned changes on their branches and merge them, selecting completed Hearth manor/hall models in the actual kingdom. Both lane logs contain later screenshot timeouts, so their earlier full-verify claims are not accepted as proof. Main integration verification follows.
- Founder also requested a machine-wide queued capture lock: one shared kernel flock for all worktrees and every browser runner, including external-base-url checks/content/film. Sol high owns only its new helper and cross-process tests; main wires runners after the current capture process has exited. Do not start the wave until this integration lands. Then return straight to dusk/wave; do not substitute these merges for the full goal. No wave film or real-GPU timing has been claimed.

### Capture queue and final content review

- `818244b` is pushed after the complete 788-test / 19-shot verify and main visual inspection. Full current dusk matrices and exact camera-sweep proof are committed. The film remains pending the founder-prioritized content merge.
- All five browser runners now acquire one shared host flock before preview/browser startup, including external-base-url paths, and release only after browser/server cleanup. The stable inode is named by `CAPTURE_LOCK_PATH` in `packages/testing/capture-lock.mjs`; no stale-PID stealing or unlinking. Waiting is visible in logs. Independent process tests cover queue exclusion, idempotent release, killed holders/waiters, queue cancellation, post-acquisition ownership and spawn failure. Six focused tests plus global typecheck/lint pass. Every worktree must receive these updated runners to join the queue; already-running older scripts cannot be retroactively locked.
- Main and Terra high reviewed the actual HH03/HH04 and SP03 source plus lane-rendered home/style/join evidence. Main independently passed 142 Hearth tests + full 15-model validation and 46 prop tests + full 20-model validation on the exact uncommitted worktrees. Earlier screenshot timeout notes remain historical failures, not green evidence. The shared Hearth factory is read-only by documented policy; current production consumers rasterize/clone for jobs and do not mutate blueprint arrays. Future editing must clone the asset.

### Complete content lanes merged; GPU feedback now steers the core

- SP03 committed on its lane as `ab8cea5`, HH04 as `50a2f34`; HH03 was already committed as `ea77d88`. Main merged them as `583c30b` / `d7b31a3`, then selected all five completed Hearth tiers in the kingdom. Production selection tests retain the same address and first presence-window anchor across hut through hall.
- Exact integrated `pnpm verify` passed: typecheck, lint, 858 tests in 44 files, build and 19 standard captures. Main opened the current twelve kingdom views, six stream views and panel bench; selected matrices and collection cost/camera/queue reports are in `work/evidence/content-final/`. Both PRDs are now accepted complete. Lane logs' earlier shot timeouts remain historical; this is the superseding main evidence.
- Both requested lane worktrees fast-forwarded to integrated main with the updated capture runners and completed frozen offline installs for all ten packages. The default host-lock probe actually queued two independent content runners (main and street-props) behind main verification, then both acquired and reached the deliberate missing-asset gate without launching Chrome. Other worktrees must receive `7d7a9cc` or newer before their next capture; old already-running scripts cannot join retroactively.
- Founder GPU feedback: light, hills, lake and beacon read well on RTX 5080. The remaining suburb grid is a real art blocker. New direction: genuinely winding terrain-following roads, market square at their meeting, town gathered beneath a larger castle on a rise. Preserve the successful light/landscape while rebuilding the settlement structure; random jitter in parallel rows is insufficient. Astra xhigh is designing the small road/frontage/market consumer contract read-only before any layout edits.
- Founder also reports a bright lake rim, too few warm dusk windows and live capture readiness hanging. Terra high isolated the likely bright soil bank plus shallow reflection (not foam); no shader edit yet. One-person/one-window remains the vision rule: populate the default labelled SIMULATED view through real scenario presence, improve frontage visibility/spill, and retain a separate explicit cold arrival replay. Never multiply citizens or fake live chat.
- The checker reproduced the no-fixed-time page on this exact build: literal ready fired at 27.6 s, stats.ready at 19 s, but no field uploaded yet. No errors. This contradicts a literal never-fires claim while exposing two actual problems: repeated identical GPU rendering during loading wastes SwiftShader time, and ready can be advertised before useful light is published. Main will fix first meaningful-frame readiness without requiring a continuously animated field to become idle. The 5190 owned preview had exited; main restored it (owned session 55867). No wave film or final town acceptance is claimed.


### Live opening correction and new settlement implementation

- `a088e76` is pushed: completed SP03/HH03/HH04 are committed, merged, accepted and selected across all Hearth tiers. Both lane worktrees were fast-forwarded to this accepted main state. Six queue tests and the real two-worktree default-lock probe passed; all six current browser runners use the same queue.
- Readiness/default-opening correction passes a targeted `pnpm verify --area kingdom --tier town --hour dusk --size desktop`: typecheck, lint, 858 tests, build and one actual fixed dusk capture. The no-time browser regression then passed: literal ready has 240 SIMULATED residents, three field uploads and a rendered scene; cold reset gives 0/0 visited, then 1.75 s gives one lit window, propagated light and visible Juniper. No errors. Report: `work/evidence/kingdom/live-ready/report.json`; script `packages/testing/kingdom-live.mjs`. This is behavior evidence, not a speed/FPS claim. It supersedes the earlier premature flag before lighting.
- Terra high has a separate, uncommitted bank-only shader change: subdued grass/soil at the waterline, returning to grass by +.4 m. Water reflection remains untouched. It is unbuilt/unreviewed; do not stage it as if the readiness proof covered its visual result. Before image is `shots/kingdom/shore-before@1440x900.png` for the next single A/B capture.
- Main reviewed Astra's `work/specs/02b-settlement-plan.md` and authorized additive world implementation in a new settlement module with tests/fixtures. Preserve old active layout until the new small contract has passed its own tests and main migrates consumers. This is a green-commit boundary, not a second product or reduced scope. The new plan has genuine winding roads/market/courts, four-turn frontage helpers, fixed founding geography, reserved growth sites and a real-scale modular castle. Main owns renderer/content/field/camera migration. Types freeze with fixtures/tests, not from the proposal alone.
- Current preview 5190 owned session 55867 serves the latest readiness build, not the bank shader or future road graph. No final winding-town look, bigger castle or wave film has been demonstrated yet. Those remain the active goal.


### Rendered live readiness and a quiet shoreline

- `c17e0d5` is pushed: the no-fixed-time page advertises ready only after a rendered scene and all three light uploads. The default labelled SIMULATED visit opens inhabited; the explicit arrival replay still starts with zero citizens. The browser regression proves 240 at opening, then 0 → 1 with actual propagated light and Juniper visible. No errors; report is in `work/evidence/kingdom/live-ready/`.
- Main inspected the bank-only A/B and found the shallow water itself still outlined the lake. The final change subdues the bank, darkens the shallow bed and fades reflected sky through the final .6 m of depth. Open-water waves/reflection remain. Main viewed the resulting 1440×900 and 390×844 dusk shots; before/after evidence is in `work/evidence/kingdom/shoreline/`. Typecheck, global lint, 864 tests, build and these two serial targeted captures pass. This is a shoreline correction, not acceptance of the still-rejected town rows.
- The proposed replacement settlement is in `work/specs/02b-settlement-plan.md`, with source study in `work/references/settlement-streets.md`. Astra xhigh owns additive world geometry/terrain/generator/tests; main has not migrated the running layout. Terra high authored separately tested castle modules, including grounded connectivity and a clear 4×6 m gate, but the new compound is not installed or visually accepted yet.
- Astra high review found a concrete light regression to prevent: enlarging the old terrain bounds to 416×432 m silently selects a 4 m field, suppressing 66 of 240 isolated emitters. The new far field must cover the active homes plus spill, independently of decorative terrain/lake extents, and retain proven frontage light. Do not relax the 12 MiB combined guard or count neighbours' light as proof of an individual window.
- Preview 5190 serves the latest built shoreline/readiness changes. The winding market town, larger installed castle, final camera proof, complete updated matrix and wave film remain active work.
