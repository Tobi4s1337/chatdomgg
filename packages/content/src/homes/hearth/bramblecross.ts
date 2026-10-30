import type { HomeTier } from '@chatdom/shared';
import { MAT } from '../../materials';
import { homeId, type HearthHome } from './family';
import { BASE, FLOOR, KIT, Plan, WALL, attic, base, chimney, doorway, gables, hollow, meet, passage, rearLimit, roof, studs, trough, walls, window, type Wing } from './grammar';

/**
 * Bramblecross: a broad, calm side-gabled range crossed off-centre by a steeper street gable that rides over its
 * ridge, a small porch inset into the west corner, and from cottage tier a lower wing reaching into the back garden.
 * The house crosses ridges once more at the back: a taller back range runs over the end of the garden wing, whose
 * ridge dies into its slope, and turns a full gable east to the garden.
 *
 * The manor crosses once more, the way the street front does: a steeper north wing rides over the back range's
 * ridge, ends in a small gable rising out of its far slope, and turns a tall gable to the rear meadow. A second
 * hearth stack stands where these two ridges cross, as the first does at the front. The hall adds a lower west
 * garden wing, staggered forward of the north gable, whose ridge runs into the back range like the first garden
 * wing's, and gives it the hut's own inset porch, now facing the meadow, with an open garden door.
 */
const RANGE: Wing = { x0: 6, x1: 60, z0: 92, z1: 124, wallTop: 28, ridge: 'x', eave: 4, verge: 3, tread: 2, rise: 2, thickness: 4 };
const CROSS: Wing = { x0: 26, x1: 52, z0: 92, z1: 124, wallTop: 28, ridge: 'z', eave: 3, verge: 3, tread: 2, rise: 3, thickness: 5 };
const GARDEN: Wing = { x0: 6, x1: 30, z0: 64, z1: 100, wallTop: 22, ridge: 'z', eave: 3, verge: 3, tread: 2, rise: 2, thickness: 4, gables: [true, false] };
/** In the house the garden wing loses its end gable and runs its ridge on into the back range's slope. */
const GARDEN_JOINED: Wing = { ...GARDEN, gables: [false, false], verges: [4, 3] };
const BACK: Wing = { x0: 6, x1: 46, z0: 36, z1: 68, wallTop: 30, ridge: 'x', eave: 3, verge: 3, tread: 2, rise: 2, thickness: 4 };
/** Ridge 53 rides three cells over the back range's ridge; its south gable stands on the far slope. */
const NORTH: Wing = { x0: 18, x1: 42, z0: 20, z1: 60, wallTop: 30, ridge: 'z', eave: 3, verge: 3, tread: 2, rise: 3, thickness: 5 };
const WEST: Wing = { x0: 2, x1: 22, z0: 4, z1: 40, wallTop: 28, ridge: 'z', eave: 2, verge: 3, verges: [3, 4], tread: 2, rise: 2, thickness: 4, gables: [true, false] };
const DOOR_X = 16;
const GARDEN_DOOR_X = 12;
/** The inset porch: open in front of a door wall set one metre behind the facade. */
const PORCH = { x0: 9, x1: 23, z0: 116, z1: 124, top: 26 } as const;
/** The garden porch mirrors it: open to the meadow in front of a door wall set one metre back from the gable. */
const GARDEN_PORCH = { x0: WEST.x0 + WALL, x1: WEST.x1 - WALL, z0: WEST.z0, z1: WEST.z0 + 8, top: 26 } as const;
const TIERS: readonly HomeTier[] = ['hut', 'cottage', 'house', 'manor', 'hall'];

const street = { facing: 'south', plane: 124 } as const;
const porchWall = { facing: 'south', plane: PORCH.z0 } as const;
const westGable = { facing: 'west', plane: RANGE.x0 } as const;
const eastGable = { facing: 'east', plane: RANGE.x1 } as const;

function porch(p: Plan): void {
  const { x0, x1, z0, z1, top } = PORCH;
  p.carve(x0, FLOOR, z0, x1, top, z1);
  // Door wall and the short return that closes the porch against the parlour.
  p.put(x0, FLOOR, z0 - 3, x1 + 3, BASE, z0, KIT.stone);
  p.put(x0, BASE, z0 - 3, x1 + 3, top, z0, KIT.wall);
  p.put(x1, FLOOR, z0, x1 + 3, BASE, z1 - 3, KIT.stone);
  p.put(x1, BASE, z0, x1 + 3, top, z1 - 3, KIT.wall);
  // Boarded porch ceiling on a bressummer that the corner post and the facade carry.
  p.put(x0, top, z0 - 3, x1 + 3, top + 2, z1, KIT.trim);
  p.put(x0 - 1, top - 2, z1 - 2, x1 + 1, top, z1 + 1, KIT.trim);
  // The porch floor runs out flush over the plinth lip to a single doorstep.
  p.carve(x0, FLOOR, z1, x1, BASE, z1 + 1);
  p.put(x0 + 1, 0, z1 + 1, x1 - 1, 1, z1 + 4, KIT.stone);
}

