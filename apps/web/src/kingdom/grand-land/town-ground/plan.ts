// The town's land use: which open ground between the streets is field, meadow, heath or bracken, and the walk-through
// planting that dresses it. One pure pass over the settlement plan gives both the land-use mask the floor shader tints
// (what the stream camera reads from 150-400 m) and the instanced pieces a walker wades through. Nothing here is
// solid, nothing is ever moved, and nothing stands on a street, a square, the castle, the lake, a placement or any
// reserved lot, so a home growing on its lot never has to uproot a crop.
import type { VoxelBlueprint } from '@chatdom/shared';
import { homeFrame, randomUnit, seedHash, type SettlementHome, type SettlementPlan, type XZ } from '@chatdom/world';
import { foundedGroundAt, primeFoundedTerrain, sampleFoundedTerrain } from '@chatdom/world/founded-collision';
import { frameSettlement } from '../../../../../../packages/world/src/grand/kingdom/frame';
import { polygonDistance, type GroundDressingPlan, type GroundPiece } from '../../ground-dressing/plan';
import { CROP_FORMS, townBlueprint, type TownForm } from './forms';

const CELL = 0.125;

/** Land-use codes, one per mask cell. 0 is untouched lawn: the floor keeps its own turf there. */
export const TOWN_USE = {
  lawn: 0, meadow: 1, heath: 2, bracken: 3,
  wheat: 4, barley: 5, lavender: 6, cabbage: 7, beans: 8, ploughed: 9,
  border: 10, 'flowers-petal': 11, 'flowers-blue': 12, 'flowers-gold': 13, 'flowers-cream': 14,
} as const;
export type TownUse = keyof typeof TOWN_USE;
const USE_NAMES = Object.keys(TOWN_USE) as TownUse[];

/**
 * How each use should read from the stream camera: the ground tint (sRGB hex) the floor shader blends over its turf,
 * and how strongly it draws drill-row stripes along the cell's row direction (0 where the ground has no rows). Fields
 * are the patchwork: ripe wheat gold, green-gold barley, lavender violet, blue-green brassicas, leafy beans and brown
 * furrows; rough ground stays in the meadow's family, drier toward heath and rust bracken at the town's edge.
 */
export const TOWN_USE_LOOK: Readonly<Record<TownUse, { readonly tint: string; readonly rows: number }>> = {
  lawn: { tint: '#5c8c46', rows: 0 },
  meadow: { tint: '#72904a', rows: 0 },
  heath: { tint: '#7a6070', rows: 0 },
  bracken: { tint: '#80703a', rows: 0 },
  wheat: { tint: '#d6b05c', rows: 0.35 },
  barley: { tint: '#b0b262', rows: 0.35 },
  lavender: { tint: '#8c70b0', rows: 0.35 },
  cabbage: { tint: '#5c8474', rows: 0.35 },
  beans: { tint: '#548040', rows: 0.35 },
  ploughed: { tint: '#76563c', rows: 0.5 },
  border: { tint: '#b28488', rows: 0 },
  'flowers-petal': { tint: '#c68096', rows: 0 },
  'flowers-blue': { tint: '#7688c4', rows: 0 },
  'flowers-gold': { tint: '#d4ba54', rows: 0 },
  'flowers-cream': { tint: '#ded6b4', rows: 0 },
};

/** A field cell's row direction in radians from +X toward +Z, in [0, π): rows run along (cos θ, sin θ). */
export const townRowAngle = (byte: number): number => byte / 256 * Math.PI;

export interface TownGroundMask {
  /** World X/Z of cell (0, 0)'s lower corner; the physical region's minimum. */
  origin: [number, number];
  width: number; depth: number; cell: 1;
  /** Use code (`TOWN_USE`) per cell, row-major by Z: cell (i, j) covers [x0 + i, x0 + i + 1) × [z0 + j, z0 + j + 1). */
  data: Uint8Array;
  /**
   * Per cell, a field's row direction as a byte: angle = byte / 256 · π from +X toward +Z (`townRowAngle`); 0 off the
   * fields. It is the exact direction the parcel's crop pieces run along, so stripes and drills line up.
   */
  rows: Uint8Array;
}
export interface TownGroundInput {
  /** Every placement the town already stands: homes, gardens, trees, the castle, the walls. Kept clear by 1 m. */
  occupied: readonly Pick<GroundPiece, 'blueprint' | 'position' | 'yaw'>[];
  /** A ground-dressing plan already laid on the same ground; its pieces are kept clear by 0.5 m. */
  existing?: GroundDressingPlan;
}
export interface TownGroundPlan {
  mask: TownGroundMask;
  /** By blueprint id; every list sorted by piece id. Each blueprint is the shared `townBlueprint(form)` object. */
  pieces: ReadonlyMap<string, readonly GroundPiece[]>;
  report: {
    /** Pieces per town form. */
    counts: Record<string, number>;
    /** Mask cells (square metres) per use. */
    cells: Record<string, number>;
    /** Field parcels: the patchwork's distinct fields, cropped or ploughed. */
    parcels: number;
  };
}

/** Why a cell keeps its lawn. Later reasons in this list win where several apply (the map reads them). */
export const TOWN_KEEP = {
  open: 0, edge: 1, existing: 2, occupied: 3, verge: 4, lot: 5, paving: 6, square: 7, castle: 8, lake: 9,
} as const;

/** Half the diagonal of a metre cell: a cell centre this much further away clears the whole cell. */
const HALF_DIAGONAL = Math.SQRT1_2;
/** No planting within 1.5 m of a street's reserved verge, a square or a forecourt apron. */
const VERGE_CLEAR = 1.5;

// ---------------------------------------------------------------------------------------------------------------
// Geometry

type Quad = readonly [XZ, XZ, XZ, XZ];
/** World corners of the local rectangle [a0, a1] × [b0, b1]; yaw follows three.js as the mount's `pieceMatrix` does. */
function quad(position: readonly number[], yaw: number, a0: number, a1: number, b0: number, b1: number): Quad {
  const c = Math.cos(yaw), s = Math.sin(yaw), x = position[0]!, z = position[2]!;
  const at = (a: number, b: number): XZ => [x + c * a + s * b, z - s * a + c * b];
  return [at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)];
}

/**
 * Every lattice cell of `size` metres (cell (i, j) covers [i·size, (i+1)·size) × [j·size, (j+1)·size)) that the
 * rectangle overlaps with positive area: an exact separating-axis test, so a footprint never misses a cell it touches.
 */
