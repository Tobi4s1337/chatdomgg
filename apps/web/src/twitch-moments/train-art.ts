import { MAT } from '@chatdom/content';
import type { VoxelBlueprint } from '@chatdom/shared';
import { blueprint, box, field, type BannerKit, type Box } from './banner';

/**
 * The festival train, its track and the street bunting, in build cells (0.125 m), authored for this lane. Every
 * blueprint's origin is its minimum corner; the `*_CELLS` constants say where its pivot and moving parts sit.
 * Rolling stock faces +x, +y is up and z runs across the track with the train's centre line at z 8. y 0 of a car
 * is the rail top.
 *
 * - Locomotive (5.9 m): a tank of the kingdom's cloth colour on a black running board, brass bands, a tall flared
 *   stack, brass dome, a headlamp over the smokebox door, a slatted cowcatcher, a cab with the kingdom's chevron
 *   under its windows and the lead lantern on its roof. Wheels, side rods, main rods and crossheads are parts.
 * - Tender (3 m): the cloth tank lined in gold with a cream coping, heaped with coal.
 * - Carriage (4.5 m): an open festival car, benches under a striped canopy with a scalloped valance and a gold
 *   fringe; two strings of six lanterns hang under each eave; a name board stands on the roof.
 * - Treasure wagon (3.75 m): a flat wagon with lanterns on its corner posts and a banded chest full of coin. The lid
 *   is a part hinged on the chest's back edge; parcels wait inside to stand ready on the bed.
 * - Golden: the same shapes with gold leaf for the cloth, brass for the iron and the canopy in cloth of gold.
 * - Track: one 0.75 m piece of ballast, a timber sleeper and two iron rails; laid end to end round the loop.
 * - Bunting: pennants in the kingdom's three colours on a cream cord, and the steam puff.
 */

export type TrainVariant = 'festival' | 'golden';
export const TRAIN_VARIANTS: readonly TrainVariant[] = ['festival', 'golden'];

interface Livery {
  readonly body: number; readonly lining: number; readonly trim: number; readonly roof: number; readonly iron: number;
  readonly stack: number; readonly rim: number; readonly spoke: number; readonly canopy: number; readonly stripe: number;
  readonly fringe: number; readonly emblem: number;
}
/** The kingdom's cloth with cream and gold trim, or (golden) gold leaf, brass and cloth of gold. */
function livery(kit: BannerKit, variant: TrainVariant): Livery {
  return variant === 'golden'
    ? { body: MAT.goldLeaf, lining: MAT.cream, trim: MAT.cream, roof: MAT.brass, iron: MAT.darkStone, stack: MAT.brass, rim: MAT.goldLeaf, spoke: MAT.goldLeaf,
      canopy: MAT.fabricGold, stripe: MAT.cream, fringe: MAT.brass, emblem: field(kit) }
    : { body: field(kit), lining: MAT.fabricGold, trim: MAT.cream, roof: MAT.darkStone, iron: MAT.darkStone, stack: MAT.darkStone, rim: MAT.brass, spoke: field(kit),
      canopy: field(kit), stripe: MAT.cream, fringe: MAT.goldLeaf, emblem: MAT.cream };
}

/** Rail top above the track's ground line: ballast half sunk, sleeper, rail. Every car stands on it. */
export const RAIL_TOP = 2.5;
/** Wheel planes (cell z) left and right; their centres sit on the rails at z 4.5 and 11.5. */
const WHEEL_Z = [4, 11] as const;

