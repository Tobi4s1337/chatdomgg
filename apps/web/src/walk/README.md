# Walking the kingdom

`apps/web/src/walk` puts the player camera on a real connected citizen. It samples the keyboard and the
free cursor, quantizes camera-relative walking into the shared `WalkInput`, ticks the realm client once per
frame and places a shoulder camera on the citizen the room actually moved. It owns no scene, no realm
connection and no collision data. The kingdom scene stays with the integrator, the realm connection belongs to
`apps/web/src/realm/client.ts`, and the founded collision world comes from realm wiring.

Spec: `work/specs/35-walk-controller.md`. Lane: `work/lanes/walk-controller/`.

## Status

- **Reference court bound.** `/-/realm` runs this controller on `connectReferenceRealm`'s real room client,
  renders its actual poses, and fades the local body in first person. It is a dev-only court, never reachable as if it were a kingdom.
  `window.__chatdomWalk` exposes the controller there; the existing `__chatdomRealm.setInput` reference smoke
  hook shares the same single client tick. This reference is separate from the kingdom binding below.

- **Bound to the kingdom.** The actual town renderer supplies `createKingdomWalk` with the checked founded
  manifest, room client and complete collision revision. The current practice entry is
  `http://127.0.0.1:5190/?walk=1&source=simulated&hour=19.5`; it is a dev-only practice room (decision 25: no SIMULATED labels, and never reachable as if real).
- **Camera collision.** The boom and near plane sweep the same immutable collision revision used by the room
  and predictor. The camera root stays below the body's crown under a tight ceiling.
- **Prediction and collision revisions (WC06).** The realm client takes a revision source, holds prediction
  while a revision is missing and resets on adoption; see "Realm client" below.
- **Backed against a wall (WC07).** A boom a solid pulled in fades the local citizen from further out
  (`selfFade`), so the camera looks past it at the street; the same short boom chosen with the wheel keeps it.

## Modules

| Export | File | What it does |
|---|---|---|
| `createWalkController(options)` | `index.ts` | Lifecycle: input, realm tick, camera, takeover |
| `createWalkKeys(keyboard, page?, bindings?)` | `input/keyboard.ts` | The person's bindings (WASD by default; arrows always), Shift, one jump per Space press, release on blur, hidden page, chat focus, context menu and Cmd |
| `isEditableTarget(t)`, `isKeyboardControl(t)` | `input/keyboard.ts` | Fields keep every key; a keyboard-focused control keeps Space and arrows |
| `createWalkPointer(surface, keyboard)` | `input/pointer.ts` | Pen drag orbit after 8 px (the mouse only where the page cannot lock), wheel with line/page modes, swallows only the click that ended a drag |
| `createWalkLook(surface, doc, keyboard, options?)` | `input/look.ts` | The always-captured mouse: raw pointer lock on a real click, cooldown, leases, fullscreen with keyboard lock, `onLetGo` (see "The captured mouse") |
| `createSpikeFilter()`, `LOOK` | `input/look.ts` | The flick-keeping warp filter and the look constants |
| `createWalkTouch(surface, keyboard)` | `input/touch.ts` | Phone: floating left-thumb stick (push past the rim to sprint), one-finger orbit, two-finger pinch zoom |
| `stickRegion(x, y, w, h)`, `stickIntent(dx, dy)`, `TOUCH` | `input/touch.ts` | Which part of the surface is the stick, thumb offset to intent, and the touch constants |
| `createWalkHud(container, onJump)`, `restingStick(w, h)` | `input/hud.ts` | The phone stick and the jump button, drawn in the given container (the captured mouse needs no plaque) |
| `thumbSlots(w, h)`, `THUMB` | `input/hud.ts` | The phone thumb map: resting stick, Jump, and the slot reserved for the interaction owner's touch action |
| `isClickPress(dx, dy, ms)`, `CLICK_SLOP_PX`, `CLICK_MS` | `input/pointer.ts` | The click-versus-drag rule for the interaction owner (under 8 px and under 300 ms) |
| `walkDirection(forward, right, heading)` | `input/direction.ts` | Camera-relative intent to world-relative signed bytes; diagonals never faster |
| `facingByte(moveX, moveZ)`, `headingFromByte(yaw)` | `input/direction.ts` | Yaw byte for the actual walk direction, and back to renderer radians |
| `createShoulderRig(heading)`, `shoulderPose(...)` | `camera/shoulder.ts` | Shoulder framing with `filmOffset`, wheel zoom in third person, `setPerson` (V) with an eased boom swing, `setFovScale`, auto-follow, time-based easing |
| `fovScaleFor(degrees)` | `camera/shoulder.ts` | The field-of-view setting (horizontal degrees at 16:10, 74 by default) as a scale on the framing's lens |
| `SHOULDER` | `camera/shoulder.ts` | The chosen framing and feel constants |
| `selfFade(eyeToHead, pulledIn)` | `camera/shoulder.ts` | Local citizen opacity: first-person fade, starting further out when a solid pulled the boom in |
| `clearBoom(world, anchor, at, wish)` | `camera/occlusion.ts` | Sweeps eye + near plane along the boom from the head; how far the camera may stand |
| `nearFootprint(direction, fov, aspect, shift, near)` | `camera/occlusion.ts` | Box around the eye and the actual near-plane rectangle, lens shift included |
| `sweepHit(from, to, footprint, solid)`, `overlapsSolid(...)` | `camera/occlusion.ts` | Swept and static box tests against one solid (touching is not overlap) |
| `OCCLUSION`, `RECOVER_RATE` | `camera/occlusion.ts` | Margin .05 m, .25 m sweep pieces, .35 s outward recovery |

