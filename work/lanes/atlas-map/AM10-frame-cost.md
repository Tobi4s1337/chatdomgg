# AM10 frame cost: the hero rests, the wash is moved, not laid again

The only real-GPU sample of the hero (AM10 embed checkpoint) gave 24.9 fps at
1920×1080 against 248.7 fps for `/map`. A main-thread profile of the hero on this
host showed why. The hero's slow drift placed the camera on every frame, and every
placed camera re-laid the whole vermilion wash from scratch. That meant a store query
over every holding in view, a class, a bloom and a sprite for each of thousands of
washes, then a render into a screen-sized target. The overlay was laid out again too.
Panning `/map` paid the same wash cost on every frame. The bar is 60 fps while idle
and while panning on a real GPU.

## Decisions

- **The drift draws only a step someone could see.** `heroDrift()` (now in
  `map/motion.ts`, unchanged motion) wanders at most 36 × 22 px and 1.8 % of
  scale with periods of minutes. Its fastest point moves about a third of a pixel a second.
  The loop now places the drifted camera only once any point of the view has
  moved `HERO_DRIFT_STEP_PX` = 0.25 device pixels (`screenShift()`), so ~1–4
  draws a second instead of 60. Marks already land on whole device pixels, so
  nothing visible changes. A new base (composed, flown, resized) draws at once.
- **The wash is a picture laid with a margin, then moved.** `WashLayer` lays
  its blots into a target `WASH_MARGIN` = 128 CSS px wider than the view on
  every side. It remembers the world point of its corner, the zoom, the live
  frame and store versions, and when the next bloom or drying step is due
  (`live.nextChange`). Each frame it only positions and stretches one sprite.
  It is laid again when the live frame or store changes, when a bloom or drying
  step is due, when the zoom moves more than `WASH_SCALE_TOLERANCE` (1.2 %), or
  when the view would leave the picture. That last rule always applies at once, so
  no edge is ever uncovered. Result: the hero never re-lays for its drift; a pan
  re-lays once per 128 px instead of every frame.
- **Version-only changes are gathered.** While pencil places are found or chunks
  arrive, the live and store versions bump almost every frame. Those changes are
  laid at most every `WASH_GATHER_MS` = 200 ms while the old picture still
  covers the view and nothing is due. `wash.pending` keeps the loop drawing
  until the newer state is laid. A new live frame or a withheld holding reaches
  the wash within 200 ms.
- **The wash walks only what is on air.** `onAirOrder()` lists the live,
  unwithheld holdings once per live frame and store version, in the exact order the
  box query gave (class, then ordinal). A lay now filters that list by box instead of
  querying and sorting every holding in view. The close-up cap is per area, so the
  margin carries its own share (`limit × area ratio`). A test proves the
  order is identical to the earlier query path.
- The close-up wash budget, its density cap, the wash look and the still's
  parity constants are unchanged. Memory: the target grows by the margin
  (1920×1080 at resolution 1.5: 18.7 → 26.2 MB; phones far less).
- `reduceMotion()` in the view reuses one `MediaQueryList`. It is read on every
  frame, and it showed up in the settled profile.
- The map host carries `data-atlas-live-work="placing|done"`, written only when it
  changes and removed on dispose. Checks wait for it before they measure a settled
  map. It is not an interface for hosts.

## Measurements (this host, SwiftShader; JavaScript time inside the frame loop only)

`checks/hero-frame-profile.mjs` wraps `requestAnimationFrame` to time each
frame's callbacks and samples the CPU profile for 6 s. GPU work in SwiftShader
happens outside these callbacks, so these numbers are main-thread cost, never
frame rate. Host load was 17–31 throughout. The JSON for each run, with the top self and
inclusive functions, is in `work/evidence/atlas-map/am10-frame-profile-*.json`.

