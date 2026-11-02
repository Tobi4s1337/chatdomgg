import type { Vec3 } from '@chatdom/shared';

/**
 * The stream's hero lens on the grand land.
 *
 * The native hero lens looks north from the streets so the castle crowns the town. On the old land a painted
 * mountain backdrop always stood behind it. The grand land's real ranges stand wherever Genesis raised them,
 * so a fixed north lens can leave a flat sea horizon behind the castle while the mountains sit just out of
 * frame. This turns the same lens about the market, within a bounded yaw, toward the land's actual relief.
 * The eye keeps its distance and height above the market, the castle stays near the centre of the frame and
 * its line of sight stays clear of the ground. The result depends only on the immutable baked surface and the
 * installed layout, so every screen frames the same picture and it never changes with the hour or presence.
 */
export interface HeroLens { readonly eye: Vec3; readonly target: Vec3; readonly yaw: number; readonly score: number }

export interface HeroLensInput {
  /** Visual ground height in installed metres, or null outside the land. */
  readonly height: (x: number, z: number) => number | null;
  readonly eye: Vec3;
  readonly target: Vec3;
  /** The orbit centre, normally the market. */
  readonly pivot: Vec3;
  /** Vertical field of view in degrees and width / height. */
  readonly fov: number;
  readonly aspect: number;
  /** Water level in installed metres; relief is measured above it. */
  readonly seaLevel: number;
}

const MAX_YAW = 40 * Math.PI / 180, YAW_STEP = 2.5 * Math.PI / 180;
/** Skyline rays across the frame and the distances they sample, in metres beyond the castle's foreground. */
const COLUMNS = 24, NEAR = 220, FAR = 1400, STEP = 12;
/** A full turn must raise the mean skyline by half a degree, so a flat land keeps the accepted north lens. */
const TURN_COST = .5 * Math.PI / 180;

function rotate(x: number, z: number, angle: number): [number, number] {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [x * c - z * s, x * s + z * c];
}

/** Sum of the skyline's angular height above the sea across the frame, beyond the town. */
function skyline(input: HeroLensInput, eye: Vec3, target: Vec3): number {
  const dx = target[0] - eye[0], dz = target[2] - eye[2], length = Math.hypot(dx, dz);
  const halfWidth = Math.atan(Math.tan(input.fov * Math.PI / 360) * input.aspect) * .92;
  let total = 0;
  for (let column = 0; column < COLUMNS; column++) {
    const angle = -halfWidth + 2 * halfWidth * (column + .5) / COLUMNS;
    const [ux, uz] = rotate(dx / length, dz / length, angle);
    let best = 0;
    for (let distance = NEAR; distance <= FAR; distance += STEP) {
      const ground = input.height(eye[0] + ux * distance, eye[2] + uz * distance);
      if (ground === null) break;
      best = Math.max(best, (ground - input.seaLevel) / distance);
    }
    total += Math.atan(best);
  }
  return total / COLUMNS;
}

/** Is the ground below the straight sight line from the eye to the castle (and below the eye itself)? */
function clear(input: HeroLensInput, eye: Vec3, target: Vec3): boolean {
  const ground = input.height(eye[0], eye[2]);
  if (ground === null || ground > eye[1] - 12) return false;
  for (let t = .04; t < .9; t += .02) {
    const x = eye[0] + (target[0] - eye[0]) * t, y = eye[1] + (target[1] - eye[1]) * t, z = eye[2] + (target[2] - eye[2]) * t;
    const h = input.height(x, z);
    if (h === null || h > y - 2) return false;
  }
  return true;
}

export function heroLensOnLand(input: HeroLensInput): HeroLens {
  if (![...input.eye, ...input.target, ...input.pivot, input.fov, input.aspect, input.seaLevel].every(Number.isFinite)
    || input.fov <= 0 || input.fov >= 180 || input.aspect <= 0) throw new Error('The hero lens needs a finite camera');
  const base = { eye: input.eye, target: input.target, yaw: 0, score: 0 };
  if (!clear(input, input.eye, input.target)) return base;
  const reference = skyline(input, input.eye, input.target);
  let best: HeroLens = { ...base, score: reference };
  const steps = Math.round(MAX_YAW / YAW_STEP);
  // Symmetric search in a fixed order: ties keep the smaller turn, then the left turn.
  for (let i = 1; i <= steps; i++) for (const sign of [-1, 1]) {
    const yaw = sign * i * YAW_STEP;
    const [ox, oz] = rotate(input.eye[0] - input.pivot[0], input.eye[2] - input.pivot[2], yaw);
    const eye: Vec3 = [input.pivot[0] + ox, input.eye[1], input.pivot[2] + oz];
    if (!clear(input, eye, input.target)) continue;
    const score = skyline(input, eye, input.target);
    const cost = (turn: number) => TURN_COST * Math.abs(turn) / MAX_YAW;
    if (score - cost(yaw) > best.score - cost(best.yaw) + 1e-9)
      best = { eye, target: input.target, yaw, score };
  }
  return best;
}