/** Rows of a faceted disc of radius r about (cy, cz) in the y-z plane, as [y, z0, z1] cell runs. */
function discRows(cy: number, cz: number, r: number): [number, number, number][] {
  const rows: [number, number, number][] = [];
  for (let y = Math.floor(cy - r); y < Math.ceil(cy + r); y++) {
    const dy = y + 0.5 - cy;
    if (dy * dy >= r * r) continue;
    const half = Math.sqrt(r * r - dy * dy), z0 = Math.round(cz - half), z1 = Math.round(cz + half);
    if (z1 > z0) rows.push([y, z0, z1]);
  }
  return rows;
}
const disc = (boxes: Box[], x0: number, x1: number, cy: number, cz: number, r: number, material: number) => {
  for (const [y, z0, z1] of discRows(cy, cz, r)) boxes.push(box(x0, y, z0, x1, y + 1, z1, material));
};
/** Both sides of a car share their trim: a box at z and its mirror across the centre line. */
const mirrored = (boxes: Box[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number) => {
  boxes.push(box(x0, y0, z0, x1, y1, z1, material), box(x0, y0, 16 - z1, x1, y1, 16 - z0, material));
};
/** The kingdom's chevron, one roof in three rows, apex row `top`, centred between columns cx - 1 and cx. */
const chevron = (boxes: Box[], cx: number, top: number, z0: number, z1: number, material: number) => {
  for (let i = 0; i < 3; i++) for (const x of [cx - 1 - i, cx + i]) boxes.push(box(x, top - i, z0, x + 1, top - i + 1, z1, material));
};

// ---------------------------------------------------------------- the locomotive

/**
 * Locomotive, cab at x 0, cowcatcher tip at x 47. Pivot: rail top under the middle, (23.5, 0, 8). Wheel centres
 * are [x, y] in the wheel planes; crank pins turn at `crank` cells; the main rod runs forward from the front
 * driver's pin to the crosshead, which slides along y = `axle` under the slide bars.
 */
export const LOCO_CELLS = {
  size: [47, 34, 16] as const, pivot: [23.5, 0, 8] as const, length: 47,
  drivers: [[12.5, 4.5], [24.5, 4.5]] as const, carrying: [[4.5, 3.5], [36.5, 3.5]] as const, wheelZ: WHEEL_Z,
  crank: 2, axle: 4.5, mainRod: 8, sideRodZ: [3, 12] as const, mainRodZ: [2, 13] as const,
  /** Steam leaves the stack top, the whistle and the cylinder cocks (left, right). */
  chimney: [38, 31, 8] as const, whistle: [15.5, 26, 8] as const, cocks: [[41.5, 3.5, 2.5], [41.5, 3.5, 13.5]] as const,
  headlamp: [42.6, 22.5, 8] as const, firebox: [11.8, 13.5, 8] as const,
  /** The lead lantern's glass on the cab roof: its floor centre, height and width; it fills with the level's progress. */
  lead: { base: [8, 27, 8] as const, height: 4, width: 2 },
} as const;

export function locoBlueprint(kit: BannerKit, variant: TrainVariant): VoxelBlueprint {
  const L = livery(kit, variant), iron = L.iron, b: Box[] = [];
  // Frames inside the wheels, beams at both ends and the running board over everything.
  b.push(box(2, 4, 5, 41, 10, 6, iron), box(2, 4, 10, 41, 10, 11, iron));
  b.push(box(0, 5, 1, 1, 10, 15, L.body), box(0, 6, 7, 1, 8, 9, iron));
  b.push(box(40, 5, 1, 42, 10, 15, L.body), box(40, 9, 1, 42, 10, 15, L.lining));
  b.push(box(1, 10, 1, 42, 11, 15, iron));
  mirrored(b, 1, 9, 1, 40, 10, 2, L.body);
  // The cowcatcher: a V of brass and iron slats leaning back from its tip.
  for (let k = 0; k < 5; k++) for (let z = 2 + k; z < 14 - k; z++) b.push(box(42 + k, 1, z, 43 + k, 7 - k, z + 1, z % 2 === 0 ? L.rim : iron));
  b.push(box(42, 6, 2, 43, 7, 14, iron));
  // Cylinders with brass covers, and the slide bars the crossheads run under.
  for (const [z0, z1] of [[1, 4], [12, 15]] as const) {
    b.push(box(36, 3, z0, 41, 7, z1, L.body), box(36, 3, z0, 37, 7, z1, L.rim), box(40, 3, z0, 41, 7, z1, L.rim));
  }
  b.push(box(29, 6, 2, 36, 7, 3, iron), box(29, 6, 13, 36, 7, 14, iron));
  // The boiler in the kingdom's cloth with brass bands; the smokebox and its door.
  disc(b, 14, 36, 16, 8, 5.1, L.body);
  for (const x of [18, 31, 35]) disc(b, x, x + 1, 16, 8, 5.25, L.rim);
  disc(b, 36, 41, 16, 8, 5.3, L.stack);
  disc(b, 41, 42, 16, 8, 3.9, L.rim);
  disc(b, 41, 42, 16, 8, 3.0, L.stack);
  b.push(box(42, 15, 7, 43, 17, 9, L.rim));
  // A tall flared stack with a brass collar and rim.
  b.push(box(36, 20, 6, 40, 27, 10, L.stack), box(35, 25, 5, 41, 26, 11, L.rim));
  b.push(box(35, 27, 5, 41, 28, 11, L.stack), box(34, 28, 4, 42, 30, 12, L.stack), box(34, 30, 4, 42, 31, 12, L.rim), box(36, 28, 6, 40, 31, 10, MAT.air));
  // Dome, sandbox and whistle along the boiler's back.
  b.push(box(26, 20, 6, 30, 23, 10, MAT.brass), box(27, 23, 7, 29, 24, 9, MAT.brass));
  b.push(box(20, 20, 6, 23, 22, 10, L.body), box(20, 22, 7, 23, 23, 9, L.lining));
  b.push(box(15, 20, 7, 16, 25, 9, MAT.brass), box(15, 25, 7, 16, 26, 9, L.rim));
  // Headlamp on the smokebox, its lens open for the light.
  b.push(box(39, 21, 6, 42, 24, 10, L.stack), box(42, 21, 6, 43, 24, 10, L.rim), box(42, 22, 7, 43, 23, 9, MAT.air), box(40, 24, 7, 41, 25, 9, L.rim));
  // The cab: cloth walls lined in gold with the kingdom's chevron under the windows, a firehole door inside.
  b.push(box(1, 11, 1, 14, 24, 2, L.body), box(1, 11, 14, 14, 24, 15, L.body), box(13, 11, 1, 14, 24, 15, L.body), box(1, 11, 1, 2, 15, 15, L.body));
  b.push(box(3, 16, 1, 11, 22, 2, MAT.air), box(3, 16, 14, 11, 22, 15, MAT.air));
  b.push(box(13, 18, 3, 14, 21, 6, MAT.air), box(13, 18, 10, 14, 21, 13, MAT.air));
  mirrored(b, 2, 11, 1, 13, 12, 2, L.lining);
  mirrored(b, 2, 15, 1, 13, 16, 2, L.lining);
  chevron(b, 8, 14, 1, 2, L.emblem);
  chevron(b, 8, 14, 14, 15, L.emblem);
  mirrored(b, 1, 12, 0, 2, 22, 1, MAT.brass);
  b.push(box(12, 12, 6, 13, 15, 10, iron));
  // Roof with cream edges.
  b.push(box(0, 24, 0, 15, 25, 16, L.roof), box(0, 25, 2, 15, 26, 14, L.roof));
  mirrored(b, 0, 24, 0, 15, 25, 1, L.trim);
  // The lead lantern: a brass cage on the roof, its glass left open for the light that fills it.
  b.push(box(6, 26, 6, 10, 27, 10, MAT.brass));
  for (const x of [6, 9]) for (const z of [6, 9]) b.push(box(x, 27, z, x + 1, 31, z + 1, MAT.brass));
  b.push(box(6, 31, 6, 10, 32, 10, L.rim), box(7, 32, 7, 9, 33, 9, MAT.brass), box(7, 33, 7, 8, 34, 8, L.rim));
  return blueprint(`moment-train-${kit}-${variant}-loco`, kit, [47, 34, 16], b);
}

/** A driving wheel, 9 across: iron tyre and eight cloth spokes, a dark counterweight opposite the brass crank pin. Pivot (4.5, 4.5, 0.5). */
export const DRIVER_CELLS = { size: [9, 9, 1] as const, pivot: [4.5, 4.5, 0.5] as const, radius: 4.5 } as const;
export function driverBlueprint(kit: BannerKit, variant: TrainVariant): VoxelBlueprint {
  const L = livery(kit, variant), b: Box[] = [];
  for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) {
    const dx = x - 4, dy = y - 4, r = Math.hypot(dx, dy);
    if (r > 4.6) continue;
    let m: number = MAT.air;
    if (r > 3.55) m = L.iron;
    else if (dx === 2 && dy === 0) m = MAT.brass;
    else if (r < 0.6) m = MAT.brass;
    else if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) m = L.spoke;
    else if (dx <= -2) m = L.iron;
    if (m !== MAT.air) b.push(box(x, y, 0, x + 1, y + 1, 1, m));
  }
  return blueprint(`moment-train-${kit}-${variant}-driver`, kit, [9, 9, 1], b);
}

