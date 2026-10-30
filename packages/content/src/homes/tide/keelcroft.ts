import type { HomeTier } from '@chatdom/shared';
import { MAT } from '../../materials';
import {
  FLOOR, Plan, Reflected, STONE, Shell, TRIM, WALL, chimney, doorway, east, extrude, floor, gableRoof, gableWall, north, south, valley, west,
  windowIn, type Gable,
} from './grammar';
import { finished, reached, type TideHome } from './family';

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
// House: a second rear keel, longer than the first, so the back pairs its keels around a court as the front does.
const AFT: Gable = { ridge: 'z', lo: 1, hi: 27, baseLo: 15, baseHi: 15, along: [41, 88] };
/**
 * Manor: a back return ties the rear keels as the first return ties the street keels, closing the court. A pend
 * runs under it from the court to the garden, each mouth an arch under a small hooded gable. At the hall the
 * return loses its north eave, because the street front, reflected, stands against it.
 */
// The back return keeps the street return's height; at the manor its north eave runs out over the garden.
const BACK_MANOR: Gable = { ridge: 'x', lo: 20, hi: 50, baseLo: 15, baseHi: 15, along: [1, 63] };
const BACK_HALL: Gable = { ...BACK_MANOR, lo: 24, hi: 52 };
const PEND = { x0: 24, z0: 24, x1: 40, z1: 48 } as const;
// The hoods share the street porch's gentler pitch, so their ridges stay below the return's.
const HOOD = { ridge: 'z', lo: 21, hi: 43, baseLo: 21, baseHi: 21, run: 3 } as const;

/**
 * The street front: two tall keels whose back gables stand on the return roof, and the compact porch between them.
 * Built once for the street, and once reflected as the hall's garden front.
 */
function pairedFront(shell: Shell): void {
  gableWall(shell, WEST_WING, 28, 4, 24, 120, 124);
  gableWall(shell, EAST_WING, 28, 40, 60, 120, 124);
  // The return's south eave dies into the wings: inside each wing it is cut back and the wing's own back gable
  // stands on the return roof, as the rear keel's gable does on the other side.
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
}

/** A pot of sea holly either side of the step. */
function pots(shell: Shell): void {
  for (const x of [20, 40]) {
    shell.put(STONE, x, 0, 125, x + 4, 3, 128);
    shell.put(MAT.earth, x + 1, 2, 126, x + 3, 3, 127);
    shell.put(MAT.blueFlower, x, 3, 125, x + 4, 4, 128);
    shell.put(MAT.leaf, x + 1, 4, 126, x + 3, 5, 127);
  }
}

/**
 * One mouth of the pend: an arched wall across the passage under a small gable that rides out over the eave.
 * The return's eave is cleared in front of the arch first, so the hood's courses alone shelter it.
 */
function pendMouth(shell: Shell, back: Gable, side: 'north' | 'south', hooded: boolean): void {
  const [wall0, wall1] = side === 'north' ? [PEND.z0, PEND.z0 + WALL_T] : [PEND.z1 - WALL_T, PEND.z1];
  const along = side === 'north' ? (y: number) => [16, valley(back, 'lo')(y)] as const : (y: number) => [valley(back, 'hi')(y), 56] as const;
  if (hooded && side === 'north') shell.air(PEND.x0, 0, 16, PEND.x1, 21, wall0);
  if (hooded && side === 'south') shell.air(PEND.x0, 0, wall1, PEND.x1, 21, 56);
  shell.put(WALL, PEND.x0, 0, wall0, PEND.x1, 22, wall1);
  const hood: Gable = { ...HOOD, along };
  if (hooded) gableWall(shell, hood, 22, PEND.x0, PEND.x1, wall0, wall1);
  doorway(shell, side === 'north' ? north(wall0) : south(wall1), PEND.x0 + 2, WALL_T, STONE, hooded);
  if (hooded) gableRoof(shell, hood, { cap: TRIM, barge: [side === 'north' ? 'lo' : 'hi'] });
}

