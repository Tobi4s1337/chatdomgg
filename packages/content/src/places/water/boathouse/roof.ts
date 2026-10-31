import { Boxes } from '../../../civic/kit';
import { MAT, STYLES, type StyleKey } from '../../../materials';
import { IRON, runs, type Wood } from '../millrace/craft';
import { hash } from '../shore/shape';

/**
 * The boathouse roof: a steep two-slope roof whose ridge runs the length of the building (Z), across the full
 * 64-cell width so its eaves oversail both side walls. Each course is three columns broad and climbs four cells
 * (about 53°), with a two-cell butt at its foot so the rows read as laid slates. The middle of the roof has settled
 * a cell, so the ridge and every course dip along the building's middle. All heights are in build cells.
 */

export const SPAN = 64;
export const LENGTH = 88;
/** Columns per course and the cells a course climbs: rise over run is 4/3. */
export const COURSE_RUN = 3;
export const COURSE_RISE = 4;
/** The half-open z run that has settled one cell. */
export const SAG: readonly [number, number] = [20, 68];
/** The slab's thickness, in cells, under every column's top. */
export const SLAB = 4;
/** The ridge roll stands this far over the crest columns' top. */
const CAP = 2;
/** The fish on the front apex: its rod, then its body. */
const ROD = 4;
const FISH = [
  '..xxxx....xx',
  '.x.xxxxx..x.',
  'xxxxxxxxxxx.',
  '.xxxxxxx..x.',
  '..xxxx....xx',
] as const;

const SEGMENTS: readonly (readonly [number, number])[] = [[0, SAG[0]], [SAG[0], SAG[1]], [SAG[1], LENGTH]];

/** Columns in from the nearer eave edge: 0 at both eaves, 31 at the two crest columns. */
export const inset = (x: number): number => (x < SPAN / 2 ? x : SPAN - 1 - x);

/** One above the roof's top cell over column x, where the roof has not settled. */
export const roofTop = (eaves: number, x: number): number => eaves + 2 + Math.floor((COURSE_RISE * inset(x)) / COURSE_RUN);

/** How far the roof has settled over row z. */
export const sag = (z: number): number => (z >= SAG[0] && z < SAG[1] ? 1 : 0);

/** The crest columns' top and the ridge roll's top (at the gables; one lower over the settled middle). */
export const crestTop = (eaves: number): number => roofTop(eaves, SPAN / 2 - 1);
export const ridgeTop = (eaves: number): number => crestTop(eaves) + CAP;
/** The fish's lowest row, and one above its highest: the piece's height. */
export const vaneBase = (eaves: number): number => ridgeTop(eaves) + ROD;
export const vaneTop = (eaves: number): number => vaneBase(eaves) + FISH.length;

/** The roof's cover, an odd weathered piece of it, and the ridge roll. */
interface Cover { readonly main: number; readonly odd: number; readonly cap: number }
function cover(style: StyleKey): Cover {
  const roof = STYLES[style].roof;
  // Slate darkens to blue-grey where it has weathered, under a dark ridge; old tiles and old thatch go brown.
  if (style === 'tide') return { main: roof, odd: MAT.darkStone, cap: MAT.darkStone };
  return { main: roof, odd: MAT.earth, cap: roof };
}

/** Column x of a given inset on a slope: west runs 0..31 from its eave, east 63..32. */
const column = (east: boolean, d: number): number => (east ? SPAN - 1 - d : d);
/** The half-open x span of insets d0..d1 inclusive on a slope. */
const across = (east: boolean, d0: number, d1: number): [number, number] =>
  (east ? [SPAN - 1 - d1, SPAN - d0] : [d0, d1 + 1]);

export interface RoofParts {
  readonly eaves: number;
  readonly seed: number;
  readonly timber: Wood;
}

/**
 * Lays the slab, the courses' odd and slipped slates, moss on the shaded west slope, the bargeboards at both
 * gables, the ridge roll and, on the front apex, the brass fish on its iron rod. Laid last over the body, so the
 * slab closes the gables' tops and the loft fill beneath it.
 */
