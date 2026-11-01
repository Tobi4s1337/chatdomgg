import { seedHash } from '../../../seed';
import type { StreetEdge, XZ } from '../../../settlement/types';
import { pointInPolygon } from './grid';
import { crossing, outward, Path } from './path';
import { towerReach, TOWER, type GateShape, type TowerShape, type WallKit } from './pieces';
import { angleBetween, type RingPlan } from './ring';
import type { WallSite } from './site';
import type { RingSpanKind, TownWallOptions } from './types';

/** Half the passage depth through a gatehouse (the curtain is two metres thick; the gate block four). */
const GATE_DEPTH = 2;
/** Clear height from the highest street surface in a passage to the arch's springing. */
export const GATE_HEADROOM = 4.5;
/** What the carve keeps clear over a street even under an arch; the arch itself stands higher. */
export const CORRIDOR_HEADROOM = 4.25;
/** A lintel spans at most this; a wider or very skewed crossing gets flanking towers and no arch. */
const MAX_ARCH = 15;
const GATE_TOWER_RADIUS = 3;
/** Crossings closer than this along the wall share one gatehouse. */
const CLUSTER = 12;
/** Towers stand roughly every 35–55 m and on every marked corner, never closer than this to another. */
const TOWER_SPACING = 55;
const MIN_TOWER_GAP = 22;
const CORNER_TURN = 0.45;
/** Wall-walk height above the ground at the centre line, before seeded variation. */
const WALK_HEIGHT = 6.25;

type NodeKind = RingSpanKind | 'gate' | 'tower' | 'seam';

export interface PlannedGate {
  readonly id: string;
  readonly streetIds: readonly string[];
  readonly streetId: string;
  readonly growthNodeIds: readonly string[];
  readonly shape: GateShape;
  readonly kind: 'arch' | 'open';
  readonly streetTop: number;
  /** Flank points on the gate's chord where the curtain meets it. */
  readonly flanks: readonly [XZ, XZ];
  /** Which flank (`a` before the opening along the ring, `b` after) each of `shape.towers` stands on. */
  readonly towerSides: readonly ('a' | 'b')[];
}
export interface PlannedTower { readonly id: string; readonly shape: TowerShape; readonly gateId?: string; readonly standalone: boolean }
export interface Stretch {
  readonly id: string;
  readonly path: Path;
  /** Metres the wall runs on past its first and last point (into the castle, or across a seam). */
  readonly before: number;
  readonly after: number;
  readonly walkHeight: number;
  readonly phase: number;
}
export interface WallLayout {
  readonly gates: readonly PlannedGate[];
  readonly towers: readonly PlannedTower[];
  readonly stretches: readonly Stretch[];
  /** Each wall span's final centre line, straightened through its gates. */
  readonly wallLines: readonly XZ[][];
}

const snap = (value: number) => Math.floor(value / 0.25) * 0.25 + 0.125;
const quarter = (value: number) => Math.round(value / 0.25) * 0.25;

