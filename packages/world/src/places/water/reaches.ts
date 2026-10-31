import { smoothstep } from '../../settlement/geometry';
import type { XZ } from '../../settlement/types';
import { sampleLandWater } from '../../kingdom-land/surface';
import type { KingdomLandform, LandStream } from '../../kingdom-land/types';

/**
 * Flow along the land's own courses. Everything here reads the supplied `LandStream` point records and water
 * bodies; nothing routes, carves or moves a course. Speeds are presentation speeds for advected ripples and foam,
 * shaped like open-channel flow: they grow with the square root of the surface slope and with depth, quicken
 * where the channel narrows, fall to nothing over level water, and ease into still water at a mouth so two-phase
 * advection never jumps where one reach meets another.
 */

/** Half-window, in metres along the course, over which the surface slope is read. */
export const SLOPE_WINDOW = 5;
/**
 * Presentation flow is continuity shaped by the surface: each course carries one discharge, `V_REF` m/s through its
 * mean cross-section, so it quickens through a narrows and slows where it widens and deepens; the local surface fall
 * then scales it (square root of slope over `S_REF`, between `G_MIN` and `G_MAX`) so riffles run and level water
 * creeps, the way the eye reads energy on a stream. A level pool keeps only `G_MIN` of its continuity speed.
 */
const V_REF = .45;
const S_REF = .01;
const G_MIN = .15;
const G_MAX = 3;
/** No advected detail runs faster than this, whatever the slope. */
export const MAX_FLOW = 1.5;
/** Below this a point reads as still water. */
export const STILL_FLOW = .1;
/** A mouth or source level may differ from its water by at most half a cell before it is a step. */
export const LEVEL_TOLERANCE = 1 / 16;
/** Distance over which a reach eases into the water it joins (or out of the water it leaves). */
const JOIN_EASE = 8;

export interface ReachPoint {
  readonly position: XZ;
  readonly bed: number;
  readonly level: number;
  readonly width: number;
  readonly depth: number;
  /** Metres along the course from its first point. */
  readonly s: number;
  /** Unit downstream direction, from the neighbouring points. */
  readonly tangent: XZ;
  /** Smoothed surface fall per metre, never negative. */
  readonly slope: number;
  /** Presentation speed, m/s, after joins are eased. */
  readonly speed: number;
  /** Velocity: tangent × speed (or the eased blend at a join). */
  readonly flow: XZ;
  readonly still: boolean;
}

/** What a course begins from or ends in, as the supplied geometry shows it. */
export type ReachEnd =
  /** A natural stream's first point out of any water. */
  | { readonly kind: 'spring' }
  /** Inside another body or course: the surface levels must agree. */
  | { readonly kind: 'water'; readonly id: string; readonly level: number; readonly step: number }
  /** Below another water's rim at a lower level: an overfall (a weir), `drop` metres. */
  | { readonly kind: 'fall'; readonly id: string; readonly drop: number }
  /** Not in any water and not a natural spring: a wheel pit, a trough or a dangling end, judged by the place plan. */
  | { readonly kind: 'open' };

export interface WaterReach {
  readonly id: string;
  readonly kind: LandStream['kind'];
  readonly length: number;
  readonly points: readonly ReachPoint[];
  readonly source: ReachEnd;
  readonly mouth: ReachEnd;
  /** Median speed of the moving points: the "open reach" a pool is compared with. */
  readonly openSpeed: number;
}

const hypot = (a: XZ, b: XZ) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const normal = (x: number, z: number): XZ => { const l = Math.hypot(x, z); return l > 1e-9 ? [x / l, z / l] : [0, 1]; };

/** Linear interpolation of a per-point value at distance `s` along the course (clamped). */
export function alongCourse(points: readonly { s: number }[], values: readonly number[], s: number): number {
  if (s <= points[0]!.s) return values[0]!;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!.s, b = points[i]!.s;
    if (s <= b) return values[i - 1]! + (values[i]! - values[i - 1]!) * ((s - a) / (b - a || 1));
  }
  return values.at(-1)!;
}

/** Which other water a course end sits in, read with that course removed from the land. */
function endOf(landform: KingdomLandform, stream: LandStream, at: 'first' | 'last'): ReachEnd {
  const point = at === 'first' ? stream.points[0]! : stream.points.at(-1)!;
  const others: KingdomLandform = { ...landform, streams: landform.streams.filter(item => item !== stream) };
  const sample = sampleLandWater(others, point.position[0], point.position[1]);
  const open: ReachEnd = at === 'first' && stream.kind === 'stream' ? { kind: 'spring' } : { kind: 'open' };
  if (!sample) return open;
  const step = point.level - sample.surface;
  if (sample.shoreDistance < 0) {
    // A source lower than the water it leaves is an overfall; any other difference is a step the land must fix.
    if (at === 'first' && step < -LEVEL_TOLERANCE) return { kind: 'fall', id: sample.id, drop: -step };
    return { kind: 'water', id: sample.id, level: sample.surface, step };
  }
  // A source that begins at another water's rim, below it, falls over that rim.
  if (at === 'first' && sample.shoreDistance < point.width && step < -LEVEL_TOLERANCE) return { kind: 'fall', id: sample.id, drop: -step };
  return open;
}

