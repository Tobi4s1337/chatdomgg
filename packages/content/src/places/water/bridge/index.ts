import type { VoxelBlueprint } from '@chatdom/shared';
import type { CivicStyle } from '../../../civic/kit';
import type { WaterPiece } from '../place-piece';
import { createHumpbackBridge } from './bridge';

export { BRIDGE, bridgeFrame, createHumpbackBridge, humpbackDeckTop, intradosRow, type BridgeFrame } from './bridge';

/**
 * The review site: a pool six cells (0.75 m) deep under the arch, its banks a metre over the water. The real
 * heights come from the land's `mill:bridge` site and its sampler.
 */
const REVIEW_SITE = { water: 6, bank: 14 } as const;

/** One humpback bridge per civic kit; the civic crest on its keystone is the kit's own. */
export const BRIDGE_PIECES: readonly WaterPiece[] = (['hearth', 'tide'] as const satisfies readonly CivicStyle[])
  .map(style => createHumpbackBridge(style, REVIEW_SITE.water, REVIEW_SITE.bank));

export const BRIDGE_BLUEPRINTS: readonly VoxelBlueprint[] = BRIDGE_PIECES.map(piece => piece.blueprint);
