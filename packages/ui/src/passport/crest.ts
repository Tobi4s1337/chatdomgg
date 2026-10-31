import type { CrestCharge, CrestShape } from './types';

/**
 * The supplied heraldic grammar (spec 39: shape, charge, two to four tinctures) drawn as code-native paths in a
 * 100 × 110 box. The same paths cut the painted arms, the inked impression and the wax relief, so a kingdom keeps
 * one face on every surface. Nothing here is generic arms: every part comes from the crest record.
 */
export const ARMS_BOX = { width: 100, height: 110 } as const;

export const SHIELD: Readonly<Record<CrestShape, string>> = {
  // A heater: straight chief, gently swelling flanks, a point at the base.
  heater: 'M7 5H93Q95 5 95 7V44C95 74 77 95 50 106C23 95 5 74 5 44V7Q5 5 7 5Z',
  // A round shield (roundel), centred a little low so the charge sits where the eye expects.
  round: 'M50 9A47 47 0 1 1 49.99 9Z',
  // A swallowtail standard hung from its head: the deep V cut up from the hem.
  swallowtail: 'M5 6H95V104L50 80L5 104Z',
};

/** Where the charge's centre sits inside each shape, and how large it may be drawn. */
export const CHARGE_SEAT: Readonly<Record<CrestShape, { x: number; y: number; scale: number }>> = {
  heater: { x: 50, y: 50, scale: 0.92 },
  round: { x: 50, y: 56, scale: 0.9 },
  swallowtail: { x: 50, y: 44, scale: 0.8 },
};

export interface ChargeArt {
  /** Filled with the charge tincture, even-odd, so cut lines show the field beneath. */
  readonly fill: string;
  /** Stroked with the charge tincture (wave bands), in charge units. */
  readonly stroke?: string;
  readonly strokeWidth?: number;
}

function star(points: number, outer: number, inner: number, cx: number, cy: number): string {
  const corners: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 ? inner : outer;
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    corners.push(`${(cx + Math.cos(angle) * radius).toFixed(2)} ${(cy + Math.sin(angle) * radius).toFixed(2)}`);
  }
  return `M${corners.join('L')}Z`;
}

/** Charges are drawn around (50, 52) in a box about 64 units high; `CHARGE_SEAT` moves and scales them. */
export const CHARGE: Readonly<Record<CrestCharge, ChargeArt>> = {
  // An oak leaf, lobed in pairs, its midrib cut through to the field.
  oak: {
    fill: 'M48.6 88L51.4 88L51.6 80C58 81 63 77 61 72C67 72 70 66 66 62C72 60 73 53 68 50C73 46 72 40 66 39C69 34 66 28 60 29C60 24 55 20 50 18'
      + 'C45 20 40 24 40 29C34 28 31 34 34 39C28 40 27 46 32 50C27 53 28 60 34 62C30 66 33 72 39 72C37 77 42 81 48.4 80Z'
      + 'M49.3 77L50.7 77L50.4 26L49.6 26Z',
  },
  // A mullet of five points, broad enough to survive a dry stamp pad.
  star: { fill: star(5, 27, 11.5, 50, 54) },
  // Three barry-wavy bands.
  wave: {
    fill: '',
    stroke: 'M20 38q7.5-8 15 0t15 0t15 0t15 0M20 53q7.5-8 15 0t15 0t15 0t15 0M20 68q7.5-8 15 0t15 0t15 0t15 0',
    strokeWidth: 6.5,
  },
  // Two peaks on a ground line, the higher one capped with snow cut to the field.
  mountain: { fill: 'M18 78L40 38L49 51L60 30L84 78ZM60 30L53.4 42.5L56.6 40.6L60 44.4L63.3 40.4L65.8 42.4ZM14 82H88V86.5H14Z' },
};

/** The SVG transform that seats a charge in its shape. */
export function chargeTransform(shape: CrestShape): string {
  const seat = CHARGE_SEAT[shape];
  return `translate(${seat.x} ${seat.y}) scale(${seat.scale}) translate(-50 -52)`;
}

/** A plain-English blazon read by assistive technology: the arms in words, from the record alone. */
export function blazonOf(shape: CrestShape, charge: CrestCharge, colourNames: readonly string[] = []): string {
  const shapeWord = { heater: 'a heater shield', round: 'a round shield', swallowtail: 'a swallowtail banner' }[shape];
  const chargeWord = { oak: 'an oak leaf', star: 'a five-pointed star', wave: 'three wavy bands', mountain: 'two mountain peaks' }[charge];
  return `${chargeWord} on ${shapeWord}${colourNames.length ? ` in ${colourNames.join(', ')}` : ''}`;
}