/** A carrying wheel, 7 across with four spokes; used by the locomotive's trucks, the tender and every car. Pivot (3.5, 3.5, 0.5). */
export const WHEEL_CELLS = { size: [7, 7, 1] as const, pivot: [3.5, 3.5, 0.5] as const, radius: 3.5 } as const;
export function wheelBlueprint(kit: BannerKit, variant: TrainVariant): VoxelBlueprint {
  const L = livery(kit, variant), b: Box[] = [];
  for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) {
    const dx = x - 3, dy = y - 3, r = Math.hypot(dx, dy);
    if (r > 3.6) continue;
    const m = r > 2.4 ? L.iron : r < 0.6 ? MAT.brass : dx === 0 || dy === 0 ? L.spoke : MAT.air;
    if (m !== MAT.air) b.push(box(x, y, 0, x + 1, y + 1, 1, m));
  }
  return blueprint(`moment-train-${kit}-${variant}-wheel`, kit, [7, 7, 1], b);
}

/** Side rod between the two crank pins, 12 cells apart; brass bosses at the pins. Pivot: the rear pin, (0.5, 0.5, 0.5). */
export const SIDE_ROD_CELLS = { size: [13, 1, 1] as const, pivot: [0.5, 0.5, 0.5] as const } as const;
export function sideRodBlueprint(kit: BannerKit): VoxelBlueprint {
  return blueprint(`moment-train-${kit}-side-rod`, kit, [13, 1, 1], [box(0, 0, 0, 13, 1, 1, MAT.darkStone), box(0, 0, 0, 1, 1, 1, MAT.brass), box(12, 0, 0, 13, 1, 1, MAT.brass)]);
}
/** Main rod: from the crank pin (pivot, (0.5, 0.5, 0.5)) forward 8 cells to the crosshead. */
export const MAIN_ROD_CELLS = { size: [9, 1, 1] as const, pivot: [0.5, 0.5, 0.5] as const } as const;
export function mainRodBlueprint(kit: BannerKit): VoxelBlueprint {
  return blueprint(`moment-train-${kit}-main-rod`, kit, [9, 1, 1], [box(0, 0, 0, 9, 1, 1, MAT.brass), box(1, 0, 0, 8, 1, 1, MAT.darkStone)]);
}
/** Crosshead with its piston rod reaching forward into the cylinder. Pivot: the crosshead's middle, (1, 1, 0.5). */
export const CROSSHEAD_CELLS = { size: [8, 2, 1] as const, pivot: [1, 1, 0.5] as const } as const;
export function crossheadBlueprint(kit: BannerKit): VoxelBlueprint {
  return blueprint(`moment-train-${kit}-crosshead`, kit, [8, 2, 1], [box(0, 0, 0, 2, 2, 1, MAT.brass), box(2, 1, 0, 8, 2, 1, MAT.limestone)]);
}

