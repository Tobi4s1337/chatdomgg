import { WALK_BODY, type CollisionWorld, type PlayerState, type SolidBox } from '@chatdom/shared/realm';

/**
 * Contact tolerance in world metres. Faces closer than this count as touching, never as overlapping, so a body
 * resting on a floor or pressed against a wall slides along seams between neighbouring solids without snagging.
 */
export const CONTACT_EPSILON = 1e-9;
/**
 * Horizontal slide passes per tick. Every pass either finishes the remaining travel or permanently blocks at
 * least one of the two horizontal axes, so two blocking passes plus one free pass always terminate, including
 * zero-time hits in an inside corner.
 */
export const SLIDE_PASSES = 3;
/** Furthest an embedded body is pushed out of solids (a closed door, a part placed on someone, a bad spawn). */
export const RECOVERY_REACH = 1;
/** A support face may sit this far below the feet and still carry the body. */
export const SUPPORT_PROBE = 1e-6;

type Axis = 0 | 1 | 2;
type Vec = [number, number, number];
interface Bounds { readonly min: Vec; readonly max: Vec }

/** Push-out order on equal distances: up first (a block placed under someone), then -X, +X, -Z, +Z, down. */
const RECOVERY_DIRECTIONS: readonly (readonly [Axis, 1 | -1])[] = [[1, 1], [0, -1], [0, 1], [2, -1], [2, 1], [1, -1]];

export function bodyBounds(s: Pick<PlayerState, 'x' | 'y' | 'z'>): Bounds {
  const r = WALK_BODY.radius;
  return { min: [s.x - r, s.y, s.z - r], max: [s.x + r, s.y + WALK_BODY.height, s.z + r] };
}

function overlapsOn(a: Bounds, b: SolidBox, axis: Axis): boolean {
  return a.max[axis] > b.min[axis]! + CONTACT_EPSILON && a.min[axis] < b.max[axis]! - CONTACT_EPSILON;
}
function overlaps(a: Bounds, b: SolidBox): boolean {
  return overlapsOn(a, b, 0) && overlapsOn(a, b, 1) && overlapsOn(a, b, 2);
}

/** Solids the body volume is inside of by more than the contact tolerance, in the world's stable order. */
export function embeddedSolids(s: Pick<PlayerState, 'x' | 'y' | 'z'>, world: CollisionWorld): readonly SolidBox[] {
  const a = bodyBounds(s);
  return world.query(a).filter(b => overlaps(a, b));
}

/**
 * True while the body cannot be pushed free within `RECOVERY_REACH` without crossing another solid. `stepPlayer`
 * then holds the walker still; the room adapter uses this to ask authority for a placement.
 */
export function bodyStuck(s: Pick<PlayerState, 'x' | 'y' | 'z'>, world: CollisionWorld): boolean {
  return embeddedSolids(s, world).length > 0 && !recoveryTarget(s, world);
}

/**
 * Bounded, deterministic overlap recovery. Each of six axis directions pushes just far enough to clear every
 * solid the body is currently inside; a direction is valid only within `RECOVERY_REACH` and when the swept
 * path touches no solid the body was not already inside, so recovery never carries anyone through a wall.
 * The shortest valid push wins; equal pushes follow `RECOVERY_DIRECTIONS`.
 */
function recoveryTarget(s: Pick<PlayerState, 'x' | 'y' | 'z'>, world: CollisionWorld): { axis: Axis; dir: 1 | -1; to: number } | null {
  const a = bodyBounds(s);
  const inside = world.query(a).filter(b => overlaps(a, b));
  if (!inside.length) return null;
  const position: Vec = [s.x, s.y, s.z];
  let best: { axis: Axis; dir: 1 | -1; to: number; travel: number } | null = null;
  for (const [axis, dir] of RECOVERY_DIRECTIONS) {
    // Position along this axis where the body face just touches the far side of every solid it is inside.
    const offset = axis === 1 ? (dir > 0 ? 0 : WALK_BODY.height) : WALK_BODY.radius;
    let to = position[axis];
    for (const b of inside) to = dir > 0 ? Math.max(to, b.max[axis]! + offset) : Math.min(to, b.min[axis]! - offset);
    const travel = Math.abs(to - position[axis]);
    if (travel > RECOVERY_REACH || (best && travel >= best.travel)) continue;
    const swept: Bounds = { min: [...a.min], max: [...a.max] };
    if (dir > 0) swept.max[axis] += travel; else swept.min[axis] -= travel;
    if (world.query(swept).some(b => overlaps(swept, b) && !overlaps(a, b))) continue;
    best = { axis, dir, to, travel };
  }
  return best;
}

