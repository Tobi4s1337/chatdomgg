import type { AvatarPartBlueprint } from '@chatdom/shared';
import { WEARABLE_AREA, createBodyParts, createHairParts, createWearableParts, isHeadwear, validateLook, type WearableArea } from '@chatdom/content/avatars';
import type { CampfireSeatLook } from './ports';

/**
 * The authored parts for a seat's public look, in the wardrobe's fixed order: body, hair, wearables.
 * Two pieces in one area are an error, never a silent drop of something a person chose.
 */
export function seatLookParts(look: CampfireSeatLook): readonly AvatarPartBlueprint[] {
  const areas = new Set<WearableArea>();
  for (const item of look.wear) {
    const area = WEARABLE_AREA[item.id];
    if (areas.has(area)) throw new Error(`Two pieces share the ${area}.`);
    areas.add(area);
  }
  const headwear = look.wear.map(item => item.id).find(isHeadwear) ?? null;
  const parts = [
    ...createBodyParts(look.body, look.skin),
    ...(look.hair ? createHairParts(look.hair.form, { body: look.body, hair: look.hair.swatch, headwear }) : []),
    ...look.wear.flatMap(item => createWearableParts(item.id, { body: look.body, style: item.style })),
  ];
  validateLook(parts);
  return parts;
}

/** A stable key for sharing meshed parts between seats that wear the same thing. */
export function lookKey(look: CampfireSeatLook): string {
  return [look.body, look.skin, look.hair ? `${look.hair.form}.${look.hair.swatch}` : 'bare', ...look.wear.map(w => `${w.id}.${w.style}`)].join('|');
}
