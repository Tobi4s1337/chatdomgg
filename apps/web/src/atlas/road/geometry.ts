/**
 * The line a raid rides on the Atlas (Atlas.md §5.2, §7.5–7.6): one hand-drawn road between two holdings, in world
 * units. Pure and deterministic: the same pair always bends the same way, so a road redrawn after a reload is the
 * road people saw. A raid across languages is a sea lane, which swings wider over the water.
 */

export interface RoadEnd { x: number; y: number }

export interface RoadPath {
  /** Interleaved x, y in world units, from the source to the destination. */
  readonly points: Float64Array;
  /** Cumulative length at each point; `lengths[0] = 0`, the last entry is `total`. */
  readonly lengths: Float64Array;
  readonly total: number;
  readonly sea: boolean;
}

export interface RoadSample { x: number; y: number; /** Heading in radians, screen-down positive like the map. */ angle: number }

/** Points along a drawn road; enough that a bend never shows a corner at the deepest zoom it is followed at. */
export const ROAD_SAMPLES = 160;

/** FNV-1a over the pair key: a stable small seed for the road's bend and wobble. */
export function roadSeed(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const unit = (seed: number, salt: number) => (roadSeed(`${seed}:${salt}`) % 10_000) / 10_000;

/**
 * Plan the road from `from` to `to`. Its bend is a gentle arc to one side (chosen by the pair, never by direction,
 * so the road back is the same road), with a low wobble of a surveyor's hand along it. Sea lanes arc further.
 */
export function planRoad(from: RoadEnd, to: RoadEnd, key: string, sea = false): RoadPath {
  const seed = roadSeed(key);
  const dx = to.x - from.x, dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const points = new Float64Array(ROAD_SAMPLES * 2);
  const lengths = new Float64Array(ROAD_SAMPLES);
  if (distance < 1e-6) {
    for (let i = 0; i < ROAD_SAMPLES; i++) { points[i * 2] = from.x; points[i * 2 + 1] = from.y; }
    return { points, lengths, total: 0, sea };
  }
  const nx = -dy / distance, ny = dx / distance;
  const side = unit(seed, 1) < 0.5 ? -1 : 1;
  const bend = distance * (sea ? 0.24 + unit(seed, 2) * 0.08 : 0.1 + unit(seed, 2) * 0.07) * side;
  // Two control points pulled to the same side, unevenly, so the arc leans like a road that follows land.
  const lean = 0.35 + unit(seed, 3) * 0.3;
  const c1 = { x: from.x + dx * 0.3 + nx * bend * (0.6 + lean), y: from.y + dy * 0.3 + ny * bend * (0.6 + lean) };
  const c2 = { x: from.x + dx * 0.72 + nx * bend * (1.4 - lean), y: from.y + dy * 0.72 + ny * bend * (1.4 - lean) };
  const wobble = sea ? 0 : distance * 0.012;
  const phase = unit(seed, 4) * Math.PI * 2;
  for (let i = 0; i < ROAD_SAMPLES; i++) {
    const t = i / (ROAD_SAMPLES - 1);
    const u = 1 - t;
    const bx = u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x;
    const by = u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y;
    // The wobble dies out at both ends, so the road leaves and enters each holding exactly.
    const w = wobble * Math.sin(t * Math.PI) * (Math.sin(t * 9.3 + phase) * 0.6 + Math.sin(t * 23.7 + phase * 1.7) * 0.4);
    points[i * 2] = bx + nx * w;
    points[i * 2 + 1] = by + ny * w;
  }
  let total = 0;
  for (let i = 1; i < ROAD_SAMPLES; i++) {
    total += Math.hypot(points[i * 2]! - points[i * 2 - 2]!, points[i * 2 + 1]! - points[i * 2 - 1]!);
    lengths[i] = total;
  }
  return { points, lengths, total, sea };
}

/** The point `s` (0…1 of the road's length) along the road, with its heading. Outside 0…1 it holds at the end. */
export function sampleRoad(path: RoadPath, s: number): RoadSample {
  const n = path.lengths.length;
  const p = path.points;
  if (path.total <= 0) return { x: p[0]!, y: p[1]!, angle: 0 };
  const target = Math.min(1, Math.max(0, s)) * path.total;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.lengths[mid]! <= target) lo = mid; else hi = mid;
  }
  const span = path.lengths[hi]! - path.lengths[lo]!;
  const f = span > 0 ? (target - path.lengths[lo]!) / span : 0;
  const ax = p[lo * 2]!, ay = p[lo * 2 + 1]!, bx = p[hi * 2]!, by = p[hi * 2 + 1]!;
  return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f, angle: Math.atan2(by - ay, bx - ax) };
}

/** The road's points from `s0` to `s1` (fractions of its length), both ends exact, for drawing a stretch of it. */
export function roadStretch(path: RoadPath, s0: number, s1: number): number[] {
  const a = Math.min(1, Math.max(0, Math.min(s0, s1))), b = Math.min(1, Math.max(0, Math.max(s0, s1)));
  const out: number[] = [];
  if (path.total <= 0 || b - a <= 0) return out;
  const start = sampleRoad(path, a);
  out.push(start.x, start.y);
  const from = a * path.total, to = b * path.total;
  for (let i = 1; i < path.lengths.length - 1; i++) {
    const at = path.lengths[i]!;
    if (at > from && at < to) out.push(path.points[i * 2]!, path.points[i * 2 + 1]!);
  }
  const end = sampleRoad(path, b);
  out.push(end.x, end.y);
  return out;
}

/** The box around the whole road, for framing it. */
export function roadBounds(path: RoadPath): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < path.points.length; i += 2) {
    const x = path.points[i]!, y = path.points[i + 1]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * How long the public caravan rides, by distance on the map (Atlas.md §5.2: 12 to 30 s). `span` is the size of the
 * surveyed world in world units; a road across a tenth of it rides about 16 s.
 */
export function rideSeconds(path: RoadPath, span: number): number {
  const share = span > 0 ? path.total / span : 0;
  return Math.round(Math.min(30, Math.max(12, 10 + share * 60)) * 10) / 10;
}