/** Returns false when the body is embedded and no bounded recovery exists. Recovery is not walked distance. */
export function recoverBody(s: PlayerState, world: CollisionWorld): boolean {
  if (!embeddedSolids(s, world).length) return true;
  const target = recoveryTarget(s, world);
  if (!target) return false;
  if (target.axis === 0) { s.x = target.to; if (s.vx * target.dir < 0) s.vx = 0; }
  else if (target.axis === 1) { s.y = target.to; if (s.vy * target.dir < 0) s.vy = 0; }
  else { s.z = target.to; if (s.vz * target.dir < 0) s.vz = 0; }
  return true;
}

/**
 * Vertical sweep of the whole body. Lands exactly on the highest face below or stops under the lowest face
 * above. Returns true when the travel was cut short.
 */
export function sweepVertical(s: PlayerState, dy: number, world: CollisionWorld): boolean {
  if (dy === 0) return false;
  const a = bodyBounds(s);
  const swept: Bounds = { min: [...a.min], max: [...a.max] };
  if (dy < 0) swept.min[1] += dy; else swept.max[1] += dy;
  let y = s.y + dy;
  for (const b of world.query(swept)) {
    if (!overlapsOn(a, b, 0) || !overlapsOn(a, b, 2)) continue;
    if (dy < 0 && a.min[1] >= b.max[1]! - CONTACT_EPSILON) y = Math.max(y, Math.min(s.y, b.max[1]!));
    if (dy > 0 && a.max[1] <= b.min[1]! + CONTACT_EPSILON) y = Math.min(y, Math.max(s.y, b.min[1]! - WALK_BODY.height));
  }
  const blocked = y !== s.y + dy;
  s.y = y;
  return blocked;
}

/** Time interval during which the body overlaps `b` along one axis while travelling `d`; null if never. */
function axisWindow(a: Bounds, b: SolidBox, axis: Axis, d: number): readonly [number, number] | null {
  if (d > 0) {
    if (a.max[axis] <= b.min[axis]! + CONTACT_EPSILON) return [Math.max(0, b.min[axis]! - a.max[axis]) / d, (b.max[axis]! - a.min[axis]) / d];
    if (a.min[axis] >= b.max[axis]! - CONTACT_EPSILON) return null;
    return [-Infinity, (b.max[axis]! - a.min[axis]) / d];
  }
  if (d < 0) {
    if (a.min[axis] >= b.max[axis]! - CONTACT_EPSILON) return [Math.max(0, a.min[axis] - b.max[axis]!) / -d, (a.max[axis] - b.min[axis]!) / -d];
    if (a.max[axis] <= b.min[axis]! + CONTACT_EPSILON) return null;
    return [-Infinity, (a.max[axis] - b.min[axis]!) / -d];
  }
  return overlapsOn(a, b, axis) ? [-Infinity, Infinity] : null;
}

export interface SlideResult { blockedX: boolean; blockedZ: boolean }

/**
 * Horizontal swept-box slide. Each pass finds the earliest time of impact of the whole body over the remaining
 * diagonal travel, moves there, and zeroes the blocked axis; the other axis keeps only its own remaining travel,
 * so sliding never gains speed. One solid blocks the axis that entered last (X on an exact edge tie, after the
 * shared Y/X/Z order); solids hit at the same instant block together. Contacts snap to the solid's face, and the
 * result does not depend on the order `query` returns solids in.
 */
