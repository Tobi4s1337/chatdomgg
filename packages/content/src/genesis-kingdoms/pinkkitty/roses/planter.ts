import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../../../materials';
import { Grid, blob, bloom, blueprint, hash } from './shape';

export type RosePlanterLength = 24 | 32 | 48;
export const ROSE_PLANTER_LENGTHS: readonly RosePlanterLength[] = [24, 32, 48];

/**
 * The planter's frame in build cells: its length runs along X, the trough stands on z ∈ [1, 9) with a cell of room in
 * front and behind for the trails that hang over the coping, y = 0 is the ground.
 */
export const ROSE_PLANTER = { depth: 10, trough: { z: [1, 9] as const, height: 6 }, height: 12 } as const;

/**
 * A long limestone trough planter, 0.75 m to the top of its coping. A chamfered plinth, a body set back one cell
 * with recessed panels between pilasters on both long faces, and a dark stone coping that oversails it all round.
 * Earth sits one course below the coping. A row of roses fills it, each plant a little different, alternating rose
 * pink and violet by the seeded hash. Their foliage stops one cell short of both ends so planters stand end to end,
 * spreads over the coping and lets trails hang down the faces, olive where it overhangs.
 */
export function createRosePlanter(lengthCells: RosePlanterLength): VoxelBlueprint {
  if (!ROSE_PLANTER_LENGTHS.includes(lengthCells)) throw new Error(`Rose planters are 24, 32 or 48 cells long, not ${String(lengthCells)}.`);
  const L = lengthCells, D = ROSE_PLANTER.depth, grid = new Grid([L, ROSE_PLANTER.height, D]), seed = 0x91a7 + L * 6151;

  // The trough: plinth, body, panels, coping and earth.
  grid.softSquare(0, 1, L, 9, 0, 1, MAT.limestone);
  grid.fill(1, 1, 2, L - 1, 5, 8, MAT.limestone);
  const pilasters = [1, ...Array.from({ length: L / 8 - 1 }, (_, k) => 8 * (k + 1) - 1), L - 3];
  for (let k = 0; k + 1 < pilasters.length; k++) {
    const a = pilasters[k]! + 2, b = pilasters[k + 1]!;
    grid.fill(a, 2, 2, b, 4, 3, MAT.air);
    grid.fill(a, 2, 7, b, 4, 8, MAT.air);
  }
  grid.softSquare(0, 1, L, 9, 5, 6, MAT.darkStone);
  grid.fill(2, 4, 3, L - 2, 5, 7, MAT.earth);
  grid.fill(2, 5, 3, L - 2, 6, 7, MAT.air);

  // The roses: inside the coping at earth level, over the coping above it, never past the coping's inner ends.
  const allow = (x: number, y: number, z: number) => x >= 2 && x < L - 2 && y < ROSE_PLANTER.height - 1 && (y === 5 ? z >= 3 && z < 7 : y > 5 && z >= 1 && z < 9);
  // A continuous low bed of foliage first, so the row never shows holes between plants.
  blob(grid, [L / 2, 5.6, 5], [(L - 4) / 2, 2, 3.4], MAT.leaf, { allow, power: 4 });
  const plants = Math.round((L - 4) / 4.8), violet: boolean[] = [];
  for (let i = 0; i < plants; i++) {
    const x = 2 + ((L - 4) * (i + 0.5)) / plants + (hash(seed, i, 1) - 0.5) * 0.8;
    const tall = hash(seed, i, 2), r = 2.8 + hash(seed, i, 3) * 0.7;
    violet.push(i % 2 === 1 ? hash(seed, i, 4) < 0.8 : hash(seed, i, 4) < 0.15);
    blob(grid, [x, 6.2 + tall * 0.6, 5], [r, 3.1 + tall * 0.7, 3], MAT.leaf, { allow });
    blob(grid, [x + (hash(seed, i, 5) - 0.5) * 2.4, 6.4, 2.6], [1.9, 1.5, 1.8], MAT.leaf, { allow });
    blob(grid, [x + (hash(seed, i, 6) - 0.5) * 2.4, 6.6, 7.4], [1.8, 1.5, 1.7], MAT.leaf, { allow });
  }

  // Olive where the foliage hangs out over the coping with air beneath.
  for (let y = 6; y < ROSE_PLANTER.height; y++) for (let z = 0; z < D; z++) for (let x = 0; x < L; x++)
    if (grid.get(x, y, z) === MAT.leaf && grid.get(x, y - 1, z) === MAT.air) grid.set(x, y, z, MAT.moss);

  // Trails over the lip: across the coping's top edge, out one cell and straight down the face.
  const trails = Math.max(2, Math.round(L / 9));
  for (let i = 0; i < trails; i++) {
    const front = i % 3 !== 2, x = 3 + Math.floor(((i + 0.3 + hash(seed, i, 11) * 0.4) / trails) * (L - 6));
    const [lip, out] = front ? [1, 0] : [8, 9], low = 3 + Math.floor(hash(seed, i, 12) * 2);
    grid.fill(x, 6, Math.min(lip, out), x + 1, 7, Math.max(lip, out) + 1, MAT.leaf, true);
    grid.fill(x, low, out, x + 1, 6, out + 1, MAT.leaf, true);
    if (hash(seed, i, 13) < 0.6) grid.set(x + (hash(seed, i, 14) < 0.5 ? 1 : -1), low + 1, out, MAT.leaf);
  }

  const plantOf = (x: number) => Math.min(plants - 1, Math.max(0, Math.floor(((x - 2) / (L - 4)) * plants)));
  bloom(grid, {
    seed, count: Math.round(L * 0.75), spacing: 2.3, proud: 0.45, lift: 0.45, minY: 4,
    colour: (u, x) => violet[plantOf(x)] ? (u < 0.1 ? MAT.fabricRed : u < 0.6 ? MAT.fabricViolet : MAT.fabricMutedViolet) : (u < 0.15 ? MAT.fabricRed : MAT.petal),
    allow: (x, y) => x >= 2 && x < L - 2 && y < ROSE_PLANTER.height,
  });
  return blueprint(`genesis-pinkkitty-rose-planter-l${L}`, 'prop', grid);
}
