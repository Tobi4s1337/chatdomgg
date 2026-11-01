import type { Vec3 } from '@chatdom/shared';
import type { SettlementPlan } from '@chatdom/world';
import type { SpectaclePlaces } from './spectacle';

/**
 * The festival's places in a real kingdom, all from its adopted public plan and the ground the scene draws: the
 * dragon's lair in the low ground behind the castle hill (so it rises over the castle's shoulder when it wakes), the
 * festival train's ring round the whole town, its castle and its lake (never across a lot, a wall or the water), and
 * bunting strung over the streets round the market. Nothing here allocates a home or edits the town; it only says
 * where the festival may stand. Pure and deterministic for a plan and a ground sampler.
 */
export type GroundSampler = (x: number, z: number) => number;

export interface FestivalPlaces {
  readonly lair: { readonly position: Vec3; readonly facing: Vec3 } | null;
  readonly track: readonly Vec3[] | null;
  readonly bunting: readonly (readonly Vec3[])[];
}

/** Ring samples round the town, metres kept clear of every lot, the castle and the shore, and the bunting's cap. */
export const FESTIVAL = { ringSamples: 240, clearance: 11, shore: 1.22, buntingRuns: 14, eave: 4.4, lairReach: [44, 190] as const } as const;

const TAU = Math.PI * 2;

export function festivalPlacesOf(plan: SettlementPlan, ground: GroundSampler): FestivalPlaces {
  const at = (x: number, z: number): Vec3 | null => { const y = ground(x, z); return Number.isFinite(y) ? [x, y, z] : null; };
  const track = ringOf(plan, at);
  return { track, lair: lairOf(plan, ground, track), bunting: buntingOf(plan) };
}

/** Main's places, with the festival's filling only what main does not supply itself. */
export function withFestivalPlaces(base: SpectaclePlaces, festival: FestivalPlaces): SpectaclePlaces {
  return {
    ...base,
    lair: () => base.lair() ?? festival.lair,
    track: () => base.track() ?? festival.track,
    bunting: () => { const own = base.bunting(); return own.length ? own : festival.bunting; },
  };
}

/**
 * The ring: for every bearing from the town's middle, the farthest corner of anything it must pass outside (lots,
 * the castle's bounds, the lake's shore) plus a clearance, widened over neighbouring bearings and then averaged over
 * a narrower window, so the line is smooth and never cuts inside what it skirts. Laid on the scene's ground.
 */
function ringOf(plan: SettlementPlan, at: (x: number, z: number) => Vec3 | null): Vec3[] | null {
  const obstacles: [number, number][] = [];
  const box = (b: { minX: number; maxX: number; minZ: number; maxZ: number }) => {
    for (let i = 0; i <= 4; i++) {
      const u = i / 4;
      obstacles.push([b.minX + (b.maxX - b.minX) * u, b.minZ], [b.minX + (b.maxX - b.minX) * u, b.maxZ], [b.minX, b.minZ + (b.maxZ - b.minZ) * u], [b.maxX, b.minZ + (b.maxZ - b.minZ) * u]);
    }
  };
  for (const r of plan.reservations) box(r.lot);
  if (!obstacles.length) return null;
  box(plan.castle.bounds);
  for (const square of [plan.market, ...plan.courts]) for (const [x, z] of square.boundary) obstacles.push([x, z]);
  const lake = plan.lake;
  if (lake.radiusX > 0 && lake.radiusZ > 0) for (let i = 0; i < 48; i++) {
    const a = i / 48 * TAU;
    obstacles.push([lake.x + Math.cos(a) * lake.radiusX * FESTIVAL.shore, lake.z + Math.sin(a) * lake.radiusZ * FESTIVAL.shore]);
  }
  const lots = plan.reservations.map(r => r.lot);
  const cx = (Math.min(...lots.map(l => l.minX)) + Math.max(...lots.map(l => l.maxX))) / 2;
  const cz = (Math.min(...lots.map(l => l.minZ)) + Math.max(...lots.map(l => l.maxZ))) / 2;
  const n = FESTIVAL.ringSamples, raw = new Float64Array(n);
  for (const [x, z] of obstacles) {
    const k = Math.round(((Math.atan2(z - cz, x - cx) / TAU + 1) % 1) * n) % n;
    raw[k] = Math.max(raw[k]!, Math.hypot(x - cx, z - cz) + FESTIVAL.clearance);
  }
  // Widen over ±6 bearings (a lot's far corner shades its neighbours), then average over ±4: never below the raw need.
  const window = (src: Float64Array, w: number, reduce: (values: number[]) => number) => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) { const vs: number[] = []; for (let j = -w; j <= w; j++) vs.push(src[(i + j + n) % n]!); out[i] = reduce(vs); }
    return out;
  };
  let r = window(raw, 6, vs => Math.max(...vs));
  for (let pass = 0; pass < 2; pass++) r = window(r, 4, vs => vs.reduce((s, v) => s + v, 0) / vs.length);
  let ring: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, p = at(cx + Math.cos(a) * r[i]!, cz + Math.sin(a) * r[i]!);
    if (!p) return null;
    ring.push(p);
  }
  // Ease the rails over the ground: a train does not ride every bump of the land, nor dip below it.
  for (let pass = 0; pass < 3; pass++) {
    const ys = ring.map(p => p[1]);
    ring = ring.map((p, i): Vec3 => [p[0], Math.max(ys[i]!, (ys[(i - 1 + n) % n]! + 2 * ys[i]! + ys[(i + 1) % n]!) / 4), p[2]]);
  }
  return ring;
}

