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
- Camera collision (near-plane boom sweep against the solid world) is WC05. Until then the shoulder camera
  can pass through a wall it backs into.

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
stick under the thumb, or null), `camera` (`yaw`, `pitch`, `distance`, `desiredDistance`, `fov`, `filmOffset`,
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

1. **Connect.** With realm wiring's kingdom entry and founded collision world:
   `const realm = await connectRealm(endpoint, kingdomEntry, kingdomCollisionWorld, sessionStorage);`
2. **Create** after the scene has loaded (camera, canvas and citizen renderer exist):
   ```ts
   import { createWalkController } from '../walk';
   const walk = createWalkController({ camera, surface: canvas, realm, hud: kingdomRoot });
   walk.resize(canvas.clientWidth, canvas.clientHeight);
   ```
   `kingdomRoot` is the `[data-chatdom-kingdom]` element; the plaque and phone controls are drawn inside it
   (`z-index: 2`, below the gate). Draw walkers with a `createCitizenRenderer` (or the crowd's) and give the local one
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

## Feel

The shoulder view stands the citizen on the left third line with the body centre in the lower third, about a
quarter of the screen tall, with the street open ahead (`SHOULDER.landscape`/`portrait`, blended by aspect so a
rotating phone never jumps). The horizontal shift is a lens shift (`filmOffset`), so the vanishing point of
"forward" lies in the citizen's own column and W walks them straight into the picture. The pivot height is
solved so the body stays on its thirds at any pitch. Roll is always zero.

The wheel moves one zoom parameter; the boom is `11 m × z²`, so it reaches exactly 0 with fine control over the
last metre. Between 2.6 m and 0.3 m the pivot slides to the eyes (1.6 m) and the lens shift to zero; the local
citizen fades from 1.25 m and is gone below 0.5 m. Wheel intent (`desiredDistance`) is kept apart from the drawn
distance, which eases at 14/s. Drag right turns the view right; drag up looks up. Pitch runs from −0.5 to 1.1
rad. After 1.5 s without a manual orbit the camera swings gently behind the walk direction (never while a drag
is held, never while standing, never across a reversal of more than 2 rad). Camera height eases at 12/s and
never trails the body by more than 0.45 m, so a step or jump does not jerk the view.

## Capture

```sh
node apps/web/src/walk/capture.mjs --base-url http://127.0.0.1:5190 [--path '/?walk=1'] [--out shots/walk]
```

Two real browsers (1440×900 and 390×844) open the kingdom entry. The script fails explicitly if the page is
not the kingdom (`[data-chatdom-kingdom]` and `__chatdomKingdom`), if `__chatdomWalk` is absent, if no citizen is
placed within 60 s, or if either browser misses the other. It walks the desktop with Shift+W, presses Space once,
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
