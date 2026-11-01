import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../../../materials';
import { Grid, blob, bloom, blueprint } from './shape';

/** The cresset's frame in build cells: the post stands on the centre of a 10 × 10 footprint, y = 0 the ground. */
export const RIVER_CRESSET = {
  size: [10, 27, 10] as const,
  /** Flame base: centre of the basket's open top, on the ember bed. */
  fire: [5, 23, 5] as const,
  /** The basket's open mouth, half-open X/Z range, and its rim course. */
  mouth: { x: [1, 9] as const, z: [1, 9] as const, rim: 26 },
};

/**
 * Bars around a square ring of cells: corner bars, then bars in a symmetric rhythm along each side, so the cage
 * reads as forged iron with gaps the fire shows through rather than a solid can.
 */
function bars(grid: Grid, lo: number, hi: number, y0: number, y1: number, pattern: readonly number[]) {
  for (let i = lo; i < hi; i++) {
    if (!pattern.includes(i - lo)) continue;
    grid.fill(i, y0, lo, i + 1, y1, lo + 1, MAT.darkStone);
    grid.fill(i, y0, hi - 1, i + 1, y1, hi, MAT.darkStone);
    grid.fill(lo, y0, i, lo + 1, y1, i + 1, MAT.darkStone);
    grid.fill(hi - 1, y0, i, hi, y1, i + 1, MAT.darkStone);
  }
}

/** A square ring one cell wide on the perimeter of [lo, hi)². */
function ring(grid: Grid, lo: number, hi: number, y: number, material: number) {
  grid.fill(lo, y, lo, hi, y + 1, lo + 1, material);
  grid.fill(lo, y, hi - 1, hi, y + 1, hi, material);
  grid.fill(lo, y, lo, lo + 1, y + 1, hi, material);
  grid.fill(hi - 1, y, lo, hi, y + 1, hi, material);
}

/**
 * A riverside fire post, 3.4 m to the rim. A dark plinth, a chamfered limestone die and an oversailing dark coping
 * carry a brass socket and an iron post with two brass collars. Four bracket arms step out to an iron floor, and on it
 * a flared cage: a lower course of bars, a doubled hoop, an upper course of wider bars and an open rim with brass
 * corners. Inside, two crossed pairs of logs hold an ember bed of orange and gold. A climbing rose is planted at one
 * corner of the plinth and spreads over the die and the coping with three heads. `fire` is where the host mounts
 * the real flame.
 */
export function createRiverCresset(): { blueprint: VoxelBlueprint; fire: Vec3 } {
  const grid = new Grid(RIVER_CRESSET.size), seed = 0xc4e55e7;

  // Base: plinth, die, coping and the post's brass socket.
  grid.softSquare(1, 1, 9, 9, 0, 1, MAT.darkStone);
  grid.softSquare(2, 2, 8, 8, 1, 4, MAT.limestone);
  grid.softSquare(1, 1, 9, 9, 4, 5, MAT.darkStone);
  grid.softSquare(3, 3, 7, 7, 5, 6, MAT.brass);

  // The iron post and its collars.
  grid.fill(4, 6, 4, 6, 19, 6, MAT.darkStone);
  for (const y of [11, 15]) grid.softSquare(3, 3, 7, 7, y, y + 1, MAT.brass);

  // Four bracket arms, each stepping out two cells to the basket floor.
  for (const [ax, az, w, d, ox, oz] of [[6, 4, 1, 2, 1, 0], [3, 4, 1, 2, -1, 0], [4, 6, 2, 1, 0, 1], [4, 3, 2, 1, 0, -1]] as const) {
    grid.fill(ax, 16, az, ax + w, 19, az + d, MAT.darkStone);
    grid.fill(ax + ox, 18, az + oz, ax + ox + w, 20, az + oz + d, MAT.darkStone);
  }

  // The basket: a pan, a floor, lower bars, a doubled hoop, upper bars and the open rim.
  grid.fill(3, 19, 3, 7, 20, 7, MAT.darkStone);
  grid.fill(2, 20, 2, 8, 21, 8, MAT.darkStone);
  bars(grid, 2, 8, 21, 23, [0, 2, 3, 5]);
  ring(grid, 1, 9, 23, MAT.darkStone);
  ring(grid, 2, 8, 23, MAT.darkStone);
  bars(grid, 1, 9, 24, 26, [0, 2, 5, 7]);
  ring(grid, 1, 9, 26, MAT.darkStone);
  for (const [x, z] of [[1, 1], [8, 1], [1, 8], [8, 8]] as const) grid.set(x, 26, z, MAT.brass);

  // Fuel: two logs along X, two across them along Z, and the ember bed glowing between.
  grid.fill(3, 21, 3, 7, 22, 7, MAT.fabricOrange);
  grid.fill(3, 21, 3, 7, 22, 4, MAT.bark);
  grid.fill(3, 21, 6, 7, 22, 7, MAT.bark);
  grid.fill(3, 22, 3, 4, 23, 7, MAT.bark);
  grid.fill(6, 22, 3, 7, 23, 7, MAT.bark);
  grid.fill(4, 22, 4, 6, 23, 6, MAT.fabricGold);
  grid.set(4, 22, 3, MAT.fabricOrange);
  grid.set(5, 22, 6, MAT.fabricOrange);

  // A rose planted at the plinth's corner, spreading over the die and up onto the coping.
  blob(grid, [8.4, 0.2, 7.6], [2.2, 4.1, 2.4], MAT.leaf, { allow: (x, y) => y < 5 });
  blob(grid, [8.6, 1.4, 4.6], [1.4, 2.2, 1.6], MAT.leaf, { allow: (x, y) => y < 4 });
  grid.fill(7, 5, 7, 9, 6, 8, MAT.leaf);
  grid.fill(7, 5, 6, 8, 6, 7, MAT.leaf);
  grid.set(8, 6, 7, MAT.moss);
  bloom(grid, { seed, count: 3, spacing: 2.2, proud: 0.6, lift: 0.4, colour: u => (u < 0.3 ? MAT.fabricRed : MAT.petal), allow: (x, y) => y < 8 });
  return { blueprint: blueprint('genesis-pinkkitty-river-cresset', 'prop', grid), fire: [...RIVER_CRESSET.fire] };
}
