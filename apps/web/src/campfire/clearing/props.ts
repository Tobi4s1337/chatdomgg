import { MAT } from '@chatdom/content';
import { VOXEL_METRES, type Vec3, type VoxelAsset } from '@chatdom/shared';

/** Every campfire prop is authored on the build lattice. */
export const PROP_LATTICE_METRES = VOXEL_METRES.build;
const M = PROP_LATTICE_METRES;

export interface CampfireProp {
  readonly asset: VoxelAsset;
  /** Cell-space point (may be fractional) that maps onto the world placement point. Its y is ground level. */
  readonly anchor: Vec3;
  /** Coarse light blockers in metres relative to the placement point (axis-aligned, before yaw). */
  readonly occluders: readonly { readonly min: Vec3; readonly max: Vec3 }[];
}
type Occluder = CampfireProp['occluders'][number];
type V3 = [number, number, number];

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gap = (a: number, b: number) => Math.abs((((a - b) % TAU) + TAU + Math.PI) % TAU - Math.PI);

/** An integer hash of a lattice point into [0, 1): the hand's variation, never Math.random. */
function hash(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ Math.imul(seed | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1) on a unit lattice: patches and lumps rather than speckle. */
function noise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t), fx = s(x - ix), fy = s(y - iy), fz = s(z - iz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t, c = (dx: number, dy: number, dz: number) => hash(ix + dx, iy + dy, iz + dz, seed);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy), l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}

/** A seeded run of draws in [lo, hi): the authored parameters of one prop. */
function draws(seed: number, salt: number) {
  let i = 0;
  return (lo = 0, hi = 1) => lo + (hi - lo) * hash(i++, salt, 0x51ed, seed);
}
const pick = <T>(list: readonly T[], t: number): T => list[Math.min(list.length - 1, Math.floor(t * list.length))]!;

class Grid {
  readonly voxels: Uint16Array;
  constructor(readonly sx: number, readonly sy: number, readonly sz: number) { this.voxels = new Uint16Array(sx * sy * sz); }
  has(x: number, y: number, z: number) { return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz; }
  get(x: number, y: number, z: number): number { return this.has(x, y, z) ? this.voxels[x + this.sx * (y + this.sy * z)]! : MAT.air; }
  set(x: number, y: number, z: number, m: number) { if (this.has(x, y, z)) this.voxels[x + this.sx * (y + this.sy * z)] = m; }
  each(fn: (x: number, y: number, z: number, m: number) => void) {
    for (let z = 0; z < this.sz; z++) for (let y = 0; y < this.sy; y++) for (let x = 0; x < this.sx; x++) fn(x, y, z, this.voxels[x + this.sx * (y + this.sy * z)]!);
  }
}

/**
 * Rasterise a sampler over cell centres in local cell units, origin on the ground at the placement point.
 * The anchor is that origin in grid cells. Columns are visited bottom to top, so a sampler may cache per column.
 */
function sculpt(lo: Vec3, hi: Vec3, at: (x: number, y: number, z: number) => number): { grid: Grid; anchor: V3 } {
  const [x0, y0, z0] = lo.map(Math.floor) as V3, [x1, y1, z1] = hi.map(Math.ceil) as V3;
  const grid = new Grid(x1 - x0, y1 - y0, z1 - z0);
  for (let z = 0; z < grid.sz; z++) for (let x = 0; x < grid.sx; x++) for (let y = 0; y < grid.sy; y++) {
    const m = at(x + x0 + .5, y + y0 + .5, z + z0 + .5);
    if (m !== MAT.air) grid.set(x, y, z, m);
  }
  return { grid, anchor: [-x0, -y0, -z0] };
}

/** Above-ground bounds of the cells `keep` accepts, in metres from the placement point. */
function bounds(grid: Grid, anchor: Vec3, keep: (m: number) => boolean = m => m !== MAT.air): Occluder[] {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  grid.each((x, y, z, m) => {
    if (m === MAT.air || y + 1 <= anchor[1] || !keep(m)) return;
    [x, y, z].forEach((v, i) => { lo[i] = Math.min(lo[i]!, v); hi[i] = Math.max(hi[i]!, v + 1); });
  });
  if (lo[0] === Infinity) return [];
  const at = (v: number[], i: number) => (v[i]! - anchor[i]!) * M;
  return [{ min: [at(lo, 0), Math.max(0, at(lo, 1)), at(lo, 2)], max: [at(hi, 0), at(hi, 1), at(hi, 2)] }];
}

/**
 * Crop to the solid cells and wrap as an asset. With an integer ground row, a solid cell whose top would lie
 * flush in the ground plane is dropped, so a sunk foot never shares a face with the clearing floor.
 */
function finish(id: string, grid: Grid, anchor: Vec3, { occlude, flush = true }: { occlude?: (g: Grid, a: Vec3) => Occluder[]; flush?: boolean } = {}): CampfireProp {
  if (flush && Number.isInteger(anchor[1])) {
    const y = anchor[1] - 1;
    for (let z = 0; z < grid.sz; z++) for (let x = 0; x < grid.sx; x++) if (grid.get(x, y, z) !== MAT.air && grid.get(x, y + 1, z) === MAT.air) grid.set(x, y, z, MAT.air);
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-1, -1, -1];
  grid.each((x, y, z, m) => { if (m !== MAT.air) [x, y, z].forEach((v, i) => { lo[i] = Math.min(lo[i]!, v); hi[i] = Math.max(hi[i]!, v); }); });
  if (hi[0] === -1) throw new Error(`${id} has no solid cells.`);
  const [ox, oy, oz] = lo as V3, out = new Grid(hi[0]! - ox + 1, hi[1]! - oy + 1, hi[2]! - oz + 1);
  out.each((x, y, z) => out.set(x, y, z, grid.get(x + ox, y + oy, z + oz)));
  const a: Vec3 = [anchor[0] - ox, anchor[1] - oy, anchor[2] - oz];
  return { asset: { id, revision: 1, lattice: 'build', size: [out.sx, out.sy, out.sz], voxels: out.voxels }, anchor: a, occluders: occlude ? occlude(out, a) : [] };
}

/* ---------- Seats ---------- */

