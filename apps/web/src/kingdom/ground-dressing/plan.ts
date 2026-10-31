import { createStreetProp } from '@chatdom/content';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import {
  currentFootprint, homeFrame, randomUnit, samplePublicGround, seedHash, transformCardinalPoint,
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
/** Cover needs the adopted plots and real keep-outs, not a replacement v2 landscape. */
export interface GroundDressingLand {
  plan: SettlementPlan;
  sites: readonly Pick<KingdomLand['sites'][number], 'footprint'>[];
  places: { court: Pick<KingdomLand['places']['court'], 'boundary'> };
}
export interface GroundDressingInput {
  land: GroundDressingLand; seed: string; tier: KingdomTier;
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
  const w = blueprint.size[0] * CELL, d = blueprint.size[2] * CELL;
  return localCorners(position, yaw, inset, w - inset, inset, d - inset);
}
function localCorners(position: Vec3, yaw: number, a0: number, a1: number, b0: number, b1: number): XZ[] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(([a, b]) => [position[0] + c * a! + s * b!, position[2] - s * a! + c * b!] as const);
}

const extents = new WeakMap<VoxelBlueprint, readonly [number, number, number, number]>();
/**
 * World corners of what a placement really occupies: the XZ extent of its solid boxes, not its blueprint box. A home
 * blueprint reserves its lot's whole 16 m depth; only the built part keeps the ground behind it from being planted.
 */
