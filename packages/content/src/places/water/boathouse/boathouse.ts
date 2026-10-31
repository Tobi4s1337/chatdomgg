import type { Vec3 } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, STYLES, type StyleKey } from '../../../materials';
import { IRON, checkStyle, checkWhole, coursed, masonry, millBlueprint, runs, stroke, wood, type Wood } from '../millrace/craft';
import { NO_METADATA, type ClearVolume, type Footing, type WaterPiece, type WalkStrip } from '../place-piece';
import { hash } from '../shore/shape';
import { layOars, layLifebuoy, layRopeCoil } from './accents';
import { LENGTH, SPAN, layRoof, layVergeTimbers, roofTop, ridgeTop, vaneTop, SLAB } from './roof';

/**
 * The Tide boathouse on the lake shore, in one frame: 64 cells across (X) by 88 deep (Z). Its back (z = 0) stands
 * on the shore and its open end (+Z) over the lake; y = 0 is the host's datum at the deepest pile's bed, and the
 * lake surface lies on the plane y = water. A coursed stone back wall carries the back gable; timber-framed,
 * boarded side walls stand on piles over the water under a steep slate roof that oversails them; down the middle
 * runs the open water bay, with a staging either side and a stone slipway at its back. Everything is in build cells.
 */

export interface BoathouseSite {
  /** Whole cells from the piece's y = 0 up to the lake surface. */
  readonly water: number;
  /** Ground or bed height in cells above y = 0 at the centre of local column (x, z), x 0..63, z 0..87 (fractional is fine). */
  readonly ground: (x: number, z: number) => number;
}

/** Heights above the lake surface, in cells. */
const DECK = 6;
const LINTEL = 22;
const LOFT = 24;
const EAVES = 28;
/** Admitted water: a bay needs four cells at its mouth, and the back stands at most two cells under water. */
const WATER: readonly [number, number] = [4, 48];
/** A 3.5 m rowing boat needs four metres of water bay in front of the slipway. */
const MIN_BAY = 32;

/** Side-wall posts (each two cells along Z), the bay-edge piles under the stagings, and the walls' z run. */
const POSTS = [6, 19, 32, 45, 58, 71] as const;
const EDGE_PILES = [19, 32, 45, 58, 71] as const;
const WALLS: readonly [number, number] = [6, 80];
/** The coursed back wall, the stone landing inside it and the slipway's first row. */
const BACK: readonly [number, number] = [2, 6];
const LANDING: readonly [number, number] = [6, 10];
/** The front wall's boards; its frame (posts, lintel, girt) stands one cell proud, at z = 82. */
const FRONT: readonly [number, number] = [80, 82];
const PROUD = 82;
/** The side door in the west wall at the shore end: its z run and clear height over the staging. */
const DOOR: readonly [number, number] = [10, 18];
const DOOR_HEIGHT = 17;
/** Boards are three cells high; the top row of each is sunk a cell, the shadow under the board above it. */
const BOARD = 3;
const SEED: Readonly<Record<StyleKey, number>> = { hearth: 113, tide: 223, grove: 331 };

/** A pile's id and footprint; it runs from the bed to the timber it carries. */
export interface PileSpot { readonly id: string; readonly x: readonly [number, number]; readonly z: readonly [number, number] }
type Carries = 'plate' | 'bearer' | 'lintel' | 'canopy';

const mirror = (x: readonly [number, number]): [number, number] => [SPAN - x[1], SPAN - x[0]];
const PILES: readonly (PileSpot & { readonly carries: Carries })[] = (['west', 'east'] as const).flatMap(side => {
  const flip = (x: readonly [number, number]) => (side === 'east' ? mirror(x) : [...x] as [number, number]);
  return [
    ...POSTS.map(z => ({ id: `${side}-post-${z}`, x: flip([2, 4]), z: [z, z + 2] as const, carries: 'plate' as const })),
    { id: `${side}-corner`, x: flip([2, 4]), z: [FRONT[0], PROUD + 1] as const, carries: 'plate' as const },
    ...EDGE_PILES.map(z => ({ id: `${side}-edge-${z}`, x: flip([15, 17]), z: [z, z + 2] as const, carries: 'bearer' as const })),
    { id: `${side}-jamb`, x: flip([15, 17]), z: [FRONT[0], PROUD + 1] as const, carries: 'lintel' as const },
    { id: `${side}-canopy`, x: flip([2, 4]), z: [LENGTH - 2, LENGTH] as const, carries: 'canopy' as const },
  ];
});

