import { SHELF_BAY_SLOTS, SHELF_SLOTS, type Vec3, type VoxelAsset } from '@chatdom/shared';
import { MAT } from '../materials';

/*
 * The keepsake shelf at home: a carved hutch in dark timber on the avatar lattice, so a keepsake (a fish on its plaque,
 * a ribbon, a dated token) stands on it cell for cell at its own size. Front faces +Z, up is +Y, the back panel's
 * back is z=0 and it stands on y=0. It is drawn in bays of three tiers by four places, between turned posts, under a
 * dentilled frieze, a stepped cornice and a carved shell crest. The tier ends hold small homely things (candles, a
 * crock with a sprig, books) so the first keepsake never stands alone, and the middle tier carries a lace runner.
 *
 * Places are numbered from pride of place outwards, so whatever fills the lowest free place lands where the eye goes:
 * the middle tier's centre pair, then the top tier's, then the bottom tier's, then the outer places in the same order.
 */

/** Places across one tier and tiers in one bay. */
export const SHELF_COLUMNS = 4;
export const SHELF_TIERS = 3;
if (SHELF_COLUMNS * SHELF_TIERS !== SHELF_BAY_SLOTS) throw new Error('The shelf bay no longer matches the shelf contract.');
/** The most bays a shelf can grow to: every slot the realm can hand out has a place. */
export const SHELF_MAX_BAYS = Math.ceil(SHELF_SLOTS / SHELF_BAY_SLOTS);

/** Avatar cells. A place is 36 cells (2.25 m) wide and clear, so the broadest plaque stands at most a little smaller. */
const SLOT_W = 36, SLOT_H = 36, BOARD = 3, MARGIN = 8, POST = 6, OVER = 3;
/** The inner width between two posts, and the step from one post to the next. */
const INNER = 2 * MARGIN + SHELF_COLUMNS * SLOT_W;
const STEP = POST + INNER;
/** Depths: back panel 0..1, the tier's floor to z=24, the board's lip at 25, posts to 26, the cornice to 28. */
const BACK = 2, FRONT = 25, POST_Z = 24;
const FOOT = 4, APRON_TOP = 12;
const floorOf = (tier: number) => APRON_TOP + BOARD + tier * (SLOT_H + BOARD);
const TOP_BOARD = floorOf(SHELF_TIERS) - BOARD;         // the board over the top tier
const FRIEZE = TOP_BOARD + BOARD, CORNICE = FRIEZE + 5, CORNICE_TOP = CORNICE + 6;
const CREST_H = 11, CREST_HALF = 34;
const CANDLE_CROWN = 9, CANDLE_TIER = 7, FLAME = 4;
const HEIGHT = CORNICE_TOP + 4 + CANDLE_CROWN + 1 + FLAME;
const DEPTH = 29;
/** Pride order inside a bay: [tier, column] for slot 0..11. */
const PRIDE: readonly (readonly [number, number])[] = [
  [1, 1], [1, 2], [2, 1], [2, 2], [0, 1], [0, 2],
  [1, 0], [1, 3], [2, 0], [2, 3], [0, 0], [0, 3],
];

export interface ShelfSlot {
  /** Avatar cells: the centre of the place's floor across x, the first air cell above its board, and mid-depth. */
  readonly at: Vec3;
  /** The clear room a keepsake may take, in cells. A larger keepsake is drawn smaller to fit, never cut. */
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** The z of the back panel's face: a plaque's back rests here. */
  readonly back: number;
  readonly bay: number;
  /** 0 bottom, 1 middle (with the lace runner), 2 top. */
  readonly tier: number;
  /** 0..3 from the left. */
  readonly column: number;
}

