import * as THREE from 'three';
import { WALK_BUTTON, type CollisionWorld, type PlayerState, type SolidBox, type WalkInput } from '@chatdom/shared/realm';
import { embeddedSolids } from '@chatdom/world/movement';
import type { RealmWalkerPose } from '../realm/client';
import { createShoulderRig, fovScaleFor, SHOULDER, type ShoulderPose } from './camera/shoulder';
import { facingByte, headingFromByte, walkDirection } from './input/direction';
import { createWalkHud, type WalkHud } from './input/hud';
import { createWalkKeys, DEFAULT_WALK_BINDINGS, type PageLike, type WalkBindings } from './input/keyboard';
import { createWalkLook, LOOK, type KeyboardLockLike, type LockDocument, type LockSurface, type LookMode, type WalkLook } from './input/look';
import type { PlaySettings, PlaySettingsReader } from '../play/slots';
import { createWalkPointer } from './input/pointer';
import { createWalkTouch, type TouchSurface } from './input/touch';
import { createStepEase } from './motion/step-ease';
import type { CitizenGesture } from '../citizens';
import { createGestureState, mountGestureSelector } from './gestures';

export { createGestureState, mountGestureSelector } from './gestures';
export type { GestureState, GestureSelector, PlayableGesture } from './gestures';
export { layoutWalkLabels } from './labels';
export type { WalkLabelAnchor, LabelRect, PlacedWalkLabel } from './labels';

export { createShoulderRig, filmOffsetFor, fovScaleFor, framingFor, shoulderPose, SHOULDER } from './camera/shoulder';
export type { ShoulderPose, ShoulderRig, ShoulderView } from './camera/shoulder';
export { clearBoom, nearFootprint, OCCLUSION, overlapsSolid, RECOVER_RATE, sweepHit } from './camera/occlusion';
export type { BoomPoint, Clearance, Footprint } from './camera/occlusion';
export { facingByte, headingFromByte, walkDirection } from './input/direction';
export { createWalkHud, restingStick, THUMB, thumbSlots } from './input/hud';
export type { ThumbSlot, WalkHud, WalkHudState } from './input/hud';
export { createWalkKeys, DEFAULT_WALK_BINDINGS, isEditableTarget, isKeyboardControl } from './input/keyboard';
export type { WalkBindings } from './input/keyboard';
export { createSpikeFilter, createWalkLook, LOOK } from './input/look';
export type { KeyboardLockLike, LockDocument, LockSurface, LookMode, SpikeFilter, WalkLook, WalkLookView } from './input/look';
export { CLICK_MS, CLICK_SLOP_PX, createWalkPointer, isClickPress, wheelPixels } from './input/pointer';
export { createWalkTouch, stickIntent, stickRegion, TOUCH } from './input/touch';
export type { TouchStick, WalkTouch } from './input/touch';

/** A Colyseus room signal (`room.onLeave`, `room.onDrop`): call to listen, `remove` to stop. */
export interface RoomSignal { (listener: (code: number, reason?: string) => void): unknown; remove(listener: (code: number, reason?: string) => void): void }

/** The part of `RealmClient` the controller drives. A connected `RealmClient` satisfies it as is. */
export interface WalkRealm {
  readonly selfId: string;
  /** Exact state from the client's reconciler, read only after tick; never delayed room schema state. */
  readonly predicted?: Readonly<PlayerState>;
  clearInput?(): void;
  readonly room: {
    readonly state: {
      readonly collisionRevision: number;
      readonly walkers: { get(id: string): { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly placement?: number } | undefined };
    };
    /** Leaving or a dropped connection lets go of everything held, so nothing walks on after a reconnect. */
    readonly onLeave?: RoomSignal;
    readonly onDrop?: RoomSignal;
  };
  tick(now: number, input: WalkInput): readonly RealmWalkerPose[];
}