// ---------------------------------------------------------------- the tender

/** Tender, front (+x) to the cab. Pivot (12, 0, 8). Three axles. */
export const TENDER_CELLS = { size: [24, 21, 16] as const, pivot: [12, 0, 8] as const, length: 24, wheels: [4.5, 12.5, 19.5] as const, wheelZ: WHEEL_Z } as const;
export function tenderBlueprint(kit: BannerKit, variant: TrainVariant): VoxelBlueprint {
  const L = livery(kit, variant), iron = L.iron, b: Box[] = [];
  b.push(box(1, 7, 2, 23, 8, 14, iron));
  mirrored(b, 1, 3, 3, 23, 5, 4, iron);
  for (const x of [4, 12, 19]) mirrored(b, x, 3, 2, x + 1, 5, 3, MAT.brass);
  b.push(box(0, 5, 1, 1, 9, 15, L.body), box(23, 5, 3, 24, 9, 13, L.body), box(0, 6, 7, 1, 8, 9, iron));
  // The tank lined in gold, the kingdom's chevron on each flank.
  b.push(box(1, 8, 1, 23, 16, 15, L.body));
  for (const y of [9, 14]) mirrored(b, 2, y, 1, 22, y + 1, 2, L.lining);
  for (const x of [2, 21]) mirrored(b, x, 9, 1, x + 1, 15, 2, L.lining);
  chevron(b, 12, 13, 1, 2, L.emblem);
  chevron(b, 12, 13, 14, 15, L.emblem);
  // Cream coping flared one cell out, coal heaped inside it, the water filler at the back.
  b.push(box(0, 16, 0, 24, 17, 16, L.trim), box(2, 16, 2, 22, 17, 14, MAT.air));
  for (let x = 6; x < 22; x++) for (let z = 2; z < 14; z++) {
    const h = Math.round(3.4 - 0.16 * Math.abs(x - 13) - 0.42 * Math.abs(z - 7.5)) + ((x * 7 + z * 13) % 5 === 0 ? 1 : 0);
    for (let y = 0; y < Math.max(1, h); y++) b.push(box(x, 16 + y, z, x + 1, 17 + y, z + 1, (x * 3 + z * 5 + y) % 4 === 0 ? MAT.hairBlack : MAT.darkStone));
  }
  b.push(box(2, 16, 2, 6, 17, 14, L.body), box(2, 17, 6, 5, 18, 10, MAT.brass), box(3, 18, 7, 4, 19, 9, L.rim));
  // Tool lockers at the front corners.
  for (const [z0, z1] of [[2, 5], [11, 14]] as const) b.push(box(21, 17, z0, 23, 19, z1, L.body), box(21, 19, z0, 23, 20, z1, L.rim));
  return blueprint(`moment-train-${kit}-${variant}-tender`, kit, [24, 21, 16], b);
}