export const BOATHOUSE = {
  /** X by Z in cells; the piece's size is [64, water + heightAboveWater, 88]. */
  footprint: [SPAN, LENGTH] as const,
  heightAboveWater: vaneTop(EAVES),
  /** The stagings' tread, the bay's clear head under the lintel, the loft ceiling and the wall plate's top. */
  deckAboveWater: DECK,
  lintelAboveWater: LINTEL,
  loftAboveWater: LOFT,
  eavesAboveWater: EAVES,
  /** The ridge roll's top at both gables; the settled middle sits one cell lower. */
  ridgeAboveWater: ridgeTop(EAVES),
  water: WATER,
  /** The open water bay's clear x run (half-open); the slipway and the fenders sit in the slot either side of it. */
  bay: { x: [18, 46] as const, slot: [17, 47] as const, minLength: MIN_BAY },
  stagings: { west: [5, 17] as const, east: [47, 59] as const, z: [LANDING[1], FRONT[0]] as const },
  backWall: { z: BACK },
  frontWall: { z: FRONT },
  /** Every pile's footprint: the host sets y = 0 at the floor of the lowest bed sample under these and the walls. */
  piles: PILES.map(({ id, x, z }) => ({ id, x, z })) as readonly PileSpot[],
} as const;

/** A representative shore: ten cells of water, ground from 14 at the back to the bed under the mouth. */
export const BOATHOUSE_REVIEW_SITE: BoathouseSite = {
  water: 10,
  ground: (x, z) => Math.max(0, 14 * Math.max(0, 1 - (z + 0.5) / LENGTH) ** 0.8 + 0.4 * ((x + 0.5) / SPAN - 0.5)
    + 0.25 * Math.sin(0.37 * x + 0.21 * z) * (1 - z / LENGTH)),
};

/** The board tones: the kit's wall, an odd replaced board, and a patch in bare timber. */
function boards(style: StyleKey, timber: Wood) {
  const wall = STYLES[style].wall;
  return { wall, odd: wall === MAT.cream ? STYLES[style].stone : MAT.cream, patch: timber.plank };
}

/** The deck's second plank tone (Grove's bark has no paler kin in its palette, so its deck is one wood). */
const plankAlt = (style: StyleKey): number | undefined => (style === 'grove' ? undefined : MAT.earth);

interface Frame {
  readonly w: number;
  readonly deck: number;
  readonly E: number;
  readonly g: (x: number, z: number) => number;
  readonly lo: (x0: number, x1: number, z0: number, z1: number) => number;
  readonly hi: (x0: number, x1: number, z0: number, z1: number) => number;
}

/** Reads the site once into a grid, refusing anything the boathouse cannot honestly stand on. */
function frame(site: BoathouseSite): Frame {
  const w = site.water;
  checkWhole('boathouse', 'water', w, WATER[0], WATER[1]);
  const grid = new Float64Array(SPAN * LENGTH);
  for (let z = 0; z < LENGTH; z++) for (let x = 0; x < SPAN; x++) {
    const v = site.ground(x, z);
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`boathouse: ground at ${x},${z} must be a height at or above y = 0, not ${v}.`);
    grid[x + SPAN * z] = v;
  }
  const g = (x: number, z: number) => grid[x + SPAN * z]!;
  const fold = (pick: (a: number, b: number) => number, start: number) => (x0: number, x1: number, z0: number, z1: number) => {
    let v = start;
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) v = pick(v, g(x, z));
    return v;
  };
  const lo = fold(Math.min, Infinity), hi = fold(Math.max, -Infinity), deck = w + DECK;
  const back = lo(2, SPAN - 2, 0, 8);
  if (back < w - 2) throw new RangeError(`boathouse: the back stands ${(w - back).toFixed(2)} cells under water; it must stand on the shore (at most 2).`);
  const mouth = hi(18, 46, LENGTH - 4, LENGTH);
  if (w - mouth < 4) throw new RangeError(`boathouse: the bay's mouth has ${(w - mouth).toFixed(2)} cells of water; a boat needs 4.`);
  const inside = hi(2, SPAN - 2, WALLS[0], WALLS[1]);
  if (inside > deck - 1) {
    throw new RangeError(`boathouse: the ground inside rises to ${inside.toFixed(2)}, above the stagings' tread at ${deck - 1}.`);
  }
  return { w, deck, E: w + EAVES, g, lo, hi };
}

