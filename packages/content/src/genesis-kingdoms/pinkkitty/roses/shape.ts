import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../../../materials';

/**
 * The rose pieces' shared shaping kit. Each piece is carved into a small cell grid first and only then written out
 * as boxes, so overlapping masses, bloom heads and carved recesses never stack up duplicate source boxes, and the
 * greedy merge keeps even the leafy arch well inside its budget.
 */

export type Box = VoxelBlueprint['boxes'][number];
export type Size = readonly [number, number, number];
export type Cell = readonly [number, number, number];

/** Every colour a rose head may take. Tests use the same list to prove each head sits on its plant. */
export const BLOOMS: readonly number[] = [MAT.petal, MAT.fabricRed, MAT.fabricViolet, MAT.fabricMutedViolet];
/** Living plant tissue a bloom may sit in. */
export const FOLIAGE: readonly number[] = [MAT.leaf, MAT.moss];

/** A deterministic value in [0, 1) from a seed and integer keys: the only variation any rose piece has. */
export function hash(seed: number, ...keys: readonly number[]): number {
  let h = Math.imul(seed ^ 0x2545f491, 0x9e3779b1) >>> 0;
  for (const key of keys) {
    h = Math.imul(h ^ (key | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

const FACES: readonly Cell[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** A dense build-cell grid. Writes outside the bounds are dropped; reads outside return air. */
export class Grid {
  readonly cells: Uint8Array;
  constructor(readonly size: Size) {
    this.cells = new Uint8Array(size[0] * size[1] * size[2]);
  }
  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.size[0] && y < this.size[1] && z < this.size[2];
  }
  get(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.cells[x + this.size[0] * (z + this.size[2] * y)]! : MAT.air;
  }
  set(x: number, y: number, z: number, material: number): void {
    if (this.inside(x, y, z)) this.cells[x + this.size[0] * (z + this.size[2] * y)] = material;
  }
  /** Fills the half-open box; `onlyAir` keeps whatever is already there. */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number, onlyAir = false): void {
    for (let y = Math.max(0, y0); y < Math.min(this.size[1], y1); y++)
      for (let z = Math.max(0, z0); z < Math.min(this.size[2], z1); z++)
        for (let x = Math.max(0, x0); x < Math.min(this.size[0], x1); x++)
          if (!onlyAir || this.get(x, y, z) === MAT.air) this.set(x, y, z, material);
  }
  /** A footprint with its four vertical edges chamfered by one cell, the soft square every stone course uses. */
  softSquare(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, material: number): void {
    this.fill(x0, y0, z0 + 1, x1, y1, z1 - 1, material);
    this.fill(x0 + 1, y0, z0, x1 - 1, y1, z0 + 1, material);
    this.fill(x0 + 1, y0, z1 - 1, x1 - 1, y1, z1, material);
  }
  /** Number of face neighbours that are air (or outside the grid). */
  open(x: number, y: number, z: number): number {
    let n = 0;
    for (const [dx, dy, dz] of FACES) if (this.get(x + dx, y + dy, z + dz) === MAT.air) n++;
    return n;
  }
  /** Greedy merge into non-overlapping boxes: runs along X, widened along Z, then stacked along Y. */
  boxes(): Box[] {
    const [sx, sy, sz] = this.size, done = new Uint8Array(this.cells.length), out: Box[] = [];
    const at = (x: number, y: number, z: number) => x + sx * (z + sz * y);
    const free = (x: number, y: number, z: number, m: number) => !done[at(x, y, z)] && this.cells[at(x, y, z)] === m;
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const m = this.cells[at(x, y, z)]!;
      if (m === MAT.air || done[at(x, y, z)]) continue;
      let x1 = x + 1;
      while (x1 < sx && free(x1, y, z, m)) x1++;
      let z1 = z + 1;
      const row = (zz: number, yy: number) => { for (let i = x; i < x1; i++) if (!free(i, yy, zz, m)) return false; return true; };
      while (z1 < sz && row(z1, y)) z1++;
      let y1 = y + 1;
      const slab = (yy: number) => { for (let k = z; k < z1; k++) if (!row(k, yy)) return false; return true; };
      while (y1 < sy && slab(y1)) y1++;
      for (let yy = y; yy < y1; yy++) for (let k = z; k < z1; k++) for (let i = x; i < x1; i++) done[at(i, yy, k)] = 1;
      out.push({ from: [x, y, z], to: [x1, y1, z1], material: m });
    }
    return out;
  }
}

/** Where a mass may grow; returns false for cells a piece keeps clear (an arch opening, a planter's ends). */
export type Allow = (x: number, y: number, z: number) => boolean;
const everywhere: Allow = () => true;

/**
 * A rounded mass: a superellipsoid filled into air cells only, so it wraps whatever structure it meets rather than
 * swallowing it. `power` 2 is an ellipsoid; a little more squares the shoulders like a clipped hedge.
 */
export function blob(grid: Grid, [cx, cy, cz]: Cell, [rx, ry, rz]: Cell, material: number, { power = 2.2, allow = everywhere }: { power?: number; allow?: Allow } = {}): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const d = Math.abs((x + 0.5 - cx) / rx) ** power + Math.abs((y + 0.5 - cy) / ry) ** power + Math.abs((z + 0.5 - cz) / rz) ** power;
        if (d <= 1 && grid.inside(x, y, z) && grid.get(x, y, z) === MAT.air && allow(x, y, z)) grid.set(x, y, z, material);
      }
}

