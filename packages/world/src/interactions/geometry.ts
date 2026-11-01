import { WALK_BODY, type CollisionWorld, type SolidBox } from '@chatdom/shared/realm';
import type { Vec3 } from '@chatdom/shared';

/**
 * Read-only questions asked of the one immutable collision revision. These never move a body: movement and
 * recovery stay with the movement owner. Boxes that merely touch a probe do not count as overlap.
 */
const TOUCH = 1e-6;
/** Query boxes are padded by this much so none is ever empty. */
const QUERY_PAD = 1e-4;
/** Feet may rest up to this far above the supporting top (float drift after a sweep), never below it. */
export const SUPPORT_GAP = .05;
/** The eye height used for every reach/occlusion question, on both ends of the wire. */
export const INTERACTION_EYE = 1.55;

function overlaps(a: SolidBox, b: SolidBox): boolean {
  return a.min[0] < b.max[0] - TOUCH && a.max[0] > b.min[0] + TOUCH
    && a.min[1] < b.max[1] - TOUCH && a.max[1] > b.min[1] + TOUCH
    && a.min[2] < b.max[2] - TOUCH && a.max[2] > b.min[2] + TOUCH;
}
function contains(box: SolidBox, point: Vec3): boolean {
  return point.every((n, axis) => n >= box.min[axis]! - TOUCH && n <= box.max[axis]! + TOUCH);
}
export function finiteVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n));
}

/** The full walking body standing with feet at `feet`. */
export function bodyBox(feet: Vec3, body: { readonly radius: number; readonly height: number } = WALK_BODY): SolidBox {
  return { min: [feet[0] - body.radius, feet[1], feet[2] - body.radius], max: [feet[0] + body.radius, feet[1] + body.height, feet[2] + body.radius] };
}
/** No solid intersects the whole standing body. */
export function bodyClear(world: CollisionWorld, feet: Vec3): boolean {
  if (!finiteVec3(feet)) return false;
  const probe = bodyBox(feet);
  return !world.query(probe).some(box => overlaps(box, probe));
}
/** A solid top lies within SUPPORT_GAP under the body footprint. */
export function supported(world: CollisionWorld, feet: Vec3): boolean {
  if (!finiteVec3(feet)) return false;
  const r = WALK_BODY.radius;
  const probe: SolidBox = { min: [feet[0] - r, feet[1] - SUPPORT_GAP, feet[2] - r], max: [feet[0] + r, feet[1] + TOUCH, feet[2] + r] };
  return world.query(probe).some(box => box.max[1] <= feet[1] + TOUCH && box.max[1] >= feet[1] - SUPPORT_GAP
    && box.min[0] < probe.max[0] - TOUCH && box.max[0] > probe.min[0] + TOUCH && box.min[2] < probe.max[2] - TOUCH && box.max[2] > probe.min[2] + TOUCH);
}
/** A place a body may be put: supported and full-body clear at this revision. */
export function standingClear(world: CollisionWorld, feet: Vec3): boolean {
  return bodyClear(world, feet) && supported(world, feet);
}

/**
 * True when the straight segment from `from` to `to` passes through no solid. A box that contains `to` is the
 * target's own body (a log, an anvil, a closed door leaf) and does not hide itself; any other box does.
 */
export function segmentClear(world: CollisionWorld, from: Vec3, to: Vec3): boolean {
  if (!finiteVec3(from) || !finiteVec3(to)) return false;
  // Padded so a segment along an axis (eye straight at a door) is still a box with volume: the collision compiler
  // refuses an empty query rather than answering it.
  const bounds: SolidBox = { min: [Math.min(from[0], to[0]) - QUERY_PAD, Math.min(from[1], to[1]) - QUERY_PAD, Math.min(from[2], to[2]) - QUERY_PAD], max: [Math.max(from[0], to[0]) + QUERY_PAD, Math.max(from[1], to[1]) + QUERY_PAD, Math.max(from[2], to[2]) + QUERY_PAD] };
  for (const box of world.query(bounds)) {
    if (contains(box, to)) continue;
    if (segmentHitsBox(from, to, box)) return false;
  }
  return true;
}
/** Slab test on the open interior of the box, so grazing a face is not an occlusion. */
function segmentHitsBox(from: Vec3, to: Vec3, box: SolidBox): boolean {
  let enter = 0, leave = 1;
  for (let axis = 0; axis < 3; axis++) {
    const origin = from[axis]!, delta = to[axis]! - origin, min = box.min[axis]! + TOUCH, max = box.max[axis]! - TOUCH;
    if (Math.abs(delta) < 1e-12) { if (origin <= min || origin >= max) return false; continue; }
    let a = (min - origin) / delta, b = (max - origin) / delta;
    if (a > b) [a, b] = [b, a];
    enter = Math.max(enter, a); leave = Math.min(leave, b);
    if (enter >= leave) return false;
  }
  return true;
}

export function eyeOf(feet: Vec3): Vec3 { return [feet[0], feet[1] + INTERACTION_EYE, feet[2]]; }
export function horizontalDistance(a: Vec3, b: Vec3): number { return Math.hypot(a[0] - b[0], a[2] - b[2]); }

/**
 * Physical reach, judged from authoritative feet: horizontal distance to the target point within `reach`, the
 * target no more than a body height above or below the feet, and an unoccluded line from the eye.
 */
export function withinReach(world: CollisionWorld, feet: Vec3, target: { readonly position: Vec3; readonly reach: number }): boolean {
  if (!finiteVec3(feet) || !finiteVec3(target.position) || !(target.reach > 0)) return false;
  if (horizontalDistance(feet, target.position) > target.reach) return false;
  if (Math.abs(target.position[1] - feet[1]) > WALK_BODY.height) return false;
  return segmentClear(world, eyeOf(feet), target.position);
}