export class WallLayoutContext {
  private readonly key: string;
  constructor(readonly site: WallSite, readonly ring: RingPlan, readonly options: TownWallOptions, readonly kit: WallKit) {
    this.key = `${options.seedKey}|${site.plan.revision}`;
  }
  unit(label: string): number { return seedHash(`${this.key}|${label}`) / 4294967296; }
  /** Every sample of the drum, its plinth and its eave lies clear of lots, squares, castle, water, streets and the region's edge. */
  towerFits(centre: XZ, radius: number): boolean {
    const { site, ring } = this;
    for (const r of [0, radius * 0.5, radius, radius + TOWER.plinth, towerReach(radius)]) {
      const count = Math.max(1, Math.ceil(2 * Math.PI * r / 0.6));
      for (let j = 0; j < count; j++) {
        const a = 2 * Math.PI * j / count, x = centre[0] + r * Math.cos(a), z = centre[1] + r * Math.sin(a);
        if (site.forbiddenBelow(x, z, 0, 0.3) !== -Infinity) return false;
        if (site.lotDistance(x, z, lot => ring.enclosedLots.has(lot.id)) < 2) return false;
        if (site.squareDistance(x, z, square => ring.enclosedSquares.has(square.id)) < 2) return false;
      }
    }
    return true;
  }
  tower(id: string, centre: XZ, tangent: XZ, radius: number, door: boolean, crown?: number): TowerShape {
    const ground = this.options.ground, normal = outward(tangent);
    let low = Infinity, high = -Infinity;
    for (const r of [0, radius * 0.5, radius, radius + TOWER.plinth]) {
      const count = Math.max(1, Math.ceil(2 * Math.PI * r / 1.2));
      for (let j = 0; j < count; j++) {
        const a = 2 * Math.PI * j / count, g = ground(centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a));
        low = Math.min(low, g); high = Math.max(high, g);
      }
    }
    const centreGround = ground(centre[0], centre[1]);
    const sill = ground(centre[0] - normal[0] * radius, centre[1] - normal[1] * radius);
    const top = crown ?? quarter(centreGround + 11.5 + this.unit(`${id}:crown`));
    return {
      centre, tangent, normal, radius, kit: this.kit, door,
      base: Math.floor((low - 0.5) / 0.125) * 0.125, plinthTop: Math.ceil((high + 0.5) / 0.25) * 0.25,
      doorSill: Math.round(sill / 0.125) * 0.125, walk: centreGround + WALK_HEIGHT + 0.5, crown: top,
      roofHeight: quarter(towerReach(radius) * (1.3 + 0.25 * this.unit(`${id}:roof`))),
    };
  }
}

interface Crossing { s: number; street: StreetEdge }

function crossingsOf(path: Path, site: WallSite): Crossing[] {
  const found: Crossing[] = [];
  for (let k = 1; k < path.points.length; k++) {
    const a = path.points[k - 1]!, b = path.points[k]!, mid: XZ = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const span = path.lengths[k]! - path.lengths[k - 1]!;
    for (const corridor of site.corridorsNear(mid[0], mid[1])) {
      const t = crossing(a, b, [corridor.a[0], corridor.a[2]], [corridor.b[0], corridor.b[2]]);
      if (t === null) continue;
      const s = path.lengths[k - 1]! + t * span;
      if (!found.some(other => other.street === corridor.street && Math.abs(other.s - s) < 1)) found.push({ s, street: corridor.street });
    }
  }
  return found.sort((p, q) => p.s - q.s || p.street.id.localeCompare(q.street.id));
}

interface GateSolution {
  centre: XZ; tangent: XZ; width: number;
  /** Arc lengths on the span where the curtain meets the gate's two flanks. */
  from: number; to: number; reach: number; streets: StreetEdge[];
}

/** Along-wall extent [u0, u1] of every corridor point within the passage depth, in the frame (c, t). */
function opening(c: XZ, t: XZ, streets: readonly StreetEdge[]): [number, number] {
  const n = outward(t);
  let u0 = Infinity, u1 = -Infinity;
  for (const street of streets) {
    const r = street.width / 2 + street.verge, limit = GATE_DEPTH + r;
    for (let k = 1; k < street.points.length; k++) {
      const a = street.points[k - 1]!, b = street.points[k]!;
      const ua = (a[0] - c[0]) * t[0] + (a[2] - c[1]) * t[1], va = (a[0] - c[0]) * n[0] + (a[2] - c[1]) * n[1];
      const ub = (b[0] - c[0]) * t[0] + (b[2] - c[1]) * t[1], vb = (b[0] - c[0]) * n[0] + (b[2] - c[1]) * n[1];
      if (Math.min(Math.abs(ua), Math.abs(ub)) > 30 && Math.sign(ua) === Math.sign(ub)) continue;
      let lo = 0, hi = 1;
      const dv = vb - va;
      if (Math.abs(dv) < 1e-9) { if (Math.abs(va) > limit) continue; } else {
        const t0 = (-limit - va) / dv, t1 = (limit - va) / dv;
        lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
        if (lo > hi) continue;
      }
      const uLo = ua + (ub - ua) * lo, uHi = ua + (ub - ua) * hi;
      u0 = Math.min(u0, Math.min(uLo, uHi) - r); u1 = Math.max(u1, Math.max(uLo, uHi) + r);
    }
  }
  if (!Number.isFinite(u0)) return [-3, 3];
  u0 -= 0.25; u1 += 0.25;
  const least = Math.max(...streets.map(street => Math.max(street.width + 2, street.width + 2 * street.verge)));
  if (u1 - u0 < least) { const grow = (least - (u1 - u0)) / 2; u0 -= grow; u1 += grow; }
  return [u0, u1];
}

