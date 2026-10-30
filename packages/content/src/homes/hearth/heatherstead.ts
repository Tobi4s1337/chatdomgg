import type { HomeTier } from '@chatdom/shared';
import { MAT } from '../../materials';
import { homeId, unfinished, type HearthHome } from './family';
import { BASE, FLOOR, KIT, Plan, WALL, base, chimney, doorway, gables, hollow, passage, rearLimit, roof, studs, trough, walls, window, type Face, type Wing } from './grammar';

/**
 * Heatherstead: one long, quiet ridge across the lot, a lower lean-to porch tucked under the eaves, wall dormers
 * that set a measured rhythm above the openings, and from cottage tier a catslide outshut down the back. The house
 * builds a second, narrower and lower range behind the outshut: the catslide falls into a valley against its slope,
 * so the side reads as one long ridge, a long sweep and a quieter ridge behind. It stands to the east, keeping a
 * broad garden behind the catslide, and a timber bay turns its east gable to the light.
 */
const RANGE: Wing = { x0: 4, x1: 60, z0: 84, z1: 116, wallTop: 34, ridge: 'x', eave: 4, verge: 3, tread: 2, rise: 2, thickness: 4 };
const DOOR_X = 16;
const DORMERS = [16, 50] as const;
const PORCH = { x0: 6, x1: 40, z0: 116, z1: 126, posts: [6, 22, 37] } as const;
const BACK: Wing = { x0: 24, x1: 56, z0: 44, z1: 68, wallTop: 26, ridge: 'x', eave: 4, verge: 3, tread: 2, rise: 2, thickness: 4 };
/** The bay projects six cells from the back range's east gable: a full timber-framed light under a lean-to. */
const BAY = { x0: BACK.x1, x1: BACK.x1 + 6, z0: 46, z1: 60, top: 21 } as const;

const street = { facing: 'south', plane: RANGE.z1 } as const satisfies Face;
const westGable = { facing: 'west', plane: RANGE.x0 } as const satisfies Face;
const eastGable = { facing: 'east', plane: RANGE.x1 } as const satisfies Face;

function dormerWing(c: number): Wing {
  return { x0: c - 6, x1: c + 6, z0: 101, z1: RANGE.z1, wallTop: 44, ridge: 'z', eave: 1, verge: 1, tread: 1, rise: 1, thickness: 2, gables: [false, true], cap: false };
}

/** A wall dormer rises straight from the facade, breaking the eave, with its own small gabled roof. */
function dormer(p: Plan, c: number): void {
  const w = dormerWing(c);
  p.carve(w.x0, RANGE.wallTop - 4, RANGE.z1, w.x1, w.wallTop + 4, RANGE.z1 + 4);
  p.put(w.x0, RANGE.wallTop - 2, w.z1 - WALL, w.x1, w.wallTop, w.z1, KIT.wall);
  p.put(w.x0, RANGE.wallTop - 2, w.z0, w.x0 + 2, w.wallTop, w.z1, KIT.wall);
  p.put(w.x1 - 2, RANGE.wallTop - 2, w.z0, w.x1, w.wallTop, w.z1, KIT.wall);
  p.carve(w.x0 + 2, RANGE.wallTop, w.z0, w.x1 - 2, w.wallTop, w.z1 - WALL);
  p.put(w.x0 - 1, w.wallTop - 2, w.z1 - 1, w.x1 + 1, w.wallTop, w.z1 + 1, KIT.trim);
  gables(p, w);
  roof(p, w);
}

/** A lean-to porch roof two steps below the main eave, on three posts over a flush limestone floor. */
function porch(p: Plan): void {
  const { x0, x1, z0, z1, posts } = PORCH;
  p.put(x0, 0, z0, x1, FLOOR, z1, KIT.stone);
  for (let j = 0; j < 5; j++) p.put(x0, 26 - j, z0 + 2 * j, x1, 28 - j, z0 + 2 * j + 2, KIT.roof);
  p.put(x0 - 1, 22, z1, x1 + 1, 25, z1 + 1, KIT.trim);
  for (const x of [x0 - 1, x1]) for (let j = 0; j < 5; j++) p.put(x, 25 - j, z0 + 2 * j, x + 1, 29 - j, z0 + 2 * j + 2, KIT.trim);
  for (const x of posts) {
    p.put(x - 1, FLOOR, 121, x + 4, FLOOR + 1, 126, KIT.stone);
    p.put(x, FLOOR + 1, 122, x + 3, 24, 125, KIT.trim);
  }
  p.put(DOOR_X - 8, 0, z1, DOOR_X + 8, 1, z1 + 2, KIT.stone);
}

