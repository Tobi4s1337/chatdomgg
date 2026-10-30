import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';
import type { Vec3 } from './shoulder';

/**
 * Keeping the walking camera out of the kingdom's solids. The camera is not a point: what must stay clear is
 * the eye together with the rectangle of the near plane in front of it, at the actual field of view, aspect and
 * lens shift. That small pyramid is enclosed in an axis-aligned box (the solids are boxes too) and swept along
 * the drawn boom curve from the citizen's own head, which the body already keeps clear, out to where the wheel
 * wants the camera. The first touch is how far the camera may stand. Pulled in, the camera is exactly where the
 * wheel would have put it, so a short boom is the same over-the-shoulder view. Presentation only: nothing here
 * feeds back into the shared step.
 */
export const OCCLUSION = {
  /** Air kept between any solid and the eye or near plane, in metres. Absorbs the bend of the boom curve. */
  margin: .05,
  /** The boom curve is swept as straight pieces no longer than this. */
  segment: .25,
  /** Once clear again the camera eases back out over about this many seconds (95 %). */
  recoverSeconds: .35,
} as const;

/** Exponential rate reaching 95 % of the way out in `recoverSeconds`. */
export const RECOVER_RATE = 3 / OCCLUSION.recoverSeconds;

/** Box around the eye and the near-plane rectangle, as offsets from the eye. */
export interface Footprint { readonly min: Vec3; readonly max: Vec3 }
/** One point of the boom curve: drawn at `distance`, eye at `eye`, enclosing `footprint`. */
export interface BoomPoint { readonly distance: number; readonly eye: Vec3; readonly footprint: Footprint }
export interface Clearance {
  /** Longest boom, up to the wish, that keeps the eye and near plane out of every solid. */
  readonly distance: number;
  /** The boom met a solid before the wish. */
  readonly occluded: boolean;
  /**
   * The lagging camera height carried the boom's root out of the body into a solid: the camera must stand on
   * the actual head this frame (`distance` is then 0).
   */
  readonly settle: boolean;
}
/**
 * The near-plane footprint for a camera looking along `direction` (unit, zero roll) with vertical `fov` degrees,
 * `aspect`, lens `shift` (fraction of the half-width, as `filmOffsetFor` applies it) and `near` metres.
 */
export function nearFootprint(direction: Vec3, fov: number, aspect: number, shift: number, near: number, margin: number = OCCLUSION.margin): Footprint {
  const [fx, fy, fz] = direction;
  const flat = Math.sqrt(fx * fx + fz * fz) || 1;
  // Camera right for a level horizon, and camera up = right × forward.
  const rx = -fz / flat, rz = fx / flat;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const halfH = near * Math.tan(fov * Math.PI / 360), halfW = halfH * aspect;
  const min: [number, number, number] = [0, 0, 0], max: [number, number, number] = [0, 0, 0];
  for (const sx of [(-1 + shift) * halfW, (1 + shift) * halfW]) for (const sy of [-halfH, halfH]) {
    const corner = [near * fx + sx * rx + sy * ux, near * fy + sy * uy, near * fz + sx * rz + sy * uz];
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, corner[axis]!);
      max[axis] = Math.max(max[axis]!, corner[axis]!);
    }
  }
  return { min: [min[0] - margin, min[1] - margin, min[2] - margin], max: [max[0] + margin, max[1] + margin, max[2] + margin] };
}

function union(a: Footprint, b: Footprint): Footprint {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** True when the footprint at `eye` is inside `solid` by more than touching. */
export function overlapsSolid(eye: Vec3, footprint: Footprint, solid: SolidBox): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if (eye[axis]! + footprint.max[axis]! <= solid.min[axis]! || eye[axis]! + footprint.min[axis]! >= solid.max[axis]!) return false;
  }
  return true;
}

/**
 * Fraction of the straight move `from` → `to` at which a box with `footprint` first enters `solid`; 0 when it
 * starts inside, Infinity when it never does. Touching faces do not count.
 */
export function sweepHit(from: Vec3, to: Vec3, footprint: Footprint, solid: SolidBox): number {
  let enter = 0, leave = 1;
  for (let axis = 0; axis < 3; axis++) {
    // Eye positions on this axis where the box overlaps the solid: the open interval (low, high).
    const low = solid.min[axis]! - footprint.max[axis]!, high = solid.max[axis]! - footprint.min[axis]!;
    const start = from[axis]!, travel = to[axis]! - start;
    if (Math.abs(travel) < 1e-12) {
      if (start <= low || start >= high) return Infinity;
      continue;
    }
    let a = (low - start) / travel, b = (high - start) / travel;
    if (a > b) [a, b] = [b, a];
    enter = Math.max(enter, a); leave = Math.min(leave, b);
    if (enter >= leave) return Infinity;
  }
  return enter;
}

/**
 * How far the camera may stand this frame. `at(d)` places the camera for boom length `d` (the drawn curve,
 * including the eased camera height); `anchor` is the same camera on the citizen's actual head. The path
 * anchor → at(0) → … → at(wish) is swept in pieces of at most `OCCLUSION.segment` against one query of the
 * supplied world. A hit inside a piece is checked once more on the exact curve; if that check fails the piece's
 * start, already swept clear, is used. Deterministic and bounded: `ceil(wish / segment) + 1` pieces, one query.
 */
export function clearBoom(world: CollisionWorld, anchor: BoomPoint, at: (distance: number) => BoomPoint, wish: number): Clearance {
  const reach = Math.max(0, Number.isFinite(wish) ? wish : 0);
  const pieces = Math.max(1, Math.ceil(reach / OCCLUSION.segment - 1e-9));
  const path: BoomPoint[] = [anchor];
  for (let n = 0; n <= pieces; n++) path.push(at(reach * n / pieces));
  // One query around the whole path, padded so the exact curve between chord points is covered too.
  const pad = OCCLUSION.margin;
  const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const { eye, footprint } of path) for (let axis = 0; axis < 3; axis++) {
    lo[axis] = Math.min(lo[axis]!, eye[axis]! + footprint.min[axis]! - pad);
    hi[axis] = Math.max(hi[axis]!, eye[axis]! + footprint.max[axis]! + pad);
  }
  const solids = world.query({ min: lo, max: hi });
  const clear = { distance: reach, occluded: false, settle: false };
  if (!solids.length) return clear;
  if (solids.some(solid => overlapsSolid(anchor.eye, anchor.footprint, solid))) return { distance: 0, occluded: true, settle: true };
  for (let n = 0; n + 1 < path.length; n++) {
    const a = path[n]!, b = path[n + 1]!, footprint = union(a.footprint, b.footprint);
    let t = Infinity;
    for (const solid of solids) t = Math.min(t, sweepHit(a.eye, b.eye, footprint, solid));
    if (t > 1) continue;
    // The first piece only carries the root from the actual head to the eased camera height.
    if (n === 0) return { distance: 0, occluded: true, settle: true };
    const distance = a.distance + (b.distance - a.distance) * t;
    const exact = at(distance), half = OCCLUSION.margin / 2;
    const tight: Footprint = {
      min: [exact.footprint.min[0] + half, exact.footprint.min[1] + half, exact.footprint.min[2] + half],
      max: [exact.footprint.max[0] - half, exact.footprint.max[1] - half, exact.footprint.max[2] - half],
    };
    const safe = !solids.some(solid => overlapsSolid(exact.eye, tight, solid));
    return { distance: safe ? distance : a.distance, occluded: true, settle: false };
  }
  return clear;
}
