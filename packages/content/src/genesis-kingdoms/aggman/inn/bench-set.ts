import type { BenchSet } from '../bench/set';
import { AGGMAN_LIVERY } from '../piece';
import { createHarbourInn } from './inn';

/** The Wren and Willow alone on the lane bench, in The_AGGman's proposed livery. */
export const BENCH_SET: BenchSet = { name: 'inn', pieces: [{ piece: createHarbourInn(AGGMAN_LIVERY), at: [0, 0] }] };
