import type { AudioMaterial } from '../../types';
import { EARTH_MATERIAL, EARTH_PLACE, EARTH_REMOVE, EARTH_STEP } from './earth';
import { FABRIC_MATERIAL, FABRIC_PLACE, FABRIC_REMOVE, FABRIC_STEP } from './fabric';
import { GLASS_MATERIAL, GLASS_PLACE, GLASS_REMOVE, GLASS_STEP } from './glass';
import type { MaterialAction } from './handling';
import { METAL_MATERIAL, METAL_PLACE, METAL_REMOVE, METAL_STEP } from './metal';
import { STONE_MATERIAL, STONE_PLACE, STONE_REMOVE, STONE_STEP } from './stone';
import { WOOD_MATERIAL, WOOD_PLACE, WOOD_REMOVE, WOOD_STEP } from './wood';

export type MaterialCue = 'step' | 'place' | 'remove' | 'material';

/** Every material action on every surface. */
export const SURFACES: Readonly<Record<AudioMaterial, Readonly<Record<MaterialCue, MaterialAction>>>> = {
  wood: { step: WOOD_STEP, place: WOOD_PLACE, remove: WOOD_REMOVE, material: WOOD_MATERIAL },
  stone: { step: STONE_STEP, place: STONE_PLACE, remove: STONE_REMOVE, material: STONE_MATERIAL },
  earth: { step: EARTH_STEP, place: EARTH_PLACE, remove: EARTH_REMOVE, material: EARTH_MATERIAL },
  metal: { step: METAL_STEP, place: METAL_PLACE, remove: METAL_REMOVE, material: METAL_MATERIAL },
  glass: { step: GLASS_STEP, place: GLASS_PLACE, remove: GLASS_REMOVE, material: GLASS_MATERIAL },
  fabric: { step: FABRIC_STEP, place: FABRIC_PLACE, remove: FABRIC_REMOVE, material: FABRIC_MATERIAL },
};
