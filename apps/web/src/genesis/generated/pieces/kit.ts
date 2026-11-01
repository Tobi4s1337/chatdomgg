import { VoxelBlueprintSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, MATERIALS, STYLES } from '@chatdom/content/materials';
import type { GeneratedPiece, PieceColours, PieceOptions } from './types';

type Box = VoxelBlueprint['boxes'][number];
export type PieceStyle = PieceOptions['style'];

/**
 * The few materials a generated piece is built from, per style kit. Structure comes from the kit's own wall, roof,
 * trim and stone; `base` is the heavier footing stone, `rock` the second stone a hand-gathered pile mixes in, `wood`
 * the second timber for seams, braces and grain, `metal` the bright fittings and `iron` the dark ones.
 */
export interface PieceKit {
  readonly style: PieceStyle;
  readonly wall: number;
  readonly roof: number;
  readonly trim: number;
  readonly stone: number;
  readonly base: number;
  readonly rock: number;
  readonly wood: number;
  readonly metal: number;
  readonly iron: number;
  readonly cord: number;
}

export const PIECE_KITS: Readonly<Record<PieceStyle, PieceKit>> = {
  hearth: { style: 'hearth', ...STYLES.hearth, base: MAT.stone, rock: MAT.stone, wood: MAT.bark, metal: MAT.brass, iron: MAT.darkStone, cord: MAT.thatch },
  tide: { style: 'tide', ...STYLES.tide, base: MAT.darkStone, rock: MAT.limestone, wood: MAT.bark, metal: MAT.brass, iron: MAT.darkStone, cord: MAT.thatch },
  grove: { style: 'grove', ...STYLES.grove, base: MAT.stone, rock: MAT.stone, wood: MAT.timber, metal: MAT.brass, iron: MAT.darkStone, cord: MAT.thatch },
};

const REGISTERED = new Set(MATERIALS.materials.map(m => m.id));

/** Refuses an unknown style or a colour that is not a registered, solid material. Returns the style's kit. */
export function checkOptions(options: PieceOptions): PieceKit {
  if (!Object.hasOwn(PIECE_KITS, options.style)) throw new Error(`Unknown piece style ${String(options.style)}.`);
  for (const key of ['field', 'charge', 'border'] as const) {
    const id = options.colours[key];
    if (!Number.isInteger(id) || id === MAT.air || !REGISTERED.has(id)) throw new Error(`Colour ${key} must be a registered material, not ${String(id)}.`);
  }
  if (!Number.isInteger(options.seed)) throw new Error(`Seed must be an integer, not ${String(options.seed)}.`);
  return PIECE_KITS[options.style];
}

