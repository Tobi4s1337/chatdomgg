import { heater } from '../civic/kit';

/**
 * The drawn arms of a Genesis kingdom: every crest shape, cloth cut and charge a recipe can name, as grids of
 * marks. A grid's rows run top to bottom; 'B' is the border, 'F' the field, 'C' the charge and '.' is outside the
 * outline. The same charge is drawn at both sizes, carved on the crest and woven through the cloth, so they match.
 */
export type CrestShape = 'heater' | 'round' | 'swallowtail';
export type CrestCharge = 'oak' | 'star' | 'wave' | 'mountain';
export type ClothCut = 'square' | 'forked' | 'pennant';

/** Where a charge is drawn: its centre in grid cells (columns from the left, rows from the top) and half extents. */
export interface ChargeBox {
  readonly cx: number;
  readonly cy: number;
  readonly hw: number;
  readonly hh: number;
}

type Outline = (col: number, row: number) => boolean;
/** A charge in its own box: u runs -1..1 left to right and v runs -1..1 top to bottom. */
type Figure = (u: number, v: number) => boolean;

const circle = (u: number, v: number, cu: number, cv: number, r: number) => (u - cu) ** 2 + (v - cv) ** 2 < r * r;

/**
 * An oak eradicated: a lobed crown of seven rounds over a stout trunk whose roots spread at the foot. Three cells
 * of the field show through the crown as light between the leaves, so it reads as foliage and not a blot.
 */
const oak: Figure = (u, v) => {
  if ([[-0.4, -0.3], [0.4, -0.3], [0, -0.62]].some(([cu, cv]) => Math.abs(u - cu!) < 0.09 && Math.abs(v - cv!) < 0.06)) return false;
  const crown = ([[0, -0.42, 0.44], [-0.62, -0.32, 0.3], [0.62, -0.32, 0.3], [-0.42, 0, 0.3], [0.42, 0, 0.3], [-0.3, -0.72, 0.28], [0.3, -0.72, 0.28]] as const)
    .some(([cu, cv, r]) => circle(u, v, cu, cv, r));
  if (crown) return true;
  if (v < 0.1 || v > 1) return false;
  // A stout trunk flares into roots from v 0.62; at the foot two slits part three roots.
  const half = 0.2 + Math.max(0, v - 0.62) * 1.5;
  if (Math.abs(u) >= half) return false;
  return !(v > 0.86 && Math.abs(Math.abs(u) - 0.36) < 0.09);
};

/** A mullet: a five-pointed star, one point up, its inner radius about half its outer, so the points stay stout at this size. */
const STAR = Array.from({ length: 10 }, (_, i) => {
  const angle = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.48 : 1;
  return [r * Math.cos(angle), r * Math.sin(angle) + 0.08] as const;
});
const star: Figure = (u, v) => {
  let inside = false;
  for (let i = 0, j = STAR.length - 1; i < STAR.length; j = i++) {
    const [ui, vi] = STAR[i]!, [uj, vj] = STAR[j]!;
    if ((vi > v) !== (vj > v) && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
};

/** Barry wavy: three wavy bars running clean across the field, in phase, so the field between them waves too. */
const wave: Figure = (u, v) => [-0.62, 0, 0.62].some(centre => Math.abs(v - centre - 0.15 * Math.sin(Math.PI * (u * 1.1 + 0.5))) < 0.17);

/**
 * A trimount: a tall peak between two lower ones, rising from the foot of the box. A line of the field crosses the
 * tall peak, so its cap reads as snow.
 */
const mountain: Figure = (u, v) => {
  if (v > 1 || Math.abs(u) > 1) return false;
  const peak = Math.abs(u) < (v + 0.95) * 0.56;
  const shoulders = Math.abs(Math.abs(u) - 0.62) < (v + 0.05) * 0.8;
  if (!peak && !shoulders) return false;
  // The snowline stops at the peak's spine, so the cap stays on the mountain and reads as snow, not as a cut.
  return !(peak && !shoulders && Math.abs(u) >= 0.12 && v > -0.42 && v < -0.31);
};

export const CHARGES: Readonly<Record<CrestCharge, Figure>> = { oak, star, wave, mountain };

/**
 * Draws a charge into an outline: the border follows the outline through its diagonals, so a tapering edge stays
 * one unbroken line, and the charge is drawn on the field inside it.
 */
export function emblazon(width: number, height: number, outline: Outline, charge: CrestCharge, box: ChargeBox): string[] {
  const within = (col: number, row: number) => col >= 0 && row >= 0 && col < width && row < height && outline(col, row);
  const figure = CHARGES[charge];
  return Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, col) => {
    if (!within(col, row)) return '.';
    for (const dc of [-1, 0, 1]) for (const dr of [-1, 0, 1]) if (!within(col + dc, row + dr)) return 'B';
    return figure((col + 0.5 - box.cx) / box.hw, (row + 0.5 - box.cy) / box.hh) ? 'C' : 'F';
  }).join(''));
}