export { createSeatLog } from '@chatdom/content';

/**
 * The magistrate's seat: a broad stump chair. Its top shows the rings; the back third rises into a low carved
 * backrest, adzed on the face with a carved recess, bark behind. A red cloth with a muted gold hem is folded
 * over the crest, short in front and long behind, pinned by two brass studs. Roots flare into the ground.
 * The sitter faces +Z.
 */
export function createMagistrateSeat(options: { seatTop: number; seed: number }): CampfireProp & { readonly seatTop: number } {
  const { seed } = options, seatTop = clamp(options.seatTop, 0.15, 0.6), d = draws(seed, 2);
  const T = Math.ceil(seatTop / M - 1e-9) + 1, ground = T - seatTop / M, base = Math.floor(ground) - 1, C = 6, H = 4;
  const grid = new Grid(12, T + H + 2, 12), turn = d(0, TAU);
  const rootCount = 4 + (d() < .4 ? 1 : 0), roots = Array.from({ length: rootCount }, (_, i) => ({ a: turn + (i + d(-.22, .22)) * TAU / rootCount, reach: d(1, 2.4) }));
  const crest = (x: number) => Math.abs(x + .5 - C) < 2 ? H : H - 1;
  grid.each((x, y, z) => {
    const dx = x + .5 - C, dz = z + .5 - C, r = Math.hypot(dx, dz), a = Math.atan2(dz, dx), rise = y - base;
    const bulge = .22 * (noise(Math.cos(a) * 1.8 + 4, y / 5, Math.sin(a) * 1.8 + 4, seed) * 2 - 1);
    let radius = 3 + bulge;
    if (rise < 3) { const fall = (1 - rise / 3) ** 1.4; radius += .5 * fall; for (const root of roots) radius += root.reach * Math.max(0, 1 - gap(a, root.a) / .5) * fall; }
    const back = y >= T && y < T + crest(x) && z <= 4 && r <= 3.05;
    if (!(r <= radius && y < T) && !back) return;
    let m: number = MAT.bark;
    const ab = Math.floor((a + Math.PI) / TAU * 18) % 18;
    if (hash(ab, Math.floor(y / 3 + hash(ab, 0, 0, seed) * 3), 5, seed) < .18) m = MAT.timber;
    if (y === T - 1 && r < 2.55 + bulge) {
      const ring = r + .6 * (noise(x / 2, 0, z / 2, seed + 3) - .5);
      m = ring > 1.25 && ring < 1.85 ? MAT.cream : MAT.timber;
    }
    if (back && z === 4) m = MAT.timber;
    grid.set(x, y, z, m);
  });
  // The carved recess at the small of the back, with a pale lintel where the gouge broke fresh wood.
  for (const x of [5, 6]) { grid.set(x, T, 4, MAT.air); grid.set(x, T + 1, 4, MAT.air); grid.set(x, T, 3, MAT.timber); grid.set(x, T + 1, 3, MAT.timber); grid.set(x, T + 2, 4, MAT.cream); }
  // Moss low on the back and along the tops of the roots.
  grid.each((x, y, z, m) => {
    if (m !== MAT.bark && m !== MAT.timber) return;
    const low = y - base < 3, open = grid.get(x, y + 1, z) === MAT.air, n = noise(x / 2.2, y / 2, z / 2.2, seed + 5);
    if ((low && z < 5 && n > .42) || (low && open && y < T - 1 && n > .55)) grid.set(x, y, z, MAT.moss);
  });
  // The drape: over the crest, one fold-down in front, a long fall behind with a ragged hem and one deep fold.
  const fold = 4 + Math.floor(d(0, 4)), top = T + H;
  for (let x = 4; x < 8; x++) {
    grid.set(x, top, 3, MAT.fabricRed); grid.set(x, top, 4, MAT.fabricRed);
    grid.set(x, top - 1, 5, MAT.fabricRed); grid.set(x, top - 2, 5, MAT.fabricMutedGold);
    const hem = T + (x === 4 || x === 7 ? 1 : 0) + (d() < .5 ? 1 : 0);
    for (let y = hem; y < top; y++) grid.set(x, y, 2, y === hem ? MAT.fabricMutedGold : MAT.fabricRed);
    if (x === fold) for (let y = hem + 1; y < top - 1; y++) grid.set(x, y, 1, MAT.fabricRed);
  }
  grid.set(4, T + 1, 5, MAT.brass); grid.set(7, T + 1, 5, MAT.brass);
  const prop = finish(`campfire.magistrate.s${seed}`, grid, [C, ground, C], { occlude: bounds });
  return { ...prop, seatTop };
}

/* ---------- The hearth ---------- */

/** The flame's base centre, metres from the fire ring's placement: the top of the ember bed. */
export const FIRE_FLAME_BASE: Vec3 = [0, M, 0];

/**
 * The hearth: ten to twelve rounded stones, each its own shape and stone, sunk a cell and sooted on the inside;
 * an ash bed glowing at the heart; and a log-cabin crib of split wood whose centre stays open for the flame.
 */