function overlapCells(q: Quad, size: number, visit: (i: number, j: number) => boolean | void): boolean {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of q) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const axes: XZ[] = [[q[1][1] - q[0][1], q[0][0] - q[1][0]], [q[3][1] - q[0][1], q[0][0] - q[3][0]]];
  const spans = axes.map(([nx, nz]) => {
    const p = q.map(([x, z]) => x * nx + z * nz);
    return [Math.min(...p), Math.max(...p)] as const;
  });
  const half = size / 2;
  for (let j = Math.floor(minZ / size); j * size < maxZ - 1e-9; j++) for (let i = Math.floor(minX / size); i * size < maxX - 1e-9; i++) {
    if ((i + 1) * size <= minX + 1e-9 || (j + 1) * size <= minZ + 1e-9) continue;
    const cx = (i + 0.5) * size, cz = (j + 0.5) * size;
    let separate = false;
    for (let k = 0; k < 2 && !separate; k++) {
      const [nx, nz] = axes[k]!, centre = cx * nx + cz * nz, reach = (Math.abs(nx) + Math.abs(nz)) * half, [lo, hi] = spans[k]!;
      const eps = 1e-9 * (Math.abs(nx) + Math.abs(nz));
      if (centre + reach <= lo + eps || centre - reach >= hi - eps) separate = true;
    }
    if (!separate && visit(i, j) === true) return true;
  }
  return false;
}

function segmentDistance(ax: number, az: number, bx: number, bz: number, x: number, z: number): number {
  const dx = bx - ax, dz = bz - az, length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length)) : 0;
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}

// ---------------------------------------------------------------------------------------------------------------
// Deterministic noise. Integer hashing keeps per-cell variation cheap; decisions that belong to a named place (a
// street's cuts, a parcel, a home) use the plan's seeded string hash, so they never depend on iteration order.

function hash(seed: number, a: number, b: number, salt: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x2545f491) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth value noise in [0, 1] on a `scale`-metre lattice. */
function noise(seed: number, x: number, z: number, scale: number, salt: number): number {
  const gx = x / scale, gz = z / scale, ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(seed, ix, iz, salt), b = hash(seed, ix + 1, iz, salt), c = hash(seed, ix, iz + 1, salt), d = hash(seed, ix + 1, iz + 1, salt);
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
}

// ---------------------------------------------------------------------------------------------------------------
// The region and what keeps its lawn

interface Grid { x0: number; z0: number; width: number; depth: number }
const cellIndex = (g: Grid, i: number, j: number) => (i - g.x0) + (j - g.z0) * g.width;
const inGrid = (g: Grid, i: number, j: number) => i >= g.x0 && j >= g.z0 && i < g.x0 + g.width && j < g.z0 + g.depth;

/** Unique XZ rectangles (in cells) of a blueprint's solid boxes: storeys stacked on one footprint stamp once. */
const footprints = new WeakMap<VoxelBlueprint, readonly (readonly [number, number, number, number])[]>();
function solidFootprint(blueprint: VoxelBlueprint): readonly (readonly [number, number, number, number])[] {
  let known = footprints.get(blueprint);
  if (!known) {
    const seen = new Map<string, readonly [number, number, number, number]>();
    for (const box of blueprint.boxes) if (box.material !== 0) {
      const rect = [box.from[0], box.to[0], box.from[2], box.to[2]] as const;
      seen.set(rect.join(','), rect);
    }
    known = [...seen.values()];
    // A home's walls, floors and roof share a handful of outlines; contained rectangles add nothing.
    known = known.filter((r, i) => !known!.some((o, k) => k !== i && o[0] <= r[0] && o[1] >= r[1] && o[2] <= r[2] && o[3] >= r[3]
      && (o[0] !== r[0] || o[1] !== r[1] || o[2] !== r[2] || o[3] !== r[3] || k < i)));
    footprints.set(blueprint, known);
  }
  return known;
}

/**
 * Per cell of the physical region, the reason it keeps its lawn (`TOWN_KEEP`), or 0 where the town may plant. Public
 * ground is measured from the plan's own shapes, as `samplePublicGround` measures it, over every street, square and
 * forecourt apron the plan has reserved, active or not yet: a superset, so a street opened by growth finds its line
 * already clear.
 */
export function townKeepOut(plan: SettlementPlan, input: TownGroundInput): { grid: Grid; keep: Uint8Array } {
  const region = frameSettlement(plan).region;
  const grid: Grid = { x0: region.minX, z0: region.minZ, width: region.maxX - region.minX, depth: region.maxZ - region.minZ };
  const { width, depth } = grid, keep = new Uint8Array(width * depth);
  const set = (i: number, j: number, reason: number) => { if (inGrid(grid, i, j)) { const k = cellIndex(grid, i, j); if (keep[k]! < reason) keep[k] = reason; } };
  const rect = (minX: number, maxX: number, minZ: number, maxZ: number, reason: number) => {
    for (let j = Math.floor(minZ); j < maxZ; j++) for (let i = Math.floor(minX); i < maxX; i++) if (i + 1 > minX && j + 1 > minZ) set(i, j, reason);
  };
  // The outer metre of the region.
  for (let i = 0; i < width; i++) { keep[i] = TOWN_KEEP.edge; keep[i + (depth - 1) * width] = TOWN_KEEP.edge; }
  for (let j = 0; j < depth; j++) { keep[j * width] = TOWN_KEEP.edge; keep[width - 1 + j * width] = TOWN_KEEP.edge; }
  // An existing dressing plan's pieces, 0.5 m clear.
  for (const pieces of input.existing?.pieces.values() ?? []) for (const piece of pieces) {
    const w = piece.blueprint.size[0] * CELL, d = piece.blueprint.size[2] * CELL;
    overlapCells(quad(piece.position, piece.yaw, -0.5, w + 0.5, -0.5, d + 0.5), 1, (i, j) => { set(i, j, TOWN_KEEP.existing); });
  }
  // Placements, 1 m clear of what they really build (each solid outline, not the blueprint's whole box).
  for (const piece of input.occupied) {
    const c = Math.cos(piece.yaw), s = Math.sin(piece.yaw), cardinal = Math.abs(c * s) < 1e-9;
    for (const [fx, tx, fz, tz] of solidFootprint(piece.blueprint)) {
      const q = quad(piece.position, piece.yaw, fx * CELL - 1, tx * CELL + 1, fz * CELL - 1, tz * CELL + 1);
      if (cardinal) {
        const xs = q.map(p => p[0]), zs = q.map(p => p[1]);
        rect(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), TOWN_KEEP.occupied);
      } else overlapCells(q, 1, (i, j) => { set(i, j, TOWN_KEEP.occupied); });
    }
  }
  // Streets and their verges: per cell the nearest reserved edge, and whether the cell is paving itself.
  const reach = VERGE_CLEAR + HALF_DIAGONAL;
  const reserved = new Float32Array(width * depth).fill(Infinity), paving = new Float32Array(width * depth).fill(Infinity);
  const measure = (minX: number, maxX: number, minZ: number, maxZ: number, distance: (x: number, z: number) => number, verge: number, paved: boolean) => {
    for (let j = Math.max(grid.z0, Math.floor(minZ - reach - verge)); j < Math.min(grid.z0 + depth, Math.ceil(maxZ + reach + verge)); j++)
      for (let i = Math.max(grid.x0, Math.floor(minX - reach - verge)); i < Math.min(grid.x0 + width, Math.ceil(maxX + reach + verge)); i++) {
        const k = cellIndex(grid, i, j), d = distance(i + 0.5, j + 0.5);
        if (d - verge < reserved[k]!) reserved[k] = d - verge;
        if (paved && d < paving[k]!) paving[k] = d;
      }
  };
  for (const street of plan.streets) for (let n = 1; n < street.points.length; n++) {
    const a = street.points[n - 1]!, b = street.points[n]!, half = street.width / 2;
    measure(Math.min(a[0], b[0]) - half, Math.max(a[0], b[0]) + half, Math.min(a[2], b[2]) - half, Math.max(a[2], b[2]) + half,
      (x, z) => segmentDistance(a[0], a[2], b[0], b[2], x, z) - half, street.verge, street.kind !== 'trail');
  }
  for (const square of [plan.market, plan.castle.court, ...plan.courts]) {
    const xs = square.boundary.map(p => p[0]), zs = square.boundary.map(p => p[1]);
    measure(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), (x, z) => polygonDistance(square.boundary, x, z), 0, true);
  }
  // Every plot's forecourt apron, built or reserved: 8 m along its front, 3 m out toward the street.
  for (const plot of [...plan.reservations, ...plan.homes]) {
    const { front, right, outward } = homeFrame(plot), xs: number[] = [], zs: number[] = [];
    for (const side of [-4, 4]) for (const out of [0, 3]) { xs.push(front[0] + right[0] * side + outward[0] * out); zs.push(front[2] + right[2] * side + outward[2] * out); }
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    measure(minX, maxX, minZ, maxZ, (x, z) => {
      const dx = Math.max(minX - x, 0, x - maxX), dz = Math.max(minZ - z, 0, z - maxZ);
      return dx || dz ? Math.hypot(dx, dz) : -Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
    }, 0, false);
  }
  for (let k = 0; k < keep.length; k++) {
    if (reserved[k]! < reach && keep[k]! < TOWN_KEEP.verge) keep[k] = TOWN_KEEP.verge;
  }
  // Every lot, built or reserved, 1 m clear: growth only ever builds there.
  for (const plot of [...plan.reservations, ...plan.homes]) rect(plot.lot.minX - 1, plot.lot.maxX + 1, plot.lot.minZ - 1, plot.lot.maxZ + 1, TOWN_KEEP.lot);
  for (let k = 0; k < keep.length; k++) if (paving[k]! <= 0 && keep[k]! < TOWN_KEEP.paving) keep[k] = TOWN_KEEP.paving;
  for (const square of [plan.market, plan.castle.court, ...plan.courts]) {
    const xs = square.boundary.map(p => p[0]), zs = square.boundary.map(p => p[1]);
    for (let j = Math.floor(Math.min(...zs) - 2); j < Math.max(...zs) + 2; j++) for (let i = Math.floor(Math.min(...xs) - 2); i < Math.max(...xs) + 2; i++)
      if (polygonDistance(square.boundary, i + 0.5, j + 0.5) < 1 + HALF_DIAGONAL) set(i, j, TOWN_KEEP.square);
  }
  const castle = plan.castle.bounds;
  rect(castle.minX - 1, castle.maxX + 1, castle.minZ - 1, castle.maxZ + 1, TOWN_KEEP.castle);
  // The lake, out to 1.25 × its radii (a cell is kept when any part of it reaches that ellipse).
  const lake = plan.lake, rx = lake.radiusX * 1.25, rz = lake.radiusZ * 1.25;
  for (let j = Math.floor(lake.z - rz - 2); j < lake.z + rz + 2; j++) for (let i = Math.floor(lake.x - rx - 2); i < lake.x + rx + 2; i++)
    if (Math.hypot((i + 0.5 - lake.x) / (rx + HALF_DIAGONAL), (j + 0.5 - lake.z) / (rz + HALF_DIAGONAL)) < 1) set(i, j, TOWN_KEEP.lake);
  return { grid, keep };
}

