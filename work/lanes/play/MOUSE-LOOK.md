# Mouse look: the wild spin (2026-11-02)

## Update, 20:40: the real cause on Tobias's machine

The three fixes below were right but not enough. Tobias is on **Linux, Firefox 158 on X11** (dpr 1, 343 fps), not
Windows. His mouse lab (https://stills.chatdom.io/mouselab/) recorded the locked stream: every real move ([1,0],
[0,1]...) is followed by a fake event equal to the hidden cursor's offset from the re-centre point ([-978,105],
[-977,106]...), drifting by exactly the real movement. Firefox is not really re-centring the OS cursor (likely
XWayland), so the offset arrives as movement: the spin, and "up and down turns me sideways". Every plain, raw,
guarded, per-frame and DPR mode spun; right-button drag worked; lab mode 8 (a warp-echo filter) worked "pretty well".

What changed (`apps/web/src/walk/input/look.ts`):
- **`createEchoFilter`**, ported from lab mode 8 and made safe for real flicks. An echo is predicted as the last
  echo W plus the real movement since; an event within 3 counts + 2 % of that (both axes) is dropped, and so is a
  large event within 40 of W (a missed event). Lab mode 8 dropped *every* event over 200 counts to learn W, which
  would eat real fast flicks on Windows and Chrome. Here a large event with nothing learnt is only *held*: if a
  second large event arrives equal to it plus the small real movement between them (a real move must sit between,
  at most a quarter of its size), both were echoes and W is learnt; otherwise it is released whole, after the next
  large event, three smaller ones or 12 ms (one 60 Hz frame), whichever comes first. A steady fast turn of equal
  events never pairs up. W is forgotten after 1 s without an echo and on every lock change.
- **Only in Firefox.** The filter runs where the user agent says Firefox (any OS); Chromium keeps the pure 1:1 sum
  with no hold at all (`echoFilter` option to override, used by tests).
- **Right-button look** (lab mode 6): holding the right button on the world turns 1:1 by movementX/Y with no
  capture, the cursor visible and no context menu, whenever the mouse is not captured and no panel holds a lease.
  It works in every browser, including a page that can never capture.
- **Drift said once, calmly.** Six echoes in one capture set `drifting` (sticky for the page). The first lock lost
  after that is reported as `onLetGo('drift')`: the play session does not open the ledger, the street shows "Click
  to walk" with the line "Your browser lets the cursor drift. Hold the right mouse button to look, or run Firefox on
  Wayland." The ledger shows the same line under "Back to the street". Later losses open the ledger as usual, and
  Escape from the calm street still opens it.

Tests (all green): `look.test.ts › the re-centre echo` runs Tobias's recorded 40-event sequence through the filter
and through the captured mouse, and the turn is exactly the hand's (x 4, y -3), with all 21 fakes dropped; every
Windows/Chrome flick (300-800 count ramps at 60 Hz and 1000 Hz, a steady fast turn of equal events, there and back)
and every older flick trace keeps every count with the filter on; with no filter a flick arrives whole in its own
frame; an old offset never eats a new real move after re-locking; drift and the calm first loss; a few stray echoes
are not drift. `look.test.ts › right-button look`: 1:1 while held, no context menu, ends on release (also outside
the window), never under a lease or a disabled walk, works where capture is unavailable. `mouse-look.test.ts`: an
echoing 500 Hz mouse at 60, 144 and 343 Hz frames turns exactly by the hand and not a hair after.
`session.test.ts`: the drift loss keeps the street the first time, Escape still opens the ledger, the next loss
opens it. Stills: `work/evidence/play/mouse/hud-drift@1440x900.png`, `ledger-drift@1440x900.png` (SwiftShader,
the dev bench; the line is HTML type, not light, so a real-GPU still adds nothing).

Doubts: an echo offset under 200 counts (the hidden cursor near the centre when the lock began) is not learnt, as in
the lab; if Tobias still feels a spin after clicking near the middle of the screen, that is the case to look at
next. One real check in his Firefox remains (below, "Check on Tobias's machine").

## Check on Tobias's machine (Linux, Firefox 158, X11)

1. Hard-reload chatdom.io and walk. Click into the world once, near an edge and once near the middle.
2. Move slowly left, right, up and down for 10 s, then flick. The view turns with the hand, up and down never turns
   sideways, and it stops when the hand stops.
3. If the lock breaks at the window edge: the street stays, the line about the right button shows, and holding the
   right button looks around with the cursor visible.
4. In the lab or the console, `document.pointerLockElement` while captured should be the canvas.

## Before 20:40 (Windows assumptions)


