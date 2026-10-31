import { MAT, MATERIALS } from '../materials';
import { contrast, type HeraldicColours } from './kit';

/**
 * The tinctures a proposal may snap profile colour targets to. Every one is a registered material and an avatar
 * swatch, so a citizen's cape can wear exactly the colours the standard flies. Two metals (linen for argent, the
 * gold dye for or), the six clear dyes, the six muted dyes, and the darkest hair black as sable. Nothing is added
 * to the registry and nothing is tinted: a target only ever selects one of these.
 */
export const METALS = [MAT.cream, MAT.fabricGold] as const;
export const TINCTURES: readonly number[] = [
  ...METALS,
  MAT.fabricRed, MAT.fabricOrange, MAT.fabricGreen, MAT.fabricBlue, MAT.fabricViolet,
  MAT.fabricMutedRed, MAT.fabricMutedOrange, MAT.fabricMutedGold, MAT.fabricMutedGreen, MAT.fabricMutedBlue, MAT.fabricMutedViolet,
  MAT.hairBlack,
];
/** Borders: brass first, as on the neutral arms, then linen, then sable. */
const BORDERS = [MAT.brass, MAT.cream, MAT.hairBlack] as const;

/** Field and charge must part by at least the WCAG non-text contrast, 3:1, so the charge reads at stream distance. */
export const MIN_CONTRAST = 3;
/**
 * A target further than this (OKLab distance) from every passing tincture is not honoured by a colour that only
 * vaguely resembles it; the charge falls back to the metal that reads best on the field, as a herald would. The dyes
 * are softer than screen colours, so a vivid red still finds the red dye (about 0.16), and a near-black purple finds
 * sable, while a mid purple on a violet field (sable is about 0.23 from it) falls back to linen.
 */
const NEAR = 0.2;
/** A border closer than this to the field or the charge would melt into them. */
const DISTINCT = 0.09;

type Lab = readonly [number, number, number];

/** sRGB hex to OKLab (Björn Ottosson's matrices). */
export function oklab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const LAB = new Map(MATERIALS.materials.map(material => [material.id, oklab(material.colour)]));
const labOf = (material: number) => LAB.get(material)!;
const distance = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The candidate nearest to a colour; ties go to the earlier candidate, so the result never depends on float noise in order. */
function nearest(lab: Lab, candidates: readonly number[]): { material: number; distance: number } {
  let best = { material: candidates[0]!, distance: Infinity };
  for (const material of candidates) {
    const d = distance(lab, labOf(material));
    if (d < best.distance - 1e-12) best = { material, distance: d };
  }
  return best;
}

/** How each colour of a proposal was chosen: the target it honours, or null when the heraldic rule chose it. */
export interface Snap {
  readonly target: string | null;
  readonly material: number;
}

export interface SnappedColours {
  readonly colours: HeraldicColours;
  readonly field: Snap;
  readonly charge: Snap;
}

/**
 * Snaps a recipe's profile colour targets (in source preference order) to the tinctures. The first target picks
 * the field. The charge is the passing tincture nearest any later target, where passing means at least 3:1 against
 * the field; when no later target is near one, the charge is the metal (or, if the field is a metal, the tincture)
 * with the most contrast. The border is brass unless brass would melt into field or charge. Pure and deterministic.
 */
export function snapTargets(targets: readonly string[]): SnappedColours {
  if (!targets.length) throw new Error('No profile colour targets to snap.');
  const labs = targets.map(oklab);
  const fieldMaterial = nearest(labs[0]!, TINCTURES).material;
  const passing = TINCTURES.filter(material => material !== fieldMaterial && contrast(fieldMaterial, material) >= MIN_CONTRAST);
  if (!passing.length) throw new Error(`No tincture reads on field ${fieldMaterial}.`);

  let charge: Snap | null = null;
  let best = NEAR;
  for (const [i, lab] of labs.entries()) {
    if (i === 0) continue;
    const near = nearest(lab, passing);
    if (near.distance < best - 1e-12) {
      best = near.distance;
      charge = { target: targets[i]!, material: near.material };
    }
  }
  if (!charge) {
    const metals = passing.filter(material => (METALS as readonly number[]).includes(material));
    const pool = metals.length ? metals : passing;
    let material = pool[0]!;
    for (const candidate of pool) if (contrast(fieldMaterial, candidate) > contrast(fieldMaterial, material) + 1e-12) material = candidate;
    charge = { target: null, material };
  }

  const border = BORDERS.find(material => material !== fieldMaterial && material !== charge.material
    && distance(labOf(material), labOf(fieldMaterial)) >= DISTINCT && distance(labOf(material), labOf(charge.material)) >= DISTINCT) ?? MAT.brass;
  return {
    colours: { field: fieldMaterial, charge: charge.material, border },
    field: { target: targets[0]!, material: fieldMaterial },
    charge,
  };
}
