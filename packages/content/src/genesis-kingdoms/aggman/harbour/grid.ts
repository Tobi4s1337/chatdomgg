import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../../../materials';
import type { AggmanPiece } from '../piece';

type Box = VoxelBlueprint['boxes'][number];
export type P3 = readonly [number, number, number];

/**
 * A dense cell grid for the harbour's curved work (hulls, sails, nets, coils). Pieces are drawn cell by cell,
 * where a shape is easiest to say, and then packed into the fewest ordered half-open boxes a greedy sweep finds.
 * Every write is bounds-checked, so a part that would leave its piece fails loudly instead of being clipped.
 */
export class Grid {
  readonly cells: Uint8Array;
  constructor(readonly sx: number, readonly sy: number, readonly sz: number) {
    this.cells = new Uint8Array(sx * sy * sz);
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  get(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.cells[x + this.sx * (y + this.sy * z)]! : MAT.air;
  }

  set(x: number, y: number, z: number, material: number): void {
    if (!this.inside(x, y, z)) throw new Error(`harbour grid: cell ${x},${y},${z} leaves ${this.sx}×${this.sy}×${this.sz}.`);
    this.cells[x + this.sx * (y + this.sy * z)] = material;
  }

  /** Half-open box; later writes win, material zero carves. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number): void {
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, z, material);
  }

  /** Loose gear: every cell must still be air, so nothing is ever buried in a plank or another piece of gear. */
  free(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number, what = 'gear'): void {
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (this.get(x, y, z) !== MAT.air) throw new Error(`harbour grid: ${what} meets material ${this.get(x, y, z)} at ${x},${y},${z}.`);
    }
    this.box(x0, y0, z0, x1, y1, z1, material);
  }

  /** Writes only where the grid is still air; returns how many cells it filled. */
  fill(x: number, y: number, z: number, material: number): boolean {
    if (!this.inside(x, y, z) || this.get(x, y, z) !== MAT.air) return false;
    this.set(x, y, z, material);
    return true;
  }

  /**
   * Every cell whose centre lies within `half` of the segment a→b (cell-space points). With `half` ≥ √3/2 the
   * stroke is face-connected at any slope, so a rope or a brace is one piece, never a dotted line. A segment
   * running through cell centres in a plane stays one cell thick across that plane.
   */
  stroke(a: P3, b: P3, material: number, half = 0.9, onlyAir = false): void {
    for (const [x, y, z] of strokeCells(a, b, half)) {
      if (onlyAir) this.fill(x, y, z, material);
      else this.set(x, y, z, material);
    }
  }