export interface KeepsakeShelf {
  readonly asset: VoxelAsset;
  readonly bays: number;
  /** Indexed by shelf slot number: `slots[n]` is where slot n stands. A dozen per bay; the last bay's spare places
   *  past the shelf's 64 slots stay as plain shelf. */
  readonly slots: readonly ShelfSlot[];
  /** Candle flames, in avatar cells (cell centres), for the room's warm light. */
  readonly lights: readonly Vec3[];
  /** Each bay's span across x, in cells, posts included: for framing a camera on one bay at a time. */
  readonly bayX: readonly (readonly [number, number])[];
}

/** One bay up to a dozen keepsakes, then another per dozen, up to the shelf's last slot. */
export function shelfBaysFor(count: number): number {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return Math.min(SHELF_MAX_BAYS, Math.max(1, Math.ceil(n / SHELF_BAY_SLOTS)));
}

/** Which bay, tier and column a slot number stands in. */
export function shelfPlaceOf(slot: number): { bay: number; tier: number; column: number } {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SHELF_SLOTS) throw new Error(`Shelf slot ${slot} is not on the shelf.`);
  const [tier, column] = PRIDE[slot % SHELF_BAY_SLOTS]!;
  return { bay: Math.floor(slot / SHELF_BAY_SLOTS), tier, column };
}

class Block {
  readonly v: Uint16Array;
  constructor(readonly sx: number, readonly sy: number, readonly sz: number) { this.v = new Uint16Array(sx * sy * sz); }
  put(x: number, y: number, z: number, m: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) throw new Error(`Shelf cell ${x},${y},${z} is outside the ${this.sx}x${this.sy}x${this.sz} block.`);
    this.v[x + this.sx * (y + this.sy * z)] = m;
  }
  get(x: number, y: number, z: number): number {
    return x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz ? 0 : this.v[x + this.sx * (y + this.sy * z)]!;
  }
  /** Half-open box. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number): void {
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.put(x, y, z, m);
  }
  /** A disc of cells round a corner point (cx, cz) at height y. */
  disc(cx: number, y: number, cz: number, r: number, m: number): void {
    const n = Math.ceil(r);
    for (let z = Math.floor(cz - n); z <= cz + n; z++) for (let x = Math.floor(cx - n); x <= cx + n; x++)
      if ((x + .5 - cx) ** 2 + (z + .5 - cz) ** 2 <= r * r) this.put(x, y, z, m);
  }
}

/** A small seeded hash in 0..1, so every bay's still life is its own and the same each time. */
function hash(...values: number[]): number {
  let h = 2166136261;
  for (const v of values) { h = Math.imul(h ^ (v | 0), 16777619); h ^= h >>> 13; }
  h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** A brass candlestick with a cream candle and a teardrop flame. Returns the flame's centre. */
function candle(b: Block, cx: number, y: number, cz: number, wax: number): Vec3 {
  b.disc(cx + .5, y, cz + .5, 2.6, MAT.brass);
  b.disc(cx + .5, y + 1, cz + .5, 1.2, MAT.brass);
  b.disc(cx + .5, y + 2, cz + .5, 1.8, MAT.brass);
  const top = y + 3 + wax;
  for (let k = y + 3; k < top; k++) b.disc(cx + .5, k, cz + .5, 1.5, MAT.cream);
  // A drip run down one side.
  b.put(cx + 2, top - 1, cz, MAT.cream); b.put(cx + 2, top - 2, cz, MAT.cream); b.put(cx + 2, top - 4, cz, MAT.cream);
  b.put(cx, top, cz, MAT.hairBlack);
  b.put(cx, top + 1, cz, MAT.fabricOrange);
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) b.put(cx + dx, top + 2, cz + dz, MAT.fabricGold);
  b.put(cx, top + 3, cz, MAT.fabricGold);
  b.put(cx, top + 4, cz, MAT.hairGold);
  return [cx + .5, top + 2.5, cz + .5];
}

