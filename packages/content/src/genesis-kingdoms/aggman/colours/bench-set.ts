import { clothArms } from '../../../genesis-heraldry/arms';
import type { BenchSet } from '../bench/set';
import { AGGMAN_LIVERY } from '../piece';
import { COLOUR_PIECES } from './index';

const pieces = COLOUR_PIECES(AGGMAN_LIVERY, clothArms('forked', 'wave'));
let x = 0;

export const BENCH_SET: BenchSet = {
  name: 'colours',
  pieces: pieces.map(piece => {
    const at: [number, number] = [x, 0];
    x += piece.blueprint.size[0] + 4;
    return { piece, at };
  }),
};