Tobias's report: on chatdom.io (Windows, RTX 5080, Firefox on a 360 Hz monitor, also Chrome), moving the mouse a
little spins the camera wildly. He said it felt basic, "as if the pointer reaches the edge of the window".

## Causes

Three faults added up. All three are fixed, and each has a test that failed before the fix.

1. **The warp filter dropped real movement, worst in Firefox on Windows.**
   - Where: `apps/web/src/walk/input/look.ts`, the old `createSpikeFilter` (lines 66-130 before the fix), called
     from `move()` at old line 260.
   - What it did: it held any event of 160 px or more and judged it against the events either side. It dropped
     events it took for warps, including "a sign flip in the middle of a steady motion".
   - Why that breaks Firefox: Firefox on Windows locks the pointer by re-centring the hidden cursor. Its locked
     stream can carry a large delta and then an equal and opposite correction
     ([bugzilla 2055058](https://bugzilla.mozilla.org/show_bug.cgi?id=2055058)). The pair sums to zero. When the
     hand moves at a normal speed (8 counts per poll or more), the filter took the correction for a sign-flip warp
     and dropped it, but kept the first half. Every re-centre then turned the world by hundreds of pixels the hand
     never moved.
   - Why it felt like the edge of the window: these phantom turns come from the cursor's re-centring. Nothing
     turns from a free cursor (checked below).
   - Proof: `mouse-look.test.ts › sums Firefox-on-Windows recentre pairs whole`. Before the fix, 0.5 s of steady
     motion with 10 re-centre pairs turned 3.0 rad (172°) more than the hand did. After the fix the error is 0.
2. **The turn per count was 2 to 4 times too high for raw input.**
   - Where: `LOOK.radiansPerPx = .0024` (look.ts:26).
   - That value is the PointerLockControls 0.002 rad per *accelerated desktop pixel*. But we ask for
     `unadjustedMovement`, and with it movementX/Y are raw device counts. Firefox has supported this on Windows
     since 152 ([bug 2037802](https://bugzilla.mozilla.org/show_bug.cgi?id=2037802)), so it applies to Tobias's
     Firefox too.
   - In numbers, a full turn took 8 cm of hand at 800 DPI and 4 cm at 1600 DPI. Shipped shooters at default
     settings sit around 15 to 30 cm.
   - Proof: `a small nudge on a 1600 DPI mouse`. Before the fix, 1 cm of hand turned 87°.
3. **Auto-follow fought the hand.**
   - Where: `walk/index.ts` (old line 335, now 340), `rig.update(dt, heading…)`, and in `camera/shoulder.ts:268-272`.
   - What it did: 1.5 s after the last mouse movement, the rig swung the camera toward the walk heading. But the
     walk heading is set relative to the camera. So when strafing or walking a diagonal, the camera turned the walk,
     the walk turned the camera, and it kept going.
   - Proof: `never spins on its own while a mouse player strafes`. Before the fix, holding D for 6 s with no mouse
     input turned the camera 4.6 rad.

Ruled out:
- **Units:** `rig.orbit(dx·turn·h/orbitYaw)` cancels against `dx/h·orbitYaw` exactly.
- **Frame rate:** no yaw smoothing, and all easing is exponential in dt. The turn is identical at 60, 144, 240 and
  360 Hz.
- **Double counting:** `takeLook` clears on every take. pointer.ts ignores presses while locked.
- **Free-cursor turning:** `move()` needs `mode === 'locked'` and `pointerLockElement === surface`. Drag orbit
  exists only in `unavailable` mode, and only with a button held.
- **Other camera writers while walking:** scene.ts directors are all gated on `!walking`. Grand-land OrbitControls
  sits on its own engine and canvas and never runs with the walk.

## Real Firefox, headless

Firefox 157 under Playwright, on Linux, running the bundled `look.ts`:
- `requestPointerLock({unadjustedMovement:true})` rejects with NotSupportedError, then fires `pointerlockerror`
  after our plain retry has started. The `promised` guard ignores that error correctly.
- The retry locks: modes go `idle → requesting → locked` and `pointerLockElement` is the canvas.
- Seven 10 px moves arrived as dx 70. The first event after the lock carried a one-off dy 43 (about 2.5° at the
  new gain).
- Windows behaviour (re-centring, raw counts) cannot be seen from here.

## Research, in brief

- **The approach we now use:** three.js
  [PointerLockControls](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/controls/PointerLockControls.js)
  and the `misc_controls_pointerlock` example do no filtering and no smoothing. On each locked `mousemove` they
  turn by `movementX × 0.002 × pointerSpeed`. Raw 1:1 is the norm for PC games. Smoothing adds latency, so none is
  added.
- **What `movementX` means:** the units are not specified and differ between browsers
  ([w3c/pointerlock#42](https://github.com/w3c/pointerlock/issues/42)). Chrome up to 83 scaled them by DPR. Chromium
  stopped adjusting for the device scale factor in 2022
  ([commit](https://chromium.googlesource.com/chromium/src/+/66ad18c093ebc6dc50512d501580096d6e9ad17b)). Under
  `unadjustedMovement` the values follow the device's DPI.
- **Firefox on Windows:**
  - It re-centres the cursor while locked.
  - `pointerrawupdate` leaked the correction events until 154
    ([2055058](https://bugzilla.mozilla.org/show_bug.cgi?id=2055058)). We listen to `mousemove`, not
    `pointerrawupdate`.
  - Older reports describe drift at non-integer scaling
    ([1752138](https://bugzilla.mozilla.org/show_bug.cgi?id=1752138),
    [1630462](https://bugzilla.mozilla.org/show_bug.cgi?id=1630462)) and erratic values with 1000 Hz mice
    ([1840836](https://bugzilla.mozilla.org/show_bug.cgi?id=1840836)).
  - Lesson: sum every event and never second-guess single events.
- **Coalesced events:** `mousemove`'s movementX already holds the sum of the coalesced moves. Reading
  `getCoalescedEvents()` or `pointerrawupdate` would only lower latency, and it risks the leak above.

## What changed (uncommitted, branch lane/play)

- `apps/web/src/walk/input/look.ts`:
  - The spike filter is gone. `move()` adds the finite movementX/Y 1:1.
  - `takeLook()` takes no argument.
  - `rejected` is removed.
  - `LOOK.radiansPerPx` is now .001 rad per count (0.057°, about 20 cm per turn at 800 DPI and 10 cm at 1600).
  - The header is updated for Firefox.
  - Capture, cooldown, leases, Safari, Escape, fullscreen and keyboard lock are untouched.
- `apps/web/src/walk/index.ts`: auto-follow runs only for touch (`coarse || touch.used`). The `createSpikeFilter`
  and `SpikeFilter` exports and `debug.warps` are removed.
- `apps/web/src/walk/mouse-look.test.ts` (new): an end-to-end test that runs a 1000 Hz synthetic mouse through
  look.ts and the rig into the camera, at 60, 144, 240 and 360 Hz frames.
- `apps/web/src/walk/input/look.test.ts`: the filter tests are replaced. The same traces, plus a sign flip and a
  Firefox re-centre pair, must now sum 1:1.
- `apps/web/src/walk/index.test.ts`: expectations now use `LOOK.radiansPerPx`, and the 600 px event counts whole.
- `apps/web/src/walk/README.md`: the captured-mouse section is updated.

## Test evidence

- `pnpm exec vitest run apps/web/src/walk`: all tests pass.
- `pnpm exec tsc --noEmit`: clean.
- `eslint apps/web/src/walk`: clean.
- Before the fix (old look.ts and index.ts restored for the run), `mouse-look.test.ts` failed four tests:
  - the 1600 DPI nudge (87° against a limit of 40°)
  - strafing at 60 Hz and at 240 Hz (the camera drifted)
  - the Firefox re-centre pair (172° extra)
- The 1:1-at-any-frame-rate tests passed before and after.

## Check on the real PC

1. Hard-reload chatdom.io and walk.
2. **Firefox at 360 Hz:**
   - Click in once. The cursor must vanish.
   - Move the mouse slowly left and right for 10 s, and also make fast flicks. The view turns with the hand, never
     jumps, and never stops as if at an edge.
   - Put the mouse back on the same spot on the pad. The view returns to the same heading.
3. **Firefox at 60 Hz** (set the monitor to 60 Hz, or test on a second screen): the same feel and the same turn
   per cm as at 360 Hz.
4. **Chrome at 360 Hz and at 60 Hz:** the same checks.
5. **Strafe:** hold A or D, or W+D, for 5 s without touching the mouse. The camera must not turn by itself.
6. **Speed:** a full turn should take roughly 10 to 20 cm of hand, depending on DPI. If it is still too fast or too
   slow, adjust the ledger's mouse sensitivity slider (0.25× to 4×). Report the mouse's DPI so the default can be
   tuned.
7. If anything still jumps, open the console and run `document.pointerLockElement` while captured. It should be
   the canvas. Report the Firefox version, because `unadjustedMovement` on Windows needs 152 or later.
