import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, STYLES, type StyleKey } from '../../../materials';
import { wood } from '../millrace/craft';
import { hash } from '../shore/shape';

type Box = VoxelBlueprint['boxes'][number];

/**
 * The lake's clinker rowing boat, 3.5 m long, as one shared hull: the pier boats float on it and the boathouse's
 * upturned boat is the same hull turned keel up. Local frame in build cells: the length runs along +Z with the bow
 * at z = 27 and the transom at z = 0, the beam across X centred on the keel column x = 5, and y = 0 the bottom of
 * the keel amidships.
 *
 * The shape is three curves and a section. The keel rockers up into a raked forefoot and a lifted transom; the sheer
 * dips amidships and sweeps up to the stern and, higher, to the stem; the plan swells to its beam a little aft of
 * the middle and draws in to a pointed stem. Each strake sits one cell further out than the one below it, so the
 * laps show as shadow lines down the whole side, and the strakes alternate between two faded tones of the paint.
 * The bottom is tarred to just above the waterline, the top strake carries the boat's accent, and inside everything
 * is bare wood: the inner half of every lap, a lining where a single plank would show paint inside, low
 * floorboards, three thwarts and an inwale with brass rowlock horns. A brass ring sits on the stem head.
 */
export const HULL = {
  length: 28,
  beam: 11,
  /** Keel to stem head: the stem post stands one cell proud of the sheer. */
  height: 10,
  /** The keel column. */
  centre: 5,
  /** Whole cells below the waterline when afloat. */
  draft: 2,
  /** Rows below this are tarred: the bottom, and one band above the water so the waterline reads dark. */
  tar: 3,
  /** The floorboards lie in this row; their tops are the floor the gear rests on. */
  floor: 2,
  /** The thwarts' row; every thwart top is at y = 5, two cells over the floor. */
  thwartRow: 4,
  /** Half-open z ranges of the stern, rowing and bow thwarts. */
  thwarts: [[3, 5], [12, 14], [19, 21]],
  /** Rowlock horns stand on the inwale either side of the pin at z = 10, a hand aft of the rowing thwart. */
  rowlock: 10,
  /** The bow ring's cell, through the stem a cell under the stem head. */
  ring: [5, 8, 27],
} as const;

const L = HULL.length, MID = HULL.centre;
/** Half-breadths of the strakes by row above the keel; the topsides stand upright above the fourth. */
const SECTION = [0, 2, 3, 4, 5] as const;
/** Widest station: a little aft of the middle, as a rowing boat carries her beam. */
const WIDEST = 11;

const round = (v: number) => Math.floor(v + 0.5);

/**
 * The plan at the sheer: the fraction of full beam at station z. A transom about two thirds of the beam; forward,
 * full shoulders drawing in to a pointed stem.
 */
export function plan(z: number): number {
  return z <= WIDEST ? 1 - 0.38 * ((WIDEST - z) / WIDEST) ** 2 : 1 - ((z - WIDEST) / (L - 1 - WIDEST)) ** 2.4;
}

/** Forward of the widest station the lower strakes draw in faster than the sheer, so the bow flares over a fine forefoot. */
const fineness = (row: number, z: number) => (z > WIDEST ? 1 + 0.3 * (SECTION.length - 1 - row) : 1);

/** The keel's underside at station z: level amidships, lifting a little to the transom and curving up into the stem. */
export function keel(z: number): number {
  if (z < 6) return round(2 * ((6 - z) / 6) ** 2);
  if (z > 20) return round(5 * ((z - 20) / 7) ** 2.2);
  return 0;
}

/**
 * One above the highest planking cell at station z. The sheer is lowest for a metre amidships, rises a quarter of a
 * metre to the transom and half a metre to the stem, and the stem head stands a cell above it.
 */
export function sheer(z: number): number {
  const rise = z <= WIDEST ? 2 * ((WIDEST - z) / WIDEST) ** 1.6 : 3.4 * ((z - WIDEST) / (L - 1 - WIDEST)) ** 1.6;
  return round(6 + rise) + (z === L - 1 ? 1 : 0);
}

/** Half-breadth of the hull's row at height y and station z, or -1 outside it. */
export function halfBreadth(y: number, z: number): number {
  if (z < 0 || z >= L || y < keel(z) || y >= sheer(z)) return -1;
  const row = Math.min(y - keel(z), SECTION.length - 1);
  return round(SECTION[row]! * plan(z) ** fineness(row, z));
}

/** The paint each variant wears, faded: two strake tones (the same twice when one coat has held) and the top strake. */
export interface HullPaint { readonly strakes: readonly [number, number]; readonly top: number }

/**
 * Faded working colours from each kit's legal palette. Within a kit every variant has its own top strake, so two
 * boats at one pier never match. Hearth: cream on warm plaster with a terracotta top strake; mossy green with
 * cream; an ochre boat with a faded blue strake. Tide: cream with a slate strake; terracotta with cream; a washed
 * blue boat with a rust strake. Grove: moss with an ochre strake; weathered ochre with moss; pale plaster with leaf.
 */
