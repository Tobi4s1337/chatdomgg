# Walking the kingdom

`apps/web/src/walk` puts the player camera on a real connected citizen. It samples the keyboard and the
free cursor, quantizes camera-relative walking into the shared `WalkInput`, ticks the realm client once per
frame and places a shoulder camera on the citizen the room actually moved. It owns no scene, no realm
connection and no collision data. The kingdom scene stays with the integrator, the realm connection belongs to
`apps/web/src/realm/client.ts`, and the founded collision world comes from realm wiring.

Spec: `work/specs/35-walk-controller.md`. Lane: `work/lanes/walk-controller/`.

## Status

- **Reference court bound.** `/-/realm` runs this controller on `connectReferenceRealm`'s real room client,
  renders its actual poses, and fades the local body in first person. The scene remains explicitly SIMULATED.
  `window.__chatdomWalk` exposes the controller there; the existing `__chatdomRealm.setInput` reference smoke
  hook shares the same single client tick. This reference is separate from the kingdom binding below.

- **Bound to the kingdom: not yet.** The integrator owns the binding (recipe below). Until it lands,
  `capture.mjs` fails on purpose with "the kingdom walk binding is absent".
- **Kingdom realm entry: not yet.** The kingdom needs a `RealmEntry` (ticket service) and the founded
  `CollisionWorld` from realm wiring (spec 36) before `connectRealm` can join the kingdom's own room. The
  reference court (`connectReferenceRealm`, `REALM_SIMULATED=1`) is SIMULATED and is not the kingdom.
- **Camera collision.** The boom and near plane are swept against the `collision` world passed to the
  controller. The reference court binding does not pass one yet (`debug.camera.collisionRevision` is `null`
  there), so its camera can still back through the court wall; the integrator adds `collision: REFERENCE_WORLD`
  there and the kingdom's founded world in the kingdom binding.
- **Prediction and collision revisions (WC06).** The realm client takes a revision source, holds prediction
  while a revision is missing and resets on adoption; see "Realm client" below.

## Modules