// ---------------------------------------------------------------- the carriage

const CORDS: readonly (readonly [number, number])[] = [[1.5, 17.5], [17.5, 34.5]];
/** Cord height (cell row) at column x of a span: 20 at the posts, sagging to 18 midway. */
const cordY = (x: number, [x0, x1]: readonly [number, number]) => { const u = (x + 0.5 - x0) / (x1 - x0); return Math.round(20 - 2 * 4 * u * (1 - u)); };
const LANTERN_X: readonly number[] = CORDS.flatMap(([x0]) => [x0 + 3.5, x0 + 7.5, x0 + 11.5].map(Math.floor));

/**
 * Carriage, 36 long. Pivot (18, 0, 8). Two bogies of two axles. `lanterns` are the glass cell centres of the
 * twelve lanterns under the eaves (left string then right); `nameplate` is just above the roof's name board.
 */
export const CAR_CELLS = {
  size: [36, 32, 16] as const, pivot: [18, 0, 8] as const, length: 36, wheels: [5, 11, 25, 31] as const, wheelZ: WHEEL_Z,
  lanterns: [0, 15].flatMap(z => LANTERN_X.map(x => [x + 0.5, cordY(x, CORDS[x < 17 ? 0 : 1]!) - 1.5, z + 0.5] as const)),
  nameplate: [18, 33.5, 8] as const,
} as const;

