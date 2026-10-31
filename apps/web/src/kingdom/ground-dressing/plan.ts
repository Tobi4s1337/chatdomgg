import { createStreetProp } from '@chatdom/content';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import {
  currentFootprint, homeFrame, randomUnit, samplePublicGround, seedHash,
  type CardinalTurn, type KingdomLand, type KingdomTier, type SettlementHome, type SettlementPlan, type XZ,
} from '@chatdom/world';
import { createDressing, DRESSING_ROLES, DRESSING_FORMS, type DressingForm } from '../../../../../packages/content/src/props/dressing';

const CELL = 0.125;

export interface GroundPiece {
  id: string; blueprint: VoxelBlueprint; position: Vec3; yaw: number; lotSlot?: number;
  /**
   * Ground gradient (dy/dx, dy/dz) under passive cover. The mount shears the patch onto that plane so every tuft
   * stands upright from a slope instead of floating over its low side. Absent on structural pieces, which sit level.
   */
  slope?: readonly [number, number];
}
export interface GroundBlocker extends GroundPiece { turn: CardinalTurn }
export interface GroundDressingInput {
  land: KingdomLand; seed: string; tier: KingdomTier;
  ground(x: number, z: number): number;
  waterKeepOut(x: number, z: number, margin: number): boolean;
  occupied: readonly Pick<GroundPiece, 'blueprint' | 'position' | 'yaw'>[];
  keepClear: readonly { x: number; z: number; radius: number }[];
  keepOut?: readonly (readonly (readonly [number, number])[])[];
  footways?: readonly (readonly [number, number])[][];
}
export interface GroundDressingPlan {
  pieces: ReadonlyMap<string, readonly GroundPiece[]>;
  blockers: readonly GroundBlocker[];
  collisionPieces: readonly GroundBlocker[];
  seatAnchors: readonly { id: string; treeId: string; position: Vec3; yaw: number }[];
  report: { counts: Record<string, number>; homesWithVignette: number; omissions: readonly string[] };
}
export type GroundView = { eye: Vec3; target: Vec3 };
export type GroundViews = Record<'street' | 'garden' | 'edge' | 'ridge', GroundView>;

const roles = new WeakMap<VoxelBlueprint, { solid: boolean; cover: boolean; form: string }>();
/** Role of any blueprint this lane places: its own forms, plus the spec 06 rocks it may set in a drift. */
export function pieceRole(blueprint: VoxelBlueprint): { solid: boolean; cover: boolean; form: string } {
  const known = roles.get(blueprint);
  if (known) return known;
  const role = classify(blueprint);
  roles.set(blueprint, role);
  return role;
}
function classify(blueprint: VoxelBlueprint): { solid: boolean; cover: boolean; form: string } {
  const form = blueprint.id.replace(/^dressing-(?:(?:hearth|tide|grove)-)?/, '').replace(/^street-(?:hearth|tide)-/, '');
  if ((DRESSING_FORMS as readonly string[]).includes(form) && blueprint.id.startsWith('dressing-')) {
    const role = DRESSING_ROLES[form as DressingForm];
    return { solid: role.solid, cover: role.band === 'small', form };
  }
  if (blueprint.id.startsWith('street-')) return { solid: true, cover: false, form };
  throw new Error(`Ground dressing does not place ${blueprint.id}.`);
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry helpers

interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
/** World corners of a blueprint's footprint; yaw follows three.js: local (x, z) → (x cos + z sin, −x sin + z cos). */
export function footprintCorners(blueprint: Pick<VoxelBlueprint, 'size'>, position: Vec3, yaw: number, inset = 0): XZ[] {
  const c = Math.cos(yaw), s = Math.sin(yaw), w = blueprint.size[0] * CELL, d = blueprint.size[2] * CELL;
  return [[inset, inset], [w - inset, inset], [w - inset, d - inset], [inset, d - inset]].map(([a, b]) =>
    [position[0] + c * a! + s * b!, position[2] - s * a! + c * b!] as const);
}
function boundsOf(points: readonly XZ[]): Rect {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  return { minX, maxX, minZ, maxZ };
}
const grow = (r: Rect, a: number): Rect => ({ minX: r.minX - a, maxX: r.maxX + a, minZ: r.minZ - a, maxZ: r.maxZ + a });
const overlaps = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
function rectDistance(r: Rect, x: number, z: number): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX), dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return dx || dz ? Math.hypot(dx, dz) : -Math.min(x - r.minX, r.maxX - x, z - r.minZ, r.maxZ - z);
}
function segmentDistance(a: XZ, b: XZ, x: number, z: number): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length)) : 0;
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}
/** Signed distance to a polygon: negative inside. */
export function polygonDistance(polygon: readonly XZ[], x: number, z: number): number {
  let inside = false, distance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!, b = polygon[i]!;
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    distance = Math.min(distance, segmentDistance(a, b, x, z));
  }
  return inside ? -distance : distance;
}