export const HULL_PAINT: Readonly<Record<StyleKey, readonly [HullPaint, HullPaint, HullPaint]>> = {
  hearth: [
    { strakes: [MAT.cream, MAT.plaster], top: MAT.terracotta },
    { strakes: [MAT.moss, MAT.moss], top: MAT.cream },
    { strakes: [MAT.goldLeaf, MAT.thatch], top: MAT.blueFlower },
  ],
  tide: [
    { strakes: [MAT.cream, MAT.cream], top: MAT.slate },
    { strakes: [MAT.terracotta, MAT.cloth], top: MAT.cream },
    { strakes: [MAT.blueFlower, MAT.blueFlower], top: MAT.terracotta },
  ],
  grove: [
    { strakes: [MAT.moss, MAT.moss], top: MAT.goldLeaf },
    { strakes: [MAT.thatch, MAT.goldLeaf], top: MAT.moss },
    { strakes: [MAT.plaster, MAT.cream], top: MAT.leaf },
  ],
};

/** Boat tar: the darkest wood tone, so the wetted bottom reads as tarred planks rather than stone. */
export const TAR = MAT.bark;

export const BOAT_VARIANTS = [0, 1, 2] as const;
export type BoatVariant = (typeof BOAT_VARIANTS)[number];

export function checkBoat(form: string, style: StyleKey, variant: number): asserts variant is BoatVariant {
  if (!Object.hasOwn(STYLES, style)) throw new RangeError(`${form}: unknown style ${String(style)}.`);
  if (!Number.isInteger(variant) || variant < 0 || variant > 2) throw new RangeError(`${form}: variant must be 0, 1 or 2, not ${variant}.`);
}

/** The hull's occupancy classes, read from the three curves; every row of each class is one centred run. */
interface Classes {
  /** Inside the hull's outer skin. */
  readonly solid: (x: number, y: number, z: number) => boolean;
  /** Solid cells hidden from outside (inner halves of laps, the inwale, the stem's inner face). */
  readonly inner: (x: number, y: number, z: number) => boolean;
  /** The open boat: air that is never next to a painted cell, so every surface seen inside is wood. */
  readonly open: (x: number, y: number, z: number) => boolean;
  /** Air loose gear may take: the open boat, or the air over it above the sheer. */
  readonly free: (x: number, y: number, z: number) => boolean;
}

function classes(): Classes {
  const solid = (x: number, y: number, z: number) => {
    const h = halfBreadth(y, z);
    return h >= 0 && Math.abs(x - MID) <= h;
  };
  // The hull's section carried on upwards past the sheer: the open air over the boat. Where the sheer steps down
  // to the next station, the cells beside the step look into the boat, not out of it.
  const within = (x: number, y: number, z: number) => {
    if (z < 0 || z >= L || y < keel(z)) return false;
    return Math.abs(x - MID) <= halfBreadth(Math.min(y, sheer(z) - 1), z);
  };
  /** Faces that can be seen from outside: the sides, the ends and the underside (the top is open boat). */
  const sideways: readonly Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
  const inner = (x: number, y: number, z: number) =>
    solid(x, y, z) && sideways.every(([dx, dy, dz]) => within(x + dx, y + dy, z + dz));
  const painted = (x: number, y: number, z: number) => solid(x, y, z) && !inner(x, y, z);
  // The hollow: a cell whose whole 3 × 3 neighbourhood, on its own row and the row under it, is inside the hull.
  // Its walls are therefore closed through the diagonals too, and each lap step keeps a two-cell shelf.
  const hollow = (x: number, y: number, z: number) => {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!within(x + dx, y, z + dz) || !within(x + dx, y - 1, z + dz)) return false;
    }
    return true;
  };
  const around: readonly Vec3[] = [...sideways, [0, 1, 0]];
  const open = (x: number, y: number, z: number) =>
    solid(x, y, z) && hollow(x, y, z) && around.every(([dx, dy, dz]) => !painted(x + dx, y + dy, z + dz));
  const free = (x: number, y: number, z: number) =>
    open(x, y, z) || (y >= sheer(z) && y < HULL.height && within(x, y, z) && hollow(x, Math.min(y, sheer(z) - 1), z));
  return { solid, inner, open, free };
}

/** The centred run [x0, x1) of a row where the predicate holds, or undefined; throws if the row is not one run. */
function run(test: (x: number) => boolean): readonly [number, number] | undefined {
  let x0 = -1, x1 = -1;
  for (let x = 0; x < HULL.beam; x++) {
    if (!test(x)) continue;
    if (x0 < 0) x0 = x;
    else if (x1 !== x) throw new Error(`boat hull: row breaks at x ${x}.`);
    x1 = x + 1;
  }
  return x0 < 0 ? undefined : [x0, x1];
}

type Span = readonly [x0: number, x1: number, material: number];