interface SlipRow { readonly z: number; readonly base: number; readonly top: number }

/**
 * The slipway down the bay from the landing: one cell down every three rows, paved over the shore wherever the
 * shore stands higher, until it is two cells under water. Each row is level across the slot and founded on its
 * lowest bed sample.
 */
function slipRows(f: Frame): SlipRow[] {
  const rows: SlipRow[] = [];
  for (let z = LANDING[1]; z < FRONT[0]; z++) {
    const base = Math.floor(f.lo(17, 47, z, z + 1));
    const ramp = f.deck - 1 - Math.floor((z - LANDING[1]) / 3);
    const top = Math.max(ramp, Math.ceil(f.hi(17, 47, z, z + 1)), base + 1);
    rows.push({ z, base, top });
    if (top <= f.w - 2) break;
  }
  const end = rows.at(-1)!.z + 1;
  if (LENGTH - end < MIN_BAY) {
    throw new RangeError(`boathouse: the shore runs ${end} cells into the bay, leaving ${LENGTH - end} of water; a boat needs ${MIN_BAY}.`);
  }
  return rows;
}

/**
 * The boathouse for one kit on one site. Tide's is the lake's: cream boards in a timber frame, coursed grey stone
 * and slate. Under its roof the stagings, the slipway and the bay stay open to the lake from the water up to the
 * big lintel; the front gable carries a dark loft door and a hoist beam, the front apex a brass fish. A side door
 * opens on the west staging at the shore end; a coil of rope hangs beside it, oars on the east wall and a ring
 * buoy on the front. It claims no presence: no windows, no glass and no lamps.
 */