/** A deterministic broad-phase over rectangles in 8 m buckets. */
class RectIndex<T extends { rect: Rect }> {
  private readonly buckets = new Map<number, T[]>();
  add(item: T): void {
    for (let z = Math.floor(item.rect.minZ / 8); z <= Math.floor(item.rect.maxZ / 8); z++)
      for (let x = Math.floor(item.rect.minX / 8); x <= Math.floor(item.rect.maxX / 8); x++) {
        const key = (x + 4096) * 8192 + z + 4096, list = this.buckets.get(key);
        if (list) list.push(item); else this.buckets.set(key, [item]);
      }
  }
  private readonly stamps = new Map<T, number>();
  private stamp = 0;
  /** Items whose rectangles may lie within `reach` of the query rectangle; each item at most once. */
  near(rect: Rect, reach: number, visit: (item: T) => boolean | void): boolean {
    const stamp = ++this.stamp;
    for (let z = Math.floor((rect.minZ - reach) / 8); z <= Math.floor((rect.maxZ + reach) / 8); z++)
      for (let x = Math.floor((rect.minX - reach) / 8); x <= Math.floor((rect.maxX + reach) / 8); x++) {
        const bucket = this.buckets.get((x + 4096) * 8192 + z + 4096);
        if (!bucket) continue;
        for (const item of bucket) {
          if (this.stamps.get(item) === stamp) continue;
          this.stamps.set(item, stamp);
          if (visit(item) === true) return true;
        }
      }
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Planting context: everything a placement must clear, prepared once per plan.

interface HomeArea {
  home: SettlementHome; rect: Rect; lot: Rect;
  front: Vec3; right: Vec3; outward: Vec3;
  /** Depth of the forecourt from the facade to the street's paving. */
  apron: number;
}
interface Context {
  input: GroundDressingInput; plan: SettlementPlan;
  areas: readonly HomeArea[];
  homes: RectIndex<HomeArea & { rect: Rect }>;
  lots: RectIndex<{ rect: Rect; id: string; slot?: number; home?: HomeArea }>;
  occupied: RectIndex<{ rect: Rect; corners: readonly XZ[] }>;
  polygons: (readonly XZ[])[];
  castle: Rect;
  rand(...parts: (string | number)[]): number;
}

function prepare(input: GroundDressingInput): Context {
  const plan = input.land.plan;
  const homes = new RectIndex<HomeArea & { rect: Rect }>(), lots = new RectIndex<{ rect: Rect; id: string; slot?: number; home?: HomeArea }>();
  const bySlot = new Map<number, HomeArea>(), areas: HomeArea[] = [];
  for (const home of plan.homes) {
    const { front, right, outward } = homeFrame(home);
    let apron = 0;
    for (; apron < 10; apron += 0.25) {
      const s = samplePublicGround(plan, front[0] + outward[0] * apron, front[2] + outward[2] * apron);
      if (s && s.pavingDistance <= 0 && s.kind !== 'forecourt' && s.kind !== 'approach') break;
    }
    const area: HomeArea = { home, rect: currentFootprint(home), lot: home.lot, front, right, outward, apron };
    homes.add(area); bySlot.set(home.slot, area); areas.push(area);
  }
  for (const reservation of plan.reservations) {
    const home = plan.homes.find(h => h.id === reservation.id);
    const area = home ? bySlot.get(home.slot) : undefined;
    lots.add({ rect: reservation.lot, id: reservation.id, ...(home ? { slot: home.slot } : {}), ...(area ? { home: area } : {}) });
  }
  const occupied = new RectIndex<{ rect: Rect; corners: readonly XZ[] }>();
  for (const piece of input.occupied) {
    const corners = footprintCorners(piece.blueprint, piece.position, piece.yaw);
    occupied.add({ rect: boundsOf(corners), corners });
  }
  const polygons: (readonly XZ[])[] = [plan.market.boundary, ...plan.courts.map(c => c.boundary), plan.castle.court.boundary,
    input.land.places.court.boundary, ...input.land.sites.map(site => site.footprint), ...(input.keepOut ?? [])];
  return {
    input, plan, areas, homes, lots, occupied, polygons, castle: plan.castle.bounds,
    rand: (...parts) => randomUnit(seedHash(`${input.seed}:${input.tier}:ground:${parts.join(':')}`)),
  };
}

/**
 * Distance to the nearest facade or paved edge: the density driver of R3. Facades are measured to the whole lot,
 * which never moves, so a home growing deeper changes nothing outside its own lot.
 */
function edgeDistance(ctx: Context, x: number, z: number, sample = samplePublicGround(ctx.plan, x, z)): number {
  let d = sample ? Math.max(0, sample.pavingDistance) : Infinity;
  ctx.lots.near({ minX: x, maxX: x, minZ: z, maxZ: z }, Math.min(d, 40), lot => { d = Math.min(d, Math.max(0, rectDistance(lot.rect, x, z))); });
  return d;
}

/** The front garden beside one door, toward its neighbour on the same street when there is one. */
interface ForecourtStrip {
  a: HomeArea; b?: HomeArea;
  /** Unit direction along the street, from a's door toward b's. */
  u: XZ;
  /** The free span along `u` from a's front centre: from the edge of a's entrance band to the edge of b's. */
  from: number; to: number;
  /** Where along `u` the open gap between the two lots runs, midway between their lot lines. */
  gap: number;
  /** Depth from the facades to the street's paving, the shallower of the two. */
  apron: number;
  /** World point `along` metres along the strip and `out` metres out from a's facade. */
  at(along: number, out: number): XZ;
}
function forecourtStrip(ctx: Context, a: HomeArea, side: 1 | -1): ForecourtStrip {
  const u: XZ = [a.right[0] * side, a.right[2] * side];
  let b: HomeArea | undefined, along = Infinity;
  // A neighbour faces the same way with its front on the same line, one lot and its gap along.
  ctx.homes.near({ minX: a.front[0], maxX: a.front[0], minZ: a.front[2], maxZ: a.front[2] }, 12, other => {
    if (other === a || other.outward[0] !== a.outward[0] || other.outward[2] !== a.outward[2]) return;
    const dx = other.front[0] - a.front[0], dz = other.front[2] - a.front[2], t = dx * u[0] + dz * u[1];
    if (Math.abs(dx * a.outward[0] + dz * a.outward[2]) < 0.5 && t >= 8 && t <= 11.5 && t < along) { b = other; along = t; }
  });
  // Entrance bands are centred 0.25 m toward -right of each front centre and reach 2 m either way.
  const from = -0.25 * side + 2.1, to = b ? along - 0.25 * side - 2.1 : 4;
  return {
    a, ...(b ? { b } : {}), u, from, to, gap: b ? along / 2 : 4, apron: b ? Math.min(a.apron, b.apron) : a.apron,
    at: (t, out) => [a.front[0] + u[0] * t + a.outward[0] * out, a.front[2] + u[1] * t + a.outward[2] * out],
  };
}

interface Candidate { blueprint: VoxelBlueprint; centre: XZ; yaw: number }
interface Fit { position: Vec3; slope?: readonly [number, number] }

/**
 * Every clearance rule of R3 for one footprint. Returns the grounded placement, or a reason it cannot stand.
 * Cover is sheared onto the fitted ground plane (≤35°); structural pieces need level ground (≤0.125 m relief).
 */
function fit(ctx: Context, { blueprint, centre, yaw }: Candidate, lot: string | undefined): Fit | string {
  const role = pieceRole(blueprint), height = blueprint.size[1] * CELL;
  const [cx, cz] = centre, c = Math.cos(yaw), s = Math.sin(yaw), w = blueprint.size[0] * CELL, d = blueprint.size[2] * CELL;
  const origin: XZ = [cx - (c * w / 2 + s * d / 2), cz - (-s * w / 2 + c * d / 2)];
  const position: [number, number, number] = [origin[0], 0, origin[1]];
  // Content keeps one cell clear of its box edge; test the box itself, so the margin is spare.
  const corners = footprintCorners(blueprint, position, yaw), rect = boundsOf(corners);
  const radius = Math.hypot(w, d) / 2;
  const { input, plan } = ctx;
  if (rect.minX < plan.bounds.minX + 1 || rect.maxX > plan.bounds.maxX - 1 || rect.minZ < plan.bounds.minZ + 1 || rect.maxZ > plan.bounds.maxZ - 1) return 'outside the detailed land';
  // Lots: a placement belongs wholly to one lot, or wholly to the open ground outside every lot.
  if (ctx.lots.near(rect, 0, item => overlaps(item.rect, rect) && item.id !== lot)) return 'crosses a lot line';
  if (lot) {
    const own = ctx.lots.near(rect, 0, item => item.id === lot && rect.minX >= item.rect.minX && rect.maxX <= item.rect.maxX && rect.minZ >= item.rect.minZ && rect.maxZ <= item.rect.maxZ);
    if (!own) return 'leaves its lot';
  }
  // Homes: never on the current footprint; solids keep 1.5 m.
  if (ctx.homes.near(rect, 2, area => overlaps(grow(area.rect, role.solid ? 1.5 : 0.125), rect))) return 'on a home';
  // Forecourts: the entrance band stays empty; nothing taller than 0.6 m stands between a facade and its street.
  const forecourt = ctx.homes.near(rect, 12, area => {
    for (const [x, z] of [...corners, centre]) {
      const dx = x - area.front[0], dz = z - area.front[2];
      const out = dx * area.outward[0] + dz * area.outward[2], side = dx * area.right[0] + dz * area.right[2];
      if (out < -0.05 || out > area.apron + 0.5 || side < -4.75 || side > 4.75) continue;
      if (Math.abs(side + 0.25) < 2 || height > 0.6) return true;
    }
    return false;
  });
  if (forecourt) return 'in a forecourt or entrance band';
  if (ctx.occupied.near(rect, 2, item => overlaps(grow(item.rect, role.solid ? 1.5 : 0.25), rect))) return 'on an occupied placement';
  // Paving and verges: both are true distances, so one sample clears a whole disc around it. Split the box
  // into quarters only where a sample cannot vouch for its part (an exact, conservative quadtree).
  const clear = (key: 'pavingDistance' | 'reservedDistance', margin: number) => {
    const visit = (a0: number, a1: number, b0: number, b1: number, depth: number): boolean => {
      const a = (a0 + a1) / 2, b = (b0 + b1) / 2, half = Math.hypot(a1 - a0, b1 - b0) / 2;
      const sample = samplePublicGround(plan, origin[0] + c * a + s * b, origin[1] - s * a + c * b);
      const distance = sample ? sample[key] : Infinity;
      if (distance - margin >= half) return true;
      if (distance <= margin || depth >= 3) return false;
      return visit(a0, a, b0, b, depth + 1) && visit(a, a1, b0, b, depth + 1) && visit(a0, a, b, b1, depth + 1) && visit(a, a1, b, b1, depth + 1);
    };
    return visit(0, w, 0, d, 0);
  };
  if (!clear('pavingDistance', 0.3)) return 'on paving';
  if (role.solid && !clear('reservedDistance', 0.6)) return 'inside a street verge';
  // Castle: nothing inside its bounds; within 12 m only what stays under a metre.
  if (overlaps(ctx.castle, rect)) return 'inside the castle';
  if (height > 1 && overlaps(grow(ctx.castle, 12), rect)) return 'tall beside the castle';
  for (const polygon of ctx.polygons) if (polygonDistance(polygon, cx, cz) < radius + 0.25) return 'inside a square, court, site or keep-out';
  for (const circle of input.keepClear) if (rectDistance(rect, circle.x, circle.z) < circle.radius) return 'inside a keep-clear circle';
  if (input.waterKeepOut(cx, cz, radius + 0.75)) return 'in or beside water';
  // Ground: a 3×3 sample grid across the box, 5×5 under a level solid, whose lowest corner it must reach.
  const samples: { dx: number; dz: number; h: number }[] = [], grid = role.solid ? [0.02, 0.26, 0.5, 0.74, 0.98] : [0.1, 0.5, 0.9];
  for (const u of grid) for (const v of grid) {
    const a = w * u, b = d * v, x = origin[0] + c * a + s * b, z = origin[1] - s * a + c * b;
    samples.push({ dx: x - cx, dz: z - cz, h: input.ground(x, z) });
  }
  const mean = samples.reduce((n, p) => n + p.h, 0) / samples.length;
  if (role.solid) {
    const low = Math.min(...samples.map(p => p.h)), high = Math.max(...samples.map(p => p.h));
    if (high - low > 0.125) return 'ground too uneven for a level piece';
    // A centimetre under the lowest sample, so no corner between samples shows daylight.
    position[1] = low - 0.01;
    return { position };
  }
  const xx = samples.reduce((n, p) => n + p.dx * p.dx, 0), zz = samples.reduce((n, p) => n + p.dz * p.dz, 0);
  const gx = samples.reduce((n, p) => n + p.dx * (p.h - mean), 0) / xx, gz = samples.reduce((n, p) => n + p.dz * (p.h - mean), 0) / zz;
  if (Math.hypot(gx, gz) > Math.tan(35 * Math.PI / 180)) return 'slope over 35°';
  const residuals = samples.map(p => p.h - (mean + gx * p.dx + gz * p.dz));
  const spread = Math.max(...residuals) - Math.min(...residuals);
  if (spread > 0.2) return 'ground too broken for one patch';
  // Lower the plane to the lowest residual so no sampled tuft floats; a hair more hides the contact seam. Flush
  // stones (two courses) are bedded as deep as the relief allows while their worn lip still shows at the highest
  // point; at the lowest they stand at most a hand proud.
  const flush = role.form === 'stepping-stones';
  if (flush && spread > 0.14) return 'ground too broken for flush stones';
  const y = mean + Math.min(...residuals) - (flush ? Math.min(0.19, blueprint.size[1] * CELL - 0.02 - spread) : 0.03);
  position[1] = y + gx * (origin[0] - cx) + gz * (origin[1] - cz);
  return { position, slope: [gx, gz] };
}

// ---------------------------------------------------------------------------------------------------------------
// Composition

const COVER_FORMS = {
  tufts: 'meadow-tufts', clover: 'clover-pebbles', petal: 'wildflowers-petal', blue: 'wildflowers-blue',
  gold: 'wildflowers-gold', cream: 'wildflowers-cream', bed: 'seedling-bed',
} as const satisfies Record<string, DressingForm>;
type Bloom = 'petal' | 'blue' | 'gold' | 'cream';
/** Each kit's meadow leans to its own flower: heather pink and gold by the hearth, sea blue and cream by the tide. */
const BLOOMS: Record<SettlementHome['style'], readonly Bloom[]> = {
  hearth: ['petal', 'petal', 'gold', 'cream'], tide: ['blue', 'blue', 'cream', 'gold'], grove: ['gold', 'cream', 'petal', 'blue'],
};
/** Area per patch (m²) at distance d from the nearest facade or path edge (R3 density). */
export function patchArea(d: number): number {
  if (d < 6) return 4;
  if (d < 30) return 4 + (d - 6) / 24 * 12;
  return 16 + Math.min(1, (d - 30) / 10) * 24;
}

/** Smooth value noise in [0, 1] on a lattice of `scale` metres: the drift and clearing pattern of the meadow. */
function meadowNoise(ctx: Context, x: number, z: number, scale: number, salt: string): number {
  const gx = x / scale, gz = z / scale, ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
  const at = (a: number, b: number) => ctx.rand('noise', salt, a, b);
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  return (at(ix, iz) * (1 - sx) + at(ix + 1, iz) * sx) * (1 - sz) + (at(ix, iz + 1) * (1 - sx) + at(ix + 1, iz + 1) * sx) * sz;
}

interface Drift {
  id: string; centre: XZ; along: XZ; length: number; width: number; bloom: Bloom; lot?: string; slot?: number;
  /** A planted border: one close row along `along` in near-square turns, rather than a loose drift. Two patches make one. */
  row?: boolean;
}

const TIER_CAP: Record<KingdomTier, number> = { hamlet: 12_000, town: 40_000 };

/**
 * The pure placement plan (R3). Same land, seed, tier and host inputs give identical placements; randomness comes
 * only from `randomUnit(seedHash(...))` keyed by semantic place (grid cell, lot, drift), never iteration order.
 */
export function planGroundDressing(input: GroundDressingInput): GroundDressingPlan {
  const ctx = prepare(input), plan = ctx.plan;
  // One blueprint object per form for the whole plan: placements share it, and the mount batches by it.
  const COVER = Object.fromEntries(Object.entries(COVER_FORMS).map(([key, form]) => {
    const blueprint = createDressing(form);
    return [key, () => blueprint];
  })) as Record<keyof typeof COVER_FORMS, () => VoxelBlueprint>;
  const placed: GroundPiece[] = [], omissions: string[] = [];
  const blueprints = new Map<string, VoxelBlueprint>();
  const shared = (b: VoxelBlueprint) => { const known = blueprints.get(b.id); if (known) return known; blueprints.set(b.id, b); return b; };
  const lotOf = (x: number, z: number) => {
    let found: { id: string; slot?: number } | undefined;
    ctx.lots.near({ minX: x, maxX: x, minZ: z, maxZ: z }, 0, item => {
      if (x >= item.rect.minX && x < item.rect.maxX && z >= item.rect.minZ && z < item.rect.maxZ) { found = item; return true; }
      return false;
    });
    return found;
  };
  const tryPlace = (id: string, blueprint: VoxelBlueprint, centre: XZ, yaw: number, lot: { id: string; slot?: number } | undefined): boolean => {
    const result = fit(ctx, { blueprint, centre, yaw }, lot?.id);
    if (typeof result === 'string') return false;
    placed.push({ id, blueprint: shared(blueprint), position: result.position, yaw,
      ...(lot?.slot !== undefined ? { lotSlot: lot.slot } : {}), ...(result.slope ? { slope: result.slope } : {}) });
    return true;
  };
  // Measured to the lot, which never moves, so a home growing deeper never recolours a public drift.
  const nearestHome = (x: number, z: number, reach = 40): HomeArea | undefined => {
    let best: HomeArea | undefined, distance = reach;
    ctx.homes.near({ minX: x, maxX: x, minZ: z, maxZ: z }, reach, area => {
      const d = rectDistance(area.lot, x, z); if (d < distance) { distance = d; best = area; }
    });
    return best;
  };

  // 1. Forecourts. Two neighbouring fronts on one street share the garden strip between their doors; each strip
  //    is decided once, by the lower slot. Most strips carry one flower colour gathered under the windows, clear of
  //    both entrance bands, so a run of colour leads along the street to each door. Some are tended doorsteps
  //    (`placeDoorstep`): each neighbour's border in its own colour, a bed being planted and stones worn between
  //    the two doors. Old Row flowers and tends more than the newest street, and the arrival home is always tended.
  const drifts: Drift[] = [], reserved: { rect: Rect; trodden: boolean }[] = [];
  const oldest = Math.min(...plan.homes.map(h => h.quarterYear)), newest = Math.max(...plan.homes.map(h => h.quarterYear));
  const ageOf = (home: SettlementHome) => newest === oldest ? 1 : (newest - home.quarterYear) / (newest - oldest);
  const arrival = arrivalHome(plan);
  for (const area of [...ctx.areas].sort((a, b) => a.home.slot - b.home.slot)) {
    const { home } = area;
    for (const side of [-1, 1] as const) {
      const strip = forecourtStrip(ctx, area, side);
      if (strip.b && strip.b.home.slot < home.slot) continue;
      const key = `${home.slot}:${side}`, age = Math.max(ageOf(home), strip.b ? ageOf(strip.b.home) : 0);
      const tended = strip.b && (home === arrival || strip.b.home === arrival || ctx.rand('doorstep', key) < 0.12 + 0.28 * age);
      if (tended && placeDoorstep(strip, key)) continue;
      if (ctx.rand('forecourt', key) > 0.3 + 0.25 * age) continue;
      const blooms = BLOOMS[home.style], bloom = blooms[Math.floor(ctx.rand('forecourt-bloom', key) * blooms.length)]!;
      const out = 1.35 + (strip.apron - 1.65) / 2;
      // A lone front gathers its drift at the row end, just past its lot line.
      const u = strip.b ? (strip.from + strip.to) / 2 : 4.9;
      drifts.push({ id: `forecourt:${key}`, centre: strip.at(u, out), along: [area.right[0], area.right[2]],
        length: strip.b ? Math.min(3.8, strip.to - strip.from) : 2.6, width: Math.min(2.2, Math.max(1.2, strip.apron - 1.65)), bloom });
    }
  }

  /**
   * A tended doorstep strip: stepping stones worn from the street up the gap between the two houses, the way round
   * to the back gardens; on the older neighbour's side of them a bed being planted, and on the other side that
   * neighbour's own flowers lining the stones. Every part passes the same clearances as the rest of the plan;
   * returns false, planting nothing, when the strip cannot hold both the stones and the bed.
   */
  function placeDoorstep(strip: ForecourtStrip, key: string): boolean {
    const a = strip.a, b = strip.b!, id = `doorstep:${key}`, before = placed.length, reservedBefore = reserved.length;
    // Local +X of a form runs out toward the street; the gap between the two lots is the path's line.
    const inward = Math.atan2(-a.outward[2], a.outward[0]);
    const stones = shared(createDressing('stepping-stones', a.home.style)), bed = COVER.bed();
    const fail = (reason: string) => { omissions.push(`${id}: ${reason}; planted as a plain forecourt`); placed.length = before; reserved.length = reservedBefore; return false; };
    // The stones end a stride short of the street's paving and lean a touch off the straight, on the gap's line or
    // a hand or two either side of it, where a pot or shrub stands in the way or the two lots' grades meet in a step.
    const tilt = (ctx.rand(id, 'tilt') - 0.5) * 0.12;
    const gap = [0, -0.2, 0.2, -0.4, 0.4, -0.6, 0.6].map(offset => strip.gap + offset).find(u => tryPlace(`${id}:stones`, stones, strip.at(u, strip.apron - 1.8), inward + tilt, undefined));
    if (gap === undefined) return fail(`stones ${fit(ctx, { blueprint: stones, centre: strip.at(strip.gap, strip.apron - 1.8), yaw: inward + tilt }, undefined)}`);
    const laid = placed.at(-1)!;
    reserved.push({ rect: grow(boundsOf(footprintCorners(stones, laid.position, laid.yaw, CELL)), 0.12), trodden: true });
    // The bed lies along the stones on the older home's side, as far in as the facade's pots allow.
    const older = ageOf(b.home) > ageOf(a.home) ? 1 : -1, bedU = gap + older * 1.12;
    let bedPlaced = false;
    for (const v of [strip.apron - 1.85, strip.apron - 2.05, strip.apron - 1.65]) {
      if (tryPlace(`${id}:bed`, bed, strip.at(bedU, v), inward + (ctx.rand(id, 'bed') - 0.5) * 0.05, undefined)) { bedPlaced = true; break; }
    }
    if (!bedPlaced) return fail('no bed fits beside the stones');
    reserved.push({ rect: boundsOf(footprintCorners(bed, placed.at(-1)!.position, placed.at(-1)!.yaw, CELL)), trodden: false });
    // The other neighbour lines its side of the stones with its own flower, facade to street.
    const owner = older === 1 ? a.home : b.home, blooms = BLOOMS[owner.style];
    const bloom = blooms[Math.floor(ctx.rand(id, 'bloom') * blooms.length)]!, inner = 2.35, outer = strip.apron - 1.3;
    if (outer - inner > 0.4) drifts.push({ id: `${id}:border`, centre: strip.at(gap - older * 1.65, (inner + outer) / 2),
      along: [a.outward[0], a.outward[2]], length: outer - inner, width: 0.8, bloom, row: true });
    return true;
  }
  // Open-meadow drifts on a coarse jittered lattice: likelier near the town, never an even scatter.
  for (let gz = Math.floor(plan.bounds.minZ / 11); gz <= Math.floor(plan.bounds.maxZ / 11); gz++)
    for (let gx = Math.floor(plan.bounds.minX / 11); gx <= Math.floor(plan.bounds.maxX / 11); gx++) {
      const x = (gx + 0.15 + ctx.rand('drift-x', gx, gz) * 0.7) * 11, z = (gz + 0.15 + ctx.rand('drift-z', gx, gz) * 0.7) * 11;
      const near = edgeDistance(ctx, x, z);
      const chance = near < 8 ? 0.34 : near < 30 ? 0.24 : 0.12;
      if (ctx.rand('drift', gx, gz) > chance * (0.4 + meadowNoise(ctx, x, z, 26, 'drifts') * 1.2)) continue;
      const home = nearestHome(x, z, 60);
      const blooms = BLOOMS[home?.home.style ?? 'grove'], bloom = blooms[Math.floor(ctx.rand('drift-bloom', gx, gz) * blooms.length)]!;
      // Lean the drift along the nearest street, as wind and feet comb a verge; across open meadow it follows
      // the lie of the land in long low swathes.
      const angle = ctx.rand('drift-angle', gx, gz) * Math.PI;
      const lot = lotOf(x, z);
      drifts.push({ id: `drift:${gx}:${gz}`, centre: [x, z], along: [Math.cos(angle), Math.sin(angle)],
        length: 3 + ctx.rand('drift-length', gx, gz) * 3, width: 1.5 + ctx.rand('drift-width', gx, gz) * 1.2, bloom,
        ...(lot ? { lot: lot.id, ...(lot.slot !== undefined ? { slot: lot.slot } : {}) } : {}) });
    }
  /** Whether a cover patch centred here would tuft through a doorstep bed or stones. */
  const onReserved = (blueprint: VoxelBlueprint, centre: XZ, yaw: number) => {
    if (!reserved.length) return false;
    const w = blueprint.size[0] * CELL, d = blueprint.size[2] * CELL, c = Math.cos(yaw), s = Math.sin(yaw);
    const corner: Vec3 = [centre[0] - (c * w / 2 + s * d / 2), 0, centre[1] - (-s * w / 2 + c * d / 2)];
    const rect = boundsOf(footprintCorners(blueprint, corner, yaw, 0.25));
    return reserved.some(r => overlaps(r.rect, rect));
  };
  const driftHearts = new Map<number, { centre: XZ; reach: number; lot?: string }[]>();
  const heartKey = (x: number, z: number) => (Math.floor(x / 8) + 4096) * 8192 + Math.floor(z / 8) + 4096;
  for (const drift of drifts) {
    const blueprint = COVER[drift.bloom](), patches: GroundPiece[] = [];
    const [ux, uz] = drift.along, vx = -uz, vz = ux, before = placed.length;
    // A loose staggered row of patches inside the drift's ellipse, rotated freely; heads overlap at the seams.
    for (let i = 0; i < 18 && patches.length < 15; i++) {
      let a: number, b: number;
      if (drift.row) {
        // `length` is the span of patch centres along the row.
        if (i * 0.3 > drift.length + 0.05) break;
        a = -drift.length / 2 + i * 0.3 + (ctx.rand(drift.id, 'a', i) - 0.5) * 0.08;
        b = (ctx.rand(drift.id, 'b', i) - 0.5) * 0.08;
      } else {
        const t = ((i % 6) + 0.5) / 6 - 0.5, row = Math.floor(i / 6) - 1;
        a = t * drift.length + (ctx.rand(drift.id, 'a', i) - 0.5) * 0.6; b = row * drift.width * 0.42 + (ctx.rand(drift.id, 'b', i) - 0.5) * 0.5;
        if ((a / (drift.length / 2)) ** 2 + (b / (drift.width / 2 + 0.3)) ** 2 > 1.05) continue;
      }
      const x = drift.centre[0] + ux * a + vx * b, z = drift.centre[1] + uz * a + vz * b;
      // A drift belongs wholly to one lot or to the open ground, so a home's growth never reshapes a public drift.
      const lot = drift.lot ? { id: drift.lot, ...(drift.slot !== undefined ? { slot: drift.slot } : {}) } : undefined;
      // A border keeps to its band: near-square turns, so its boxes clear the facade's pots and the bed.
      const yaw = drift.row ? Math.floor(ctx.rand(drift.id, 'yaw', i) * 4) * Math.PI / 2 + (ctx.rand(drift.id, 'jitter', i) - 0.5) * 0.1
        : ctx.rand(drift.id, 'yaw', i) * Math.PI * 2;
      if (onReserved(blueprint, [x, z], yaw)) continue;
      if (tryPlace(`${drift.id}:${i}`, blueprint, [x, z], yaw, lot)) patches.push(placed.at(-1)!);
    }
    if (patches.length < (drift.row ? 2 : 5)) {
      if (drift.row) omissions.push(`${drift.id}: only ${patches.length} border patches fit`);
      placed.length = before; continue;
    }
    const heart = { centre: drift.centre, reach: drift.length / 2 + 1, ...(drift.lot ? { lot: drift.lot } : {}) };
    for (let gx = Math.floor((heart.centre[0] - heart.reach) / 8); gx <= Math.floor((heart.centre[0] + heart.reach) / 8); gx++)
      for (let gz = Math.floor((heart.centre[1] - heart.reach) / 8); gz <= Math.floor((heart.centre[1] + heart.reach) / 8); gz++) {
        const key = heartKey(gx * 8, gz * 8), list = driftHearts.get(key);
        if (list) list.push(heart); else driftHearts.set(key, [heart]);
      }
  }

  // 2. Meadow cover on a jittered 2 m lattice, thinning with distance from facades and paths, clustered by a
  //    low-frequency field so open meadow stays calm. Points inside a lot belong to that lot.
  const blocked = (x: number, z: number, lot: string | undefined) => (driftHearts.get(heartKey(x, z)) ?? []).some(h => h.lot === lot && Math.hypot(x - h.centre[0], z - h.centre[1]) < h.reach);
  for (let iz = Math.ceil(plan.bounds.minZ / 2); iz < Math.floor(plan.bounds.maxZ / 2); iz++)
    for (let ix = Math.ceil(plan.bounds.minX / 2); ix < Math.floor(plan.bounds.maxX / 2); ix++) {
      const x = ix * 2 + 0.2 + ctx.rand('jx', ix, iz) * 1.6, z = iz * 2 + 0.2 + ctx.rand('jz', ix, iz) * 1.6;
      const field = meadowNoise(ctx, x, z, 9, 'meadow') * 0.65 + meadowNoise(ctx, x, z, 23, 'swathe') * 0.35;
      // Near the town the ground is tended and full but still broken; out in the meadow cover gathers into
      // drifts with wide calm between them (at least 40% keeps no cover within 2 m).
      const roll = ctx.rand('cover', ix, iz), nearWeight = 0.55 + 0.6 * field, farWeight = Math.max(0, (field - 0.42) / 0.3) * 1.7;
      if (roll >= Math.max(nearWeight, farWeight)) continue;
      const sample = samplePublicGround(plan, x, z), d = edgeDistance(ctx, x, z, sample);
      const lot = lotOf(x, z);
      const near = d < 6;
      if (roll >= Math.min(1, 4 / patchArea(d) * (near ? nearWeight : farWeight))) continue;
      if (blocked(x, z, lot?.id)) continue;
      const pavingClose = (sample?.pavingDistance ?? Infinity) < 2.6;
      const rear = lot?.slot !== undefined;
      // Feet keep the turf short beside worn stones: clover there, never tufts.
      const trodden = reserved.some(r => r.trodden && rectDistance(r.rect, x, z) < 1.1);
      const clover = trodden || ctx.rand('clover', ix, iz) < (pavingClose ? 0.42 : rear ? 0.38 : near ? 0.2 : 0.08);
      const blueprint = clover ? COVER.clover() : COVER.tufts(), yaw = ctx.rand('yaw', ix, iz) * Math.PI * 2;
      if (onReserved(blueprint, [x, z], yaw)) continue;
      tryPlace(`${lot ? `lot:${lot.id}` : 'meadow'}:${ix}:${iz}`, blueprint, [x, z], yaw, lot);
    }

  // 3. A weathered stone at the head of some far drifts, never in a lot or a forecourt (spec 06 rock cluster).
  const blockers: GroundBlocker[] = [];
  for (const drift of drifts) {
    if (drift.lot || !drift.id.startsWith('drift:') || ctx.rand(drift.id, 'stone') > 0.3) continue;
    if (!placed.some(p => p.id.startsWith(`${drift.id}:`))) continue;
    if (edgeDistance(ctx, ...drift.centre) < 9) continue;
    const home = nearestHome(...drift.centre, 80);
    const blueprint = shared(createStreetProp('rock-cluster', home?.home.style === 'tide' ? 'tide' : 'hearth'));
    const turn = Math.floor(ctx.rand(drift.id, 'turn') * 4) as CardinalTurn, yaw = turn * Math.PI / 2;
    const x = drift.centre[0] + drift.along[0] * (drift.length / 2 + 0.9), z = drift.centre[1] + drift.along[1] * (drift.length / 2 + 0.9);
    const id = `${drift.id}:stone`, result = fit(ctx, { blueprint, centre: [x, z], yaw }, undefined);
    if (typeof result === 'string') { omissions.push(`${id}: ${result}`); continue; }
    if (placed.some(p => !pieceRole(p.blueprint).cover && Math.hypot(p.position[0] - result.position[0], p.position[2] - result.position[2]) < 3)) continue;
    const stone: GroundBlocker = { id, blueprint, position: result.position, yaw, turn };
    // Cover the stone sits on is trimmed so tufts never pierce it.
    const rect = grow(boundsOf(footprintCorners(blueprint, stone.position, yaw)), 0.4);
    for (let i = placed.length - 1; i >= 0; i--) {
      const p = placed[i]!, centreX = p.position[0], centreZ = p.position[2];
      if (overlaps(rect, boundsOf(footprintCorners(p.blueprint, [centreX, 0, centreZ], p.yaw, 0.25)))) placed.splice(i, 1);
    }
    placed.push(stone); blockers.push(stone);
  }

  // 4. Bound the population by tier; drop the most marginal open-meadow tufts first, by stable hash rank.
  const cap = TIER_CAP[input.tier];
  if (placed.length > cap) {
    const ranked = placed.filter(p => p.id.startsWith('meadow:')).sort((a, b) => seedHash(b.id) - seedHash(a.id));
    const drop = new Set(ranked.slice(0, placed.length - cap).map(p => p.id));
    omissions.push(`${drop.size} open-meadow patches over the ${input.tier} cap of ${cap}`);
    for (let i = placed.length - 1; i >= 0; i--) if (drop.has(placed[i]!.id)) placed.splice(i, 1);
  }

  placed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pieces = new Map<string, GroundPiece[]>(), counts: Record<string, number> = {};
  for (const piece of placed) {
    const list = pieces.get(piece.blueprint.id);
    if (list) list.push(piece); else pieces.set(piece.blueprint.id, [piece]);
    counts[piece.blueprint.id] = (counts[piece.blueprint.id] ?? 0) + 1;
  }
  blockers.sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    pieces, blockers, collisionPieces: blockers, seatAnchors: [],
    // Garden-kit vignettes (woodpile and barrels, bed and crates, the handcart) arrive with the garden kit.
    report: { counts, homesWithVignette: 0, omissions },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Capture poses computed from the plan.

/** The arrival home the kingdom opens on: a house among the most neighbours, nearest the centre (as the scene). */
export function arrivalHome(plan: SettlementPlan): SettlementHome {
  const neighbours = (home: SettlementHome) => plan.homes.filter(h => Math.hypot(h.position[0] - home.position[0], h.position[2] - home.position[2]) < 35).length;
  const houses = plan.homes.filter(h => h.tier === 'house');
  return [...(houses.length ? houses : plan.homes)].sort((a, b) => neighbours(b) - neighbours(a)
    || Math.hypot(a.position[0], a.position[2]) - Math.hypot(b.position[0], b.position[2]))[0]!;
}

export function planViews(land: KingdomLand, ground: (x: number, z: number) => number): GroundViews {
  const plan = land.plan;
  const at = (x: number, z: number, up: number): Vec3 => [x, ground(x, z) + up, z];
  // Street: 1.6 m above the arrival home's street, looking along the frontage at its door and forecourt.
  const arrival = arrivalHome(plan), a = homeFrame(arrival);
  const street = {
    eye: at(a.front[0] + a.outward[0] * 6.2 - a.right[0] * 10, a.front[2] + a.outward[2] * 6.2 - a.right[2] * 10, 1.6),
    target: at(a.front[0] + a.outward[0] * 1.2 + a.right[0] * 2, a.front[2] + a.outward[2] * 1.2 + a.right[2] * 2, 0.8),
  };
  // Garden: behind an Old Row home, over its tended rear meadow toward the back of the house.
  const oldestYear = Math.min(...plan.homes.map(h => h.quarterYear));
  const old = plan.homes.filter(h => h.quarterYear === oldestYear).sort((x, y) => x.ordinal - y.ordinal || x.slot - y.slot)[Math.floor(plan.homes.filter(h => h.quarterYear === oldestYear).length / 2)]!;
  const g = homeFrame(old), back = -old.allowedDepth;
  const garden = {
    eye: at(g.front[0] + g.outward[0] * (back - 9) + g.right[0] * 6, g.front[2] + g.outward[2] * (back - 9) + g.right[2] * 6, 2.4),
    target: at(g.front[0] + g.outward[0] * (back - 1.5), g.front[2] + g.outward[2] * (back - 1.5), 0.6),
  };
  // Edge: from the newest street out toward the frontier and the treeline beyond it.
  const newestYear = Math.max(...plan.homes.map(h => h.quarterYear));
  const fresh = plan.homes.filter(h => h.quarterYear === newestYear).sort((x, y) => y.ordinal - x.ordinal || x.slot - y.slot)[0]!;
  const f = homeFrame(fresh), out: XZ = [f.front[0] + f.outward[0] * 4, f.front[2] + f.outward[2] * 4];
  const towardX = out[0] - plan.market.boundary.reduce((n, p) => n + p[0], 0) / plan.market.boundary.length;
  const towardZ = out[1] - plan.market.boundary.reduce((n, p) => n + p[1], 0) / plan.market.boundary.length;
  const norm = Math.hypot(towardX, towardZ) || 1;
  const edge = { eye: at(out[0], out[1], 2.2), target: at(out[0] + towardX / norm * 40, out[1] + towardZ / norm * 40, 3) };
  // Ridge: from the market toward the castle and the hills behind it.
  const market = plan.nodes.find(n => n.id === plan.market.nodeId)!.position, castle = plan.castle.centre;
  const dx = castle[0] - market[0], dz = castle[2] - market[2], length = Math.hypot(dx, dz) || 1;
  const ridge = {
    eye: at(market[0] - dx / length * 14, market[2] - dz / length * 14, 3.2),
    target: [castle[0] + dx / length * 60, castle[1] + 14, castle[2] + dz / length * 60] as Vec3,
  };
  return { street, garden, edge, ridge };
}