export function slideHorizontal(s: PlayerState, dx: number, dz: number, world: CollisionWorld): SlideResult {
  const result: SlideResult = { blockedX: false, blockedZ: false };
  const r = WALK_BODY.radius;
  for (let pass = 0; pass < SLIDE_PASSES && (dx !== 0 || dz !== 0); pass++) {
    const a = bodyBounds(s);
    const swept: Bounds = {
      min: [a.min[0] + Math.min(0, dx), a.min[1], a.min[2] + Math.min(0, dz)],
      max: [a.max[0] + Math.max(0, dx), a.max[1], a.max[2] + Math.max(0, dz)],
    };
    let first = 1, hitX = false, hitZ = false, faceX = dx > 0 ? Infinity : -Infinity, faceZ = dz > 0 ? Infinity : -Infinity;
    for (const b of world.query(swept)) {
      if (!overlapsOn(a, b, 1)) continue;
      const wx = axisWindow(a, b, 0, dx), wz = wx && axisWindow(a, b, 2, dz);
      if (!wx || !wz) continue;
      const enter = Math.max(wx[0], wz[0]), exit = Math.min(wx[1], wz[1]);
      // Already inside on both axes: recovery owns embedded solids, the slide lets the body leave them.
      if (enter === -Infinity || enter >= exit || enter > first) continue;
      if (enter < first) { first = enter; hitX = false; hitZ = false; faceX = dx > 0 ? Infinity : -Infinity; faceZ = dz > 0 ? Infinity : -Infinity; }
      if (wx[0] >= wz[0]) { hitX = true; faceX = dx > 0 ? Math.min(faceX, b.min[0]! - r) : Math.max(faceX, b.max[0]! + r); }
      else { hitZ = true; faceZ = dz > 0 ? Math.min(faceZ, b.min[2]! - r) : Math.max(faceZ, b.max[2]! + r); }
    }
    if (!hitX && !hitZ) { s.x += dx; s.z += dz; break; }
    s.x = hitX ? faceX : s.x + dx * first;
    s.z = hitZ ? faceZ : s.z + dz * first;
    dx = hitX ? 0 : dx * (1 - first);
    dz = hitZ ? 0 : dz * (1 - first);
    result.blockedX ||= hitX; result.blockedZ ||= hitZ;
  }
  return result;
}

/** Highest obstacle a grounded walker climbs without jumping: one terrain voxel. */
export const STEP_HEIGHT = WALK_BODY.stepHeight;
/**
 * A step is only climbed when the intended direction carries into it: the component across the obstacle's face
 * must be at least 1/`STEP_GRAZE` of the component along it (about 14 degrees). Skimming a ledge slides past it.
 */
export const STEP_GRAZE = 4;
/**
 * The tread must carry the body's centre this far past the obstacle face, at most one step below the landing and
 * with no taller solid there. A rail or kerb with a drop or a wall right behind it is not a landing.
 */
export const STEP_LANDING = .2;
/** A climb must gain this much more travel along the intended path than the ordinary slide, per metre of travel. */
export const STEP_PROGRESS = 1e-3;

/**
 * Lowest rise that clears every low obstacle on the horizontal path from the current position: the highest solid
 * top above the feet and within `STEP_HEIGHT`, among solids the swept body actually meets this tick. 0 if none.
 */
function stepRise(s: PlayerState, dx: number, dz: number, world: CollisionWorld): number {
  const a = bodyBounds(s);
  const swept: Bounds = {
    min: [a.min[0] + Math.min(0, dx), s.y, a.min[2] + Math.min(0, dz)],
    max: [a.max[0] + Math.max(0, dx), s.y + STEP_HEIGHT, a.max[2] + Math.max(0, dz)],
  };
  let top = s.y;
  for (const b of world.query(swept)) {
    const t = b.max[1]!;
    if (t <= s.y + CONTACT_EPSILON || t > s.y + STEP_HEIGHT + CONTACT_EPSILON || t <= top) continue;
    const wx = axisWindow(a, b, 0, dx), wz = wx && axisWindow(a, b, 2, dz);
    if (!wx || !wz || Math.max(wx[0], wz[0]) >= Math.min(wx[1], wz[1], 1)) continue;
    top = t;
  }
  return top - s.y;
}

/**
 * The tread test at (x, z): a solid top no lower than one step under the landing height `y`, and nothing that
 * rises above `y` at that point.
 */
function treadAt(x: number, y: number, z: number, world: CollisionWorld): boolean {
  let tread = false;
  for (const b of world.query({
    // Collision broad phases may use strict intersections or reject empty bounds. A point-shaped query can
    // disappear at a cell boundary even when a broad slab really supports this tread. Probe a finite volume;
    // the exact point/height checks below still decide whether the landing is valid.
    min: [x - SUPPORT_PROBE, y - STEP_HEIGHT - SUPPORT_PROBE, z - SUPPORT_PROBE],
    max: [x + SUPPORT_PROBE, y + SUPPORT_PROBE, z + SUPPORT_PROBE],
  })) {
    if (x < b.min[0]! || x > b.max[0]! || z < b.min[2]! || z > b.max[2]!) continue;
    if (b.max[1]! > y + CONTACT_EPSILON) return false;
    if (b.max[1]! >= y - STEP_HEIGHT - CONTACT_EPSILON) tread = true;
  }
  return tread;
}