export interface WalkControllerOptions {
  /** The scene's camera. While walking the controller alone writes its transform, fov and filmOffset. */
  readonly camera: THREE.PerspectiveCamera;
  /** The element under the world (normally the canvas): drag orbit, wheel zoom, touch and mouse look start here. */
  readonly surface: TouchSurface & LockSurface & { readonly clientWidth?: number; readonly clientHeight?: number };
  readonly realm: WalkRealm;
  /** Where walking keys are heard. Defaults to `window`. */
  readonly keyboard?: EventTarget;
  /** Hidden-page release. Defaults to `document`. */
  readonly page?: PageLike;
  /** Pointer-lock state, fullscreen and locked mouse movement. Defaults to `document`. */
  readonly lockDocument?: LockDocument;
  /** Keyboard lock for fullscreen. Defaults to `navigator.keyboard` where the browser has it; null for none. */
  readonly keyboardLock?: KeyboardLockLike | null;
  /**
   * The device's play settings (sensitivity, invert, field of view, first or third person, key bindings, reduced
   * motion), read live. Without it the defaults apply.
   */
  readonly settings?: PlaySettingsReader;
  /** Where the mouse-look label and the phone stick are drawn (the kingdom root). Without it nothing is drawn. */
  readonly hud?: HTMLElement;
  /** Show the phone controls before the first touch. Defaults to the primary pointer being coarse. */
  readonly coarse?: boolean;
  /** Milliseconds for the mouse-look settle window. Defaults to `performance.now`. */
  readonly clock?: () => number;
  /** Entry heading in radians (0 faces +Z). Defaults to the direction the citizen already faces. */
  readonly heading?: number;
  /**
   * The complete collision world the camera must stay out of: the same immutable revision the realm client
   * steps against, or a function returning the newest one each frame (read every frame, so a newly published
   * solid pulls the camera in on the first frame it exists). A function returning null keeps the last world.
   * Without it the camera has no collision, which `debug.camera.collisionRevision === null` reports.
   */
  readonly collision?: CollisionWorld | (() => CollisionWorld | null | undefined);
  /** Supplied only by a bound, authenticated gesture transport. Absent transports draw no dead control. */
  readonly gestures?: {
    available(): boolean;
    publish(gesture: CitizenGesture): void;
    /** Present-tense approved peer gesture; no replay of expired actions. */
    sample(id: string, now: number): CitizenGesture;
  };
}

export type WalkOwner = 'walking' | 'released' | 'disposed';
export interface WalkDebug {
  /** The camera has been placed on the actual connected citizen at least once. */
  ready: boolean;
  owner: WalkOwner;
  selfId: string;
  frames: number;
  walkers: number;
  /** The rendered (predicted) local citizen. */
  self: { x: number; y: number; z: number; yaw: number; speed: number } | null;
  /** The last authoritative room state for the local citizen. */
  authority: { x: number; y: number; z: number } | null;
  /** Everyone else as drawn, refreshed at most four times a second. */
  peers: { id: string; x: number; y: number; z: number }[];
  input: { moveX: number; moveZ: number; buttons: number; yaw: number; collisionRevision: number };
  /** The captured mouse: idle (click to walk), requesting, locked, cooldown, leased, unavailable; touch on a phone. */
  look: LookMode | 'touch';
  /** Warps the spike filter has rejected since the walk began. */
  warps: number;
  /** First or third person, as the camera is placed. */
  person: 'third' | 'first';
  /** The phone stick under the thumb, in surface CSS px, or null. */
  stick: { x: number; y: number; forward: number; right: number; sprint: boolean } | null;
  /**
   * `distance` is the boom drawn, `zoomDistance` the eased wheel wish, `desiredDistance` the wheel's target,
   * `clearance` how far a solid let the boom reach this frame (null when nothing was in the way) and
   * `collisionRevision` the world the camera was kept out of (null: no collision world supplied).
   */
  camera: { yaw: number; pitch: number; distance: number; zoomDistance: number; desiredDistance: number; clearance: number | null; collisionRevision: number | null; fov: number; near: number; filmOffset: number; shift: number };
  /** The citizen's body centre in CSS pixels of the surface, as drawn this frame. */
  screen: { x: number; y: number } | null;
  viewport: { width: number; height: number };
  selfOpacity: number;
}

export interface WalkCameraLimits {
  readonly maxDistance: number;
  readonly tilt: readonly [min: number, max: number];
  /** World boxes the camera's collision ignores: a solid wholly inside one never pulls the boom in. */
  readonly seeThrough: readonly SolidBox[];
}