// ---------------------------------------------------------------------------------------------------------------
// Streets as the land's grain

interface Segment { street: number; ax: number; az: number; dx: number; dz: number; length: number; s0: number }
const BUCKET = 16;

/** Lanes and the main street (trails too) in 16 m buckets; approaches are a door's stub, not a field's grain. */
class StreetGrain {
  readonly segments: Segment[] = [];
  readonly ids: string[] = [];
  readonly lengths: number[] = [];
  private readonly buckets = new Map<number, number[]>();
  constructor(plan: SettlementPlan, region: Grid) {
    const streets = plan.streets.filter(street => street.kind !== 'approach');
    const lines: { id: string; points: readonly (readonly number[])[] }[] = streets.length
      ? streets.map(street => ({ id: street.id, points: street.points }))
      // A plan without a street still has a grain: the region's own north edge.
      : [{ id: 'region', points: [[region.x0, 0, region.z0], [region.x0 + region.width, 0, region.z0]] }];
    lines.forEach((line, index) => {
      let s = 0;
      for (let n = 1; n < line.points.length; n++) {
        const a = line.points[n - 1]!, b = line.points[n]!, dx = b[0]! - a[0]!, dz = b[2]! - a[2]!, length = Math.hypot(dx, dz);
        if (length < 1e-6) continue;
        const id = this.segments.length;
        this.segments.push({ street: index, ax: a[0]!, az: a[2]!, dx, dz, length, s0: s });
        s += length;
        for (let bz = Math.floor(Math.min(a[2]!, b[2]!) / BUCKET); bz <= Math.floor(Math.max(a[2]!, b[2]!) / BUCKET); bz++)
          for (let bx = Math.floor(Math.min(a[0]!, b[0]!) / BUCKET); bx <= Math.floor(Math.max(a[0]!, b[0]!) / BUCKET); bx++) {
            const key = (bx + 4096) * 8192 + bz + 4096, list = this.buckets.get(key);
            if (list) list.push(id); else this.buckets.set(key, [id]);
          }
      }
      this.ids.push(line.id); this.lengths.push(s);
    });
  }
  /**
   * Each bucket's segments ring by ring, in the order a ring search from that bucket meets them, each segment only
   * at its first meeting. A segment met again can never change the nearest (its distance is the one already
   * weighed), so walking these lists answers exactly what walking every bucket of every ring would.
   */
  private readonly rings = new Map<number, { readonly lists: Int32Array[]; readonly met: Set<number> }>();
  private ring(bx: number, bz: number, ring: number): Int32Array {
    const key = (bx + 4096) * 8192 + bz + 4096;
    let entry = this.rings.get(key);
    if (!entry) { entry = { lists: [], met: new Set() }; this.rings.set(key, entry); }
    while (entry.lists.length <= ring) {
      const r = entry.lists.length, out: number[] = [], met = entry.met;
      const visit = (ox: number, oz: number) => {
        const list = this.buckets.get((bx + ox + 4096) * 8192 + bz + oz + 4096);
        if (list) for (const id of list) if (!met.has(id)) { met.add(id); out.push(id); }
      };
      // The ring's own cells in row order: its first row, its two sides, its last row.
      if (r === 0) visit(0, 0);
      else {
        for (let ox = -r; ox <= r; ox++) visit(ox, -r);
        for (let oz = 1 - r; oz < r; oz++) { visit(-r, oz); visit(r, oz); }
        for (let ox = -r; ox <= r; ox++) visit(ox, r);
      }
      entry.lists.push(Int32Array.from(out));
    }
    return entry.lists[ring]!;
  }
  /** The nearest grain segment to a point: its index, arc position along its street, distance and side. */
  nearest(x: number, z: number): { segment: number; s: number; t: number; side: 1 | -1 } {
    const bx = Math.floor(x / BUCKET), bz = Math.floor(z / BUCKET);
    let best = Infinity, found = -1, along = 0;
    for (let ring = 0; ring < 64; ring++) {
      for (const id of this.ring(bx, bz, ring)) {
        const g = this.segments[id]!, t = Math.max(0, Math.min(1, ((x - g.ax) * g.dx + (z - g.az) * g.dz) / (g.length * g.length)));
        const d = Math.hypot(x - g.ax - t * g.dx, z - g.az - t * g.dz);
        if (d < best - 1e-9) { best = d; found = id; along = t; }
      }
      if (found >= 0 && best <= ring * BUCKET) break;
    }
    const g = this.segments[found]!;
    return { segment: found, s: g.s0 + along * g.length, t: best, side: g.dx * (z - g.az) - g.dz * (x - g.ax) >= 0 ? 1 : -1 };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The plan

type CropKey = keyof typeof CROP_FORMS | 'ploughed';
interface Parcel {
  id: number; key: string; cells: number[];
  street: number; side: 1 | -1;
  /** Mean grain direction (radians, [0, π)) and the parcel's shape in that frame. */
  grain: number; along: number; across: number; fill: number;
  cx: number; cz: number; town: number; edge: number;
  kind: 'lawn' | 'meadow' | 'rough' | 'field';
  crop?: CropKey; rowByte?: number;
}
type Bloom = 'petal' | 'blue' | 'gold' | 'cream';
const BLOOMS: Record<SettlementHome['style'], readonly Bloom[]> = {
  hearth: ['petal', 'petal', 'gold', 'cream'], tide: ['blue', 'blue', 'cream', 'gold'], grove: ['gold', 'cream', 'petal', 'blue'],
};
const FLOWER_USE: Record<Bloom, TownUse> = { petal: 'flowers-petal', blue: 'flowers-blue', gold: 'flowers-gold', cream: 'flowers-cream' };
const FLOWER_FORM: Record<Bloom, TownForm> = { petal: 'wildflowers-petal', blue: 'wildflowers-blue', gold: 'wildflowers-gold', cream: 'wildflowers-cream' };

/** Smallest parcel kept apart before it joins its neighbour; fields need room for a plough to turn. */
const MIN_PARCEL = 160;
/** Fields near homes lean to the kitchen: brassicas, beans, lavender. Out in the open, grain. */
const NEAR_CROPS: readonly [CropKey, number][] = [['cabbage', 0.2], ['beans', 0.2], ['lavender', 0.22], ['wheat', 0.14], ['barley', 0.1], ['ploughed', 0.14]];
const FAR_CROPS: readonly [CropKey, number][] = [['wheat', 0.34], ['barley', 0.24], ['lavender', 0.12], ['ploughed', 0.18], ['beans', 0.06], ['cabbage', 0.06]];

/**
 * Plans the town's land use and its walk-through planting. Pure: the same plan, occupied placements and existing
 * dressing always give the same bytes and pieces; it never reads the hour, presence or the land beyond the town.
 */
export function planTownGround(plan: SettlementPlan, input: TownGroundInput): TownGroundPlan {
  const seedText = `${plan.config.seed}:town-ground`, seed = seedHash(seedText);
  const rand = (...parts: (string | number)[]) => randomUnit(seedHash(`${seedText}:${parts.join(':')}`));
  const { grid, keep } = townKeepOut(plan, input);
  const { width, depth, x0, z0 } = grid, size = width * depth;
  const code = new Uint8Array(size), rows = new Uint8Array(size);
  const centreX = (k: number) => x0 + (k % width) + 0.5, centreZ = (k: number) => z0 + Math.floor(k / width) + 0.5;
  const edgeDistance = (x: number, z: number) => Math.min(x - x0, x0 + width - x, z - z0, z0 + depth - z);
  /** How far in from the region's edge the land use frays out to plain turf: 9-24 m on a slow wavering line. */
  const margin = (x: number, z: number) => 9 + 12 * noise(seed, x, z, 38, 31) + 3 * noise(seed, x, z, 9, 32);

  // The exact floor: the founded half-metre lattice. The installed landform reads the collision compiler's own cached
  // grid (the same numbers `foundedGroundAt` gives); any other landform samples `foundedGroundAt` once per half-cell.
  const floor = floorSampler(plan, grid);

  // Distance from the built town (lots, streets, squares, castle), for how tended the ground is.
  const town = chamfer(grid, k => keep[k]! >= TOWN_KEEP.verge && keep[k]! <= TOWN_KEEP.castle);

  // 1. Cottage borders behind and beside homes that back onto open ground. Claimed first: they belong to their home.
  const pieces: GroundPiece[] = [], claimed = new Uint8Array(size);
  const borderForms = { warm: townBlueprint('border-warm'), cool: townBlueprint('border-cool') };
  for (const home of [...plan.homes].sort((a, b) => a.slot - b.slot)) planBorders(home);

  function planBorders(home: SettlementHome): void {
    const { front, right, outward } = homeFrame(home), lot = home.lot;
    const edges: { name: string; n: XZ; chance: number; count: number }[] = [
      { name: 'back', n: [-outward[0], -outward[2]], chance: 0.72, count: 2 },
      { name: 'left', n: [-right[0], -right[2]], chance: 0.45, count: 2 },
      { name: 'right', n: [right[0], right[2]], chance: 0.45, count: 2 },
    ];
    const style = rand('border-style', home.id) < (home.style === 'tide' ? 0.3 : home.style === 'hearth' ? 0.7 : 0.5) ? 'warm' : 'cool';
    for (const edge of edges) {
      if (rand('border', home.id, edge.name) > edge.chance) continue;
      const [nx, nz] = edge.n, e: XZ = [nz, -nx];
      // The corner the edge's run starts from, so local +X runs along it and local +Z points away from the lot.
      const qx = nx > 0.5 ? lot.maxX : nx < -0.5 ? lot.minX : e[0] > 0 ? lot.minX : lot.maxX;
      const qz = nz > 0.5 ? lot.maxZ : nz < -0.5 ? lot.minZ : e[1] > 0 ? lot.minZ : lot.maxZ;
      const length = Math.abs(e[0]) > 0.5 ? lot.maxX - lot.minX : lot.maxZ - lot.minZ;
      // Out on the first whole metre of open ground past the lot's 1 m clearance.
      const line = nx + nz > 0 ? (Math.abs(nx) > 0.5 ? qx : qz) + 1 : (Math.abs(nx) > 0.5 ? qx : qz) - 1;
      const offset = Math.abs((nx + nz > 0 ? Math.ceil(line - 1e-9) : Math.floor(line + 1e-9)) - (Math.abs(nx) > 0.5 ? qx : qz));
      const yaw = Math.atan2(nx, nz), laid: number[] = [];
      // Along the back from the middle outward; along a side from the back toward the house, never the forecourt.
      const candidates: number[] = [];
      for (let a = -1; a <= length - 2; a += 0.5) candidates.push(a);
      const depthOf = (a: number) => {
        const x = qx + e[0] * (a + 1.5), z = qz + e[1] * (a + 1.5);
        return -((x - front[0]) * outward[0] + (z - front[2]) * outward[2]);
      };
      const order = edge.name === 'back'
        ? candidates.sort((a, b) => Math.abs(a + 1.5 - length / 2) - Math.abs(b + 1.5 - length / 2) || a - b)
        : candidates.filter(a => depthOf(a) >= 7).sort((a, b) => depthOf(b) - depthOf(a) || a - b);
      for (const a of order) {
        if (laid.length >= edge.count) break;
        if (laid.some(b => Math.abs(b - a) < 3.5)) continue;
        const position: [number, number, number] = [qx + e[0] * a + nx * offset, 0, qz + e[1] * a + nz * offset];
        const footprint = quad(position, yaw, 0, 3, 0, 1);
        const cells: number[] = [];
        if (overlapCells(footprint, 1, (i, j) => {
          if (!inGrid(grid, i, j)) return true;
          const k = cellIndex(grid, i, j);
          if (keep[k] || claimed[k]) return true;
          cells.push(k); return false;
        })) continue;
        // It backs onto open ground: most of the four metres beyond it are free.
        let open = 0, total = 0;
        overlapCells(quad(position, yaw, 0, 3, 1, 5), 1, (i, j) => { total++; if (inGrid(grid, i, j) && !keep[cellIndex(grid, i, j)]) open++; });
        if (open < total * 0.75) continue;
        const level = floor.level(footprint);
        if (level === undefined) continue;
        position[1] = level - 0.01;
        const blueprint = rand('border-colour', home.id, edge.name, laid.length) < 0.8 ? borderForms[style] : borderForms[style === 'warm' ? 'cool' : 'warm'];
        pieces.push({ id: `town:border:${home.id}:${edge.name}:${laid.length}`, blueprint, position, yaw, lotSlot: home.slot });
        for (const k of cells) { claimed[k] = 1; code[k] = TOWN_USE.border; }
        laid.push(a);
      }
    }
  }

  // 2. Parcels. Every open cell takes the grain of its nearest lane: how far along it (cut into field lengths) and
  //    how far out from it (cut into field depths) on which side. Fields therefore follow the streets' curves.
  const grain = new StreetGrain(plan, grid), keyOf = new Int32Array(size).fill(-1), keys: string[] = [], keyIds = new Map<string, number>();
  const segmentOf = new Int32Array(size).fill(-1);
  const cuts = new Map<string, number[]>();
  const cutsFor = (name: string, from: number, to: number, min: number, spread: number) => {
    let list = cuts.get(name);
    if (!list) {
      list = [];
      for (let at = from - rand('cut', name, 'start') * min, n = 0; at < to; n++) { list.push(at); at += min + rand('cut', name, n) * spread; }
      cuts.set(name, list);
    }
    return list;
  };
  const binOf = (list: readonly number[], value: number) => {
    let lo = 0, hi = list.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (list[mid]! <= value) lo = mid; else hi = mid - 1; }
    return lo;
  };
  for (let k = 0; k < size; k++) {
    if (keep[k] || claimed[k]) continue;
    const near = grain.nearest(centreX(k), centreZ(k)), g = grain.segments[near.segment]!, street = grain.ids[g.street]!;
    const along = binOf(cutsFor(`${street}:${near.side}`, -40, grain.lengths[g.street]! + 40, 14, 20), near.s);
    const out = binOf(cutsFor(`${street}:${near.side}:${along}`, 0, 400, 16, 16), near.t);
    const key = `${street}:${near.side}:${along}:${out}`;
    let id = keyIds.get(key);
    if (id === undefined) { id = keys.length; keys.push(key); keyIds.set(key, id); }
    keyOf[k] = id; segmentOf[k] = near.segment;
  }
  // Connected pieces of each key are parcels; slivers squeezed between lots join the neighbour they share most with.
  const parcelOf = new Int32Array(size).fill(-1), parcels: Parcel[] = [];
  const queue = new Int32Array(size);
  for (let k = 0; k < size; k++) {
    if (keyOf[k]! < 0 || parcelOf[k]! >= 0) continue;
    const id = parcels.length, cells: number[] = [];
    let head = 0, tail = 0;
    queue[tail++] = k; parcelOf[k] = id;
    while (head < tail) {
      const c = queue[head++]!, i = c % width;
      cells.push(c);
      for (const n of [i > 0 ? c - 1 : -1, i < width - 1 ? c + 1 : -1, c - width, c + width]) {
        if (n < 0 || n >= size || parcelOf[n]! >= 0 || keyOf[n] !== keyOf[k]) continue;
        parcelOf[n] = id; queue[tail++] = n;
      }
    }
    const g = grain.segments[segmentOf[k]!]!;
    parcels.push({ id, key: `${keys[keyOf[k]!]}@${k}`, cells, street: g.street, side: 1, grain: 0, along: 0, across: 0, fill: 0, cx: 0, cz: 0, town: 0, edge: 0, kind: 'lawn' });
  }
  mergeSlivers();

  function mergeSlivers(): void {
    for (let pass = 0; pass < 4; pass++) {
      const shared = new Map<number, Map<number, number>>();
      const touch = (a: number, b: number) => {
        let row = shared.get(a);
        if (!row) shared.set(a, row = new Map());
        row.set(b, (row.get(b) ?? 0) + 1);
      };
      for (let k = 0; k < size; k++) {
        const p = parcelOf[k]!;
        if (p < 0) continue;
        for (const n of [(k % width) < width - 1 ? k + 1 : -1, k + width < size ? k + width : -1]) {
          const q = n >= 0 ? parcelOf[n]! : -1;
          if (q >= 0 && q !== p) { touch(p, q); touch(q, p); }
        }
      }
      const small = parcels.filter(p => p.cells.length && p.cells.length < MIN_PARCEL).sort((a, b) => a.cells.length - b.cells.length || a.cells[0]! - b.cells[0]!);
      let merged = 0;
      const absorbed = new Set<number>();
      for (const p of small) {
        if (absorbed.has(p.id) || !p.cells.length) continue;
        let best: Parcel | undefined, score = 0;
        for (const [q, count] of shared.get(p.id) ?? []) {
          const other = parcels[q]!;
          if (absorbed.has(q) || !other.cells.length) continue;
          const weight = count * (other.street === p.street ? 2 : 1);
          if (weight > score || (weight === score && best && other.id < best.id)) { best = other; score = weight; }
        }
        if (!best) continue;
        const into = best.cells.length >= p.cells.length ? best : p, from = into === best ? p : best;
        for (const k of from.cells) parcelOf[k] = into.id;
        into.cells.push(...from.cells); from.cells = [];
        absorbed.add(from.id); absorbed.add(into.id); merged++;
      }
      if (!merged) break;
    }
  }

  // 3. What each parcel is: shape in its grain, how far from the houses and from the town's edge.
  const live = parcels.filter(p => p.cells.length);
  for (const p of live) {
    p.cells.sort((a, b) => a - b);
    let sx = 0, sz = 0, s2 = 0, c2 = 0, townSum = 0;
    for (const k of p.cells) {
      sx += centreX(k); sz += centreZ(k); townSum += town[k]!;
      const g = grain.segments[segmentOf[k]!]!, angle = 2 * Math.atan2(g.dz, g.dx);
      s2 += Math.sin(angle); c2 += Math.cos(angle);
    }
    p.cx = sx / p.cells.length; p.cz = sz / p.cells.length; p.town = townSum / p.cells.length;
    p.grain = ((Math.atan2(s2, c2) / 2) % Math.PI + Math.PI) % Math.PI;
    const ux = Math.cos(p.grain), uz = Math.sin(p.grain);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const k of p.cells) {
      const a = (centreX(k) - p.cx) * ux + (centreZ(k) - p.cz) * uz, b = -(centreX(k) - p.cx) * uz + (centreZ(k) - p.cz) * ux;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    p.along = a1 - a0 + 1; p.across = b1 - b0 + 1; p.fill = p.cells.length / (p.along * p.across);
    p.edge = edgeDistance(p.cx, p.cz);
    const area = p.cells.length, narrow = Math.min(p.along, p.across);
    // A field is ploughed square to its lanes; one the land's frayed margin would bite into is left to the heath.
    const frayed = p.cells.filter(k => edgeDistance(centreX(k), centreZ(k)) < margin(centreX(k), centreZ(k)) + 4).length / area;
    if (area < 40) p.kind = p.town < 6 ? 'lawn' : 'meadow';
    else if (area < MIN_PARCEL || narrow < 8 || p.fill < 0.42) p.kind = frayed > 0.3 ? 'rough' : 'meadow';
    else if (frayed > 0.06 || (p.town > 16 && rand('heath', p.key) < 0.16)) p.kind = 'rough';
    else p.kind = rand('fallow', p.key) < 0.18 ? 'meadow' : 'field';
  }
  // Crops: no two touching fields share one, and each field ploughs along its longer side (a few across it).
  const fields = live.filter(p => p.kind === 'field');
  const neighbours = parcelNeighbours();
  for (const p of fields) {
    const table = p.town < 26 ? NEAR_CROPS : FAR_CROPS, taken = new Set((neighbours.get(p.id) ?? []).map(q => parcels[q]!.crop).filter(Boolean));
    for (let attempt = 0; attempt < 6; attempt++) {
      let roll = rand('crop', p.key, attempt), crop: CropKey = table[0]![0];
      for (const [name, weight] of table) { if (roll < weight) { crop = name; break; } roll -= weight; }
      p.crop = crop;
      if (!taken.has(crop)) break;
    }
    const lengthwise = p.along >= p.across ? p.grain : p.grain + Math.PI / 2;
    const direction = rand('rows', p.key) < 0.18 ? lengthwise + Math.PI / 2 : lengthwise;
    p.rowByte = ((Math.round(direction / Math.PI * 256) % 256) + 256) % 256;
  }

  function parcelNeighbours(): Map<number, number[]> {
    // Fields across a lane or a headland still read as neighbours from above: look four cells out.
    const pairs = new Map<number, Set<number>>();
    const add = (a: number, b: number) => { let s = pairs.get(a); if (!s) pairs.set(a, s = new Set()); s.add(b); };
    for (let k = 0; k < size; k++) {
      const p = parcelOf[k]!;
      if (p < 0) continue;
      for (let step = 1; step <= 4; step++) for (const n of [(k % width) + step < width ? k + step : -1, k + step * width < size ? k + step * width : -1]) {
        const q = n >= 0 ? parcelOf[n]! : -1;
        if (q >= 0 && q !== p) { add(p, q); add(q, p); }
      }
    }
    return new Map([...pairs].map(([p, s]) => [p, [...s].sort((a, b) => a - b)]));
  }

  // 4. Paint the mask. Fields keep a 1 m lawn headland inside every edge, so two fields part on 2 m of turf and a
  //    field stands 2 m off every verge and lot line. Rough ground is organic: heath and bracken in drifts.
  const isField = new Uint8Array(size);
  for (const p of live) {
    if (p.kind === 'field') {
      const use = TOWN_USE[p.crop!];
      for (const k of p.cells) {
        const i = k % width;
        let headland = false;
        for (let dz = -1; dz <= 1 && !headland; dz++) for (let dx = -1; dx <= 1 && !headland; dx++) {
          const ni = i + dx, n = k + dx + dz * width;
          if (ni < 0 || ni >= width || n < 0 || n >= size || parcelOf[n] !== p.id) headland = true;
        }
        if (!headland) { code[k] = use; rows[k] = p.rowByte!; isField[k] = 1; }
      }
      continue;
    }
    for (const k of p.cells) {
      if (p.kind === 'lawn') continue;
      const x = centreX(k), z = centreZ(k), beyond = edgeDistance(x, z) - margin(x, z);
      // Rough ground lies in blobs on open turf, thinning toward the region's edge until only the turf is left, the
      // same as the land beyond the region; so neither that edge nor any line parallel to it ever shows.
      const blob = noise(seed, x, z, 30, 40) * 0.7 + noise(seed, x, z, 10, 41) * 0.3;
      if (beyond < 0 || blob < 0.36 + 0.5 * Math.max(0, 1 - beyond / 30)) continue;
      if (p.kind === 'meadow') { code[k] = TOWN_USE.meadow; continue; }
      // Bracken in clumps on the outer rough ground and in a few hollows; heath in broad drifts within.
      if (beyond < 12 && noise(seed, x, z, 13, 1) > 0.5 + beyond / 40) { code[k] = TOWN_USE.bracken; continue; }
      const heath = noise(seed, x, z, 26, 2) * 0.7 + noise(seed, x, z, 9, 3) * 0.3;
      code[k] = heath > 0.56 ? TOWN_USE.heath : heath < 0.3 && noise(seed, x, z, 15, 4) > 0.62 ? TOWN_USE.bracken : TOWN_USE.meadow;
    }
  }

  // 5. Wildflower drifts in the meadows: long low swathes of one colour, the colour leaning to the nearest kit.
  const drifts: { id: string; x: number; z: number; ux: number; uz: number; length: number; width: number; bloom: Bloom }[] = [];
  const homeStyle = nearestStyle(plan);
  for (let gz = Math.floor(z0 / 13); gz <= Math.floor((z0 + depth) / 13); gz++) for (let gx = Math.floor(x0 / 13); gx <= Math.floor((x0 + width) / 13); gx++) {
    const x = (gx + 0.15 + hash(seed, gx, gz, 11) * 0.7) * 13, z = (gz + 0.15 + hash(seed, gx, gz, 12) * 0.7) * 13;
    const i = Math.floor(x), j = Math.floor(z);
    if (!inGrid(grid, i, j) || code[cellIndex(grid, i, j)] !== TOWN_USE.meadow) continue;
    if (hash(seed, gx, gz, 13) > 0.3 + 0.5 * noise(seed, x, z, 40, 14)) continue;
    const blooms = BLOOMS[homeStyle(x, z)], bloom = blooms[Math.floor(hash(seed, gx, gz, 15) * blooms.length)]!;
    const angle = hash(seed, gx, gz, 16) * Math.PI;
    drifts.push({ id: `${gx}:${gz}`, x, z, ux: Math.cos(angle), uz: Math.sin(angle), length: 5 + hash(seed, gx, gz, 17) * 5, width: 2.4 + hash(seed, gx, gz, 18) * 1.6, bloom });
  }
  for (const drift of drifts) {
    const reach = drift.length / 2 + 1;
    for (let j = Math.floor(drift.z - reach); j <= drift.z + reach; j++) for (let i = Math.floor(drift.x - reach); i <= drift.x + reach; i++) {
      if (!inGrid(grid, i, j)) continue;
      const k = cellIndex(grid, i, j), dx = i + 0.5 - drift.x, dz = j + 0.5 - drift.z;
      const a = dx * drift.ux + dz * drift.uz, b = -dx * drift.uz + dz * drift.ux;
      if (code[k] === TOWN_USE.meadow && (a / (drift.length / 2)) ** 2 + (b / (drift.width / 2)) ** 2 <= 1) code[k] = TOWN_USE[FLOWER_USE[drift.bloom]];
    }
  }

  // 6. Pieces near the eye. Crops: one square metre each on the field's own rotated lattice, so neighbouring squares
  //    join into unbroken drills; only where the floor is level under the whole square.
  for (const p of fields) {
    if (p.crop === 'ploughed') continue;
    const blueprint = townBlueprint(CROP_FORMS[p.crop!]), use = TOWN_USE[p.crop!];
    const phi = townRowAngle(p.rowByte!), ux = Math.cos(phi), uz = Math.sin(phi), yaw = -phi;
    const ox = Math.round(p.cx * 2) / 2, oz = Math.round(p.cz * 2) / 2;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const k of p.cells) for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const x = centreX(k) - 0.5 + cx - ox, z = centreZ(k) - 0.5 + cz - oz;
      const a = x * ux + z * uz, b = -x * uz + z * ux;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    for (let jb = Math.floor(b0); jb < b1; jb++) for (let ia = Math.floor(a0); ia < a1; ia++) {
      const position: [number, number, number] = [ox + ux * ia - uz * jb, 0, oz + uz * ia + ux * jb];
      const footprint = quad(position, yaw, 0, 1, 0, 1);
      if (overlapCells(footprint, 1, (i, j) => {
        if (!inGrid(grid, i, j)) return true;
        const k = cellIndex(grid, i, j);
        return parcelOf[k] !== p.id || !isField[k] || code[k] !== use;
      })) continue;
      const level = floor.level(footprint);
      if (level === undefined) continue;
      position[1] = level - 0.01;
      pieces.push({ id: `town:crop:${p.key}:${ia}:${jb}`, blueprint, position, yaw });
    }
  }

