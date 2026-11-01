/**
 * Grand land trees. Every tree is grown from its own u32 seed into sparse voxels relative to its base, so a
 * forest of thousands is thousands of different trees at no draw-call cost: the voxeliser stamps them into
 * the land and they mesh with the terrain.
 *
 * Two things decide how a tree costs in the mesher, and both are handled here:
 * - Canopy surfaces come from ellipsoid "puffs" perturbed by low-frequency noise (lumps 5–10 voxels across),
 *   so the outside forms broad patches rather than speckle.
 * - The four leaf shades are chosen by height inside each puff, height inside the crown and a slow noise
 *   offset, so shades form bands and blobs that the greedy mesher can merge. Accents are noise blobs too,
 *   never single-voxel salt.
 *
 * Canopies are filled solid: a hollow shell would give the mesher an inner surface to emit as well.
 */
import { M } from './palette';
import type { TreeShape, TreeSpecies } from './types';

const XZ_LIMIT = 60;
const Y_MIN = -4;
const Y_MAX = 120;
/** Trunks and roots run this far below the base so trees sit into slopes. */
const ROOT_DEPTH = -3;

const BARK_IDS = Object.values(M.bark) as readonly number[];
const BARK_LO = Math.min(...BARK_IDS);
const BARK_HI = Math.max(...BARK_IDS);
const isBark = (m: number) => m >= BARK_LO && m <= BARK_HI;

type Range = readonly [number, number];
const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Nominal size per species at scale 1: height and canopy radius in voxels (half-metres). `fit` maps the
 * nominal midpoint to what the generator really grows (median over seeds: lumps, lean and tips reach a
 * little past the envelope), so placement spacing can trust `treeExtent`.
 */
const SIZE: Record<TreeSpecies, { readonly height: Range; readonly radius: Range; readonly fit: readonly [number, number] }> = {
  oak: { height: [16, 24], radius: [7, 10], fit: [1.1, 1] },
  lime: { height: [17, 25], radius: [6, 8.5], fit: [1.07, 1.04] },
  'autumn-gold': { height: [15, 23], radius: [6.5, 9.5], fit: [1.08, 1.04] },
  'autumn-red': { height: [14, 21], radius: [6, 9], fit: [1.1, 1.03] },
  birch: { height: [16, 24], radius: [3.8, 5.6], fit: [1.3, 1.05] },
  pine: { height: [22, 34], radius: [3.6, 5.6], fit: [1.25, 1.03] },
  spruce: { height: [18, 30], radius: [3.6, 6], fit: [1.2, 1.12] },
  cherry: { height: [12, 17], radius: [7, 10], fit: [1.07, 1.03] },
  teal: { height: [18, 28], radius: [6, 9], fit: [1, 1.04] },
  willow: { height: [14, 19], radius: [7, 9.5], fit: [1.07, 1.03] },
  shrub: { height: [3, 6], radius: [2, 3.6], fit: [1.15, 0.9] },
  'hero-gold': { height: [54, 72], radius: [27, 36], fit: [1.07, 1.04] },
  'hero-teal': { height: [54, 72], radius: [26, 36], fit: [1.05, 1.03] },
  'hero-cherry': { height: [48, 60], radius: [29, 38], fit: [1.1, 1.02] },
};

/** Approximate canopy radius (voxels) and height for placement spacing, without generating. */
export function treeExtent(species: TreeSpecies, scale: number): { radius: number; height: number } {
  const s = SIZE[species];
  return { radius: ((s.radius[0] + s.radius[1]) / 2) * s.fit[0] * scale, height: ((s.height[0] + s.height[1]) / 2) * s.fit[1] * scale };
}

// ---------------------------------------------------------------------------------------------------------
// Randomness: everything comes from the tree's seed.

class Rng {
  private a: number;
  constructor(seed: number) { this.a = seed >>> 0; }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number | Range, hi?: number): number {
    if (typeof lo === 'number') return lo + ((hi ?? lo) - lo) * this.next();
    return lo[0] + (lo[1] - lo[0]) * this.next();
  }
  /** Inclusive integer range. */
  int(range: Range): number { return Math.floor(range[0] + (range[1] - range[0] + 1) * this.next()); }
  chance(p: number): boolean { return this.next() < p; }
  angle(): number { return this.next() * TAU; }
  signed(amount: number): number { return (this.next() * 2 - 1) * amount; }
}

