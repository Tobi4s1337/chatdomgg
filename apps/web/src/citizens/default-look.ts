import { createBodyParts, createHairParts, compileAvatarPart, validateLook } from '@chatdom/content/avatars';
import { AVATAR_PALETTE, MAT } from '@chatdom/content/materials';
import type { AvatarCapeBlueprint, AvatarPartBlueprint } from '@chatdom/shared';
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
    { id: 'hearth', skin: AVATAR_PALETTE.skin[2], hair: AVATAR_PALETTE.hair[1], shirt: MAT.cream, trousers: MAT.fabricMutedBlue, cape: MAT.fabricRed },
    { id: 'tide', skin: AVATAR_PALETTE.skin[6], hair: AVATAR_PALETTE.hair[0], shirt: MAT.fabricMutedBlue, trousers: MAT.earth, cape: null },
    { id: 'grove', skin: AVATAR_PALETTE.skin[0], hair: AVATAR_PALETTE.hair[4], shirt: MAT.fabricMutedGreen, trousers: MAT.fabricMutedGold, cape: null },
    { id: 'clay', skin: AVATAR_PALETTE.skin[4], hair: AVATAR_PALETTE.hair[2], shirt: MAT.fabricMutedRed, trousers: MAT.fabricMutedBlue, cape: null },
    { id: 'sun', skin: AVATAR_PALETTE.skin[7], hair: AVATAR_PALETTE.hair[3], shirt: MAT.fabricMutedGold, trousers: MAT.fabricMutedGreen, cape: MAT.fabricBlue },
    { id: 'dusk', skin: AVATAR_PALETTE.skin[1], hair: AVATAR_PALETTE.hair[5], shirt: MAT.fabricMutedViolet, trousers: MAT.earth, cape: null },
  ] as const;
  return variants.map(variant => {
    const blueprints = [
      ...createBodyParts('balanced', variant.skin).map(part => dyeGarb(part, variant.shirt, variant.trousers)),
      ...createHairParts('sidePart', { body: 'balanced', hair: variant.hair, headwear: null }),
    ];
    validateLook(blueprints);
    const cape: AvatarCapeBlueprint | undefined = variant.cape === null ? undefined : {
      version: 1, id: `cape.short.${variant.id}`, kind: 'cape', attachment: 'back', shape: 'flared', width: .58, length: .61,
      hem: 'rounded', trimWidth: .018, mount: { height: .0625, back: .095 },
      colours: { cloth: variant.cape, lining: MAT.fabricMutedGold, trim: MAT.cloth },
    };
    return { id: variant.id, ...(cape ? { cape } : {}), parts: blueprints.map(blueprint => ({ blueprint, asset: compileAvatarPart(blueprint, 0) })) };
  });
}
