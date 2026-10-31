import type { VoxelBlueprint } from '@chatdom/shared';
import type { StyleKey } from '../../../materials';
import type { WaterPiece } from '../place-piece';
import { createWheelPit } from './pit';
import { createWeir } from './weir';
import { createMillWheel } from './wheel';

export { WHEEL, WHEEL_AXLE_SEEDS, createMillWheel } from './wheel';
export { WHEEL_PIT, createWheelPit, wheelPitFrame, wheelPitTrestles, type WheelPitFrame } from './pit';
export { WEIR, createWeir, weirFrame, weirLevels, type WeirFrame, type WeirLevels } from './weir';

const MILLRACE_STYLES = ['hearth', 'tide', 'grove'] as const satisfies readonly StyleKey[];

/**
 * A representative launder for review: six metres of trough beyond the pit on three trestles, their feet on
 * ground that climbs towards the leat (1.5 m, 2.75 m and 4 m above the pit floor). The real feet come from the
 * land's sampler at the `mill:wheel` site.
 */
const REVIEW_RUN = 48, REVIEW_FEET = [12, 22, 32] as const;
/** A 4 m clear stream over a 0.75 m fall. */
const REVIEW_WEIR = { width: 32, drop: 6 } as const;

/** One wheel, one wheel pit with its launder and one weir per kit. */
export const MILLRACE_PIECES: readonly WaterPiece[] = MILLRACE_STYLES.flatMap(style => [
  createMillWheel(style),
  createWheelPit(style, REVIEW_RUN, REVIEW_FEET),
  createWeir(style, REVIEW_WEIR.width, REVIEW_WEIR.drop),
]);

export const MILLRACE_BLUEPRINTS: readonly VoxelBlueprint[] = MILLRACE_PIECES.map(piece => piece.blueprint);
