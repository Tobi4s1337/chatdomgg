import type { VoxelBlueprint } from '@chatdom/shared';
import { STYLES, type StyleKey } from '../../../materials';
import type { WaterPiece } from '../place-piece';
import { createLilies, createReeds } from './plants';
import { SHORE_VARIANTS } from './shape';
import { createFishingRock, createPebbles, createSteppingStones } from './stones';

export { createLilies, createReeds } from './plants';
export { SHORE_VARIANTS, type ShoreVariant } from './shape';
export { createFishingRock, createPebbles, createSteppingStones, fishingRockTop, steppingStoneHops } from './stones';

const STYLE_KEYS = Object.keys(STYLES) as StyleKey[];

/** The water depth the catalogue's rock and stepping stones are built for: half a metre over the bed. */
const CATALOGUE_WATER = 4;

/**
 * Every shore piece the lake place draws on, in each kit and variant: reed clumps, lily rafts and pebble shoals,
 * and the fishing rock with the stepping stones that lead out to it in half a metre of water. Hosts needing
 * another depth call the factories directly.
 */
export const SHORE_PIECES: readonly WaterPiece[] = STYLE_KEYS.flatMap(style => SHORE_VARIANTS.flatMap(variant => [
  createReeds(style, variant),
  createLilies(style, variant),
  createPebbles(style, variant),
  createFishingRock(style, variant, CATALOGUE_WATER),
  createSteppingStones(style, variant, CATALOGUE_WATER),
]));

export const SHORE_BLUEPRINTS: readonly VoxelBlueprint[] = SHORE_PIECES.map(piece => piece.blueprint);
