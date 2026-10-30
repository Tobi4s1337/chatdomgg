import * as THREE from 'three';
import { WALK_BUTTON, type WalkInput } from '@chatdom/shared/realm';
import type { RealmWalkerPose } from '../realm/client';
import { createShoulderRig, SHOULDER, type ShoulderPose } from './camera/shoulder';
import { facingByte, headingFromByte, walkDirection } from './input/direction';
import { createWalkKeys, type PageLike } from './input/keyboard';
import { createWalkPointer, type PointerSurface } from './input/pointer';

export { createShoulderRig, filmOffsetFor, framingFor, shoulderPose, SHOULDER } from './camera/shoulder';
export type { ShoulderPose, ShoulderRig, ShoulderView } from './camera/shoulder';
export { facingByte, headingFromByte, walkDirection } from './input/direction';
export { createWalkKeys, isEditableTarget } from './input/keyboard';
export { CLICK_MS, CLICK_SLOP_PX, createWalkPointer, isClickPress, wheelPixels } from './input/pointer';

/** The part of `RealmClient` the controller drives. A connected `RealmClient` satisfies it as is. */
export interface WalkRealm {
  readonly selfId: string;
  readonly room: { readonly state: {
    readonly collisionRevision: number;
    readonly walkers: { get(id: string): { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number } | undefined };
  } };
  tick(now: number, input: WalkInput): readonly RealmWalkerPose[];
}

export interface WalkControllerOptions {
  /** The scene's camera. While walking the controller alone writes its transform, fov and filmOffset. */
  readonly camera: THREE.PerspectiveCamera;
  /** The element under the world (normally the canvas): drag orbit and wheel zoom start here. */
  readonly surface: PointerSurface & { readonly clientWidth?: number; readonly clientHeight?: number };
  readonly realm: WalkRealm;
  /** Where walking keys are heard. Defaults to `window`. */
  readonly keyboard?: EventTarget;
  /** Hidden-page release. Defaults to `document`. */
  readonly page?: PageLike;
  /** Entry heading in radians (0 faces +Z). Defaults to the direction the citizen already faces. */
  readonly heading?: number;
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
  camera: { yaw: number; pitch: number; distance: number; desiredDistance: number; fov: number; filmOffset: number; shift: number };
  /** The citizen's body centre in CSS pixels of the surface, as drawn this frame. */
  screen: { x: number; y: number } | null;
  viewport: { width: number; height: number };
  selfOpacity: number;
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
  /** Entry framing again behind `heading` (radians), or behind the citizen. */
  reset(heading?: number): void;
  dispose(): void;
  readonly owner: WalkOwner;
  /** Feed to the local citizen's `opacity`: it fades away in first person. */
  readonly selfOpacity: number;
  readonly debug: Readonly<WalkDebug>;
}

const BODY_CENTRE = SHOULDER.bodyCentre;

