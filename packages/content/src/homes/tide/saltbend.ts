import type { HomeTier } from '@chatdom/shared';
import { MAT } from '../../materials';
import {
  FLOOR, Plan, STONE, Shell, TRIM, WALL, chimney, doorway, east, extrude, floor, gableRoof, gableWall, hipRoof, south, west, windowIn,
  type Gable,
} from './grammar';
import { finished, type TideHome } from './family';

/**
 * Saltbend: a broad, low hipped house that turns its shoulder to the wind. Its front-east corner is cut away into
 * a sheltered porch under the roof, marked by a small boarded entry gable on a timber post; a tall stone skirt
 * keeps the spray off the cream walls.
 */
const SKIRT = 12;
const EAVE = 28;
// The entry gable shares the hip's pitch, so its ridge dies cleanly into the main slope behind the porch.
const ENTRY: Gable = { ridge: 'z', lo: 40, hi: 60, baseLo: 26, baseHi: 26, along: [104, 128], rise: 2, run: 2, thick: 4 };

export function saltbend(tier: HomeTier): TideHome {
  finished('saltbend', tier, ['hut', 'cottage']);
  const shell = new Shell();
  const plan = new Plan().add(6, 88, 58, 124).cut(40, 110, 58, 124);
  const grown = tier !== 'hut';
  if (grown) plan.add(10, 64, 54, 88);

  floor(shell, plan, 3);
  extrude(shell, plan.band(3), STONE, 0, SKIRT);
  extrude(shell, plan.ring(1), STONE, 0, 2);
  // The drip course caps the skirt of the house proper; the outshut's plain stone wall runs up to its eave.
  extrude(shell, plan.ring(1), STONE, SKIRT - 2, SKIRT, { x0: 0, z0: 87, x1: 64, z1: 128 });
  extrude(shell, plan.northRing(1), MAT.moss, 2, 3);
  extrude(shell, plan.band(3), WALL, SKIRT, EAVE, { x0: 0, z0: 88, x1: 64, z1: 128 });

  if (grown) {
    // Cottage: a lean-to outshut along the back under its own hipped ends; the old back wall becomes a partition.
    extrude(shell, plan.band(3), WALL, SKIRT, 18, { x0: 0, z0: 0, x1: 64, z1: 88 });
    shell.put(WALL, 10, FLOOR, 88, 54, EAVE, 91);
    shell.air(38, FLOOR, 88, 50, FLOOR + 21, 91);
    hipRoof(shell, { x0: 6, z0: 60, x1: 58, z1: 88, base: 14, open: 'south', courses: 6 });
  }

  // The sheltered corner: flagged floor, a stout post on its pad, beams carrying a boarded soffit.
  shell.put(STONE, 40, 0, 110, 58, FLOOR, 124);
  shell.put(STONE, 53, 0, 119, 58, 8, 124);
  shell.put(TRIM, 54, 8, 120, 58, EAVE, 124);
  shell.put(TRIM, 37, 24, 120, 58, EAVE, 124);
  shell.put(TRIM, 54, 24, 107, 58, EAVE, 120);
  shell.put(TRIM, 40, EAVE - 1, 110, 54, EAVE, 120);
  shell.put(TRIM, 51, 22, 120, 54, 24, 124);
  shell.put(TRIM, 54, 22, 117, 58, 24, 120);
  gableWall(shell, ENTRY, EAVE, 40, 58, 121, 124, TRIM);

  hipRoof(shell, { x0: 2, z0: 84, x1: 62, z1: 128, base: 24 }, TRIM);
  gableRoof(shell, ENTRY, { cap: TRIM, barge: ['hi'] });

  // A broad stack rises from the hearth on the back wall through the rear slope.
  shell.put(STONE, 23, FLOOR, 91, 33, 24, 94);
  shell.air(25, FLOOR, 91, 31, 10, 94);
  shell.put(TRIM, 22, 10, 92, 34, 12, 95);
  chimney(shell, { x: 24, z: 86, w: 8, d: 6, base: 0, top: 54, lean: [0, 1] });

  const entrance = doorway(shell, south(110), 42, 3, STONE, false);
  // One broad worn step up onto the porch flags.
  shell.put(STONE, 41, 0, 124, 57, 1, 126);
  shell.put(STONE, 43, 0, 126, 55, 1, 127);
  windowIn(shell, south(124), { id: 'front-west', u: 11, y: 13, w: 10, h: 10, wall: 3, recess: 1, mullion: true, sill: STONE });
  windowIn(shell, south(124), { id: 'front-east', u: 26, y: 13, w: 10, h: 10, wall: 3, recess: 1, mullion: true, sill: STONE });
  windowIn(shell, east(40), { id: 'porch', u: 113, y: 13, w: 6, h: 10, wall: 3, recess: 1, sill: STONE });
  windowIn(shell, west(6), { id: 'west', u: 100, y: 13, w: 10, h: 10, wall: 3, recess: 1, mullion: true, sill: STONE });
  windowIn(shell, east(58), { id: 'east', u: 94, y: 13, w: 10, h: 10, wall: 3, recess: 1, mullion: true, sill: STONE });
  // Grown tiers add their own windows after the hut's, so every earlier anchor keeps its place and order.
  if (grown) {
    windowIn(shell, west(10), { id: 'outshut-west', u: 70, y: 4, w: 8, h: 8, wall: 3, recess: 1, sill: STONE });
    windowIn(shell, east(54), { id: 'outshut-east', u: 74, y: 4, w: 8, h: 8, wall: 3, recess: 1, sill: STONE });
  }

  // Sea holly in a stone-edged bed along the skirt, and a cushion of thrift by the step.
  shell.put(STONE, 8, 0, 125, 38, 2, 128);
  shell.put(MAT.earth, 9, 1, 125, 37, 2, 127);
  for (const [x0, x1, m] of [[9, 13, MAT.blueFlower], [13, 16, MAT.leaf], [16, 21, MAT.blueFlower], [24, 27, MAT.leaf], [27, 33, MAT.blueFlower], [33, 37, MAT.leaf]] as const) shell.put(m, x0, 2, 125, x1, 3, 127);
  return { blueprint: shell.blueprint(`home-tide-saltbend-${tier}`), entrance };
}