  /** The bounding rectangle of the cells standing on y = 0, as an AggmanPiece footprint. */
  groundFootprint(): AggmanPiece['footprint'] {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let z = 0; z < this.sz; z++) for (let x = 0; x < this.sx; x++) if (this.get(x, 0, z)) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); z0 = Math.min(z0, z); z1 = Math.max(z1, z + 1);
    }
    if (!Number.isFinite(x0)) throw new Error('harbour grid: nothing stands on y = 0.');
    return { from: [x0, z0], to: [x1, z1] };
  }

  /** The bounding rectangle of every occupied cell in plan (the water a floating hull takes). */
  planFootprint(): AggmanPiece['footprint'] {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let z = 0; z < this.sz; z++) for (let y = 0; y < this.sy; y++) for (let x = 0; x < this.sx; x++) if (this.get(x, y, z)) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); z0 = Math.min(z0, z); z1 = Math.max(z1, z + 1);
    }
    return { from: [x0, z0], to: [x1, z1] };
  }

  /**
   * Packs the grid into non-overlapping boxes: each unclaimed cell grows a run along the first axis, the run
   * grows into a rectangle along the second and the rectangle into a block along the third. All six axis orders
   * are tried and the shortest list kept; the result is deterministic for a given grid.
   */
  toBoxes(): Box[] {
    let best: Box[] | undefined;
    for (const order of ORDERS) {
      const boxes = this.sweep(order);
      if (!best || boxes.length < best.length) best = boxes;
    }
    return best!;
  }

  private sweep(order: readonly [number, number, number]): Box[] {
    const [a, b, c] = order, size = [this.sx, this.sy, this.sz];
    const na = size[a]!, nb = size[b]!, nc = size[c]!;
    const xyz = (u: number, v: number, w: number): [number, number, number] => {
      const p = [0, 0, 0];
      p[a] = u; p[b] = v; p[c] = w;
      return [p[0]!, p[1]!, p[2]!];
    };
    const index = (u: number, v: number, w: number) => { const [x, y, z] = xyz(u, v, w); return x + this.sx * (y + this.sy * z); };
    const taken = new Uint8Array(this.cells.length), out: Box[] = [];
    for (let w = 0; w < nc; w++) for (let v = 0; v < nb; v++) for (let u = 0; u < na; u++) {
      const start = index(u, v, w), m = this.cells[start]!;
      if (!m || taken[start]) continue;
      const fits = (i: number) => this.cells[i] === m && !taken[i];
      let u1 = u + 1;
      while (u1 < na && fits(index(u1, v, w))) u1++;
      let v1 = v + 1;
      grow: for (; v1 < nb; v1++) for (let uu = u; uu < u1; uu++) if (!fits(index(uu, v1, w))) break grow;
      let w1 = w + 1;
      grow: for (; w1 < nc; w1++) for (let vv = v; vv < v1; vv++) for (let uu = u; uu < u1; uu++) if (!fits(index(uu, vv, w1))) break grow;
      for (let ww = w; ww < w1; ww++) for (let vv = v; vv < v1; vv++) for (let uu = u; uu < u1; uu++) taken[index(uu, vv, ww)] = 1;
      out.push({ from: xyz(u, v, w), to: xyz(u1, v1, w1), material: m });
    }
    return out;
  }

  /** The grid as a Tide prop blueprint. */
  blueprint(id: string): VoxelBlueprint {
    return { version: 1, id, styleId: STYLES.tide.id, kind: 'prop', lattice: 'build', size: [this.sx, this.sy, this.sz], boxes: this.toBoxes(), windows: [] };
  }
}

const ORDERS: readonly (readonly [number, number, number])[] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/** Cells within `half` of the segment a→b, by cell centre. */
export function strokeCells(a: P3, b: P3, half = 0.9): [number, number, number][] {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len2 = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2, out: [number, number, number][] = [];
  const lo = (i: number) => Math.floor(Math.min(a[i]!, b[i]!) - half), hi = (i: number) => Math.ceil(Math.max(a[i]!, b[i]!) + half);
  for (let z = lo(2); z <= hi(2); z++) for (let y = lo(1); y <= hi(1); y++) for (let x = lo(0); x <= hi(0); x++) {
    const w = [x + 0.5 - a[0], y + 0.5 - a[1], z + 0.5 - a[2]];
    const t = len2 ? Math.max(0, Math.min(1, (w[0]! * d[0]! + w[1]! * d[1]! + w[2]! * d[2]!) / len2)) : 0;
    if (Math.hypot(w[0]! - t * d[0]!, w[1]! - t * d[1]!, w[2]! - t * d[2]!) <= half) out.push([x, y, z]);
  }
  return out;
}

/** Cells (u, v) of a ring about (cu, cv) between two radii, measured to cell centres. */
export function ring(cu: number, cv: number, inner: number, outer: number): [number, number][] {
  const out: [number, number][] = [];
  for (let v = Math.floor(cv - outer - 1); v <= Math.ceil(cv + outer + 1); v++) for (let u = Math.floor(cu - outer - 1); u <= Math.ceil(cu + outer + 1); u++) {
    const r = Math.hypot(u + 0.5 - cu, v + 0.5 - cv);
    if (r >= inner && r <= outer) out.push([u, v]);
  }
  return out;
}

/** A deterministic 0..1 value for a tuple of integers. */
export function noise(...values: readonly number[]): number {
  let h = 0x51ed27f3;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca77);
    h ^= h >>> 13;
  }
  return (h >>> 0) / 4294967296;
}

export const round = (v: number): number => Math.floor(v + 0.5);
