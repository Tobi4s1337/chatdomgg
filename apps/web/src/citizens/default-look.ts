import { createBodyParts, createHairParts, compileAvatarPart, validateLook } from '@chatdom/content/avatars';
import { AVATAR_PALETTE, MAT } from '@chatdom/content/materials';
import type { AvatarCapeBlueprint } from '@chatdom/shared';
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
    ];
    validateLook(blueprints);
    return { id: variant.id, cape: { version: 1, id: `cape.short.${variant.id}`, kind: 'cape', attachment: 'back', shape: 'flared', width: .58, length: .61, hem: 'rounded', trimWidth: .018, mount: { height: .0625, back: .095 }, colours: { cloth: variant.id === 'tide' ? MAT.fabricBlue : variant.id === 'grove' ? MAT.fabricGreen : MAT.fabricRed, lining: MAT.fabricMutedGold, trim: MAT.cloth } } satisfies AvatarCapeBlueprint, parts: blueprints.map(blueprint => ({ blueprint, asset: compileAvatarPart(blueprint, 0) })) };
  });
}