export function createFireRing(seed: number): CampfireProp {
  const d = draws(seed, 3), count = 10 + Math.floor(d(0, 3)), turn = d(0, TAU);
  const shades = [MAT.stone, MAT.limestone, MAT.darkStone] as const;
  const stones = Array.from({ length: count }, (_, i) => ({
    a: turn + (i + d(-.16, .16)) * TAU / count, rho: d(4.55, 4.95), u: d(1.15, 1.5), v: d(.95, 1.2), h: d(1.5, 2.3), tilt: d(-.25, .25), m: pick(shades, d()),
  }));
  const piece = (x: number, y: number, z: number) => {
    const run = (axis: number, across: number, lo: number, hi: number) => Math.abs(across) === 1.5 && axis >= lo && axis <= hi;
    const j = (k: number) => Math.round(hash(k, 1, 2, seed) * 1.4 - .4);
    if (y === .5 && run(x, z, -2.5 - j(1) + (z > 0 ? j(2) : 0), 2.5 + j(3))) return x;
    if (y === 1.5 && run(z, x, -2.5 - j(4), 2.5 + j(5) - (x > 0 ? j(6) : 0))) return z;
    if (y === 2.5 && run(x, z, -1.5 - (z > 0 ? 0 : j(7)), 1.5 + (z > 0 ? j(8) : 0))) return x;
    return undefined;
  };
  const { grid, anchor } = sculpt([-7, -1, -7], [7, 4, 7], (x, y, z) => {
    const r = Math.hypot(x, z);
    let best = 1, stone: (typeof stones)[number] | undefined;
    for (const s of stones) {
      const c = Math.cos(s.a), sn = Math.sin(s.a), w = Math.max(0, y);
      const v = x * c + z * sn - s.rho + s.tilt * w, u = -x * sn + z * c;
      const f = Math.abs(u / s.u) ** 2.4 + Math.abs(v / s.v) ** 2.4 + (w / s.h) ** 2.4;
      if (f < best) { best = f; stone = s; }
    }
    if (stone) {
      const fleck = hash(Math.floor(x), Math.floor(y), Math.floor(z), seed + 1);
      if (y > 1 && r < stone.rho - .3 && fleck < .55) return MAT.darkStone;
      if (fleck < .18) return stone.m === MAT.stone ? (fleck < .09 ? MAT.limestone : MAT.darkStone) : MAT.stone;
      return stone.m;
    }
    const along = piece(x, y, z);
    if (along !== undefined) {
      const k = hash(Math.floor(x), Math.floor(y), Math.floor(z), seed + 2), ends = Math.abs(along) > 2 || (y === 2.5 && Math.abs(along) > 1);
      if (ends) return MAT.timber;
      if (r < 2.2 && k < .3) return MAT.forgeCopper;
      return k < .4 ? MAT.timber : MAT.bark;
    }
    if (y !== .5) return MAT.air;
    const k = hash(Math.floor(x), 0, Math.floor(z), seed + 3), edge = 3.1 + .7 * noise(Math.cos(Math.atan2(z, x)) * 1.5 + 2, 0, Math.sin(Math.atan2(z, x)) * 1.5 + 2, seed + 4);
    if (r < 1.6) return k < .45 ? MAT.forgeCopper : k < .8 ? MAT.fabricOrange : MAT.darkStone;
    if (r < edge) return r < 2.4 && k < .12 ? MAT.forgeCopper : noise(x / 1.5, 0, z / 1.5, seed + 6) < .55 ? MAT.darkStone : MAT.earth;
    return MAT.air;
  });
  return finish(`campfire.hearth.${count}.s${seed}`, grid, anchor);
}

/* ---------- The game lantern ---------- */

/**
 * A seat lantern on a stake pushed into the ground: brass base and corner posts, glass panes on four sides, a
 * hollow heart for the flame, a stepped peaked cap and its ring. Earth thrown up by the stake varies per seed. The
 * build lattice sets the scale: a pane needs a cell, so the body is three cells across.
 */
export function createGameLantern(seed: number): CampfireProp & { readonly flame: Vec3 } {
  const d = draws(seed, 4), g = 2, base = g + 2, grid = new Grid(3, base + 6, 3);
  for (let y = 0; y < base; y++) grid.set(1, y, 1, y >= g && d() < .3 ? MAT.bark : MAT.timber);
  for (const [x, z] of [[0, 1], [2, 1], [1, 0], [1, 2]] as const) { const t = d(); if (t < .55) grid.set(x, g, z, t < .25 ? MAT.earth : t < .42 ? MAT.grass : MAT.moss); }
  for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) {
    const corner = x !== 1 && z !== 1, centre = x === 1 && z === 1;
    grid.set(x, base, z, MAT.brass);
    for (const y of [base + 1, base + 2]) grid.set(x, y, z, centre ? MAT.air : corner ? MAT.brass : MAT.glass);
    if (!corner) grid.set(x, base + 3, z, MAT.brass);
  }
  grid.set(1, base + 4, 1, MAT.brass);
  const prop = finish(`campfire.lantern.s${seed}`, grid, [1.5, g, 1.5]);
  return { ...prop, flame: [0, (base + 2 - g) * M, 0] };
}

/* ---------- The Wilds ---------- */

interface Limb { readonly a: V3; readonly b: V3; readonly r0: number; readonly r1: number }
interface Blob { readonly c: V3; readonly r: V3 }
interface Lobe { readonly a: number; readonly reach: number }

/** Signed distance to a tapered limb, and the nearest point on its axis. */
function limb(x: number, y: number, z: number, l: Limb): { d: number; qx: number; qz: number } {
  const [ax, ay, az] = l.a, bx = l.b[0] - ax, by = l.b[1] - ay, bz = l.b[2] - az;
  const t = clamp(((x - ax) * bx + (y - ay) * by + (z - az) * bz) / (bx * bx + by * by + bz * bz), 0, 1);
  const qx = ax + bx * t, qy = ay + by * t, qz = az + bz * t;
  return { d: Math.hypot(x - qx, y - qy, z - qz) - (l.r0 + (l.r1 - l.r0) * t), qx, qz };
}

/** Root flare around a trunk foot at the origin: lobes that swell toward the ground and run under it. */
function flare(x: number, y: number, z: number, radius: number, lobes: readonly Lobe[], height: number): boolean {
  const fall = clamp(1 - Math.max(0, y) / height, 0, 1) ** 1.6;
  if (fall <= 0) return false;
  const a = Math.atan2(z, x);
  let r = radius + .7 * fall;
  for (const lobe of lobes) r += lobe.reach * Math.max(0, 1 - gap(a, lobe.a) / .55) ** 1.2 * fall;
  return Math.hypot(x, z) < r;
}

/**
 * Wilds foliage by height within its own clump: violet-blue shade underneath, leaf through the body, moss where
 * the top catches the light, with soft patches of muted blue so the forest reads purple-blue at night.
 */