| Export | File | What it does |
|---|---|---|
| `createWalkController(options)` | `index.ts` | Lifecycle: input, realm tick, camera, takeover |
| `createWalkKeys(keyboard, page?)` | `input/keyboard.ts` | WASD/arrows, Shift, one jump per Space press, release on blur, hidden page, chat focus, context menu and Cmd |
| `isEditableTarget(t)`, `isKeyboardControl(t)` | `input/keyboard.ts` | Fields keep every key; a keyboard-focused control keeps Space and arrows |
| `createWalkPointer(surface, keyboard)` | `input/pointer.ts` | Mouse/pen drag orbit after 8 px, wheel with line/page modes, swallows only the click that ended a drag; no drags while locked |
| `createWalkLook(surface, doc, keyboard, clock?)` | `input/look.ts` | Optional mouse look: V locks, Escape/V/blur/menu frees; R8 delta filter; refused lock → labelled drag fallback, cleared by the next lock |
| `filterLookDelta(dx, dy, sinceLockMs)`, `LOOK` | `input/look.ts` | The R8 filter itself (120 ms settle, >250 px discarded, ±100 px clamp) and the look constants |
| `createWalkTouch(surface, keyboard)` | `input/touch.ts` | Phone: floating left-thumb stick (push past the rim to sprint), one-finger orbit, two-finger pinch zoom |
| `stickRegion(x, y, w, h)`, `stickIntent(dx, dy)`, `TOUCH` | `input/touch.ts` | Which part of the surface is the stick, thumb offset to intent, and the touch constants |
| `createWalkHud(container, onJump)`, `restingStick(w, h)` | `input/hud.ts` | The mouse-look plaque, the phone stick and the jump button, drawn in the given container |
| `isClickPress(dx, dy, ms)`, `CLICK_SLOP_PX`, `CLICK_MS` | `input/pointer.ts` | The click-versus-drag rule for the interaction owner (under 8 px and under 300 ms) |
| `walkDirection(forward, right, heading)` | `input/direction.ts` | Camera-relative intent to world-relative signed bytes; diagonals never faster |
| `facingByte(moveX, moveZ)`, `headingFromByte(yaw)` | `input/direction.ts` | Yaw byte for the actual walk direction, and back to renderer radians |
| `createShoulderRig(heading)`, `shoulderPose(...)` | `camera/shoulder.ts` | Shoulder framing with `filmOffset`, continuous wheel to first person, auto-follow, time-based easing |
| `SHOULDER` | `camera/shoulder.ts` | The chosen framing and feel constants |
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
  readonly selfOpacity: number;   // pass as the local citizen's `opacity`; 0 in first person
  readonly debug: WalkDebug;      // live object, see below
}
```

`frame(now)` calls `realm.tick(now, input)` exactly once, so nothing else may call `tick`. While released it
still ticks with an idle input, keeping prediction and the other walkers moving behind a menu. It never
disposes the realm client; whoever connected it disconnects it (and calls `release()` first so nothing stays
held).

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
| V | mouse look on/off | in fields, with modifiers, on repeat, while released |
| Escape | frees a mouse-look cursor (the browser does too) | otherwise untouched: menus keep it |
| E | the interaction owner | walking never reads it |
| Left mouse/pen on the world | drag orbit once it travels 8 px; a shorter, quicker press stays a click (`isClickPress`) | while locked; the click that ended a drag is swallowed, nothing else |
| Wheel on the world | boom distance, line/page modes, ±240 px per event | over UI: the listener is on the world surface only |
| Touch on the world | lower-left (`stickRegion`: x < 46 %, y > 34 %) is the stick; elsewhere one finger orbits, two pinch | taps (< 8 px) stay clicks; UI above the surface keeps its own touches |
| Jump button | a tap jumps on touch-down; keyboard activation also jumps | never takes focus from the world |

Everything held or pending is cleared on window blur, a hidden page, a native context menu, `release()`, a
dropped connection and `dispose()`. A mouse released outside the window ends its drag on the next move.

**Mouse look.** Free cursor by default. V asks for pointer lock with raw movement where the platform offers it
(and plainly where it does not). Locked movement ignores the first 120 ms, discards any event with either axis
over 250 px, clamps the rest to ±100 px and is gathered until the next frame; it turns 0.0024 rad per pixel at
any window size. If the browser refuses (Chrome does for about a second after Escape, and sandboxed frames
always do), the plaque says so and drag orbit carries on; the next successful lock clears it. A fast flick never
switches to fallback. `release()` frees the cursor at once, and `resume()` never re-locks on its own.

**Phone.** The stick appears under the thumb wherever it lands in the stick region (kept a whole ring inside
the edges), with a 16 % dead zone; pushing past 1.3 × the 52 px rim sprints and lights the ring. A finger
elsewhere orbits from the first pixel it travelled; a second orbit finger pinches (3 wheel px per px of
spread). The resting stick and the jump button sit at 66 % of the height (54 % on a short landscape screen).
Their labels fade once used. The surface's `touch-action` is set to `none` while the controller lives.

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
5. **Takeover and return.**
   - Build enter, Forge open, `setCamera`/`play`/`seek`/`capture`, or `pose(eye, …)`: `walk.release()`.
   - Build exit, Forge close, `pose(null)`, or the walking view chosen again: `walk.resume()`.
   - A menu that needs the keyboard or pointer: `release()` while open, `resume()` when it closes.
   - Realm disconnect: the controller already lets go of every held input on `room.onLeave`/`onDrop`; the
     integrator calls `release()` while the gate is shown and `resume()` once walking again.
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
- **Placements.** A correction over 2 m (`PLACEMENT_SNAP_M`, above 7 m/s × one 200 ms patch) is a placement: it is
  drawn at once instead of glided through whatever lies between. Ordinary corrections ease out over `smoothMs` 80.
- **Yaw** of the local walker is drawn from the exact predicted byte: smoothing a byte that wraps at 256 would
  spin the citizen the long way round.
- **Takeover.** While another owner holds the camera the controller keeps calling `tick` with an idle input, so
  prediction, acknowledgements and the other walkers stay current; a dropped connection clears a latched jump. On
  return nothing is replayed: the next due input simply carries what is held then.

`realm-predict.test.ts` checks all of this against the real room, uWS transport and SDK clients.
`realm-check.mjs` repeats it in two real browsers on the SIMULATED court (a diagnostic, not kingdom acceptance):

```sh
node apps/web/src/walk/realm-check.mjs [--realm-port 5188] [--web-port 5189] [--out shots/walk/wc06]
```

It starts the actual `KingdomRoom` with the SIMULATED reference services (memory only) on the realm port, so it
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
node apps/web/src/walk/capture.mjs --base-url http://127.0.0.1:5190 [--path '/?walk=1'] [--out shots/walk]
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

Do not start a second process on an occupied port. Kingdom capture remains **PENDING BINDING** until realm
wiring supplies a kingdom entry and its founded collision world. The reference court is never used as those
producers. The kingdom realm start command and tested URL belong here when that actual binding lands.