  // Wildflower patches inside each drift, loosely staggered and freely turned.
  const ROUGH = new Set<number>([TOWN_USE.meadow, TOWN_USE.heath, TOWN_USE.bracken, TOWN_USE['flowers-petal'], TOWN_USE['flowers-blue'], TOWN_USE['flowers-gold'], TOWN_USE['flowers-cream']]);
  const roughUnder = (footprint: Quad) => !overlapCells(footprint, 1, (i, j) => !inGrid(grid, i, j) || !ROUGH.has(code[cellIndex(grid, i, j)]!));
  const loose = (id: string, form: TownForm, x: number, z: number, yaw: number, centreUse: (use: number) => boolean): boolean => {
    const blueprint = townBlueprint(form), w = blueprint.size[0] * CELL, d = blueprint.size[2] * CELL, c = Math.cos(yaw), s = Math.sin(yaw);
    const position: [number, number, number] = [x - (c * w / 2 + s * d / 2), 0, z - (-s * w / 2 + c * d / 2)];
    const i = Math.floor(x), j = Math.floor(z);
    if (!inGrid(grid, i, j) || !centreUse(code[cellIndex(grid, i, j)]!)) return false;
    const footprint = quad(position, yaw, 0, w, 0, d);
    if (!roughUnder(footprint)) return false;
    // Loose cover may straddle one grading step: it sits on the lower terrace, the higher one simply shows less of it.
    const low = floor.lowest(footprint, 0.5);
    if (low === undefined) return false;
    position[1] = low - 0.03;
    pieces.push({ id, blueprint, position, yaw });
    return true;
  };
  const flowerCells = new Set<number>(Object.values(FLOWER_USE).map(use => TOWN_USE[use]));
  for (const drift of drifts) {
    const use = TOWN_USE[FLOWER_USE[drift.bloom]];
    for (let n = 0; n < 15; n++) {
      const t = ((n % 5) + 0.5) / 5 - 0.5, row = Math.floor(n / 5) - 1;
      const a = t * drift.length + (hash(seed, n, 0, seedHash(drift.id)) - 0.5) * 0.6, b = row * drift.width * 0.36 + (hash(seed, n, 1, seedHash(drift.id)) - 0.5) * 0.4;
      if ((a / (drift.length / 2)) ** 2 + (b / (drift.width / 2)) ** 2 > 1) continue;
      loose(`town:flowers:${drift.id}:${n}`, FLOWER_FORM[drift.bloom], drift.x + drift.ux * a - drift.uz * b, drift.z + drift.uz * a + drift.ux * b,
        hash(seed, n, 2, seedHash(drift.id)) * Math.PI * 2, value => value === use);
    }
  }
  // Long grass, heather and bracken on a jittered 2.4 m lattice, gathered into clumps by a slow field so the rough
  // ground is broken by open turf rather than carpeted. Never into a wildflower drift.
  const PITCH = 2.4;
  for (let gz = Math.floor(z0 / PITCH); gz <= Math.floor((z0 + depth) / PITCH); gz++) for (let gx = Math.floor(x0 / PITCH); gx <= Math.floor((x0 + width) / PITCH); gx++) {
    const x = (gx + 0.5) * PITCH + (hash(seed, gx, gz, 21) - 0.5) * 0.7, z = (gz + 0.5) * PITCH + (hash(seed, gx, gz, 22) - 0.5) * 0.7;
    const i = Math.floor(x), j = Math.floor(z);
    if (!inGrid(grid, i, j)) continue;
    const here = code[cellIndex(grid, i, j)]!;
    if (here !== TOWN_USE.meadow && here !== TOWN_USE.heath && here !== TOWN_USE.bracken) continue;
    const clump = noise(seed, x, z, 11, 23) * 0.7 + noise(seed, x, z, 4, 24) * 0.3, roll = hash(seed, gx, gz, 25), pick = hash(seed, gx, gz, 26);
    let form: TownForm;
    if (here === TOWN_USE.meadow) { if (roll > clump * 0.9 + 0.08) continue; form = pick < 0.72 ? 'tall-grass' : 'meadow-tufts'; }
    else if (here === TOWN_USE.heath) { if (roll > clump * 0.9 + 0.12) continue; form = pick < 0.8 ? 'heather' : 'tall-grass'; }
    else { if (roll > clump * 0.9 + 0.1) continue; form = pick < 0.75 ? 'bracken' : 'tall-grass'; }
    const w = townBlueprint(form).size[0] * CELL;
    // Freely turned where the rough ground is wide; squared to the metre lattice where it is a narrow strip.
    const tries: [number, number, number][] = [[x, z, hash(seed, gx, gz, 27) * Math.PI * 2], [Math.round(x), Math.round(z), Math.floor(hash(seed, gx, gz, 28) * 4) * Math.PI / 2]];
    for (const [px, pz, yaw] of tries) {
      // Clear of every drift's patches: the flowers keep their own colour.
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const footprint = quad([px - (c * w / 2 + s * w / 2), 0, pz - (-s * w / 2 + c * w / 2)], yaw, 0, w, 0, w);
      if (overlapCells(footprint, 1, (ci, cj) => inGrid(grid, ci, cj) && flowerCells.has(code[cellIndex(grid, ci, cj)]!))) continue;
      if (loose(`town:cover:${gx}:${gz}`, form, px, pz, yaw, value => value === here)) break;
    }
  }