/** A stoneware crock with a band, soil and a sprig of leaves and small flowers. */
function crock(b: Block, cx: number, y: number, cz: number, band: number, bloom: number, seed: number): void {
  for (let k = 0; k < 6; k++) b.disc(cx + .5, y + k, cz + .5, k === 0 ? 2.2 : k === 5 ? 2.2 : 2.7, k === 3 ? band : MAT.cream);
  b.disc(cx + .5, y + 6, cz + .5, 2.2, MAT.cream);
  b.disc(cx + .5, y + 6, cz + .5, 1.2, MAT.earth);
  // Three stems from the soil, each with leaves along it and a bloom at its tip.
  const stems: readonly (readonly [number, number, number])[] = [[0, 0, 12], [-1, 0, 9], [1, 1, 10]];
  for (const [i, [dx, dz, height]] of stems.entries()) {
    let x = cx + (i === 0 ? 0 : dx);
    const z = cz + dz;
    for (let k = 1; k <= height; k++) {
      const yy = y + 6 + k;
      // Stems lean outward as they rise.
      if (i > 0 && k === Math.floor(height / 2)) { x += dx; b.put(x, yy - 1, z, MAT.leaf); }
      b.put(x, yy, z, MAT.leaf);
      if (k > 2 && k < height - 1 && hash(seed, i, k) < .45) {
        const side = hash(seed, k, i) < .5 ? -1 : 1;
        b.put(x + side, yy, z, k % 2 ? MAT.leaf : MAT.moss);
      }
    }
    const tip = y + 6 + height;
    b.put(x, tip + 1, z, bloom);
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1]] as const) if (hash(seed, i, ox, oz) < .8) b.put(x + ox, tip, z + oz, bloom);
    b.put(x, tip, z, MAT.hairGold);
  }
}

/** Three books standing, spines out, with gilt bands. */
function standingBooks(b: Block, x0: number, y: number, z0: number, seed: number): void {
  const covers = [MAT.fabricMutedRed, MAT.fabricMutedGreen, MAT.fabricMutedBlue, MAT.fabricMutedViolet];
  for (let i = 0; i < 3; i++) {
    const h = 10 + Math.floor(hash(seed, i) * 4), cover = covers[(i + Math.floor(hash(seed) * 4)) % covers.length]!;
    const x = x0 + i * 2, depth = 8 - (i % 2);
    b.box(x, y, z0, x + 2, y + h, z0 + depth, cover);
    // Page edges show along the top; gilt bands cross the spine.
    b.box(x, y + h - 1, z0 + 1, x + 2, y + h, z0 + depth - 1, MAT.cream);
    for (const band of [2, h - 3]) b.box(x, y + band, z0 + depth - 1, x + 2, y + band + 1, z0 + depth, MAT.goldLeaf);
  }
}

/** Three books lying in a stack, with a small cream shell from the shore on top. */
function bookStack(b: Block, cx: number, y: number, z0: number, seed: number): void {
  const covers = [MAT.fabricMutedBlue, MAT.fabricMutedRed, MAT.fabricMutedGold];
  for (let i = 0; i < 3; i++) {
    const w = i === 1 ? 6 : 7, d = i === 2 ? 6 : 8, x = cx - 3 + (i === 1 ? 1 : 0), z = z0 + (i === 2 ? 1 : 0);
    const cover = covers[(i + Math.floor(hash(seed, 7) * 3)) % 3]!;
    b.box(x, y + i * 2, z, x + w, y + i * 2 + 2, z + d, cover);
    b.box(x, y + i * 2, z + d - 1, x + w - 1, y + i * 2 + 1, z + d, MAT.cream);
  }
  b.box(cx - 1, y + 6, z0 + 3, cx + 1, y + 7, z0 + 5, MAT.cream);
  b.put(cx, y + 7, z0 + 4, MAT.petal);
}

/**
 * The carved keepsake shelf for `bays` bays (1..6). Deterministic: the same count gives the same cells, in a fresh
 * buffer every call.
 */