function foliage(x: number, y: number, z: number, h: number, seed: number, blue = 0, light = 0): number {
  const patch = noise(x / 5, y / 4, z / 5, seed + 31), fleck = hash(Math.floor(x), Math.floor(y), Math.floor(z), seed + 37);
  if (h < -.35 + .3 * patch) return fleck < .15 ? MAT.leaf : patch < .5 ? MAT.fabricMutedViolet : MAT.fabricMutedBlue;
  if (h > .58 - .3 * patch - light && fleck > .3) return MAT.moss;
  if (patch > .62 - blue) return fleck < .15 ? MAT.fabricMutedViolet : MAT.fabricMutedBlue;
  return fleck < .06 + light * .3 ? MAT.moss : MAT.leaf;
}

const spin = (x: number, z: number, a: number): [number, number] => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
const lobesOf = (d: ReturnType<typeof draws>, count: number, lo: number, hi: number): Lobe[] => {
  const turn = d(0, TAU);
  return Array.from({ length: count }, (_, i) => ({ a: turn + (i + d(-.2, .2)) * TAU / count, reach: d(lo, hi) }));
};

/** Oak bark: vertical ridges with paler worn streaks; moss on the shaded −Z flank low down and over the roots. */
function oakBark(x: number, y: number, z: number, qx: number, qz: number, seed: number): number {
  const a = Math.atan2(z - qz, x - qx), bin = Math.floor((a + Math.PI) * 2.4);
  if (y < 9 && z - qz < -.3 && noise(x / 2.5, y / 3, z / 2.5, seed + 41) > .4 - (y < 2 ? .15 : 0)) return MAT.moss;
  if (y < 1.5 && noise(x / 2, 0, z / 2, seed + 43) > .62) return MAT.moss;
  return hash(bin, Math.floor(y / 3 + hash(bin, 9, 9, seed) * 3), 13, seed) < .2 ? MAT.timber : MAT.bark;
}

/**
 * A crowned tree: a leaning trunk forking into limbs, each carrying a clump; small sub-clumps scallop the
 * silhouette. Each clump shades itself, so the crown reads as several soft masses rather than one ball.
 */
function crownTree(id: string, seed: number, form: {
  trunk: readonly Limb[]; limbs: readonly Limb[]; blobs: readonly Blob[]; lobes: readonly Lobe[]; foot: number; flareHeight: number; sink: number;
  bark: (x: number, y: number, z: number, qx: number, qz: number) => number; lump: number; blue?: number; light?: number;
}): CampfireProp {
  const wood = [...form.trunk, ...form.limbs];
  let reach = 0, top = 0, crownLow = Infinity;
  for (const b of form.blobs) { reach = Math.max(reach, Math.hypot(b.c[0], b.c[2]) + Math.max(b.r[0], b.r[2]) * 1.3); top = Math.max(top, b.c[1] + b.r[1] * 1.3); crownLow = Math.min(crownLow, b.c[1] - b.r[1] * .72); }
  for (const l of form.lobes) reach = Math.max(reach, form.foot + l.reach + 2);
  // Only the clumps and limbs over a column can touch it.
  const slack = 1 + form.lump + .06;
  let column: { x: number; z: number; blobs: readonly Blob[]; wood: readonly Limb[] } = { x: NaN, z: NaN, blobs: [], wood: [] };
  const over = (x: number, z: number) => {
    if (column.x !== x || column.z !== z) column = {
      x, z,
      blobs: form.blobs.filter(b => ((x - b.c[0]) / b.r[0]) ** 2 + ((z - b.c[2]) / b.r[2]) ** 2 < slack * slack),
      wood: wood.filter(l => x > Math.min(l.a[0], l.b[0]) - l.r0 - 1 && x < Math.max(l.a[0], l.b[0]) + l.r0 + 1 && z > Math.min(l.a[2], l.b[2]) - l.r0 - 1 && z < Math.max(l.a[2], l.b[2]) + l.r0 + 1),
    };
    return column;
  };
  const { grid, anchor } = sculpt([-reach, -form.sink, -reach], [reach, top + 1, reach], (x, y, z) => {
    if (y < -form.sink) return MAT.air;
    const { blobs, wood: near } = over(x, z);
    let best = Infinity, h = 0;
    for (const b of blobs) {
      const dx = (x - b.c[0]) / b.r[0], dy = (y - b.c[1]) / (y < b.c[1] ? b.r[1] * .72 : b.r[1]), dz = (z - b.c[2]) / b.r[2];
      const q = dx * dx + dy * dy + dz * dz;
      if (q < best) { best = q; h = dy; }
    }
    best = Math.sqrt(best);
    if (best < 1 + form.lump + .06) {
      const lump = form.lump * (noise(x / 4.2, y / 4.2, z / 4.2, seed + 21) * 2 - 1) + .06 * (noise(x / 1.6, y / 1.6, z / 1.6, seed + 23) * 2 - 1);
      if (best - lump < 1) return foliage(x, y, z, h, seed, form.blue ?? 0, form.light ?? 0);
    }
    for (const l of near) { const hit = limb(x, y, z, l); if (hit.d < 0) return form.bark(x, y, z, hit.qx, hit.qz); }
    if (flare(x, y, z, form.foot, form.lobes, form.flareHeight)) return form.bark(x, y, z, 0, 0);
    return MAT.air;
  });
  const foot = (form.foot + 1) * M;
  return finish(id, grid, anchor, { occlude: () => [
    { min: [-foot, 0, -foot], max: [foot, Math.max(M, crownLow * M), foot] },
    { min: [-reach * M, crownLow * M, -reach * M], max: [reach * M, top * M, reach * M] },
  ] });
}

