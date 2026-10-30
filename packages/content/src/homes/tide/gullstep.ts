import type { HomeTier } from '@chatdom/shared';
import { MAT } from '../../materials';
import {
  FLOOR, Plan, STONE, Shell, TRIM, WALL, chimney, doorway, east, extrude, floor, gableRoof, gableWall, quoins, south, west, windowIn,
  type Gable,
} from './grammar';
import { finished, type TideHome } from './family';

/**
 * Gullstep: a tall, lopsided street gable. The west slope runs long and low like a sheltering wing; the east
 * side stands a storey taller under a deep slate eave; a stone stack climbs the back gable off the ridge line.
 */
const MAIN = { x0: 10, z0: 84, x1: 54, z1: 124 } as const;
const ROOF_MAIN: Gable = { ridge: 'z', lo: 6, hi: 58, baseLo: 16, baseHi: 28, along: [80, 128] };
const WING: Gable = { ridge: 'z', lo: 24, hi: 56, baseLo: 16, baseHi: 16, along: [56, 84] };
/**
 * House: a back range across the plot, the front gable's lopsided profile turned to face east. Its south eave
 * stands high where the wing meets it; the north slope runs long and low like the hut's west wing.
 */
const RANGE = { x0: 14, z0: 36, x1: 60, z1: 60 } as const;
const ROOF_RANGE: Gable = { ridge: 'x', lo: 33, hi: 64, baseLo: 16, baseHi: 28, along: [12, 62] };

