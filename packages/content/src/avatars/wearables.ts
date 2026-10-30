import type { AvatarPartBlueprint } from '@chatdom/shared';
import { MAT } from '../materials';
import { BODY_FAMILIES, bodyContour, type BodyFamily } from './body';
import { GARB, KIT_ACCENTS, type Subscription, type WearableStyle } from './palette';
import { Sculpt } from './sculpt';

/** Body areas a wearable occupies; one piece per area in a look. */
export type WearableArea = 'head' | 'torso' | 'lower' | 'feet' | 'back';

/** Everyday wardrobe forms, in catalogue order, with the area each occupies. */
export const COMMON_WEARABLES = ['shortCloak'] as const;
export type CommonWearableId = (typeof COMMON_WEARABLES)[number];
export type WearableId = CommonWearableId;

export const WEARABLE_AREA = { shortCloak: 'back' } as const satisfies Record<WearableId, WearableArea>;
/** Wearables that sit on the head, which hair must be fitted beneath. */
export type HeadwearId = { [K in WearableId]: (typeof WEARABLE_AREA)[K] extends 'head' ? K : never }[WearableId];
export const isHeadwear = (id: WearableId): id is HeadwearId => (WEARABLE_AREA[id] as WearableArea) === 'head';

/** Lane-local selection: the body it is fitted to, the kingdom's accents, and a subscription state where one applies. */
export interface WearableFit {
  readonly body: BodyFamily;
  readonly style: WearableStyle;
  readonly subscription?: Subscription;
}

/** Each common form's dyed cloth per kingdom: Hearth leans warm, Tide leans sea-cool. */
const CLOTH: Record<CommonWearableId, Record<WearableStyle, number>> = {
  shortCloak: { hearth: MAT.fabricRed, tide: MAT.fabricBlue },
};

/**
 * Short cloak: falls from a rolled collar to mid-thigh, two cells thick against the back, widening
 * below the waist into soft vertical folds. One continuous rolled hem in the kingdom's light cloth
 * dips at the centre; two cords meet at a small brass clasp under the chin.
 */
function shortCloak(fit: WearableFit): Sculpt {
  const c = bodyContour(fit.body);
  const cloth = CLOTH.shortCloak[fit.style], hem = KIT_ACCENTS[fit.style].cloth;
  const back = c.chest.back;
  const s = new Sculpt();
  // Two cells thick against the shoulder blades, widening a cell below the waist.
  for (let y = 7; y < 16; y++) {
    const half = y < 11 ? c.chest.half + 2 : c.chest.half + 1;
    s.box([-half, y, back - 2], [half, y + 1, back], cloth);
  }
  // Folds: from the shoulder blades down, every other pair of columns stands a cell proud.
  for (let x = -c.chest.half - 2; x < c.chest.half + 2; x++) {
    if (Math.floor((x + 8) / 2) % 2 !== 0) continue;
    const top = Math.abs(x + .5) < 3 ? 13 : 11;
    s.box([x, 8, back - 3], [x + 1, top, back - 2], cloth);
  }
  // Hem: one continuous rolled band in the kingdom's light cloth, dipping at the centre.
  const hemHalf = c.chest.half + 2;
  s.box([-hemHalf, 7, back - 3], [hemHalf, 8, back], hem);
  s.box([-2, 6, back - 3], [2, 7, back], hem);
  // Rolled collar behind the head and over the shoulder blades.
  s.rounded([-c.chest.half - 1, 15, back - 3], [c.chest.half + 1, 17, back], cloth, 1, [true, true, false, true, true, false]);
  s.box([-c.chest.half, 16, back - 1], [c.chest.half, 17, back], 0);
  // Cords meet at a small brass clasp under the chin.
  for (const x of [-3, -2, 1, 2]) s.set(x, 15, c.chest.front, cloth);
  s.box([-1, 15, c.chest.front], [1, 16, c.chest.front + 1], GARB.clasp);
  return s;
}

const FORMS: Record<WearableId, (fit: WearableFit) => Sculpt> = { shortCloak };
const ATTACH: Record<WearableId, AvatarPartBlueprint['attachment']> = { shortCloak: 'back' };

export function createWearableParts(id: WearableId, fit: WearableFit): readonly AvatarPartBlueprint[] {
  const build = FORMS[id];
  if (!build) throw new Error(`Unknown wearable ${String(id)}.`);
  if (!BODY_FAMILIES.includes(fit.body)) throw new Error(`Unknown body family ${String(fit.body)}.`);
  if (fit.style !== 'hearth' && fit.style !== 'tide') throw new Error(`Unknown kingdom style ${String(fit.style)}.`);
  if (fit.subscription !== undefined) throw new Error(`${id} has no subscription state.`);
  return [build(fit).toPart(`wear.${id}.${fit.style}.${fit.body}`, ATTACH[id], 'garment')];
}