Headings are radians about +Y, and zero faces +Z (the citizen renderer's convention). Yaw bytes are
`round(heading / 2π × 256) mod 256`.

### `createWalkController(options): WalkController`

```ts
interface WalkControllerOptions {
  camera: THREE.PerspectiveCamera;    // the scene camera; while walking only the controller writes it
  surface: HTMLElement;               // normally the canvas: drag orbit and wheel start here
  realm: WalkRealm;                   // a connected RealmClient satisfies it unchanged
  keyboard?: EventTarget;             // default window
  page?: { hidden: boolean } & EventTarget;  // default document
  lockDocument?: LockDocument;        // pointer-lock state and locked mousemove; default document
  hud?: HTMLElement;                  // where the look plaque, stick and jump button are drawn (the kingdom root)
  coarse?: boolean;                   // show phone controls before the first touch; default matchMedia('(pointer: coarse)')
  clock?: () => number;               // ms for the lock settle window; default performance.now
  heading?: number;                   // entry heading; default: the way the citizen already faces
  collision?: CollisionWorld | (() => CollisionWorld | null | undefined);  // solids the camera stays out of, read every frame
}
interface WalkController {
  frame(now: number): readonly RealmWalkerPose[];  // once per animation frame, before anything reads the camera
  resize(width: number, height: number): void;     // CSS pixels of the surface
  release(): void;   // hand camera + input to build/Forge/director/menu; realm keeps ticking idle; filmOffset → 0
  resume(): void;    // take the camera back, same view, drawn straight onto the citizen
  reset(heading?: number): void;  // entry framing again
  dispose(): void;   // removes every listener, filmOffset → 0; does not close the realm
  readonly owner: 'walking' | 'released' | 'disposed';
  readonly selfOpacity: number;   // pass as the local citizen's `opacity`; 0 in first person and when backed against a wall; 1 while released
  readonly debug: WalkDebug;      // live object, see below
}
```

`frame(now)` calls `realm.tick(now, input)` exactly once, so nothing else may call `tick`. While released it
still ticks with an idle input, keeping prediction and the other walkers moving behind a menu. It never
disposes the realm client; whoever connected it disconnects it (and calls `release()` first so nothing stays
held).

The controller reads `realm.predicted` after ticking, when supplied by the real client. Grounded step offsets
come from SDK rendered `y` and exact `grounded`, never the delayed room schema or raw fixed-step height; the returned local body eases only down, and
the camera receives its own eased height while collision stays anchored to the feet. Jumps, revision changes
and camera takeovers reset the offsets. A nearby lintel cancels body easing before the head can enter it.
Wrappers must forward the `predicted` getter and `clearInput()` alongside `tick` and `room`, as the reference
court does. A directly supplied `RealmClient` already provides both.

`WalkDebug` is what the capture reads: `ready` (the camera stands on the connected citizen), `owner`, `selfId`,
`self` (rendered pose), `authority` (room state for the local walker), `peers` (others as drawn, at most 4 Hz),
`input` (the last `WalkInput` sent), `look` (`free`, `requesting`, `locked` or `fallback`), `stick` (the phone
stick under the thumb, or null), `camera` (`yaw`, `pitch`, `distance` drawn,
`zoomDistance` eased wheel wish, `desiredDistance` wheel target, `clearance` how far a solid let the boom reach
or null, `collisionRevision` of the world the camera was kept out of or null, `fov`, `near`, `filmOffset`,
`shift`), `screen` (citizen body centre in CSS px), `viewport` and `selfOpacity`.

When the room has `onLeave`/`onDrop` signals (a Colyseus room does), the controller listens to them itself: a
dropped or closed connection lets go of held keys, a pending jump, the stick, any drag and the pointer lock.

## Input ownership

| Input | Owner while walking | Never |
|---|---|---|
| W A S D, arrows, Shift, Space | walking (physical codes, so AZERTY/Dvorak keep the shape) | in a text field, select or contenteditable; with Ctrl/Cmd/Alt; during IME composition; Space/arrows on a keyboard-focused control (its focus ring is showing) |
| The mouse | a trusted left click on the world captures it (pointer lock, raw input where offered); while captured, a left click is "use" | keyboard acquisition, automatic retries, re-lock on resume |
| Escape | captured: the browser frees the mouse and the play layer opens the ledger; free: opens or closes the ledger | never `preventDefault`ed when another owner (a place view, a seat, a Forge dialog) already took it |
| V, P, F (rebindable) | the play layer: first/third person, the ledger, fullscreen | in a text field or with Ctrl/Cmd/Alt |
| E | the interaction owner | walking never reads it, on keyboard or touch |
| Pen on the world (and the mouse only where pointer lock does not exist) | drag orbit once it travels 8 px; a shorter, quicker press stays a click (`isClickPress`) | a desktop mouse with pointer lock: it never drag-orbits |
| Wheel on the world | boom distance, line/page modes, ±240 px per event | over UI: the listener is on the world surface only |
| Touch on the world | lower-left (`stickRegion`: x < 46 %, y > 34 %) is the stick; elsewhere one finger orbits, two pinch | taps (< 8 px) stay clicks; UI above the surface keeps its own touches |
| Jump button | a tap jumps on touch-down; keyboard activation also jumps | never takes focus from the world |

Everything held or pending is cleared on window blur, a hidden page, a native context menu, `release()`, a
dropped connection and `dispose()`. A mouse released outside the window ends its drag on the next move.

### The captured mouse

Walking is a game: the mouse is always captured (decision 2). `input/look.ts` owns the lock and nothing else asks
for it.

- **Capture.** A trusted left press on the world asks for pointer lock with `unadjustedMovement` (raw input, no OS
  acceleration). A `NotSupportedError` (or a synchronous throw) is retried once, immediately, without the option.
  Three refusals in a row mark the page `unavailable`; only then does the mouse fall back to drag orbit.
- **Chrome** answers with a promise and refuses a re-lock for about a second after a user exit: that window is the
  `cooldown` state, and the next click after it captures again. **Safari** returns no promise and answers only
  with `pointerlockchange` or `pointerlockerror`; both are handled the same way. **Firefox** ignores
  `unadjustedMovement` and keeps OS acceleration; that is accepted, not retried.
- **Flicks survive.** `createSpikeFilter` keeps every event of a real fast turn (traces of 400 to 900 px per event
  at 60 to 1000 Hz pass whole) and drops only an isolated warp: an event of 160 px or more that is over six times
  both neighbours, or that flips sign in the middle of steady motion. A big event the next one carries on in the same
  direction at a twelfth of its size or more is a flick, not a warp: a snap from a still hand often lands in one
  coalesced 60 Hz frame and decays over the next (`[0, 1000, 120, 0]`), and a warp has no such tail. A big event is
  held for its next neighbour or 24 ms at most, so a flick is at worst one frame late and never lost. Nothing is
  clamped. Where `requestPointerLock` returns a promise, the promise alone answers that request: Chromium without raw
  input also fires `pointerlockerror` for the refused raw request, which must not end the ordinary retry.
- **Letting go.** The browser spends Escape on the lock and may never deliver the keydown. The lock's own
  `pointerlockchange` is the signal: `onLetGo('browser')` fires, keys and sticks clear, and the play layer opens the
  ledger. Blur and a hidden page release the same way.
- **Fullscreen** (`F`, or the ledger) also takes the Keyboard Lock where the browser has it (Chromium), so Ctrl+W,
  Ctrl+T and Ctrl+N stay inside the game, Ctrl and Cmd shortcuts are swallowed except in a text field, Escape is
  heard by the page (it releases the mouse into the ledger) and a held Escape leaves fullscreen, as the browser
  shows. Without fullscreen there is no keyboard lock.
- **Leases.** Any panel that needs a free cursor takes `look.lease(reason)` and releases it when done; while one is
  held a click does not capture. The play layer's ledger, arrival steps and HUD slots use this through
  `PlayContext.requestCursor`.
- **Settings.** Sensitivity multiplies 0.0024 rad per pixel; invert Y flips the pitch of locked look, drag and swipe.
  Both read live from the play settings.

**Phone.** The stick appears under the thumb wherever it lands in the stick region (kept a whole ring inside
the edges), with a 16 % dead zone; pushing past 1.3 × the 52 px rim sprints and lights the ring. A finger
elsewhere orbits from the first pixel it travelled; a second orbit finger pinches (3 wheel px per px of
spread). The resting stick and the jump button sit at 66 % of the height (54 % on a short landscape screen).
Their labels fade once used. The surface's `touch-action` is set to `none` while the controller lives.

**Sharing the thumbs with interactions (spec 37 R3).** `thumbSlots(width, height)` is the one thumb map, in
surface CSS px: `stick` (resting stick, left thumb), `jump` (right thumb, on the same line) and `action`, a
60 px disc directly above Jump that is reserved for the interaction owner's touch equivalent of E. Both
buttons lie wholly outside `stickRegion`, so a walking thumb never lands on one, and they never touch each other
(`hud.test.ts` checks phones and tablets in both orientations). Draw the action as a DOM button above the
surface centred on `action.x/y` (at least 44 px): its taps never reach the surface, so they never orbit, and a
tap on the world itself stays a click for target selection. Re-read the slot on resize. Nothing else on a phone
may cover the left 46 % below 34 % of the height while walking: the kingdom's own bottom bar and any toast
belong above that band or are hidden while walking (integrator).

**Escape order.** While the mouse is captured, the browser itself spends Escape on freeing it, and it may
not deliver that keydown to the page at all. If one does arrive while `document.pointerLockElement` is still
the world surface (it clears only on the following `pointerlockchange`, whatever order the listeners run in),
it means "give me my cursor": the interaction owner should not also stand the citizen up with it, and the ledger
opens from the lock change. With a free cursor Escape goes to whoever owns it first: the play session hears it last,
in the bubble phase on the window, so a gesture panel, a place view, a seat or the ledger's own book closes on it and
takes it; only an Escape nobody took opens or closes the ledger. While a key plate listens, every key is the plate's.

## Integration recipe (integrator)

The integrator applies these call sites in `apps/web/src/kingdom/scene.ts` and `index.tsx`; this lane does not
edit them. Entry URL proposed for the binding: **`/?walk=1`** on the kingdom page, which is what
`capture.mjs` opens by default (`--path` changes it if the integrator chooses another).

1. **Connect.** With realm wiring's kingdom entry and its collision revisions (see "Realm client" below):
   `const realm = await connectRealm(endpoint, kingdomEntry, kingdomCollision, sessionStorage);`
2. **Create** after the scene has loaded (camera, canvas and citizen renderer exist):
   ```ts
   import { createWalkController } from '../walk';
   const walk = createWalkController({ camera, surface: canvas, realm, hud: kingdomRoot, collision: () => kingdomCollisionWorld });
   walk.resize(canvas.clientWidth, canvas.clientHeight);
   ```
   `kingdomRoot` is the `[data-chatdom-kingdom]` element; the plaque and phone controls are drawn inside it
   (`z-index: 2`, below the gate). `collision` is the same complete world the realm client steps against; pass
   a function when realm wiring publishes new revisions so the camera reads the newest one each frame. The
   camera's `near` must stay at most 0.15 m (the kingdom scene's is 0.15) so first person never reaches past the
   body's own 0.28 m radius into a wall. Draw walkers with a `createCitizenRenderer` (or the crowd's) and give the local one
   `opacity: walk.selfOpacity`.
