import { VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { WALK_BODY } from '@chatdom/shared/realm';
import { MAT, STYLES } from '../materials';
import { createSeatLog } from '../seating';

/*
 * The kingdom's campfire clearing as one founded civic piece on the build lattice. Founded placements only take
 * cardinal turns, so the ring is authored square: four straight seat logs on the sides of a square round a low stone
 * hearth, the Magistrate's carved chair across the fire from the footpath, open corners and a footpath gap.
 *
 * Clearing frame: metres, the hearth centre on the ground at the origin, +Y up, +Z toward the footpath (the town and
 * the stream camera's side). Headings are radians about +Y, zero faces +Z.
 */

const M = VOXEL_METRES.build;
const TAU = Math.PI * 2;

export const CAMPFIRE_CLEARING_ID = 'campfire:clearing:v1';
export const CAMPFIRE_SITE = 'clearing';
/** The one seat height of the clearing: the shared seat log's adzed top, the common seated pose's datum. */
export const CAMPFIRE_SEAT_TOP = .25;

type XZ = readonly [number, number];
export interface CampfireClearingSeat {
  readonly seat: number;
  readonly kind: 'player' | 'magistrate';
  /** The seated root on the seat's surface line, clearing frame, metres. */
  readonly hip: XZ;
  readonly heading: number;
  /** Standing waypoints from the footpath gap to the spot in front of the seat; the last is where the sitter stands. */
  readonly approach: readonly XZ[];
  /** Where the client draws this sitter's game lantern on the ground beside the shins. */
  readonly lantern: XZ;
}
export interface CampfireClearing {
  readonly blueprint: VoxelBlueprint;
  /** The hearth centre on the ground plane, in the blueprint's build cells. */
  readonly pivot: Vec3;
  readonly seatTop: number;
  /** Walkable extent from the hearth in metres: every authored piece, the corridors and a lane round the logs. */
  readonly radius: number;
  readonly seats: readonly CampfireClearingSeat[];
}

/* ---------- The hand's variation: hashed, never Math.random ---------- */

function hash(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ Math.imul(seed | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t), fx = s(x - ix), fy = s(y - iy), fz = s(z - iz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t, c = (dx: number, dy: number, dz: number) => hash(ix + dx, iy + dy, iz + dz, seed);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy), l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}
function draws(seed: number, salt: number) {
  let i = 0;
  return (lo = 0, hi = 1) => lo + (hi - lo) * hash(i++, salt, 0x51ed, seed);
}
const pick = <T>(list: readonly T[], t: number): T => list[Math.min(list.length - 1, Math.floor(t * list.length))]!;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/* ---------- The working grid: cells about the hearth, row 0 the first above the ground ---------- */

const HALF = 32;
const SINK = 2;
const TALL = 12;

class Clearing {
  readonly sx = HALF * 2; readonly sy = SINK + TALL; readonly sz = HALF * 2;
  readonly voxels = new Uint16Array(this.sx * this.sy * this.sz);
  private index(i: number, j: number, k: number): number {
    const x = i + HALF, y = j + SINK, z = k + HALF;
    return x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz ? -1 : x + this.sx * (y + this.sy * z);
  }
  get(i: number, j: number, k: number): number { const n = this.index(i, j, k); return n < 0 ? MAT.air : this.voxels[n]!; }
  set(i: number, j: number, k: number, m: number): void {
    const n = this.index(i, j, k);
    if (n < 0) throw new Error(`The campfire clearing has no cell at ${i},${j},${k}.`);
    this.voxels[n] = m;
  }
  /** Set only where nothing stands yet, so dressing never cuts into a seat. */
  add(i: number, j: number, k: number, m: number): void { if (this.get(i, j, k) === MAT.air) this.set(i, j, k, m); }
  /** Any solid above the ground in the vertical column band of this footprint (metres, clearing frame). */
  solidUnder(minX: number, maxX: number, minZ: number, maxZ: number): boolean {
    for (let k = Math.floor(minZ / M); k < Math.ceil(maxZ / M); k++) for (let i = Math.floor(minX / M); i < Math.ceil(maxX / M); i++)
      for (let j = 0; j < TALL; j++) if (this.get(i, j, k) !== MAT.air) return true;
    return false;
  }
  /** Sample a shape over cell centres, local cell units about the hearth. */
  sculpt(lo: Vec3, hi: Vec3, at: (x: number, y: number, z: number) => number, centre: XZ = [0, 0]): void {
    for (let k = Math.floor(lo[2]); k < Math.ceil(hi[2]); k++) for (let i = Math.floor(lo[0]); i < Math.ceil(hi[0]); i++)
      for (let j = Math.floor(lo[1]); j < Math.ceil(hi[1]); j++) {
        const m = at(i + .5, j + .5, k + .5);
        if (m !== MAT.air) this.add(i + centre[0], j, k + centre[1], m);
      }
  }
}

/* ---------- Seat logs: the shared seat log, turned on the lattice ---------- */

/** Unit vectors of a cardinal turn, matching transformCardinalPoint: local +X (along) and +Z (the sitter's front). */
const ALONG: Record<0 | 1 | 2 | 3, XZ> = { 0: [1, 0], 1: [0, -1], 2: [-1, 0], 3: [0, 1] };
const FRONT: Record<0 | 1 | 2 | 3, XZ> = { 0: [0, 1], 1: [1, 0], 2: [0, -1], 3: [-1, 0] };

/** A continuous point of an asset footprint `sx`×`sz` in the frame of the turned footprint. */
function turned(turn: 0 | 1 | 2 | 3, sx: number, sz: number, x: number, z: number): [number, number] {
  return turn === 0 ? [x, z] : turn === 1 ? [z, sx - x] : turn === 2 ? [sx - x, sz - z] : [sz - z, x];
}

interface LogSpec {
  /** Length in build cells (the shared log takes 5..21). */
  readonly cells: number; readonly seed: number; readonly turn: 0 | 1 | 2 | 3;
  /** The midpoint of the seat line, metres. */
  readonly centre: XZ;
  /** Seat offsets along the log, metres from its middle, in the log's own +X. */
  readonly seats: readonly number[];
  /** Which way along the log (its own ±X) each sitter's lantern stands: never out into a corner someone walks in by. */
  readonly lanterns: readonly (1 | -1)[];
}

/**
 * Ten seats: three down each flank, two each side of the footpath gap. Straight cardinal logs, open corners. Flank
 * lanterns stand toward the back, where the corners are wide; on the path logs they stand between the sitters and
 * at the gap's edge.
 */
const LINE = 2.5;
const PATH_GAP = .625;
const LOGS: readonly LogSpec[] = [
  { cells: 21, seed: 1103, turn: 1, centre: [-LINE, 0], seats: [-.8, 0, .8], lanterns: [1, 1, 1] },
  { cells: 20, seed: 2207, turn: 3, centre: [LINE, .0625], seats: [-.8, 0, .8], lanterns: [-1, -1, -1] },
  { cells: 14, seed: 4409, turn: 2, centre: [-(PATH_GAP + 7 * M), LINE], seats: [-.4, .4], lanterns: [-1, -1] },
  { cells: 15, seed: 3301, turn: 2, centre: [PATH_GAP + 7.5 * M, LINE + M], seats: [-.4, .4], lanterns: [1, 1] },
];
const HIP_FORWARD = .05;
const LANTERN_FORWARD = .3;
const LANTERN_SIDE = .42;
/** The corridor's walking line round the hearth: clear of the stones and the sitters' feet by a body each side. */
const RING = 1.45;
/** Body clearance used for every standing spot and route the clearing authors. */
const CLEAR = WALK_BODY.radius + .05;

interface PlacedSeat { hip: XZ; inward: XZ; along: XZ; lanternSide: number; kind: 'player' | 'magistrate' }

function placeLog(grid: Clearing, spec: LogSpec): PlacedSeat[] {
  const log = createSeatLog({ length: spec.cells * M, seatTop: CAMPFIRE_SEAT_TOP, seed: spec.seed });
  const { asset, anchor } = log, [sx, sy, sz] = asset.size, ground = anchor[1], row = ground + Math.round(CAMPFIRE_SEAT_TOP / M) - 1;
  const at = (x: number, y: number, z: number) => y < 0 || y >= sy ? MAT.air : asset.voxels[x + sx * (y + sy * z)]!;
  // The adzed seat in each column: solid at the seat course with open air above it.
  const strip = (x: number): number | undefined => {
    let lo = Infinity, hi = -Infinity;
    for (let z = 0; z < sz; z++) if (at(x, row, z) !== MAT.air && at(x, row + 1, z) === MAT.air) { lo = Math.min(lo, z); hi = Math.max(hi, z + 1); }
    return lo === Infinity ? undefined : (lo + hi) / 2;
  };
  const counts = new Map<number, number>();
  for (let x = 0; x < sx; x++) { const s = strip(x); if (s !== undefined) counts.set(s, (counts.get(s) ?? 0) + 1); }
  const line = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
  const [rx, rz] = turned(spec.turn, sx, sz, sx / 2, line);
  const ox = Math.round(spec.centre[0] / M - rx), oz = Math.round(spec.centre[1] / M - rz);
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const m = at(x, y, z);
    if (m === MAT.air) continue;
    const [cx, cz] = turned(spec.turn, sx, sz, x + .5, z + .5);
    grid.set(Math.floor(cx) + ox, y - ground, Math.floor(cz) + oz, m);
  }
  const toMetres = (x: number, z: number): XZ => { const [cx, cz] = turned(spec.turn, sx, sz, x, z); return [(cx + ox) * M, (cz + oz) * M]; };
  return spec.seats.map((offset, n) => {
    const x = sx / 2 + offset / M, column = Math.min(sx - 1, Math.max(0, Math.floor(x)));
    const z = strip(column);
    if (z === undefined) throw new Error(`Seat log ${spec.seed} has no seat under offset ${offset}.`);
    return { hip: toMetres(x, z + HIP_FORWARD / M), inward: FRONT[spec.turn], along: ALONG[spec.turn], lanternSide: spec.lanterns[n]!, kind: 'player' as const };
  });
}

