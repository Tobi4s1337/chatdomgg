import type { Vec3 } from '@chatdom/shared';
import type { XZ } from '@chatdom/world';
import type { WaterReach } from '../../../../../../packages/world/src/places/water/reaches';
import { inStill, onWalk, openWater, stillWaters, type Habitat, type StillWater } from './habitat';
import { between, hash, STREAM, unit } from './random';

/**
 * The water's wild residents, planned once from the caller's habitat and seed. Plans hold only fixed geometry
 * (loops, perches, candidate waters); where each creature is at a given moment is a pure function of the plan
 * and the caller's time (`poses.ts`), so seeking either way lands on the same frame.
 */

/** A closed paddling loop on still water, as a polyline with cumulative arc length. */
export interface Loop {
  readonly water: string;
  readonly level: number;
  /** x, z pairs. */
  readonly points: Float64Array;
  /** Arc length at each point; `length` closes the loop back to the first. */
  readonly s: Float64Array;
  readonly length: number;
}

export interface DuckPair {
  readonly id: string;
  readonly index: number;
  readonly loop: Loop;
  /** Mean paddling speed, m/s, and the loop direction. */
  readonly speed: number;
  readonly direction: 1 | -1;
  readonly phase: number;
  /** Two gentle surges [amplitude m/s, angular rate, phase] whose sum never exceeds the mean, so no duck backs up. */
  readonly surge: readonly [readonly [number, number, number], readonly [number, number, number]];
  /** Which bird leads. */
  readonly leader: 'hen' | 'drake';
}

export interface HeronPerch { readonly position: Vec3; readonly facing: number; readonly level: number }

export interface FlightReach { readonly reach: WaterReach }

export interface DragonflyHome { readonly id: string; readonly anchor: Vec3; readonly base: number }

export interface LifePlan {
  readonly seed: number;
  readonly still: readonly StillWater[];
  readonly ducks: readonly DuckPair[];
  /** Still waters that could not hold a clear loop for a pair: honest, not hidden. */
  readonly skipped: readonly string[];
  readonly heron: HeronPerch | null;
  /** Still waters a fish may break, with their weights (the square root of area). */
  readonly fishWaters: readonly { readonly water: StillWater; readonly weight: number }[];
  readonly flights: readonly WaterReach[];
  readonly dragonflies: readonly DragonflyHome[];
  readonly fireflies: readonly Vec3[];
}

/** Most duck pairs on one place, and the area a second pair needs on the same water. */
export const DUCK_PAIR_CAP = 4;
const SECOND_PAIR_AREA = 600;
const PAIR_AREA = 25;
/** A swimmer's minimum depth and clearance from solids, metres. */
export const DUCK_DEPTH = 0.22;
export const DUCK_CLEARANCE = 0.65;
const LOOP_SAMPLES = 96;
const DRAGONFLY_CAP = 3;
export const FIREFLY_CAP = 48;
const FIREFLIES_PER_REED = 5;

/** A loop's point and unit tangent at arc length `s` (wrapped). */
export function loopAt(loop: Loop, s: number): { x: number; z: number; tx: number; tz: number } {
  const L = loop.length, n = loop.s.length;
  let u = s % L; if (u < 0) u += L;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (loop.s[mid]! <= u) lo = mid; else hi = mid - 1; }
  const i = lo, j = (i + 1) % n, start = loop.s[i]!, end = j === 0 ? L : loop.s[j]!;
  const k = end > start ? (u - start) / (end - start) : 0;
  const ax = loop.points[2 * i]!, az = loop.points[2 * i + 1]!, bx = loop.points[2 * j]!, bz = loop.points[2 * j + 1]!;
  // The tangent blends between neighbouring segments so a duck's heading turns smoothly, never in steps.
  const h = (2 * i - 2 + 2 * n) % (2 * n), q = (2 * j + 2) % (2 * n);
  const before: XZ = [ax - loop.points[h]!, az - loop.points[h + 1]!], here: XZ = [bx - ax, bz - az], after: XZ = [loop.points[q]! - bx, loop.points[q + 1]! - bz];
  const w = k < 0.5 ? 0.5 + k : k - 0.5, from = k < 0.5 ? before : here, to = k < 0.5 ? here : after;
  const nf = Math.hypot(...from) || 1, nt = Math.hypot(...to) || 1;
  let tx = from[0] / nf * (1 - w) + to[0] / nt * w, tz = from[1] / nf * (1 - w) + to[1] / nt * w;
  const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, tx, tz };
}

