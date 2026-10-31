import type { VoxelBlueprint } from '@chatdom/shared';
import type { StyleKey } from '../../../materials';
import type { WaterPiece } from '../place-piece';
import { BOATHOUSE_REVIEW_SITE, createBoathouse } from './boathouse';

export { BOATHOUSE, BOATHOUSE_REVIEW_SITE, createBoathouse, type BoathouseSite, type PileSpot } from './boathouse';

const BOATHOUSE_STYLES = ['hearth', 'tide', 'grove'] as const satisfies readonly StyleKey[];

/** One boathouse per kit on the review shore; Tide's, under slate, is the one that stands on the lake. */
export const BOATHOUSE_PIECES: readonly WaterPiece[] = BOATHOUSE_STYLES.map(style => createBoathouse(style, BOATHOUSE_REVIEW_SITE));

export const BOATHOUSE_BLUEPRINTS: readonly VoxelBlueprint[] = BOATHOUSE_PIECES.map(piece => piece.blueprint);
