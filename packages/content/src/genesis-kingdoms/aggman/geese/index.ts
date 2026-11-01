import type { AggmanPiece } from '../piece';
import { createGoose, GOOSE_POSES, GOOSE_VARIANTS } from './goose';
import { createGaggle, createGooseFamily } from './groups';

export { createGoose, gooseCells, GOOSE_POSES, GOOSE_VARIANTS, SWIM_DRAFT, type GoosePose, type GooseVariant } from './goose';
export { createGaggle, createGooseFamily, goslingCells, planGaggle, type GaggleMember } from './groups';

/** The seeds of the two gaggles the hamlet ships with. */
export const GAGGLE_SEEDS = ['green', 'shingle'] as const;

/** Every goose pose in each variant, the three family walks and the hamlet's two gaggles. */
export const GOOSE_PIECES: AggmanPiece[] = [
  ...GOOSE_POSES.flatMap(pose => GOOSE_VARIANTS.map(variant => createGoose(pose, variant))),
  ...GOOSE_VARIANTS.map(variant => createGooseFamily(variant)),
  ...GAGGLE_SEEDS.map(seed => createGaggle(seed)),
];