/**
 * A wobbly closed loop on a still water at `scale` of its outline, or null when any part of it is not clear open
 * water. Its shape takes two seeded low harmonics, so no two loops are the same ellipse.
 */
function makeLoop(habitat: Habitat, water: StillWater, seed: number, pair: number, scale: number, offset: XZ): Loop | null {
  const a2 = between(0.04, 0.12, seed, STREAM.duckLoop, pair, 1), p2 = between(0, 6.283, seed, STREAM.duckLoop, pair, 2);
  const a3 = between(0.02, 0.08, seed, STREAM.duckLoop, pair, 3), p3 = between(0, 6.283, seed, STREAM.duckLoop, pair, 4);
  const points = new Float64Array(LOOP_SAMPLES * 2), s = new Float64Array(LOOP_SAMPLES);
  let level = 0;
  for (let i = 0; i < LOOP_SAMPLES; i++) {
    const phi = (i / LOOP_SAMPLES) * Math.PI * 2;
    const r = scale * (1 + a2 * Math.cos(2 * phi + p2) + a3 * Math.cos(3 * phi + p3));
    const [x, z] = inStill(water, offset[0] + r * Math.cos(phi), offset[1] + r * Math.sin(phi));
    const at = openWater(habitat, x, z, DUCK_DEPTH, DUCK_CLEARANCE);
    if (at === null) return null;
    level += at / LOOP_SAMPLES;
    points[2 * i] = x; points[2 * i + 1] = z;
    if (i) s[i] = s[i - 1]! + Math.hypot(x - points[2 * i - 2]!, z - points[2 * i - 1]!);
  }
  const length = s[LOOP_SAMPLES - 1]! + Math.hypot(points[0]! - points[2 * LOOP_SAMPLES - 2]!, points[1]! - points[2 * LOOP_SAMPLES - 1]!);
  return { water: water.id, level, points, s, length };
}

function planDucks(habitat: Habitat, still: readonly StillWater[], seed: number): { ducks: DuckPair[]; skipped: string[] } {
  const ducks: DuckPair[] = [], skipped: string[] = [];
  // Bigger waters first, so the cap keeps the pairs a viewer is most likely to see.
  const order = [...still].sort((a, b) => b.area - a.area || a.id.localeCompare(b.id));
  for (const water of order) {
    if (water.area < PAIR_AREA) continue;
    const wanted = water.area >= SECOND_PAIR_AREA ? 2 : 1;
    for (let k = 0; k < wanted && ducks.length < DUCK_PAIR_CAP; k++) {
      const index = ducks.length;
      // A second pair keeps to its own side of the water on a smaller loop.
      const home: XZ = k ? [between(-0.3, 0.3, seed, STREAM.duckPair, index, 7), between(0.2, 0.35, seed, STREAM.duckPair, index, 8)] : [0, 0];
      // The largest clear loop: from the pair's home outward through seeded nudges, so a rock or a shoal in the
      // water moves the loop aside rather than shrinking it to nothing.
      const nudges: XZ[] = [home, ...[0.25, 0.45].flatMap(r => Array.from({ length: 8 }, (_, n): XZ => {
        const a = (n / 8) * Math.PI * 2 + between(0, 0.7, seed, STREAM.duckPair, index, 13);
        return [home[0] + r * Math.cos(a), home[1] + r * Math.sin(a)];
      }))];
      let loop: Loop | null = null;
      for (let scale = k ? 0.32 : 0.55, tries = 0; !loop && tries < 6; scale *= 0.85, tries++) {
        for (const offset of nudges) if (!loop) loop = makeLoop(habitat, water, seed, index, scale, offset);
      }
      if (!loop) { skipped.push(water.id); continue; }
      const speed = between(0.13, 0.19, seed, STREAM.duckPair, index, 1);
      const a = speed * between(0.25, 0.4, seed, STREAM.duckPair, index, 2), b = speed * between(0.15, 0.35, seed, STREAM.duckPair, index, 3);
      ducks.push({
        id: `${water.id}:ducks:${k}`, index, loop, speed,
        direction: unit(seed, STREAM.duckPair, index, 4) < 0.5 ? 1 : -1,
        phase: unit(seed, STREAM.duckPair, index, 5) * loop.length,
        surge: [[a, between(0.09, 0.16, seed, STREAM.duckPair, index, 9), between(0, 6.283, seed, STREAM.duckPair, index, 10)],
          [b, between(0.31, 0.47, seed, STREAM.duckPair, index, 11), between(0, 6.283, seed, STREAM.duckPair, index, 12)]],
        leader: unit(seed, STREAM.duckPair, index, 6) < 0.5 ? 'hen' : 'drake',
      });
    }
  }
  return { ducks, skipped };
}