/** Direction of a street's centre line nearest to a point. */
function streetDirection(street: StreetEdge, at: XZ): XZ {
  let best: XZ = [1, 0], distance = Infinity;
  for (let k = 1; k < street.points.length; k++) {
    const a = street.points[k - 1]!, b = street.points[k]!, dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
    if (length < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[2]) * dz) / (length * length)));
    const d = Math.hypot(at[0] - a[0] - dx * t, at[1] - a[2] - dz * t);
    if (d < distance) { distance = d; best = [dx / length, dz / length]; }
  }
  return best;
}

/**
 * The opening a set of streets needs where they cross the wall near `s`. The gate turns from the wall's own line
 * toward square across the widest street, as far as it must to keep the passage narrow, provided the curtain can
 * still reach both flanks clear of lots and other streets.
 */
function solveGate(path: Path, streets: StreetEdge[], s: number, clear: (x: number, z: number, crossing: boolean) => boolean): GateSolution {
  const c = path.at(s), wallT = path.tangent(s, 6);
  const primary = [...streets].sort((p, q) => q.width + 2 * q.verge - (p.width + 2 * p.verge) || p.id.localeCompare(q.id))[0]!;
  const d = streetDirection(primary, c);
  let square: XZ = [-d[1], d[0]];
  if (square[0] * wallT[0] + square[1] * wallT[1] < 0) square = [-square[0], -square[1]];
  const wallAngle = Math.atan2(wallT[1], wallT[0]);
  let turn = Math.atan2(square[1], square[0]) - wallAngle;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  const solve = (fraction: number): GateSolution => {
    const angle = wallAngle + turn * fraction, t: XZ = [Math.cos(angle), Math.sin(angle)];
    const [u0, u1] = opening(c, t, streets), width = u1 - u0, middle = (u0 + u1) / 2;
    const centre: XZ = [c[0] + t[0] * middle, c[1] + t[1] * middle], reach = width / 2 + GATE_TOWER_RADIUS + 0.5;
    const from = path.project(centre[0] - t[0] * reach, centre[1] - t[1] * reach).s, to = path.project(centre[0] + t[0] * reach, centre[1] + t[1] * reach).s;
    return { centre, tangent: t, width, from, to, reach, streets };
  };
  const routeClear = (gate: GateSolution): boolean => {
    if (gate.to <= gate.from) return false;
    const a: XZ = [gate.centre[0] - gate.tangent[0] * gate.reach, gate.centre[1] - gate.tangent[1] * gate.reach];
    const b: XZ = [gate.centre[0] + gate.tangent[0] * gate.reach, gate.centre[1] + gate.tangent[1] * gate.reach];
    const legs: [XZ, XZ, boolean][] = [[path.at(gate.from - 1.5), a, false], [a, b, true], [b, path.at(gate.to + 1.5), false]];
    for (const [p, q, crossing] of legs) {
      const count = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.5));
      for (let k = 0; k <= count; k++) {
        const x = p[0] + (q[0] - p[0]) * k / count, z = p[1] + (q[1] - p[1]) * k / count;
        if (!clear(x, z, crossing)) return false;
      }
    }
    return true;
  };
  const along = solve(0), turned = [solve(1 / 3), solve(2 / 3), solve(1)], narrow = turned[2]!.width + 1.5;
  if (along.width <= narrow) return along;
  for (const candidate of turned) if (candidate.width <= narrow && routeClear(candidate)) return candidate;
  const fallback = turned.filter(routeClear).sort((p, q) => p.width - q.width)[0];
  return fallback && fallback.width < along.width ? fallback : along;
}