/**
 * Grounded horizontal move with a supported auto-step. The ordinary slide runs first. Only when it was blocked,
 * and the intended direction (`ix`, `iz`, the walker's target velocity) pushes into the blocked face rather than
 * grazing it, a trial runs from the original position: rise exactly to the lowest height that clears the low
 * obstacles on the path (headroom swept, as far as a ceiling allows), replay the whole horizontal travel, settle
 * down onto support, then require more progress along the path than the slide and a tread for the body's centre
 * past the face. A long catch-up tick may carry the body over a thin sill entirely; it then settles beyond it.
 * Every move is a full-body sweep, so the committed body is never inside a solid. A rejected trial leaves the
 * ordinary slide untouched.
 */
export function slideOrStep(s: PlayerState, dx: number, dz: number, ix: number, iz: number, world: CollisionWorld): SlideResult {
  const x0 = s.x, y0 = s.y, z0 = s.z;
  const slide = slideHorizontal(s, dx, dz, world);
  if (!slide.blockedX && !slide.blockedZ || ix * dx + iz * dz <= 0) return slide;
  const climbX = slide.blockedX && ix !== 0 && Math.abs(ix) * STEP_GRAZE >= Math.abs(iz);
  const climbZ = slide.blockedZ && iz !== 0 && Math.abs(iz) * STEP_GRAZE >= Math.abs(ix);
  if (!climbX && !climbZ) return slide;
  const trial: PlayerState = { ...s, x: x0, y: y0, z: z0 };
  const rise = stepRise(trial, dx, dz, world);
  if (rise <= 0) return slide;
  // A ceiling may cut the rise short; the replayed travel then only clears what fits under it.
  sweepVertical(trial, rise, world);
  const climbed = slideHorizontal(trial, dx, dz, world);
  sweepVertical(trial, y0 - trial.y, world);
  // Settling never goes below the start, and the rise never exceeds `STEP_HEIGHT`: only support is left to check.
  if (!supported(trial, world)) return slide;
  const travel = Math.sqrt(dx * dx + dz * dz);
  const gained = (trial.x - x0) * dx + (trial.z - z0) * dz - ((s.x - x0) * dx + (s.z - z0) * dz);
  if (!(gained > STEP_PROGRESS * travel * travel)) return slide;
  const reach = WALK_BODY.radius + STEP_LANDING;
  const px = s.x + (slide.blockedX ? (dx > 0 ? reach : -reach) : 0), pz = s.z + (slide.blockedZ ? (dz > 0 ? reach : -reach) : 0);
  if (!treadAt(px, trial.y, pz, world)) return slide;
  s.x = trial.x; s.y = trial.y; s.z = trial.z;
  return climbed;
}

/**
 * Keeps a walker on the ground down a step: a body that was supported, is not rising and has walked off an edge
 * drops straight onto support within `STEP_HEIGHT` below. A deeper drop is a fall and the body stays put to fall.
 */
export function stepDown(s: PlayerState, world: CollisionWorld): boolean {
  const y = s.y;
  sweepVertical(s, -STEP_HEIGHT, world);
  if (supported(s, world)) return true;
  s.y = y;
  return false;
}

/** A solid top within `SUPPORT_PROBE` below the feet, overlapping the footprint, carries the body. */
export function supported(s: Pick<PlayerState, 'x' | 'y' | 'z'>, world: CollisionWorld): boolean {
  const a = bodyBounds(s);
  const probe: Bounds = { min: [a.min[0], s.y - SUPPORT_PROBE, a.min[2]], max: [a.max[0], s.y, a.max[2]] };
  return world.query(probe).some(b => b.max[1]! >= s.y - SUPPORT_PROBE && b.max[1]! <= s.y + CONTACT_EPSILON
    && overlapsOn(a, b, 0) && overlapsOn(a, b, 2));
}
