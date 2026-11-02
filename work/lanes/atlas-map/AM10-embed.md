# AM10 embed checkpoint

The first AM10 checkpoint exports `mountAtlas` and `preloadAtlas` from
`apps/web/src/atlas/embed.ts`. Front-door can mount `hero` or `explore` now.
Give the host element an explicit height. Importing the entry requests neither
map data nor the renderer. `preloadAtlas` deliberately warms both.

The default `/map` export uses the same scene, with URL routing. An embedded
explore map defaults to memory routing; wheel zoom activates after interaction.
Hero mode has no chrome, passes wheel and touch scrolling to its page, and calls
`onExplore` on click or Enter. `setMode` preserves its canvas. Hidden and offscreen
maps pause their rendering frames. Reduced motion holds a composed hero view.
`gate` deliberately refuses mounting until AM11 supplies its actual finder.

A Canvas2D still of the same hash-checked revision covers renderer initialization
and remains without WebGL. `ready` may resolve `still` before WebGL finishes;
`data-atlas-ready` subsequently upgrades to `map`. Hosts requiring final renderer
readiness for a performance sample must observe that attribute as well. The first
still currently needs the world head and local tile baking; immediate network
still delivery and the small hero head remain performance work.

Input handlers are element-local rather than delegated onto the document, so
unmount releases the embed's global listener additions without clearing listeners
owned by the page. Abort and disposal also cover pending world reads, renderer
initialization, background chunk work, font grace, live reconciliation and delayed
card replies. The existing page evidence hook remains exclusive to URL routing.

## Verification

- Frozen offline dependency installation; no manifest or lockfile change.
- TypeScript, scoped ESLint and the web production build passed.
- 110 focused unit tests passed: camera, gestures, flight motion, tiles, recovery,
  card history, preview pinning and still composition.
- `checks/embed-checks.mjs`: 18/18 browser checks passed, including lazy entry,
  early and mid-fetch disposal, custom base, two differently sized hosts,
  native wheel and touch page scrolling, memory routing and activation, canvas
  preservation, and global listener/timer/frame/worker baseline restoration.
- `checks/embed-still-check.mjs`: WebGL disabled; dated still, search and disposal passed.
- Six PNGs in `work/evidence/atlas-map/` opened and reviewed. Five real-GPU images
  show hero, embedded explore and `/map` at desktop/phone sizes; the sixth shows
  the WebGL-free still. The old labels and verbose chrome are intentionally still
  visible: their AM10 checkpoints follow this one.
- Real data: revision `obs-20261101T185031Z-db1a6987a0e6`, 57,289 mapped holdings.
  A read-only live sweep at 22:02 UTC yielded 7,683 live holdings and 24,952 dabs.
  Only the lane-owned copied data directory was written.
- Real-GPU 1920×1080, five-second browser-frame sample with that live frame:
  hero 24.9 fps, p50 33.4 ms, p95 58.4 ms, p99 219.4 ms, worst 250 ms;
  `/map` 248.7 fps, p50 2.8 ms, p95 2.9 ms, p99 41.7 ms, worst 66.5 ms.
  These include initialization after the first still and are not a clean steady
  state benchmark. Neither the hero's 60 fps bar nor its frame-time bar is met.

## Remaining AM10 work, in its prescribed order

The name table and its review sheet come next, then fresh faces, the server-side
Twitch fallback, carved chrome/key and the complete desktop/phone/GPU pass.
Further embed acceptance includes strict-CSP verification, focused flight/cancel
checks, final renderer performance samples while idle/panning, and live caravans
when AM11 connects the roads. The goal box stays unchecked.

## Operator and integration notes

The only additive edits outside Atlas are the bench registration in
`apps/web/src/main.tsx` and the environment-selected `/map-data` proxy target in
`apps/web/vite.config.ts`. The user requested one checkpoint commit; both edits
are recorded with it. Default production routing is unchanged.

After integration, front-door can import the embed directly. Adopting the web
build is the existing operator workflow; this checkpoint adds no new API routes
or service configuration. No live service or data in the earlier Atlas worktree
was modified. The front-door story owns its own page-wide readiness and CTA.

Temporary preview 5175, service 5199 and leased preview 5192 are stopped after
checks. A test service started on 5198 also reads this lane's ignored data; its
terminal handle was lost during setup and requires cleanup by the host operator.
Do not confuse it with the live Atlas on 5193, which must stay untouched.

needs: real phone check of `/map` and `/-/atlas-embed?mode=hero` at 390×844 after
AM10's final performance pass; clear the lane's test listener on 5198.