/** An integer hash of a lattice point into [0, 1): the hand's variation, never global randomness. */
export function hash(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ Math.imul(seed | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A small seeded stream (mulberry32) for a factory's choices, salted per piece so pieces of one seed differ. */
export function stream(seed: number, salt: number) {
  let s = (Math.imul(seed | 0, 0x9e3779b1) ^ salt) >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** An integer in [lo, hi], inclusive. */
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    range: (lo: number, hi: number) => lo + next() * (hi - lo),
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
  };
}
export type Stream = ReturnType<typeof stream>;

/** The variant part of a blueprint id: the seed and the three cloth colours, so a mesher cache never confuses two. */
export function variantTag(seed: number, colours: PieceColours): string {
  const h = Math.floor(hash(seed, colours.field, colours.charge, colours.border ^ 0x51a7) * 0xffffffff) >>> 0;
  return `${h.toString(16).padStart(8, '0')}-${colours.field}.${colours.charge}.${colours.border}`;
}

/**
 * A dense cell grid a piece is painted into, then emitted as greedy merged boxes. Painting order is the authoring
 * order (later paint wins, air carves); the boxes carry only the final solid cells, so their order never matters.
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
    return this.inside(x, y, z) ? this.cells[x + this.sx * (y + this.sy * z)]! : 0;
  }
  set(x: number, y: number, z: number, m: number): void {
    if (this.inside(x, y, z)) this.cells[x + this.sx * (y + this.sy * z)] = m;
  }
  /** Half-open box, clipped to the grid. */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number): void {
    for (let z = Math.max(0, z0); z < Math.min(this.sz, z1); z++) for (let y = Math.max(0, y0); y < Math.min(this.sy, y1); y++) {
      const row = this.sx * (y + this.sy * z);
      for (let x = Math.max(0, x0); x < Math.min(this.sx, x1); x++) this.cells[x + row] = m;
    }
  }
  /** Paints only cells that already hold something (a skin over existing work). */
  over(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number): void {
    for (let z = Math.max(0, z0); z < Math.min(this.sz, z1); z++) for (let y = Math.max(0, y0); y < Math.min(this.sy, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(this.sx, x1); x++) if (this.get(x, y, z)) this.set(x, y, z, m);
  }
  /** Paints only empty cells. */
  under(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number): void {
    for (let z = Math.max(0, z0); z < Math.min(this.sz, z1); z++) for (let y = Math.max(0, y0); y < Math.min(this.sy, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(this.sx, x1); x++) if (!this.get(x, y, z)) this.set(x, y, z, m);
  }
  /** A cell with at least one empty face neighbour. */
  exposed(x: number, y: number, z: number): boolean {
    return !this.get(x + 1, y, z) || !this.get(x - 1, y, z) || !this.get(x, y + 1, z) || !this.get(x, y, z + 1) || !this.get(x, y, z - 1)
      || (y > 0 && !this.get(x, y - 1, z));
  }
  /**
   * A face-connected line from a to b (every step shares a face with the last), painted with `m` unless the cell is
   * already solid. Returns the cells in order, for hanging pennants off a rope.
   */
  line(a: readonly [number, number, number], b: readonly [number, number, number], m: number, sag = 0): Vec3[] {
    const steps = Math.max(1, Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) + Math.abs(b[2] - a[2]) + Math.ceil(sag));
    const path: Vec3[] = [];
    let last: Vec3 | null = null;
    const push = (p: Vec3) => {
      if (last && p[0] === last[0] && p[1] === last[1] && p[2] === last[2]) return;
      if (last) {
        // Walk axis by axis so neighbours always share a face.
        const cur: [number, number, number] = [last[0], last[1], last[2]];
        for (const axis of [0, 2, 1] as const) while (cur[axis] !== p[axis]) {
          cur[axis] += Math.sign(p[axis] - cur[axis]);
          path.push([cur[0], cur[1], cur[2]]);
        }
      } else path.push(p);
      last = p;
    };
    for (let i = 0; i <= steps * 2; i++) {
      const t = i / (steps * 2);
      push([Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t)), Math.round(a[2] + (b[2] - a[2]) * t)]);
    }
    for (const [x, y, z] of path) if (!this.get(x, y, z)) this.set(x, y, z, m);
    return path;
  }
  /**
   * Clears cells of the given (soft) materials that have no face-connected path to the ground: the crumbs a ragged
   * crown or a rose leaves in the air. Structure is never pruned; an unsupported beam stays an authoring error.
   */
  prune(soft: ReadonlySet<number>): void {
    const { sx, sy, sz, cells } = this, seen = new Uint8Array(cells.length), queue: number[] = [];
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) { const i = x + sx * sy * z; if (cells[i]) { seen[i] = 1; queue.push(i); } }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!, x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
      for (const n of [x > 0 ? i - 1 : -1, x + 1 < sx ? i + 1 : -1, y > 0 ? i - sx : -1, y + 1 < sy ? i + sx : -1, z > 0 ? i - sx * sy : -1, z + 1 < sz ? i + sx * sy : -1]) {
        if (n >= 0 && cells[n] && !seen[n]) { seen[n] = 1; queue.push(n); }
      }
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] && !seen[i] && soft.has(cells[i]!)) cells[i] = 0;
  }
  /** Greedy merged boxes of every solid cell: runs along x, then rows along z, then slabs up y. */
  boxes(): Box[] {
    const { sx, sy, sz, cells } = this, done = new Uint8Array(cells.length), out: Box[] = [];
    const at = (x: number, y: number, z: number) => x + sx * (y + sy * z);
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const i = at(x, y, z), m = cells[i]!;
      if (!m || done[i]) continue;
      let x1 = x + 1;
      while (x1 < sx && cells[at(x1, y, z)] === m && !done[at(x1, y, z)]) x1++;
      let z1 = z + 1;
      grow: while (z1 < sz) {
        for (let xx = x; xx < x1; xx++) { const j = at(xx, y, z1); if (cells[j] !== m || done[j]) break grow; }
        z1++;
      }
      let y1 = y + 1;
      rise: while (y1 < sy) {
        for (let zz = z; zz < z1; zz++) for (let xx = x; xx < x1; xx++) { const j = at(xx, y1, zz); if (cells[j] !== m || done[j]) break rise; }
        y1++;
      }
      for (let yy = y; yy < y1; yy++) for (let zz = z; zz < z1; zz++) for (let xx = x; xx < x1; xx++) done[at(xx, yy, zz)] = 1;
      out.push({ from: [x, y, z], to: [x1, y1, z1], material: m });
    }
    return out;
  }
}