  // 7. Group and report.
  pieces.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byBlueprint = new Map<string, GroundPiece[]>(), counts: Record<string, number> = {};
  const formOf = new Map<string, string>();
  for (const form of ['crop-wheat', 'crop-barley', 'crop-lavender', 'crop-cabbage', 'crop-beans', 'tall-grass', 'heather', 'bracken', 'border-warm', 'border-cool',
    'wildflowers-petal', 'wildflowers-blue', 'wildflowers-gold', 'wildflowers-cream', 'meadow-tufts'] as const) formOf.set(townBlueprint(form).id, form);
  for (const piece of pieces) {
    const list = byBlueprint.get(piece.blueprint.id);
    if (list) list.push(piece); else byBlueprint.set(piece.blueprint.id, [piece]);
    const form = formOf.get(piece.blueprint.id)!;
    counts[form] = (counts[form] ?? 0) + 1;
  }
  const cells: Record<string, number> = {};
  for (let k = 0; k < size; k++) { const name = USE_NAMES[code[k]!]!; cells[name] = (cells[name] ?? 0) + 1; }
  return {
    mask: { origin: [x0, z0], width, depth, cell: 1, data: code, rows },
    pieces: new Map([...byBlueprint].sort(([a], [b]) => (a < b ? -1 : 1))),
    report: { counts, cells, parcels: fields.length },
  };
}