function oak(seed: number, broad: boolean): CampfireProp {
  const d = draws(seed, broad ? 51 : 50), turn = d(0, TAU), H = Math.round(broad ? d(44, 48) : d(37, 41)), lean = d(2, 4);
  const at = (x: number, y: number, z: number): V3 => { const [sx, sz] = spin(x, z, turn); return [sx, y, sz]; };
  const fork = at(lean * .6, H * (broad ? .4 : .44), d(-1, 1)), knee = at(lean * .1, H * .2, d(-1.5, 1.5));
  const main: Blob = { c: at(lean + d(-1, 1), H - (broad ? 11 : 10), d(-1, 1)), r: broad ? [14, 11, 13] : [12.5, 10, 11.5] };
  const sides: Blob[] = [
    { c: at(-9 - d(0, 2), H * .62, 4), r: [9.5, 7.5, 9] },
    { c: at(7 + d(0, 2), H * .56, -7), r: [9, 7, 8.5] },
    ...(broad ? [{ c: at(-16, H * .44, -4 + d(-2, 2)), r: [8.5, 6, 7.5] as V3 }] : []),
  ];
  const clumps: Blob[] = [];
  for (const b of [main, ...sides]) for (let i = 0, k = b === main ? 6 : 2; i < k; i++) {
    const a = d(0, TAU), up = d(-.15, .8), out = Math.sqrt(1 - up * up), s = d(3.5, 5.5);
    clumps.push({ c: [b.c[0] + Math.cos(a) * out * b.r[0] * .85, b.c[1] + up * b.r[1] * .85, b.c[2] + Math.sin(a) * out * b.r[2] * .85], r: [s, s * .8, s] });
  }
  const r0 = broad ? 3.4 : 2.9;
  return crownTree(`campfire.tree.${broad ? 1 : 0}.s${seed}`, seed, {
    trunk: [{ a: [0, -3, 0], b: knee, r0, r1: r0 - .3 }, { a: knee, b: fork, r0: r0 - .3, r1: r0 - .8 }],
    limbs: [main, ...sides].map((b, i): Limb => {
      const end: V3 = [fork[0] + (b.c[0] - fork[0]) * .8, fork[1] + (b.c[1] - fork[1]) * .8, fork[2] + (b.c[2] - fork[2]) * .8];
      return { a: i === 3 ? knee : fork, b: end, r0: i === 0 ? r0 - .9 : 1.6, r1: .9 };
    }),
    blobs: [main, ...sides, ...clumps], lobes: lobesOf(d, 5, 1, 2.6), foot: r0, flareHeight: 6, sink: 3,
    bark: (x, y, z, qx, qz) => oakBark(x, y, z, qx, qz, seed), lump: .17,
  });
}

/** A tall fir of drooping tiers, stepped and scalloped, each tier a little off the last; bluer than the oaks. */
function fir(seed: number): CampfireProp {
  const d = draws(seed, 52), H = Math.round(d(50, 55)), leanA = d(0, TAU), lean = d(.02, .05), count = 6;
  const axis = (y: number): [number, number] => [Math.cos(leanA) * lean * y, Math.sin(leanA) * lean * y];
  const tiers = Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count, y = 9 + t * (H - 15), [ax, az] = axis(y);
    return i === count
      ? { y, R: 2.6, th: H - y, ox: ax, oz: az, droop: .5 }
      : { y, R: (12 - 7.5 * t) * d(.9, 1.08), th: (H - 15) / count * 1.7, ox: ax + d(-.8, .8), oz: az + d(-.8, .8), droop: 2.4 - t };
  });
  const lobes = lobesOf(d, 4, .8, 1.8), foot = 1.9;
  const { grid, anchor } = sculpt([-15, -3, -15], [15, H + 1, 15], (x, y, z) => {
    if (y < -3) return MAT.air;
    for (const tier of tiers) {
      const h = y - tier.y, dx = x - tier.ox, dz = z - tier.oz, rr = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
      if (h > tier.th || h < -tier.droop - .5 || rr > tier.R * 1.15) continue;
      const R = tier.R * (1 + .14 * (noise(Math.cos(a) * 2.2 + tier.y, 0, Math.sin(a) * 2.2, seed + 61) * 2 - 1));
      if (rr > R || h < -tier.droop * (rr / R) ** 2 - .5 || h > tier.th * (1 - rr / R) ** 1.1) continue;
      const under = h < .3 - tier.droop * (rr / R) ** 2, rim = rr / R;
      const patch = noise(x / 4, y / 3, z / 4, seed + 63), fleck = hash(Math.floor(x), Math.floor(y), Math.floor(z), seed + 65);
      if (under) return patch < .55 ? MAT.fabricMutedViolet : MAT.fabricMutedBlue;
      if (rim > .7 && h > tier.th * (1 - rim) - 1.2 && fleck < .3) return MAT.moss;
      return patch > .55 || fleck < .12 ? MAT.fabricMutedBlue : MAT.leaf;
    }
    const [ax, az] = axis(y), r = 1.8 - 1.1 * clamp(y / H, 0, 1);
    if (y < H - 8 && Math.hypot(x - ax, z - az) < r) return oakBark(x, y, z, ax, az, seed);
    if (flare(x, y, z, foot, lobes, 4)) return oakBark(x, y, z, 0, 0, seed);
    return MAT.air;
  });
  return finish(`campfire.tree.2.s${seed}`, grid, anchor, { occlude: () => [
    { min: [-3 * M, 0, -3 * M], max: [3 * M, 9 * M, 3 * M] },
    { min: [-14 * M, 7 * M, -14 * M], max: [14 * M, H * M, 14 * M] },
  ] });
}

/** A young birch: a slim S-curved pale trunk with dark dashes, and a light, airy crown of three small clumps. */
function birch(seed: number): CampfireProp {
  const d = draws(seed, 53), turn = d(0, TAU), H = Math.round(d(27, 30));
  const at = (x: number, y: number, z: number): V3 => { const [sx, sz] = spin(x, z, turn); return [sx, y, sz]; };
  const p0: V3 = [0, -2, 0], p1 = at(1, H * .33, 0), p2 = at(-.5, H * .62, .5), p3 = at(.6, H - 6, 0);
  const blobs: Blob[] = [
    { c: at(1.5, H - 5, 0), r: [6.5, 5, 6] }, { c: at(-3.5, H - 9, 2.5), r: [5, 4, 4.5] }, { c: at(3.5, H - 10, -2.5), r: [4.5, 3.8, 4.5] },
    { c: at(d(-1, 1), H - 2, d(-1, 1)), r: [3.5, 3, 3.5] },
  ];
  const bark = (x: number, y: number, z: number, qx: number, qz: number) => {
    const bin = Math.floor((Math.atan2(z - qz, x - qx) + Math.PI) * 1.2), k = hash(bin, Math.floor(y), 17, seed);
    if (y < 2.5) return k < .5 ? MAT.limestone : MAT.bark;
    if (k < .13 || hash(bin + 1, Math.floor(y), 17, seed) < .06) return MAT.bark;
    return noise(x / 2, y / 3, z / 2, seed + 19) > .62 ? MAT.limestone : MAT.cream;
  };
  return crownTree(`campfire.tree.3.s${seed}`, seed, {
    trunk: [{ a: p0, b: p1, r0: 1.5, r1: 1.1 }, { a: p1, b: p2, r0: 1.1, r1: .9 }, { a: p2, b: p3, r0: .9, r1: .75 }],
    limbs: blobs.slice(1, 3).map((b): Limb => ({ a: p2, b: [p2[0] + (b.c[0] - p2[0]) * .7, p2[1] + (b.c[1] - p2[1]) * .7, p2[2] + (b.c[2] - p2[2]) * .7], r0: .7, r1: .55 })),
    blobs, lobes: lobesOf(d, 3, .4, 1), foot: 1.2, flareHeight: 3, sink: 2, bark, lump: .22, light: .25,
  });
}

