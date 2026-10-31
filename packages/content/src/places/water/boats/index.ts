import type { VoxelBlueprint } from '@chatdom/shared';
import type { StyleKey } from '../../../materials';
import type { WaterPiece } from '../place-piece';
import { createRowingBoat, createUpturnedBoat } from './boat';
import { BOAT_VARIANTS } from './hull';

export { ROWING_BOAT, UPTURNED_BOAT, createRowingBoat, createUpturnedBoat } from './boat';
export { BOAT_VARIANTS, HULL, HULL_PAINT, type BoatVariant, type HullPaint } from './hull';

const BOAT_STYLES = ['hearth', 'tide', 'grove'] as const satisfies readonly StyleKey[];

/**
 * Every rowing boat (three paint variants per kit) and one upturned boat per kit. Each kit's upturned boat takes
 * the kit's index as its variant, so the three review boats ashore show all three paints between them.
 */
export const BOAT_PIECES: readonly WaterPiece[] = [
  ...BOAT_STYLES.flatMap(style => BOAT_VARIANTS.map(variant => createRowingBoat(style, variant))),
  ...BOAT_STYLES.map((style, i) => createUpturnedBoat(style, BOAT_VARIANTS[i]!)),
];

export const BOAT_BLUEPRINTS: readonly VoxelBlueprint[] = BOAT_PIECES.map(piece => piece.blueprint);