export function occupiedCorners(piece: Pick<GroundPiece, 'blueprint' | 'position' | 'yaw'>): XZ[] {
  let extent = extents.get(piece.blueprint);
  if (!extent) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const box of piece.blueprint.boxes) if (box.material !== 0) {
      minX = Math.min(minX, box.from[0]); maxX = Math.max(maxX, box.to[0]); minZ = Math.min(minZ, box.from[2]); maxZ = Math.max(maxZ, box.to[2]);
    }
    extent = minX < maxX ? [minX * CELL, maxX * CELL, minZ * CELL, maxZ * CELL] : [0, piece.blueprint.size[0] * CELL, 0, piece.blueprint.size[2] * CELL];
    extents.set(piece.blueprint, extent);
  }
  return localCorners(piece.position, piece.yaw, ...extent);
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
  /** Depth from the facade to the rear of what the home has actually built (its real occupied footprint). */
  rear: number;
}
interface Occupied { rect: Rect; corners: readonly XZ[]; home?: HomeArea }
interface Context {
  input: GroundDressingInput; plan: SettlementPlan;
  areas: readonly HomeArea[];
  homes: RectIndex<HomeArea & { rect: Rect }>;
  lots: RectIndex<{ rect: Rect; id: string; slot?: number; home?: HomeArea }>;
  occupied: RectIndex<Occupied>;
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
    const area: HomeArea = { home, rect: currentFootprint(home), lot: home.lot, front, right, outward, apron, rear: home.allowedDepth };
    homes.add(area); bySlot.set(home.slot, area); areas.push(area);
  }
  for (const reservation of plan.reservations) {
    const home = plan.homes.find(h => h.id === reservation.id);
    const area = home ? bySlot.get(home.slot) : undefined;
    lots.add({ rect: reservation.lot, id: reservation.id, ...(home ? { slot: home.slot } : {}), ...(area ? { home: area } : {}) });
  }
  // What a lot holds is its home's building; its real rear is where the home's garden assembly starts.
  const occupied = new RectIndex<Occupied>(), building = new Set<HomeArea>();
  for (const piece of input.occupied) {
    const corners = occupiedCorners(piece), rect = boundsOf(corners), cx = (rect.minX + rect.maxX) / 2, cz = (rect.minZ + rect.maxZ) / 2;
    let home: HomeArea | undefined;
    lots.near({ minX: cx, maxX: cx, minZ: cz, maxZ: cz }, 0, lot => { if (lot.home && cx > lot.rect.minX && cx < lot.rect.maxX && cz > lot.rect.minZ && cz < lot.rect.maxZ) { home = lot.home; return true; } return false; });
    occupied.add({ rect, corners, ...(home ? { home } : {}) });
    if (!home) continue;
    const depth = Math.max(...corners.map(([x, z]) => -((x - home!.front[0]) * home!.outward[0] + (z - home!.front[2]) * home!.outward[2])));
    home.rear = building.has(home) ? Math.max(home.rear, depth) : depth;
    building.add(home);
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

/** A market stall whose back meets the edge of the square, framed for the garden behind it. */
interface MarketStall {
  id: string; style: SettlementHome['style'];
  /** Unit direction along the edge, from the stall's outer end toward the middle of the square. */
  u: XZ;
  /** Unit outward normal of the edge, away from the square. */
  n: XZ;
  /** The point on the edge behind the stall's back centre; `start`/`end` bound the strip along `u` from it. */
  edge: XZ; start: number; end: number;
}

/**
 * Stalls are the host's real occupied placements (`market-stall-*` inside the square), never assumed positions. A
 * stall qualifies when the square's edge lies within 4 m behind its back.
 */
function marketStalls(ctx: Context): MarketStall[] {
  const square = ctx.plan.market.boundary, stalls: MarketStall[] = [];
  const middle: XZ = [square.reduce((n, p) => n + p[0], 0) / square.length, square.reduce((n, p) => n + p[1], 0) / square.length];
  for (const piece of ctx.input.occupied) {
    const match = /^market-stall-(\d+)$/.exec(piece.blueprint.id);
    if (!match) continue;
    const c = Math.cos(piece.yaw), s = Math.sin(piece.yaw), w = piece.blueprint.size[0] * CELL;
    const back: XZ = [piece.position[0] + c * w / 2, piece.position[2] - s * w / 2], n: XZ = [-s, -c];
    if (polygonDistance(square, ...back) >= 0) continue;
    let depth = 0;
    while (depth <= 4 && polygonDistance(square, back[0] + n[0] * depth, back[1] + n[1] * depth) < 0) depth += 0.05;
    if (depth > 4) continue;
    const edge: XZ = [back[0] + n[0] * depth, back[1] + n[1] * depth];
    // Toward the middle of the square along the edge: the stall's outer end lies the other way.
    const across: XZ = [c, -s], sign = (middle[0] - back[0]) * across[0] + (middle[1] - back[1]) * across[1] >= 0 ? 1 : -1;
    const u: XZ = [across[0] * sign, across[1] * sign];
    const nearest = [...ctx.areas].sort((a, b) => rectDistance(a.lot, ...back) - rectDistance(b.lot, ...back))[0];
    // The run starts behind the stall's inner end and reaches at most a dozen metres on toward the middle.
    stalls.push({ id: `market:stall:${match[1]}:garden`, style: nearest?.home.style ?? 'hearth', u, n, edge, start: w / 2 - 1.3, end: w / 2 + 12 });
  }
  return stalls.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** A point `side` metres along a home's right and `depth` metres back from its facade. */
const inFrame = (area: HomeArea, side: number, depth: number): XZ =>
  [area.front[0] + area.right[0] * side - area.outward[0] * depth, area.front[2] + area.right[2] * side - area.outward[2] * depth];
const TURNS = [0, 1, 2, 3] as const satisfies readonly CardinalTurn[];
/** The cardinal turn whose local +Z faces `dir`, and the one whose local +X runs along it (yaw = turn · π/2). */
const turnFacing = (dir: XZ): CardinalTurn => TURNS.find(t => { const [x, , z] = transformCardinalPoint([0, 0, 0], t, [0, 0, 1]); return x === dir[0] && z === dir[1]; })!;
const turnAlong = (dir: XZ): CardinalTurn => TURNS.find(t => { const [x, , z] = transformCardinalPoint([0, 0, 0], t, [1, 0, 0]); return x === dir[0] && z === dir[1]; })!;

interface Candidate { blueprint: VoxelBlueprint; centre: XZ; yaw: number }
interface Fit { position: Vec3; slope?: readonly [number, number] }
interface FitOptions {
  /** The lot the piece belongs to wholly; otherwise it stands outside every lot. */
  lot?: string | undefined;
  /** The one square flush planting may border (the stall garden). */
  beside?: readonly XZ[] | undefined;
  /**
   * The home whose garden assembly the piece is part of. It may stand against that home's lot line and lean on its
   * real walls (0.15 m clear, the back fence 0.5 m), but never inside its current footprint, the owner's build space.
   */
  assembly?: HomeArea | undefined;
  /** The back fence spans its lot, so neighbouring homes and placements keep 0.5 m from it rather than 1.5 m. */
  fence?: boolean;
}
const EPSILON = 1e-6;
const shrink = (r: Rect): Rect => grow(r, -EPSILON);

/**
 * Every clearance rule of R3 for one footprint. Returns the grounded placement, or a reason it cannot stand.
 * Cover is sheared onto the fitted ground plane (≤35°); structural pieces need level ground (≤0.125 m relief).
 */
function fit(ctx: Context, { blueprint, centre, yaw }: Candidate, { lot, beside, assembly, fence = false }: FitOptions = {}): Fit | string {
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
  if (ctx.lots.near(rect, 0, item => overlaps(item.rect, shrink(rect)) && item.id !== lot)) return 'crosses a lot line';
  if (lot) {
    const own = ctx.lots.near(rect, 0, item => item.id === lot && rect.minX >= item.rect.minX - EPSILON && rect.maxX <= item.rect.maxX + EPSILON
      && rect.minZ >= item.rect.minZ - EPSILON && rect.maxZ <= item.rect.maxZ + EPSILON);
    if (!own) return 'leaves its lot';
  }
  // Homes: never on a current footprint. Solids keep 1.5 m from every other home: from its whole lot when they stand
  // outside the lots, so a neighbour growing deeper never unseats them.
  const homeClash = ctx.homes.near(rect, 2, area => {
    if (area === assembly) return overlaps(area.rect, shrink(rect));
    if (!role.solid) return overlaps(grow(area.rect, 0.125), rect);
    return overlaps(grow(area.rect, fence ? 0.5 : 1.5), rect);
  });
  if (homeClash) return 'on a home';
  if (role.solid && !lot && ctx.lots.near(rect, 1.5, item => (!assembly || item.home !== assembly) && overlaps(grow(item.rect, 1.5), rect))) return 'beside another lot';
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
  const margin = (item: Occupied) => !role.solid ? 0.25 : item.home && item.home === assembly ? (fence ? 0.5 : 0.15) : fence ? 0.5 : 1.5;
  if (ctx.occupied.near(rect, 2, item => overlaps(grow(item.rect, margin(item)), shrink(rect)))) return 'on an occupied placement';
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
  for (const polygon of ctx.polygons) {
    if (polygon !== beside) { if (polygonDistance(polygon, cx, cz) < radius + 0.25) return 'inside a square, court, site or keep-out'; continue; }
    // Flush planting may border the one square it dresses: its whole box outside, no corner of the square inside it.
    if (corners.some(([x, z]) => polygonDistance(polygon, x, z) < 0.3) || polygon.some(([x, z]) => x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ
      && polygonDistance(corners, x, z) < 0)) return 'inside a square, court, site or keep-out';
  }
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
  gold: 'wildflowers-gold', cream: 'wildflowers-cream', bed: 'seedling-bed', cutting: 'cutting-bed',
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
  const tryPlace = (id: string, blueprint: VoxelBlueprint, centre: XZ, yaw: number, lot: { id: string; slot?: number } | undefined, beside?: readonly XZ[]): boolean => {
    const result = fit(ctx, { blueprint, centre, yaw }, { lot: lot?.id, beside });
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
  const drifts: Drift[] = [], reserved: { rect: Rect; trodden: boolean; slot?: number }[] = [];
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
    if (gap === undefined) return fail(`stones ${fit(ctx, { blueprint: stones, centre: strip.at(strip.gap, strip.apron - 1.8), yaw: inward + tilt })}`);
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
  for (const stall of marketStalls(ctx)) placeStallGarden(stall);

  /**
   * The stall's own garden: where a market stall backs onto the edge of the square, its grower keeps cutting beds
   * on the open ground behind it. From behind the stall's inner end the beds run along the edge toward the middle
   * of the square, where the market sees them: pink, cream and gold in blocks, worn stones between the beds where
   * the grower climbs the bank, a second cutting bed, then a bed being planted for the next market. Above them the
   * stock has seeded itself up the bank in a loose drift. Every piece is flush and passive, keeps the paving and the
   * stall's occupied geometry clear and passes every other clearance; whatever does not fit is left out with its
   * reason. The stall and its wares are never moved or doubled.
   */
  function placeStallGarden(stall: MarketStall): void {
    const { id, u, n, edge, start, end, style } = stall, square = plan.market.boundary;
    const at = (along: number, out: number): XZ => [edge[0] + u[0] * along + n[0] * out, edge[1] + u[1] * along + n[1] * out];
    // Local +X of a form runs along `u` (beds) or out along `n` (stones).
    const alongYaw = Math.atan2(-u[1], u[0]), outYaw = Math.atan2(-n[1], n[0]);
    const jitter = (key: string) => (ctx.rand(id, key) - 0.5) * 0.07;
    const stones = shared(createDressing('stepping-stones', style));
    // [key, form, length along the edge, distances out from the edge, yaw]. Beds lie a hand off the paving, each
    // set a little in or out so the run never reads as ruled; the stones climb a stride up the bank.
    const out = (key: string) => 1 + ctx.rand(id, 'out', key) * 0.25;
    const sequence: readonly [string, VoxelBlueprint, number, readonly number[], number][] = [
      ['cutting:0', COVER.cutting(), 3, [out('cutting:0'), 1.05], alongYaw + jitter('cutting:0')],
      ['stones', stones, 1, [1.95, 2.1], outYaw + jitter('stones')],
      ['cutting:1', COVER.cutting(), 3, [out('cutting:1'), 1.05], alongYaw + Math.PI + jitter('cutting:1')],
      ['seedlings', COVER.bed(), 3, [out('seedlings') - 0.1, 0.95], alongYaw + jitter('seedlings')],
    ];
    let cursor = start, first: number | undefined;
    for (const [key, blueprint, length, outs, yaw] of sequence) {
      const from = cursor + 0.3 + ctx.rand(id, 'gap', key) * 0.35;
      let laid = false;
      for (let shift = 0; !laid && shift <= 3 && from + shift + length <= end; shift += 0.25)
        for (const o of outs) if (tryPlace(`${id}:${key}`, blueprint, at(from + shift + length / 2, o), yaw, undefined, square)) {
          const piece = placed.at(-1)!;
          reserved.push({ rect: grow(boundsOf(footprintCorners(blueprint, piece.position, piece.yaw, CELL)), key === 'stones' ? 0.12 : 0), trodden: key === 'stones' });
          first ??= from + shift; cursor = from + shift + length; laid = true; break;
        }
      if (!laid) omissions.push(`${id}:${key}: ${fit(ctx, { blueprint, centre: at(from + length / 2, outs[0]!), yaw }, { beside: square })}`);
    }
    if (first === undefined) return;
    // The stock gone wild up the bank above the last beds, toward the middle of the square.
    drifts.push({ id: `${id}:wild`, centre: at(Math.max(first + 2, cursor - 1.2), 4.2), along: u, length: 5, width: 2.4, bloom: 'petal' });
  }

  // Gardens. Each home's back fence stands where it has grown to, across its lot in the home's own frame, with the
  // tended meadow behind it. Garden vignettes stand at a home's open lot side or back, never in its build space or its
  // meadow, and field walls and rail fences break up the open meadow. Every one is solid, level and cardinal.
  const blockers: GroundBlocker[] = [], gardened = new Set<number>();
  const kitForm = (form: DressingForm, style: SettlementHome['style']) => shared(createDressing(form, DRESSING_ROLES[form].kit ? style : undefined));
  /** Fits one solid with an exact cardinal turn, clear of every garden piece and worn stone already laid. */
  const fitSolid = (id: string, blueprint: VoxelBlueprint, centre: XZ, turn: CardinalTurn, options: FitOptions, lotSlot?: number): GroundBlocker | string => {
    const yaw = turn * Math.PI / 2, result = fit(ctx, { blueprint, centre, yaw }, options);
    if (typeof result === 'string') return result;
    const rect = boundsOf(footprintCorners(blueprint, result.position, yaw));
    // A home's own fence never bars its vignette: the lot line already parts them, and growth moves only the fence.
    if (reserved.some(r => r.slot !== options.assembly?.home.slot && overlaps(grow(r.rect, 0.3), rect))) return 'on a garden piece or worn stones';
    return { id, blueprint, position: result.position, yaw, turn, ...(lotSlot !== undefined ? { lotSlot } : {}) };
  };
  const commit = (piece: GroundBlocker) => {
    placed.push(piece); blockers.push(piece);
    reserved.push({ rect: grow(boundsOf(footprintCorners(piece.blueprint, piece.position, piece.yaw)), 0.1), trodden: false, ...(piece.lotSlot !== undefined ? { slot: piece.lotSlot } : {}) });
  };
  const byHome = [...ctx.areas].sort((a, b) => a.home.slot - b.home.slot);

  for (const area of byHome) {
    const { home } = area, id = `lot:${home.id}:back-fence`, fence = kitForm('back-fence', home.style);
    // Behind the open depth, and at least 0.5 m behind what is really built; a home that fills its lot has no fence.
    const depth = fence.size[2] * CELL, at = Math.max(home.allowedDepth, area.rear + 0.5);
    if (at + depth > home.lot.depth + EPSILON) { omissions.push(`${id}: the home fills its lot, leaving no rear strip that holds the fence 0.5 m clear`); continue; }
    const piece = fitSolid(id, fence, inFrame(area, 0, at + depth / 2), home.rotation, { lot: home.id, assembly: area, fence: true }, home.slot);
    if (typeof piece === 'string') { omissions.push(`${id}: ${piece}`); continue; }
    commit(piece);
    // The tended meadow keeps one colour along the fence's garden side, fuller and likelier in Old Row. It belongs to
    // the lot and is measured from the fence, so it moves with the fence when the home grows and nowhere else.
    const key = `lot:${home.id}:fence-drift`, age = ageOf(home);
    if (home !== arrival && ctx.rand(key) > 0.35 + 0.55 * age) continue;
    const blooms = BLOOMS[home.style], bloom = blooms[Math.floor(ctx.rand(key, 'bloom') * blooms.length)]!;
    drifts.push({ id: key, centre: inFrame(area, (ctx.rand(key, 'side') - 0.5) * 1.6, at + depth + 1.9), along: [area.right[0], area.right[2]],
      length: 4.4 + age * 1.6, width: 1.3, bloom, lot: home.id, slot: home.slot });
  }

  /**
   * One home's vignette, laid in a row against the house's side (outside its lot, from 2.5 m behind the facade) or
   * against the back of its lot. Each piece faces away from the home. All of it fits or none of it is laid.
   */
  function placeVignette(area: HomeArea, key: string, forms: readonly DressingForm[], side: -1 | 0 | 1): boolean {
    const { home } = area, out: XZ = side ? [area.right[0] * side, area.right[2] * side] : [-area.outward[0], -area.outward[2]];
    const blueprints = forms.map(form => kitForm(form, home.style)), turn = turnFacing(out);
    const widths = blueprints.map(b => b.size[0] * CELL), span = widths.reduce((n, w) => n + w, 0) + 0.3 * (forms.length - 1);
    const shift = ctx.rand(key, 'shift', side);
    // Along the side wall from the facade back; along the lot's back line from a seeded offset toward the middle.
    const slack = Math.max(0, home.lot.frontage - span - 0.4), offset = (shift - 0.5) * slack;
    const starts = side ? [2.5, 4.5, 7, 10].map(d => d + shift).filter(d => d + span <= home.lot.depth - 0.5)
      : [...new Set([offset, 0, -offset])].map(t => t - span / 2);
    for (const start of starts) {
      const pieces: GroundBlocker[] = [];
      let along = start;
      for (const [i, blueprint] of blueprints.entries()) {
        const across = blueprint.size[2] * CELL, mid = along + widths[i]! / 2;
        const centre = side ? inFrame(area, side * (home.lot.frontage / 2 + 0.05 + across / 2), mid) : inFrame(area, mid, home.lot.depth + 0.05 + across / 2);
        const piece = fitSolid(`${key}:${side ? (side > 0 ? 'right' : 'left') : 'back'}:${forms[i]}`, blueprint, centre, turn, { assembly: area });
        if (typeof piece === 'string') break;
        pieces.push(piece); along += widths[i]! + 0.3;
      }
      if (pieces.length === forms.length) { pieces.forEach(commit); return true; }
    }
    return false;
  }
  // Old Row keeps full gardens, the newest street a crate or two; each home tries its sides first, where the street
  // sees them, then the back of its lot. A group that cannot stand anywhere falls back to its first piece alone.
  const GARDENS: Record<'old' | 'mid' | 'new', readonly (readonly DressingForm[])[]> = {
    old: [['woodpile', 'barrels'], ['garden-bed', 'crates'], ['handcart'], ['woodpile', 'crates']],
    mid: [['garden-bed', 'crates'], ['woodpile'], ['barrels', 'crates'], ['handcart']],
    new: [['crates'], ['barrels'], ['garden-bed']],
  };
  let wanted = 0;
  for (const area of byHome) {
    const { home } = area, age = ageOf(home), key = `garden:${home.slot}`;
    if (ctx.rand(key) > 0.3 + 0.6 * age) continue;
    wanted++;
    const groups = GARDENS[age >= 0.6 ? 'old' : age >= 0.3 ? 'mid' : 'new'], group = groups[Math.floor(ctx.rand(key, 'group') * groups.length)]!;
    const sides: (-1 | 0 | 1)[] = ctx.rand(key, 'side') < 0.5 ? [-1, 1, 0] : [1, -1, 0];
    if ([group, group.slice(0, 1)].some(forms => sides.some(side => placeVignette(area, key, forms, side)))) gardened.add(home.slot);
  }
  if (wanted > gardened.size) omissions.push(`garden vignettes: ${wanted - gardened.size} of ${wanted} homes chosen for one have no open lot side or back`);

  // Field runs on the open meadow, 6–45 m out from the town: old dry-stone walls by the older quarters, fresh rail
  // fences by the newest. A run follows the contour along the cardinal axis that changes least, two to five lengths
  // with the ends overlapping, sometimes broken by a gap, and stops where the next length cannot stand.
  for (let gz = Math.floor(plan.bounds.minZ / 24); gz <= Math.floor(plan.bounds.maxZ / 24); gz++)
    for (let gx = Math.floor(plan.bounds.minX / 24); gx <= Math.floor(plan.bounds.maxX / 24); gx++) {
      const x = (gx + 0.2 + ctx.rand('field-x', gx, gz) * 0.6) * 24, z = (gz + 0.2 + ctx.rand('field-z', gx, gz) * 0.6) * 24;
      const near = edgeDistance(ctx, x, z);
      if (near < 6 || near > 45 || ctx.rand('field', gx, gz) > 0.55 * (0.3 + meadowNoise(ctx, x, z, 40, 'fields'))) continue;
      const home = nearestHome(x, z, 90), age = home ? ageOf(home.home) : 0;
      const blueprint = kitForm(age >= 0.5 ? 'field-wall' : 'rail-fence', home?.home.style ?? 'grove');
      const relief = (u: XZ) => Math.abs(input.ground(x + u[0] * 6, z + u[1] * 6) - input.ground(x - u[0] * 6, z - u[1] * 6));
      const axis: XZ = relief([1, 0]) <= relief([0, 1]) ? [1, 0] : [0, 1], sign = ctx.rand('field-sign', gx, gz) < 0.5 ? 1 : -1;
      const u: XZ = [axis[0] * sign, axis[1] * sign], turn = turnAlong(u), length = blueprint.size[0] * CELL, pitch = length - 0.25;
      const count = 2 + Math.floor(ctx.rand('field-count', gx, gz) * 3) + (age >= 0.6 ? 1 : 0);
      const gap = ctx.rand('field-gap', gx, gz) < 0.35 ? 1 + Math.floor(ctx.rand('field-gap-at', gx, gz) * (count - 1)) : -1;
      const segments: GroundBlocker[] = [];
      let along = -(count * pitch) / 2;
      for (let k = 0; k < count; k++) {
        if (k === gap) along += 1.4;
        const piece = fitSolid(`field:${gx}:${gz}:${k}`, blueprint, [x + u[0] * (along + length / 2), z + u[1] * (along + length / 2)], turn, {});
        if (typeof piece === 'string') break;
        segments.push(piece); along += pitch;
      }
      if (segments.length >= 2) segments.forEach(commit);
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
  // Cover never tufts through a bed, a stone or a garden piece; feet keep the turf short beside worn stones.
  const kept = new RectIndex<{ rect: Rect; trodden: boolean }>();
  for (const r of reserved) kept.add(r);
  /** Whether a cover patch centred here would tuft through a doorstep bed, stones or a solid garden piece. */
  const onReserved = (blueprint: VoxelBlueprint, centre: XZ, yaw: number) => {
    const w = blueprint.size[0] * CELL, d = blueprint.size[2] * CELL, c = Math.cos(yaw), s = Math.sin(yaw);
    const corner: Vec3 = [centre[0] - (c * w / 2 + s * d / 2), 0, centre[1] - (-s * w / 2 + c * d / 2)];
    const rect = boundsOf(footprintCorners(blueprint, corner, yaw, 0.25));
    return kept.near(rect, 0, r => overlaps(r.rect, rect));
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
      const trodden = kept.near({ minX: x, maxX: x, minZ: z, maxZ: z }, 1.1, r => r.trodden && rectDistance(r.rect, x, z) < 1.1);
      const clover = trodden || ctx.rand('clover', ix, iz) < (pavingClose ? 0.42 : rear ? 0.38 : near ? 0.2 : 0.08);
      const blueprint = clover ? COVER.clover() : COVER.tufts(), yaw = ctx.rand('yaw', ix, iz) * Math.PI * 2;
      if (onReserved(blueprint, [x, z], yaw)) continue;
      tryPlace(`${lot ? `lot:${lot.id}` : 'meadow'}:${ix}:${iz}`, blueprint, [x, z], yaw, lot);
    }

  // 3. A weathered stone at the head of some far drifts, never in a lot or a forecourt (spec 06 rock cluster).
  for (const drift of drifts) {
    if (drift.lot || !drift.id.startsWith('drift:') || ctx.rand(drift.id, 'stone') > 0.3) continue;
    if (!placed.some(p => p.id.startsWith(`${drift.id}:`))) continue;
    if (edgeDistance(ctx, ...drift.centre) < 9) continue;
    const home = nearestHome(...drift.centre, 80);
    const blueprint = shared(createStreetProp('rock-cluster', home?.home.style === 'tide' ? 'tide' : 'hearth'));
    const turn = Math.floor(ctx.rand(drift.id, 'turn') * 4) as CardinalTurn, yaw = turn * Math.PI / 2;
    const x = drift.centre[0] + drift.along[0] * (drift.length / 2 + 0.9), z = drift.centre[1] + drift.along[1] * (drift.length / 2 + 0.9);
    const id = `${drift.id}:stone`, result = fit(ctx, { blueprint, centre: [x, z], yaw });
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
    report: { counts, homesWithVignette: gardened.size, omissions },
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

/**
 * The home a garden view looks at: in the oldest (or newest) quarter, preferring one whose plan has a back fence and a
 * garden vignette, the middle of them by ordinal so the frame shows neighbours on both sides.
 */
export function gardenHome(plan: SettlementPlan, quarter: 'oldest' | 'newest', dressing?: GroundDressingPlan): SettlementHome {
  const years = plan.homes.map(h => h.quarterYear), year = quarter === 'oldest' ? Math.min(...years) : Math.max(...years);
  const ids = dressing ? new Set([...dressing.pieces.values()].flat().map(p => p.id)) : undefined;
  const gardened = (h: SettlementHome) => !ids || (ids.has(`lot:${h.id}:back-fence`) && [...ids].some(id => id.startsWith(`garden:${h.slot}:`)));
  const quarterHomes = plan.homes.filter(h => h.quarterYear === year).sort((x, y) => x.ordinal - y.ordinal || x.slot - y.slot);
  const homes = quarterHomes.filter(gardened).length ? quarterHomes.filter(gardened) : quarterHomes;
  return homes[Math.floor(homes.length / 2)]!;
}

/**
 * From above the back of a lot, a little to one side, across its meadow to the back fence and the house. With the
 * plan, the frame takes in the home's garden vignette too: aimed between it and the fence, from its side.
 */
export function gardenView(home: SettlementHome, ground: (x: number, z: number) => number, dressing?: GroundDressingPlan, portrait = false): GroundView {
  const g = homeFrame(home), at = (side: number, depth: number, up: number): Vec3 => {
    const x = g.front[0] + g.right[0] * side - g.outward[0] * depth, z = g.front[2] + g.right[2] * side - g.outward[2] * depth;
    return [x, ground(x, z) + up, z];
  };
  const vignette = dressing ? [...dressing.pieces.values()].flat().filter(p => p.id.startsWith(`garden:${home.slot}:`)) : [];
  if (!vignette.length) return { eye: at(6, home.lot.depth + 4, 4.6), target: at(-0.5, home.allowedDepth + 0.6, 0.7) };
  const local = vignette.map(p => {
    const dx = p.position[0] - g.front[0], dz = p.position[2] - g.front[2];
    return [dx * g.right[0] + dz * g.right[2], -(dx * g.outward[0] + dz * g.outward[2])] as const;
  });
  const side = local.reduce((n, l) => n + l[0], 0) / local.length, depth = local.reduce((n, l) => n + l[1], 0) / local.length;
  const toward = side < -1 ? -1 : 1;
  // A narrow portrait frame aims at the vignette itself, with the fence behind it, from a little further back.
  const aimSide = portrait ? side * 0.85 : side / 2, aimDepth = portrait ? depth * 0.75 + home.allowedDepth * 0.25 : (depth + home.allowedDepth) / 2;
  return { eye: at(aimSide + toward * (portrait ? 3 : 6), Math.max(home.lot.depth, depth) + (portrait ? 8.5 : 6.5), portrait ? 5.6 : 5), target: at(aimSide, aimDepth, 0.6) };
}

export function planViews(land: GroundDressingLand, ground: (x: number, z: number) => number, dressing?: GroundDressingPlan): GroundViews {
  const plan = land.plan;
  const at = (x: number, z: number, up: number): Vec3 => [x, ground(x, z) + up, z];
  // Street: 1.6 m above the arrival home's street, looking along the frontage at its door and forecourt.
  const arrival = arrivalHome(plan), a = homeFrame(arrival);
  const street = {
    eye: at(a.front[0] + a.outward[0] * 6.2 - a.right[0] * 10, a.front[2] + a.outward[2] * 6.2 - a.right[2] * 10, 1.6),
    target: at(a.front[0] + a.outward[0] * 1.2 + a.right[0] * 2, a.front[2] + a.outward[2] * 1.2 + a.right[2] * 2, 0.8),
  };
  // Garden: behind an Old Row home with a garden, over its tended rear meadow toward the back fence and the house.
  const garden = gardenView(gardenHome(plan, 'oldest', dressing), ground, dressing);
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
