import { WALK_BODY, WALK_BUTTON, type CollisionWorld, type PlayerState, type SolidBox, type WalkInput } from '@chatdom/shared/realm';

/**
 * Shared reference integrator. Fixed dt, no clocks/random/trig, feet at y. Full grounded auto-step and
 * simultaneous-contact refinement are the walk-controller lane's extension of this exact boundary.
 * Axis sweeps already prevent tunnelling through thin solid boxes, including at a low render rate.
 */
export function stepPlayer(s: PlayerState, input: Readonly<WalkInput>, dt: number, world: CollisionWorld): void {
  if (!(dt > 0 && dt <= .1) || input.collisionRevision !== world.revision || s.collisionRevision !== world.revision) return;
  const length = Math.max(127, Math.hypot(input.moveX, input.moveZ));
  const speed = input.buttons & WALK_BUTTON.sprint ? 7 : 4;
  s.vx = input.moveX / length * speed; s.vz = input.moveZ / length * speed;
  s.yaw = input.yaw;
  if ((input.buttons & WALK_BUTTON.jump) && s.grounded) s.vy = 6.8;
  s.vy = Math.max(-30, s.vy - 20 * dt);
  const beforeX = s.x, beforeZ = s.z;
  // Stable Y/X/Z tie order. Collision boxes use world metres and resolve air before reaching this step.
  const vertical = sweepAxis(s, s.vy * dt, 1, world);
  s.grounded = vertical && s.vy < 0;
  if (vertical) s.vy = 0;
  if (sweepAxis(s, s.vx * dt, 0, world)) s.vx = 0;
  if (sweepAxis(s, s.vz * dt, 2, world)) s.vz = 0;
  s.distance += Math.hypot(s.x - beforeX, s.z - beforeZ);
}

function body(s: PlayerState): { min: [number, number, number]; max: [number, number, number] } {
  return { min: [s.x - WALK_BODY.radius, s.y, s.z - WALK_BODY.radius], max: [s.x + WALK_BODY.radius, s.y + WALK_BODY.height, s.z + WALK_BODY.radius] };
}
function sweepAxis(s: PlayerState, delta: number, axis: 0 | 1 | 2, world: CollisionWorld): boolean {
  if (delta === 0) return false;
  const a = body(s);
  const bounds: SolidBox = { min: [...a.min], max: [...a.max] };
  (bounds.min as [number, number, number])[axis] += Math.min(0, delta);
  (bounds.max as [number, number, number])[axis] += Math.max(0, delta);
  let allowed = delta;
  for (const b of world.query(bounds)) {
    const others = [0, 1, 2].filter(n => n !== axis);
    if (!others.every(n => a.max[n]! > b.min[n]! + 1e-9 && a.min[n]! < b.max[n]! - 1e-9)) continue;
    if (delta > 0 && a.max[axis] <= b.min[axis] + 1e-9) allowed = Math.min(allowed, Math.max(0, b.min[axis] - a.max[axis]));
    if (delta < 0 && a.min[axis] >= b.max[axis] - 1e-9) allowed = Math.max(allowed, Math.min(0, b.max[axis] - a.min[axis]));
  }
  if (axis === 0) s.x += allowed;
  else if (axis === 1) s.y += allowed;
  else s.z += allowed;
  return allowed !== delta;
}