function clusterGates(path: Path, crossings: readonly Crossing[], clear: (x: number, z: number, crossing: boolean) => boolean): GateSolution[] {
  const groups: Crossing[][] = [];
  for (const crossing of crossings) {
    const last = groups.at(-1);
    if (last && crossing.s - last.at(-1)!.s < CLUSTER) last.push(crossing); else groups.push([crossing]);
  }
  const solve = (group: readonly Crossing[]) => {
    const streets = [...new Map(group.map(c => [c.street.id, c.street])).values()];
    return solveGate(path, streets, group.reduce((sum, c) => sum + c.s, 0) / group.length, clear);
  };
  const solutions = groups.map(group => ({ group, gate: solve(group) }));
  // Openings that grew into each other become one gatehouse.
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 1; i < solutions.length; i++) {
      const a = solutions[i - 1]!, b = solutions[i]!;
      if (b.gate.from < a.gate.to + 6) {
        const group = [...a.group, ...b.group];
        solutions.splice(i - 1, 2, { group, gate: solve(group) });
        merged = true; break;
      }
    }
  }
  return solutions.map(solution => solution.gate).sort((p, q) => p.from - q.from);
}

/** Marks a growth exit: a lane-sized way out that a future quarter's street will take. */
export const GROWTH_PREFIX = 'growth:';
const GROWTH_REACH = 45;

/**
 * Where the plan says the town will grow (each quarter's growth junctions and the frontier), a lane-wide way out runs
 * from the junction square through the nearest stretch of wall it can reach without crossing a lot.
 */
function growthExits(context: WallLayoutContext): StreetEdge[] {
  const { site, ring } = context, plan = site.plan;
  const ids = [...new Set([...plan.quarters.flatMap(q => q.growthNodeIds), ...plan.nodes.filter(n => n.kind === 'frontier').map(n => n.id)])].sort();
  const walls = ring.spans.filter(span => span.kind === 'wall').map(span => new Path(span.points));
  const exits: StreetEdge[] = [];
  const clearLeg = (a: XZ, b: XZ) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = Math.min(4, length); t <= length; t += 0.5) {
      const x = a[0] + (b[0] - a[0]) * t / length, z = a[1] + (b[1] - a[1]) * t / length;
      if (site.lotDistance(x, z) < RING_EXIT_CLEAR || site.squareDistance(x, z) < RING_EXIT_CLEAR) return false;
    }
    return true;
  };
  // A way out is kept only where a gate can stand on its own ground, not cut into a bank.
  const level = (p: XZ, n: XZ) => {
    let low = Infinity, high = -Infinity;
    for (const a of [-4, -2, 0, 2, 4]) for (const b of [-GATE_DEPTH, 0, GATE_DEPTH]) {
      const g = site.ground(p[0] - n[1] * a + n[0] * b, p[1] + n[0] * a + n[1] * b);
      low = Math.min(low, g); high = Math.max(high, g);
    }
    return high - low <= GROWTH_MAX_RISE;
  };
  // ...and where both of its flanking towers have room.
  const flanked = (p: XZ, n: XZ) => {
    const t: XZ = [-n[1], n[0]], reach = GROWTH_WIDTH / 2 + GATE_TOWER_RADIUS + 0.5;
    return [-1, 1].every(side => GATE_TOWER_VARIANTS.some(([radius, out]) => {
      const along = side * (reach + GATE_TOWER_RADIUS - radius);
      return context.towerFits([p[0] + t[0] * along + n[0] * out, p[1] + t[1] * along + n[1] * out], radius);
    }));
  };
  for (const id of ids) {
    const node = plan.nodes.find(n => n.id === id);
    if (!node || !pointInPolygon(ring.loop, node.position[0], node.position[2])) continue;
    const y = node.position[1];
    // A future street leaves the junction itself or runs out along one of its streets first, so the way out may
    // start anywhere along them; the cheapest clear route (along the street, then across to the wall) wins.
    let best: { start: XZ; inner: XZ; outer: XZ; cost: number } | null = null;
    for (const start of exitStarts(plan.streets, id, [node.position[0], node.position[2]])) {
      if (best && start.along >= best.cost) break;
      let near: { wall: Path; s: number; distance: number } | null = null;
      for (const wall of walls) {
        const p = wall.project(start.at[0], start.at[1]);
        if (!near || p.distance < near.distance) near = { wall, s: p.s, distance: p.distance };
      }
      if (!near || near.distance > GROWTH_REACH) continue;
      for (const slide of GROWTH_SLIDES) {
        const s = near.s + slide;
        if (s < 8 || s > near.wall.total - 8) continue;
        const p = near.wall.at(s), n = outward(near.wall.tangent(s, 6)), leg = Math.hypot(p[0] - start.at[0], p[1] - start.at[1]);
        if (leg > GROWTH_REACH || (best && start.along + leg >= best.cost) || !clearLeg(start.at, p)) continue;
        const inner: XZ = [p[0] - n[0] * 8, p[1] - n[1] * 8], outer: XZ = [p[0] + n[0] * 20, p[1] + n[1] * 20];
        if (!level(p, n) || !flanked(p, n) || !clearLeg(inner, p)) continue;
        best = { start: start.at, inner, outer, cost: start.along + leg };
      }
    }
    if (!best) continue;
    exits.push({ id: `${GROWTH_PREFIX}${id}`, from: id, to: id, kind: 'lane', name: 'growth exit', width: GROWTH_LANE, verge: 1,
      points: [[best.start[0], y, best.start[1]], [best.inner[0], y, best.inner[1]], [best.outer[0], y, best.outer[1]]] });
  }
  return exits;
}