/** The meadow-side porch: the street porch turned round, its bressummer carried by the gable's corner posts. */
function gardenPorch(p: Plan): void {
  const { x0, x1, z0, z1, top } = GARDEN_PORCH;
  p.carve(x0, FLOOR, z0, x1, top, z1);
  p.put(x0, FLOOR, z1, x1, BASE, z1 + WALL, KIT.stone);
  p.put(x0, BASE, z1, x1, top, z1 + WALL, KIT.wall);
  p.put(x0, top, z0, x1, top + 2, z1 + WALL, KIT.trim);
  p.put(x0 - 1, top - 2, z0 - 1, x1 + 1, top, z0 + 2, KIT.trim);
  p.carve(x0, FLOOR, z0 - 1, x1, BASE, z0);
  p.put(x0 + 1, 0, z0 - 4, x1 - 1, 1, z0 - 1, KIT.stone);
}

export function bramblecross(tier: HomeTier): HearthHome {
  const level = TIERS.indexOf(tier);
  const p = new Plan(homeId('bramblecross', tier), rearLimit(tier));
  const garden = level >= 2 ? GARDEN_JOINED : GARDEN;
  const extra = [garden, BACK, NORTH, WEST].filter((_, i) => i < level);
  const wings = [RANGE, CROSS, ...extra];
  for (const w of wings) base(p, w);
  for (const w of wings) walls(p, w);
  studs(p, { facing: 'north', plane: RANGE.z0 }, 32, 56, 26, 12);
  studs(p, westGable, 98, 120, 26, 11);
  studs(p, eastGable, 96, 120, 26, 12);
  if (level >= 1) {
    studs(p, { facing: 'west', plane: GARDEN.x0 }, 68, 96, 22, 14);
    studs(p, { facing: 'east', plane: GARDEN.x1 }, 70, 92, 22, 11);
  }
  if (level >= 2) {
    studs(p, { facing: 'north', plane: BACK.z0 }, 10, 44, 28, 12);
    studs(p, { facing: 'south', plane: BACK.z1 }, 32, 44, 28, 12);
    studs(p, { facing: 'east', plane: BACK.x1 }, 39, 66, 28, 13);
    studs(p, { facing: 'west', plane: BACK.x0 }, 39, 58, 28, 11);
  }
  if (level >= 3) {
    studs(p, { facing: 'north', plane: NORTH.z0 }, NORTH.x0 + 3, NORTH.x1 - 3, 28, 6);
    studs(p, { facing: 'east', plane: NORTH.x1 }, NORTH.z0 + 3, BACK.z0, 28, 8);
    if (level === 3) studs(p, { facing: 'west', plane: NORTH.x0 }, NORTH.z0 + 3, BACK.z0, 28, 8);
  }
  if (level >= 4) {
    studs(p, { facing: 'west', plane: WEST.x0 }, WEST.z0 + 3, WEST.z1 - 4, 26, 11);
    studs(p, { facing: 'east', plane: WEST.x1 }, WEST.z0 + 3, NORTH.z0, 26, 8);
  }
  for (const w of wings) hollow(p, w);
  porch(p);
  if (level >= 4) gardenPorch(p);
  gables(p, RANGE);
  for (const w of extra.slice(0, 2)) gables(p, w);
  // The hearth stack stands against the back wall and rises where the two ridges cross.
  chimney(p, 34, 44, 95, 103, 8, 60, 'none');
  roof(p, RANGE);
  // The cross gable stands straight up from the street: cut the range eave back where it crosses, then raise
  // the gable after the range roof so its faces stay whole where the two roofs meet.
  p.carve(CROSS.x0, 26, CROSS.z1, CROSS.x1, 60, 128);
  p.carve(CROSS.x0, 18, CROSS.z1 + 1, CROSS.x1, 26, 128);
  gables(p, CROSS);
  roof(p, CROSS);
  if (level >= 1) roof(p, garden);
  if (level >= 2) {
    // The garden roof runs on under the back range: trim its eave where it would show past the west gable,
    // clear the back room it reaches into, then lay the back range roof over the junction.
    p.carve(0, 18, garden.z0 - 4, BACK.x0, BACK.wallTop - 2, BACK.z1);
    p.put(BACK.x0 - 1, 18, BACK.z1 - WALL, BACK.x0, BACK.wallTop - 2, BACK.z1, KIT.trim);
    p.carve(BACK.x0 + WALL, FLOOR, BACK.z0 + WALL, BACK.x1 - WALL, BACK.wallTop, BACK.z1 - WALL);
    roof(p, BACK);
  }
  if (level >= 3) {
    gables(p, NORTH);
    if (level >= 4) {
      gables(p, WEST);
      roof(p, WEST);
    }
    // Everything other roofs laid into the back range's loft and the north wing's open roof comes out again.
    attic(p, BACK);
    attic(p, NORTH);
    roof(p, NORTH);
    meet(p, BACK, NORTH);
    // The second hearth stack rises where the north wing crosses the back range, as the first does at the front.
    chimney(p, 26, 34, 48, 56, 8, 64, 'none');
  }
  p.put(38, 28, 91, 40, 46, 92, KIT.trim);

  const entrance = doorway(p, porchWall, DOOR_X, 22, 'low', false);
  window(p, 'cross-parlour', street, { u0: 34, u1: 44, y0: 8, y1: 22 }, { mullion: true });
  trough(p, street, 33, 45, 7, MAT.petal);
  window(p, 'cross-loft', street, { u0: 36, u1: 42, y0: 32, y1: 40 });
  window(p, 'west-hearth', westGable, { u0: 104, u1: 114, y0: 8, y1: 20 }, { mullion: true });
  window(p, 'west-loft', westGable, { u0: 104, u1: 112, y0: 30, y1: 38 });
  window(p, 'east-kitchen', eastGable, { u0: 98, u1: 110, y0: 8, y1: 20 }, { mullion: true });
  window(p, 'east-loft', eastGable, { u0: 104, u1: 112, y0: 30, y1: 38 });

  if (level >= 1) {
    const side = { facing: 'west', plane: GARDEN.x0 } as const;
    window(p, 'garden-west', side, { u0: 76, u1: 88, y0: 8, y1: 18 }, { mullion: true });
    trough(p, side, 75, 89, 7, MAT.blueFlower);
    // The wing's inner side looks across the garden it encloses.
    window(p, 'garden-east', { facing: 'east', plane: GARDEN.x1 }, { u0: 76, u1: 84, y0: 8, y1: 18 });
  }
  if (level === 1) {
    p.put(17, 22, 63, 19, 37, 64, KIT.trim);
    p.put(11, 28, 63, 25, 30, 64, KIT.trim);
  }
  if (level >= 2) {
    passage(p, 'z', 12, 24, BACK.z1 - WALL, GARDEN.z0 + WALL, FLOOR + 19);
    const garden = { facing: 'east', plane: BACK.x1 } as const;
    window(p, 'back-garden', garden, { u0: 46, u1: 58, y0: 8, y1: 20 }, { mullion: true });
    trough(p, garden, 45, 59, 7, MAT.petal);
    window(p, 'back-loft', garden, { u0: 48, u1: 56, y0: 32, y1: 40 });
    window(p, 'back-west', { facing: 'west', plane: BACK.x0 }, { u0: 46, u1: 58, y0: 8, y1: 20 }, { mullion: true });
  }
  if (level >= 3) {
    // The wing's hollow opens straight through the back range's north wall: one room under two crossing roofs.
    const meadow = { facing: 'north', plane: NORTH.z0 } as const;
    window(p, 'north-meadow', meadow, { u0: 25, u1: 35, y0: 8, y1: 22 }, { mullion: true });
    trough(p, meadow, 24, 36, 7, MAT.blueFlower);
    window(p, 'north-loft', meadow, { u0: 27, u1: 33, y0: 34, y1: 44 });
    window(p, 'north-east', { facing: 'east', plane: NORTH.x1 }, { u0: 24, u1: 32, y0: 8, y1: 20 });
  }
  const exits: HearthHome['exits'][number][] = [];
  if (level >= 4) {
    passage(p, 'z', 7, 15, WEST.z1 - WALL - 1, BACK.z0 + WALL, FLOOR + 19);
    exits.push({ at: doorway(p, { facing: 'north', plane: GARDEN_PORCH.z1 }, GARDEN_DOOR_X, 22, 'low', false), facing: 'north' });
    // Two cells off the lot line: a plain mullioned light, no trough to cross it.
    window(p, 'west-garden', { facing: 'west', plane: WEST.x0 }, { u0: 20, u1: 32, y0: 8, y1: 20 }, { mullion: true });
    // A king post stands on the porch bressummer up into the little gable.
    p.put(GARDEN_DOOR_X - 1, 28, WEST.z0 - 1, GARDEN_DOOR_X + 1, 37, WEST.z0, KIT.trim);
  }
  // A potted bay tree and a moss-softened step stone at the open porch corner.
  p.put(3, 0, 118, 6, 4, 122, KIT.trim);
  p.put(2, 4, 117, 7, 9, 123, MAT.leaf);
  p.put(3, 9, 118, 6, 11, 122, MAT.leaf);
  p.put(10, 0, 127, 13, 1, 128, MAT.moss);
  p.put(19, 0, 125, 21, 1, 126, MAT.moss);
  // The porch bressummer bears on the corner post and on the facade return.
  const supports: (readonly [number, number, number, number])[] = [[RANGE.x0 + 1, 122, 0, 28], [PORCH.x1 + 1, 122, 0, 28]];
  if (level >= 4) supports.push([WEST.x0 + 1, WEST.z0 + 1, 0, 28], [WEST.x1 - 2, WEST.z0 + 1, 0, 28]);
  const rooms: (readonly [number, number, number])[] = [[48, 2, 108]];
  if (level >= 1) rooms.push([16, 2, 74]);
  if (level >= 2) rooms.push([16, 2, 50]);
  if (level >= 3) rooms.push([30, 2, 30]);
  if (level >= 4) rooms.push([11, 2, 28]);
  return { blueprint: p.blueprint(), entrance, exits, rooms, supports };
}
