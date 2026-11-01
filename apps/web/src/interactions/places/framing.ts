import * as THREE from 'three';
import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { segmentClear, type InteractionRecord } from '../../../../../packages/world/src/interactions';

/**
 * A place's framing while the walking camera is released to it: where the eye stands and what it looks at. It
 * is a suggestion drawn from the place's own authored anchors (seat rest/facing, the anvil's face), never a rig
 * of its own: the scene's one camera is eased there and handed back to walk-camera when the view closes.
 */
export interface PlaceShot { readonly eye: Vec3; readonly at: Vec3 }

/** How long the camera takes to settle into a place's framing. Reduced motion cuts instead. */
export const FRAMING_MS = 700;
/** The eye never sits closer than this to what it looks at, so a pulled-in shot is still a shot. */
const NEAREST_EYE = 1.1;

const horizontal = (from: Vec3, to: Vec3): [number, number] => {
  const dx = to[0] - from[0], dz = to[2] - from[2], length = Math.hypot(dx, dz) || 1;
  return [dx / length, dz / length];
};

/**
 * Seated at a log or chair: from behind the body, high and wide of its right shoulder, looking past the seat into
 * what it faces (the fire, the table), so the ring and the faces across it stay open and your own head does not
 * fill the frame. Portrait screens stand a little further back and higher.
 */
export function seatShot(record: InteractionRecord, aspect = 16 / 10): PlaceShot | null {
  if (!record.rest || record.facing === null) return null;
  const fx = Math.sin(record.facing), fz = Math.cos(record.facing);
  // Measured from the seated body itself, not from wherever the place's approach route happens to end (in front of
  // the feet at the campfire, beside the chair in a tavern), on the standing floor's height.
  const [x, y, z] = record.rest, floor = record.target.approach[1];
  const back = aspect < 1 ? 4 : 3.3, wide = aspect < 1 ? 1.1 : 1.5, high = aspect < 1 ? 3.3 : 2.9;
  return {
    eye: [x - fx * back - fz * wide, floor + high, z - fz * back + fx * wide],
    at: [x + fx * 1.2, y + .35, z + fz * 1.2],
  };
}

/** How far your own body must stay from the line between the eye and the anvil, so it never hides the anvil. */
export const BODY_CLEAR = .9;

/** Horizontal distance from `p` to the segment `a`–`b`. */
function besideSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ux = b[0] - a[0], uz = b[2] - a[2], length = ux * ux + uz * uz || 1;
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * ux + (p[2] - a[2]) * uz) / length));
  return Math.hypot(p[0] - a[0] - ux * t, p[2] - a[2] - uz * t);
}

/**
 * At the hero anvil: three-quarters from the approach side, a little above the working face, with the anvil set
 * off-centre so the Forge's visit card beside it (right on a wide screen, below on a tall one) never covers it.
 *
 * The person may have used the anvil from anywhere within reach, not only from its authored approach, so the eye
 * starts off the right shoulder and swings to the other side or wider until `feet` (the body's actual place) stands
 * at least `BODY_CLEAR` off the line to the anvil. Without feet it keeps the right-shoulder framing.
 */
export function anvilShot(record: InteractionRecord, aspect = 16 / 10, feet?: Vec3 | null): PlaceShot {
  const anvil = record.target.position, approach = record.target.approach;
  const [dx, dz] = horizontal(approach, anvil);
  const sx = dz, sz = -dx, rx = -dz, rz = dx;
  const tall = aspect < 1;
  // A standing person's eye a little raised and well back: the anvil with ground and sky round it, not a close-up.
  const back = tall ? 3.8 : 3.4, high = tall ? .8 : .75;
  const eyeAt = (side: number, wide: number): Vec3 =>
    [approach[0] - dx * (back - 1) + sx * wide * side, approach[1] + 1.55 + high, approach[2] - dz * (back - 1) + sz * wide * side];
  // Every eye stands behind the approach, so the view runs along the approach→anvil line and (rx, rz) is screen-right.
  // Wide: look past the anvil's right of frame, so it sits in the left half beside the card. Tall: look below and in
  // front of it, so it sits in the upper half above the sheet; a shorter reach toward the camera looks lower instead,
  // so the aim can leave a body standing in front of the anvil. The look point never sinks into the ground.
  const atFor = (toward: number): Vec3 => {
    const shift = tall ? -.45 : 1.05, drop = tall ? .45 + (1.5 - toward) * .45 : .25;
    return [anvil[0] + rx * shift - dx * toward, Math.max(approach[1] + .1, anvil[1] - drop), anvil[2] + rz * shift - dz * toward];
  };
  const base = tall ? 1.1 : 1.2;
  const reaches = tall ? [1.5, .8, .2] : [0];
  const candidates: { eye: Vec3; at: Vec3 }[] = [];
  for (const toward of reaches) for (const wide of [base, base + .8, base + 1.6]) for (const side of [1, -1]) {
    candidates.push({ eye: eyeAt(side, wide), at: atFor(toward) });
  }
  const plain = candidates[0]!;
  if (!feet || !finite(feet)) return plain;
  // The body must stand clear of both the line to the anvil and the line of sight through the frame's centre.
  let best = plain, bestClear = -1;
  for (const shot of candidates) {
    const clear = Math.min(besideSegment(feet, shot.eye, anvil), besideSegment(feet, shot.eye, shot.at));
    if (clear >= BODY_CLEAR) return shot;
    if (clear > bestClear) { bestClear = clear; best = shot; }
  }
  return best;
}