/* ---------- The hearth: a low ring of stones, an ash bed and a small crib ---------- */

/** Ten to twelve rounded stones sunk a cell and sooted inside, a glowing ash bed and a log-cabin crib, all below the knee. */
function hearth(grid: Clearing, seed: number): void {
  const d = draws(seed, 3), count = 10 + Math.floor(d(0, 3)), turn = d(0, TAU);
  const shades = [MAT.stone, MAT.limestone, MAT.darkStone] as const;
  const stones = Array.from({ length: count }, (_, i) => ({
    a: turn + (i + d(-.16, .16)) * TAU / count, rho: d(4.55, 4.95), u: d(1.15, 1.5), v: d(.95, 1.2), h: d(1.5, 2.3), tilt: d(-.25, .25), m: pick(shades, d()),
  }));
  // The crib's courses run along the lattice: two sticks a course, crossed, the top course short.
  const stick = (x: number, y: number, z: number) => {
    const run = (axis: number, across: number, lo: number, hi: number) => Math.abs(across) === 1.5 && axis >= lo && axis <= hi;
    const j = (k: number) => Math.round(hash(k, 1, 2, seed) * 1.4 - .4);
    if (y === .5 && run(x, z, -2.5 - j(1) + (z > 0 ? j(2) : 0), 2.5 + j(3))) return x;
    if (y === 1.5 && run(z, x, -2.5 - j(4), 2.5 + j(5) - (x > 0 ? j(6) : 0))) return z;
    if (y === 2.5 && run(x, z, -1.5 - (z > 0 ? 0 : j(7)), 1.5 + (z > 0 ? j(8) : 0))) return x;
    return undefined;
  };
  grid.sculpt([-7, -1, -7], [7, 4, 7], (x, y, z) => {
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
    const along = stick(x, y, z);
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
}

/* ---------- The Magistrate's chair ---------- */

/**
 * A low carved fireside chair at the clearing's one seat height, clearly the best seat: square legs sunk a cell, a
 * notched apron, a red cushion inset flush in the seat frame, arms on spindles ending in pale carved knobs, a tall
 * back with a pale inlaid splat and two pierced lights, a stepped crest with a gold finial, and a red cloth with a
 * muted gold hem thrown over the crest, short in front and long behind, held by two brass bosses. The sitter faces +Z.
 * `ox`, `oz`: the chair's corner cell. Returns the hip in metres.
 */
function magistrateChair(grid: Clearing, ox: number, oz: number, seed: number): XZ {
  const d = draws(seed, 2), W = 8, BACK = 1, FRONT_ROW = 6;
  const put = (x: number, j: number, z: number, m: number) => grid.set(ox + x, j, oz + z, m);
  for (const x of [0, W - 1]) for (const z of [BACK, FRONT_ROW]) { put(x, -1, z, MAT.timber); put(x, 0, z, MAT.timber); }
  for (let x = 1; x < W - 1; x++) if (x !== 3 && x !== 4) put(x, 0, FRONT_ROW, MAT.timber);
  for (const x of [0, W - 1]) for (let z = BACK + 1; z < FRONT_ROW; z++) if (z !== 3) put(x, 0, z, MAT.bark);
  for (let z = BACK; z <= FRONT_ROW; z++) for (let x = 0; x < W; x++) {
    const cushion = x >= 1 && x <= W - 2 && z >= BACK + 1 && z <= FRONT_ROW - 1;
    put(x, 1, z, cushion ? (z === FRONT_ROW - 1 && (x === 1 || x === W - 2) ? MAT.fabricMutedGold : MAT.fabricRed) : MAT.timber);
  }
  for (const x of [0, W - 1]) {
    put(x, 2, FRONT_ROW, MAT.timber); put(x, 3, FRONT_ROW, MAT.timber); put(x, 4, FRONT_ROW, MAT.cream);
    put(x, 2, 3, MAT.timber);
    for (let z = BACK; z < FRONT_ROW; z++) put(x, 3, z, MAT.timber);
  }
  // The back: a board to the shoulders, a stepped crest and a finial.
  for (let j = 2; j <= 7; j++) for (let x = 0; x < W; x++) put(x, j, BACK, x === 0 || x === W - 1 ? MAT.bark : MAT.timber);
  for (let x = 1; x < W - 1; x++) put(x, 8, BACK, MAT.timber);
  for (let x = 2; x < W - 2; x++) put(x, 9, BACK, MAT.timber);
  put(3, 10, BACK, MAT.goldLeaf); put(4, 10, BACK, MAT.goldLeaf);
  for (let j = 3; j <= 6; j++) { put(3, j, BACK, MAT.cream); put(4, j, BACK, MAT.cream); }
  put(2, 5, BACK, MAT.air); put(5, 5, BACK, MAT.air);
  // The cloth over the crest, with its hem ragged by a cell either side behind.
  for (let x = 2; x < W - 2; x++) {
    put(x, 9, BACK, MAT.fabricRed);
    put(x, 8, BACK + 1, MAT.fabricMutedGold);
    const hem = 4 + (x === 2 || x === W - 3 ? 1 : 0) + (d() < .5 ? 1 : 0);
    for (let j = hem; j <= 8; j++) put(x, j, BACK - 1, j === hem ? MAT.fabricMutedGold : MAT.fabricRed);
  }
  put(1, 8, BACK, MAT.fabricRed); put(W - 2, 8, BACK, MAT.fabricRed);
  put(1, 6, BACK + 1, MAT.brass); put(W - 2, 6, BACK + 1, MAT.brass);
  return [(ox + W / 2) * M, (oz + BACK + 2.6) * M];
}

/* ---------- Dressing outside the walking routes ---------- */

/** A sawn chopping stump with its rings on top, moss low on its shaded side, and a felling axe bitten into it. */
function stump(grid: Clearing, cx: number, cz: number, seed: number): void {
  const d = draws(seed, 7), height = 3, lobes = Array.from({ length: 4 }, (_, i) => ({ a: d(0, TAU) + i * TAU / 4, reach: d(.3, .8) }));
  grid.sculpt([-4, -1, -4], [4, height, 4], (x, y, z) => {
    const r = Math.hypot(x, z), a = Math.atan2(z, x), low = y < 1;
    let edge = 2.4 + .25 * (noise(Math.cos(a) * 2 + 3, 0, Math.sin(a) * 2 + 3, seed) * 2 - 1);
    if (low) for (const lobe of lobes) edge += lobe.reach * Math.max(0, 1 - Math.abs(wrap(a - lobe.a)) / .6);
    if (r > edge) return MAT.air;
    if (y > height - 1 && r < edge - .7) { const ring = r + .4 * (noise(x, 1, z, seed + 2) - .5); return ring > .9 && ring < 1.5 ? MAT.cream : MAT.timber; }
    if (z < -1 && noise(x / 1.5, y, z / 1.5, seed + 3) > .5) return MAT.moss;
    return hash(Math.floor(a * 3), Math.floor(y), 0, seed) < .2 ? MAT.timber : MAT.bark;
  }, [cx, cz]);
  // The axe: its head bitten into the crown, the haft rising off it at a lean.
  grid.set(cx, height - 1, cz + 1, MAT.darkStone); grid.set(cx, height, cz + 1, MAT.darkStone); grid.set(cx, height, cz, MAT.darkStone);
  grid.set(cx, height + 1, cz + 1, MAT.timber); grid.set(cx, height + 2, cz + 2, MAT.timber); grid.set(cx, height + 3, cz + 2, MAT.timber);
}

/** Split firewood stacked against a log's back: three courses, ends out, pale where the axe went through. */
function woodpile(grid: Clearing, x0: number, z0: number, length: number, seed: number): void {
  const courses = [[0, 1, 2], [0, 1, 2], [1]] as const;
  courses.forEach((columns, j) => {
    for (const c of columns) {
      const shift = Math.round(hash(c, j, 1, seed) * 2) - 1;
      for (let k = 0; k < length; k++) {
        const end = k === 0 || k === length - 1, z = z0 + k + shift;
        const m = end ? (hash(c, j, k, seed + 1) < .5 ? MAT.cream : MAT.timber) : hash(c, j, k >> 1, seed + 2) < .35 ? MAT.timber : MAT.bark;
        grid.add(x0 + c, j, z, m);
      }
    }
  });
  grid.add(x0 + 1, -1, z0 + 1, MAT.bark); grid.add(x0 + 1, -1, z0 + length - 2, MAT.bark);
}

/** A mossy boulder: a soft lumpy superellipsoid, banded stone, moss over its top and shaded side. */
function rock(grid: Clearing, cx: number, cz: number, w: number, h: number, seed: number): void {
  const d = draws(seed, 70), turn = d(0, TAU), lean = d(-.12, .12), reach = w * .75 + 1, tilt = d(-.3, .3);
  const r: Vec3 = [w / 2 * d(.92, 1.08), h * .62, w / 2 * d(.75, .92)];
  const cells: [number, number, number, number][] = [], stone = new Set<number>([MAT.stone, MAT.darkStone, MAT.limestone]);
  grid.sculpt([-reach, -2, -reach], [reach, h * 1.2, reach], (x, y, z) => {
    const px = x * Math.cos(turn) + z * Math.sin(turn), pz = -x * Math.sin(turn) + z * Math.cos(turn);
    const lump = .16 * (noise(x / 2.6, y / 2.6, z / 2.6, seed + 81) * 2 - 1) + .05 * (noise(x / 1.2, y / 1.2, z / 1.2, seed + 82) * 2 - 1);
    const dx = (px - lean * (y - h * .38)) / r[0], dy = (y - h * .38) / r[1], dz = pz / r[2];
    if ((Math.abs(dx) ** 2.15 + Math.abs(dy) ** 2.15 + Math.abs(dz) ** 2.15) ** (1 / 2.15) > 1 + lump) return MAT.air;
    const band = noise(px / 10, y / 1.7 + px * tilt * .25, pz / 10, seed + 83), fleck = hash(Math.floor(x), Math.floor(y), Math.floor(z), seed + 84);
    const m = band < .36 ? MAT.darkStone : band > .68 ? MAT.limestone : MAT.stone;
    cells.push([Math.floor(x) + cx, Math.floor(y), Math.floor(z) + cz, y]);
    return fleck < .12 ? (m === MAT.stone ? (fleck < .06 ? MAT.limestone : MAT.darkStone) : MAT.stone) : m;
  }, [cx, cz]);
  for (const [i, j, k, y] of cells) {
    if (!stone.has(grid.get(i, j, k))) continue;
    const n = noise(i / 2.4, j / 2, k / 2.4, seed + 85), up = grid.get(i, j + 1, k) === MAT.air, shade = grid.get(i, j, k - 1) === MAT.air;
    if ((up && y > h * .5 && n > .42) || (up && n > .66) || (shade && y > h * .25 && n > .62)) grid.set(i, j, k, MAT.moss);
  }
}

/* ---------- Routes, lanterns and the finished piece ---------- */

const at = (angle: number, radius: number): XZ => [Math.sin(angle) * radius, Math.cos(angle) * radius];
const heading = (x: number, z: number) => Math.atan2(x, z);
const round = (v: number) => Math.round(v * 1e4) / 1e4;
const xz = (p: XZ): XZ => [round(p[0]), round(p[1])];

/** The first standing spot straight out from a seat where a whole body clears every authored solid. */
function standingSpot(grid: Clearing, hip: XZ, inward: XZ): XZ {
  for (let t = .4; t < 1.6; t += M / 2) {
    const x = hip[0] + inward[0] * t, z = hip[1] + inward[1] * t;
    if (!grid.solidUnder(x - CLEAR, x + CLEAR, z - CLEAR, z + CLEAR)) return [x, z];
  }
  throw new Error('A campfire seat has no clear standing spot in front of it.');
}

/** In through the footpath gap, round the corridor between the sitters' feet and the stones, then to the seat. */
function route(entry: readonly XZ[], spot: XZ): XZ[] {
  const angle = heading(spot[0], spot[1]), steps = Math.max(1, Math.ceil(Math.abs(angle) / .3));
  const ring: XZ[] = [];
  for (let i = 1; i <= steps; i++) ring.push(at(angle * i / steps, RING));
  return [...entry, ...ring, spot].map(xz);
}

function blueprintOf(grid: Clearing): { blueprint: VoxelBlueprint; pivot: Vec3 } {
  // A sunk cell never shares a face with the ground it is sunk in. Whatever stands is sunk a second row, so the
  // drawn ground, which may lie up to a quarter metre under the physical floor, never shows daylight beneath it.
  for (let k = -HALF; k < HALF; k++) for (let i = -HALF; i < HALF; i++) {
    if (grid.get(i, -1, k) !== MAT.air && grid.get(i, 0, k) === MAT.air) grid.set(i, -1, k, MAT.air);
    const foot = grid.get(i, -1, k);
    if (foot !== MAT.air) grid.add(i, -2, k, foot === MAT.moss || foot === MAT.cream ? MAT.bark : foot);
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let z = 0; z < grid.sz; z++) for (let y = 0; y < grid.sy; y++) for (let x = 0; x < grid.sx; x++)
    if (grid.voxels[x + grid.sx * (y + grid.sy * z)] !== MAT.air) [x, y, z].forEach((v, i) => { lo[i] = Math.min(lo[i]!, v); hi[i] = Math.max(hi[i]!, v + 1); });
  const [x0, y0, z0] = lo as [number, number, number], size: [number, number, number] = [hi[0]! - x0, hi[1]! - y0, hi[2]! - z0];
  const boxes: VoxelBlueprint['boxes'] = [];
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0];) {
    const cell = (u: number) => grid.voxels[u + x0 + grid.sx * (y + y0 + grid.sy * (z + z0))]!;
    const material = cell(x);
    let end = x + 1;
    while (end < size[0] && cell(end) === material) end++;
    if (material !== MAT.air) boxes.push({ from: [x, y, z], to: [end, y + 1, z + 1], material });
    x = end;
  }
  return {
    blueprint: { version: 1, id: 'civic-campfire-clearing-v1', styleId: STYLES.hearth.id, kind: 'civic', lattice: 'build', size, boxes, windows: [] },
    pivot: [HALF - x0, SINK - y0, HALF - z0],
  };
}