/** The catslide outshut continues the rear slope at a gentler pitch over a scullery and store. */
function outshut(p: Plan): void {
  const z0 = 66, x0 = RANGE.x0, x1 = RANGE.x1, low = 24;
  p.put(x0 - 1, 0, z0 - 1, x1 + 1, BASE, RANGE.z0, KIT.stone);
  p.put(x0, BASE, z0, x1, low, z0 + WALL, KIT.wall);
  studs(p, { facing: 'north', plane: z0 }, x0 + 6, x1 - 4, low - 2, 12);
  for (let k = 0; k < 9; k++) {
    const za = RANGE.z0 - 2 - 2 * k, top = RANGE.wallTop - 1 - k;
    for (const x of [x0, x1 - WALL]) p.put(x, BASE, Math.max(z0, za), x + WALL, top - 3, za + 2, KIT.wall);
  }
  p.carve(x0 + WALL, FLOOR, z0 + WALL, x1 - WALL, RANGE.wallTop - 2, RANGE.z0);
  p.put(x0 + WALL, FLOOR - 1, z0 + WALL, x1 - WALL, FLOOR, RANGE.z0, KIT.trim);
  // A wide opening through the old back wall joins the outshut to the hall.
  p.carve(24, FLOOR, RANGE.z0, 40, 26, RANGE.z0 + WALL);
  p.put(23, FLOOR, RANGE.z0 - 1, 24, 27, RANGE.z0 + WALL + 1, KIT.trim);
  p.put(40, FLOOR, RANGE.z0 - 1, 41, 27, RANGE.z0 + WALL + 1, KIT.trim);
  p.put(22, 26, RANGE.z0 - 1, 42, 28, RANGE.z0 + WALL + 1, KIT.trim);
  for (let k = 0; k < 11; k++) {
    const za = RANGE.z0 - 2 - 2 * k, top = RANGE.wallTop - 1 - k;
    p.put(x0 - 3, top - 3, za, x0 - 1, top + 1, za + 2, KIT.trim);
    p.put(x0 - 1, top - 3, za, x1 + 1, top, za + 2, KIT.roof);
    p.put(x1 + 1, top - 3, za, x1 + 3, top + 1, za + 2, KIT.trim);
  }
  p.put(x0 - 1, low - 2, z0 - 1, x1 + 1, low, z0 + 1, KIT.trim);
}

function bay(p: Plan): void {
  const { x0, x1, z0, z1, top } = BAY;
  p.put(x0 - 1, 0, z0 - 1, x1 + 1, BASE, z1 + 1, KIT.stone);
  p.put(x0, BASE, z0, x1, top, z1, KIT.wall);
  for (const z of [z0, z1 - 2]) p.put(x1 - 1, BASE, z, x1 + 1, top, z + 2, KIT.trim);
  // Open through the gable wall: the bay is part of the room, floored with the same boards.
  p.carve(x0 - WALL, FLOOR, z0 + 2, x1 - 2, top - 1, z1 - 2);
  p.put(x0 - WALL, FLOOR - 1, z0 + 2, x1 - 2, FLOOR, z1 - 2, KIT.trim);
  // Lean-to roof in four courses stepping out from under the gable's wall plate.
  for (let j = 0; j < 4; j++) p.put(x0 + 2 * j, top + 3 - j, z0 - 1, x0 + 2 * j + 2, top + 6 - j, z1 + 1, KIT.roof);
  p.put(x1 + 1, top, z0 - 1, x1 + 2, top + 3, z1 + 1, KIT.trim);
}