/**
 * A dead snag: a broken trunk with a jagged, rotted-hollow top showing pale splintered wood, a snapped limb,
 * two bracket fungi and heavy moss on the shaded side and over the roots.
 */
function snag(seed: number): CampfireProp {
  const d = draws(seed, 54), H = Math.round(d(15, 17)), turn = d(0, TAU), lobes = lobesOf(d, 5, 1.5, 3);
  const [lx, lz] = spin(1, 0, turn), [bx, bz] = spin(5, 2, turn);
  const branch: Limb = { a: [lx * .5, H * .55, lz * .5], b: [bx, H * .55 + 3, bz], r0: 1.1, r1: .75 };
  const shelves = [{ a: turn + d(1.5, 2.5), y: Math.floor(H * .4), m: MAT.cream }, { a: turn + d(3.5, 4.5), y: Math.floor(H * .62), m: MAT.terracotta }];
  const { grid, anchor } = sculpt([-8, -3, -8], [8, H + 1, 8], (x, y, z) => {
    if (y < -3) return MAT.air;
    const ax = lx * y / H, az = lz * y / H, rr = Math.hypot(x - ax, z - az), a = Math.atan2(z - az, x - ax);
    const r = 2.7 - .5 * clamp(y / H, 0, 1), crown = H - 4 * noise(Math.cos(a) * 1.6 + 3, 0, Math.sin(a) * 1.6 + 3, seed + 71) - hash(Math.floor(x), 0, Math.floor(z), seed + 72);
    for (const s of shelves) if (Math.floor(y) === s.y && gap(a, s.a) < .45 && rr < r + 1.5 && rr >= r - .5) return s.m;
    const inTrunk = rr < r && y < crown, hollow = rr < r - 1.25 && y > H - 6;
    if (inTrunk && !hollow) {
      if (y > crown - 1.5) return hash(Math.floor(x), Math.floor(y), Math.floor(z), seed + 73) < .4 ? MAT.cream : MAT.timber;
      return oakBark(x, y, z, ax, az, seed);
    }
    const b = limb(x, y, z, branch);
    if (b.d < 0) return Math.hypot(x - bx, z - bz) < 1.2 && y > branch.b[1] - 1 ? MAT.timber : oakBark(x, y, z, b.qx, b.qz, seed);
    if (flare(x, y, z, 2.6, lobes, 5)) return oakBark(x, y, z, 0, 0, seed);
    return MAT.air;
  });
  // Moss settles on every upward face of the broken crown, the limb and the roots, heavier toward −Z.
  grid.each((x, y, z, m) => {
    if ((m !== MAT.bark && m !== MAT.timber) || grid.get(x, y + 1, z) !== MAT.air) return;
    if (noise(x / 2, y / 2, z / 2, seed + 75) > .38 + (z - anchor[2]) * .03) grid.set(x, y, z, MAT.moss);
  });
  return finish(`campfire.tree.4.s${seed}`, grid, anchor, { occlude: (g, a) => bounds(g, a, m => m !== MAT.cream && m !== MAT.terracotta) });
}

/** Wilds trees: 0 and 1 broad oaks, 2 a tall tiered fir, 3 a young birch, 4 a dead mossy snag. */
export function createTree(variant: 0 | 1 | 2 | 3 | 4, seed: number): CampfireProp {
  switch (variant) {
    case 0: return oak(seed, false);
    case 1: return oak(seed, true);
    case 2: return fir(seed);
    case 3: return birch(seed);
    case 4: return snag(seed);
  }
}

/**
 * A mossy boulder: a soft superellipsoid with slow lumps, a slight lean and a shoulder on the largest; tilted
 * bands of stone, dark stone and limestone; moss over the top and down the shaded side; a pebble or two.
 */