/** Closes a grid into a strict civic blueprint and the piece record: footprint is the occupied ground's extent. */
export function finish(grid: Grid, id: string, style: PieceStyle, lanterns: readonly Vec3[]): GeneratedPiece {
  let x0 = grid.sx, z0 = grid.sz, x1 = 0, z1 = 0;
  for (let z = 0; z < grid.sz; z++) for (let x = 0; x < grid.sx; x++) {
    let any = false;
    for (let y = 0; y < grid.sy && !any; y++) any = grid.get(x, y, z) !== 0;
    if (!any) continue;
    x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x + 1); z1 = Math.max(z1, z + 1);
  }
  const blueprint = VoxelBlueprintSchema.parse({
    version: 1, id, styleId: STYLES[style].id, kind: 'civic', lattice: 'build', size: [grid.sx, grid.sy, grid.sz], boxes: grid.boxes(), windows: [],
  });
  return { blueprint, lanterns: lanterns.map(l => [l[0], l[1], l[2]] as Vec3), footprint: { from: [x0, z0], to: [x1, z1] } };
}

/**
 * A lamp post on a stepped stone footing: a squared post with a chamfered collar, a cap, and a caged lantern sitting
 * on it with a bright foot, hood and finial. `(x, z)` is the post's west-north corner (the post is 2×2). Returns the
 * lantern's flame cell, at the heart of its glass.
 */
export function lanternPost(g: Grid, kit: PieceKit, x: number, z: number, height: number, ground = 0): Vec3 {
  const y = ground;
  g.fill(x - 2, y, z - 2, x + 4, y + 1, z + 4, kit.base);
  g.fill(x - 1, y + 1, z - 1, x + 3, y + 2, z + 3, kit.stone);
  g.fill(x, y + 2, z, x + 2, y + height, z + 2, kit.trim);
  g.fill(x - 1, y + 2, z, x + 3, y + 3, z + 2, kit.trim); g.fill(x, y + 2, z - 1, x + 2, y + 3, z + 3, kit.trim);
  // A collar band two thirds up and a flared cap the lantern stands on.
  g.fill(x, y + height - 6, z, x + 2, y + height - 5, z + 2, kit.metal);
  const top = y + height;
  g.fill(x - 1, top - 1, z - 1, x + 3, top, z + 3, kit.iron);
  g.fill(x - 1, top, z - 1, x + 3, top + 1, z + 3, kit.metal);
  // Glass 2×3×2 inside four iron corner rods, a hood stepping in and a brass finial.
  g.fill(x, top + 1, z, x + 2, top + 4, z + 2, MAT.glass);
  for (const [dx, dz] of [[-1, -1], [2, -1], [-1, 2], [2, 2]] as const) g.fill(x + dx, top + 1, z + dz, x + dx + 1, top + 4, z + dz + 1, kit.iron);
  g.fill(x - 1, top + 4, z - 1, x + 3, top + 5, z + 3, kit.iron);
  g.fill(x, top + 5, z, x + 2, top + 6, z + 2, kit.iron);
  g.set(x, top + 6, z, kit.metal);
  return [x, top + 2, z];
}

/**
 * A string of bunting from a to b with a gentle sag: a cord with small triangular pennants hung every few cells,
 * cycling through the given cloths.
 */
export function bunting(g: Grid, cord: number, a: readonly [number, number, number], b: readonly [number, number, number], sag: number, cloths: readonly number[], spacing = 5): void {
  const path = g.line(a, b, cord, sag);
  let k = 0;
  for (let i = 3; i + 2 < path.length - 3; i += spacing, k++) {
    const m = cloths[k % cloths.length]!;
    // Three cells along the cord, hanging one, two and one deep: a small dropped triangle.
    for (let j = 0; j < 3; j++) {
      const [x, y, z] = path[i + j]!, depth = j === 1 ? 3 : 2;
      for (let d = 1; d <= depth; d++) if (!g.get(x, y - d, z)) g.set(x, y - d, z, m);
    }
  }
}

/** Stamps an ellipsoid (centre, radii) of a material; `keep` decides each cell (for ragged edges). */
export function blob(g: Grid, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, m: number, keep: (x: number, y: number, z: number, d: number) => boolean = () => true): void {
  for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 + ((z + 0.5 - cz) / rz) ** 2;
      if (d <= 1 && keep(x, y, z, d)) g.set(x, y, z, m);
    }
}

export const metres = (cells: number) => cells * 0.125;

/** Foliage and blooms a factory may prune when a ragged edge leaves them hanging in the air. */
export const SOFT = new Set<number>([MAT.leaf, MAT.petal, MAT.blueFlower, MAT.cream, MAT.moss, MAT.goldLeaf]);