| Run | frames in 6 s | p50 ms | p95 ms | JS total ms |
|---|---|---|---|---|
| hero 1920×1080, before, 45 s after ready | 22 | 137.5 | 394.5 | 3,047.8 |
| hero 1920×1080, after, settled | 436 | 0.0 | 0.1 | 251.4 |
| `/map` pan 1440×900, before, 45 s after ready | 38 | 73.5 | 220.1 | 2,600.4 |
| `/map` pan 1440×900, after, settled | 116 | 0.0 | 56.2 | 1,035.3 |

The "before" runs predate the live-work attribute, so pencil places may still have
been in progress. The structural point does not depend on that: before, every hero
frame re-laid every wash, and `paint` alone averaged ~113 ms per frame in that
profile. After, the settled hero spends 4 % of its time in JavaScript, and only 8 of 436
frames take over 4 ms; those are the drift steps, mostly overlay layout. During the pan
the remaining lays are the 128 px margin crossings (the check drags 320 px legs).

On this host, finding the pencil places took 52–88 s, because SwiftShader gives
the loop about 5 frames a second and `work` 6 ms of each. A real GPU gives it ~12×
that. While placement runs, the gather rule holds wash lays to five a second at 60 Hz.

Stills, viewed: `am10-frame-hero-1920-after.png` (hero at rest) and
`am10-frame-map-pan-1440-after.png` (`/map` after a pan). The wash sits exactly on
the land at both, with no offset and no seam at the picture's margin.

## Verification

- 303 tests in `src/atlas/map`, `src/atlas/still` and `src/atlas/live` pass
  (new: drift bounds/shift/frequency, wash placement exactness, reuse and
  re-lay rules, gathering coverage, on-air order equivalence).
- Repo `tsc --noEmit` exit 0; scoped ESLint clean; web production build green.
- Embed contract checks 26/26 in real Chrome on the final build (lazy entry,
  disposal of listeners/timers/frames/workers, hero wheel and touch page scroll,
  memory routing, restore): `work/evidence/atlas-map/am10-frame-cost-embed-checks.txt`.

## Real GPU (RTX 5080, `chatdom-pc-lease`)

The first lease at 09:58 found the remote Chrome drawing no frames
(`chatdom-pc vis`: "0 frames in 1s"), so it measured nothing about the Atlas. The
pass was rerun with a gate that waits for the browser to draw. `chatdom-pc fps`
starts one second after ready, so initialization is inside the hero samples.

| Path | Size | fps | p50 | p95 | worst | > 33 ms |
|---|---|---|---|---|---|---|
| hero, idle (20 s) | 1920×1080 | 345.0 | 2.8 | 2.9 | 66.7 | 3 |
| `/map`, idle (15 s) | 1920×1080 | 360.1 | 2.8 | 2.9 | 2.9 | 0 |
| hero, idle (15 s) | 390×844 | 356.5 | 2.8 | 2.9 | 147.3 | 1 |
| `/map`, idle (15 s) | 390×844 | 351.4 | 2.8 | 2.9 | 52.7 | 4 |
| `/map`, pan (8 s, settled) | 1920×1080 | 353.0 | 2.8 | 2.9 | 19.4 | 0 |
| `/map`, pan (8 s, settled) | 390×844 | 359.4 | 2.8 | 2.9 | 13.9 | 0 |

The earlier hero sample was 24.9 fps with a 58.4 ms p95. Pans use
`checks/gpu-pan.mjs`, which opens one page of its own over the lease's CDP tunnel
and drags the map. It never touches his other tabs or the browser itself. The
tunnel's input latency allows two slow legs in 8 s, and the camera moved in both
runs. Stills, viewed: `am10-gpu-map-1920.png`, `am10-gpu-hero-1920.png`,
`am10-gpu-map-390.png`, `am10-gpu-hero-390.png`. Paper, ink, lettering and the wash
read as on SwiftShader; the wash sits exactly on the land.

## Outside this lane

The shipped page's zero-violation CSP needs the host's Zod `jitless` bootstrap
(main/front-door); the map already renders under the strict CSP with the probe
caught. Also outside the lane: the official mark merge, Tobias's physical phone
pass, the name-table sign-off and operator adoption.
