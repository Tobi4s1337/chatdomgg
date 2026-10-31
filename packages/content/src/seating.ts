import { VOXEL_METRES, type Vec3, type VoxelAsset, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from './materials';

const M = VOXEL_METRES.build;
export interface SeatLogProp {
  readonly asset: VoxelAsset;
  readonly anchor: Vec3;
  readonly occluders: readonly { readonly min: Vec3; readonly max: Vec3 }[];
}
type CampfireProp = SeatLogProp;
type Occluder = CampfireProp['occluders'][number];
type V3 = [number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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

/**
 * A felled log along X with an adzed seat. The section is four cells with chamfered corners; the middle of the
 * top course is adzed away so the next course, bark lips either side of bare timber, is the flat seat. The ends
 * keep their round crown, the root end runs a little fuller, and a knot, a branch stub and moss on the back
 * shoulder break the line. Long logs carry one gentle crook. The anchor sits so the seat is exactly `seatTop`.
 */
export function createSeatLog(options: { length: number; seatTop: number; seed: number }): CampfireProp & { readonly seatTop: number } {
  const { seed } = options, seatTop = clamp(options.seatTop, 0.1, 0.3), d = draws(seed, 1);
  const n = clamp(Math.round(clamp(options.length, 0.6, 2.6) / M), 5, 21), grid = new Grid(n, 6, 10);
  const butt = d() < .5 ? 0 : n - 1, fullEnd = (x: number) => Math.abs(x - butt) <= 1;
  const crown = [1 + (n >= 9 && d() < .45 ? 1 : 0), 1 + (n >= 11 && d() < .35 ? 1 : 0)] as const;
  const inStrip = (x: number) => x >= crown[0] && x < n - crown[1];
  const crook = n >= 14 && d() < .7 ? { at: Math.round(n * d(.3, .7)), dz: d() < .5 ? -1 : 1 } : undefined;
  const zcOf = (x: number) => 5 + (crook && x >= crook.at ? crook.dz : 0);
  const pith = [d() < .5 ? 1 : 2, d() < .5 ? -1 : 0] as const;
  for (let x = 0; x < n; x++) {
    const zc = zcOf(x), r = fullEnd(x) ? 2.3 : 2.0;
    for (let y = 0; y < 4; y++) for (let z = zc - 2; z < zc + 2; z++) {
      const oy = y + .5 - 2, oz = z + .5 - zc;
      if (oy * oy + oz * oz > r * r || (y === 3 && inStrip(x))) continue;
      let m: number = MAT.bark;
      if (x === 0 || x === n - 1) m = Math.abs(oy) < 1 && Math.abs(oz) < 1 ? (y === pith[0] && z === zc + pith[1] ? MAT.timber : MAT.cream) : MAT.bark;
      else if (y === 2 && inStrip(x) && Math.abs(oz) < 1) m = hash(Math.floor((x + z * 3) / 2), z, 11, seed) < .2 ? MAT.cream : MAT.timber;
      else if (hash(Math.floor((x + Math.floor(hash(y, z, 3, seed) * 4)) / (2 + Math.floor(hash(y, z, 4, seed) * 3))), y, z, seed) < .16) m = MAT.timber;
      grid.set(x, y, z, m);
    }
  }
  // The root end swells: a buttress on one flank and a burr on its crown.
  const bz = zcOf(butt);
  grid.set(butt, 4, bz - (d() < .5 ? 1 : 0), MAT.bark);
  grid.set(butt, 1 + (d() < .5 ? 1 : 0), d() < .5 ? bz - 3 : bz + 2, MAT.bark);
  // A knot on the front flank and a cut branch stub rising off the back.
  const free = (lo: number, hi: number) => Math.round(d(Math.max(1, lo), Math.max(1, hi)));
  const knot = free(crown[0] + 1, n - crown[1] - 2), kz = zcOf(knot);
  grid.set(knot, 1, kz + 1, MAT.timber); grid.set(knot, 1, kz + 2, MAT.bark); if (zcOf(knot + 1) === kz) grid.set(knot + 1, 1, kz + 2, MAT.bark);
  if (n >= 7) {
    let stub = free(crown[0] + 1, n - crown[1] - 2);
    if (stub === knot) stub = stub + 1 < n - 1 ? stub + 1 : stub - 1;
    const sz = zcOf(stub);
    grid.set(stub, 2, sz - 3, MAT.bark); grid.set(stub, 3, sz - 3, MAT.bark); grid.set(stub, 3, sz - 4, MAT.timber);
  }
  // Moss gathers on the back shoulder and the crowns, and drips a cell down where it is thickest.
  grid.each((x, y, z, m) => {
    if (m !== MAT.bark || z >= zcOf(x) || y < 2 || grid.get(x, y + 1, z) !== MAT.air) return;
    const moss = noise(x / 1.7, y * 1.3, z * 1.3, seed + 9) * .8 + hash(x, y, z, seed + 10) * .2;
    if (moss > .56) { grid.set(x, y, z, MAT.moss); if (moss > .68 && grid.get(x, y - 1, z) === MAT.bark) grid.set(x, y - 1, z, MAT.moss); }
  });
  let zSum = 0;
  for (let x = 0; x < n; x++) zSum += zcOf(x);
  const prop = finish(`campfire.log.${n}.s${seed}`, grid, [n / 2, 3 - seatTop / M, zSum / n], { occlude: bounds });
  return { ...prop, seatTop };
}


const MARKET_OPTIONS = { length: 2.25, seatTop: .25, seed: 317 } as const;
/** Ground pivot in the cropped asset's build cells. */
export const MARKET_SEAT_LOG_GROUND: Vec3 = createSeatLog(MARKET_OPTIONS).anchor;

/** The same authored seat, encoded as non-overlapping runs on the build lattice. */
export function createMarketSeatLog(): VoxelBlueprint {
  const { asset, anchor } = createSeatLog(MARKET_OPTIONS);
  const [sx, sy, sz] = asset.size;
  const boxes: VoxelBlueprint['boxes'] = [];
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) {
    for (let x = 0; x < sx;) {
      const material = asset.voxels[x + sx * (y + sy * z)]!;
      let end = x + 1;
      while (end < sx && asset.voxels[end + sx * (y + sy * z)] === material) end++;
      if (material !== MAT.air) boxes.push({ from: [x, y, z], to: [end, y + 1, z + 1], material });
      x = end;
    }
  }
  const seats = ([-4, 4] as const).map((offset, i) => ({
    id: i === 0 ? 'left' : 'right',
    position: [anchor[0] + offset, anchor[1] + 2, anchor[2]] as [number, number, number],
    approach: [anchor[0] + offset, anchor[1], anchor[2] + 9] as [number, number, number],
    rest: [anchor[0] + offset, anchor[1], anchor[2] + 2] as [number, number, number],
    facing: 0,
  }));
  return { version: 1, id: 'civic-market-seat-log-v1', styleId: STYLES.hearth.id, kind: 'civic', lattice: 'build',
    size: [sx, sy, sz], boxes, windows: [], seats };
}
