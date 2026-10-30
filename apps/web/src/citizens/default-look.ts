import { createBodyParts, createHairParts, createWearableParts, compileAvatarPart, validateLook } from '@chatdom/content/avatars';
import { AVATAR_PALETTE } from '@chatdom/content/materials';
import type { CitizenLook } from './index';

/** Authored wardrobe combinations; selection remains the caller's responsibility. */
export function createDefaultCitizenLooks(): readonly CitizenLook[] {
  const variants = [
    { id: 'hearth', skin: AVATAR_PALETTE.skin[2], hair: AVATAR_PALETTE.hair[1], style: 'hearth' },
    { id: 'tide', skin: AVATAR_PALETTE.skin[6], hair: AVATAR_PALETTE.hair[0], style: 'tide' },
    { id: 'grove', skin: AVATAR_PALETTE.skin[0], hair: AVATAR_PALETTE.hair[4], style: 'hearth' },
  ] as const;
  return variants.map(variant => {
    const blueprints = [
      ...createBodyParts('balanced', variant.skin),
      ...createHairParts('sidePart', { body: 'balanced', hair: variant.hair, headwear: null }),
      ...createWearableParts('shortCloak', { body: 'balanced', style: variant.style }),
    ];
    validateLook(blueprints);
    return { id: variant.id, parts: blueprints.map(blueprint => ({ blueprint, asset: compileAvatarPart(blueprint, 0) })) };
  });
}