/** The nearest home's kit at a point (measured to its lot), the town's first home's beyond 60 m. */
function nearestStyle(plan: SettlementPlan): (x: number, z: number) => SettlementHome['style'] {
  const buckets = new Map<number, SettlementHome[]>();
  for (const home of plan.homes) {
    const key = (Math.floor(home.position[0] / 32) + 4096) * 8192 + Math.floor(home.position[2] / 32) + 4096, list = buckets.get(key);
    if (list) list.push(home); else buckets.set(key, [home]);
  }
  const fallback = [...plan.homes].sort((a, b) => a.slot - b.slot)[0]?.style ?? 'grove';
  return (x, z) => {
    let best: SettlementHome | undefined, distance = 60;
    for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++)
      for (const home of buckets.get((Math.floor(x / 32) + ox + 4096) * 8192 + Math.floor(z / 32) + oz + 4096) ?? []) {
        const l = home.lot, d = Math.hypot(Math.max(l.minX - x, 0, x - l.maxX), Math.max(l.minZ - z, 0, z - l.maxZ));
        if (d < distance || (d === distance && best && home.slot < best.slot)) { distance = d; best = home; }
      }
    return best?.style ?? fallback;
  };
}

/** Approximate Euclidean distance (3-4 chamfer, in metres) from every cell to the nearest source cell. */
function chamfer(grid: Grid, source: (k: number) => boolean): Float32Array {
  const { width, depth } = grid, d = new Float32Array(width * depth);
  for (let k = 0; k < d.length; k++) d[k] = source(k) ? 0 : 1e6;
  const pass = (k: number, n: number, w: number) => { if (d[n]! + w < d[k]!) d[k] = d[n]! + w; };
  for (let j = 0; j < depth; j++) for (let i = 0; i < width; i++) {
    const k = i + j * width;
    if (i > 0) pass(k, k - 1, 1);
    if (j > 0) { pass(k, k - width, 1); if (i > 0) pass(k, k - width - 1, Math.SQRT2); if (i < width - 1) pass(k, k - width + 1, Math.SQRT2); }
  }
  for (let j = depth - 1; j >= 0; j--) for (let i = width - 1; i >= 0; i--) {
    const k = i + j * width;
    if (i < width - 1) pass(k, k + 1, 1);
    if (j < depth - 1) { pass(k, k + width, 1); if (i < width - 1) pass(k, k + width + 1, Math.SQRT2); if (i > 0) pass(k, k + width - 1, Math.SQRT2); }
  }
  return d;
}

