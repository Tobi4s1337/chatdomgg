import type { HomeTier } from '@chatdom/shared';
import { MAT } from '../../materials';
import {
  FLOOR, Plan, STONE, Shell, TRIM, WALL, chimney, doorway, east, extrude, floor, gableRoof, gableWall, south, west, windowIn,
  type Gable,
} from './grammar';
import { finished, type TideHome } from './family';

/**
 * Keelcroft: two narrow gables like upturned hulls face the street, tied at the back by a lower return. Between
 * them a flagged court leads under a compact gabled porch; thick walls hold the windows deep in their reveals.
 */
const WALL_T = 4;
const SKIRT = 6;
const WEST_WING: Gable = { ridge: 'z', lo: 1, hi: 27, baseLo: 24, baseHi: 24, along: [98, 128] };
const EAST_WING: Gable = { ridge: 'z', lo: 37, hi: 63, baseLo: 24, baseHi: 24, along: [98, 128] };
const RETURN: Gable = { ridge: 'x', lo: 76, hi: 104, baseLo: 15, baseHi: 15, along: [1, 63] };
const PORCH: Gable = { ridge: 'z', lo: 22, hi: 42, baseLo: 22, baseHi: 22, along: [99, 125], rise: 2 };
// The rear keel's ridge meets the return's at the same height and runs on to it: a true valley, no gable.
const REAR: Gable = { ridge: 'z', lo: 37, hi: 63, baseLo: 15, baseHi: 15, along: [49, 88] };

export function keelcroft(tier: HomeTier): TideHome {
  finished('keelcroft', tier, ['hut', 'cottage']);
  const shell = new Shell();
  const plan = new Plan().add(4, 80, 60, 104).add(4, 104, 24, 124).add(40, 104, 60, 124);
  const grown = tier !== 'hut';
  if (grown) plan.add(40, 52, 60, 80);

  floor(shell, plan, WALL_T);
  extrude(shell, plan.band(WALL_T), STONE, 0, SKIRT);
  extrude(shell, plan.ring(1), STONE, 0, 2);
  extrude(shell, plan.northRing(1), MAT.moss, 2, 3);
  extrude(shell, plan.band(WALL_T), WALL, SKIRT, 21);
  extrude(shell, plan.band(WALL_T), WALL, 21, 22, { x0: 0, z0: 80, x1: 64, z1: 128 });
  // The two wings stand taller than the return that ties them.
  extrude(shell, plan.band(WALL_T), WALL, 22, 28, { x0: 0, z0: 104, x1: 64, z1: 128 });
  gableWall(shell, WEST_WING, 28, 4, 24, 120, 124);
  gableWall(shell, EAST_WING, 28, 40, 60, 120, 124);
  gableWall(shell, RETURN, 22, 80, 104, 4, 8);
  gableWall(shell, RETURN, 22, 80, 104, 56, 60);

  if (grown) {
    // Cottage: a third, lower keel behind the return, reached through the back wall beside the hearth.
    gableWall(shell, REAR, 21, 40, 60, 52, 56);
    shell.air(44, FLOOR, 76, 56, FLOOR + 13, 84);
    gableRoof(shell, REAR, { cap: TRIM, barge: ['lo'] });
  }

  // The return's south eave dies into the wings: inside each wing it is cut back and the wing's own back gable
  // stands on the return roof, as the rear keel's gable does on the other side.
  gableRoof(shell, RETURN, { barge: ['lo', 'hi'] });
  shell.air(8, 15, 99, 20, 22, 104);
  shell.air(44, 15, 99, 56, 22, 104);
  for (const x of [4, 20, 40, 56]) shell.put(WALL, x, 15, 99, x + WALL_T, 18, 104);
  gableWall(shell, WEST_WING, 18, 4, 24, 101, 104);
  gableWall(shell, EAST_WING, 18, 40, 60, 101, 104);
  gableRoof(shell, WEST_WING, { cap: TRIM, barge: ['hi'] });
  gableRoof(shell, EAST_WING, { cap: TRIM, barge: ['hi'] });

  // Compact porch: the space between the keels is closed to the street by a low gabled front with an open arch,
  // roofed wing to wing, with a stone bench along each side and the house door at its back.
  shell.put(STONE, 24, 0, 104, 40, FLOOR, 124);
  shell.put(WALL, 24, 0, 121, 40, 25, 124);
  gableWall(shell, PORCH, 25, 24, 40, 121, 124);
  gableRoof(shell, PORCH, { cap: TRIM, barge: ['hi'] });
  for (const [x0, x1] of [[24, 27], [37, 40]] as const) {
    shell.put(STONE, x0, FLOOR, 108, x1, FLOOR + 4, 118);
    shell.put(TRIM, x0, FLOOR + 4, 108, x1, FLOOR + 5, 118);
  }

  // The hearth sits on the return's back wall; its stack rises between the two keels.
  shell.put(STONE, 26, FLOOR, 84, 38, 24, 87);
  shell.air(29, FLOOR, 84, 35, 10, 87);
  shell.put(TRIM, 25, 10, 85, 39, 12, 88);
  chimney(shell, { x: 28, z: 78, w: 8, d: 7, base: 0, top: 52, lean: [-1, 0] });

  doorway(shell, south(104), 26, WALL_T, STONE, false);
  const entrance = doorway(shell, south(124), 26, 3);
  windowIn(shell, south(124), { id: 'west-front', u: 9, y: 8, w: 10, h: 14, wall: WALL_T, recess: 2, mullion: true, transom: 17, sill: STONE, head: STONE });
  windowIn(shell, south(124), { id: 'east-front', u: 45, y: 8, w: 10, h: 14, wall: WALL_T, recess: 2, mullion: true, transom: 17, sill: STONE, head: STONE });
  windowIn(shell, east(24), { id: 'court', u: 106, y: 8, w: 8, h: 10, wall: WALL_T, recess: 2, sill: STONE, head: STONE });
  windowIn(shell, west(4), { id: 'west', u: 108, y: 8, w: 10, h: 12, wall: WALL_T, recess: 2, sill: STONE, head: STONE });
  windowIn(shell, east(60), { id: 'east', u: 108, y: 8, w: 10, h: 12, wall: WALL_T, recess: 2, sill: STONE, head: STONE });
  windowIn(shell, west(4), { id: 'return-west', u: 88, y: 6, w: 8, h: 10, wall: WALL_T, recess: 2, sill: STONE, head: STONE });
  windowIn(shell, east(60), { id: 'return-east', u: 88, y: 6, w: 8, h: 10, wall: WALL_T, recess: 2, sill: STONE, head: STONE });
  // Grown tiers add their own windows after the hut's, so every earlier anchor keeps its place and order.
  if (grown) {
    windowIn(shell, west(40), { id: 'rear-west', u: 66, y: 4, w: 8, h: 10, wall: WALL_T, recess: 2, sill: STONE, head: STONE });
    windowIn(shell, east(60), { id: 'rear-east', u: 62, y: 4, w: 8, h: 10, wall: WALL_T, recess: 2, sill: STONE, head: STONE });
  }

  // A pot of sea holly either side of the step.
  for (const x of [20, 40]) {
    shell.put(STONE, x, 0, 125, x + 4, 3, 128);
    shell.put(MAT.earth, x + 1, 2, 126, x + 3, 3, 127);
    shell.put(MAT.blueFlower, x, 3, 125, x + 4, 4, 128);
    shell.put(MAT.leaf, x + 1, 4, 126, x + 3, 5, 127);
  }
  return { blueprint: shell.blueprint(`home-tide-keelcroft-${tier}`), entrance };
}
