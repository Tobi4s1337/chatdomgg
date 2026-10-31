import type { Vec3 } from '@chatdom/shared';
import type { WaterBody, XZ } from '@chatdom/world';
import type { PlacedWalk } from '../../../../../../packages/world/src/places/water/anchors';
import type { WaterReach } from '../../../../../../packages/world/src/places/water/reaches';
import type { WaterAt } from '../surface/coverage';
import type { WaterContact } from '../surface/surface';

/**
 * Where the water's creatures may be, read only from what the caller supplies: its still bodies, the quiet runs of
 * its courses, its real water query, the solids standing in the water and the place's walking surfaces. Nothing
 * here routes water, moves a site or puts a creature where a person walks.
 */
export interface Habitat {
  readonly waterAt: (x: number, z: number) => WaterAt | null;
  readonly bodies: readonly WaterBody[];
  readonly reaches: readonly WaterReach[];
  readonly obstacles: readonly WaterContact[];
  readonly walks: readonly PlacedWalk[];
}

/** A stretch of quiet water: a whole basin, or a run of a course whose flow reads as still (a bridge pool). */
export interface StillWater {
  readonly id: string;
  readonly centre: XZ;
  /** Semi-axes along and across `angle`, metres. */
  readonly axes: readonly [number, number];
  /** Bearing of the first axis, radians from +X toward +Z. */
  readonly angle: number;
  readonly level: number;
  readonly area: number;
}

/** A still run shorter than this is a slack edge, not a pool a pair of ducks could live on. */
export const STILL_RUN_MIN = 5;

/** The still waters, basins first, each in the order supplied. */
export function stillWaters(bodies: readonly WaterBody[], reaches: readonly WaterReach[]): StillWater[] {
  const out: StillWater[] = bodies.map(b => ({ id: b.id, centre: [b.x, b.z], axes: [b.radiusX, b.radiusZ], angle: 0, level: b.level, area: Math.PI * b.radiusX * b.radiusZ }));
  for (const reach of reaches) {
    let start = -1;
    const close = (end: number) => {
      const run = reach.points.slice(start, end), first = run[0]!, last = run.at(-1)!;
      const length = last.s - first.s;
      if (length >= STILL_RUN_MIN) {
        const width = run.reduce((sum, p) => sum + p.width, 0) / run.length;
        const level = run.reduce((sum, p) => sum + p.level, 0) / run.length;
        const centre: XZ = [(first.position[0] + last.position[0]) / 2, (first.position[1] + last.position[1]) / 2];
        out.push({ id: `${reach.id}:pool:${out.length}`, centre, axes: [length / 2, width / 2], angle: Math.atan2(last.position[1] - first.position[1], last.position[0] - first.position[0]), level, area: Math.PI * (length / 2) * (width / 2) });
      }
      start = -1;
    };
    reach.points.forEach((p, i) => { if (p.still && start < 0) start = i; if (!p.still && start >= 0) close(i); });
    if (start >= 0) close(reach.points.length);
  }
  return out;
}

/** A local point of a still water (`u`,`v` in its unit disc) in world x/z. */
export function inStill(water: StillWater, u: number, v: number): XZ {
  const c = Math.cos(water.angle), s = Math.sin(water.angle), a = u * water.axes[0], b = v * water.axes[1];
  return [water.centre[0] + a * c - b * s, water.centre[1] + a * s + b * c];
}

/** Distance from a point to a contact (its point, or its segment), minus its own half width. */
export function contactGap(contact: WaterContact, x: number, z: number): number {
  const [ax, az] = contact.a, [bx, bz] = contact.b ?? contact.a;
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t)) - contact.radius;
}

/** Head room a creature needs under a walking surface, and the height over one that counts as being on it. */
export const UNDER_WALK = 1.1;
export const OVER_WALK = 2.4;
/** Extra margin beside a walk's clear width. */
const WALK_MARGIN = 0.2;

/**
 * Whether a point is on, at or just under a walking surface: within the strip's width (plus a margin) of its
 * centreline, from `UNDER_WALK` below its top to `OVER_WALK` above it. Creatures and floaters never stand there.
 */
export function onWalk(walks: readonly PlacedWalk[], p: Vec3): boolean {
  for (const walk of walks) {
    const pts = walk.points.length > 1 ? walk.points : [walk.ends[0], walk.ends[1]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      const dx = b[0] - a[0], dz = b[2] - a[2], l2 = dx * dx + dz * dz;
      // Each centreline sample covers its own cell column; extend the segment by half a cell at both ends.
      const t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / l2 : 0;
      const pad = l2 > 0 ? 0.0625 / Math.sqrt(l2) : 0;
      if (t < -pad || t > 1 + pad) continue;
      const k = Math.min(1, Math.max(0, t));
      const lateral = Math.hypot(p[0] - (a[0] + dx * k), p[2] - (a[2] + dz * k));
      if (lateral > walk.width / 2 + WALK_MARGIN) continue;
      const top = a[1] + (b[1] - a[1]) * k;
      if (p[1] >= top - UNDER_WALK && p[1] <= top + OVER_WALK) return true;
    }
  }
  return false;
}

/**
 * Open water for a swimmer: real water at least `depth` deep, `clearance` metres clear of every solid standing in
 * it, and not on or under a walking surface. Returns the water's level there, or null.
 */
export function openWater(habitat: Habitat, x: number, z: number, depth: number, clearance: number): number | null {
  const water = habitat.waterAt(x, z);
  if (!water || water.depth < depth) return null;
  for (const contact of habitat.obstacles) if (contactGap(contact, x, z) < clearance) return null;
  if (onWalk(habitat.walks, [x, water.level, z])) return null;
  return water.level;
}
