import type { AvatarPartBlueprint } from '@chatdom/shared';
import { BODY_FAMILIES, bodyContour, torsoRow, type BodyFamily } from './body';
import { capeColours } from './capes';
import { GARB, type Subscription, type WearableStyle } from './palette';
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

/**
 * Short cloak, rigid half: the cloak itself is cloth (`createCape('shortCloak', fit)`). What stays a voxel
 * part is what holds it on, two cords in the cloak's own colour that run along the collar line and meet
 * at a small brass clasp under the chin. They ride the chest bone, so a bow or turn carries them.
 */
function shortCloak(fit: WearableFit): Sculpt {
  const c = bodyContour(fit.body);
  const cord = capeColours('shortCloak', fit.style).cloth;
  const s = new Sculpt();
  const collar = torsoRow(c, 15), z = collar.front;
  // The chest's rounded corners stop the cords a cell short of the shoulder edge.
  s.box([-collar.half + 1, 15, z], [collar.half - 1, 16, z + 1], cord);
  s.box([-1, 14, z], [1, 16, z + 1], GARB.clasp);
  return s;
}

const FORMS: Record<WearableId, (fit: WearableFit) => Sculpt> = { shortCloak };
const ATTACH: Record<WearableId, AvatarPartBlueprint['attachment']> = { shortCloak: 'chest' };

export function createWearableParts(id: WearableId, fit: WearableFit): readonly AvatarPartBlueprint[] {
  const build = FORMS[id];
  if (!build) throw new Error(`Unknown wearable ${String(id)}.`);
  if (!BODY_FAMILIES.includes(fit.body)) throw new Error(`Unknown body family ${String(fit.body)}.`);
  if (fit.style !== 'hearth' && fit.style !== 'tide') throw new Error(`Unknown kingdom style ${String(fit.style)}.`);
  if (fit.subscription !== undefined) throw new Error(`${id} has no subscription state.`);
  return [build(fit).toPart(`wear.${id}.clasp.${fit.style}.${fit.body}`, ATTACH[id], 'accessory')];
}