3. **Each frame**, in `render(now)`, before the existing camera block:
   ```ts
   const walking = walk?.owner === 'walking' && !capturePose;
   const walkers = walk ? walk.frame(now) : [];
   if (walking) {
     const self = walk.debug.self;
     if (self) target.set(self.x, self.y + 1.05, self.z);   // light fields and build/Forge follow the citizen
   } else {
     /* the existing autoCamera / citizen / window / hero block, unchanged */
   }
   ```
   While walking, skip the existing `wantedFov` assignment and the `camera.lookAt(target)` call; the controller
   has already set position, orientation, fov, aspect and `filmOffset`, and called `updateMatrixWorld()`.
   Keep `updateInstances`, atmosphere, water, field and label updates; they read the camera as placed.
4. **Resize.** In the existing `resize()`: `walk?.resize(canvas.clientWidth, canvas.clientHeight)`.
5. **Takeover and return.** One owner draws the camera at a time; the realm keeps ticking underneath.
   - **Build.** `onBuild(session)` with a session → `walk.release()`. Resume only when build has let go of the
     camera entirely: `onBuild(null)` *and* `onHousewarming(null)` (the housewarming shot outlives the session),
     i.e. the frame `build.update(...)` returns `false`. Build's right-button drag and context-menu handling are
     safe: walking listens to nothing while released.
   - **Forge.** `onForge(status)` with `status.open` → `release()`; `status.open === false` → `resume()`. A
     refused close (during a refusal or an uncommitted piece) keeps `open` true, so walking stays released.
   - **Director / evidence.** `setCamera`, `play`, `seek`, `capture` or `pose(eye, …)` → `release()`; `pose(null)`
     or choosing the walking view again → `resume()`.
   - **A menu** that needs the keyboard or pointer: `release()` while open, `resume()` when it closes.
   - **Realm disconnect:** the controller already lets go of every held input on `room.onLeave`/`onDrop`; the
     integrator calls `release()` while the gate is shown and `resume()` once walking again.

   `release()` frees a locked cursor, drops every held key, drag, stick and pending jump, straightens
   `filmOffset` to 0 for the next owner's composition and hands back a whole citizen (`selfOpacity` 1, even from
   first person). Build and the Forge compose with `setViewOffset`; the first walking frame clears any view
   offset still set (the near-plane collision footprint assumes the plain frustum), and the view, zoom and
   first person the walker had are drawn straight onto the citizen with no easing in from the other camera. A
   key still held when the menu closes walks again on its next auto-repeat; a held Space never jumps again.
   Nothing needs a held mouse button, and `resume()` never re-locks the cursor by itself.