export function carriageBlueprint(kit: BannerKit, variant: TrainVariant): VoxelBlueprint {
  const L = livery(kit, variant), iron = L.iron, b: Box[] = [];
  // Underframe, buffer beams and two bogies.
  b.push(box(1, 7, 2, 35, 8, 14, iron), box(0, 6, 2, 1, 9, 14, L.body), box(35, 6, 2, 36, 9, 14, L.body));
  for (const x0 of [2, 22]) {
    mirrored(b, x0, 2, 3, x0 + 12, 5, 4, iron);
    b.push(box(x0 + 4, 5, 5, x0 + 8, 7, 11, iron));
    for (const x of [x0 + 3, x0 + 9]) mirrored(b, x - 1, 3, 2, x + 1, 4, 3, MAT.brass);
  }
  // Floor, cloth side panels lined in gold, a cream cap rail, the chevron in the middle of each flank.
  b.push(box(1, 8, 1, 35, 9, 15, MAT.timber));
  mirrored(b, 1, 9, 1, 35, 14, 2, L.body);
  b.push(box(1, 9, 1, 2, 14, 15, L.body), box(34, 9, 1, 35, 14, 15, L.body));
  mirrored(b, 2, 13, 1, 34, 14, 2, L.lining);
  mirrored(b, 2, 9, 1, 34, 10, 2, L.lining);
  mirrored(b, 0, 14, 0, 36, 15, 2, L.trim);
  b.push(box(0, 14, 2, 2, 15, 14, L.trim), box(34, 14, 2, 36, 15, 14, L.trim));
  chevron(b, 18, 12, 1, 2, L.emblem);
  chevron(b, 18, 12, 14, 15, L.emblem);
  // Benches across the car, backs to the rear.
  for (const x of [4, 10, 16, 22, 28]) {
    b.push(box(x, 11, 3, x + 3, 12, 13, MAT.timber), box(x, 12, 3, x + 1, 15, 13, MAT.bark));
    for (const z of [3, 12]) b.push(box(x + 1, 9, z, x + 2, 11, z + 1, MAT.bark));
  }
  // Brass posts carry a striped canopy with a crown, its valance scalloped and fringed in gold.
  for (const x of [1, 17, 34]) for (const z of [1, 14]) b.push(box(x, 15, z, x + 1, 23, z + 1, MAT.brass));
  for (let x = 0; x < 36; x++) {
    const stripe = Math.floor(x / 3) % 2 === 0 ? L.canopy : L.stripe;
    b.push(box(x, 23, 0, x + 1, 24, 16, stripe), box(x, 24, 2, x + 1, 25, 14, stripe), box(x, 25, 5, x + 1, 26, 11, stripe));
    const deep = x % 4 === 1 || x % 4 === 2, cloth = Math.floor(x / 4) % 2 === 0 ? L.canopy : L.stripe;
    for (const z of [0, 15]) {
      if (deep) b.push(box(x, 22, z, x + 1, 23, z + 1, cloth), box(x, 21, z, x + 1, 22, z + 1, L.fringe));
      else b.push(box(x, 22, z, x + 1, 23, z + 1, L.fringe));
    }
  }
  for (let z = 1; z < 15; z++) {
    const deep = z % 4 === 1 || z % 4 === 2;
    for (const x of [0, 35]) {
      if (deep) b.push(box(x, 22, z, x + 1, 23, z + 1, L.canopy), box(x, 21, z, x + 1, 22, z + 1, L.fringe));
      else b.push(box(x, 22, z, x + 1, 23, z + 1, L.fringe));
    }
  }
  // Lantern strings under both eaves: a dark cord sagging between the posts, a brass cap and foot to each lantern.
  for (const z of [0, 15]) {
    for (const span of CORDS) for (let x = Math.ceil(span[0]); x < Math.floor(span[1]); x++) b.push(box(x, cordY(x, span), z, x + 1, cordY(x, span) + 1, z + 1, MAT.darkStone));
    for (const x of LANTERN_X) {
      const y = cordY(x, CORDS[x < 17 ? 0 : 1]!);
      b.push(box(x, y - 1, z, x + 1, y, z + 1, MAT.brass), box(x, y - 3, z, x + 1, y - 2, z + 1, MAT.brass));
    }
  }
  // The name board on the roof: cream in a gold frame, painted with the kingdom's chevron.
  b.push(box(12, 26, 7, 13, 27, 9, MAT.brass), box(23, 26, 7, 24, 27, 9, MAT.brass));
  b.push(box(10, 27, 7, 26, 32, 9, MAT.cream), box(10, 27, 7, 26, 28, 9, L.rim), box(10, 31, 7, 26, 32, 9, L.rim));
  b.push(box(10, 27, 7, 11, 32, 9, L.rim), box(25, 27, 7, 26, 32, 9, L.rim));
  chevron(b, 18, 30, 7, 9, field(kit));
  return blueprint(`moment-train-${kit}-${variant}-carriage`, kit, [36, 32, 16], b);
}

// ---------------------------------------------------------------- the treasure wagon

/**
 * Treasure wagon, 30 long. Pivot (15, 0, 8). The lid's hinge sits on the chest's back top edge at `hinge`; it
 * opens by turning about +x through a negative angle. Parcels rise from `from` (the coin bed) to their `seats`.
 */
export const WAGON_CELLS = {
  size: [30, 19, 16] as const, pivot: [15, 0, 8] as const, length: 30, wheels: [5.5, 24.5] as const, wheelZ: WHEEL_Z,
  hinge: [8, 17, 3] as const, open: 1.95,
  lanterns: [[1.5, 17.5, 1.5], [28.5, 17.5, 1.5], [1.5, 17.5, 14.5], [28.5, 17.5, 14.5]] as const,
  from: [15, 13, 8] as const,
  seats: [[4.5, 9, 4.5], [4.5, 9, 11.5], [25.5, 9, 4.5], [25.5, 9, 11.5], [11.5, 13, 8], [18.5, 13, 8]] as const,
} as const;