export function heatherstead(tier: HomeTier): HearthHome {
  if (tier !== 'hut' && tier !== 'cottage' && tier !== 'house') return unfinished('heatherstead', tier);
  const p = new Plan(homeId('heatherstead', tier), rearLimit(tier));
  base(p, RANGE);
  walls(p, RANGE);
  studs(p, { facing: 'north', plane: RANGE.z0 }, 10, 56, 32, 12);
  studs(p, westGable, 90, 112, 32, 11);
  studs(p, eastGable, 90, 112, 32, 11);
  hollow(p, RANGE);
  gables(p, RANGE);
  if (tier !== 'hut') outshut(p);
  if (tier === 'house') {
    // The back range is raised after the outshut so its walls take over the catslide's foot.
    base(p, BACK);
    walls(p, BACK);
    studs(p, { facing: 'north', plane: BACK.z0 }, 30, 52, 24, 11);
    studs(p, { facing: 'west', plane: BACK.x0 }, 47, 66, 24, 9);
    studs(p, { facing: 'east', plane: BACK.x1 }, 47, 66, 24, 9);
    hollow(p, BACK);
    gables(p, BACK);
  }
  roof(p, RANGE);
  if (tier === 'house') {
    roof(p, BACK);
    bay(p);
  }
  porch(p);
  for (const c of DORMERS) dormer(p, c);

  const entrance = doorway(p, street, DOOR_X, 22, 'high', false);
  window(p, 'porch-hall', street, { u0: 28, u1: 34, y0: 8, y1: 20 });
  window(p, 'front-east', street, { u0: 46, u1: 54, y0: 8, y1: 20 }, { mullion: true });
  trough(p, street, 45, 55, 7, MAT.petal);
  window(p, 'dormer-door', street, { u0: 13, u1: 19, y0: 34, y1: 42 });
  window(p, 'dormer-east', street, { u0: 47, u1: 53, y0: 34, y1: 42 });
  window(p, 'east-hearth', eastGable, { u0: 94, u1: 104, y0: 8, y1: 20 }, { mullion: true });
  window(p, 'east-loft', eastGable, { u0: 96, u1: 104, y0: 34, y1: 42 });
  window(p, 'west-settle', westGable, { u0: 104, u1: 112, y0: 8, y1: 20 });
  chimney(p, 5, 13, 90, 102, 8, 60, 'none');

  if (tier !== 'hut') {
    window(p, 'outshut-east', { facing: 'east', plane: RANGE.x1 }, { u0: 70, u1: 78, y0: 8, y1: 18 });
    window(p, 'outshut-west', westGable, { u0: 70, u1: 78, y0: 8, y1: 18 });
  }
  if (tier === 'house') {
    passage(p, 'z', 32, 44, BACK.z1 - WALL, 69, FLOOR + 19);
    window(p, 'back-west', { facing: 'west', plane: BACK.x0 }, { u0: 58, u1: 64, y0: 8, y1: 20 });
    window(p, 'back-bay', { facing: 'east', plane: BAY.x1 }, { u0: BAY.z0 + 2, u1: BAY.z1 - 2, y0: 6, y1: 18 }, { mullion: true });
    window(p, 'back-loft', { facing: 'east', plane: BACK.x1 }, { u0: 53, u1: 59, y0: 28, y1: 32 });
    chimney(p, 25, 33, 45, 55, 8, 50, 'none');
  }
  // Heather at the porch end and a low kerb of moss along the path edge.
  p.put(42, 0, 119, 56, 1, 125, MAT.earth);
  // Low heather cushions: green mounds tipped with bloom, never a solid block of colour.
  for (const [x, z, h] of [[43, 120, 2], [47, 122, 1], [50, 119, 2], [53, 121, 1]] as const) {
    p.put(x, 1, z, x + 3, 1 + h, z + 3, MAT.leaf);
    p.put(x + 1, 1 + h, z, x + 2, 2 + h, z + 3, MAT.blueFlower);
  }
  const supports = PORCH.posts.map(x => [x + 1, 123, 0, 24] as const);
  const rooms: (readonly [number, number, number])[] = [[32, 2, 100]];
  if (tier !== 'hut') rooms.push([32, 2, 74]);
  if (tier === 'house') rooms.push([40, 2, 54], [56, 2, 53]);
  return { blueprint: p.blueprint(), entrance, rooms, supports };
}
