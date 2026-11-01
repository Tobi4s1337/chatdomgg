import type { BenchSet } from '../bench/set';
import { createGaggle, createGoose, createGooseFamily, GAGGLE_SEEDS, GOOSE_POSES, GOOSE_VARIANTS } from './index';

/**
 * The geese on the lane bench: each pose in a column (swimmers last) with its three variants one behind the
 * other, then the three family walks and the two gaggles behind them. Twelve to fourteen cells apart, since a
 * goose is only eight to ten cells long.
 */
export const BENCH_SET: BenchSet = {
  name: 'geese',
  pieces: [
    ...GOOSE_POSES.flatMap((pose, column) => GOOSE_VARIANTS.map(variant => ({
      piece: createGoose(pose, variant), at: [column * 12, (2 - variant) * 14] as const,
    }))),
    ...GOOSE_VARIANTS.map(variant => ({ piece: createGooseFamily(variant), at: [variant * 10, -34] as const })),
    ...GAGGLE_SEEDS.map((seed, i) => ({ piece: createGaggle(seed), at: [32 + i * 36, -34] as const })),
  ],
};