const finite = (v: Vec3) => v.every(Number.isFinite);

/**
 * Pull the eye in along its line until nothing solid stands between it and what it looks at, so a framing never
 * looks through a wall, a roof or the next house. Never closer than `NEAREST_EYE`; a line blocked even there
 * keeps the walking camera (null) rather than snapping through.
 */
export function clearShot(world: CollisionWorld | null, shot: PlaceShot): PlaceShot | null {
  if (!world) return shot;
  const { eye, at } = shot;
  const length = Math.hypot(eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]);
  if (length <= NEAREST_EYE) return segmentClear(world, eye, at) ? shot : null;
  const along = (t: number): Vec3 => [at[0] + (eye[0] - at[0]) * t, at[1] + (eye[1] - at[1]) * t, at[2] + (eye[2] - at[2]) * t];
  if (segmentClear(world, eye, at)) return shot;
  const nearest = NEAREST_EYE / length;
  if (!segmentClear(world, along(nearest), at)) return null;
  let clear = nearest, blocked = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (clear + blocked) / 2;
    if (segmentClear(world, along(mid), at)) clear = mid; else blocked = mid;
  }
  // A small margin off whatever stopped the line, so the near plane does not graze it.
  return { eye: along(Math.max(nearest, clear - .15 / length)), at };
}

/** The scene camera the shot is eased onto. The kingdom's own `THREE.PerspectiveCamera`; nothing new is made. */
export type FramedCamera = Pick<THREE.PerspectiveCamera, 'position' | 'quaternion' | 'aspect' | 'lookAt' | 'updateMatrixWorld'>;

/**
 * Ease `camera` from where walking left it onto `shot` (smoothstep over `FRAMING_MS`; reduced motion places it at
 * once), then hold it there every frame. `frame(now)` is the place view's tick; the controller calls it while it
 * holds the camera, before it selects or projects, so the prompt and picks use the camera that draws.
 */
export function createShotEase(camera: FramedCamera, shot: PlaceShot, options: { readonly reducedMotion: boolean; readonly now?: number }) {
  const fromPosition = camera.position.clone(), fromQuaternion = camera.quaternion.clone();
  const toPosition = new THREE.Vector3(...shot.eye);
  // The look rotation at the target, computed once on a scratch camera so the real one is never disturbed.
  const probe = new THREE.Object3D();
  probe.position.copy(toPosition);
  // Cameras look down −Z; an Object3D's lookAt points +Z, so aim the probe away from the target.
  probe.lookAt(2 * shot.eye[0] - shot.at[0], 2 * shot.eye[1] - shot.at[1], 2 * shot.eye[2] - shot.at[2]);
  const toQuaternion = probe.quaternion.clone();
  let start: number | null = options.now ?? null;
  return {
    shot,
    frame(now: number): number {
      if (start === null) start = now;
      const raw = options.reducedMotion ? 1 : Math.min(1, Math.max(0, (now - start) / FRAMING_MS));
      const t = raw * raw * (3 - 2 * raw);
      camera.position.lerpVectors(fromPosition, toPosition, t);
      camera.quaternion.slerpQuaternions(fromQuaternion, toQuaternion, t);
      camera.updateMatrixWorld();
      return raw;
    },
  };
}
