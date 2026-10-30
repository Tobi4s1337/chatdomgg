import type { AvatarPartBlueprint } from '@chatdom/shared';
import { BODY_FAMILIES, headVolume, type BodyFamily } from './body';
import { materialName, resolveHair, type HairSwatchId } from './palette';
import { Sculpt } from './sculpt';
import type { HeadwearId } from './wearables';

/** Scalp and hair treatments. Every one binds rigidly to the frozen head bone. */
export const HAIR_FORMS = ['sidePart'] as const;
export type HairForm = (typeof HAIR_FORMS)[number];

/** Lane-local selection: the body, a registered hair swatch, and the headwear the hair must fit under. */
export interface HairFit {
  readonly body: BodyFamily;
  readonly hair: HairSwatchId;
  readonly headwear: HeadwearId | null;
}

/**
 * Side part. Built from offset shells of the skull, so it follows the head exactly: one cell close on
 * the parted (left) side, two cells of lift over the crown and the full right side, a rounded
 * occipital mass and a tidy nape. The fringe is one sheet whose lower edge steps down diagonally
 * from the parting to the right temple, where a short lock falls past the ear.
 */
function sidePart(material: number): Sculpt {
  const head = headVolume(material);
  const near = head.shell(1, material), far = head.shell(2, material);
  const hair = new Sculpt();
  hair.merge(near, (_x, y) => y >= 18);
  hair.merge(far, (x, y, z) => (y >= 23 && x >= -2) || (x >= 3 && y >= 19 && z < 3) || (z <= -4 && y >= 19 && y < 25));
  // Fringe line: high at the parting, falling two cells at a time toward the right temple.
  const fringe = (x: number): number => x < -4 ? 21 : x < -2 ? 23 : x < 0 ? 22 : x < 4 ? 21 : 19;
  hair.carveWhere((x, y, z) => {
    if (z >= 3 && x >= -6 && x < 4 && y < fringe(x)) return true;
    // The parted side lies close above the ear and tapers to the nape.
    if (x < -5 && z >= 1 && y < 21) return true;
    if (x < -5 && y < 19) return true;
    if (x >= 5 && z >= -2 && z < 1 && y < 20) return true;
    if (z <= -5 && y < 19 && (x < -3 || x >= 3)) return true;
    return false;
  });
  // The right temple lock: a short fall of hair in front of the ear.
  hair.box([4, 18, 2], [6, 21, 4], material);
  hair.set(4, 18, 3, 0);
  // Parting: a notch where the close side meets the lift.
  for (let z = -1; z < 4; z++) hair.set(-2, 24, z, 0);
  hair.subtract(head);
  return hair;
}

const FORMS: Record<HairForm, (material: number) => Sculpt> = { sidePart };

export function createHairParts(form: HairForm, fit: HairFit): readonly AvatarPartBlueprint[] {
  const build = FORMS[form];
  if (!build) throw new Error(`Unknown hair form ${String(form)}.`);
  if (!BODY_FAMILIES.includes(fit.body)) throw new Error(`Unknown body family ${String(fit.body)}.`);
  if (fit.headwear !== null) throw new Error(`${form} has no authored fit under ${String(fit.headwear)}.`);
  const swatch = resolveHair(fit.hair);
  return [build(swatch).toPart(`hair.${form}.${materialName(swatch)}`, 'head', 'hair')];
}