/**
 * Hand the planner the founded floor tops the scene's ground workers already sampled (`sampleFoundedTerrain`'s
 * layout). Sampling that floor again was most of the planner's time. A floor that does not fit the plan exactly is
 * refused and the planner samples it itself, so the plan is the same either way.
 */
export function primeTownFloor(plan: SettlementPlan, floor: Float32Array | null | undefined): boolean {
  if (!floor || plan.version !== 2 || plan.landform.version !== 1) return false;
  try { primeFoundedTerrain(plan, floor); return true; } catch { return false; }
}

/**
 * The founded floor on its half-metre lattice. `level` gives the one height under a whole footprint (every half-cell it
 * overlaps), or undefined if it crosses a step; `lowest` gives the lowest height under it when the relief stays within
 * `relief`.
 */
function floorSampler(plan: SettlementPlan, grid: Grid) {
  let at: (i: number, j: number) => number;
  if (plan.version === 2 && plan.landform.version === 1) {
    const terrain = sampleFoundedTerrain(plan), ox = Math.round(terrain.origin[0] * 2), oz = Math.round(terrain.origin[2] * 2);
    const heights = terrain.heights;
    at = (i, j) => {
      const c = i - ox, r = j - oz;
      const h = c >= 0 && r >= 0 && c < terrain.columns && r < terrain.rows ? heights[c + r * terrain.columns] : undefined;
      return h ?? foundedGroundAt(plan, (i + 0.5) * 0.5, (j + 0.5) * 0.5)[1];
    };
  } else {
    const memo = new Map<number, number>(), columns = grid.width * 2 + 2;
    at = (i, j) => {
      const key = (i - grid.x0 * 2 + 1) + (j - grid.z0 * 2 + 1) * columns;
      let h = memo.get(key);
      if (h === undefined) { h = foundedGroundAt(plan, (i + 0.5) * 0.5, (j + 0.5) * 0.5)[1]; memo.set(key, h); }
      return h;
    };
  }
  const span = (footprint: Quad) => {
    let low = Infinity, high = -Infinity;
    overlapCells(footprint, 0.5, (i, j) => { const h = at(i, j); if (h < low) low = h; if (h > high) high = h; });
    return [low, high] as const;
  };
  return {
    at,
    level(footprint: Quad): number | undefined { const [low, high] = span(footprint); return high - low < 1e-6 ? low : undefined; },
    lowest(footprint: Quad, relief: number): number | undefined { const [low, high] = span(footprint); return high - low <= relief + 1e-6 ? low : undefined; },
  };
}