export function createBoathouse(style: StyleKey, site: BoathouseSite): WaterPiece {
  checkStyle('boathouse', style);
  const f = frame(site), { w, deck, E } = f, rows = slipRows(f), slipEnd = rows.at(-1)!.z + 1;
  const kit = STYLES[style], b = new Boxes(), seed = SEED[style], tones = masonry(style), timber = wood(style);
  const board = boards(style, timber), H = w + BOATHOUSE.heightAboveWater, loft = w + LOFT, lintel = w + LINTEL;
  const footings: Footing[] = [];
  const both = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: number) => b.pair(SPAN, x0, y0, z0, x1, y1, z1, m);

  // --- The loft and gables: solid from the loft ceiling up into the roof ------------------------------------------------
  for (let x = 3; x < SPAN - 3; x++) b.add(x, loft, BACK[0], x + 1, roofTop(E, x) - SLAB, PROUD, board.wall);
  b.add(5, loft, LANDING[0], SPAN - 5, loft + 1, FRONT[0], timber.plank);

  // --- Boarded walls -------------------------------------------------------------------------------------------------
  both(3, 5, deck - 3, loft, WALLS[0], WALLS[1], board.wall);
  both(3, 17, deck - 3, loft, FRONT[0], FRONT[1], board.wall);

  // --- The back wall: coursed stone bedded on the shore, carrying the back gable --------------------------------------
  const backBase = Math.floor(f.lo(2, SPAN - 2, BACK[0], BACK[1]));
  b.add(2, backBase, BACK[0], SPAN - 2, E, BACK[1], tones.stone);
  const foot = Math.ceil(f.hi(2, SPAN - 2, BACK[0], BACK[1]));
  coursed(b, { normal: 'z', layer: BACK[0], span: [2, SPAN - 2], y: [backBase, E], seed, wetTo: w + 1, mossTo: foot + 6 }, tones);
  for (const [layer, i] of [[2, 1], [SPAN - 3, 2]] as const) {
    coursed(b, { normal: 'x', layer, span: BACK, y: [backBase, E], seed: seed + i, wetTo: w + 1, mossTo: foot + 6 }, tones);
  }
  // Its inner face, seen through the bay's mouth over the landing.
  coursed(b, { normal: 'z', layer: BACK[1] - 1, span: [5, SPAN - 5], y: [deck, loft], seed: seed + 3 }, tones);
  footings.push({ id: 'back-wall', box: { from: [2, backBase, BACK[0]], to: [SPAN - 2, backBase + 1, BACK[1]] } });

  // --- The landing and the slipway -------------------------------------------------------------------------------------
  const landBase = Math.floor(f.lo(5, SPAN - 5, LANDING[0], LANDING[1]));
  b.add(5, landBase, LANDING[0], SPAN - 5, deck, LANDING[1], tones.stone);
  for (let i = 0; i < 6; i++) {
    const x = 6 + Math.floor(hash(seed, i, 20) * 46), z = LANDING[0] + 2 * Math.floor(hash(seed, i, 21) * 2);
    b.add(x, deck - 1, z, x + 3 + Math.floor(hash(seed, i, 22) * 4), deck, z + 2, tones.band);
  }
  footings.push({ id: 'landing', box: { from: [5, landBase, LANDING[0]], to: [SPAN - 5, landBase + 1, LANDING[1]] } });
  // Rows that share a bed and a top are laid as one box; the paving and the keel runner follow each row.
  const groups: { z0: number; z1: number; base: number; top: number }[] = [];
  for (const r of rows) {
    const last = groups.at(-1);
    if (last && last.base === r.base && last.top === r.top) last.z1 = r.z + 1;
    else groups.push({ z0: r.z, z1: r.z + 1, base: r.base, top: r.top });
  }
  for (const s of groups) b.add(17, s.base, s.z0, 47, s.top, s.z1, tones.stone);
  for (const r of rows) {
    const wet = r.top <= w + 1, y = r.top - 1;
    if (wet) b.add(17, y, r.z, 47, r.top, r.z + 1, tones.wet);
    // Setts: an odd one in each row, and weed where the water laps the slip.
    const x = 18 + Math.floor(hash(seed, r.z, 23) * 24);
    if (!wet) b.add(x, y, r.z, x + 3 + Math.floor(hash(seed, r.z, 24) * 3), r.top, r.z + 1, tones.band);
    if (r.top >= w - 1 && r.top <= w + 2) b.add(x, y, r.z, x + 2 + Math.floor(hash(seed, r.z, 25) * 4), r.top, r.z + 1, MAT.moss);
  }
  for (const s of groups) b.add(31, s.top, s.z0, 33, s.top + 1, s.z1, s.top <= w + 1 ? timber.end : timber.plank);
  // The slip bears on its bed in runs of rows that share one: a footing for each run.
  for (let i = 0; i < rows.length;) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1]!.base === rows[i]!.base) j++;
    const { z, base } = rows[i]!;
    footings.push({ id: `slip-${z}`, box: { from: [17, base, z], to: [47, base + 1, rows[j]!.z + 1] } });
    i = j + 1;
  }

  // --- Shadow lines, odd boards, the patch and the missing board --------------------------------------------------------
  for (let y = deck - 1; y < E; y += BOARD) both(3, 4, y, y + 1, WALLS[0], WALLS[1], MAT.air);
  for (let y = deck - 1; y < roofTop(E, SPAN / 2) - SLAB; y += BOARD) {
    if (y < loft) both(3, 17, y, y + 1, FRONT[1] - 1, FRONT[1], MAT.air);
    else b.add(3, y, FRONT[1] - 1, SPAN - 3, y + 1, FRONT[1], MAT.air);
    if (y >= E) b.add(3, y, BACK[0], SPAN - 3, y + 1, BACK[0] + 1, MAT.air);
  }
  for (const [side, sx] of [[0, 3], [1, SPAN - 4]] as const) for (let i = 0; i < 3; i++) {
    const k = 1 + Math.floor(hash(seed, side, i, 30) * 6), z = 8 + Math.floor(hash(seed, side, i, 31) * 58);
    const y = deck - 3 + BOARD * k;
    b.add(sx, y, z, sx + 1, y + 2, z + 8 + Math.floor(hash(seed, side, i, 32) * 8), board.odd);
  }
  const patchY = deck - 3 + BOARD * 3;
  b.add(SPAN - 4, patchY, 24, SPAN - 3, patchY + 2, 30, board.patch);
  b.add(SPAN - 4, patchY, 24, SPAN - 3, patchY + 1, 25, IRON);
  b.add(SPAN - 4, patchY + 1, 29, SPAN - 3, patchY + 2, 30, IRON);
  const gapY = deck - 3 + BOARD * 5;
  b.add(3, gapY, 37, 5, gapY + 2, 43, MAT.air);

  // --- The back gable's vent and the front gable's loft door --------------------------------------------------------
  const vent = E + 24;
  b.add(29, vent, BACK[0], 35, vent + 3, BACK[0] + 1, MAT.air);
  b.add(29, vent, BACK[0] + 1, 35, vent + 3, BACK[0] + 2, timber.end);
  const door = { x: [26, 38] as const, y: [w + 29, w + 43] as const };
  const [lx0, lx1] = door.x, [ly0, ly1] = door.y;
  b.add(lx0, ly0, FRONT[1] - 1, lx1, ly1, FRONT[1], MAT.air);
  b.add(lx0, ly0, FRONT[0], lx1, ly1, FRONT[0] + 1, timber.end);
  for (const x of [lx0 + 3, lx0 + 6, lx0 + 9]) b.add(x, ly0, FRONT[0], x + 1, ly1, FRONT[0] + 1, timber.plank);
  for (const y of [ly0 + 3, ly1 - 4]) b.add(lx0, y, FRONT[0], lx1, y + 1, FRONT[0] + 1, IRON);
  b.add(lx0 - 1, ly0 - 1, FRONT[1] - 1, lx0, ly1 + 1, PROUD + 1, kit.trim);
  b.add(lx1, ly0 - 1, FRONT[1] - 1, lx1 + 1, ly1 + 1, PROUD + 1, kit.trim);
  b.add(lx0 - 2, ly1, FRONT[1] - 1, lx1 + 2, ly1 + 2, PROUD + 1, kit.trim);
  b.add(lx0 - 2, ly0 - 1, FRONT[1] - 1, lx1 + 2, ly0, PROUD + 2, kit.trim);
  // An owl hole high in the gable, under the ridge beam.
  b.add(30, w + 55, FRONT[1] - 1, 34, w + 58, FRONT[1], MAT.air);
  b.add(30, w + 55, FRONT[0], 34, w + 58, FRONT[0] + 1, timber.end);

  // --- The frame: sill, mid rail and plate proud of the boards; posts on their piles --------------------------------------
  const rail = w + 14;
  both(2, 3, deck - 3, deck - 1, WALLS[0], WALLS[1], kit.trim);
  both(2, 3, rail, rail + 2, WALLS[0], WALLS[1], kit.trim);
  both(2, 3, E - 2, E, WALLS[0], FRONT[0], kit.trim);
  both(2, 4, E - 2, E, FRONT[0], LENGTH, kit.trim);
  both(3, 4, E, E + 2, PROUD, LENGTH, kit.trim);
  // A brace in two panels of each wall, from the sill up to the post under the rail.
  for (const [z0, z1] of [[21, 31], [73, 79]] as const) {
    runs(stroke([z0 + 0.5, deck - 0.5], [z1 + 0.5, rail - 0.5], 0.6), (a, c, y) => both(2, 3, y, y + 1, a, c, kit.trim));
  }
  // Front: the sill and girt across, a stud in the west panel and the great lintel over the bay on its two posts.
  both(2, 17, deck - 3, deck - 1, PROUD, PROUD + 1, kit.trim);
  b.add(2, loft, PROUD, SPAN - 2, loft + 2, PROUD + 1, kit.trim);
  b.add(9, deck - 1, PROUD, 10, loft, PROUD + 1, kit.trim);
  b.add(13, lintel, FRONT[0], SPAN - 13, lintel + 4, PROUD + 1, kit.trim);
  for (const x of [13, SPAN - 14]) b.add(x, lintel, FRONT[0], x + 1, lintel + 4, PROUD + 1, timber.end);
  // The loft's joists across the boat room, one under every fourth plank of its floor.
  for (const z of [14, 27, 40, 53, 66]) b.add(5, lintel, z, SPAN - 5, loft, z + 2, kit.trim);

  // --- Piles: posts and stilts run down to the bed, dark and weeded where they stand in the lake ------------------------
  const top: Record<Carries, number> = { plate: E, bearer: deck - 3, lintel, canopy: E - 2 };
  const piles: { readonly id: string; readonly bottom: number }[] = [];
  for (const p of PILES) {
    const [x0, x1] = p.x, [z0, z1] = p.z, t = top[p.carries];
    const bottom = Math.floor(f.lo(x0, x1, z0, z1));
    if (bottom >= t) continue;
    b.add(x0, bottom, z0, x1, t, z1, timber.plank);
    if (bottom < w - 1) b.add(x0, bottom, z0, x1, w - 1, z1, timber.end);
    if (bottom <= w) {
      b.add(x0, Math.max(bottom, w - 1), z0, x1, Math.min(w + 1, t), z1, MAT.moss);
      // A trail of weed on the pile's shore side.
      if (hash(seed, x0, z0, 40) < 0.6) b.add(x0, Math.max(bottom, w - 2), z0 - 1, x0 + 1, w, z0, MAT.moss);
    }
    piles.push({ id: p.id, bottom });
    footings.push({ id: `pile-${p.id}`, box: { from: [x0, bottom, z0], to: [x1, bottom + 1, z1] } });
  }

  // --- The side door at the shore end, opening on the west staging ------------------------------------------------------
  const [dz0, dz1] = DOOR, dTop = deck + DOOR_HEIGHT;
  b.add(2, deck, dz0, 5, dTop, dz1, MAT.air);
  b.add(4, deck, dz0, 5, dTop, dz1, timber.plank);
  for (const z of [dz0 + 2, dz0 + 5]) b.add(4, deck, z, 5, dTop, z + 1, timber.end);
  for (const y of [deck + 3, dTop - 5]) { b.add(3, y, dz0, 4, y + 1, dz1 - 1, IRON); b.add(3, y - 1, dz0, 4, y + 2, dz0 + 2, IRON); }
  b.add(3, deck + 8, dz1 - 3, 4, deck + 9, dz1 - 1, IRON);
  b.add(2, deck - 1, dz0 - 1, 3, dTop + 2, dz0, kit.trim);
  b.add(2, deck - 1, dz1, 3, dTop + 2, dz1 + 1, kit.trim);
  b.add(2, dTop, dz0 - 2, 3, dTop + 2, dz1 + 2, kit.trim);
  // A stone step down to the shore outside, where the ground lies lower than the sill.
  const stepBase = Math.floor(f.lo(0, 2, dz0, dz1));
  if (stepBase < deck - 3) {
    b.add(0, stepBase, dz0, 2, deck - 2, dz1, tones.stone);
    b.add(0, deck - 3, dz0 + 1, 1, deck - 2, dz0 + 3, MAT.moss);
    footings.push({ id: 'door-step', box: { from: [0, stepBase, dz0], to: [2, stepBase + 1, dz1] } });
  }

  // --- The stagings: plank decks on joists and an edge bearer, with fenders and the mooring ring -----------------------
  const alt = plankAlt(style), [sz0, sz1] = BOATHOUSE.stagings.z;
  both(5, 17, deck - 1, deck, sz0, sz1, timber.plank);
  if (alt !== undefined) for (const x of [7, 13]) both(x, x + 2, deck - 1, deck, sz0, sz1, alt);
  // Butt ends of the planks, staggered plank by plank, and the edge plank darkened by wet feet.
  for (const [side, x0] of [[0, 5], [1, 47]] as const) for (let i = 0; i < 6; i++) {
    for (let z = sz0 + 4 + Math.floor(hash(seed, side, i, 50) * 18); z < sz1 - 2; z += 20 + Math.floor(hash(seed, side, i, z, 51) * 6)) {
      b.add(x0 + 2 * i, deck - 1, z, x0 + 2 * i + 2, deck, z + 1, timber.end);
    }
  }
  both(16, 17, deck - 1, deck, sz0, sz1, timber.end);
  both(15, 17, deck - 3, deck - 1, sz0, sz1, timber.plank);
  for (const z of [13, 19, 25, 32, 38, 45, 51, 58, 64, 71, 77]) {
    const wide = (EDGE_PILES as readonly number[]).includes(z);
    both(5, 15, deck - 3, deck - 1, z, z + (wide ? 2 : 1), timber.plank);
  }
  const ring = slipEnd + Math.floor((FRONT[0] - slipEnd) / 2);
  for (const z of [slipEnd + 4, ring + 9, FRONT[0] - 6]) {
    if (z < slipEnd + 2 || z + 2 > FRONT[0] - 2 || Math.abs(z - ring) < 4) continue;
    for (const x of [17, SPAN - 18]) {
      const low = Math.max(w - 2, Math.ceil(f.hi(x, x + 1, z, z + 2)));
      if (low >= deck - 1) continue;
      b.add(x, low, z, x + 1, deck - 1, z + 2, timber.plank);
      b.add(x, low, z, x + 1, Math.min(w + 1, deck - 1), z + 2, MAT.moss);
    }
  }
  // The mooring ring hangs from the west bearer's bay face, a handspan over the water.
  b.add(17, deck - 5, ring - 1, 18, deck - 2, ring + 2, IRON);
  b.add(17, deck - 4, ring, 18, deck - 3, ring + 1, MAT.air);

  // --- The canopy over the bay's mouth: its posts carry the plates out under the deep front verge -----------------------
  layVergeTimbers(b, E, PROUD, timber);

  // --- Roof, fish and the hoist ---------------------------------------------------------------------------------------
  layRoof(b, style, { eaves: E, seed, timber });
  const hoist = w + 47;
  b.add(31, hoist, FRONT[0] - 2, 33, hoist + 2, LENGTH, timber.plank);
  b.add(31, hoist, LENGTH - 1, 33, hoist + 2, LENGTH, timber.end);
  b.add(31, hoist - 2, LENGTH - 3, 33, hoist, LENGTH - 1, IRON);
  b.add(31, w + 37, LENGTH - 2, 32, hoist - 2, LENGTH - 1, MAT.thatch);
  b.add(31, w + 35, LENGTH - 2, 32, w + 37, LENGTH - 1, IRON);
  b.add(31, w + 35, LENGTH - 3, 32, w + 36, LENGTH - 2, IRON);

  // --- The few things left about the place -------------------------------------------------------------------------
  layRopeCoil(b, deck, MAT.thatch, IRON);
  layOars(b, deck, timber, IRON);
  layLifebuoy(b, deck, PROUD, timber.end, IRON);

  const blueprint = millBlueprint(`water-boathouse-${style}`, style, 'civic', [SPAN, H, LENGTH], b);
  const datum = Math.min(backBase, landBase, ...rows.map(r => r.base), ...piles.map(p => p.bottom), stepBase < deck - 3 ? stepBase : Infinity);
  if (datum !== 0) {
    throw new RangeError(`boathouse: its deepest bearing stands ${datum} cells over y = 0; the host sets y = 0 at the floor of the lowest bed under the piles.`);
  }

  const bayFloor = Math.ceil(f.hi(18, 46, slipEnd, LENGTH));
  if (bayFloor > w - 2) throw new RangeError(`boathouse: a bar rises to ${bayFloor} in the bay, out of ${w} cells of water.`);
  const clear: ClearVolume[] = [{ id: 'bay', role: 'headroom', box: { from: [18, bayFloor, slipEnd], to: [46, lintel, LENGTH] } }];
  const tops = Array.from({ length: FRONT[0] - LANDING[0] }, () => deck);
  const walks: WalkStrip[] = [
    { id: 'west-staging', axis: 'z', along: [LANDING[0], FRONT[0]], across: [5, 15], tops },
    { id: 'east-staging', axis: 'z', along: [LANDING[0], FRONT[0]], across: [SPAN - 15, SPAN - 5], tops },
  ];
  const mooring: Vec3 = [17.5, deck - 3.5, ring + 0.5];
  return {
    ...NO_METADATA, blueprint, footings, walks, clear,
    mounts: [{ id: 'bay-mooring', position: mooring, axis: [0, 1, 0] }],
    sounds: [
      { id: 'staging-creak', kind: 'creak', position: [10, deck, 48] },
      { id: 'hoist-creak', kind: 'creak', position: [32, hoist - 1, LENGTH - 2] },
    ],
  };
}