export function createRock(variant: 0 | 1 | 2, seed: number): CampfireProp {
  const d = draws(seed, 70 + variant), [w, h] = ([[4.6, 3.4], [7.6, 5.6], [11, 7.6]] as const)[variant], turn = d(0, TAU), lean = d(-.12, .12);
  const lobes: Blob[] = [{ c: [0, h * .38, 0], r: [w / 2 * d(.92, 1.08), h * .62, w / 2 * d(.75, .92)] }];
  if (variant === 2) lobes.push({ c: [w * .34, h * .24, w * .16], r: [w * .3, h * .42, w * .28] });
  if (variant >= 1) lobes.push({ c: [-w * .22, h * .16, -w * .12], r: [w * .28, h * .34, w * .3] });
  const reach = w * .75 + 2, tilt = d(-.3, .3);
  const { grid, anchor } = sculpt([-reach, -2, -reach], [reach, h * 1.2, reach], (x, y, z) => {
    const [px, pz] = spin(x, z, -turn), lump = .16 * (noise(x / 2.6, y / 2.6, z / 2.6, seed + 81) * 2 - 1) + .05 * (noise(x / 1.2, y / 1.2, z / 1.2, seed + 82) * 2 - 1);
    if (y < -2) return MAT.air;
    for (const b of lobes) {
      const dx = (px - lean * (y - b.c[1]) - b.c[0]) / b.r[0], dy = (y - b.c[1]) / b.r[1], dz = (pz - b.c[2]) / b.r[2];
      if ((Math.abs(dx) ** 2.15 + Math.abs(dy) ** 2.15 + Math.abs(dz) ** 2.15) ** (1 / 2.15) > 1 + lump) continue;
      const band = noise(px / 10, y / 1.7 + px * tilt * .25, pz / 10, seed + 83), fleck = hash(Math.floor(x), Math.floor(y), Math.floor(z), seed + 84);
      const m = band < .36 ? MAT.darkStone : band > .68 ? MAT.limestone : MAT.stone;
      return fleck < .12 ? (m === MAT.stone ? (fleck < .06 ? MAT.limestone : MAT.darkStone) : MAT.stone) : m;
    }
    return MAT.air;
  });
  grid.each((x, y, z, m) => {
    if (m === MAT.air || m === MAT.moss) return;
    const ly = y + .5 - anchor[1], n = noise(x / 2.4, y / 2, z / 2.4, seed + 85);
    const up = grid.get(x, y + 1, z) === MAT.air, shade = grid.get(x, y, z - 1) === MAT.air;
    if ((up && ly > h * .5 && n > .42) || (up && n > .66) || (shade && ly > h * .25 && n > .62)) grid.set(x, y, z, MAT.moss);
  });
  // A pebble or two that broke away, each pressed a cell into the ground.
  const gy = anchor[1];
  for (let i = 0, k = 1 + variant; i < k; i++) {
    const a = d(0, TAU), r = w / 2 + d(.8, 1.8), x = Math.floor(anchor[0] + Math.cos(a) * r), z = Math.floor(anchor[2] + Math.sin(a) * r);
    if (grid.get(x, gy, z) !== MAT.air) continue;
    const m = pick([MAT.stone, MAT.darkStone, MAT.limestone], d());
    grid.set(x, gy, z, m); grid.set(x, gy - 1, z, m);
  }
  return finish(`campfire.rock.${variant}.s${seed}`, grid, anchor, { occlude: (g, a) => bounds(g, a) });
}

/* ---------- Undergrowth ---------- */

/** Small clumps for the forest floor, each pressed a cell into the ground; none of them blocks light. */
export function createUndergrowth(kind: 'fern' | 'grass' | 'flowers' | 'mushrooms', seed: number): CampfireProp {
  const d = draws(seed, 90 + ['fern', 'grass', 'flowers', 'mushrooms'].indexOf(kind)), g = 1, c = 2, grid = new Grid(5, 6, 5);
  const put = (x: number, y: number, z: number, m: number) => { grid.set(x, y, z, m); if (y === g) grid.set(x, g - 1, z, m); };
  if (kind === 'fern') {
    put(c, g, c, MAT.leaf); put(c, g + 1, c, MAT.leaf); grid.set(c, g + 2, c, d() < .5 ? MAT.moss : MAT.leaf);
    const k = 5 + (d() < .5 ? 1 : 0), turn = d(0, TAU);
    for (let i = 0; i < k; i++) {
      const a = turn + (i + d(-.3, .3)) * TAU / k, tall = d() < .35, at = (t: number) => [c + Math.round(Math.cos(a) * t), c + Math.round(Math.sin(a) * t)] as const;
      const [x1, z1] = at(1), [x2, z2] = at(2), [px, pz] = [Math.round(-Math.sin(a)), Math.round(Math.cos(a))];
      grid.set(x1, g + 1, z1, MAT.leaf);
      grid.set(x2, g + (tall ? 2 : 1), z2, d() < .6 ? MAT.moss : MAT.leaf);
      if (tall) grid.set(x2, g + 1, z2, MAT.leaf);
      if (grid.get(x1 + px, g, z1 + pz) === MAT.air) put(x1 + px, g, z1 + pz, MAT.moss);
      if (d() < .5 && grid.get(x1 - px, g, z1 - pz) === MAT.air) put(x1 - px, g, z1 - pz, MAT.leaf);
    }
  } else if (kind === 'grass') {
    for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) {
      const r = Math.hypot(x - c, z - c);
      if (hash(x, 0, z, seed + 91) > (1 - r / 2.7) * .95) continue;
      const tall = 2 + Math.floor(hash(x, 1, z, seed + 92) * (r < 1.2 ? 3 : 2)), dry = hash(x, 2, z, seed + 93) < .4;
      for (let y = g; y < g + tall; y++) put(x, y, z, y === g ? MAT.grass : y === g + tall - 1 ? (dry ? MAT.thatch : MAT.moss) : hash(x, y, z, seed) < .5 ? MAT.moss : MAT.grass);
      if (tall >= 3 && r > .5 && hash(x, 3, z, seed + 94) < .5) {
        const sx = x + Math.sign(x - c), sz = z + Math.sign(z - c), top = g + tall - 1;
        if (grid.has(sx, top, sz)) { grid.set(sx, top, sz, grid.get(x, top, z)); grid.set(x, top, z, MAT.air); }
      }
    }
  } else if (kind === 'flowers') {
    const palette = [MAT.petal, MAT.blueFlower, MAT.cream] as const, main = pick(palette, d()), accent = pick(palette.filter(m => m !== main), d());
    for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) {
      const r = Math.hypot(x - c, z - c);
      if (hash(x, 5, z, seed) < 1.1 - r / 2.4) put(x, g, z, hash(x, 6, z, seed) < .6 ? MAT.grass : MAT.leaf);
      if (r < 1 && hash(x, 8, z, seed) < .6) grid.set(x, g + 1, z, MAT.leaf);
    }
    const k = 4 + Math.floor(d(0, 3)), spots = [[0, 1], [1, 0], [3, 0], [4, 2], [3, 4], [1, 4], [2, 2], [0, 3], [4, 0]] as const, start = Math.floor(d(0, spots.length));
    for (let i = 0; i < k; i++) {
      const [x, z] = spots[(start + i * 2) % spots.length]!, tall = 1 + Math.floor(d(0, 2)) + (Math.hypot(x - c, z - c) < 1 ? 1 : 0), head = g + tall;
      for (let y = g; y < head; y++) put(x, y, z, MAT.grass);
      const bloom = i % 3 === 2 ? accent : main;
      grid.set(x, head, z, bloom);
      if (bloom === MAT.blueFlower && tall === 1) grid.set(x, head + 1, z, bloom);
    }
  } else {
    const turn = d(0, TAU), cap = () => d() < .55 ? MAT.terracotta : MAT.fabricMutedRed, big = cap(), crown = d() < .55;
    put(c, g, c, MAT.cream); grid.set(c, g + 1, c, MAT.cream);
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) grid.set(c + dx, g + 2, c + dz, hash(dx, 7, dz, seed) < .2 ? MAT.cream : big);
    if (crown) grid.set(c, g + 3, c, d() < .5 ? MAT.cream : big);
    for (let i = 0, k = 2 + Math.floor(d(0, 2)); i < k; i++) {
      const a = turn + i * TAU / k + d(-.4, .4), x = clamp(c + Math.round(Math.cos(a) * 2), 0, 4), z = clamp(c + Math.round(Math.sin(a) * 2), 0, 4);
      const stem = d() < .4 ? 2 : 1;
      put(x, g, z, MAT.cream); if (stem === 2) grid.set(x, g + 1, z, MAT.cream);
      grid.set(x, g + stem, z, cap());
    }
    if (d() < .7) put(c + 1, g, c + 1, MAT.moss);
  }
  return finish(`campfire.${kind}.s${seed}`, grid, [c + .5, g, c + .5]);
}

