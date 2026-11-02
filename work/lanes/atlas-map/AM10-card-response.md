# AM10 card response: the seal answers the tap

The previous checkpoint left the 100 ms card gate blocked: on the 390×844
Canvas2D still, a search-row tap took 137.8 ms to reach the card DOM and
293.2 ms to two painted frames, and native `drawImage` long tasks of
161–327 ms sat in front of input. This checkpoint takes every piece of
background work off the path between a tap and its card. These are browser
checks on this shared host (load average 21–28 on 12 cores during the runs),
not physical-phone or GPU performance claims.

## What was in the way

A CPU profile of each selection, the long-task log and the minified bundle
named five costs:

1. **The wash repainted whole.** Every live tick, chunk arrival and selection
   redrew all ~20,000–30,000 vermilion stains (one rotated `drawImage` each) in
   a single task: 150–330 ms on this host.
2. **A selection redrew the wash.** The drawing effect depended on the layout,
   so a selected-first relayout repainted every stain before the card could
   mount.
3. **Every shield repainted on every layout.** A new layout object made each
   still shield canvas reset and redraw, even at an unchanged size.
4. **Pencil placement ignored its own budget.** `LivePaint.work(6)` checked
   its 6 ms budget only between regions, and a single dab search in a crowded
   or full realm can cross the whole region: 50–70 ms tasks of
   `realmAt`/`nearest`.