export function wagonBlueprint(kit: BannerKit, variant: TrainVariant): VoxelBlueprint {
  const L = livery(kit, variant), iron = L.iron, b: Box[] = [];
  b.push(box(1, 7, 2, 29, 8, 14, iron), box(0, 6, 2, 1, 9, 14, L.body), box(29, 6, 2, 30, 9, 14, L.body));
  mirrored(b, 2, 3, 3, 28, 5, 4, iron);
  for (const x of [5, 24]) mirrored(b, x, 3, 2, x + 1, 4, 3, MAT.brass);
  // The bed with low cloth sides under a gold rail; brass posts at the corners carry a lantern each.
  b.push(box(1, 8, 1, 29, 9, 15, MAT.timber));
  mirrored(b, 1, 9, 1, 29, 11, 2, L.body);
  b.push(box(1, 9, 1, 2, 11, 15, L.body), box(28, 9, 1, 29, 11, 15, L.body));
  mirrored(b, 1, 11, 1, 29, 12, 2, L.lining);
  b.push(box(1, 11, 1, 2, 12, 15, L.lining), box(28, 11, 1, 29, 12, 15, L.lining));
  for (const x of [1, 28]) for (const z of [1, 14]) b.push(box(x, 12, z, x + 1, 17, z + 1, MAT.brass), box(x, 18, z, x + 1, 19, z + 1, L.rim));
  // The chest: timber bound in brass, hinges at the back, a gold lock plate at the front, hollow and full of coin.
  b.push(box(8, 9, 3, 22, 17, 13, MAT.timber));
  for (const [x0, x1] of [[8, 9], [14, 16], [21, 22]] as const) b.push(box(x0, 9, 3, x1, 17, 13, MAT.brass));
  b.push(box(8, 9, 3, 22, 10, 13, MAT.bark));
  b.push(box(10, 16, 2, 12, 17, 3, MAT.brass), box(18, 16, 2, 20, 17, 3, MAT.brass), box(14, 13, 13, 16, 16, 14, MAT.goldLeaf));
  b.push(box(9, 11, 4, 21, 17, 12, MAT.air), box(9, 11, 4, 21, 13, 12, MAT.goldLeaf));
  for (const [x, z, m] of [[10, 5, MAT.brass], [13, 9, MAT.brass], [17, 6, MAT.brass], [19, 10, MAT.brass], [16, 8, MAT.fabricRed], [11, 10, MAT.fabricBlue], [20, 5, MAT.fabricGreen]] as const) {
    b.push(box(x, 13, z, x + 1, 14, z + 1, m));
  }
  return blueprint(`moment-train-${kit}-${variant}-wagon`, kit, [30, 19, 16], b);
}

/** The chest lid, domed, hinged along its z 0 bottom edge. Pivot: the hinge line's start, (0, 0, 0). */
export const LID_CELLS = { size: [14, 4, 10] as const, pivot: [0, 0, 0] as const } as const;
export function lidBlueprint(kit: BannerKit): VoxelBlueprint {
  const b: Box[] = [box(0, 0, 0, 14, 2, 10, MAT.timber), box(0, 2, 1, 14, 3, 9, MAT.timber), box(0, 3, 3, 14, 4, 7, MAT.timber)];
  for (const [x0, x1] of [[0, 1], [6, 8], [13, 14]] as const) b.push(box(x0, 0, 0, x1, 2, 10, MAT.brass), box(x0, 2, 1, x1, 3, 9, MAT.brass), box(x0, 3, 3, x1, 4, 7, MAT.brass));
  b.push(box(6, 0, 9, 8, 2, 10, MAT.goldLeaf));
  return blueprint(`moment-train-${kit}-lid`, kit, [14, 4, 10], b);
}

/** A parcel waiting for its home: kraft paper, a ribbon crossed over it and a bow. Pivot: bottom centre, (2.5, 0, 2.5). */
export const READY_PARCEL_CELLS = { size: [5, 4, 5] as const, pivot: [2.5, 0, 2.5] as const, kinds: 3 } as const;
export function readyParcelBlueprint(kit: BannerKit, kind: number): VoxelBlueprint {
  const ribbon = [MAT.fabricGold, MAT.petal, field(kit)][kind % 3]!;
  const b: Box[] = [box(0, 0, 0, 5, 3, 5, MAT.thatch), box(2, 0, 0, 3, 3, 5, ribbon), box(0, 0, 2, 5, 3, 3, ribbon)];
  b.push(box(1, 3, 2, 2, 4, 3, ribbon), box(3, 3, 2, 4, 4, 3, ribbon), box(2, 3, 2, 3, 4, 3, MAT.brass));
  return blueprint(`moment-train-${kit}-parcel-${kind % 3}`, kit, [5, 4, 5], b);
}

// ---------------------------------------------------------------- track, bunting and steam

