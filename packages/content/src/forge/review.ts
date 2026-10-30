import type { ForgeReviewFixture, ForgeReviewInstance } from './compose';
import type { QuarterTurn } from './grammar';

const at = (id: string, form: string, position: readonly [number, number, number], quarterTurns: QuarterTurn): ForgeReviewInstance =>
  ({ id, pieceId: `forge-hearthfold-${form}`, position, quarterTurns });

/**
 * Hearthfold cottage, gable to the street: a 32 × 48-cell footprint at x 16..48, z 68..116 of the hut's active depth
 * (z 64..128). Two by three floor tiles, a ring of four corners and six bays, and a 3:2 course roof whose ridge runs
 * toward the street. The door sits under the front gable; windows look east and west from the front bays.
 */
const hearthfold: ForgeReviewFixture = {
  familyId: 'hearthfold',
  entrance: [32, 12, 114],
  instances: [
    ...[0, 1].flatMap(i => [0, 1, 2].map(k => at(`floor-${i}-${k}`, 'floor', [16 + 16 * i, 0, 68 + 16 * k], 0))),
    at('corner-sw', 'wall-corner', [16, 2, 108], 0),
    at('door', 'door', [24, 2, 112], 0),
    at('corner-se', 'wall-corner', [40, 2, 116], 1),
    at('window-east', 'window', [44, 2, 108], 1),
    at('wall-east', 'wall', [44, 2, 92], 1),
    at('corner-ne', 'wall-corner', [48, 2, 76], 2),
    at('wall-north', 'wall', [40, 2, 72], 2),
    at('corner-nw', 'wall-corner', [24, 2, 68], 3),
    at('wall-west', 'wall', [20, 2, 76], 3),
    at('window-west', 'window', [20, 2, 92], 3),
    ...[0, 1, 2].flatMap(k => [
      at(`slope-east-${k}`, 'roof-slope', [32, 20, 84 + 16 * k], 1),
      at(`slope-west-${k}`, 'roof-slope', [32, 20, 68 + 16 * k], 3),
      at(`ridge-${k}`, 'roof-ridge', [28, 49, 84 + 16 * k], 1),
    ]),
    at('gable-south', 'roof-gable', [20, 26, 112], 0),
    at('gable-north', 'roof-gable', [44, 26, 72], 2),
    at('verge-south', 'roof-verge', [11, 19, 116], 0),
    at('verge-north', 'roof-verge', [53, 19, 68], 2),
  ],
};

export const FORGE_REVIEW: readonly ForgeReviewFixture[] = [hearthfold];