/**
 * The lair: the lowest ground in a fan behind the castle, away from the homes, beyond the ring — the hollow behind
 * the castle hill. From the town it lies out of sight; when it wakes it rises over the castle's shoulder.
 */
function lairOf(plan: SettlementPlan, ground: GroundSampler, track: readonly Vec3[] | null): FestivalPlaces['lair'] {
  const homes = plan.homes.length ? plan.homes.map(h => h.position) : plan.reservations.map(r => r.position);
  if (!homes.length) return null;
  const hx = homes.reduce((s, p) => s + p[0], 0) / homes.length, hz = homes.reduce((s, p) => s + p[2], 0) / homes.length;
  const [kx, , kz] = plan.castle.centre;
  let ax = kx - hx, az = kz - hz;
  const len = Math.hypot(ax, az);
  if (len < 1e-3) { ax = 0; az = -1; } else { ax /= len; az /= len; }
  const clearOfTrack = (x: number, z: number) => !track || track.every(p => Math.hypot(p[0] - x, p[2] - z) > 26);
  const homeClear = (x: number, z: number) => homes.every(p => Math.hypot(p[0] - x, p[2] - z) > 50);
  let best: { x: number; z: number; y: number; score: number } | null = null;
  const [near, far] = FESTIVAL.lairReach;
  for (let d = near; d <= far; d += 6) for (const side of [0, -0.25, 0.25, -0.5, 0.5]) {
    const x = kx + ax * d - az * side * d, z = kz + az * d + ax * side * d, y = ground(x, z);
    if (!Number.isFinite(y) || !clearOfTrack(x, z) || !homeClear(x, z)) continue;
    // Low ground, near the middle of the fan, not too far to fly home from.
    const score = y + Math.abs(side) * 6 + Math.max(0, d - 110) * 0.06;
    if (!best || score < best.score) best = { x, z, y, score };
  }
  if (!best) return null;
  return { position: [best.x, best.y, best.z], facing: [hx - best.x, 0, hz - best.z] };
}

/** Bunting over the active main streets and lanes nearest the market, at eave height, bounded. */
function buntingOf(plan: SettlementPlan): Vec3[][] {
  const market = plan.nodes.find(node => node.id === plan.market.nodeId)?.position;
  if (!market) return [];
  const active = new Set(plan.activeStreetIds);
  const reach = (points: readonly Vec3[]) => Math.min(...points.map(p => Math.hypot(p[0] - market[0], p[2] - market[2])));
  return plan.streets.filter(st => active.has(st.id) && (st.kind === 'main' || st.kind === 'lane') && st.points.length > 1)
    .map(st => ({ st, d: reach(st.points) })).sort((a, b) => a.d - b.d || (a.st.id < b.st.id ? -1 : 1)).slice(0, FESTIVAL.buntingRuns)
    .map(({ st }) => st.points.map(p => [p[0], p[1] + FESTIVAL.eave, p[2]] as Vec3));
}