export interface WalkController {
  /**
   * Once per animation frame, before anything reads the camera or poses. Samples input, ticks the realm
   * exactly once and, while walking, places the camera on the local citizen. Returns the realm's render poses.
   */
  frame(now: number): readonly RealmWalkerPose[];
  /** CSS size of the surface. Call from the scene's existing resize. */
  resize(width: number, height: number): void;
  /** Hand the camera and input to another owner (menu, build, Forge, director). The realm keeps ticking idle. */
  release(): void;
  /** Take the camera back with the view the walker had, drawn straight onto the citizen. */
  resume(): void;
  /**
   * Hold the walker's input while a page sits over the world (the ledger, an arrival step): nothing walks, turns or
   * jumps, but the camera stays on the citizen and the realm keeps ticking. Release with `hold(false)`.
   */
  hold(held: boolean): void;
  readonly held: boolean;
  /**
   * While held, captured-mouse movement goes here in raw pixels instead of turning the camera (a seated game reads
   * it through an input lease). Null: movement while held is dropped, so nothing turns on release.
   */
  divertLook(sink: ((dx: number, dy: number) => void) | null): void;
  /**
   * A place's camera limits while you stand in it (a tavern room): boom length, pitch range (radians below the
   * horizon) and solids the boom passes through (the walls and roof the place fades for you). Null lifts them.
   */
  limitCamera(limits: WalkCameraLimits | null): void;
  /** Entry framing again behind `heading` (radians), or behind the citizen. */
  reset(heading?: number): void;
  dispose(): void;
  readonly owner: WalkOwner;
  /** Feed to the local citizen's `opacity`: it fades away in first person. */
  readonly selfOpacity: number;
  /** The captured mouse, its leases and fullscreen. The play session opens the ledger from `onLetGo`. */
  readonly cursor: WalkLook;
  /** This device walks by touch: no capture, the stick and touch orbit. */
  readonly touch: boolean;
  /** Presentation only. Pass to CitizenSample; movement authority remains in the room. */
  gestureFor(id: string, now: number): CitizenGesture;
  readonly debug: Readonly<WalkDebug>;
}

const BODY_CENTRE = SHOULDER.bodyCentre;
const clampUnit = (n: number) => Math.max(-1, Math.min(1, n));