5. **The first tap opened the audio device.** The wax cue's `new
   AudioContext()` ran inside the first selection's pointerdown: 36–41 ms
   here.

## Decisions

- **The wash is laid in slices on a back layer and swapped in whole.**
  `WashCanvas` lays stains in 6 ms slices (`WASH_SLICE_MS`), reads the clock
  every 32 stains, and swaps the finished layer to the front. One combined
  `setTransform` per rotated stain replaces translate/rotate/reset. A request
  that arrives while a layer is being laid waits for it (a stream of chunk
  arrivals cannot starve the layer). A request soon after the last one waits
  out `WASH_REPAINT_MIN_MS`, unless the land itself changed, which starts at
  once and drops the old layer.
- **The paper is composed once per land and finished wash.** Land, the wash
  multiplied in, margin and neatline go to a cached paper canvas. The drawing
  is one `copy` of that paper plus the lettering. A selection or a name change
  never re-multiplies the wash.
- **The still is ready once its first wash is in**, or once there is none to
  lay, so it is never announced as bare paper.
- **The map makes room for a selection one painted frame after the card.**
  The pressed ring of a drawn mark follows the selection at once. The
  selected-first relayout of a collision-suppressed holding runs after the
  next frame. The card and its seal answer the tap first.
- **Shields repaint only when their size or pixel ratio really changes**
  (memoised inputs), not when a new layout hands them a new object.
- **Pencil searches are stepwise, with identical answers.** The shared
  `PencilRegionPlaces` gains `placeSteps()`, a generator over the same search
  that yields after every lattice row and every 48 tested candidates. The
  service still calls `place()`, which runs the same generator to completion,
  so service and browser cannot disagree. `LivePaint.work()` keeps a cursor
  (region, dab index, unfinished search) and honours its budget inside a
  region and inside a single dab. A test proves sliced placement equals one
  unlimited pass, dab for dab. Another proves stepwise results equal `place()`
  for 120 lookups, including a filled realm that answers null.
- **The audio device never opens inside a selection gesture.** A tap into a
  field or a non-activating key (typing, Tab) primes the context inside that
  quiet gesture. When the very first gesture is itself a selection, the first
  cue waits for the click, two painted frames and the next idle moment, then
  opens the device and strikes. A press that never becomes a click stops
  waiting after 400 ms. Such a cue may arrive up to 450 ms after the press;
  later than that it is dropped, never replayed. Enter and Space never prime,
  since they may themselves select. Dragging the map never opens audio.
- **Checker hygiene.** The focused checkers now wait in the shared capture
  queue (`ATLAS_LOCK_WAIT_MS`, default 20 minutes) instead of aborting after
  60 s. The phone card still is taken after the card's entrance animations
  finish. The earlier still only looked settled because the card was late.
  The profile artifact name can be set with `ATLAS_PROFILE_NAME`, so the
  earlier failed profiles are kept as they were.
- **A restart in the fallback HTTP test is a real restart.** The test now
  closes the first service before starting the next on the same data
  directory. AM11's single-writer road ledger correctly refuses a second live
  writer, which made this AM10 test fail.

## Verification

Scoped TypeScript (`tsc --noEmit`, whole repo) and ESLint pass on every
touched file, and the web and Surveyor builds pass. Focused tests pass: 34
live-paint (including sliced placement equals one unlimited pass), pencil and
compose tests (86 across paint, pencil, compose and sound), 12 sound tests
(deferred first cue, stale/muted/disposed drops, prime, no prime while
muted), and 144 Surveyor directory, cartography and live tests (stepwise
search equals `place`, including a filled realm).

Browser checks ran on the real retained survey (`squeezie`, a mapped capital
absent from the opening still), 390×844, WebGL off, through
`phone-performance-checks.mjs`:

| Build | Check | Card DOM | Two-frame paint | Long tasks in window |
|---|---|---|---|---|
| previous checkpoint | phone check | 137.8 ms | 293.2 ms | 161–327 ms before input |
| sliced wash + paper + deferred relayout | phone check, 9/9 | 30.6 ms | 67.0 ms | — |
| + quiet-gesture audio, click-tied first open | phone check, 9/9 | 30.8 ms | 64.1 ms | — |
| same | profile ×3 | 21.8 / 73.2 / 42.0 ms | 135.4 / 110.8 / 82.9 ms | audio open 73 ms (trial 1), pencil search 59 ms (trial 2) |
| + stepwise pencil search, idle first open (final) | profile ×3 | 37.0 / 38.2 / 45.8 ms | 143.5 / 67.6 / 65.0 ms | one 69 ms task holding the first card's mount (trial 1) |
| same (final) | phone check, 9/9 | 28.6 ms | 61.7 ms | — |

The final build removes both named long tasks: no audio open and no pencil
search appears inside a selection window. In every trial the card and its
seal reach the DOM within 46 ms of pointerdown, and its entrance animation
(the wax press is 180 ms) begins there. The conservative two-frame paint
proxy is 65–68 ms for warm selections. The first card of a page took
143.5 ms once, under load average 16–21. Its 69 ms task contains the card's
own mount, focus and first heraldry drawing, plus `washStains` samples, and
the profile cannot tell them apart. This is recorded, not relaxed. If a real
device shows the first card late, the next step is to move
the card's first heraldry drawing and focus behind its first painted frame.

The embed contract check (`embed-checks.mjs`) passes 18/18 on the final
build:
- lazy entry
- dispose during mount and during world fetch
- custom base
- two maps
- listener, timer, frame and worker release (the sound module's click listener
  and idle callback included)
- hero scroll, wheel and touch passing to the page
- no history writes

One run first failed "hero wheel scrolls its host page". It sampled `scrollY`
once after a fixed 500 ms, while its own detail, read a moment later, showed
the page scrolled to 450. The check now waits up to 3 s for the scroll, and
the rerun passed. Two earlier reruns timed out in the shared capture queue
(13 lane captures waiting, load average up to 40) without running.

Evidence:
- `work/evidence/atlas-map/am10-phone-final-still-checks.json` and
  `am10-phone-final-still-card-390.png`, taken after the entrance settles and
  viewed: opaque sheet, face seal, actions and wash all present.
- `am10-phone-sliced-wash-profile.json` for the final profile.
- The earlier failing profiles remain unchanged as
  `am10-phone-final-profile*.json`.

No collector import, Twitch call, public write or production change ran. The
owned service read `obs-20261101T223528Z-f83a4722106d` on `127.0.0.2:5199`,
and the owned preview ran on `127.0.0.2:5175`, during checks only. The GPU
tunnel still reports not connected (`chatdom-pc status`), so there is no GPU
claim.

## Sound under gesture-only audio rules (follow-up)

The deferred first open (above) creates the audio device after the painted
answer, outside the gesture. Under the rule Chrome and Firefox follow (audio
may start any time after the page's first gesture) that device runs and the
first cue sounds. Under Safari's rule (audio starts only inside a gesture) it
stays suspended, and its `resume()` promise stays pending for ever, as the
spec says. The module used to keep that one promise as its only unlock, so it
never asked again: after a first selection on Safari the Atlas was silent for
the rest of the visit.

- **Every gesture asks for its own unlock.** A cue on a suspended device
  calls `resume()` inside its own gesture, whatever an earlier request is
  doing. Whichever request settles first strikes the latest cue, once. The
  160 ms age limit still drops a slow unlock rather than replaying an old click.
  A refused request drops only its own cue.
- **On Safari the first cue after a first selection is silent, never late.**
  Opening the device inside the selection would put 36–41 ms between the tap
  and its card (measured on this host). A tap into the search field or a
  typed key still readies the device in a quiet gesture, so a selection that
  follows sounds at once on every browser.

Verification:
- `material-sound.test.ts` has 15 tests, three of them new: a deferred
  request that never settles does not block the next gesture's unlock; one
  unlock strikes the latest cue once however many requests settle; a refused
  request drops only its own cue.
- `checks/sound-unlock-checks.mjs` runs the real module, real input and
  Chrome's real `AudioContext`. Headless Chrome on this host starts every
  context whatever its `--autoplay-policy` flags, and headless Firefox has no
  audio device at all, even with every rule off. So the check enforces both
  start rules in the page: `navigator.userActivation.hasBeenActive` for the
  Chrome and Firefox rule, and a trusted input event being dispatched for
  Safari's.
  - Before the fix, a first selection under Safari's rule gave 0 cues after
    two further presses.
  - After the fix, the first cue is silent and both presses sound on one
    running device.
  - Under the Chrome and Firefox rule, and after a field tap under either
    rule, all three cues sound.
  - The card mounts within 0.1 ms of the press in every run.
  - Evidence: `work/evidence/atlas-map/am10-sound-unlock-checks.json`.

This is not a Safari or physical-device run. Tobias's phone pass should
include: first action a mark selection (silent is expected), then any press
(it must sound).

## Names knock out the survey marks under them (follow-up)

The default still at 1440×900 showed survey marks sitting inside the
continent names: clusters of capital marks ran through "STREAMS IN RUSSIAN"
and single dots sat between the spaced letters of "ENGLISH". The still drew
its marks as buttons above the canvas lettering and never tested them against
it. The moving map drew its lettering above the marks, but its paper halo only
covers the stroke round each letter, so dots still showed between the spaced
capitals.

- **One rule, shared.** `underLettering()` and `LETTER_CLEARANCE` (3 px) live
  in the Pixi-free `map/collide.ts`, next to `MARK_PX`, which both renderers
  now import. The overlay's own copy of the mark sizes is gone. A survey mark
  whose dot, plus that clearance, touches a language, archipelago or realm
  name is lifted out, as a cartographer lifts a dot out of the lettering.
- **Only small marks give way.** Stamps already claim space before or after
  names in the collision grid and are unchanged. The selection and any forced
  (found) holding are never lifted: selecting a lifted holding draws it first,
  at its place, with its stamp and name. Lifted holdings stay findable by
  search and come back as the camera moves in and the names move away.
- **Decor under names stays.** Mountains and towers are baked into the land
  tiles, and the paper halo is enough there, as on a printed map.

Verification:
- New compose test: a dense patch of cities is placed where the first name is
  lettered. No drawn survey mark sits under lettering at 1440×900 or 390×844,
  at least one city is really lifted, and selecting it draws it first. The
  test fails with the filter removed.
- New `underLettering` tests: inside, within the clearance by the mark's own
  size, clear of the name, and nothing lettered.
- 211 still and map tests (parity and overlay included), whole-repo `tsc`,
  ESLint on the touched files, and the web and Surveyor builds pass.
- Stills `work/evidence/atlas-map/am10-lettering-1440.png` and
  `am10-lettering-390.png` were taken on the real retained survey through the
  owned service and preview, and viewed. Every continent name reads clean,
  with 135 / 70 marks drawn.

## Test environment (2 Nov, review follow-up)

The review asked for the lettering tests to run in their configured
environment. The repository's configured environment is `node`
(`vitest.config.ts` at the root). `jsdom` was never installed: the lockfile
lists it only as an optional peer of Vitest. It shows up only because
`vite-plugin-solid` sets `test.environment = 'jsdom'` whenever Vitest reads
`apps/web/vite.config.ts`, which is what the PRD's filtered command
(`pnpm --filter @chatdom/web exec vitest run src/atlas/…`) does. Under that
command every web test failed to start with "Cannot find package 'jsdom'".

- None of the 32 Atlas test files needs a DOM (`Event` is a Node 22 global),
  so each now starts with `// @vitest-environment node`. The root and
  filtered commands run them the same way.
- Vitest still checks the project's default environment at startup. The
  filtered command therefore needs `--environment node` to exit 0; without
  it, it prints "MISSING DEPENDENCY jsdom" and exits 1 even when every test
  passes. The command used from now on is
  `pnpm --filter @chatdom/web exec vitest run src/atlas/<files> --environment node --maxWorkers=1`.
  The flag mirrors the root config's single worker for this shared host.
- Under host load 25–32, three exhaustive sweeps went over Vitest's 5 s
  default: heraldry, the placement overlap check and the tile-plan
  no-empty-paper sweep. The two pairwise overlap checks (placement, still
  composition) now collect the clashing pairs and assert once, instead of
  making up to about 180,000 separate expectations. They are as strict as
  before, faster, and print a better failure. The heraldry file and the
  tile-plan sweep get explicit 30 s timeouts, because their work is real
  computation.
- Changing the web package's environment for every lane (set `node`, or add
  `jsdom`) is outside this lane's scope. It is written as a `needs:` line.
