import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../materials';

type Box = VoxelBlueprint['boxes'][number];
export type V3 = readonly [number, number, number];

/** A small seeded generator (mulberry32 over an FNV-1a hash of the name). Every tree grows from its own name. */
export function rng(name: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const between = (r: () => number, a: number, b: number) => a + (b - a) * r();

/**
 * The working volume a tree is grown in, in build cells. The trunk stands on the centre column (`cx`, `cz`), y=0 is
 * the ground. Wood is drawn cell by cell; foliage in 2×2×2 blocks on even cells, so a crown keeps its exact shape at
 * render LOD 2 and reads as chunky clumps rather than speckle.
 */
export class Sculpt {
  readonly cells: Uint8Array;
  readonly cx: number; readonly cz: number;
  constructor(readonly w: number, readonly h: number, readonly d: number) {
    if (w % 4 || d % 4 || h % 2) throw new Error('Sculpt volumes are whole 4-cell columns and 2-cell courses.');
    this.cells = new Uint8Array(w * h * d);
    this.cx = w / 2; this.cz = d / 2;
  }
  index(x: number, y: number, z: number): number { return x + this.w * (y + this.h * z); }
  inside(x: number, y: number, z: number): boolean { return x >= 0 && y >= 0 && z >= 0 && x < this.w && y < this.h && z < this.d; }
  get(x: number, y: number, z: number): number { return this.inside(x, y, z) ? this.cells[this.index(x, y, z)]! : 0; }
  set(x: number, y: number, z: number, m: number): void { if (this.inside(x, y, z)) this.cells[this.index(x, y, z)] = m; }
  /** Writes only where the volume is still open. */
  fill(x: number, y: number, z: number, m: number): void { if (this.inside(x, y, z) && !this.cells[this.index(x, y, z)]) this.cells[this.index(x, y, z)] = m; }
  block(bx: number, by: number, bz: number): number { return this.get(bx, by, bz); }
  setBlock(bx: number, by: number, bz: number, m: number, overwrite = false): void {
    for (let z = bz; z < bz + 2; z++) for (let y = by; y < by + 2; y++) for (let x = bx; x < bx + 2; x++) overwrite ? this.set(x, y, z, m) : this.fill(x, y, z, m);
  }

  /**
   * A tapered limb from `a` (radius `ra`) to `b` (radius `rb`), positions relative to the trunk column. Cells whose
   * centre lies within the swept radius become `m`. Wood overwrites foliage, so limbs read where they enter a crown.
   */
  limb(a: V3, b: V3, ra: number, rb: number, m: number): void {
    const ax = a[0] + this.cx, az = a[2] + this.cz, bx = b[0] + this.cx, bz = b[2] + this.cz;
    const r = Math.max(ra, rb) + 1;
    const x0 = Math.floor(Math.min(ax, bx) - r), x1 = Math.ceil(Math.max(ax, bx) + r);
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r)), y1 = Math.ceil(Math.max(a[1], b[1]) + r);
    const z0 = Math.floor(Math.min(az, bz) - r), z1 = Math.ceil(Math.max(az, bz) + r);
    const dx = bx - ax, dy = b[1] - a[1], dz = bz - az, length = dx * dx + dy * dy + dz * dz;
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - ax, py = y + 0.5 - a[1], pz = z + 0.5 - az;
      const t = length ? Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / length)) : 0;
      const qx = px - t * dx, qy = py - t * dy, qz = pz - t * dz, radius = ra + (rb - ra) * t;
      if (qx * qx + qy * qy + qz * qz <= radius * radius) this.set(x, y, z, m);
    }
  }

  /**
   * A foliage clump: a soft cloud pad with a flatter underside, its rim pushed in and out by a few broad lobes (never
   * per-cell noise). Fills 2-cell blocks only where still open, so it never buries a limb.
   */
  clump(c: V3, rx: number, ry: number, rz: number, m: number, r: () => number, under = 0.6): void {
    const lobes = Array.from({ length: 4 }, () => {
      const t = r() * Math.PI * 2, u = between(r, -0.5, 0.9);
      return [Math.cos(t) * Math.sqrt(1 - u * u), u, Math.sin(t) * Math.sqrt(1 - u * u), between(r, 0.1, 0.22)] as const;
    });
    const cx = c[0] + this.cx, cz = c[2] + this.cz;
    const bx0 = Math.floor((cx - rx * 1.3) / 2) * 2, bx1 = Math.ceil((cx + rx * 1.3) / 2) * 2;
    const by0 = Math.max(0, Math.floor((c[1] - ry * 1.3) / 2) * 2), by1 = Math.ceil((c[1] + ry * 1.3) / 2) * 2;
    const bz0 = Math.floor((cz - rz * 1.3) / 2) * 2, bz1 = Math.ceil((cz + rz * 1.3) / 2) * 2;
    for (let bz = bz0; bz <= bz1; bz += 2) for (let by = by0; by <= by1; by += 2) for (let bx = bx0; bx <= bx1; bx += 2) {
      const dx = (bx + 1 - cx) / rx, dy = (by + 1 - c[1]) / (by + 1 < c[1] ? ry * under : ry), dz = (bz + 1 - cz) / rz;
      const len = Math.hypot(dx, dy, dz) || 1;
      let reach = 1;
      for (const [lx, ly, lz, a] of lobes) reach += a * Math.max(0, (dx * lx + dy * ly + dz * lz) / len) ** 2 - a * 0.25;
      if (len <= reach) this.setBlock(bx, by, bz, m);
    }
  }

  /** Every occupied cell with no face path to the ground is removed: a crown can never float. */
  ground(): void {
    const { w, h, d, cells } = this, seen = new Uint8Array(cells.length), queue: number[] = [];
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) { const i = this.index(x, 0, z); if (cells[i]) { seen[i] = 1; queue.push(i); } }
    while (queue.length) {
      const i = queue.pop()!, x = i % w, y = Math.floor(i / w) % h, z = Math.floor(i / (w * h));
      for (const [nx, ny, nz] of [[x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]] as const) {
        if (!this.inside(nx, ny, nz)) continue;
        const n = this.index(nx, ny, nz);
        if (cells[n] && !seen[n]) { seen[n] = 1; queue.push(n); }
      }
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] && !seen[i]) cells[i] = 0;
  }

  /** Occupied bounds as distances from the trunk column, so the crop can keep the trunk on its centre. */
  extent(): { half: number; top: number } {
    let half = 0, top = 0;
    for (let z = 0; z < this.d; z++) for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (!this.cells[this.index(x, y, z)]) continue;
      half = Math.max(half, Math.abs(x + 0.5 - this.cx) + 0.5, Math.abs(z + 0.5 - this.cz) + 0.5); top = Math.max(top, y + 1);
    }
    return { half, top };
  }

  /**
   * Crops to a square footprint centred on the trunk (half-width a multiple of 4, so 2-cell blocks stay on even
   * cells and LOD 4 blocks stay whole) and decomposes it into boxes. Greedy along X, then Z, then Y: each cell is
   * written exactly once and nothing is carved.
   */
  toBlueprint(): { size: [number, number, number]; boxes: Box[] } {
    this.ground();
    const { half, top } = this.extent();
    const r = Math.ceil(half / 4) * 4, ox = this.cx - r, oz = this.cz - r, size: [number, number, number] = [2 * r, Math.ceil(top / 2) * 2, 2 * r];
    if (ox < 0 || oz < 0) throw new Error('A tree outgrew its working volume.');
    const [sx, sy, sz] = size, done = new Uint8Array(sx * sy * sz), at = (x: number, y: number, z: number) => x + sx * (y + sy * z);
    const m = (x: number, y: number, z: number) => this.get(x + ox, y, z + oz);
    const free = (x: number, y: number, z: number, mat: number) => !done[at(x, y, z)] && m(x, y, z) === mat;
    const boxes: Box[] = [];
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const mat = m(x, y, z);
      if (!mat || done[at(x, y, z)]) continue;
      let x1 = x + 1; while (x1 < sx && free(x1, y, z, mat)) x1++;
      let z1 = z + 1; rows: while (z1 < sz) { for (let i = x; i < x1; i++) if (!free(i, y, z1, mat)) break rows; z1++; }
      let y1 = y + 1; layers: while (y1 < sy) { for (let k = z; k < z1; k++) for (let i = x; i < x1; i++) if (!free(i, y1, k, mat)) break layers; y1++; }
      for (let yy = y; yy < y1; yy++) for (let k = z; k < z1; k++) for (let i = x; i < x1; i++) done[at(i, yy, k)] = 1;
      boxes.push({ from: [x, y, z], to: [x1, y1, z1], material: mat });
    }
    return { size, boxes };
  }

  /** Foliage blocks open to the sky directly above: the lit tops of each clump. */
  litTop(bx: number, by: number, bz: number, foliage: ReadonlySet<number>): boolean {
    return foliage.has(this.block(bx, by, bz)) && !this.block(bx, by + 2, bz);
  }
}

export const FOLIAGE = new Set<number>([MAT.leaf, MAT.moss, MAT.grass, MAT.goldLeaf]);