/**
 * Lays one run per (y, z) row as boxes. Rows of equal run merge along z, then equal rectangles stack along y, so a
 * hull layer costs a box per change of breadth rather than a box per row.
 */
export function laySpans(b: Boxes, height: number, length: number, span: (y: number, z: number) => Span | undefined): void {
  const done: Box[] = [];
  let open = new Map<string, Box>();
  for (let y = 0; y < height; y++) {
    const next = new Map<string, Box>();
    let current: { s: Span; z0: number } | undefined;
    const flush = (z1: number) => {
      if (!current) return;
      const [x0, x1, m] = current.s, key = `${x0},${x1},${current.z0},${z1},${m}`;
      const below = open.get(key);
      if (below) { (below.to as number[])[1] = y + 1; next.set(key, below); open.delete(key); }
      else { const box: Box = { from: [x0, y, current.z0], to: [x1, y + 1, z1], material: m }; done.push(box); next.set(key, box); }
      current = undefined;
    };
    for (let z = 0; z <= length; z++) {
      const s = z < length ? span(y, z) : undefined;
      if (current && s && s[0] === current.s[0] && s[1] === current.s[1] && s[2] === current.s[2]) continue;
      flush(z);
      if (s) current = { s, z0: z };
    }
    open = next;
  }
  for (const box of done) b.add(box.from[0], box.from[1], box.from[2], box.to[0], box.to[1], box.to[2], box.material);
}

/**
 * The fixed hull in its upright frame (HULL.beam × HULL.height × HULL.length): planking, tar, paint, lining,
 * floorboards, thwarts, inwale, rowlock horns and the bow ring. Loose gear is the caller's.
 */
export function hullBoxes(style: StyleKey, variant: BoatVariant): Boxes {
  const { plank, end } = wood(style), paint = HULL_PAINT[style][variant], b = new Boxes();
  const { solid, inner, open } = classes();
  const H = HULL.height, styleIndex = Object.keys(STYLES).indexOf(style);
  // The skin, painted by row. The keel and stem are the one-cell line under and before the planking; the transom
  // board shows its bare wood; the strakes follow the sheer, so their alternation sweeps up at the ends.
  const skin = (y: number, z: number): number => {
    if (y < HULL.tar) return TAR;
    if (halfBreadth(y, z) === 0 || z === 0) return plank;
    if (y === sheer(z) - 1) return paint.top;
    return paint.strakes[(sheer(z) - 2 - y) % 2]!;
  };
  laySpans(b, H, L, (y, z) => { const r = run(x => solid(x, y, z)); return r && [r[0], r[1], skin(y, z)]; });
  // Wear: a few strake cells just above the tar have lost their paint to the planks underneath, near the ends
  // where the boat is pushed off and pulled up.
  for (let z = 1; z < L - 1; z++) {
    if (z > 6 && z < 20) continue;
    for (const side of [0, 1]) {
      const y = HULL.tar, h = halfBreadth(y, z);
      if (h < 2 || hash(styleIndex, variant, z, side, 41) > 0.3) continue;
      const x = side ? MID + h : MID - h;
      if (!inner(x, y, z)) b.add(x, y, z, x + 1, y + 1, z + 1, plank);
    }
  }
  // Bare wood inside: the inner halves of the laps, the inwale, and a lining wherever one plank would show paint.
  laySpans(b, H, L, (y, z) => { const r = run(x => inner(x, y, z)); return r && [r[0], r[1], plank]; });
  laySpans(b, H, L, (y, z) => { const r = run(x => open(x, y, z)); return r && [r[0], r[1], MAT.air]; });
  // Floorboards: the floor row across the whole wooden bottom, in the darker, worn end tone.
  laySpans(b, H, L, (y, z) => {
    if (y > HULL.floor) return undefined;
    const r = run(x => open(x, y, z) || (y === HULL.floor && inner(x, y, z)));
    return r && [r[0], r[1], end];
  });
  // The thwarts span the open boat at one height, let into the lining at both ends.
  for (const [z0, z1] of HULL.thwarts) for (let z = z0; z < z1; z++) {
    const r = run(x => open(x, HULL.thwartRow, z));
    if (!r) throw new Error(`boat hull: no room for a thwart at z ${z}.`);
    b.add(r[0], HULL.thwartRow, z, r[1], HULL.thwartRow + 1, z + 1, plank);
  }
  // Rowlock horns: two brass cells on each inwale with the pin's gap between them.
  const lock = HULL.rowlock, top = sheer(lock);
  for (const z of [lock - 1, lock + 1]) b.pair(HULL.beam, 1, top, z, 2, top + 1, z + 1, MAT.brass);
  // The bow ring through the stem head.
  const [rx, ry, rz] = HULL.ring;
  b.add(rx, ry, rz, rx + 1, ry + 1, rz + 1, MAT.brass);
  return b;
}

/** The hull's own reading of the air in and over the boat, so loose gear can be checked before it is laid. */
export const hullFree = (): Classes['free'] => classes().free;