/** Build the clearing from scratch. Deterministic: the same bytes every time. */
export function buildCampfireClearing(): CampfireClearing {
  const grid = new Clearing();
  hearth(grid, 4141);
  const placed = LOGS.flatMap(spec => placeLog(grid, spec));
  const chairHip = magistrateChair(grid, -4, -24, 5303);
  woodpile(grid, 25, -6, 8, 6007);
  stump(grid, -26, 7, 6113);
  rock(grid, -17, -23, 4.6, 3.4, 7001);
  rock(grid, 18, -21, 5.4, 4, 7103);
  rock(grid, 14, 25, 3.6, 2.6, 7207);

  // Walk in from just outside the footpath gap, through it, to the corridor's front.
  const front = LINE + .25 + .9;
  const entry: XZ[] = [[0, front], [0, LINE], [0, RING]];
  const players = placed.map(seat => {
    // Square to the log, turned a little toward the flame itself.
    const inwardHeading = heading(seat.inward[0], seat.inward[1]);
    const facing = inwardHeading + wrap(heading(-seat.hip[0], -seat.hip[1]) - inwardHeading) * .6;
    const spot = standingSpot(grid, seat.hip, seat.inward);
    // On the ground just in front of the log, beside the shins; never inside a knot or a buttress.
    const line: XZ = [seat.hip[0] - seat.inward[0] * HIP_FORWARD, seat.hip[1] - seat.inward[1] * HIP_FORWARD];
    let lantern: XZ = [line[0] + seat.inward[0] * LANTERN_FORWARD + seat.along[0] * seat.lanternSide * LANTERN_SIDE,
      line[1] + seat.inward[1] * LANTERN_FORWARD + seat.along[1] * seat.lanternSide * LANTERN_SIDE];
    for (let n = 0; n < 3 && grid.solidUnder(lantern[0] - .1, lantern[0] + .1, lantern[1] - .1, lantern[1] + .1); n++)
      lantern = [lantern[0] + seat.inward[0] * M, lantern[1] + seat.inward[1] * M];
    return { kind: 'player' as const, hip: xz(seat.hip), heading: round(wrap(facing)), approach: route(entry, spot), lantern: xz(lantern) };
  });
  // Seats count round the fire from the Magistrate's left, the way the room hands them out.
  players.sort((a, b) => heading(a.hip[0], a.hip[1]) - heading(b.hip[0], b.hip[1]));
  const chairSpot = standingSpot(grid, chairHip, [0, 1]);
  const seats: CampfireClearingSeat[] = [
    { seat: 0, kind: 'magistrate', hip: xz(chairHip), heading: 0, approach: route(entry, chairSpot), lantern: xz([chairHip[0] + .62, chairHip[1] + .35]) },
    ...players.map((seat, i) => ({ seat: i + 1, ...seat })),
  ];
  const { blueprint, pivot } = blueprintOf(grid);
  let reach = front;
  for (const box of blueprint.boxes) for (const x of [box.from[0], box.to[0]]) for (const z of [box.from[2], box.to[2]])
    reach = Math.max(reach, Math.hypot((x - pivot[0]) * M, (z - pivot[2]) * M));
  return { blueprint, pivot, seatTop: CAMPFIRE_SEAT_TOP, radius: Math.ceil((reach + .75) * 4) / 4, seats };
}

let cached: CampfireClearing | undefined;
/** The clearing, built once per process. Callers must not mutate it. */
export function createCampfireClearing(): CampfireClearing {
  cached ??= buildCampfireClearing();
  return cached;
}
