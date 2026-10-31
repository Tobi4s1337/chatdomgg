import type { VoxelBlueprint } from '@chatdom/shared';
import type { StyleKey } from '../../../materials';
import type { WaterPiece } from '../place-piece';
import { createMill } from './mill';

export { MILL, createMill } from './mill';

const MILL_STYLES = ['hearth', 'tide', 'grove'] as const satisfies readonly StyleKey[];

/** One mill per kit; Grove's, under thatch, is the one that stands by the millstream. */
export const MILL_PIECES: readonly WaterPiece[] = MILL_STYLES.map(style => createMill(style));

export const MILL_BLUEPRINTS: readonly VoxelBlueprint[] = MILL_PIECES.map(piece => piece.blueprint);