export function gullstep(tier: HomeTier): TideHome {
  finished('gullstep', tier, ['hut', 'cottage', 'house']);
  const shell = new Shell(), plan = new Plan().add(MAIN.x0, MAIN.z0, MAIN.x1, MAIN.z1);
  const grown = tier !== 'hut', house = grown && tier !== 'cottage';
  if (grown) plan.add(28, 60, 52, 84);
  if (house) plan.add(RANGE.x0, RANGE.z0, RANGE.x1, RANGE.z1);

  // Ground: a stone plinth under every wall, a projecting base course and boards inside.
  floor(shell, plan, 3);
  extrude(shell, plan.band(3), STONE, 0, 4);
  extrude(shell, plan.ring(1), STONE, 0, 2);
  extrude(shell, plan.ring(1), STONE, 2, 3);
  extrude(shell, plan.northRing(1), MAT.moss, 2, 3);
  extrude(shell, plan.band(3), WALL, 4, 19);
  // The tall east side carries a half storey under its eave.
  shell.put(WALL, 51, 19, MAIN.z0, 54, 34, MAIN.z1);
  gableWall(shell, ROOF_MAIN, 19, MAIN.x0, MAIN.x1, MAIN.z1 - 3, MAIN.z1);
  gableWall(shell, ROOF_MAIN, 19, MAIN.x0, MAIN.x1, MAIN.z0, MAIN.z0 + 3);
  for (const [x, z, dx, dz, top] of [[10, 124, 1, -1, 19], [54, 124, -1, -1, 31], [10, 84, 1, 1, 19], [54, 84, -1, 1, 31]] as const) quoins(shell, x, z, dx, dz, 4, top);

  if (grown) {
    // Cottage: a lower rear wing telescopes back from the old gable, reached through a new inner doorway.
    shell.put(WALL, 28, FLOOR, 84, 52, 19, 87);
    shell.air(34, FLOOR, 84, 46, FLOOR + 21, 87);
    shell.air(35, FLOOR + 21, 84, 45, FLOOR + 22, 87);
    if (!house) {
      gableWall(shell, WING, 19, 28, 52, 60, 63);
      quoins(shell, 28, 60, 1, 1, 4, 19);
      quoins(shell, 52, 60, -1, 1, 4, 19);
    }
    gableRoof(shell, house ? { ...WING, along: [60, 84] } : WING, { cap: TRIM, barge: house ? [] : ['lo'] });
  }

  if (house) {
    // The range's tall south wall closes the wing's end; the wing roof runs on into the range's south slope.
    shell.put(WALL, RANGE.x0, 19, RANGE.z1 - 3, RANGE.x1, 31, RANGE.z1);
    shell.put(WALL, 28, FLOOR, RANGE.z1 - 3, 52, 19, RANGE.z1);
    shell.air(34, FLOOR, RANGE.z1 - 3, 46, FLOOR + 21, RANGE.z1);
    shell.air(35, FLOOR + 21, RANGE.z1 - 3, 45, FLOOR + 22, RANGE.z1);
    gableWall(shell, ROOF_RANGE, 19, RANGE.z0, RANGE.z1, RANGE.x0, RANGE.x0 + 3);
    gableWall(shell, ROOF_RANGE, 19, RANGE.z0, RANGE.z1, RANGE.x1 - 3, RANGE.x1);
    for (const [x, z, dx, dz, top] of [[14, 60, 1, -1, 31], [60, 60, -1, -1, 31], [14, 36, 1, 1, 19], [60, 36, -1, 1, 19]] as const) quoins(shell, x, z, dx, dz, 4, top);
    // A bressumer under the east gable room, as on the street gable.
    shell.put(TRIM, RANGE.x1 - 1, 22, 37, RANGE.x1 + 1, 24, RANGE.z1);
    gableRoof(shell, ROOF_RANGE, { cap: TRIM, barge: ['lo', 'hi'] });
  }

  // A timber bressumer marks the floor of the gable room across the street face.
  shell.put(TRIM, MAIN.x0, 27, 123, MAIN.x1, 29, 125);
  gableRoof(shell, ROOF_MAIN, { cap: TRIM, barge: ['hi', 'lo'] });

  // Inside the back gable: a stone hearth breast with a timber mantel, seen straight through the front door.
  shell.put(STONE, 17, FLOOR, 87, 27, 26, 90);
  shell.air(19, FLOOR, 87, 25, 10, 90);
  shell.put(TRIM, 16, 10, 88, 28, 12, 91);
  chimney(shell, { x: 18, z: 81, w: 8, d: 6, base: 0, top: 68, lean: [1, 0] });

  const entrance = doorway(shell, south(124), 15, 3);
  windowIn(shell, south(124), { id: 'front', u: 34, y: 7, w: 12, h: 14, wall: 3, recess: 1, mullion: true, transom: 16, head: TRIM });
  // A planted window box is the front window's sill: thrift and sea holly over a timber trough.
  shell.put(TRIM, 32, 2, 124, 48, 6, 127);
  shell.put(MAT.earth, 33, 5, 125, 47, 6, 127);
  for (const [x0, x1, m] of [[33, 36, MAT.leaf], [36, 39, MAT.blueFlower], [39, 41, MAT.leaf], [41, 44, MAT.blueFlower], [44, 47, MAT.leaf]] as const) shell.put(m, x0, 6, 125, x1, 7, 127);
  windowIn(shell, south(124), { id: 'gable', u: 33, y: 36, w: 6, h: 8, wall: 3, recess: 1, sill: STONE, head: TRIM });
  windowIn(shell, east(54), { id: 'east', u: 98, y: 9, w: 10, h: 12, wall: 3, recess: 1, sill: STONE, head: TRIM });
  // Grown tiers add their own windows after the hut's, so every earlier anchor keeps its place and order.
  if (grown) {
    windowIn(shell, east(52), { id: 'wing-east', u: 66, y: 5, w: 10, h: 10, wall: 3, recess: 1, sill: STONE, head: TRIM });
    windowIn(shell, west(28), { id: 'wing-west', u: 68, y: 5, w: 8, h: 10, wall: 3, recess: 1, sill: STONE, head: TRIM });
  }
  if (house) {
    windowIn(shell, south(RANGE.z1), { id: 'range-south', u: 20, y: 5, w: 6, h: 10, wall: 3, recess: 1, sill: STONE, head: TRIM });
    windowIn(shell, east(RANGE.x1), { id: 'range-east', u: 42, y: 7, w: 10, h: 12, wall: 3, recess: 1, mullion: true, sill: STONE, head: TRIM });
    windowIn(shell, east(RANGE.x1), { id: 'range-gable', u: 49, y: 26, w: 6, h: 6, wall: 3, recess: 1, sill: STONE });
    windowIn(shell, west(RANGE.x0), { id: 'range-west', u: 42, y: 7, w: 8, h: 12, wall: 3, recess: 1, sill: STONE, head: TRIM });
  }

  // A rounded tamarisk under the low west eave softens the long slope's foot.
  shell.put(MAT.leaf, 3, 0, 98, 9, 4, 110);
  shell.put(MAT.leaf, 2, 1, 100, 9, 6, 108);
  shell.put(MAT.leaf, 4, 6, 101, 8, 8, 107);
  return { blueprint: shell.blueprint(`home-tide-gullstep-${tier}`), entrance };
}