/* ---------- The clearing floor ---------- */

/**
 * The clearing floor, three cells thick with its top at ground level. Grass with moss and leaf patches; a worn
 * earth ring where people sit, fading irregularly into grass; a dark trampled hearth patch; a meandering
 * footpath out along `path.direction` with pebbles at its edges; an irregular rim. Inside four metres the top
 * stays perfectly flat; beyond it, a few one-cell mounds and raised tufts break the plane.
 */
export function createClearingGround(options: { radius: number; path: { direction: number; width: number }; hearthRadius: number; seed: number }): CampfireProp {
  const { radius, hearthRadius, seed } = options, { direction, width } = options.path, d = draws(seed, 100);
  const half = Math.ceil((radius + .7) / M) + 1, sx = Math.sin(direction), sz = Math.cos(direction), phase = d(0, TAU), bend = d(.5, .85) * (d() < .5 ? -1 : 1);
  let column = { cx: NaN, cz: NaN, r: 0, rim: 0, k: 0, patch: 0, patch2: 0, warp: 0, onPath: false, pathEdge: false };
  const columnAt = (cx: number, cz: number) => {
    if (column.cx === cx && column.cz === cz) return column;
    const x = cx * M, z = cz * M, r = Math.hypot(x, z), a = Math.atan2(z, x), ca = Math.cos(a), sa = Math.sin(a);
    const rim = radius + .45 * (noise(ca * 3 + 9, 0, sa * 3 + 9, seed + 1) * 2 - 1) + .15 * (noise(ca * 9 + 3, 0, sa * 9 + 3, seed + 2) * 2 - 1);
    const s = x * sx + z * sz, t = x * sz - z * sx;
    const offset = bend * Math.sin(s * .42 + phase) * smoothstep(2.4, 5.5, s), hw = width / 2 * (1 + .25 * (noise(s / 1.1, 7, 0, seed + 5) * 2 - 1)) + .3 * (1 - smoothstep(2.8, 4.2, s));
    const across = Math.abs(t - offset), onPath = s > 2.6 && across < hw;
    column = { cx, cz, r, rim, k: hash(Math.floor(cx), 0, Math.floor(cz), seed), patch: noise(x / 1.3, 0, z / 1.3, seed + 3), patch2: noise(x / .7, 5, z / .7, seed + 4), warp: noise(x / 2.2, 9, z / 2.2, seed + 8), onPath, pathEdge: s > 2.6 && !onPath && across < hw + .22 };
    return column;
  };
  const { grid, anchor } = sculpt([-half, -3, -half], [half, 1, half], (cx, cy, cz) => {
    const { r, rim, k, patch, patch2, warp, onPath, pathEdge } = columnAt(cx, cz), x = cx * M, z = cz * M;
    if (r > rim) return MAT.air;
    if (cy < -1) return patch2 < .3 ? MAT.darkStone : MAT.earth;
    if (cy > 0) {
      if (r < 4.2 || onPath || pathEdge || r > rim - .3) return MAT.air;
      const mound = noise(x / 1.6, 3, z / 1.6, seed + 6) > .79 && noise(x / .6, 4, z / .6, seed + 7) > .3;
      if (mound) return patch > .55 ? MAT.moss : MAT.grass;
      return k < .004 ? (patch > .5 ? MAT.moss : MAT.grass) : MAT.air;
    }
    // The hearth patch: packed earth darkened with spilt ash, thinning toward its edge.
    const hearth = r / hearthRadius + .35 * (warp - .5) + .15 * (patch2 - .5);
    if (hearth < 1) return k < .45 * (1.15 - hearth) + .1 * patch2 ? MAT.darkStone : MAT.earth;
    if (onPath) return k < .08 ? MAT.moss : k < .12 ? MAT.paving : MAT.earth;
    if (pathEdge) return k < .45 ? MAT.paving : k < .72 ? MAT.moss : MAT.earth;
    // Worn ground: bare where the seats stand, recovering in patches toward the fire, fraying out into grass.
    const out = r + 1.5 * (warp - .5) + .5 * (patch - .5);
    const worn = (1 - smoothstep(2.9, 4, out)) * (r < 1.9 ? .55 + .7 * (patch - .5) + .25 * smoothstep(hearthRadius, 1.9, r) : 1);
    if (worn > .42 + k * .35) return MAT.earth;
    if (worn > .18 + k * .3) return k < .55 ? MAT.moss : MAT.earth;
    const shade = smoothstep(rim - 1.6, rim, r);
    if (patch > .64 - .1 * shade) return patch2 > .7 && k < .3 ? MAT.leaf : MAT.moss;
    return k < .015 + .15 * shade * patch2 ? MAT.leaf : MAT.grass;
  });
  return finish(`campfire.ground.r${Math.round(radius * 10)}.s${seed}`, grid, anchor, { flush: false });
}