function baseFlow(stream: LandStream): { s: number[]; tangent: XZ[]; slope: number[]; speed: number[] } {
  const pts = stream.points, n = pts.length, s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1]! + hypot(pts[i - 1]!.position, pts[i]!.position));
  const tangent = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]!.position, b = pts[Math.min(n - 1, i + 1)]!.position;
    return normal(b[0] - a[0], b[1] - a[1]);
  });
  const levels = pts.map(p => p.level), length = s[n - 1]!, at = s.map(v => ({ s: v }));
  const window = Math.min(SLOPE_WINDOW, length / 2);
  const slope = s.map(here => {
    const from = Math.max(0, here - window), to = Math.min(length, here + window);
    return to > from ? Math.max(0, (alongCourse(at, levels, from) - alongCourse(at, levels, to)) / (to - from)) : 0;
  });
  const meanArea = pts.reduce((sum, p) => sum + p.width * (p.level - p.bed), 0) / n;
  const speed = pts.map((p, i) => Math.min(MAX_FLOW,
    V_REF * meanArea / (p.width * (p.level - p.bed)) * Math.min(G_MAX, Math.max(G_MIN, Math.sqrt(slope[i]! / S_REF)))));
  return { s, tangent, slope, speed };
}

/**
 * Derive every reach's flow from the land. Mouths into still bodies ease to rest; mouths into another course ease
 * into that course's own velocity; sources leaving still water ease up from rest. Overfalls (weirs) start at speed.
 */
export function deriveWaterReaches(landform: KingdomLandform): WaterReach[] {
  const streams = [...landform.streams].sort((a, b) => a.id.localeCompare(b.id));
  const bases = new Map(streams.map(stream => [stream, baseFlow(stream)]));
  const ends = new Map(streams.map(stream => [stream, { source: endOf(landform, stream, 'first'), mouth: endOf(landform, stream, 'last') }]));
  const byId = new Map(streams.map(stream => [stream.id, stream]));

  /** Base velocity of a course at the point nearest `at`, for easing a tributary into it. */
  const velocityNear = (id: string, at: XZ): XZ | undefined => {
    const stream = byId.get(id);
    if (!stream) return undefined;
    const base = bases.get(stream)!;
    let best = 0, distance = Infinity;
    stream.points.forEach((p, i) => { const d = hypot(p.position, at); if (d < distance) { distance = d; best = i; } });
    const t = base.tangent[best]!, v = base.speed[best]!;
    return [t[0] * v, t[1] * v];
  };

  return streams.map(stream => {
    const base = bases.get(stream)!, { source, mouth } = ends.get(stream)!, length = base.s.at(-1)!;
    const into = mouth.kind === 'water' ? velocityNear(mouth.id, stream.points.at(-1)!.position) : undefined;
    const ease = Math.min(JOIN_EASE, length / 3);
    const points: ReachPoint[] = stream.points.map((p, i) => {
      const s = base.s[i]!, t = base.tangent[i]!;
      let fx = t[0] * base.speed[i]!, fz = t[1] * base.speed[i]!;
      // Leaving still water (a spring or a pond mouth) the flow gathers from rest.
      if (source.kind === 'spring' || source.kind === 'water') { const k = smoothstep(0, ease, s); fx *= k; fz *= k; }
      // Arriving: blend toward the receiving water's own velocity (zero in a lake or pond).
      if (mouth.kind === 'water') {
        const k = smoothstep(length - ease, length, s), target = into ?? [0, 0];
        fx += (target[0] - fx) * k; fz += (target[1] - fz) * k;
      }
      const speed = Math.hypot(fx, fz);
      return { position: p.position, bed: p.bed, level: p.level, width: p.width, depth: p.level - p.bed, s, tangent: t,
        slope: base.slope[i]!, speed, flow: [fx, fz], still: speed < STILL_FLOW };
    });
    const moving = points.filter(p => !p.still).map(p => p.speed).sort((a, b) => a - b);
    const openSpeed = moving.length ? moving[Math.floor(moving.length / 2)]! : 0;
    return { id: stream.id, kind: stream.kind, length, points, source, mouth, openSpeed };
  });
}

/** Interpolated flow at a distance along a reach. */
export function flowAlong(reach: WaterReach, s: number): { flow: XZ; speed: number; level: number; width: number } {
  const fx = alongCourse(reach.points, reach.points.map(p => p.flow[0]), s);
  const fz = alongCourse(reach.points, reach.points.map(p => p.flow[1]), s);
  return { flow: [fx, fz], speed: Math.hypot(fx, fz), level: alongCourse(reach.points, reach.points.map(p => p.level), s),
    width: alongCourse(reach.points, reach.points.map(p => p.width), s) };
}

/** The point of a reach nearest to a world position, with its lateral distance from the centreline. */
export function nearestOnReach(reach: WaterReach, at: XZ): { index: number; distance: number } {
  let index = 0, distance = Infinity;
  reach.points.forEach((p, i) => { const d = hypot(p.position, at); if (d < distance) { distance = d; index = i; } });
  return { index, distance };
}