export function keelcroft(tier: HomeTier): TideHome {
  finished('keelcroft', tier, ['hut', 'cottage', 'house', 'manor', 'hall']);
  const shell = new Shell(), garden = new Reflected(shell);
  const plan = new Plan().add(4, 80, 60, 104).add(4, 104, 24, 124).add(40, 104, 60, 124);
  const grown = reached(tier, 'cottage'), house = reached(tier, 'house'), manor = reached(tier, 'manor'), hall = reached(tier, 'hall');
  const back = hall ? BACK_HALL : BACK_MANOR;
  if (grown) plan.add(40, manor ? 44 : 52, 60, 80);
  if (house) plan.add(4, 44, 24, 80);
  if (manor) plan.add(4, PEND.z0, PEND.x0, PEND.z1).add(PEND.x1, PEND.z0, 60, PEND.z1);
  if (hall) plan.add(4, 4, 24, 24).add(40, 4, 60, 24);

  floor(shell, plan, WALL_T);
  extrude(shell, plan.band(WALL_T), STONE, 0, SKIRT);
  extrude(shell, plan.ring(1), STONE, 0, 2);
  extrude(shell, plan.northRing(1), MAT.moss, 2, 3);
  extrude(shell, plan.band(WALL_T), WALL, SKIRT, 21);
  extrude(shell, plan.band(WALL_T), WALL, 21, 22, { x0: 0, z0: 80, x1: 64, z1: 128 });
  // The back return's walls rise a cell like the street return's; the keels it ties stay at their own height.
  if (manor) extrude(shell, plan.band(WALL_T), WALL, 21, 22, { x0: 0, z0: 0, x1: 64, z1: PEND.z1 - WALL_T });
  // The two wings stand taller than the return that ties them.
  extrude(shell, plan.band(WALL_T), WALL, 22, 28, { x0: 0, z0: 104, x1: 64, z1: 128 });
  if (hall) extrude(shell, plan.band(WALL_T), WALL, 22, 28, { x0: 0, z0: 0, x1: 64, z1: 24 });
  gableWall(shell, RETURN, 22, 80, 104, 4, 8);
  gableWall(shell, RETURN, 22, 80, 104, 56, 60);
  if (manor) {
    gableWall(shell, back, 22, PEND.z0, PEND.z1, 4, 8);
    gableWall(shell, back, 22, PEND.z0, PEND.z1, 56, 60);
  }

  // Cottage: a third, lower keel behind the return, reached through the back wall beside the hearth.
  // Manor: both rear keels run on north until their courses meet the back return's in valleys.
  const meetBack = (keel: Gable): Gable => manor ? { ...keel, along: y => [valley(back, 'hi')(y), 88] } : keel;
  if (grown) {
    if (!manor) gableWall(shell, REAR, 21, 40, 60, 52, 56);
    gableRoof(shell, meetBack(REAR), { cap: TRIM, barge: manor ? [] : ['lo'] });
  }
  if (house) {
    if (!manor) gableWall(shell, AFT, 21, 4, 24, 44, 48);
    gableRoof(shell, meetBack(AFT), { cap: TRIM, barge: manor ? [] : ['lo'] });
  }

  gableRoof(shell, RETURN, { barge: ['lo', 'hi'] });
  if (manor) gableRoof(shell, back, { barge: ['lo', 'hi'] });
  // Where a rear keel opens off a return, the return's eave is cut back to the keel's own ceiling height,
  // so the way through has full headroom.
  if (grown) shell.air(44, FLOOR, 76, 56, 21, 84);
  if (house) shell.air(8, FLOOR, 76, 20, 21, 84);
  if (manor) {
    shell.air(8, FLOOR, PEND.z1 - 4, 20, 21, PEND.z1 + 4);
    shell.air(44, FLOOR, PEND.z1 - 4, 56, 21, PEND.z1 + 4);
  }

  pairedFront(shell);
  if (hall) pairedFront(garden);
  if (manor) {
    shell.put(STONE, PEND.x0, 0, PEND.z0, PEND.x1, FLOOR, PEND.z1);
    pendMouth(shell, back, 'south', true);
    // At the hall the reflected porch shelters the north mouth, which is the porch's inner door.
    pendMouth(shell, back, 'north', !hall);
    // A side door from the back return's west room into the pend: the house reaches its court and its garden.
    doorway(shell, east(PEND.x0), 30, WALL_T, STONE, false);
  }

  // The hearth sits on the return's back wall; its stack rises between the two keels.
  shell.put(STONE, 26, FLOOR, 84, 38, 24, 87);
  shell.air(29, FLOOR, 84, 35, 10, 87);
  shell.put(TRIM, 25, 10, 85, 39, 12, 88);
  chimney(shell, { x: 28, z: 78, w: 8, d: 7, base: 0, top: 52, lean: [-1, 0] });

  doorway(shell, south(104), 26, WALL_T, STONE, false);
  const entrance = doorway(shell, south(124), 26, 3);
  if (hall) doorway(garden, south(124), 26, 3);
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
  if (house) {
    windowIn(shell, east(24), { id: 'aft-court', u: 66, y: 4, w: 8, h: 10, wall: WALL_T, recess: 2, sill: STONE, head: STONE });
    windowIn(shell, west(4), { id: 'aft-west', u: 56, y: 4, w: 8, h: 10, wall: WALL_T, recess: 2, sill: STONE, head: STONE });
  }
  // The back return's north wall is where the hall's keels will stand, so its windows are in its gable ends.
  if (manor) {
    windowIn(shell, west(4), { id: 'back-west', u: 32, y: 6, w: 8, h: 10, wall: WALL_T, recess: 2, sill: STONE, head: STONE });
    windowIn(shell, east(60), { id: 'back-east', u: 32, y: 6, w: 8, h: 10, wall: WALL_T, recess: 2, sill: STONE, head: STONE });
  }
  if (hall) {
    windowIn(shell, north(4), { id: 'garden-west', u: 9, y: 8, w: 10, h: 14, wall: WALL_T, recess: 2, mullion: true, transom: 17, sill: STONE, head: STONE });
    windowIn(shell, north(4), { id: 'garden-east', u: 45, y: 8, w: 10, h: 14, wall: WALL_T, recess: 2, mullion: true, transom: 17, sill: STONE, head: STONE });
    windowIn(shell, east(24), { id: 'garden-porch', u: 14, y: 8, w: 8, h: 10, wall: WALL_T, recess: 2, sill: STONE, head: STONE });
    windowIn(shell, west(4), { id: 'hall-west', u: 10, y: 8, w: 10, h: 12, wall: WALL_T, recess: 2, sill: STONE, head: STONE });
    windowIn(shell, east(60), { id: 'hall-east', u: 10, y: 8, w: 10, h: 12, wall: WALL_T, recess: 2, sill: STONE, head: STONE });
  }

  pots(shell);
  if (hall) pots(garden);
  return { blueprint: shell.blueprint(`home-tide-keelcroft-${tier}`), entrance };
}
