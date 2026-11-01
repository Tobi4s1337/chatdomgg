import { createRowingBoat, createUpturnedBoat } from '../../../places/water/boats/index';
import type { BenchSet } from '../bench/set';
const boat = createRowingBoat('tide', 0), up = createUpturnedBoat('tide', 1);
export const BENCH_SET: BenchSet = { name: 'smoke', pieces: [
  { piece: { blueprint: boat.blueprint, lanterns: [[5, 9, 27]], footprint: { from: [0, 0], to: [11, 28] }, draft: 2 }, at: [0, 0] },
  { piece: { blueprint: up.blueprint, lanterns: [], footprint: { from: [0, 0], to: [11, 28] } }, at: [20, 0] },
] };