function speciesSalt(species: TreeSpecies): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < species.length; i++) h = Math.imul(h ^ species.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function hash3(x: number, y: number, z: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x1b873593) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Lattice values for the noise: a fixed table, so a corner costs one mix and one load. */
const LATTICE = (() => {
  const t = new Float32Array(4096), r = new Rng(0x5eed7a3e);
  for (let i = 0; i < t.length; i++) t[i] = r.next() * 2 - 1;
  return t;
})();
const corner = (x: number, y: number, z: number, salt: number) => {
  const h = Math.imul(x ^ salt, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f);
  return LATTICE[(h ^ (h >>> 15)) & 4095]!;
};

/** Smooth value noise in [-1, 1] with unit lattice spacing. */
function noise3(x: number, y: number, z: number, salt: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const a = lerp(corner(ix, iy, iz, salt), corner(ix + 1, iy, iz, salt), u);
  const b = lerp(corner(ix, iy + 1, iz, salt), corner(ix + 1, iy + 1, iz, salt), u);
  const c = lerp(corner(ix, iy, iz + 1, salt), corner(ix + 1, iy, iz + 1, salt), u);
  const d = lerp(corner(ix, iy + 1, iz + 1, salt), corner(ix + 1, iy + 1, iz + 1, salt), u);
  return lerp(lerp(a, b, v), lerp(c, d, v), w);
}

// ---------------------------------------------------------------------------------------------------------
// The canvas: a dense scratch grid around the base, emitted as sparse cells. One cell, one material:
// bark always wins over leaf, and between leaves the cell deepest inside its puff decides the colour.

let scratchMat = new Uint8Array(0);
let scratchBest = new Float32Array(0);
let scratchTag = new Uint8Array(0);
let scratchOwner = new Uint16Array(0);
let scratchLump = new Float32Array(0);
let scratchCells = new Int32Array(0);

class Canvas {
  readonly x0: number; readonly y0: number; readonly z0: number;
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly mat: Uint8Array;
  readonly best: Float32Array;
  /** Sunlit band + 1 for leaves the sky-light pass may darken; 0 for everything else. */
  readonly tag: Uint8Array;
  /** Puff index + 1 while foliage is being filled. */
  readonly owner: Uint16Array;
  /** Lump noise per cell, computed once however many puffs overlap it (NaN until then). */
  readonly lump: Float32Array;
  /** Box of written cells, world coordinates; empty while x0 > x1. */
  wx0 = Infinity; wy0 = Infinity; wz0 = Infinity; wx1 = -Infinity; wy1 = -Infinity; wz1 = -Infinity;

  constructor(half: number, yTop: number) {
    const h = Math.min(XZ_LIMIT, Math.ceil(half));
    this.x0 = -h; this.z0 = -h; this.y0 = Y_MIN;
    this.nx = 2 * h + 1; this.nz = 2 * h + 1;
    this.ny = Math.min(Y_MAX, Math.ceil(yTop)) - Y_MIN + 1;
    const n = this.nx * this.ny * this.nz;
    if (scratchMat.length < n) { scratchMat = new Uint8Array(n); scratchBest = new Float32Array(n); scratchTag = new Uint8Array(n); scratchOwner = new Uint16Array(n); scratchLump = new Float32Array(n); }
    this.mat = scratchMat.subarray(0, n);
    this.best = scratchBest.subarray(0, n);
    this.tag = scratchTag.subarray(0, n);
    this.owner = scratchOwner.subarray(0, n);
    this.lump = scratchLump.subarray(0, n);
    this.mat.fill(0);
    this.best.fill(1);
    this.tag.fill(0);
    this.owner.fill(0);
    this.lump.fill(NaN);
  }

  index(x: number, y: number, z: number): number {
    const ix = x - this.x0, iy = y - this.y0, iz = z - this.z0;
    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz) return -1;
    return (iy * this.nz + iz) * this.nx + ix;
  }

  get(x: number, y: number, z: number): number {
    const i = this.index(x, y, z);
    return i < 0 ? 0 : this.mat[i]!;
  }

  /** Grows the written box (in world cells) so the later passes scan only what holds something. */
  touch(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    if (x0 < this.wx0) this.wx0 = x0; if (x1 > this.wx1) this.wx1 = x1;
    if (y0 < this.wy0) this.wy0 = y0; if (y1 > this.wy1) this.wy1 = y1;
    if (z0 < this.wz0) this.wz0 = z0; if (z1 > this.wz1) this.wz1 = z1;
  }

  bark(x: number, y: number, z: number, m: number): void {
    const i = this.index(x, y, z);
    if (i < 0) return;
    this.mat[i] = m; this.tag[i] = 0;
    this.touch(x, y, z, x, y, z);
  }

  /** Writes a leaf if the cell holds no bark and `f` (negative inside) is deeper than what is there. */
  leaf(x: number, y: number, z: number, m: number, f: number, tag = 0): void {
    if (y < 0) return;
    const i = this.index(x, y, z);
    if (i < 0 || f >= this.best[i]!) return;
    if (isBark(this.mat[i]!)) return;
    this.best[i] = f;
    this.mat[i] = m;
    this.tag[i] = tag;
    this.touch(x, y, z, x, y, z);
  }

  /**
   * Sky light: a tagged leaf with nothing above keeps its sunlit band; one under an overhang drops to the
   * shadow band, and one deep under it to the deep shade. Every lump gets a lit top and a dark belly, and
   * the creases between lumps go dark, all in coherent patches.
   */
  light(bands: Bands, reach = 5): void {
    if (this.wx0 > this.wx1) return;
    const { mat, tag } = this;
    const layer = this.nx * this.nz, n = mat.length;
    for (let y = this.wy0; y <= this.wy1; y++) {
      for (let z = this.wz0; z <= this.wz1; z++) {
        let i = this.index(this.wx0, y, z);
        for (let x = this.wx0; x <= this.wx1; x++, i++) {
          const t = tag[i]!;
          if (t === 0) continue;
          let cover = 0;
          for (let k = 1, j = i + layer; k <= reach && j < n; k++, j += layer) if (mat[j] !== 0) cover++;
          mat[i] = cover === 0 ? bands[t - 1]! : cover <= Math.min(3, reach - 1) ? bands[1] : bands[0];
        }
      }
    }
  }

  shape(): TreeShape {
    const { mat } = this;
    let count = 0;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    const cap = this.wx0 > this.wx1 ? 0 : (this.wx1 - this.wx0 + 1) * (this.wy1 - this.wy0 + 1) * (this.wz1 - this.wz0 + 1);
    if (scratchCells.length < cap) scratchCells = new Int32Array(cap);
    const cells = scratchCells;
    for (let y = this.wy0; y <= this.wy1; y++) {
      for (let z = this.wz0; z <= this.wz1; z++) {
        let i = this.index(this.wx0, y, z);
        for (let x = this.wx0; x <= this.wx1; x++, i++) {
          if (mat[i] === 0) continue;
          cells[count++] = i;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (z < z0) z0 = z; if (z > z1) z1 = z;
        }
      }
    }
    const dx = new Int16Array(count), dy = new Int16Array(count), dz = new Int16Array(count);
    const material = new Uint8Array(count);
    const nx = this.nx, layer = this.nx * this.nz;
    for (let k = 0; k < count; k++) {
      const i = cells[k]!;
      const iy = Math.floor(i / layer), rest = i - iy * layer, iz = Math.floor(rest / nx);
      dx[k] = rest - iz * nx + this.x0; dy[k] = iy + this.y0; dz[k] = iz + this.z0; material[k] = mat[i]!;
    }
    if (count === 0) { x0 = y0 = z0 = x1 = y1 = z1 = 0; }
    return { count, dx, dy, dz, material, min: [x0, y0, z0], max: [x1, y1, z1] };
  }
}

// ---------------------------------------------------------------------------------------------------------
// Wood: tapered capsules along polylines and curves.

interface P { x: number; y: number; z: number }
const pt = (x: number, y: number, z: number): P => ({ x, y, z });
/** Material for a bark cell; `ax`/`az` are the nearest point on the limb's axis. */
type BarkPaint = number | ((x: number, y: number, z: number, ax: number, az: number) => number);

function limb(c: Canvas, a: P, b: P, ra: number, rb: number, paint: BarkPaint): void {
  const rMax = Math.max(ra, rb, 0.6) + 0.5;
  const x0 = Math.floor(Math.min(a.x, b.x) - rMax), x1 = Math.ceil(Math.max(a.x, b.x) + rMax);
  const y0 = Math.floor(Math.min(a.y, b.y) - rMax), y1 = Math.ceil(Math.max(a.y, b.y) + rMax);
  const z0 = Math.floor(Math.min(a.z, b.z) - rMax), z1 = Math.ceil(Math.max(a.z, b.z) + rMax);
  const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z;
  const len2 = ex * ex + ey * ey + ez * ez;
  for (let y = Math.max(y0, Y_MIN); y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const px = x - a.x, py = y - a.y, pz = z - a.z;
        const t = len2 > 0 ? clamp((px * ex + py * ey + pz * ez) / len2, 0, 1) : 0;
        const qx = px - t * ex, qy = py - t * ey, qz = pz - t * ez;
        const r = Math.max(0.6, ra + (rb - ra) * t);
        if (qx * qx + qy * qy + qz * qz > r * r) continue;
        c.bark(x, y, z, typeof paint === 'number' ? paint : paint(x, y, z, a.x + t * ex, a.z + t * ez));
      }
    }
  }
}

function polyline(c: Canvas, points: readonly P[], radii: readonly number[], paint: BarkPaint): void {
  for (let i = 0; i + 1 < points.length; i++) limb(c, points[i]!, points[i + 1]!, radii[i]!, radii[i + 1]!, paint);
}

/** A quadratic curve from a to b bowed toward `ctrl`, as a few tapered capsules. */
function bough(c: Canvas, a: P, ctrl: P, b: P, ra: number, rb: number, paint: BarkPaint, steps = 4): void {
  let prev = a;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, s = 1 - t;
    const next = pt(s * s * a.x + 2 * s * t * ctrl.x + t * t * b.x, s * s * a.y + 2 * s * t * ctrl.y + t * t * b.y, s * s * a.z + 2 * s * t * ctrl.z + t * t * b.z);
    limb(c, prev, next, lerp(ra, rb, (i - 1) / steps), lerp(ra, rb, t), paint);
    prev = next;
  }
}

/** Bow control for a branch: its midpoint lifted by `lift` of its length, plus a little crookedness. */
function bow(r: Rng, a: P, b: P, lift: number, crook = 0.12): P {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return pt((a.x + b.x) / 2 + r.signed(len * crook), (a.y + b.y) / 2 + len * lift, (a.z + b.z) / 2 + r.signed(len * crook));
}

/** Position along a trunk polyline at height y (the points rise monotonically). */
function axisAt(points: readonly P[], y: number): P {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    if (y <= b.y || i + 2 === points.length) {
      const t = b.y === a.y ? 0 : clamp((y - a.y) / (b.y - a.y), 0, 1);
      return pt(lerp(a.x, b.x, t), y, lerp(a.z, b.z, t));
    }
  }
  return pt(0, y, 0);
}