export function layRoof(b: Boxes, style: StyleKey, { eaves: E, seed, timber }: RoofParts): void {
  const tones = cover(style), courses = Math.ceil((SPAN / 2) / COURSE_RUN);

  // --- The slab, settled a cell along the middle ---------------------------------------------------------------------
  for (const [z0, z1] of SEGMENTS) {
    const s = sag(z0);
    for (let x = 0; x < SPAN; x++) { const t = roofTop(E, x) - s; b.add(x, t - SLAB, z0, x + 1, t, z1, tones.main); }
  }

  // --- Slates ------------------------------------------------------------------------------------------------------
  // A slate covers its course's butt (the two-cell riser at the foot column) and the next column's top; the course's
  // top column is always left in the main tone, where the next course laps over it. Head joints are staggered
  // course by course; slates never cross the settled step.
  const slate = (east: boolean, k: number, z0: number, z1: number, m: number) => {
    const d0 = k * COURSE_RUN, s = sag(z0), x = column(east, d0), t0 = roofTop(E, x) - s;
    b.add(x, t0 - 2, z0, x + 1, t0, z1, m);
    if (d0 + 1 > SPAN / 2 - 1) return;
    const [xa, xb] = across(east, d0 + 1, Math.min(d0 + 2, SPAN / 2 - 1)), t1 = roofTop(E, column(east, d0 + 1)) - s;
    b.add(xa, t1 - 1, z0, xb, t1, z1, m);
  };
  for (const east of [false, true]) {
    for (let k = 0; k < courses; k++) {
      for (const [g0, g1] of SEGMENTS) {
        let z = g0 - Math.floor(hash(seed, east ? 1 : 0, k, g0, 1) * 5);
        for (let i = 0; z < g1; i++) {
          const len = 4 + Math.floor(hash(seed, east ? 1 : 0, k, g0, i, 2) * 3), r = hash(seed, east ? 1 : 0, k, g0, i, 3);
          const a = Math.max(z, g0), c = Math.min(z + len, g1);
          // The west slope is the shaded one: small clumps of moss gather in its lowest courses, most towards the back.
          const moss = !east && k < 4 && r < 0.05 + (a < 30 ? 0.07 : 0);
          if (moss && c > a) slate(east, k, a, Math.min(c, a + 2 + (i % 2)), MAT.moss);
          else if (c > a && r > 0.9) slate(east, k, a, c, tones.odd);
          z += len;
        }
      }
    }
  }
  // Three slipped slates: each has slid a cell down onto the course below, leaving a dark gap where it lay.
  for (let i = 0; i < 3; i++) {
    const east = i === 1, k = 2 + Math.floor(hash(seed, i, 4) * (courses - 4));
    const segment = SEGMENTS[i % SEGMENTS.length]!, z0 = segment[0] + 3 + Math.floor(hash(seed, i, 5) * (segment[1] - segment[0] - 9));
    const s = sag(z0), foot = column(east, k * COURSE_RUN - 1), lap = column(east, k * COURSE_RUN + 1);
    b.add(lap, roofTop(E, lap) - s - 1, z0, lap + 1, roofTop(E, lap) - s, z0 + 4, MAT.air);
    b.add(foot, roofTop(E, foot) - s, z0, foot + 1, roofTop(E, foot) - s + 1, z0 + 4, tones.odd);
  }

  // --- Bargeboards at both gables: a three-cell board under the verge, following every step of the slope ----------
  for (const z of [0, LENGTH - 1]) for (let x = 0; x < SPAN; x++) {
    const t = roofTop(E, x);
    b.add(x, t - SLAB - 1, z, x + 1, t - 2, z + 1, timber.plank);
  }

  // --- The ridge roll, with a joint between its ridge tiles every six cells -------------------------------------------
  const crest = crestTop(E), [r0, r1] = [SPAN / 2 - 2, SPAN / 2 + 2];
  for (const [z0, z1] of SEGMENTS) {
    const s = sag(z0);
    b.add(r0, crest - 1 - s, z0, r1, crest + CAP - s, z1, tones.cap);
    for (let z = z0 + 3; z < z1 - 2; z += 6) {
      // Thatch is pinned down with hazel liggers instead.
      if (style === 'grove') b.add(r0, crest + CAP - 1 - s, z, r1, crest + CAP - s, z + 1, MAT.bark);
      else b.add(r0, crest + CAP - 1 - s, z, r1, crest + CAP - s, z + 1, MAT.air);
    }
  }

  // --- The brass fish on the front apex ----------------------------------------------------------------------------
  // It swims across the front, so it reads from the lake and from the pier in silhouette; the rod stands on the
  // ridge roll a little in from the verge.
  const zf = LENGTH - 3, base = vaneBase(E), top = ridgeTop(E);
  b.add(SPAN / 2 - 1, top, zf, SPAN / 2 + 1, base, zf + 1, IRON);
  const fish: [number, number][] = [];
  FISH.forEach((row, i) => { for (let u = 0; u < row.length; u++) if (row[u] === 'x') fish.push([u, FISH.length - 1 - i]); });
  const x0 = SPAN / 2 - 6;
  runs(fish, (u0, u1, v) => b.add(x0 + u0, base + v, zf, x0 + u1, base + v + 1, zf + 1, MAT.brass));
}

/**
 * The timbers that carry the deep front verge over the bay's mouth: two purlins a slope and the ridge beam, run out
 * from the gable under the slab and stopped behind the bargeboard, so their ends show in its shadow.
 */
export function layVergeTimbers(b: Boxes, eaves: number, from: number, timber: Wood): void {
  for (const d of [9, 20]) for (const east of [false, true]) {
    const [xa, xb] = across(east, d, d + 1), high = roofTop(eaves, column(east, d + 1)) - SLAB;
    const low = roofTop(eaves, column(east, d)) - SLAB - 2;
    b.add(xa, low, from, xb, high, LENGTH - 1, timber.plank);
    b.add(xa, low, LENGTH - 2, xb, low + 2, LENGTH - 1, timber.end);
  }
  const crest = crestTop(eaves) - SLAB;
  b.add(SPAN / 2 - 1, crest - 2, from, SPAN / 2 + 1, crest, LENGTH - 1, timber.plank);
  b.add(SPAN / 2 - 1, crest - 2, LENGTH - 2, SPAN / 2 + 1, crest, LENGTH - 1, timber.end);
}