/**
 * A cane through a list of cells, one cell thick. Where two consecutive cells differ on more than one axis, the
 * corner between them is filled too, so the cane is always joined through faces, never through an edge alone.
 */
export function cane(grid: Grid, path: readonly Cell[], material: number): void {
  let last: Cell | undefined;
  for (const cell of path) {
    if (last) {
      const step: number[] = [...last];
      for (let axis = 0; axis < 3; axis++) {
        while (step[axis] !== cell[axis]) {
          step[axis] = step[axis]! + Math.sign(cell[axis]! - step[axis]!);
          grid.set(step[0]!, step[1]!, step[2]!, material);
        }
      }
    }
    grid.set(cell[0], cell[1], cell[2], material);
    last = cell;
  }
}

export interface BloomOptions {
  readonly seed: number;
  /** Most heads to set; fewer appear when the plant has no more room at the spacing. */
  readonly count: number;
  /** Least distance between two heads, in cells. */
  readonly spacing: number;
  /** The head's colour from a value in [0, 1). */
  readonly colour: (u: number, x: number, y: number, z: number) => number;
  /** The lowest course a head may sit on. */
  readonly minY?: number;
  /** Cells a head may occupy (its proud cell included). */
  readonly allow?: Allow;
  /** Share of heads that stand one cell proud of the foliage; the rest sit flush or pair sideways. */
  readonly proud?: number;
  /** Favour heads high on the plant: 0 places evenly, 1 strongly prefers the crown and sunny shoulders. */
  readonly lift?: number;
}

/**
 * Rose heads on the foliage surface. A head is a surface leaf turned to blossom (so it sits in the plant and never
 * floats), sometimes with one more cell standing proud of a side or a second blossom beside it on the same surface;
 * or, on top, one blossom raised on the leaf. Sites are chosen by the seeded hash, kept apart by the spacing and lifted toward the light.
 */
export function bloom(grid: Grid, options: BloomOptions): number {
  const { seed, count, spacing, colour, minY = 0, allow = everywhere, proud = 0.4, lift = 0.6 } = options;
  const [sx, sy, sz] = grid.size, sites: { x: number; y: number; z: number; out: Cell; rank: number }[] = [];
  const outward: readonly Cell[] = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  for (let y = minY; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    if (!FOLIAGE.includes(grid.get(x, y, z)) || !allow(x, y, z)) continue;
    const open = outward.filter(([dx, dy, dz]) => grid.inside(x + dx, y + dy, z + dz) && grid.get(x + dx, y + dy, z + dz) === MAT.air);
    if (!open.length) continue;
    // A head faces up where it can, otherwise out to one open side, chosen by hash rather than scan order.
    const out = open[0]![1] === 1 ? open[0]! : open[Math.floor(hash(seed, x, y, z, 7) * open.length)]!;
    sites.push({ x, y, z, out, rank: hash(seed, x, y, z) - lift * (y / sy) });
  }
  sites.sort((a, b) => a.rank - b.rank);
  const placed: Cell[] = [];
  for (const site of sites) {
    if (placed.length >= count) break;
    if (placed.some(([px, py, pz]) => (px - site.x) ** 2 + (py - site.y) ** 2 + (pz - site.z) ** 2 < spacing * spacing)) continue;
    const u = hash(seed, site.x, site.y, site.z, 3), m = colour(hash(seed, site.x, site.y, site.z, 5), site.x, site.y, site.z);
    const [ox, oy, oz] = site.out, px = site.x + ox, py = site.y + oy, pz = site.z + oz;
    // A proud head on top sits on the leaf as one raised cell; turning the leaf beneath it too would stand a
    // two-cell column on the plant, which reads as a candle rather than a rose. A proud head on a side stands out
    // from a blossom set in the leaf, two cells deep.
    if (u < proud && allow(px, py, pz)) {
      if (oy !== 1) grid.set(site.x, site.y, site.z, m);
      grid.set(px, py, pz, m);
      placed.push([site.x, site.y, site.z]);
      continue;
    }
    grid.set(site.x, site.y, site.z, m);
    if (u > (1 + proud) / 2) {
      // A pair: a neighbouring foliage cell across the head that is open on the same face, so both read together.
      const across: readonly Cell[] = oy === 1 ? [[1, 0, 0], [0, 0, 1]] : [[0, 1, 0], ox !== 0 ? [0, 0, 1] : [1, 0, 0]];
      const tries = across.flatMap(([ax, ay, az]) => [[ax, ay, az], [-ax, -ay, -az]] as Cell[]);
      const first = Math.floor(hash(seed, site.x, site.y, site.z, 11) * tries.length);
      for (let i = 0; i < tries.length; i++) {
        const [ax, ay, az] = tries[(first + i) % tries.length]!, qx = site.x + ax, qy = site.y + ay, qz = site.z + az;
        if (FOLIAGE.includes(grid.get(qx, qy, qz)) && grid.get(qx + ox, qy + oy, qz + oz) === MAT.air && allow(qx, qy, qz)) { grid.set(qx, qy, qz, m); break; }
      }
    }
    placed.push([site.x, site.y, site.z]);
  }
  return placed.length;
}

/** A finished Hearth-kit rose piece. */
export function blueprint(id: string, kind: VoxelBlueprint['kind'], grid: Grid): VoxelBlueprint {
  return { version: 1, id, styleId: STYLES.hearth.id, kind, lattice: 'build', size: [...grid.size], boxes: grid.boxes(), windows: [] };
}