export function createWalkController(options: WalkControllerOptions): WalkController {
  const { camera, surface, realm } = options;
  const keyboard = options.keyboard ?? window;
  const page = options.page ?? document;
  const settings = options.settings;
  const setting = <K extends keyof PlaySettings>(key: K, fallback: PlaySettings[K]): PlaySettings[K] => settings ? settings.get(key) : fallback;
  const bindings = (): WalkBindings => {
    const bound = settings?.get('keys');
    return bound ? { forward: bound.forward, back: bound.back, left: bound.left, right: bound.right, jump: bound.jump, sprint: bound.sprint } : DEFAULT_WALK_BINDINGS;
  };
  const keys = createWalkKeys(keyboard, page, bindings);
  const pointer = createWalkPointer(surface, keyboard);
  const touch = createWalkTouch(surface, keyboard);
  const look = createWalkLook(surface, options.lockDocument ?? document, keyboard, {
    ...(options.keyboardLock !== undefined ? { keyboardLock: options.keyboardLock } : {}), ...(options.clock ? { clock: options.clock } : {}) });
  const gestures = createGestureState(gesture => options.gestures?.publish(gesture));
  const selector = options.hud && options.gestures ? mountGestureSelector(options.hud, {
    state: gestures, available: options.gestures.available(),
  }) : null;
  let gesture: CitizenGesture = 'none';
  const coarse = options.coarse ?? (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  let touchJump = false;
  const hud: WalkHud | null = options.hud ? createWalkHud(options.hud, () => { if (owner === 'walking') touchJump = true; }) : null;
  const rig = createShoulderRig(options.heading ?? 0);
  const applySettings = (instant = false) => {
    rig.setFovScale(fovScaleFor(setting('fov', 74)));
    rig.setPerson(setting('view', 'third'), { instant, reducedMotion: setting('reducedMotion', false) });
  };
  applySettings(true);
  const stopSettings = settings?.subscribe(() => applySettings()) ?? (() => {});
  // One press into the world takes the mouse; that press is only the capture, never a pick or a step.
  const pressed = (raw: Event) => {
    const event = raw as PointerEvent;
    if (owner !== 'walking' || event.pointerType === 'touch' || event.pointerType === 'pen') return;
    if (look.mode === 'locked' || look.mode === 'unavailable') return;
    if (look.capture(event)) { event.stopImmediatePropagation(); event.preventDefault(); }
  };
  surface.addEventListener('pointerdown', pressed, { capture: true });
  const stepEase = createStepEase();
  let stepRevision: number | null = null;
  let stepPlacement: number | undefined;
  const supplied = options.collision;
  let solids: CollisionWorld | null = typeof supplied === 'function' ? null : supplied ?? null;
  const collision = () => {
    if (typeof supplied === 'function') solids = supplied() ?? solids;
    return solids;
  };
  let seeThrough: readonly SolidBox[] = [];
  const inside = (solid: SolidBox, box: SolidBox) => solid.min.every((v, i) => v >= box.min[i]! - 1e-6) && solid.max.every((v, i) => v <= box.max[i]! + 1e-6);
  /** The camera's world: the walk's collision less anything a place lets the camera see through. */
  const cameraWorld = (): CollisionWorld | null => {
    const world = collision();
    if (!world || !seeThrough.length) return world;
    return { revision: world.revision, query: bounds => world.query(bounds).filter(solid => !seeThrough.some(box => inside(solid, box))) };
  };
  const projected = new THREE.Vector3();
  let held = false, lookSink: ((dx: number, dy: number) => void) | null = null;
  let owner: WalkOwner = 'walking', placed = false, facing: number | null = null, jumpedLastFrame = false, last: number | null = null, peersAt = -Infinity;
  let width = Math.max(1, surface.clientWidth ?? 1), height = Math.max(1, surface.clientHeight ?? 1);
  let pose: ShoulderPose | null = null;
  const debug: WalkDebug = {
    ready: false, owner, selfId: realm.selfId, frames: 0, walkers: 0, self: null, authority: null, peers: [],
    input: { moveX: 0, moveZ: 0, buttons: 0, yaw: 0, collisionRevision: realm.room.state.collisionRevision },
    look: coarse ? 'touch' : look.mode, warps: 0, person: rig.person, stick: null,
    camera: { yaw: rig.view.yaw, pitch: rig.view.pitch, distance: rig.view.distance, zoomDistance: rig.zoomDistance, desiredDistance: rig.desiredDistance, clearance: null, collisionRevision: solids?.revision ?? null, fov: camera.fov, near: camera.near, filmOffset: camera.filmOffset, shift: 0 },
    screen: null, viewport: { width, height }, selfOpacity: 1,
  };
  const straighten = () => { if (camera.filmOffset !== 0) { camera.filmOffset = 0; camera.updateProjectionMatrix(); } };
  const showHud = () => {
    const stick = touch.stick;
    debug.look = coarse || touch.used ? 'touch' : look.mode;
    debug.stick = stick ? { x: stick.x, y: stick.y, forward: stick.forward, right: stick.right, sprint: stick.sprint } : null;
    hud?.update({ visible: owner === 'walking' && !held, touch: coarse || touch.used, stick, width, height });
  };
  const setOwner = (value: WalkOwner) => { owner = value; debug.owner = value; selector?.setVisible(value === 'walking'); showHud(); };
  /** Blur, hidden page, menu, disconnect: nothing held, nothing pending, no capture, cursor given back. */
  const drop = () => { keys.clear(); pointer.clear(); touch.clear(); gestures.clear(); gesture = 'none'; touchJump = false; jumpedLastFrame = false; realm.clearInput?.(); stepEase.reset(); rig.settle(); };
  const hidden = () => { if (page.hidden) drop(); };
  const contextmenu = (event: Event) => { if (!event.defaultPrevented) drop(); };
  const disconnected = () => drop();
  keyboard.addEventListener('blur', drop);
  keyboard.addEventListener('contextmenu', contextmenu);
  page.addEventListener('visibilitychange', hidden);
  realm.room.onLeave?.(disconnected);
  realm.room.onDrop?.(disconnected);
  const stopLook = look.onChange(view => {
    // Locking or unlocking ends any drag; locked presses never become drags. Only a page that can never capture
    // the mouse may drag to look.
    pointer.setLocked(view.mode === 'locked');
    pointer.setMouseDrag(view.mode === 'unavailable');
    showHud();
  });
  pointer.setMouseDrag(look.mode === 'unavailable');
  // A key held when the mouse is let go (Escape into the ledger) must not keep walking behind the ledger.
  const stopLetGo = look.onLetGo(() => { keys.clear(); realm.clearInput?.(); });
  const stopTouch = touch.onChange(showHud);
  showHud();

  return {
    frame(now) {
      if (owner === 'disposed') return [];
      const dt = last === null || !Number.isFinite(now) ? 0 : Math.max(0, Math.min(.1, (now - last) / 1000));
      last = Number.isFinite(now) ? now : last;
      const walking = owner === 'walking';
      const steering = walking && !held;
      if (walking && held) {
        const diverted = look.takeLook();
        if (lookSink && (diverted.dx || diverted.dy)) lookSink(diverted.dx, diverted.dy);
      }
      if (steering) {
        // Every source gathered since the last frame, so a slow frame turns as far as the hand did.
        const drag = pointer.takeOrbit(), swipe = touch.takeOrbit(), locked = look.takeLook();
        const invert = setting('invertY', false) ? -1 : 1;
        rig.orbit(drag.dx + swipe.dx, (drag.dy + swipe.dy) * invert, height);
        // Locked mouse look turns a fixed angle per pixel, whatever the window size, scaled by the hand's setting.
        const turn = LOOK.radiansPerPx * setting('sensitivity', 1);
        rig.orbit(locked.dx * turn * height / SHOULDER.orbitYaw, locked.dy * invert * turn * height / SHOULDER.orbitPitch, height);
        debug.warps = look.rejected;
        rig.zoom(pointer.takeZoom() + touch.takeZoom());
      }
      const move = steering ? walkDirection(clampUnit(keys.forward + touch.forward), clampUnit(keys.right + touch.right), rig.view.yaw) : { moveX: 0, moveZ: 0 };
      // The step adopts input yaw every tick: standing still must send the way the citizen already faces.
      facing = facingByte(move.moveX, move.moveZ) ?? facing ?? realm.room.state.walkers.get(realm.selfId)?.yaw ?? null;
      // One jump per press. Main's client latches on a rising edge, so a second press arriving on the very
      // next frame waits one frame with the bit low rather than merging into the first.
      let jump = 0;
      if (steering && !jumpedLastFrame) {
        const pressed = keys.takeJump() || touchJump;
        touchJump = false;
        if (pressed) jump = WALK_BUTTON.jump;
      }
      jumpedLastFrame = jump !== 0;
      const input: WalkInput = {
        moveX: move.moveX, moveZ: move.moveZ,
        buttons: (steering && (keys.sprint || touch.sprint) ? WALK_BUTTON.sprint : 0) | jump,
        yaw: facing ?? 0, collisionRevision: realm.room.state.collisionRevision,
      };
      let poses = realm.tick(now, input);
      const available = walking && (options.gestures?.available() ?? false);
      selector?.setAvailable(available);
      if (!available) gestures.clear();
      gesture = available ? gestures.sample(now, move.moveX !== 0 || move.moveZ !== 0 || jump !== 0 || (poses.find(p => p.self)?.speed ?? 0) > .1) : 'none';
      const self = poses.find(p => p.self);
      const authority = realm.room.state.walkers.get(realm.selfId);
      Object.assign(debug, { frames: debug.frames + 1, walkers: poses.length, input, authority: authority ? { x: authority.x, y: authority.y, z: authority.z } : null });
      if (!(now - peersAt < 250)) { peersAt = now; debug.peers = poses.filter(p => !p.self).map(({ id, x, y, z }) => ({ id, x, y, z })); }
      if (!self) return poses;
      if (!placed) { rig.reset(options.heading ?? headingFromByte(self.yaw)); placed = true; }
      debug.self = { x: self.x, y: self.y, z: self.z, yaw: self.yaw, speed: self.speed };
      if (!walking) return poses;
      rig.update(dt, self.speed > .3 ? headingFromByte(self.yaw) : null, self.speed, pointer.dragging || touch.orbiting);
      const world = collision();
      let bodyY = self.y, cameraY: number | undefined;
      const predicted = realm.predicted;
      if (predicted) {
        if (predicted.collisionRevision !== stepRevision || authority?.placement !== stepPlacement) {
          stepEase.reset(); rig.settle(); stepRevision = predicted.collisionRevision; stepPlacement = authority?.placement;
        }
        // SDK interpolation is the single presentation clock for feet and camera. Sampling exact fixed-step
        // height here injects a 30 Hz offset into an otherwise smoothly interpolated render pose.
        const eased = stepEase.update(self.y, predicted.grounded, dt);
        bodyY = eased.body;
        cameraY = eased.camera;
        // Further horizontal travel can carry the eased head under a new lintel: retain the actual body there.
        if (bodyY !== self.y && world && embeddedSolids({ x: self.x, y: bodyY, z: self.z }, world).length) bodyY = self.y;
        poses = poses.map(p => p.self ? { ...p, y: bodyY } : p);
        debug.self!.y = bodyY;
      }
      pose = rig.apply(camera, [self.x, self.y, self.z], width / height, seeThrough.length ? cameraWorld() : world, cameraY);
      debug.person = rig.person;
      projected.set(self.x, bodyY + BODY_CENTRE, self.z).project(camera);
      Object.assign(debug, {
        ready: true, selfOpacity: pose.selfOpacity,
        screen: { x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height },
        camera: { ...rig.view, zoomDistance: rig.zoomDistance, desiredDistance: rig.desiredDistance, clearance: rig.clearance, collisionRevision: world?.revision ?? null, fov: camera.fov, near: camera.near, filmOffset: camera.filmOffset, shift: pose.shift },
      });
      return poses;
    },
    resize(w, h) {
      if (!(w > 0 && h > 0)) return;
      width = w; height = h; debug.viewport = { width, height };
      showHud();
    },
    release() {
      if (owner !== 'walking') return;
      keys.setEnabled(false); pointer.setEnabled(false); touch.setEnabled(false); look.setEnabled(false); drop();
      stepEase.reset();
      setOwner('released');
      straighten();
    },
    hold(value) {
      if (owner === 'disposed' || value === held) return;
      held = value;
      if (owner === 'walking') { keys.setEnabled(!held); pointer.setEnabled(!held); touch.setEnabled(!held); }
      if (held) { keys.clear(); pointer.clear(); touch.clear(); touchJump = false; realm.clearInput?.(); }
      showHud();
    },
    get held() { return held; },
    divertLook(sink) { lookSink = sink; },
    limitCamera(limits) {
      const valid = limits && limits.maxDistance > 0 && limits.tilt.every(Number.isFinite);
      rig.setLimits(valid ? { maxDistance: limits.maxDistance, minPitch: limits.tilt[0], maxPitch: limits.tilt[1] } : null);
      seeThrough = valid ? limits.seeThrough.filter(box => box.min.every(Number.isFinite) && box.max.every(Number.isFinite)) : [];
    },
    resume() {
      if (owner !== 'released') return;
      keys.setEnabled(!held); pointer.setEnabled(!held); touch.setEnabled(!held); look.setEnabled(true);
      setOwner('walking');
      rig.settle();
    },
    reset(heading) {
      if (owner === 'disposed') return;
      keys.clear(); pointer.clear(); touch.clear(); touchJump = false; jumpedLastFrame = false;
      gestures.clear(); gesture = 'none';
      realm.clearInput?.();
      stepEase.reset();
      rig.reset(heading ?? (facing === null ? rig.view.yaw : headingFromByte(facing)));
    },
    dispose() {
      if (owner === 'disposed') return;
      stopLook(); stopTouch(); stopLetGo(); stopSettings();
      surface.removeEventListener('pointerdown', pressed, { capture: true });
      realm.clearInput?.();
      selector?.dispose(); gestures.dispose(); gesture = 'none';
      keys.dispose(); pointer.dispose(); touch.dispose(); look.dispose(); hud?.dispose();
      keyboard.removeEventListener('blur', drop);
      keyboard.removeEventListener('contextmenu', contextmenu);
      page.removeEventListener('visibilitychange', hidden);
      realm.room.onLeave?.remove(disconnected);
      realm.room.onDrop?.remove(disconnected);
      setOwner('disposed'); debug.ready = false;
      straighten();
    },
    get owner() { return owner; },
    get selfOpacity() { return owner === 'walking' && pose ? pose.selfOpacity : 1; },
    get cursor() { return look; },
    get touch() { return coarse || touch.used; },
    gestureFor(id, now) { return owner === 'disposed' || !options.gestures?.available() ? 'none' : id === realm.selfId ? gesture : options.gestures.sample(id, now); },
    debug,
  };
}
