import type { AvatarAttachmentId, AvatarPartBlueprint, Vec3 } from '@chatdom/shared';
import { restPosition } from './rig';

/** Authoring range in root-local avatar cells; parts are re-based to their own bounds on export. */
const SPAN = 128;
const OFFSET = 64;
const key = (x: number, y: number, z: number): number => (x + OFFSET) + SPAN * ((y + OFFSET) + SPAN * (z + OFFSET));

export type PartLayer = AvatarPartBlueprint['layer'];

/**
 * A sparse voxel workpiece in root-local rest cells (+Y up, +Z forward, left is -X).
 * Authoring happens in the assembled rest pose; `toPart` re-bases cells to the attachment pivot.
 */
export class Sculpt {
  private readonly cells = new Map<number, number>();

  set(x: number, y: number, z: number, material: number): this {
    if (![x, y, z].every(n => Number.isInteger(n) && n >= -OFFSET && n < SPAN - OFFSET)) throw new Error(`Sculpt cell ${x},${y},${z} is outside the authoring range.`);
    if (material === 0) this.cells.delete(key(x, y, z)); else this.cells.set(key(x, y, z), material);
    return this;
  }

  get(x: number, y: number, z: number): number { return this.cells.get(key(x, y, z)) ?? 0; }

  /** Half-open box. Material zero carves. */
  box(from: Vec3, to: Vec3, material: number): this {
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) for (let x = from[0]; x < to[0]; x++) this.set(x, y, z, material);
    return this;
  }

  /**
   * Half-open box whose edges are softened by an `r`-cell staircase. A cell is cut when its summed
   * depth into the softened faces' bevel bands exceeds `r`, so r=1 removes edges and corners and r=2
   * gives a chunky hand-cut curve rather than a sphere. `soft` chooses faces: [-x,+x,-y,+y,-z,+z].
   */
  rounded(from: Vec3, to: Vec3, material: number, r = 1, soft: readonly [boolean, boolean, boolean, boolean, boolean, boolean] = [true, true, true, true, true, true]): this {
    const band = (v: number, lo: number, hi: number, softLo: boolean, softHi: boolean): number =>
      Math.max(softLo ? r - (v - lo) : 0, softHi ? r - (hi - 1 - v) : 0, 0);
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) for (let x = from[0]; x < to[0]; x++) {
      const cut = band(x, from[0], to[0], soft[0], soft[1]) + band(y, from[1], to[1], soft[2], soft[3]) + band(z, from[2], to[2], soft[4], soft[5]);
      if (cut <= r) this.set(x, y, z, material);
    }
    return this;
  }

  /** Cells whose centres fall within an axis-aligned ellipsoid. */
  ellipsoid(centre: Vec3, radii: Vec3, material: number): this {
    const lo = centre.map((c, i) => Math.floor(c - radii[i]!)), hi = centre.map((c, i) => Math.ceil(c + radii[i]!));
    for (let z = lo[2]!; z <= hi[2]!; z++) for (let y = lo[1]!; y <= hi[1]!; y++) for (let x = lo[0]!; x <= hi[0]!; x++) {
      const d = ((x + .5 - centre[0]) / radii[0]) ** 2 + ((y + .5 - centre[1]) / radii[1]) ** 2 + ((z + .5 - centre[2]) / radii[2]) ** 2;
      if (d <= 1) this.set(x, y, z, material);
    }
    return this;
  }

  /** Repaint occupied cells inside a box, never adding volume. */
  paint(from: Vec3, to: Vec3, material: number, where: (x: number, y: number, z: number, current: number) => boolean = () => true): this {
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) for (let x = from[0]; x < to[0]; x++) {
      const current = this.get(x, y, z);
      if (current !== 0 && where(x, y, z, current)) this.set(x, y, z, material);
    }
    return this;
  }

  /** Mirror every cell on the left (-X) to the right, so paired features stay exactly symmetric. */
  mirrorX(): this {
    for (const [k, material] of [...this.cells]) {
      const x = (k % SPAN) - OFFSET, y = (Math.floor(k / SPAN) % SPAN) - OFFSET, z = Math.floor(k / (SPAN * SPAN)) - OFFSET;
      if (x < 0) this.set(-1 - x, y, z, material);
    }
    return this;
  }

  get size(): number { return this.cells.size; }

  /** Visit occupied cells in a stable order. */
  forEachCell(visit: (x: number, y: number, z: number, material: number) => void): void {
    for (const k of [...this.cells.keys()].sort((a, b) => a - b)) visit((k % SPAN) - OFFSET, (Math.floor(k / SPAN) % SPAN) - OFFSET, Math.floor(k / (SPAN * SPAN)) - OFFSET, this.cells.get(k)!);
  }

  /** Remove every cell another workpiece occupies, so layered parts meet face to face, never coplanar. */
  subtract(other: Sculpt): this {
    other.forEachCell((x, y, z) => { this.set(x, y, z, 0); });
    return this;
  }

  /**
   * Cells outside this workpiece within `distance` face-steps of it (a Manhattan offset surface).
   * Layered parts built from it follow the shape beneath exactly and meet it face to face.
   */
  shell(distance: number, material: number): Sculpt {
    const out = new Sculpt();
    let frontier: [number, number, number][] = [];
    this.forEachCell((x, y, z) => { frontier.push([x, y, z]); });
    const seen = new Set<string>(frontier.map(p => p.join(',')));
    for (let step = 0; step < distance; step++) {
      const next: [number, number, number][] = [];
      for (const [x, y, z] of frontier) for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const p: [number, number, number] = [x + dx, y + dy, z + dz], k = p.join(',');
        if (seen.has(k)) continue;
        seen.add(k); next.push(p); out.set(p[0], p[1], p[2], material);
      }
      frontier = next;
    }
    return out;
  }

  /** Copy another workpiece's cells into this one, optionally only where a test passes. */
  merge(other: Sculpt, where: (x: number, y: number, z: number) => boolean = () => true): this {
    other.forEachCell((x, y, z, m) => { if (where(x, y, z)) this.set(x, y, z, m); });
    return this;
  }

  /** Remove cells matching a test. */
  carveWhere(test: (x: number, y: number, z: number, material: number) => boolean): this {
    this.forEachCell((x, y, z, m) => { if (test(x, y, z, m)) this.set(x, y, z, 0); });
    return this;
  }


  bounds(): { min: Vec3; max: Vec3 } {
    if (!this.cells.size) throw new Error('An avatar part needs occupied cells.');
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const k of this.cells.keys()) {
      const p = [(k % SPAN) - OFFSET, (Math.floor(k / SPAN) % SPAN) - OFFSET, Math.floor(k / (SPAN * SPAN)) - OFFSET];
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, p[i]!); max[i] = Math.max(max[i]!, p[i]! + 1); }
    }
    return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
  }

  /**
   * Greedy, deterministic box cover (x runs, then y rows, then z slabs). The returned part's pivot is
   * the attachment's rest position in part-local cells, so `(cell - pivot)` is attachment-local.
   */
  toPart(id: string, attachment: AvatarAttachmentId, layer: PartLayer): AvatarPartBlueprint {
    const { min, max } = this.bounds();
    const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const grid = new Uint16Array(size[0] * size[1] * size[2]);
    const at = (x: number, y: number, z: number): number => x + size[0] * (y + size[1] * z);
    for (const [k, material] of this.cells) {
      const x = (k % SPAN) - OFFSET - min[0], y = (Math.floor(k / SPAN) % SPAN) - OFFSET - min[1], z = Math.floor(k / (SPAN * SPAN)) - OFFSET - min[2];
      grid[at(x, y, z)] = material;
    }
    const done = new Uint8Array(grid.length);
    const boxes: { from: [number, number, number]; to: [number, number, number]; material: number }[] = [];
    for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
      const material = grid[at(x, y, z)]!;
      if (!material || done[at(x, y, z)]) continue;
      const free = (a: number, b: number, c: number): boolean => grid[at(a, b, c)] === material && !done[at(a, b, c)];
      let x1 = x + 1;
      while (x1 < size[0] && free(x1, y, z)) x1++;
      let y1 = y + 1;
      while (y1 < size[1] && rangeFree(x, x1, i => free(i, y1, z))) y1++;
      let z1 = z + 1;
      while (z1 < size[2] && planeFree(x, x1, y, y1, (i, j) => free(i, j, z1))) z1++;
      for (let c = z; c < z1; c++) for (let b = y; b < y1; b++) for (let a = x; a < x1; a++) done[at(a, b, c)] = 1;
      boxes.push({ from: [x, y, z], to: [x1, y1, z1], material });
    }
    const rest = restPosition(attachment);
    return { version: 1, id, lattice: 'avatar', size, boxes, pivot: [rest[0] - min[0], rest[1] - min[1], rest[2] - min[2]], attachment, layer };
  }
}

function rangeFree(a: number, b: number, test: (i: number) => boolean): boolean {
  for (let i = a; i < b; i++) if (!test(i)) return false;
  return true;
}
function planeFree(a: number, b: number, c: number, d: number, test: (i: number, j: number) => boolean): boolean {
  for (let j = c; j < d; j++) for (let i = a; i < b; i++) if (!test(i, j)) return false;
  return true;
}
