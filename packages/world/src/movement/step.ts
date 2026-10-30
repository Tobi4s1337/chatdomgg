import { WALK_BUTTON, type CollisionWorld, type PlayerState, type WalkInput } from '@chatdom/shared/realm';
import { recoverBody, slideHorizontal, supported, sweepVertical } from './collide';

export { bodyStuck, embeddedSolids, CONTACT_EPSILON, RECOVERY_REACH, SLIDE_PASSES, SUPPORT_PROBE } from './collide';

export const WALK_SPEED = 4;
export const SPRINT_SPEED = 7;
export const JUMP_SPEED = 6.8;
export const GRAVITY = 20;
export const FALL_SPEED = 30;

/**
 * The one movement law, run by the room and by client prediction at `WALK_HZ`. Fixed dt, no clocks, randomness,
 * trigonometry or hidden history: the state, the input and the immutable collision revision decide the result.
 * Feet sit at y. Only `Math.sqrt` and IEEE arithmetic are used, so Node and every browser agree bit for bit.
 *
 * Order per tick: refuse a mismatched revision (the walker holds still, unknown solids never become air);
 * push an embedded body out within a bounded reach or hold it still; set walk velocity; jump only from support;
 * sweep the body vertically; slide it horizontally by swept time of impact; then read support at the end
 * position. `distance` grows by actual horizontal travel, sliding included, recovery excluded.
 */
export function stepPlayer(s: PlayerState, input: Readonly<WalkInput>, dt: number, world: CollisionWorld): void {
  if (!(dt > 0 && dt <= .1) || input.collisionRevision !== world.revision || s.collisionRevision !== world.revision) return;
  // A body still inside solids after bounded recovery stays put; `bodyStuck` lets the adapter request placement.
  if (!recoverBody(s, world)) { s.vx = 0; s.vy = 0; s.vz = 0; return; }
  const length = Math.max(127, Math.sqrt(input.moveX * input.moveX + input.moveZ * input.moveZ));
  const speed = input.buttons & WALK_BUTTON.sprint ? SPRINT_SPEED : WALK_SPEED;
  s.vx = input.moveX / length * speed; s.vz = input.moveZ / length * speed;
  s.yaw = input.yaw;
  if ((input.buttons & WALK_BUTTON.jump) && s.grounded) s.vy = JUMP_SPEED;
  s.vy = Math.max(-FALL_SPEED, s.vy - GRAVITY * dt);
  // Stable Y/X/Z order: vertical first, so floor seams never read as walls; then X before Z on an exact tie.
  if (sweepVertical(s, s.vy * dt, world)) s.vy = 0;
  const beforeX = s.x, beforeZ = s.z;
  const slide = slideHorizontal(s, s.vx * dt, s.vz * dt, world);
  if (slide.blockedX) s.vx = 0;
  if (slide.blockedZ) s.vz = 0;
  s.grounded = s.vy <= 0 && supported(s, world);
  const mx = s.x - beforeX, mz = s.z - beforeZ;
  s.distance += Math.sqrt(mx * mx + mz * mz);
}
