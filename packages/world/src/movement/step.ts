import { WALK_BUTTON, type CollisionWorld, type PlayerState, type WalkInput } from '@chatdom/shared/realm';
import { recoverBody, slideOrStep, stepDown, supported, sweepVertical } from './collide';

export {
  bodyStuck, embeddedSolids, supported, CONTACT_EPSILON, RECOVERY_REACH, SLIDE_PASSES, STEP_GRAZE, STEP_HEIGHT, STEP_LANDING,
  STEP_PROGRESS, SUPPORT_PROBE,
} from './collide';

/** Top walking speed, m/s. */
export const WALK_SPEED = 4;
/** Top sprint speed, m/s. */
export const SPRINT_SPEED = 7;
/** Ground acceleration, m/s²: a walk is at full speed in .1 s (3 ticks), a sprint in .175 s. */
export const GROUND_ACCEL = 40;
/** Ground braking and turning, m/s²: a walk stops in 2 ticks within .06 m, a sprint in 3 ticks within .24 m. */
export const GROUND_BRAKE = 70;
/** Air control, m/s²: a jump keeps its momentum but can still be steered a little. */
export const AIR_ACCEL = 10;
/** Jump impulse and gravity give a 1.25 m apex (clears one metre, never a 1.5 m fence) and .625 s in the air. */
export const JUMP_SPEED = 8;
export const GRAVITY = 25.6;
export const FALL_SPEED = 30;

/**
 * Moves the horizontal velocity toward the target by at most `rate * dt`, along the straight line between them,
 * so speed never exceeds the larger of the two (no diagonal or turning gain) and the target is reached exactly.
 * Slowing along the current travel uses the brake rate on the ground: quick stops without ice.
 */
function accelerate(s: PlayerState, tx: number, tz: number, grounded: boolean, dt: number): void {
  const ex = tx - s.vx, ez = tz - s.vz;
  const gap = Math.sqrt(ex * ex + ez * ez);
  if (gap === 0) return;
  const braking = tx * s.vx + tz * s.vz < s.vx * s.vx + s.vz * s.vz;
  const reach = (grounded ? braking ? GROUND_BRAKE : GROUND_ACCEL : AIR_ACCEL) * dt;
  if (gap <= reach) { s.vx = tx; s.vz = tz; return; }
  s.vx += ex / gap * reach; s.vz += ez / gap * reach;
}

/**
 * The one movement law, run by the room and by client prediction at `WALK_HZ`. Fixed dt, no clocks, randomness,
 * trigonometry or hidden history: the state, the input and the immutable collision revision decide the result.
 * Feet sit at y. Only `Math.sqrt` and IEEE arithmetic are used, so Node and every browser agree bit for bit.
 *
 * Order per tick: refuse a mismatched revision (the walker holds still, unknown solids never become air);
 * push an embedded body out within a bounded reach or hold it still; accelerate toward the intended velocity;
 * jump only from support; sweep the body vertically along the exact parabola of the tick; slide it horizontally
 * by swept time of impact, climbing a supported half-metre step when grounded; keep it on the ground down a
 * half-metre step; then read support at the end position. `distance` grows by actual horizontal travel, sliding
 * and stepping included, recovery and the vertical part of a step excluded.
 */
export function stepPlayer(s: PlayerState, input: Readonly<WalkInput>, dt: number, world: CollisionWorld): void {
  if (!(dt > 0 && dt <= .1) || input.collisionRevision !== world.revision || s.collisionRevision !== world.revision) return;
  // A body still inside solids after bounded recovery stays put; `bodyStuck` lets the adapter request placement.
  if (!recoverBody(s, world)) { s.vx = 0; s.vy = 0; s.vz = 0; return; }
  // Recovery can push a previously grounded body beyond a ledge. Do not grant a jump or ground control from
  // the old position: support belongs to the recovered position, on both authority and prediction.
  const grounded = s.grounded && supported(s, world);
  const length = Math.max(127, Math.sqrt(input.moveX * input.moveX + input.moveZ * input.moveZ));
  const speed = input.buttons & WALK_BUTTON.sprint ? SPRINT_SPEED : WALK_SPEED;
  const tx = input.moveX / length * speed, tz = input.moveZ / length * speed;
  accelerate(s, tx, tz, grounded, dt);
  s.yaw = input.yaw;
  // A jump is a press accepted only from support; an airborne press is dropped, never stored for landing.
  const jumped = (input.buttons & WALK_BUTTON.jump) !== 0 && grounded;
  if (jumped) s.vy = JUMP_SPEED;
  const vy = s.vy;
  s.vy = Math.max(-FALL_SPEED, vy - GRAVITY * dt);
  // Stable Y/X/Z order: vertical first, so floor seams never read as walls; then X before Z on an exact tie.
  if (sweepVertical(s, (vy + s.vy) * .5 * dt, world)) s.vy = 0;
  // Stepping is for walkers on their feet: never during a jump, a fall or from the air.
  const walking = grounded && !jumped && s.vy <= 0;
  const beforeX = s.x, beforeZ = s.z;
  const slide = slideOrStep(s, s.vx * dt, s.vz * dt, walking ? tx : 0, walking ? tz : 0, world);
  if (slide.blockedX) s.vx = 0;
  if (slide.blockedZ) s.vz = 0;
  if (walking && !supported(s, world) && stepDown(s, world)) s.vy = 0;
  s.grounded = s.vy <= 0 && supported(s, world);
  const mx = s.x - beforeX, mz = s.z - beforeZ;
  s.distance += Math.sqrt(mx * mx + mz * mz);
}