/** Root spurs: from the trunk out and down into the ground, so the base flares. */
function roots(c: Canvas, r: Rng, count: number, trunkR: number, reach: Range, rise: Range, paint: number): void {
  const a0 = r.angle();
  for (let i = 0; i < count; i++) {
    const a = a0 + (i + r.signed(0.3)) * (TAU / count);
    const out = trunkR + r.range(reach);
    const from = pt(Math.cos(a) * trunkR * 0.3, r.range(rise), Math.sin(a) * trunkR * 0.3);
    const to = pt(Math.cos(a) * out, ROOT_DEPTH + r.range(0, 1), Math.sin(a) * out);
    const ctrl = pt(Math.cos(a) * out * 0.55, lerp(from.y, to.y, 0.25), Math.sin(a) * out * 0.55);
    bough(c, from, ctrl, to, trunkR * 0.62, Math.max(0.6, trunkR * 0.2), paint, 3);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Leaves: noisy ellipsoid puffs, shaded in bands.

interface Puff { readonly x: number; readonly y: number; readonly z: number; readonly rx: number; readonly ry: number; readonly rz: number }

interface Accent {
  readonly mat: number;
  /** Blob noise frequency (1/voxels); blobs come out roughly 1/freq/2 across. */
  readonly freq: number;
  /** Noise level above which a cell is accent; higher is rarer. */
  readonly threshold: number;
  /** Lowest height inside the puff (-1 underside .. 1 crown) where the accent may show. */
  readonly minLocal: number;
}

/** Leaf materials by band: deep shade, shadow, sunlit body, sunlit crown. */
type Bands = readonly [number, number, number, number];
const bandsOf = (family: number): Bands => [family, family + 1, family + 2, family + 3];

interface Look {
  readonly bands: Bands;
  /** Sunlit cells whose shade value passes this take the crown band. */
  readonly crown: number;
  /** Lump amplitude as a fraction of the puff radius, and lump noise frequency. */
  readonly amp: number;
  readonly freq: number;
  /** Shade = local·(height in puff) + global·(height in crown) + jitter·noise + bias, cut into four bands. */
  readonly local: number;
  readonly global: number;
  readonly jitter: number;
  readonly bias: number;
  readonly accents: readonly Accent[];
}

interface Salts { readonly lump: number; readonly shade: number; readonly accent: number; readonly ox: number; readonly oy: number; readonly oz: number }

function salts(r: Rng): Salts {
  return {
    lump: (r.next() * 4294967296) >>> 0, shade: (r.next() * 4294967296) >>> 0, accent: (r.next() * 4294967296) >>> 0,
    ox: r.range(0, 512), oy: r.range(0, 512), oz: r.range(0, 512),
  };
}


function accentAt(look: Look, s: Salts, x: number, y: number, z: number, local: number): number {
  for (let k = 0; k < look.accents.length; k++) {
    const a = look.accents[k]!;
    if (local < a.minLocal) continue;
    if (noise3(x * a.freq + s.oz, y * a.freq + s.ox, z * a.freq + s.oy, s.accent + k * 0x9e3779b9) > a.threshold) return a.mat;
  }
  return 0;
}

function foliage(c: Canvas, puffs: readonly Puff[], look: Look, s: Salts): void {
  if (puffs.length === 0) return;
  let lo = Infinity, hi = -Infinity;
  let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
  const amp = look.amp, fr = look.freq, ext = 1 + amp;
  const { best, mat, owner, lump } = c;
  // Pass one: the noisy union of puffs. Each cell remembers the puff it sits deepest in.
  for (let pi = 0; pi < puffs.length; pi++) {
    const p = puffs[pi]!;
    lo = Math.min(lo, p.y - p.ry); hi = Math.max(hi, p.y + p.ry);
    const x0 = Math.max(c.x0, Math.floor(p.x - p.rx * ext)), x1 = Math.min(c.x0 + c.nx - 1, Math.ceil(p.x + p.rx * ext));
    const y0 = Math.max(0, Math.floor(p.y - p.ry * ext)), y1 = Math.min(c.y0 + c.ny - 1, Math.ceil(p.y + p.ry * ext));
    const z0 = Math.max(c.z0, Math.floor(p.z - p.rz * ext)), z1 = Math.min(c.z0 + c.nz - 1, Math.ceil(p.z + p.rz * ext));
    if (x0 > x1 || y0 > y1 || z0 > z1) continue;
    bx0 = Math.min(bx0, x0); by0 = Math.min(by0, y0); bz0 = Math.min(bz0, z0);
    bx1 = Math.max(bx1, x1); by1 = Math.max(by1, y1); bz1 = Math.max(bz1, z1);
    const irx = 1 / p.rx, iry = 1 / p.ry, irz = 1 / p.rz;
    for (let y = y0; y <= y1; y++) {
      const uy = (y - p.y) * iry, uy2 = uy * uy;
      if (uy2 >= ext * ext) continue;
      for (let z = z0; z <= z1; z++) {
        const uz = (z - p.z) * irz, uyz = uy2 + uz * uz;
        if (uyz >= ext * ext) continue;
        // Only the stretch of the row that can come within the lump margin.
        const half = Math.sqrt(ext * ext - uyz) * p.rx;
        const xa = Math.max(x0, Math.ceil(p.x - half)), xb = Math.min(x1, Math.floor(p.x + half));
        let i = c.index(xa, y, z);
        for (let x = xa; x <= xb; x++, i++) {
          const ux = (x - p.x) * irx;
          const q = Math.sqrt(ux * ux + uyz) - 1;
          if (q >= amp) continue;
          let f = q;
          if (q > -amp) {
            let n = lump[i]!;
            if (n !== n) { n = noise3(x * fr + s.ox, y * fr + s.oy, z * fr + s.oz, s.lump); lump[i] = n; }
            f = q + amp * n;
          }
          if (f >= 0 || f >= best[i]!) continue;
          const m = mat[i]!;
          if (m !== 0 && isBark(m)) continue;
          best[i] = f; owner[i] = pi + 1; mat[i] = look.bands[2];
        }
      }
    }
  }
  if (bx0 > bx1) return;
  c.touch(bx0, by0, bz0, bx1, by1, bz1);
  // Pass two: colour each leaf once, by height in its puff and in the crown, with accents as blobs.
  // Cells buried on all six sides show no face, so they skip the noise and take the deep shade.
  const span = Math.max(1, hi - lo);
  const sx = 1, sz = c.nx, sy = c.nx * c.nz;
  const xMax = c.x0 + c.nx - 1, yMax = c.y0 + c.ny - 1, zMax = c.z0 + c.nz - 1;
  for (let y = by0; y <= by1; y++) {
    const global = ((y - lo) / span) * 2 - 1;
    for (let z = bz0; z <= bz1; z++) {
      let i = c.index(bx0, y, z);
      for (let x = bx0; x <= bx1; x++, i++) {
        const o = owner[i]!;
        if (o === 0) continue;
        owner[i] = 0;
        if (x > c.x0 && x < xMax && y > c.y0 && y < yMax && z > c.z0 && z < zMax
          && mat[i - sx] !== 0 && mat[i + sx] !== 0 && mat[i - sz] !== 0 && mat[i + sz] !== 0 && mat[i - sy] !== 0 && mat[i + sy] !== 0) {
          mat[i] = look.bands[0]; c.tag[i] = 0; continue;
        }
        const local = clamp((y - puffs[o - 1]!.y) / puffs[o - 1]!.ry, -1, 1);
        const accent = accentAt(look, s, x, y, z, local);
        if (accent !== 0) { mat[i] = accent; c.tag[i] = 0; continue; }
        const shade = look.local * local + look.global * global + look.jitter * noise3(x * 0.11 + s.oy, y * 0.11 + s.oz, z * 0.11 + s.ox, s.shade) + look.bias;
        const band = shade > look.crown ? 3 : 2;
        mat[i] = look.bands[band]; c.tag[i] = band + 1;
      }
    }
  }
}

function puff(x: number, y: number, z: number, r: number, squash: number, rng: Rng): Puff {
  return { x, y, z, rx: r * rng.range(0.9, 1.1), ry: r * squash * rng.range(0.9, 1.1), rz: r * rng.range(0.9, 1.1) };
}

// ---------------------------------------------------------------------------------------------------------
// Broadleaf crowns: a crooked trunk splits into limbs, limbs into boughs, boughs into twigs; a puff sits at
// every bough and twig end, inside an envelope that sets the crown's height, width and flatness.

interface CrownForm {
  readonly split: Range;
  readonly trunk: Range;
  readonly limbs: Range;
  readonly boughs: Range;
  readonly twigs: Range;
  readonly puff: Range;
  readonly squash: Range;
  /** How the space above the split divides: larger is a flatter crown. */
  readonly dome: number;
  /** Lowest limb ends sit this far below the crown centre (fraction of its half height). */
  readonly sag: number;
  readonly ellipse: number;
  readonly lean: number;
  readonly lowBranches: Range;
  readonly roots: Range;
  readonly rootReach: Range;
  readonly rootRise: Range;
  /** How much limbs bow upward (fraction of their length); negative droops. */
  readonly lift: number;
  readonly bark: number;
  readonly root: number;
}

interface Crown {
  readonly puffs: Puff[];
  readonly cx: number; readonly cy: number; readonly cz: number;
  readonly hy: number; readonly reach: number;
  readonly trunkR: number;
}

function crown(c: Canvas, r: Rng, height: number, radius: number, scale: number, f: CrownForm): Crown {
  const pr = r.range(f.puff) * scale;
  const sq = r.range(f.squash);
  const ry = pr * sq;
  const split = r.range(f.split) * height;
  const top = height - ry;
  const hy = Math.max(2, (top - split) / f.dome);
  const cy = top - hy;
  const leanA = r.angle(), lean = r.range(0, f.lean) * height;
  const cx = Math.cos(leanA) * lean, cz = Math.sin(leanA) * lean;
  const reach = Math.max(1.5, radius - pr);
  const ecc = r.range(0, f.ellipse), eccA = r.angle(), lobe = r.range(0.04, 0.14), lobeA = r.angle();
  const reachAt = (phi: number) => reach * (1 + ecc * Math.cos(2 * (phi - eccA)) + lobe * Math.sin(3 * phi + lobeA));
  const trunkR = r.range(f.trunk) * scale;

  // Roots first: the trunk overwrites them where they meet.
  roots(c, r, r.int(f.roots), trunkR, [f.rootReach[0] * scale, f.rootReach[1] * scale], [f.rootRise[0] * trunkR, f.rootRise[1] * trunkR], f.root);

  const T = pt(cx * 0.7, split, cz * 0.7);
  const crook = 0.5 + 0.025 * height;
  const way: P[] = [pt(0, ROOT_DEPTH, 0), pt(0, 0.5, 0)];
  const bends = height > 36 ? 3 : 2;
  for (let i = 1; i <= bends; i++) {
    const t = i / (bends + 1);
    way.push(pt(T.x * t + r.signed(crook), split * t, T.z * t + r.signed(crook)));
  }
  way.push(T);
  const radii = way.map((p, i) => (i < 2 ? trunkR * 1.22 : lerp(trunkR, trunkR * 0.72, clamp(p.y / split, 0, 1))));
  polyline(c, way, radii, f.bark);

  const puffs: Puff[] = [];
  const crownTop = pt(cx + r.signed(1), top - r.range(0, 1), cz + r.signed(1));
  bough(c, T, pt(lerp(T.x, crownTop.x, 0.5), lerp(T.y, crownTop.y, 0.4), lerp(T.z, crownTop.z, 0.5)), pt(crownTop.x, lerp(T.y, crownTop.y, 0.7), crownTop.z), trunkR * 0.6, Math.max(0.6, trunkR * 0.3), f.bark, 3);
  puffs.push(puff(crownTop.x, crownTop.y, crownTop.z, pr * r.range(1, 1.15), sq, r));

  const limbs = r.int(f.limbs);
  const a0 = r.angle();
  const limbR = trunkR * 0.62;
  for (let i = 0; i < limbs; i++) {
    const phi = a0 + (i + r.signed(0.3)) * (TAU / limbs);
    const ul = r.range(0.32, 0.58);
    const L = pt(cx + Math.cos(phi) * ul * reachAt(phi), cy + hy * r.range(-f.sag, 0.2), cz + Math.sin(phi) * ul * reachAt(phi));
    bough(c, T, bow(r, T, L, f.lift), L, limbR, limbR * 0.7, f.bark, 3);
    if (r.chance(0.4)) puffs.push(puff(L.x, L.y, L.z, pr * r.range(0.75, 0.95), sq, r));
    const boughs = r.int(f.boughs);
    for (let j = 0; j < boughs; j++) {
      const phs = phi + r.signed(0.5) * (TAU / limbs);
      const us = r.range(0.68, 1);
      const S = pt(cx + Math.cos(phs) * us * reachAt(phs), cy + hy * Math.sqrt(1 - us * us) * r.range(-0.3, 0.8) - hy * 0.1, cz + Math.sin(phs) * us * reachAt(phs));
      bough(c, L, bow(r, L, S, f.lift * 0.8), S, limbR * 0.6, Math.max(0.6, limbR * 0.32), f.bark, 2);
      puffs.push(puff(S.x, S.y, S.z, pr * r.range(0.82, 1.05), sq, r));
      const twigs = r.int(f.twigs);
      for (let k = 0; k < twigs; k++) {
        const pht = phs + r.signed(0.4);
        const ut = clamp(us + r.range(-0.2, 0.1), 0.3, 1);
        const tip = pt(cx + Math.cos(pht) * ut * reachAt(pht), cy + hy * Math.sqrt(Math.max(0, 1 - ut * ut)) * r.range(-0.15, 1), cz + Math.sin(pht) * ut * reachAt(pht));
        limb(c, S, tip, Math.max(0.6, limbR * 0.3), 0.6, f.bark);
        puffs.push(puff(tip.x, tip.y, tip.z, pr * r.range(0.85, 1.15), sq, r));
      }
    }
  }

  const low = r.int(f.lowBranches);
  for (let i = 0; i < low; i++) {
    const y = split * r.range(0.5, 0.85), phi = r.angle(), len = radius * r.range(0.45, 0.7);
    const from = axisAt(way, y);
    const end = pt(from.x + Math.cos(phi) * len, y + len * r.range(0.35, 0.65), from.z + Math.sin(phi) * len);
    bough(c, from, bow(r, from, end, 0.1), end, Math.max(0.6, trunkR * 0.4), 0.6, f.bark, 2);
    puffs.push(puff(end.x, end.y, end.z, pr * r.range(0.55, 0.75), sq, r));
  }
  return { puffs, cx, cy, cz, hy, reach, trunkR };
}

// ---------------------------------------------------------------------------------------------------------
// Species.

const BROAD_LOOK = { amp: 0.36, freq: 1 / 6, local: 0.6, global: 0.5, jitter: 0.35, bias: 0, crown: 0.38 } as const;

const OAK: CrownForm = {
  split: [0.4, 0.5], trunk: [1.15, 1.6], limbs: [3, 5], boughs: [1, 2], twigs: [0, 1], puff: [4.4, 6], squash: [0.7, 0.85],
  dome: 1.6, sag: 0.3, ellipse: 0.14, lean: 0.07, lowBranches: [0, 1], roots: [3, 4], rootReach: [1.5, 3], rootRise: [0.6, 1.4], lift: 0.16,
  bark: M.bark.oak, root: M.bark.root,
};

function broadleaf(c: Canvas, r: Rng, h: number, rad: number, scale: number, form: CrownForm, look: Look): Crown {
  const cr = crown(c, r, h, rad, scale, form);
  foliage(c, cr.puffs, look, salts(r));
  c.light(look.bands);
  return cr;
}

function oak(r: Rng, scale: number): TreeShape {
  const { h, rad, c } = sized(r, 'oak', scale);
  broadleaf(c, r, h, rad, scale, OAK, { ...BROAD_LOOK, bands: bandsOf(M.leaf.oak), accents: [] });
  return c.shape();
}

function lime(r: Rng, scale: number): TreeShape {
  const { h, rad, c } = sized(r, 'lime', scale);
  broadleaf(c, r, h, rad, scale, {
    ...OAK, split: [0.3, 0.4], trunk: [1, 1.35], limbs: [4, 5], boughs: [1, 2], twigs: [1, 1], puff: [3.6, 4.6], squash: [0.82, 0.96],
    dome: 1.45, sag: 0.35, ellipse: 0.08, lift: 0.22, lowBranches: [0, 1],
  }, { ...BROAD_LOOK, bands: bandsOf(M.leaf.lime), crown: 0.45, accents: [] });
  return c.shape();
}

/** Autumn gold: the ramp's own sunlit shade runs peach, so the sunlit crown takes the bright accent gold. */
const GOLD_BANDS: Bands = [M.leaf.gold, M.leaf.gold + 2, M.leaf.gold + 1, M.accent.gold];

function autumnGold(r: Rng, scale: number): TreeShape {
  const { h, rad, c } = sized(r, 'autumn-gold', scale);
  broadleaf(c, r, h, rad, scale, { ...OAK, puff: [4, 5.8], squash: [0.66, 0.8] }, {
    ...BROAD_LOOK, bands: GOLD_BANDS, crown: 0.3,
    accents: [{ mat: M.accent.orange, freq: 1 / 3.4, threshold: r.range(0.45, 0.55), minLocal: -0.4 }],
  });
  return c.shape();
}

function autumnRed(r: Rng, scale: number): TreeShape {
  const { h, rad, c } = sized(r, 'autumn-red', scale);
  broadleaf(c, r, h, rad, scale, { ...OAK, split: [0.36, 0.46], trunk: [1, 1.4], puff: [3.8, 5.2], squash: [0.74, 0.9], dome: 1.4 }, {
    ...BROAD_LOOK, bands: [M.leaf.red, M.leaf.red + 1, M.leaf.red + 2, M.accent.orange], crown: 0.42,
    accents: [{ mat: M.accent.gold, freq: 1 / 2.8, threshold: r.range(0.55, 0.65), minLocal: 0 }],
  });
  return c.shape();
}

/** Cherry's deepest ramp shade runs hot red; blossom stays soft, so shade bottoms out at the body pink. */
const CHERRY_BANDS: Bands = [M.leaf.cherry + 1, M.leaf.cherry + 1, M.leaf.cherry + 2, M.leaf.cherry + 2];

function cherry(r: Rng, scale: number): TreeShape {
  const { h, rad, c } = sized(r, 'cherry', scale);
  broadleaf(c, r, h, rad, scale, {
    ...OAK, split: [0.3, 0.4], trunk: [1, 1.35], limbs: [4, 6], boughs: [1, 2], twigs: [0, 1], puff: [3.8, 5], squash: [0.52, 0.64],
    dome: 1.25, sag: 0.2, ellipse: 0.16, lean: 0.12, lift: 0.06, lowBranches: [0, 1], bark: M.bark.cherry, root: M.bark.cherry,
  }, {
    ...BROAD_LOOK, bands: CHERRY_BANDS, local: 0.7, global: 0.35, crown: 0.55,
    accents: [{ mat: M.accent.blossom, freq: 1 / 2.6, threshold: r.range(0.36, 0.44), minLocal: -0.2 }],
  });
  return c.shape();
}

function willow(r: Rng, scale: number): TreeShape {
  const { h, rad, c } = sized(r, 'willow', scale);
  const look: Look = { ...BROAD_LOOK, bands: bandsOf(M.leaf.willow), crown: 0.45, accents: [] };
  const cr = crown(c, r, h, rad * 0.8, scale, {
    ...OAK, split: [0.32, 0.42], trunk: [1.3, 1.75], limbs: [3, 5], boughs: [1, 2], twigs: [0, 1], puff: [3.8, 4.8], squash: [0.6, 0.72],
    dome: 1.9, sag: 0.15, ellipse: 0.1, lean: 0.1, lift: 0.3, lowBranches: [0, 0], bark: M.bark.willow, root: M.bark.willow,
  });
  const s = salts(r);
  foliage(c, cr.puffs, look, s);
  c.light(look.bands);
  const top = cr.cy + cr.hy * 0.15;
  fronds(c, r, cr.cx, cr.cz, rad * r.range(0.84, 0.92), top, 0.72, M.leaf.willow);
  fronds(c, r, cr.cx, cr.cz, rad * r.range(0.6, 0.68), top, 0.5, M.leaf.willow);
  return c.shape();
}

/**
 * Willow fronds: a ring of hanging strands about two voxels wide, each with its own length, dark where
 * the dome shades it and light toward the tips. `reach` is how far down the longest strands come (0..1).
 */
function fronds(c: Canvas, r: Rng, cx: number, cz: number, radius: number, top: number, reach: number, family: number): void {
  const strands = Math.max(8, Math.round((TAU * radius) / 2.6));
  const salt = (r.next() * 4294967296) >>> 0;
  const a0 = r.angle();
  const lowest = Math.max(1, top * (1 - reach));
  const span = Math.ceil(radius + 2);
  for (let z = Math.floor(cz - span); z <= Math.ceil(cz + span); z++) {
    for (let x = Math.floor(cx - span); x <= Math.ceil(cx + span); x++) {
      const ddx = x - cx, ddz = z - cz;
      const d = Math.hypot(ddx, ddz);
      if (Math.abs(d - radius) > 0.75) continue;
      const a = (Math.atan2(ddz, ddx) - a0 + TAU * 2) % TAU;
      const along = (a / TAU) * strands;
      const k = Math.floor(along) % strands;
      // Each strand is a comb tooth: about half its arc is leaf, the rest is the gap you see through.
      if (along - Math.floor(along) > 0.5) continue;
      const roll = hash3(k, 1, 0, salt);
      if (roll < 0.12) continue;
      // Neighbouring strands share a slow swell so the hem scallops instead of zigzagging.
      const swell = 0.5 + 0.5 * Math.sin((k / strands) * TAU * 3 + salt * 1e-9);
      const bottom = lerp(top - 2, lowest, clamp(0.3 * swell + 0.7 * hash3(k, 2, 0, salt), 0, 1));
      for (let y = Math.max(0, Math.ceil(bottom)); y <= top; y++) {
        const t = (y - bottom) / Math.max(1, top - bottom);
        c.leaf(x, y, z, family + (t < 0.2 ? 3 : t < 0.55 ? 2 : t < 0.85 ? 1 : 0), -0.01);
      }
    }
  }
}

function birch(r: Rng, scale: number): TreeShape {
  const { h, rad, c } = sized(r, 'birch', scale);
  const trunkR = r.range(0.62, 0.9) * Math.sqrt(scale);
  const leanA = r.angle(), lean = r.range(0.02, 0.12) * h;
  const top = h - r.range(2, 3);
  const way: P[] = [pt(0, ROOT_DEPTH, 0), pt(0, 0.5, 0)];
  const bend = r.signed(1.2);
  for (const t of [0.3, 0.6, 0.85, 1]) {
    const off = lean * t * t;
    way.push(pt(Math.cos(leanA) * off + Math.sin(leanA) * bend * Math.sin(t * Math.PI), top * t, Math.sin(leanA) * off - Math.cos(leanA) * bend * Math.sin(t * Math.PI)));
  }
  // Birch bark: white with dark broken rings.
  const ringSalt = (r.next() * 4294967296) >>> 0;
  const paint = (x: number, y: number, z: number, ax: number, az: number) => {
    if (hash3(y, 7, 3, ringSalt) > 0.3) return M.bark.birch;
    const start = hash3(y, 1, 9, ringSalt) * TAU, len = 1.2 + hash3(y, 4, 2, ringSalt) * 2.6;
    const a = (Math.atan2(z - az, x - ax) - start + TAU * 2) % TAU;
    return a < len ? M.bark.dead : M.bark.birch;
  };
  polyline(c, way, way.map((p, i) => (i < 2 ? trunkR * 1.25 : lerp(trunkR, 0.6, clamp(p.y / top, 0, 1)))), paint);

  const puffs: Puff[] = [];
  const crownLo = h * r.range(0.38, 0.5);
  const twigs = r.int([6, 9]);
  const golden = 2.39996, a0 = r.angle();
  for (let j = 0; j < twigs; j++) {
    const t = (j + r.range(0.1, 0.9)) / twigs;
    const y = lerp(crownLo, top - 2, t);
    const from = axisAt(way, y);
    const phi = a0 + j * golden + r.signed(0.4);
    const len = Math.max(1, rad * (0.45 + 0.55 * Math.sin(Math.PI * (0.25 + 0.75 * (1 - t)))) * r.range(0.7, 0.95) - 1.5);
    const end = pt(from.x + Math.cos(phi) * len, y + len * r.range(0.5, 0.9), from.z + Math.sin(phi) * len);
    limb(c, from, end, 0.6, 0.6, M.bark.birch);
    puffs.push(puff(end.x, end.y, end.z, r.range(2.5, 3.4) * scale, r.range(0.75, 0.95), r));
  }
  const crest = axisAt(way, top);
  puffs.push(puff(crest.x, top + 0.5, crest.z, r.range(2.4, 3) * scale, 1.05, r));
  const look: Look = { ...BROAD_LOOK, bands: bandsOf(M.leaf.birch), amp: 0.3, freq: 1 / 5, local: 0.55, global: 0.55, crown: 0.5, accents: [] };
  foliage(c, puffs, look, salts(r));
  c.light(look.bands);
  return c.shape();
}

function pine(r: Rng, scale: number): TreeShape {
  const { h, rad, c } = sized(r, 'pine', scale);
  const trunkR = r.range(0.85, 1.2) * Math.sqrt(scale);
  const leanA = r.angle(), lean = r.range(0, 0.06) * h, wob = r.signed(1);
  const top = h - 1;
  const way: P[] = [pt(0, ROOT_DEPTH, 0), pt(0, 0.5, 0)];
  for (const t of [0.35, 0.7, 1]) way.push(pt(Math.cos(leanA) * lean * t + wob * Math.sin(t * Math.PI), top * t, Math.sin(leanA) * lean * t));
  polyline(c, way, way.map((p, i) => (i < 2 ? trunkR * 1.25 : lerp(trunkR, 0.6, clamp(p.y / top, 0, 1)))), M.bark.pine);
  roots(c, r, r.int([2, 3]), trunkR, [1, 2], [0.5, 1], M.bark.pine);

  const puffs: Puff[] = [];
  const crownLo = h * r.range(0.4, 0.52);
  // Dead stubs on the bare lower trunk.
  const stubs = r.int([1, 3]);
  for (let i = 0; i < stubs; i++) {
    const y = crownLo * r.range(0.35, 0.9), from = axisAt(way, y), phi = r.angle(), len = trunkR + r.range(1, 2.2);
    limb(c, from, pt(from.x + Math.cos(phi) * len, y + r.range(0, 1), from.z + Math.sin(phi) * len), 0.6, 0.6, M.bark.pine);
  }
  const whorls = r.int([5, 7]);
  const a0 = r.angle();
  for (let j = 0; j < whorls; j++) {
    const t = j / (whorls - 1);
    const y = lerp(crownLo, top - 3, t) + r.signed(0.6);
    const from = axisAt(way, y);
    const arms = r.int([3, 5]);
    for (let k = 0; k < arms; k++) {
      const phi = a0 + j * 1.1 + (k + r.signed(0.25)) * (TAU / arms);
      const len = Math.max(1.5, (rad - 1.5) * (1 - t * 0.72) * r.range(0.75, 1.1));
      const end = pt(from.x + Math.cos(phi) * len, y + len * r.range(0.15, 0.4), from.z + Math.sin(phi) * len);
      limb(c, from, end, 0.6, 0.6, M.bark.pine);
      const tuft = r.range(2.2, 3.1) * (1 - 0.35 * t) * scale;
      puffs.push(puff(end.x, end.y, end.z, tuft, r.range(0.5, 0.65), r));
      if (len > 2.5) puffs.push(puff(lerp(from.x, end.x, 0.4), lerp(from.y, end.y, 0.4) + 0.5, lerp(from.z, end.z, 0.4), tuft * 0.75, 0.6, r));
    }
  }
  const crest = axisAt(way, top);
  puffs.push(puff(crest.x, top - 1.5, crest.z, r.range(1.7, 2.2) * scale, 1.4, r));
  const look: Look = { ...BROAD_LOOK, bands: bandsOf(M.leaf.pine), amp: 0.3, freq: 1 / 4.5, local: 0.75, global: 0.35, jitter: 0.3, crown: 0.45, accents: [] };
  foliage(c, puffs, look, salts(r));
  c.light(look.bands);
  return c.shape();
}

/** Spruce runs darker than pine: its tiers overhang, so most of it sits in the shadow band. */
const SPRUCE_BANDS: Bands = [M.leaf.pine, M.leaf.pine + 1, M.leaf.pine + 2, M.leaf.pine + 3];

function spruce(r: Rng, scale: number): TreeShape {
  const { h, rad, c } = sized(r, 'spruce', scale);
  const trunkR = r.range(0.8, 1.1) * Math.sqrt(scale);
  const leanA = r.angle(), lean = r.range(0, 0.04) * h;
  const top = h - 1;
  const way: P[] = [pt(0, ROOT_DEPTH, 0), pt(0, 0.5, 0), pt(Math.cos(leanA) * lean, top, Math.sin(leanA) * lean)];
  polyline(c, way, [trunkR * 1.2, trunkR * 1.2, 0.6], M.bark.pine);
  roots(c, r, r.int([2, 3]), trunkR, [1, 2], [0.4, 0.9], M.bark.pine);

  const s = salts(r);
  const base = h * r.range(0.07, 0.15);
  const tiers = Math.max(4, Math.round((top - base) / r.range(3.3, 4.3)));
  const step = (top - base) / tiers;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const yb = base + step * i + r.signed(0.3);
    const tierR = (rad - 0.6) * Math.pow(1 - t, 0.95) * r.range(0.88, 1.08) + 1.1;
    const tierH = step * r.range(1.6, 2);
    const droop = r.range(0.8, 1.6) * (0.5 + 0.5 * (1 - t));
    const under = tierH * 0.4;
    const ph1 = r.angle(), ph2 = r.angle(), w1 = r.range(0.06, 0.14), w2 = r.range(0.04, 0.1);
    const centre = axisAt(way, yb);
    const span = Math.ceil(tierR * 1.25 + 1);
    for (let z = Math.floor(centre.z) - span; z <= Math.ceil(centre.z) + span; z++) {
      for (let x = Math.floor(centre.x) - span; x <= Math.ceil(centre.x) + span; x++) {
        const ddx = x - centre.x, ddz = z - centre.z;
        const d = Math.hypot(ddx, ddz), a = Math.atan2(ddz, ddx);
        const edge = tierR * (1 + w1 * Math.sin(3 * a + ph1) + w2 * Math.sin(5 * a + ph2) + 0.12 * noise3(x * 0.25 + s.ox, yb * 0.25, z * 0.25 + s.oz, s.lump));
        if (d > edge) continue;
        const u = d / edge;
        const yTop = yb + tierH * Math.pow(1 - u, 1.15);
        const yBot = yb + under * (1 - u) - droop * u;
        for (let y = Math.max(0, Math.ceil(yBot)); y <= Math.floor(yTop); y++) {
          const band = (1 - u) * 0.5 + t * 0.6 + 0.3 * noise3(x * 0.2 + s.oy, y * 0.2, z * 0.2 + s.ox, s.shade) > 0.85 ? 3 : 2;
          c.leaf(x, y, z, SPRUCE_BANDS[band], u - 1, band + 1);
        }
      }
    }
  }
  const crest = axisAt(way, top);
  c.leaf(Math.round(crest.x), Math.round(top) + 1, Math.round(crest.z), M.leaf.pine + 2, -1, 4);
  c.leaf(Math.round(crest.x), Math.round(top) + 2, Math.round(crest.z), M.leaf.pine + 2, -1, 4);
  c.light(SPRUCE_BANDS, 3);
  return c.shape();
}

/** Flat layered pads, bonsai style: one wide flat puff with smaller flat lobes around its rim. */
function pad(puffs: Puff[], r: Rng, x: number, y: number, z: number, radius: number, thick: number, lobes: Range): void {
  puffs.push({ x, y, z, rx: radius * r.range(0.9, 1.1), ry: thick, rz: radius * r.range(0.9, 1.1) });
  const n = r.int(lobes), a0 = r.angle();
  for (let i = 0; i < n; i++) {
    const a = a0 + (i + r.signed(0.3)) * (TAU / n), off = radius * r.range(0.5, 0.75), rr = radius * r.range(0.42, 0.62);
    puffs.push({ x: x + Math.cos(a) * off, y: y + r.range(-0.5, 0.9) * thick * 0.6, z: z + Math.sin(a) * off, rx: rr, ry: thick * r.range(0.8, 1.05), rz: rr * r.range(0.85, 1.1) });
  }
}

const TEAL_LOOK = { amp: 0.3, freq: 1 / 6, local: 0.8, global: 0.35, jitter: 0.35, bias: 0, crown: 0.5 } as const;

function teal(r: Rng, scale: number): TreeShape {
  const { h, rad, c } = sized(r, 'teal', scale);
  const trunkR = r.range(0.9, 1.3) * scale;
  const thick = r.range(1.8, 2.4) * Math.sqrt(scale);
  const topY = h - thick - 1;
  const leanA = r.angle(), lean = r.range(0.03, 0.12) * h;
  const way: P[] = [pt(0, ROOT_DEPTH, 0), pt(0, 0.5, 0)];
  for (const t of [0.3, 0.6, 1]) way.push(pt(Math.cos(leanA) * lean * t + r.signed(1.3), topY * t, Math.sin(leanA) * lean * t + r.signed(1.3)));
  polyline(c, way, way.map((p, i) => (i < 2 ? trunkR * 1.3 : lerp(trunkR, trunkR * 0.55, clamp(p.y / topY, 0, 1)))), M.bark.teal);
  roots(c, r, r.int([3, 4]), trunkR, [1.5, 2.5], [0.6, 1.2], M.bark.teal);

  const puffs: Puff[] = [];
  const crest = axisAt(way, topY);
  pad(puffs, r, crest.x, topY, crest.z, (rad - 1) * r.range(0.62, 0.8), thick, [2, 4]);
  const side = r.int([1, 3]);
  const a0 = r.angle();
  for (let i = 0; i < side; i++) {
    const y = lerp(h * 0.4, topY - thick * 3, side === 1 ? r.range(0.3, 0.8) : i / (side - 1)) + r.signed(0.8);
    const from = axisAt(way, y - r.range(1.5, 3));
    const phi = a0 + i * (TAU / side) * r.range(0.8, 1.2) + Math.PI * 0.5 * i;
    const radius = (rad - 1) * r.range(0.45, 0.62);
    const out = rad - radius - r.range(0, 1.5);
    const end = pt(from.x + Math.cos(phi) * out, y, from.z + Math.sin(phi) * out);
    bough(c, from, bow(r, from, end, 0.25), end, trunkR * 0.55, 0.6, M.bark.teal, 3);
    pad(puffs, r, end.x, y, end.z, radius, thick * r.range(0.85, 1), [1, 3]);
  }
  const look: Look = { ...TEAL_LOOK, bands: bandsOf(M.leaf.teal), accents: [{ mat: M.accent.lilac, freq: 1 / 2.2, threshold: 0.66, minLocal: 0.2 }] };
  foliage(c, puffs, look, salts(r));
  c.light(look.bands);
  return c.shape();
}

function shrub(r: Rng, scale: number): TreeShape {
  const { h, rad, c } = sized(r, 'shrub', scale);
  limb(c, pt(0, ROOT_DEPTH, 0), pt(r.signed(0.4), 0, r.signed(0.4)), 0.6, 0.6, M.bark.oak);
  const puffs: Puff[] = [];
  const main = Math.max(1.6, Math.min(rad, h * 0.62));
  const sq = clamp(h / (main * 1.7), 0.6, 1);
  puffs.push(puff(0, main * sq * 0.55, 0, main, sq, r));
  const n = r.int([1, 3]), a0 = r.angle();
  for (let i = 0; i < n; i++) {
    const a = a0 + (i + r.signed(0.3)) * (TAU / n), off = main * r.range(0.5, 0.9), rr = main * r.range(0.55, 0.8);
    puffs.push(puff(Math.cos(a) * off, rr * sq * 0.45, Math.sin(a) * off, rr, sq, r));
  }
  const family = r.next() < 0.6 ? M.leaf.hedge : M.leaf.oak;
  const dots = r.next();
  const accents: Accent[] = dots < 0.25 ? [{ mat: M.accent.berry, freq: 1 / 1.8, threshold: 0.5, minLocal: -0.3 }]
    : dots < 0.42 ? [{ mat: M.accent.blossom, freq: 1 / 1.8, threshold: 0.48, minLocal: -0.1 }] : [];
  const look: Look = { ...BROAD_LOOK, bands: bandsOf(family), amp: 0.3, freq: 1 / 3.5, local: 0.6, global: 0.4, crown: 0.45, accents };
  foliage(c, puffs, look, salts(r));
  c.light(look.bands);
  return c.shape();
}

// ---------------------------------------------------------------------------------------------------------
// Hero trees: landmarks two to three times a normal tree, with buttress roots and big limbs.

const HERO_CROWN: CrownForm = {
  split: [0.36, 0.44], trunk: [3, 3.6], limbs: [4, 6], boughs: [2, 3], twigs: [1, 2], puff: [7, 9.5], squash: [0.62, 0.74],
  dome: 2, sag: 0.35, ellipse: 0.12, lean: 0.04, lowBranches: [0, 2], roots: [6, 8], rootReach: [5, 10], rootRise: [1.6, 3],
  lift: 0.12, bark: M.bark.oak, root: M.bark.root,
};
const HERO_LOOK = { ...BROAD_LOOK, amp: 0.34, freq: 1 / 9, local: 0.65, global: 0.45 } as const;

function heroGold(r: Rng, scale: number): TreeShape {
  const { h, rad, c } = sized(r, 'hero-gold', scale);
  broadleaf(c, r, h, rad, scale, HERO_CROWN, {
    ...HERO_LOOK, bands: GOLD_BANDS, crown: 0.3,
    accents: [{ mat: M.accent.orange, freq: 1 / 5, threshold: 0.5, minLocal: -0.5 }],
  });
  return c.shape();
}

function heroCherry(r: Rng, scale: number): TreeShape {
  const { h, rad, c } = sized(r, 'hero-cherry', scale);
  broadleaf(c, r, h, rad, scale, {
    ...HERO_CROWN, split: [0.3, 0.38], trunk: [2.8, 3.4], limbs: [5, 6], puff: [7, 9], squash: [0.48, 0.58], dome: 1.6, sag: 0.25,
    ellipse: 0.16, lean: 0.06, lift: 0.08, bark: M.bark.cherry, root: M.bark.cherry,
  }, {
    ...HERO_LOOK, bands: CHERRY_BANDS, local: 0.7, global: 0.4, crown: 0.55,
    accents: [{ mat: M.accent.blossom, freq: 1 / 4.2, threshold: 0.47, minLocal: -0.1 }],
  });
  return c.shape();
}

function heroTeal(r: Rng, scale: number): TreeShape {
  const { h, rad, c } = sized(r, 'hero-teal', scale);
  const trunkR = r.range(2.9, 3.5) * scale;
  const split = h * r.range(0.36, 0.46);
  roots(c, r, r.int([6, 8]), trunkR, [5 * scale, 10 * scale], [1.6 * trunkR, 3 * trunkR], M.bark.teal);
  const leanA = r.angle(), lean = r.range(0.01, 0.05) * h;
  const S = pt(Math.cos(leanA) * lean, split, Math.sin(leanA) * lean);
  const way: P[] = [pt(0, ROOT_DEPTH, 0), pt(0, 0.5, 0), pt(r.signed(1.5), split * 0.5, r.signed(1.5)), S];
  polyline(c, way, [trunkR * 1.3, trunkR * 1.25, trunkR, trunkR * 0.85], M.bark.teal);

  const puffs: Puff[] = [];
  const pads: { x: number; y: number; z: number; r: number }[] = [];
  const thick = r.range(2.8, 3.6) * scale;
  const topY = h - thick - 1;
  const crestR = rad * r.range(0.42, 0.52);
  const crest = pt(S.x + r.signed(3), topY, S.z + r.signed(3));
  bough(c, S, bow(r, S, crest, 0.05, 0.2), crest, trunkR * 0.7, trunkR * 0.3, M.bark.teal, 4);
  pad(puffs, r, crest.x, crest.y, crest.z, crestR, thick, [3, 5]);
  pads.push({ x: crest.x, y: crest.y, z: crest.z, r: crestR });

  const limbs = r.int([3, 5]);
  const a0 = r.angle();
  for (let i = 0; i < limbs; i++) {
    const phi = a0 + (i + r.signed(0.25)) * (TAU / limbs);
    const padR = rad * r.range(0.3, 0.42);
    const out = rad - padR - r.range(0, 3);
    const y = lerp(split + 6, topY - thick * 2.5, r.range(0.2, 0.95));
    const end = pt(S.x + Math.cos(phi) * out, y, S.z + Math.sin(phi) * out);
    const from = axisAt(way, split - r.range(0, 4));
    bough(c, from, pt(lerp(from.x, end.x, 0.35), lerp(from.y, end.y, 0.85), lerp(from.z, end.z, 0.35)), end, trunkR * 0.6, Math.max(0.8, trunkR * 0.25), M.bark.teal, 5);
    pad(puffs, r, end.x, end.y, end.z, padR, thick * r.range(0.8, 1), [2, 4]);
    pads.push({ x: end.x, y: end.y, z: end.z, r: padR });
    if (r.chance(0.55)) {
      // A fork: a second, smaller pad off the limb, lower and further round.
      const fphi = phi + r.signed(0.5) + 0.35;
      const fR = padR * r.range(0.6, 0.8);
      const fOut = out * r.range(0.6, 0.85);
      const fy = Math.max(split + 4, y - r.range(5, 9));
      const fe = pt(S.x + Math.cos(fphi) * fOut, fy, S.z + Math.sin(fphi) * fOut);
      const fs = pt(lerp(from.x, end.x, 0.45), lerp(from.y, end.y, 0.55), lerp(from.z, end.z, 0.45));
      bough(c, fs, bow(r, fs, fe, 0.15), fe, trunkR * 0.32, 0.8, M.bark.teal, 3);
      pad(puffs, r, fe.x, fe.y, fe.z, fR, thick * 0.8, [1, 3]);
      pads.push({ x: fe.x, y: fe.y, z: fe.z, r: fR });
    }
  }
  const look: Look = { ...TEAL_LOOK, bands: bandsOf(M.leaf.teal), freq: 1 / 8, accents: [{ mat: M.accent.lilac, freq: 1 / 3, threshold: 0.62, minLocal: 0.3 }] };
  foliage(c, puffs, look, salts(r));
  c.light(look.bands);
  // Golden lanterns hanging on threads under the pads.
  for (const p of pads) {
    const n = Math.round(p.r / 3.5);
    for (let i = 0; i < n; i++) {
      const a = r.angle(), d = p.r * r.range(0.25, 0.85);
      const x = Math.round(p.x + Math.cos(a) * d), z = Math.round(p.z + Math.sin(a) * d);
      let y = Math.round(p.y);
      while (y > 0 && c.get(x, y, z) !== 0 && !isBark(c.get(x, y, z))) y--;
      if (y <= 4 || c.get(x, y, z) !== 0 || c.get(x, y + 1, z) === 0) continue;
      const thread = r.int([1, 4]);
      for (let k = 0; k < thread; k++) c.bark(x, y - k, z, M.bark.teal);
      c.leaf(x, y - thread, z, M.accent.gold, -1);
      c.leaf(x, y - thread - 1, z, M.accent.gold, -1);
    }
  }
  return c.shape();
}

// ---------------------------------------------------------------------------------------------------------

/** Rolls the tree's height and canopy radius and opens a canvas big enough to hold it. */
function sized(r: Rng, species: TreeSpecies, scale: number): { h: number; rad: number; c: Canvas } {
  const s = SIZE[species];
  const h = r.range(s.height) * scale, rad = r.range(s.radius) * scale;
  return { h, rad, c: new Canvas(rad * 1.2 + 4, h * 1.08 + 4) };
}

const BUILDERS: Record<TreeSpecies, (r: Rng, scale: number) => TreeShape> = {
  oak, lime, birch, pine, spruce, cherry, teal, willow, shrub,
  'autumn-gold': autumnGold, 'autumn-red': autumnRed,
  'hero-gold': heroGold, 'hero-teal': heroTeal, 'hero-cherry': heroCherry,
};

/**
 * Grows one tree. `seed` is a u32; `scale` is about 0.7..1.4 for normal trees and 1..1.3 for heroes.
 * Cells are relative to the base: dx = dz = 0 is the trunk centre and dy = 0 the first air cell above the
 * ground; trunks and roots reach down to dy = -3. Same arguments, same arrays.
 */
export function generateTreeShape(species: TreeSpecies, seed: number, scale: number): TreeShape {
  const s = Number.isFinite(scale) && scale > 0 ? clamp(scale, 0.3, 2) : 1;
  return BUILDERS[species](new Rng((seed >>> 0) ^ speciesSalt(species)), s);
}
