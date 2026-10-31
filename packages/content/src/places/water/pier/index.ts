import type { VoxelBlueprint } from '@chatdom/shared';
import type { StyleKey } from '../../../materials';
import type { WaterPiece } from '../place-piece';
import { createPier, type PierSite } from './pier';

export { PIER, createPier, type Pier, type PierModule, type PierRole, type PierSite } from './pier';

/**
 * The review site: the land's 24 m walk and 0.7 m deck, the bank two cells under the deck at the root, shelving
 * from the waterline about 1.3 m out to a 2.4 m lake under the head. The real depths come from the land's
 * `lake:pier` foundation grid.
 */
export const PIER_REVIEW_SITE: PierSite = {
  walk: 192,
  freeboard: 5.6,
  seed: 29,
  depth: (x, z) => 2 + Math.min(23.6, Math.max(0, (z - 6) * 0.3)) + 0.4 * Math.sin(x * 0.21 + z * 0.13),
};

const PIER_STYLES = ['tide', 'hearth', 'grove'] as const satisfies readonly StyleKey[];

/** Every module of the review pier in each kit: its root with the name board, five bays and the T-head. */
export const PIER_PIECES: readonly WaterPiece[] = PIER_STYLES.flatMap(style => createPier(style, PIER_REVIEW_SITE).modules.map(m => m.piece));

export const PIER_BLUEPRINTS: readonly VoxelBlueprint[] = PIER_PIECES.map(piece => piece.blueprint);
