import type { ForgeReviewFixture, ForgeReviewInstance } from './compose';
import type { ForgeFamilyId, QuarterTurn } from './grammar';

const family = (familyId: ForgeFamilyId) => (id: string, form: string, position: readonly [number, number, number], quarterTurns: QuarterTurn): ForgeReviewInstance =>
  ({ id, pieceId: `forge-${familyId}-${form}`, position, quarterTurns });
const at = family('hearthfold');

/** The shared shell: six floor tiles, a ring of four corners, a door, two windows and three plain bays (32 × 48). */
const shell = (place: typeof at) => [
  ...[0, 1].flatMap(i => [0, 1, 2].map(k => place(`floor-${i}-${k}`, 'floor', [16 + 16 * i, 0, 68 + 16 * k], 0))),
  place('corner-sw', 'wall-corner', [16, 2, 108], 0),
  place('door', 'door', [24, 2, 112], 0),
  place('corner-se', 'wall-corner', [40, 2, 116], 1),
  place('window-east', 'window', [44, 2, 108], 1),
  place('wall-east', 'wall', [44, 2, 92], 1),
  place('corner-ne', 'wall-corner', [48, 2, 76], 2),
  place('wall-north', 'wall', [40, 2, 72], 2),
  place('corner-nw', 'wall-corner', [24, 2, 68], 3),
  place('wall-west', 'wall', [20, 2, 76], 3),
  place('window-west', 'window', [20, 2, 92], 3),
];

/**
 * Hearthfold cottage, gable to the street: a 32 × 48-cell footprint at x 16..48, z 68..116 of the hut's active depth
 * (z 64..128). Two by three floor tiles, a ring of four corners and six bays, and a 3:2 course roof whose ridge runs
 * toward the street. The door sits under the front gable; shuttered windows look east and west from the front bays.
 * Two deck modules make a doorstep terrace to the lot edge, two posts and a beam carry a gabled hood whose ledger
 * bears on the plate over the door, and a crooked chimney rises from the back of the west slope.
 */
const hearthfold: ForgeReviewFixture = {
  familyId: 'hearthfold',
  entrance: [32, 12, 114],
  instances: [
    ...shell(at),
    ...[0, 1, 2].flatMap(k => [
      at(`slope-east-${k}`, 'roof-slope', [32, 20, 84 + 16 * k], 1),
      at(`slope-west-${k}`, 'roof-slope', [32, 20, 68 + 16 * k], 3),
      at(`ridge-${k}`, 'roof-ridge', [28, 49, 84 + 16 * k], 1),
    ]),
    at('gable-south', 'roof-gable', [20, 26, 112], 0),
    at('gable-north', 'roof-gable', [44, 26, 72], 2),
    at('verge-south', 'roof-verge', [11, 19, 116], 0),
    at('verge-north', 'roof-verge', [53, 19, 68], 2),
    at('shutters-east', 'shutter-pair', [48, 9, 110], 1),
    at('shutters-west', 'shutter-pair', [16, 9, 90], 3),
    at('deck-west', 'porch-deck', [16, 0, 116], 0),
    at('deck-east', 'porch-deck', [32, 0, 116], 0),
    at('post-west', 'porch-post', [21, 2, 121], 0),
    at('post-east', 'porch-post', [43, 2, 125], 2),
    at('beam', 'trim', [24, 23, 121], 0),
    at('canopy', 'porch-canopy', [22, 24, 116], 0),
    at('chimney', 'chimney', [29, 40, 72], 3),
  ],
};

const tw = family('tidewake');

/**
 * Tidewake cottage on the same 32 × 48 footprint and gable to the street, so the two hands compare directly. The 1:1
 * slate roof sits three cells lower on the plates (slope y 23) and its kicked eaves reach six cells past the walls
 * (x 10..54); the verges cover both roof ends with bargeboards. A boardwalk doorstep of two modules carries two
 * posts beside the door (x 24..26, 38..40) with the lintel beam on their heads; the nested hood bears on the door
 * plate, the beam and the posts' knee braces. A narrow cowled chimney stands near the ridge at the back of the west
 * slope, where the review camera sees it.
 */
const tidewake: ForgeReviewFixture = {
  familyId: 'tidewake',
  entrance: [32, 12, 114],
  instances: [
    ...shell(tw),
    ...[0, 1, 2].flatMap(k => [
      tw(`slope-east-${k}`, 'roof-slope', [32, 23, 84 + 16 * k], 1),
      tw(`slope-west-${k}`, 'roof-slope', [32, 23, 68 + 16 * k], 3),
      tw(`ridge-${k}`, 'roof-ridge', [29, 42, 84 + 16 * k], 1),
    ]),
    tw('gable-south', 'roof-gable', [20, 26, 112], 0),
    tw('gable-north', 'roof-gable', [44, 26, 72], 2),
    tw('verge-south', 'roof-verge', [9, 21, 116], 0),
    tw('verge-north', 'roof-verge', [55, 21, 68], 2),
    tw('shutters-east', 'shutter-pair', [48, 8, 110], 1),
    tw('shutters-west', 'shutter-pair', [16, 8, 90], 3),
    tw('deck-west', 'porch-deck', [16, 0, 116], 0),
    tw('deck-east', 'porch-deck', [32, 0, 116], 0),
    tw('post-west', 'porch-post', [21, 2, 121], 0),
    tw('post-east', 'porch-post', [43, 2, 125], 2),
    tw('beam', 'trim', [24, 23, 121], 0),
    tw('canopy', 'porch-canopy', [22, 24, 116], 0),
    tw('chimney', 'chimney', [30, 38, 73], 3),
  ],
};

export const FORGE_REVIEW: readonly ForgeReviewFixture[] = [hearthfold, tidewake];