/** Wading depth for the heron, metres. */
const HERON_DEPTH: readonly [number, number] = [0.04, 0.3];

/**
 * A grey heron stands in the shallows beside one of the supplied reed beds, feet on the real bed, facing deeper
 * water, clear of every walk. No reeds or no wadeable shallows: no heron.
 */
function planHeron(habitat: Habitat, reeds: readonly Vec3[], seed: number): HeronPerch | null {
  const order = reeds.map((r, i) => ({ r, key: hash(seed, STREAM.heron, i) })).sort((a, b) => a.key - b.key);
  for (const { r } of order) {
    for (let ring = 0; ring < 4; ring++) for (let k = 0; k < 16; k++) {
      const radius = 0.7 + ring * 0.45, theta = (k / 16) * Math.PI * 2 + ring * 0.2;
      const x = r[0] + radius * Math.cos(theta), z = r[2] + radius * Math.sin(theta);
      const water = habitat.waterAt(x, z);
      if (!water || water.depth < HERON_DEPTH[0] || water.depth > HERON_DEPTH[1]) continue;
      const bed = water.level - water.depth;
      if (habitat.obstacles.some(c => Math.hypot(c.a[0] - x, c.a[1] - z) < c.radius + 0.4) || onWalk(habitat.walks, [x, bed + 0.5, z])) continue;
      // Face the way the water deepens most, sampled a metre out.
      let facing = theta, deepest = -Infinity;
      for (let d = 0; d < 12; d++) {
        const a = (d / 12) * Math.PI * 2, ahead = habitat.waterAt(x + Math.cos(a), z + Math.sin(a));
        if (ahead && ahead.depth > deepest) { deepest = ahead.depth; facing = a; }
      }
      return { position: [x, bed, z], facing, level: water.level };
    }
  }
  return null;
}

/** Reed beds a dragonfly patrols at noon, and the fireflies' resting places at dusk, all beside real reeds. */
function planReedLife(habitat: Habitat, reeds: readonly Vec3[], seed: number): { dragonflies: DragonflyHome[]; fireflies: Vec3[] } {
  const ordered = reeds.map((r, i) => ({ r, i, key: hash(seed, STREAM.dragonfly, i) })).sort((a, b) => a.key - b.key);
  const dragonflies: DragonflyHome[] = [];
  for (const { r, i } of ordered) {
    if (dragonflies.length >= DRAGONFLY_CAP) break;
    const base = Math.max(r[1], habitat.waterAt(r[0], r[2])?.level ?? r[1]);
    dragonflies.push({ id: `dragonfly:${i}`, anchor: r, base });
  }
  const fireflies: Vec3[] = [];
  reeds.forEach((r, i) => {
    for (let k = 0; k < FIREFLIES_PER_REED && fireflies.length < FIREFLY_CAP; k++) {
      const a = between(0, 6.283, seed, STREAM.firefly, i, k, 1), d = between(0.4, 2.6, seed, STREAM.firefly, i, k, 2);
      const x = r[0] + d * Math.cos(a), z = r[2] + d * Math.sin(a);
      const y = Math.max(r[1], habitat.waterAt(x, z)?.level ?? r[1]) + between(0.35, 1.5, seed, STREAM.firefly, i, k, 3);
      if (!onWalk(habitat.walks, [x, y, z])) fireflies.push([x, y, z]);
    }
  });
  return { dragonflies, fireflies };
}

/** Every resident of the place, from the caller's habitat, reed beds and seed. */
export function planWaterLife(habitat: Habitat, reeds: readonly Vec3[], seed: number): LifePlan {
  const still = stillWaters(habitat.bodies, habitat.reaches);
  const { ducks, skipped } = planDucks(habitat, still, seed);
  const { dragonflies, fireflies } = planReedLife(habitat, reeds, seed);
  return {
    seed, still, ducks, skipped,
    heron: planHeron(habitat, reeds, seed),
    fishWaters: still.filter(w => w.area >= PAIR_AREA).map(water => ({ water, weight: Math.sqrt(water.area) })),
    // The kingfisher keeps to natural streams long enough for a flash along them.
    flights: habitat.reaches.filter(r => r.kind === 'stream' && r.length >= FLIGHT_MIN + 2),
    dragonflies, fireflies,
  };
}

/** Shortest and longest kingfisher dash, metres. */
export const FLIGHT_MIN = 10;
export const FLIGHT_MAX = 22;
