import { MAT } from '../materials';
import { AVATAR_MATERIALS, GARB, KIT_ACCENTS } from '../avatars/index';
import type { KeeperKitId, KeeperPalette } from './types';

/**
 * Keeper livery per kingdom kit, from registered avatar-palette keys only (the avatar compiler rejects anything else).
 * Hearth leans madder and ochre by firelight, Tide sea-blue and sand, Grove moss and honey. Avatar parts have no
 * Grove trim key (bark and dark stone are build-only), so Grove borrows Hearth's timber and limestone.
 */
export const KEEPER_PALETTES: Readonly<Record<KeeperKitId, KeeperPalette>> = {
  hearth: {
    kit: 'hearth', livery: MAT.fabricRed, quiet: MAT.fabricMutedRed, accent: MAT.fabricGold,
    leather: GARB.leather, metal: GARB.clasp, pale: GARB.linen, stone: KIT_ACCENTS.hearth.stone,
  },
  tide: {
    kit: 'tide', livery: MAT.fabricBlue, quiet: MAT.fabricMutedBlue, accent: MAT.fabricOrange,
    leather: GARB.leather, metal: GARB.clasp, pale: GARB.linen, stone: KIT_ACCENTS.tide.stone,
  },
  grove: {
    kit: 'grove', livery: MAT.fabricGreen, quiet: MAT.fabricMutedGreen, accent: MAT.fabricGold,
    leather: GARB.leather, metal: GARB.clasp, pale: GARB.linen, stone: KIT_ACCENTS.hearth.stone,
  },
};

for (const palette of Object.values(KEEPER_PALETTES)) {
  for (const [slot, id] of Object.entries(palette)) {
    if (slot !== 'kit' && !AVATAR_MATERIALS.has(id as number)) throw new Error(`Keeper ${palette.kit} ${slot} ${String(id)} is outside the avatar palette.`);
  }
}

export function keeperPalette(kit: KeeperKitId): KeeperPalette {
  const palette = Object.hasOwn(KEEPER_PALETTES, kit) ? KEEPER_PALETTES[kit] : undefined;
  if (!palette) throw new Error(`Unknown keeper kit ${String(kit)}.`);
  return palette;
}