/** A growth exit is a lane (4 m and its verges); its gate opens 6.5 m, the lane plus two metres and a margin. */
const GROWTH_LANE = 4;
const GROWTH_WIDTH = 6.5;
/** Most the ground may rise across a growth gate's opening and passage. */
const GROWTH_MAX_RISE = 2;
const GROWTH_SLIDES = [0, 5, -5, 10, -10, 15, -15, 20, -20, 25, -25, 30, -30];
/** How far along a junction's own streets a way out may begin. */
const GROWTH_ALONG = 140;

/** The junction, then points every 4 m along the street network out from it (through its joins), nearest first. */
function exitStarts(streets: readonly StreetEdge[], nodeId: string, at: XZ): { at: XZ; along: number }[] {
  const starts: { at: XZ; along: number }[] = [{ at, along: 0 }];
  const reached = new Map<string, number>([[nodeId, 0]]), queue: string[] = [nodeId];
  while (queue.length) {
    const from = queue.shift()!, base = reached.get(from)!;
    for (const street of streets) {
      if (street.from !== from && street.to !== from) continue;
      const points = street.from === from ? street.points : [...street.points].reverse(), other = street.from === from ? street.to : street.from;
      let along = base, next = Math.ceil((base + 1e-9) / 4) * 4;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!, b = points[i]!, length = Math.hypot(b[0] - a[0], b[2] - a[2]);
        while (next <= along + length && next <= GROWTH_ALONG) {
          const t = length ? (next - along) / length : 0;
          starts.push({ at: [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t], along: next });
          next += 4;
        }
        along += length;
      }
      if (along < GROWTH_ALONG && along < (reached.get(other) ?? Infinity)) { reached.set(other, along); queue.push(other); }
    }
  }
  return starts.sort((p, q) => p.along - q.along);
}
const RING_EXIT_CLEAR = 3.5;
/**
 * Drum (radius, offset outward from the wall line), best first: proud of the curtain where there is room, flush
 * otherwise, standing into the town where the wall runs close against the region's edge, and a slim turret where
 * nothing broader has room.
 */
const TOWER_VARIANTS = [[3.75, 2.25], [3.25, 1.75], [3.25, 0.25], [2.75, 0], [3.25, -1.75], [2.75, -1.5], [2.5, -2.75], [2.25, 1.5], [2.25, 2.5]] as const;
const GATE_TOWER_VARIANTS = [[GATE_TOWER_RADIUS, 0.75], [2.5, 0.75], [GATE_TOWER_RADIUS, 2], [2.5, 2.25], [GATE_TOWER_RADIUS, -0.75], [2.5, -1]] as const;
/** A growth exit within this of a street crossing shares the street's gate. */
const GROWTH_SHARE = 30;

/** Growth exits through `path` that need a gate of their own; those a street gate already serves go to `served`. */
function growthCrossings(path: Path, exits: readonly StreetEdge[], real: readonly Crossing[], served: Crossing[]): Crossing[] {
  const found: Crossing[] = [];
  for (const exit of exits) {
    const a: XZ = [exit.points[1]![0], exit.points[1]![2]], b: XZ = [exit.points[2]![0], exit.points[2]![2]];
    for (let k = 1; k < path.points.length; k++) {
      const t = crossing(path.points[k - 1]!, path.points[k]!, a, b);
      if (t === null) continue;
      const s = path.lengths[k - 1]! + t * (path.lengths[k]! - path.lengths[k - 1]!);
      // A real street already leaves close by: its gate serves the growth too.
      if (real.some(c => Math.abs(c.s - s) < GROWTH_SHARE)) served.push({ s, street: exit }); else found.push({ s, street: exit });
      break;
    }
  }
  return found;
}