export function createWalkController(options: WalkControllerOptions): WalkController {
  const { camera, surface, realm } = options;
  const keyboard = options.keyboard ?? window;
  const keys = createWalkKeys(keyboard, options.page ?? document);
  const pointer = createWalkPointer(surface, keyboard);
  const rig = createShoulderRig(options.heading ?? 0);
  const projected = new THREE.Vector3();
  let owner: WalkOwner = 'walking', placed = false, facing: number | null = null, jumpedLastFrame = false, last: number | null = null, peersAt = -Infinity;
  let width = Math.max(1, surface.clientWidth ?? 1), height = Math.max(1, surface.clientHeight ?? 1);
  let pose: ShoulderPose | null = null;
  const debug: WalkDebug = {
    ready: false, owner, selfId: realm.selfId, frames: 0, walkers: 0, self: null, authority: null, peers: [],
    input: { moveX: 0, moveZ: 0, buttons: 0, yaw: 0, collisionRevision: realm.room.state.collisionRevision },
    camera: { yaw: rig.view.yaw, pitch: rig.view.pitch, distance: rig.view.distance, desiredDistance: rig.desiredDistance, fov: camera.fov, filmOffset: camera.filmOffset, shift: 0 },
    screen: null, viewport: { width, height }, selfOpacity: 1,
  };
  const straighten = () => { if (camera.filmOffset !== 0) { camera.filmOffset = 0; camera.updateProjectionMatrix(); } };
  const setOwner = (value: WalkOwner) => { owner = value; debug.owner = value; };

  return {
    frame(now) {
      if (owner === 'disposed') return [];
      const dt = last === null || !Number.isFinite(now) ? 0 : Math.max(0, Math.min(.1, (now - last) / 1000));
      last = Number.isFinite(now) ? now : last;
      const walking = owner === 'walking';
      if (walking) {
        const { dx, dy } = pointer.takeOrbit();
        rig.orbit(dx, dy, height);
        rig.zoom(pointer.takeZoom());
      }
      const move = walking ? walkDirection(keys.forward, keys.right, rig.view.yaw) : { moveX: 0, moveZ: 0 };
      // The step adopts input yaw every tick: standing still must send the way the citizen already faces.
      facing = facingByte(move.moveX, move.moveZ) ?? facing ?? realm.room.state.walkers.get(realm.selfId)?.yaw ?? null;
      // One jump per press. Main's client latches on a rising edge, so a second press arriving on the very
      // next frame waits one frame with the bit low rather than merging into the first.
      let jump = 0;
      if (walking && !jumpedLastFrame && keys.takeJump()) jump = WALK_BUTTON.jump;
      jumpedLastFrame = jump !== 0;
      const input: WalkInput = {
        moveX: move.moveX, moveZ: move.moveZ,
        buttons: (walking && keys.sprint ? WALK_BUTTON.sprint : 0) | jump,
        yaw: facing ?? 0, collisionRevision: realm.room.state.collisionRevision,
      };
      const poses = realm.tick(now, input);
      const self = poses.find(p => p.self);
      const authority = realm.room.state.walkers.get(realm.selfId);
      Object.assign(debug, { frames: debug.frames + 1, walkers: poses.length, input, authority: authority ? { x: authority.x, y: authority.y, z: authority.z } : null });
      if (!(now - peersAt < 250)) { peersAt = now; debug.peers = poses.filter(p => !p.self).map(({ id, x, y, z }) => ({ id, x, y, z })); }
      if (!self) return poses;
      if (!placed) { rig.reset(options.heading ?? headingFromByte(self.yaw)); placed = true; }
      debug.self = { x: self.x, y: self.y, z: self.z, yaw: self.yaw, speed: self.speed };
      if (!walking) return poses;
      rig.update(dt, self.speed > .3 ? headingFromByte(self.yaw) : null, self.speed, pointer.dragging);
      pose = rig.apply(camera, [self.x, self.y, self.z], width / height);
      projected.set(self.x, self.y + BODY_CENTRE, self.z).project(camera);
      Object.assign(debug, {
        ready: true, selfOpacity: pose.selfOpacity,
        screen: { x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height },
        camera: { ...rig.view, desiredDistance: rig.desiredDistance, fov: camera.fov, filmOffset: camera.filmOffset, shift: pose.shift },
      });
      return poses;
    },
    resize(w, h) {
      if (!(w > 0 && h > 0)) return;
      width = w; height = h; debug.viewport = { width, height };
    },
    release() {
      if (owner !== 'walking') return;
      setOwner('released'); keys.setEnabled(false); pointer.setEnabled(false); jumpedLastFrame = false;
      straighten();
    },
    resume() {
      if (owner !== 'released') return;
      setOwner('walking'); keys.setEnabled(true); pointer.setEnabled(true);
      rig.settle();
    },
    reset(heading) {
      if (owner === 'disposed') return;
      keys.clear(); pointer.clear(); jumpedLastFrame = false;
      rig.reset(heading ?? (facing === null ? rig.view.yaw : headingFromByte(facing)));
    },
    dispose() {
      if (owner === 'disposed') return;
      setOwner('disposed'); keys.dispose(); pointer.dispose(); debug.ready = false;
      straighten();
    },
    get owner() { return owner; },
    get selfOpacity() { return owner === 'walking' && pose ? pose.selfOpacity : 1; },
    debug,
  };
}