6. **Dispose** with the scene: `walk.dispose()` then `realm.dispose()`.
7. **Test hook**, beside `__chatdomKingdom` in `index.tsx`: `window.__chatdomWalk = walk.debug`.

## Realm client: prediction and collision revisions

`apps/web/src/realm/client.ts` (the movement/Predict hunk; auth, join, reconnect and storage stay main's) runs the
shared `stepPlayer` through Colyseus `Predict`. It adds no queue, sequence or acknowledgement of its own.

```ts
interface RealmCollision { world(revision: number): CollisionWorld | null }   // realm wiring supplies the kingdom's
connectRealm(endpoint, entry, collision: CollisionWorld | RealmCollision, storage?): Promise<RealmClient>
interface RealmClient {
  tick(now, input): readonly RealmWalkerPose[];  // once per frame: reconcile, stage due inputs, then render poses
  readonly predicted: Readonly<PlayerState>;     // local walker, every PLAYER_FIELDS field, exact and unsmoothed
  readonly predicting: boolean;                  // false while the room's revision is not available here
  clearInput(): void;                           // drop a jump awaiting its first fixed input on takeover
  /* selfId, room, dispose() unchanged */
}
```

- **Collision source.** `world(revision)` returns exactly that revision's immutable world or `null` while it is
  still on its way (start fetching it then; the client asks again every frame and as soon as the room
  broadcasts `revision`). A world claiming another revision is refused. A plain `CollisionWorld` is a source of
  one revision; connecting it to a room on another revision still fails at once, as before.
- **Frame order.** `tick(now, input)`: (1) if the room has adopted a new revision for this walker, reset the
  reconciler from the room's placement, forget inputs sent before it and clear a latched jump; (2)
  `predict.tick(now)` reconciles and returns `n` due fixed steps; (3) send exactly `n` inputs, the jump only on
  the first, each stamped with the room's current `collisionRevision` and passed through `sanitizeWalkInput`;
  (4) read poses from `predict.value`. Nothing may read poses between (2) and (3). The controller's `frame(now)`
  is the only caller.
- **Revision transition.** The room places every walker on the new revision and refuses inputs of the old one.
  Prediction steps an input only when its revision equals the walker's and that world is here; otherwise it holds
  and the walker is drawn where the room puts it (latency, never air). Old inputs are never replayed against
  replaced solids.
- **Placements.** An authoritative placement serial or collision revision change resets SDK replay/render
  anchors before ticking and sending, so even a short relocation cuts across a wall without drawing through it.
  Ordinary corrections retain all `PLAYER_FIELDS` and ease over `smoothMs: 80`; SDK fixed-step interpolation
  supplies the render pose. There is no all-fields `snap` threshold: yaw bytes, velocity and distance have
  different units and must never pop a small positional correction. Body and camera share the same rendered
  feet pose; only grounded stair presentation adds its bounded offsets.
- **Yaw** of the local walker is drawn from the exact predicted byte: smoothing a byte that wraps at 256 would
  spin the citizen the long way round.
- **Takeover.** While another owner holds the camera the controller keeps calling `tick` with an idle input, so
  prediction, acknowledgements and the other walkers stay current; `clearInput()` discards a jump waiting for a
  due fixed input on blur, menu, reset or disposal. A dropped connection also clears it. On
  return nothing is replayed: the next due input simply carries what is held then.

`realm-predict.test.ts` checks all of this against the real room, uWS transport and SDK clients.
`realm-check.mjs` repeats it in two real browsers on the dev court (a diagnostic, not kingdom acceptance):

```sh
node apps/web/src/walk/realm-check.mjs [--realm-port 5188] [--web-port 5189] [--out shots/walk/wc06]
```

It starts the actual `KingdomRoom` with the dev reference services (memory only) on the realm port, so it
can publish revision 2 with a wall like an authority, and a vite dev server for `/-/realm` on the web port; Chrome
maps the page's `:5191` to the realm port. It stops both when done and writes `route.json` beside the shots.

## Feel

The shoulder view stands the citizen on the left third line with the body centre in the lower third, about a
quarter of the screen tall, with the street open ahead (`SHOULDER.landscape`/`portrait`, blended by aspect so a
rotating phone never jumps). The horizontal shift is a lens shift (`filmOffset`), so the vanishing point of
"forward" lies in the citizen's own column and W walks them straight into the picture. The pivot height is
solved so the body stays on its thirds at any pitch. Roll is always zero.

The wheel moves one zoom parameter; the boom is `11 m × z²`, so it reaches exactly 0 with fine control over the
last metre. Closer than about 5.5 m the pivot is held high enough that the head never rises above
`SHOULDER.headY` (−0.15, just under the middle), so a short boom is an over-the-shoulder view with the
head and shoulder in the lower left, never a giant head in the middle of the picture; at zero the pivot is the
eye (1.6 m). The lens shift stays full down to 1.4 m and reaches zero at 0.3 m. The local citizen fades as the eye
comes within 1.25 m of the head and is gone within 0.5 m. Wheel intent (`desiredDistance`) is kept apart from the drawn
distance, which eases at 14/s. Drag right turns the view right; drag up looks up. Pitch runs from −0.5 to 1.1
rad. After 1.5 s without a manual orbit the camera swings gently behind the walk direction (never while a drag
is held, never while standing, never across a reversal of more than 2 rad). Camera height eases at 12/s and
never trails the body by more than 0.45 m, so a step or jump does not jerk the view.

## Camera collision

What stays out of solids is the eye together with the near-plane rectangle in front of it, at the actual fov,
aspect, `camera.zoom` and lens shift, enclosed in a box with 5 cm of air (`nearFootprint`). Each frame that box
is swept along the drawn boom curve, from the citizen's actual head (which the body keeps clear) out to the
eased wheel distance, in pieces of at most 25 cm against one `query` of the supplied world (`clearBoom`). The
first touch is how far the camera may stand. A hit is checked once more on the exact curve; if that fails, the
start of the piece, already swept clear, is used. Thin posts, roofs, corners, doorways and the ground under a
camera looking up are all caught; a centre ray alone would miss a post beside the boom that the near plane
would cut.

The camera comes in at once, before the first obstructed frame is drawn, including on the frame a new solid or
revision appears. It goes back out only through clear air, easing over about 0.35 s (`RECOVER_RATE`: 95 %).
Three distances are kept apart: the wheel's target (`desiredDistance`), the eased wish (`zoomDistance`) and the
boom drawn (`distance`); a wall never changes the wish, and wheeling out behind a wall moves nothing until it
clears. There is no minimum distance: pulled all the way to the head, the view is first person and the local
citizen fades as it would on the wheel. If the eased camera height would lift the boom's root out of the body
into a low ceiling, the camera sits on the actual head that frame. A function `collision` returning null keeps
the last world rather than opening a hole. Nothing here fades obstructions; it always pulls in.

## Capture

```sh
node apps/web/src/walk/capture.mjs --base-url http://127.0.0.1:5190 [--path '/?walk=1&source=simulated&hour=19.5'] [--out shots/walk]
```

Two real browsers (1440×900 and 390×844) open the kingdom entry. The script fails explicitly if the page is
not the kingdom (`[data-chatdom-kingdom]` and `__chatdomKingdom`), if `__chatdomWalk` is absent, if no citizen is
placed within 60 s, if the camera has no collision world, or if either browser misses the other. It walks the desktop with Shift+W, presses Space once,
checks the room's authoritative position moved and the phone shows it there, checks the drawn citizen sits in
the lower-left third, saves `street-shoulder@1440x900.png` and `street-shoulder@390x844.png`, wheels into first
person and back, and fails on any page error, console error or failed request. It holds
`packages/testing/capture-lock.mjs` throughout.

Reference-only local setup (the durable schema is separate):

```sh
pnpm --filter @chatdom/realm build
REALM_SIMULATED=1 REALM_STORAGE=memory REALM_PORT=5191 pnpm --filter @chatdom/realm start
# With the web preview on 5190: http://127.0.0.1:5190/-/realm
```

Do not start a second process on an occupied port. The actual kingdom entry above consumes its founded collision
world through realm wiring; the separate reference court remains a labelled diagnostic.

### PL10 stills (`stills/`)

```sh
node apps/web/src/walk/stills/stills.mjs [--land town|hamlet] [--only third,first]      # SwiftShader, one still per lock hold
chatdom-pc-lease -- node apps/web/src/walk/stills/stills.mjs --target pc [--land town]  # real GPU, web 5192, realm 5191
```

The real kingdom page on a stills fixture (`stills/fixture.ts`: Willowmere or the Brackenfold hamlet, full production
collision, spots found in that collision: an open street, the slope where the drawn ground and the half-metre physics
differ most, a stair tread and a raised floor) with a memory realm the script owns. `stills/page.tsx` stages each
still from `?still=` and sets `__chatdomReady` only once it has settled, so `chatdom-pc shot`, which can only open a
URL, takes the same pictures: `third`, `first`, `dusk` (bubbles over lit homes, only walkers in the street) and
`<slope|stairs|floor>-<before|after>` (the "before" binds the walk with `drawnGround: false`, bodies at the physics
height), and `crowd`, the 5,000-chatter town: Willowmere's 240 homes (the largest town the founding makes) all lit and
speaking at about 15 lines a second, a Poisson stream from random lit homes, with 120 more walkers that the runner
joins from Node (not the page, which only draws them) and stands on open spots at least 2.5 m apart, so the nearest
64 draw in full and the rest as simple figures, seen from above and behind the walker. The hamlet is nine people: three walking and six chatting from home; its street stands in the open nearest a
cluster of six homes, because a hamlet's homes sit beyond bubble range of its market. The sole close-up camera is
chosen in the collision (low beside the feet, on the first side with a clear sight line). A chat still waits for a
bubble to ease fully in, and a page that fails while setting up ends the run at once, so nothing waits out a timeout
under the capture lock. Settings the page changes (first or third person) are put back when it closes. Dev only:
never a route, never built.

## WC07 founder finish (main, 2026-10-31)

The distance-driven avatar cycle is 1.8 m per complete left/right cycle rather than .75 m. Arm swing is .30 rad,
hip .42 rad and knee .38 rad, with matching foot rotation and sole-height compensation; gestures and wardrobe
attachments are unchanged. This removes the frantic five-cycle-per-second walk while retaining distance phase.
The tread test queries a finite 1 µm volume before testing the exact landing point, because the founded compiler
correctly rejects empty broad-phase bounds. Solver and compiled-geometry checks cover ascent, stopping and sustained
idle support on a half slab, with deterministic replay.

Focused tests include exact 360 Hz sampling of real SDK Predict over 30 Hz simulation, ordinary correction handling,
explicit placement cuts, click-only acquisition/rejection/re-lock, and slab support. Real display acceptance still
requires the founder route at 1440×900 and 390×844: walk/stop/reverse, sprint turn, jump, half slab, roof/doorway,
click lock → Escape → later click re-lock after a fast flick, wheel in/out, menu return. Judge camera calm, cadence
and foot contact on a real GPU; SwiftShader pixels do not establish high-refresh temporal feel.

## Walking together (WT10)

The lane's `work/lanes/walking-together/needs.md` records the remaining main-owned contracts and an exact
`integration.patch`. **WT10 is not accepted yet.** Component review is separate from town/stream proof.

- `createWornCitizenLook(id, authorizedRecipe, subLapsed)` in `citizens` compiles the builder's worn recipe,
  including exact cloth dyes. The authority must supply the authorized recipe and lapse state. It grants no pieces.
- `CitizenSample.gesture` includes wave, bow, cheer, dance, sit and point. Upper-body actions blend over locomotion;
  headings take the shortest arc. `posture: 'seated'` remains the authoritative seat path.
- A bound `WalkControllerOptions.gestures` port has `available()`, `publish(gesture)` and
  `sample(walkerId, monotonicNowMs)`. The controller mounts the selector only with that port. Pass
  `controller.gestureFor(pose.id, now)` into the citizen sample after ticking. The transport owns acceptance,
  expiry, rate limits and sound feedback; do not send a new uncontracted room message from the UI.
- The local selection ends on expiry, takeover, hidden page, blur or transport loss. Moving or jumping cancels
  sit/dance, while a walking wave keeps the locomotion. Reset clears a gesture without disposing the selector.
- `layoutWalkLabels(anchors, viewport, reservedRects)` lays out measured names and speech together. Anchors are
  actual head projections, labels are centred above them, speech gets priority, and colliding labels yield rather
  than floating away from the speaker. Use one pass for both walk and stream, with UI safe rectangles.
- `PeopleLabels`, `peopleFromLabels` and `measureReservedElements` in `./labels/index.tsx` supply that shared
  Solid layer. Producer inputs must carry real camera distance and authority home slots; names never join identities.
  `CitizenRenderer.heads` supplies animated head/hair/hat top anchors, including sit, bow and tiptoe, for the
  producer to project. The six-file main-owned `integration.patch` binds both surfaces and preserves slot-free
  guest names; guest speech still needs its own witnessed walker association from main.

The `capture-review.mjs` runner acquires the shared lock for exactly one still or one short clip, then closes its
browser/server and releases it. It picks an allowed free capture port and never touches an existing service:

```
node apps/web/src/walk/capture-review.mjs --view motion
node apps/web/src/walk/capture-review.mjs --view motion --width 390 --height 844
node apps/web/src/walk/capture-review.mjs --view motion --clip
node apps/web/src/walk/capture-review.mjs --view wardrobe
node apps/web/src/walk/capture-review.mjs --view selector --width 390 --height 844
node apps/web/src/walk/capture-review.mjs --view labels --offline
node apps/web/src/walk/capture-review.mjs --view bubbles --offline
node apps/web/src/walk/capture-review.mjs --view wardrobe --offline --width 390 --height 844
node apps/web/src/walk/capture-review.mjs --view motion --trajectory turns --detail --clip --offline
```

`--view bubbles` draws 16 frames of a camera move with active chat (`labels/motion.html`, a small dusk street drawn
by a real three.js camera), reads every fully shown label's tip back against the anchor projected that frame, fails
above 1 px, and writes the frames, a contact sheet and the per-frame measurements.

These dev-only benches review the component only. No browser-local chat, wardrobe or gesture is
presented as server truth.

`--offline` builds the same component entry and routes its static bytes inside Chrome, without a network
listener or an existing service. It still acquires the shared capture lock for one output. Wardrobe captures
exercise real arrow-key selection/focus and visible save status; label captures check measured visible bounds.
The `turns` trajectory reconstructs coherent forward/reverse/strafe samples at 60 Hz; `detail` frames one whole
citizen closely enough to inspect the feet. These deterministic clips do not establish real network frame pacing.

Flat-ground citizens now solve world-space stance contacts with articulated legs. `renderer.footfalls` reports
touchdowns for the most recent `update()` only; use it after drawing for sound rather than a second cadence
clock. Height discontinuities reset contact history: exact contact with the kingdom's differently sampled visible
terrain remains a main-owned seam. The optional consumer patch in the lane records includes the audio binding.

`node apps/web/src/walk/check-town.mjs` is a CPU-only diagnostic: it compiles the complete native founded
collision and moves three test bodies forward, backward and to rest, checking support and solid clearance.
It opens no listener, browser or capture slot. The full compile can take roughly 83 seconds on this host.

`capture-town.mjs` prepares one actual-town still or a three-second real-time clip with three real SDK
connections to a temporary memory-only room:

```
node apps/web/src/walk/capture-town.mjs
node apps/web/src/walk/capture-town.mjs --width 390 --height 844
node apps/web/src/walk/capture-town.mjs --clip
node apps/web/src/walk/capture-town.mjs --offline
```

This new runner is linted but has **not yet completed runtime verification**. The ordinary mode requires two safe
ports; offline mode compiles the town page and needs only one safe port for its actual memory-only realm server.
It keeps the test identities inside its memory-only room, hashes the adopted native scene, uses its full collision compiler, checks
keyboard movement and both peer connections, and takes the shared lock for one output. It cannot establish
real sign-in, owned-door spawning, saved wardrobe or network gestures. Those acceptance checks still require
main's authority and projection seams, plus actual town and stream captures at the prescribed sizes.

`node apps/web/src/walk/check-integration.mjs` applies the recorded six-file consumer patch entirely in memory
and typechecks it with the current workspace. It writes no main-owned source and does not replace runtime review.

## Running the tests

Every walk, play, kingdom-walk and gait test runs in Node; none needs a DOM. jsdom is not a dependency of this
workspace (it is in no lockfile), and from `apps/web` vitest reads `vite.config.ts`, where the Solid plugin
defaults the environment to jsdom. So name the environment, or use the root config:

```
nice -n 10 pnpm --filter @chatdom/web exec vitest run --environment node src/walk src/play
nice -n 10 pnpm exec vitest run apps/web/src/walk apps/web/src/play   # from the repo root
```