/** Gates on every street crossing, towers at corners and every ~50 m, and the stretches of curtain between them. */
export function layoutWalls(context: WallLayoutContext): WallLayout {
  const { site, ring } = context;
  const gates: PlannedGate[] = [], towers: PlannedTower[] = [], stretches: Stretch[] = [], wallLines: XZ[][] = [];
  const spans = ring.spans, exits = growthExits(context);
  const crossingsAll = (path: Path, served: Crossing[] = []) => {
    const real = crossingsOf(path, site);
    return [...real, ...growthCrossings(path, exits, real, served)].sort((p, q) => p.s - q.s || p.street.id.localeCompare(q.street.id));
  };
  spans.forEach((span, index) => {
    if (span.kind !== 'wall') return;
    let points = span.points;
    if (ring.cyclic) {
      // Put the seam in the middle of the longest stretch between crossings, so no gate straddles it.
      const closed = new Path(points), found = crossingsAll(closed);
      if (found.length) {
        let best = 0, seam = 0;
        for (let k = 0; k < found.length; k++) {
          const s = found[k]!.s, next = k + 1 < found.length ? found[k + 1]!.s : found[0]!.s + closed.total, gap = next - s;
          if (gap > best) { best = gap; seam = (s + gap / 2) % closed.total; }
        }
        const loop = points.slice(0, -1), lengths = closed.lengths;
        let at = 0;
        while (at < loop.length - 1 && lengths[at + 1]! <= seam) at++;
        points = [...loop.slice(at), ...loop.slice(0, at), loop[at]!];
      }
    }
    const path = new Path(points);
    const startKind: NodeKind = ring.cyclic ? 'seam' : spans[(index - 1 + spans.length) % spans.length]!.kind;
    const endKind: NodeKind = ring.cyclic ? 'seam' : spans[(index + 1) % spans.length]!.kind;
    const served: Crossing[] = [], solutions = clusterGates(path, crossingsAll(path, served), ring.ringClear);
    // A growth exit beside a street gate leaves through that gate: it is recorded there and keeps the opening as solved.
    for (const growth of served) {
      let best: GateSolution | null = null, distance = GROWTH_SHARE;
      for (const solution of solutions) {
        const d = Math.max(solution.from - growth.s, growth.s - solution.to, 0);
        if (d < distance || (d === distance && !best)) { best = solution; distance = d; }
      }
      if (best && !best.streets.some(street => street.id === growth.street.id)) best.streets.push(growth.street);
    }

    const spanGates = solutions.map((solution, k) => {
      const id = `gate:${gates.length + k}`;
      return planGate(context, id, solution);
    });
    gates.push(...spanGates);
    // Seam tower for an unbroken circuit: one drum shared by both ends.
    let seamTower: PlannedTower | null = null;
    if (startKind === 'seam') {
      const t = path.tangent(0, 4), n = outward(t);
      for (const [radius, out] of TOWER_VARIANTS) {
        const centre: XZ = [snap(path.points[0]![0] + n[0] * out), snap(path.points[0]![1] + n[1] * out)];
        if (context.towerFits(centre, radius)) { seamTower = { id: '', shape: context.tower(`seam:${index}`, centre, t, radius, true), standalone: true }; break; }
      }
      if (seamTower) towers.push(seamTower);
    }

    // Bays between gates; the curtain runs straight into each gate's flanks.
    interface Bay { points: XZ[]; start: NodeKind; end: NodeKind }
    const bays: Bay[] = [], line: XZ[] = [];
    let cursor = 0, cursorKind: NodeKind = startKind, cursorPoint: XZ = path.points[0]!;
    const between = (from: number, to: number) => path.points.filter((_, k) => path.lengths[k]! > from && path.lengths[k]! < to);
    solutions.forEach((solution, k) => {
      const gate = spanGates[k]!, { from, to } = solution;
      if (from > cursor + 1.5) bays.push({ points: [cursorPoint, ...between(cursor + 1.5, from - 1.5), gate.flanks[0]], start: cursorKind, end: 'gate' });
      cursor = to; cursorKind = 'gate'; cursorPoint = gate.flanks[1];
    });
    if (path.total > cursor + 1.5) bays.push({ points: [cursorPoint, ...between(cursor + 1.5, path.total), path.points.at(-1)!], start: cursorKind, end: endKind });
    // The final centre line, gates included.
    {
      let at = 0;
      for (const [k, solution] of solutions.entries()) {
        line.push(...path.points.filter((_, j) => path.lengths[j]! >= at && path.lengths[j]! < solution.from - 1.5));
        line.push(...spanGates[k]!.flanks);
        at = solution.to + 1.5;
      }
      line.push(...path.points.filter((_, j) => path.lengths[j]! >= at));
      wallLines.push(line);
    }

    for (const bay of bays) {
      const bp = new Path(bay.points), L = bp.total;
      if (L < 1) continue;
      const anchors: number[] = [0, L], placed: { s: number; tower: PlannedTower }[] = [];
      const attempt = (label: string, s: number, slides: readonly number[]): boolean => {
        for (const slide of slides) {
          const at = s + slide;
          if (at < 0 || at > L) continue;
          if (anchors.some(anchor => Math.abs(anchor - at) < 12 && !(anchor === 0 && s === 0) && !(anchor === L && s === L))) continue;
          const p = bp.at(at), t = bp.tangent(at, 4), n = outward(t);
          for (const [radius, out] of TOWER_VARIANTS) {
            const centre: XZ = [snap(p[0] + n[0] * out), snap(p[1] + n[1] * out)];
            if (!context.towerFits(centre, radius)) continue;
            const tower: PlannedTower = { id: '', shape: context.tower(`${label}:${index}:${Math.round(at * 4)}`, centre, t, radius, true), standalone: true };
            placed.push({ s: at, tower }); anchors.push(at);
            return true;
          }
        }
        return false;
      };
      if (bay.start === 'water' || bay.start === 'open') attempt('end', 0, [0, 1.5, 3, 4.5, 6, 8]);
      if (bay.end === 'water' || bay.end === 'open') attempt('end', L, [0, -1.5, -3, -4.5, -6, -8]);
      // Corners: where the wall turns most, a tower rounds it.
      const corners: { s: number; turn: number }[] = [];
      for (let s = 6; s <= L - 6; s += 1) {
        const turn = Math.abs(angleBetween(bp.tangent(s - 4, 4), bp.tangent(s + 4, 4)));
        if (turn >= CORNER_TURN) corners.push({ s, turn });
      }
      corners.sort((p, q) => q.turn - p.turn || p.s - q.s);
      for (const corner of corners) if (anchors.every(anchor => Math.abs(anchor - corner.s) >= MIN_TOWER_GAP)) attempt('corner', corner.s, [0, 2, -2, 4, -4]);
      // Fill long curtains.
      const sorted = [...anchors].sort((p, q) => p - q);
      for (let k = 1; k < sorted.length; k++) {
        const a = sorted[k - 1]!, b = sorted[k]!, gap = b - a, count = Math.ceil(gap / TOWER_SPACING) - 1;
        for (let j = 1; j <= count; j++) attempt('run', a + gap * j / (count + 1), [0, 3, -3, 6, -6, 9, -9, 12, -12, 15, -15]);
      }
      placed.sort((p, q) => p.s - q.s);
      for (const { tower } of placed) towers.push(tower);
      // Stretches of curtain between nodes.
      const nodes: { s: number; kind: NodeKind }[] = [{ s: 0, kind: bay.start }, ...placed.map(p => ({ s: p.s, kind: 'tower' as NodeKind })), { s: L, kind: bay.end }];
      const at0 = placed.some(p => p.s === 0), atL = placed.some(p => p.s === L);
      for (let k = 1; k < nodes.length; k++) {
        const a = nodes[k - 1]!, b = nodes[k]!;
        if (b.s - a.s < 0.5) continue;
        const reach = (kind: NodeKind, towered: boolean) => kind === 'castle' ? 1.5 : kind === 'seam' && !(towered || seamTower) ? 0.6 : 0;
        const slice = bp.slice(a.s, b.s);
        stretches.push({
          id: `wall:${stretches.length}`, path: new Path(slice),
          before: k === 1 ? reach(a.kind, at0) : 0, after: k === nodes.length - 1 ? reach(b.kind, atL) : 0,
          walkHeight: quarter(WALK_HEIGHT + 0.75 * context.unit(`walk:${stretches.length}`)),
          phase: context.unit(`phase:${stretches.length}`) * 1.75,
        });
      }
    }
    for (const gate of spanGates) gate.shape.towers.forEach((tower, k) =>
      towers.push({ id: `${gate.id}:${gate.towerSides[k]!}`, shape: tower, gateId: gate.id, standalone: gate.kind === 'open' }));
  });
  // Number the wall towers around the ring.
  let n = 0;
  const numbered = towers.map(tower => tower.gateId ? tower : { ...tower, id: `tower:${n++}` });
  return { gates, towers: numbered, stretches, wallLines };
}