/** The carved shield on the crest, in cells: 24 wide, and as tall as its shape needs. */
export const SHIELD_WIDTH = 24;
export const SHIELD_HEIGHT: Readonly<Record<CrestShape, number>> = { heater: 30, round: 24, swallowtail: 30 };

/**
 * The three shield outlines. The heater is the civic kit's, long-sided. The round shield is a full roundel. The
 * swallowtail is a tall tablet with eased upper corners and a V cut up from its foot, so it stands on two points.
 */
const SHIELD_OUTLINES: Readonly<Record<CrestShape, Outline>> = {
  heater: heater(SHIELD_WIDTH, SHIELD_HEIGHT.heater, 14),
  round: (col, row) => Math.hypot(col + 0.5 - SHIELD_WIDTH / 2, row + 0.5 - SHIELD_HEIGHT.round / 2) < SHIELD_WIDTH / 2 + 0.2,
  swallowtail: (col, row) => {
    const dx = Math.abs(col + 0.5 - SHIELD_WIDTH / 2);
    if (row < 2 && dx > SHIELD_WIDTH / 2 - 2 + row) return false;
    return !cutUp(dx, row, SHIELD_HEIGHT.swallowtail, 8, SHIELD_WIDTH / 2 - 5);
  },
};

/** Where the charge sits on each shield: high on the heater and the swallowtail, clear of the point and the notch. */
const SHIELD_CHARGE: Readonly<Record<CrestShape, ChargeBox>> = {
  heater: { cx: 12, cy: 12.5, hw: 8.5, hh: 9.5 },
  round: { cx: 12, cy: 12, hw: 8, hh: 8 },
  swallowtail: { cx: 12, cy: 11.5, hw: 8.5, hh: 9 },
};

export function shieldArms(shape: CrestShape, charge: CrestCharge): string[] {
  const box = charge === 'star' ? square(SHIELD_CHARGE[shape]) : SHIELD_CHARGE[shape];
  return emblazon(SHIELD_WIDTH, SHIELD_HEIGHT[shape], SHIELD_OUTLINES[shape], charge, box);
}

/** The standard's cloth, in cells: 24 wide, 56 deep from its head on the bar to the lowest point of its hem. */
export const CLOTH_WIDTH = 24;
export const CLOTH_ROWS = 56;

/**
 * True when (dx, row) lies in a V cut up from the hem: `depth` rows deep at the middle, leaving tips `tip` cells
 * wide at the hem. `dx` is the distance from the middle of the cloth.
 */
function cutUp(dx: number, row: number, rows: number, depth: number, tipHalf: number): boolean {
  const into = row - (rows - depth) + 1;
  return into > 0 && dx <= (into * tipHalf) / depth;
}

/**
 * The three cuts. Square hangs straight to a level hem. Forked has a deep V up from the hem, leaving two tails four
 * cells wide. Pennant runs full width for its head, then tapers in a long straight line to a single point.
 */
const CLOTH_OUTLINES: Readonly<Record<ClothCut, Outline>> = {
  square: () => true,
  forked: (col, row) => !cutUp(Math.abs(col + 0.5 - CLOTH_WIDTH / 2), row, CLOTH_ROWS, 18, CLOTH_WIDTH / 2 - 4),
  pennant: (col, row) => {
    const taper = 18;
    if (row < taper) return true;
    const half = (CLOTH_WIDTH / 2) * (1 - (row + 0.5 - taper) / (CLOTH_ROWS - taper)) + 0.75;
    return Math.abs(col + 0.5 - CLOTH_WIDTH / 2) < half;
  },
};

/** The charge on the cloth sits level with the standard's arm lanterns; on the pennant it rides above the taper. */
const CLOTH_CHARGE: Readonly<Record<ClothCut, ChargeBox>> = {
  square: { cx: 12, cy: 26.5, hw: 9, hh: 12.5 },
  forked: { cx: 12, cy: 25.5, hw: 9, hh: 12 },
  pennant: { cx: 12, cy: 22.5, hw: 8.5, hh: 11 },
};

export function clothArms(cut: ClothCut, charge: CrestCharge): string[] {
  const box = charge === 'star' ? square(CLOTH_CHARGE[cut]) : CLOTH_CHARGE[cut];
  return emblazon(CLOTH_WIDTH, CLOTH_ROWS, CLOTH_OUTLINES[cut], charge, box);
}

/** A star is drawn in a square box (its points must not stretch), as large as the box's narrower side allows. */
function square(box: ChargeBox): ChargeBox {
  const r = Math.min(box.hw, box.hh) + 0.5;
  return { ...box, hw: r, hh: r };
}
