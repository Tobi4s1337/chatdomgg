import { AGGMAN_LIVERY } from '../piece';
import type { BenchSet } from '../bench/set';
import { createHarbourCoble } from './coble';
import { createDrawnUpBoat } from './drawn-up';
import { createHarbourLantern, createMooringBollard, createSlipwayCapstan } from './quay';
import { createFishCrates, createNetRack, createPotStack } from './shore';

/**
 * The working harbour on the lane bench, in The_AGGman's proposed livery: the two cobles and the three drawn-up
 * boats along the back, the net rack and pot stacks in the middle, the quay furniture and the catch in front.
 */
export const BENCH_SET: BenchSet = { name: 'harbour', pieces: [
  { piece: createHarbourCoble(AGGMAN_LIVERY, 0), at: [0, 0] },
  { piece: createHarbourCoble(AGGMAN_LIVERY, 1), at: [24, 0] },
  { piece: createDrawnUpBoat(AGGMAN_LIVERY, 0), at: [48, 8] },
  { piece: createDrawnUpBoat(AGGMAN_LIVERY, 1), at: [72, 8] },
  { piece: createDrawnUpBoat(AGGMAN_LIVERY, 2), at: [96, 8] },
  { piece: createNetRack(AGGMAN_LIVERY), at: [0, 66] },
  { piece: createPotStack(AGGMAN_LIVERY, 0), at: [40, 66] },
  { piece: createPotStack(AGGMAN_LIVERY, 1), at: [80, 66] },
  { piece: createMooringBollard(0), at: [0, 94] },
  { piece: createMooringBollard(1), at: [18, 94] },
  { piece: createHarbourLantern(AGGMAN_LIVERY), at: [36, 94] },
  { piece: createSlipwayCapstan(), at: [56, 92] },
  { piece: createFishCrates(AGGMAN_LIVERY), at: [88, 94] },
] };