/** One track piece, 6 cells (0.75 m) along x. Pivot: the ground line at its middle, (3, 0.5, 8). */
export const TRACK_CELLS = { size: [6, 3, 16] as const, pivot: [3, 0.5, 8] as const, length: 6 } as const;
export function trackBlueprint(kit: BannerKit): VoxelBlueprint {
  const b: Box[] = [box(0, 0, 1, 6, 1, 15, MAT.stone)];
  for (const [x, z] of [[1, 3], [4, 9], [2, 13], [5, 6], [0, 11]] as const) b.push(box(x, 0, z, x + 1, 1, z + 1, MAT.limestone));
  b.push(box(1, 1, 2, 3, 2, 14, MAT.timber), box(1, 1, 2, 3, 2, 3, MAT.bark), box(1, 1, 13, 3, 2, 14, MAT.bark));
  for (const z of [4, 11]) b.push(box(0, 2, z, 6, 3, z + 1, MAT.darkStone), box(1, 2, z - 1, 3, 3, z, MAT.darkStone), box(1, 2, z + 1, 3, 3, z + 2, MAT.darkStone));
  return blueprint(`moment-train-${kit}-track`, kit, [6, 3, 16], b);
}

/**
 * A pennant 5 wide hanging 5 rows from its hem, one cell thick. Pivot: the middle of its top edge, (2.5, 5, 0.5).
 * Three colours in turn: the kingdom's field hemmed in gold, cream hemmed in the field, gold hemmed in cream.
 */
export const FLAG_CELLS = { size: [5, 5, 1] as const, pivot: [2.5, 5, 0.5] as const, colours: 3 } as const;
export function flagBlueprint(kit: BannerKit, colour: number): VoxelBlueprint {
  const [cloth, hem] = ([[field(kit), MAT.fabricGold], [MAT.cream, field(kit)], [MAT.fabricGold, MAT.cream]] as const)[colour % 3]!;
  const b: Box[] = [box(0, 4, 0, 5, 5, 1, hem), box(0, 3, 0, 5, 4, 1, cloth), box(1, 1, 0, 4, 3, 1, cloth), box(2, 0, 0, 3, 1, 1, cloth)];
  return blueprint(`moment-bunting-${kit}-flag-${colour % 3}`, kit, [5, 5, 1], b);
}

/** A metre of cream cord, laid along x. Pivot: its start, (0, 0.5, 0.5); the view stretches it along x only. */
export const CORD_CELLS = { size: [8, 1, 1] as const, pivot: [0, 0.5, 0.5] as const, length: 8 } as const;
export function cordBlueprint(kit: BannerKit): VoxelBlueprint {
  return blueprint(`moment-bunting-${kit}-cord`, kit, [8, 1, 1], [box(0, 0, 0, 8, 1, 1, MAT.cream)]);
}

/** A steam puff: a cream blob with its corners knocked off and a greyer belly. Pivot: its centre, (2, 2, 2). */
export const PUFF_CELLS = { size: [4, 4, 4] as const, pivot: [2, 2, 2] as const } as const;
export function puffBlueprint(kit: BannerKit): VoxelBlueprint {
  const b: Box[] = [box(0, 0, 0, 4, 4, 4, MAT.cream), box(1, 0, 1, 3, 1, 3, MAT.plaster)];
  for (const x of [0, 3]) for (const y of [0, 3]) for (const z of [0, 3]) b.push(box(x, y, z, x + 1, y + 1, z + 1, MAT.air));
  return blueprint(`moment-train-${kit}-puff`, kit, [4, 4, 4], b);
}

export interface TrainSet {
  readonly loco: VoxelBlueprint; readonly tender: VoxelBlueprint; readonly carriage: VoxelBlueprint; readonly wagon: VoxelBlueprint;
  readonly driver: VoxelBlueprint; readonly wheel: VoxelBlueprint;
}
export function trainSet(kit: BannerKit, variant: TrainVariant): TrainSet {
  return { loco: locoBlueprint(kit, variant), tender: tenderBlueprint(kit, variant), carriage: carriageBlueprint(kit, variant), wagon: wagonBlueprint(kit, variant),
    driver: driverBlueprint(kit, variant), wheel: wheelBlueprint(kit, variant) };
}

/** Every train, track, bunting and steam part, both variants, for meshing up front. */
export function trainParts(kit: BannerKit): VoxelBlueprint[] {
  return [
    ...TRAIN_VARIANTS.flatMap(variant => Object.values(trainSet(kit, variant))),
    sideRodBlueprint(kit), mainRodBlueprint(kit), crossheadBlueprint(kit), lidBlueprint(kit),
    ...Array.from({ length: READY_PARCEL_CELLS.kinds }, (_, i) => readyParcelBlueprint(kit, i)),
    trackBlueprint(kit), ...Array.from({ length: FLAG_CELLS.colours }, (_, i) => flagBlueprint(kit, i)), cordBlueprint(kit), puffBlueprint(kit),
  ];
}