function planGate(context: WallLayoutContext, id: string, solution: GateSolution): PlannedGate {
  const { site, options, kit } = context, ground = options.ground;
  const t = solution.tangent, n = outward(t), half = solution.width / 2, c = solution.centre;
  let streetTop = -Infinity, low = Infinity, high = -Infinity;
  for (let a = -half; a <= half + 1e-6; a += 0.5) for (let b = -GATE_DEPTH; b <= GATE_DEPTH + 1e-6; b += 0.5) {
    const x = c[0] + t[0] * a + n[0] * b, z = c[1] + t[1] * a + n[1] * b;
    streetTop = Math.max(streetTop, ground(x, z));
    for (const hit of site.corridorsAt(x, z, 0)) streetTop = Math.max(streetTop, hit.y);
  }
  for (let a = -solution.reach; a <= solution.reach + 1e-6; a += 1) for (const b of [-GATE_DEPTH - 0.25, 0, GATE_DEPTH + 0.25]) {
    const g = ground(c[0] + t[0] * a + n[0] * b, c[1] + t[1] * a + n[1] * b);
    low = Math.min(low, g); high = Math.max(high, g);
  }
  const spring = Math.ceil((streetTop + GATE_HEADROOM) / 0.125) * 0.125, rise = quarter(Math.min(1.5, solution.width / 4));
  const top = Math.ceil((spring + rise + 2.75) / 0.25) * 0.25;
  const kind = solution.width <= MAX_ARCH ? 'arch' : 'open';
  const flanks: [XZ, XZ] = [[c[0] - t[0] * solution.reach, c[1] - t[1] * solution.reach], [c[0] + t[0] * solution.reach, c[1] + t[1] * solution.reach]];
  const towerShapes: TowerShape[] = [], towerSides: ('a' | 'b')[] = [];
  flanks.forEach((flank, side) => {
    for (const [radius, out] of GATE_TOWER_VARIANTS) {
      const centre: XZ = [snap(flank[0] + n[0] * out - t[0] * (GATE_TOWER_RADIUS - radius) * (side ? -1 : 1)), snap(flank[1] + n[1] * out - t[1] * (GATE_TOWER_RADIUS - radius) * (side ? -1 : 1))];
      if (!context.towerFits(centre, radius)) continue;
      towerShapes.push(context.tower(`${id}:${side}`, centre, t, radius, true, top + 2.5));
      towerSides.push(side ? 'b' : 'a');
      break;
    }
  });
  const streets = solution.streets.filter(street => !street.id.startsWith(GROWTH_PREFIX))
    .sort((p, q) => q.width + 2 * q.verge - (p.width + 2 * p.verge) || p.id.localeCompare(q.id));
  const growth = solution.streets.filter(street => street.id.startsWith(GROWTH_PREFIX)).map(street => street.from).sort();
  const shape: GateShape = {
    centre: c, tangent: t, normal: n, width: solution.width, reach: solution.reach, depth: GATE_DEPTH,
    base: Math.floor((low - 0.5) / 0.125) * 0.125, plinthTop: Math.ceil((high + 0.5) / 0.25) * 0.25,
    spring, rise, top, kit, towers: towerShapes, headroom: CORRIDOR_HEADROOM,
  };
  return { id, streetIds: streets.map(s => s.id), streetId: streets[0]?.id ?? `${GROWTH_PREFIX}${growth[0]!}`, growthNodeIds: growth, shape, kind, streetTop, flanks, towerSides };
}
