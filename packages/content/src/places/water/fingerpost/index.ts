import type { VoxelBlueprint } from '@chatdom/shared';
import { STYLES, type StyleKey } from '../../../materials';
import type { WaterPiece } from '../place-piece';
import { FINGERPOST_DESTINATIONS } from './frame';
import { createFingerpost } from './post';

export { FINGER_ARM_ROOT_SEEDS, createFingerArm } from './arm';
export {
  FINGERPOST, FINGERPOST_DESTINATIONS, fingerpostFrame, type FingerpostDestination, type FingerpostFrame,
} from './frame';
export { createFingerpost, createFingerpostPost, type Fingerpost, type FingerpostArm } from './post';

const STYLE_KEYS = Object.keys(STYLES) as StyleKey[];

/**
 * Per kit, the post for all four destinations and its four arms. A real post carries only the destinations the
 * host supplies; the catalogue shows the fullest one so every arm and emblem is reviewed.
 */
export const FINGERPOST_PIECES: readonly WaterPiece[] = STYLE_KEYS.flatMap(style => {
  const { post, arms } = createFingerpost(style, FINGERPOST_DESTINATIONS);
  return [post, ...arms.map(arm => arm.piece)];
});

export const FINGERPOST_BLUEPRINTS: readonly VoxelBlueprint[] = FINGERPOST_PIECES.map(piece => piece.blueprint);