export function createKeepsakeShelf(bays: number): KeepsakeShelf {
  if (!Number.isInteger(bays) || bays < 1 || bays > SHELF_MAX_BAYS) throw new Error(`A keepsake shelf has 1 to ${SHELF_MAX_BAYS} bays, not ${bays}.`);
  const width = OVER + bays * STEP + POST + OVER;
  const b = new Block(width, HEIGHT, DEPTH);
  const posts = Array.from({ length: bays + 1 }, (_, k) => OVER + k * STEP);
  const lights: Vec3[] = [];

  // Back panel: tongue-and-groove boards, a dark groove every ten cells.
  for (let x = posts[0]! + POST; x < posts[bays]!; x++) for (let y = FOOT; y < TOP_BOARD; y++) {
    b.put(x, y, 0, MAT.timber);
    b.put(x, y, 1, (x - posts[0]!) % 10 === 0 ? MAT.bark : MAT.timber);
  }

  // Posts: a side panel behind, a turned column in front with square blocks where the boards meet it, bun feet below.
  const blocks: [number, number][] = [[FOOT, floorOf(0) + 1]];
  for (let t = 1; t < SHELF_TIERS; t++) blocks.push([floorOf(t) - BOARD - 1, floorOf(t) + 1]);
  blocks.push([TOP_BOARD - 1, TOP_BOARD + BOARD]);
  for (const px of posts) {
    b.box(px, FOOT, BACK - 2, px + POST, TOP_BOARD + BOARD, POST_Z - 2, MAT.timber);
    for (let y = FOOT; y < TOP_BOARD + BOARD; y++) {
      const block = blocks.find(([y0, y1]) => y >= y0 && y < y1);
      if (block) {
        // A square block with a dark chamfered ring at its top and bottom edge.
        const edge = y === block[0] || y === block[1] - 1;
        for (let z = POST_Z - 3; z < POST_Z + 3; z++) for (let x = px; x < px + POST; x++) {
          const corner = (x === px || x === px + POST - 1) && (z === POST_Z - 3 || z === POST_Z + 2);
          if (!corner) b.put(x, y, z, edge ? MAT.bark : MAT.timber);
        }
        continue;
      }
      // Turned between blocks: a collar at each end, a vase swelling low, a slender neck above.
      const span = blocks.find(([y0]) => y0 > y)!, prev = [...blocks].reverse().find(([, y1]) => y1 <= y)!;
      const u = (y - prev[1] + .5) / (span[0] - prev[1]);
      const collar = u < .06 || u > .94;
      const r = collar ? 3 : 1.75 + .95 * Math.exp(-(((u - .3) / .13) ** 2)) + .45 * Math.exp(-(((u - .78) / .05) ** 2));
      const ring = collar || Math.abs(u - .78) < .03;
      b.disc(px + 3, y, POST_Z, r, ring ? MAT.bark : MAT.timber);
    }
    for (const cz of [POST_Z, 4]) [2.2, 3, 3, 2.7].forEach((r, y) => b.disc(px + 3, y, cz, r, y === 3 ? MAT.bark : MAT.timber));
  }

  // Boards: every tier's floor and the board over the top tier, with a rounded lip and a shadowed underside.
  const board = (y0: number, x0: number, x1: number) => {
    for (let y = y0; y < y0 + BOARD; y++) for (let x = x0; x < x1; x++) {
      const front = y === y0 ? FRONT - 1 : FRONT;
      for (let z = BACK; z <= front; z++) b.put(x, y, z, y === y0 && z === front ? MAT.bark : MAT.timber);
    }
  };
  for (let t = 0; t < SHELF_TIERS; t++) for (let k = 0; k < bays; k++) board(floorOf(t) - BOARD, posts[k]! + POST, posts[k + 1]!);
  board(TOP_BOARD, posts[0]!, posts[bays]! + POST);

  // Brackets under the boards above each tier: a concave quarter round against each post.
  const R = 6;
  for (let t = 1; t <= SHELF_TIERS; t++) {
    const under = floorOf(t) - BOARD - 1;
    for (let k = 0; k < bays; k++) for (const side of [1, -1] as const) {
      const edge = side === 1 ? posts[k]! + POST : posts[k + 1]! - 1;
      for (let dy = 0; dy < R; dy++) for (let dx = 0; dx < R; dx++) {
        if ((dx + .5 - R) ** 2 + (dy + .5 - R) ** 2 < R * R) continue;
        for (let z = FRONT - 5; z < FRONT; z++) b.put(edge + side * dx, under - dy, z, MAT.timber);
      }
    }
  }

  // Apron under the bottom board: scalloped lobes and a brass boss at each bay's centre.
  for (let k = 0; k < bays; k++) {
    const x0 = posts[k]! + POST, x1 = posts[k + 1]!, cx = (x0 + x1) / 2;
    for (let x = x0; x < x1; x++) {
      const lobe = Math.abs(x + .5 - cx) < 12 ? 24 : 16;
      const u = (((x + .5 - cx + lobe / 2) % lobe) + lobe) % lobe / lobe;
      const bottom = FOOT + Math.round(3.4 * (1 - Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2))));
      for (let y = bottom; y < APRON_TOP; y++) for (let z = FRONT - 3; z < FRONT; z++)
        b.put(x, y, z, y === bottom && z === FRONT - 1 ? MAT.bark : MAT.timber);
    }
    for (let y = FOOT + 4; y < FOOT + 7; y++) for (let x = Math.floor(cx) - 1; x <= Math.floor(cx); x++) b.put(x, y, FRONT, MAT.brass);
  }

  // Frieze with dentils and a carved boss over every post.
  const left = posts[0]!, right = posts[bays]! + POST;
  for (let y = FRIEZE; y < CORNICE; y++) for (let x = left; x < right; x++) for (let z = 0; z < FRONT; z++)
    b.put(x, y, z, z === FRONT - 1 ? MAT.bark : MAT.timber);
  for (let x = left; x < right; x++) if ((x - left) % 4 < 2) for (let y = FRIEZE + 1; y < FRIEZE + 3; y++) b.put(x, y, FRONT, MAT.timber);
  for (const px of posts) {
    for (let y = FRIEZE; y < CORNICE; y++) for (let x = px; x < px + POST; x++) b.put(x, y, FRONT, MAT.timber);
    b.box(px + 2, FRIEZE + 1, FRONT + 1, px + 4, FRIEZE + 4, FRONT + 2, MAT.goldLeaf);
  }

  // Cornice: three steps out, the middle one with a brass bead along its edge.
  const steps: readonly (readonly [number, number])[] = [[1, 27], [2, 28], [3, 29]];
  for (const [i, [out, depth]] of steps.entries()) for (let y = CORNICE + i * 2; y < CORNICE + i * 2 + 2; y++)
    for (let x = left - out; x < right + out; x++) for (let z = 0; z < depth; z++)
      b.put(x, y, z, i === 1 && y === CORNICE + 2 && z === depth - 1 ? MAT.brass : MAT.timber);

  // A carved shell crest over every bay: a dark rim, rays from its foot and a gilt boss.
  for (let k = 0; k < bays; k++) {
    const cx = (posts[k]! + POST + posts[k + 1]!) / 2;
    for (let x = Math.floor(cx - CREST_HALF); x < Math.ceil(cx + CREST_HALF); x++) {
      const dx = (x + .5 - cx) / CREST_HALF;
      if (Math.abs(dx) >= 1) continue;
      const top = CREST_H * Math.sqrt(1 - dx * dx);
      for (let dy = 0; dy < top; dy++) {
        const rim = top - dy <= 1.4 || Math.abs(dx) > .93;
        const angle = Math.atan2(dy + .5, (x + .5 - cx) / 3);
        const ray = !rim && dy > 1 && Math.abs(((angle / Math.PI) * 9) % 1 - .5) < .08;
        for (let z = FRONT - 5; z < FRONT; z++) b.put(x, CORNICE_TOP + dy, z, z === FRONT - 1 && (rim || ray) ? MAT.bark : MAT.timber);
      }
    }
    for (let y = CORNICE_TOP + 3; y < CORNICE_TOP + 6; y++) for (let x = Math.floor(cx) - 1; x <= Math.floor(cx); x++) b.put(x, y, FRONT, MAT.goldLeaf);
  }

  // Candles on the cornice over every post.
  for (const px of posts) lights.push(candle(b, px + 3, CORNICE_TOP, FRONT - 6, CANDLE_CROWN));

  // The still life at each tier's ends; odd bays mirror it so a long shelf never repeats itself.
  for (let k = 0; k < bays; k++) {
    const inner0 = posts[k]! + POST, inner1 = posts[k + 1]!;
    const ends = k % 2 ? [inner1 - MARGIN, inner0] as const : [inner0, inner1 - MARGIN] as const;
    const mid = (end: number) => end + MARGIN / 2;
    const lace = floorOf(1), runner = { x0: inner0 + MARGIN, x1: inner1 - MARGIN };
    // The lace runner under the middle tier's places: a layer on the board, a hem over the lip and an openwork drop.
    for (let x = runner.x0; x < runner.x1; x++) {
      for (let z = BACK; z <= FRONT; z++) b.put(x, lace, z, MAT.hairSilver);
      b.put(x, lace, FRONT + 1, MAT.hairSilver);
      const u = ((x - runner.x0) % 6) / 6;
      const drop = 4 + Math.round(2 * Math.sin(Math.PI * u) ** 2);
      for (let dy = 1; dy <= drop; dy++) {
        const hole = (x - runner.x0) % 3 === 1 && dy % 2 === 1 && dy < drop - 1;
        if (!hole) b.put(x, lace - dy, FRONT + 1, MAT.hairSilver);
      }
    }
    // Top tier: a crock with a sprig, three books.
    crock(b, mid(ends[0]) - 1, floorOf(2), 15, MAT.fabricMutedBlue, k % 2 ? MAT.blueFlower : MAT.petal, k * 31 + 1);
    standingBooks(b, mid(ends[1]) - 3, floorOf(2), 10, k * 31 + 2);
    // Middle tier, on the bare board beside the runner: a stack of books with a shell, and a candle.
    bookStack(b, mid(ends[0]), lace, 12, k * 31 + 3);
    lights.push(candle(b, mid(ends[1]) - 1, lace, 17, CANDLE_TIER));
    // Bottom tier: books standing, and a crock of a different flower.
    standingBooks(b, mid(ends[0]) - 3, floorOf(0), 9, k * 31 + 4);
    crock(b, mid(ends[1]) - 1, floorOf(0), 14, MAT.fabricMutedRed, k % 2 ? MAT.petal : MAT.fabricMutedGold, k * 31 + 5);
  }

  const slots: ShelfSlot[] = [];
  for (let n = 0; n < Math.min(SHELF_SLOTS, bays * SHELF_BAY_SLOTS); n++) {
    const { bay, tier, column } = shelfPlaceOf(n);
    const x0 = posts[bay]! + POST + MARGIN + column * SLOT_W;
    const floor = floorOf(tier) + (tier === 1 ? 1 : 0);
    slots.push(Object.freeze({
      at: Object.freeze([x0 + SLOT_W / 2, floor, (BACK + FRONT) / 2]) as unknown as Vec3,
      width: SLOT_W - 2, height: floorOf(tier) + SLOT_H - floor - 1, depth: FRONT - BACK, back: BACK, bay, tier, column,
    }));
  }
  const bayX = Array.from({ length: bays }, (_, k) => Object.freeze([posts[k]!, posts[k + 1]! + POST] as const));
  return {
    asset: { id: `keepsake:shelf.${bays}`, revision: 1, lattice: 'avatar', size: [width, HEIGHT, DEPTH], voxels: b.v },
    bays, slots: Object.freeze(slots), lights: Object.freeze(lights.map(light => Object.freeze(light) as unknown as Vec3)),
    bayX: Object.freeze(bayX),
  };
}
