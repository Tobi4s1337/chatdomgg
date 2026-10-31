import { createBodyParts, createHairParts, createCape, createWearableParts, compileAvatarPart, validateLook } from '@chatdom/content/avatars';
import { AVATAR_PALETTE, MAT } from '@chatdom/content/materials';
import type { AvatarPartBlueprint } from '@chatdom/shared';
import type { CitizenLook } from './index';

/** Re-dye only the neutral garment cells; face, hands, belt and shoes retain their authored materials. */
function dyeGarb(part: AvatarPartBlueprint, shirt: number, trousers: number): AvatarPartBlueprint {
  const isShirt = ['chest', 'pelvis', 'upperArmLeft', 'upperArmRight', 'forearmLeft', 'forearmRight'].includes(part.attachment);
  const isTrousers = ['pelvis', 'thighLeft', 'thighRight', 'shinLeft', 'shinRight'].includes(part.attachment);
  return { ...part, boxes: part.boxes.map(box => ({ ...box,
    material: isShirt && box.material === MAT.cream ? shirt : isTrousers && box.material === MAT.earth ? trousers : box.material,
  })) };
}

/** Curated everyday clothing; selection remains the caller's responsibility. */
export function createDefaultCitizenLooks(): readonly CitizenLook[] {
  const variants = [
    { id: 'hearth', body: 'balanced', hairForm: 'sidePart', skin: AVATAR_PALETTE.skin[2], hair: AVATAR_PALETTE.hair[1], shirt: MAT.cream, trousers: MAT.fabricMutedBlue, cape: 'hearth' },
    { id: 'tide', body: 'broad', hairForm: 'coiledHighCrown', skin: AVATAR_PALETTE.skin[6], hair: AVATAR_PALETTE.hair[0], shirt: MAT.fabricMutedBlue, trousers: MAT.earth, cape: null },
    { id: 'grove', body: 'slender', hairForm: 'bob', skin: AVATAR_PALETTE.skin[0], hair: AVATAR_PALETTE.hair[4], shirt: MAT.fabricMutedGreen, trousers: MAT.fabricMutedGold, cape: null },
    { id: 'clay', body: 'round', hairForm: 'roundedCurls', skin: AVATAR_PALETTE.skin[4], hair: AVATAR_PALETTE.hair[2], shirt: MAT.fabricMutedRed, trousers: MAT.fabricMutedBlue, cape: null },
    { id: 'sun', body: 'broad', hairForm: 'longBraid', skin: AVATAR_PALETTE.skin[7], hair: AVATAR_PALETTE.hair[3], shirt: MAT.fabricMutedGold, trousers: MAT.fabricMutedGreen, cape: 'tide' },
    { id: 'dusk', body: 'slender', hairForm: 'pairedTwists', skin: AVATAR_PALETTE.skin[1], hair: AVATAR_PALETTE.hair[5], shirt: MAT.fabricMutedViolet, trousers: MAT.earth, cape: null },
  ] as const;
  return variants.map(variant => {
    const blueprints = [
      ...createBodyParts(variant.body, variant.skin).map(part => dyeGarb(part, variant.shirt, variant.trousers)),
      ...createHairParts(variant.hairForm, { body: variant.body, hair: variant.hair, headwear: null }),
      ...(variant.cape ? createWearableParts('shortCloak', { body: variant.body, style: variant.cape }) : []),
    ];
    validateLook(blueprints);
    const cape = variant.cape ? createCape('shortCloak', { body: variant.body, style: variant.cape }) : undefined;
    return { id: variant.id, ...(cape ? { cape } : {}), parts: blueprints.map(blueprint => ({ blueprint, asset: compileAvatarPart(blueprint, 0) })) };
  });
}
