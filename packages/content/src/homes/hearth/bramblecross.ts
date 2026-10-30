import type { HomeTier } from '@chatdom/shared';
import { MAT } from '../../materials';
import { homeId, unfinished, type HearthHome } from './family';
import { BASE, FLOOR, KIT, Plan, base, chimney, doorway, gables, hollow, rearLimit, roof, studs, trough, walls, window, type Wing } from './grammar';

/**
 * Bramblecross: a broad, calm side-gabled range crossed off-centre by a steeper street gable that rides over its
 * ridge, a small porch inset into the west corner, and from cottage tier a lower wing reaching into the back garden.
 */
const RANGE: Wing = { x0: 6, x1: 60, z0: 92, z1: 124, wallTop: 28, ridge: 'x', eave: 4, verge: 3, tread: 2, rise: 2, thickness: 4 };
const CROSS: Wing = { x0: 26, x1: 52, z0: 92, z1: 124, wallTop: 28, ridge: 'z', eave: 3, verge: 3, tread: 2, rise: 3, thickness: 5 };
const GARDEN: Wing = { x0: 6, x1: 30, z0: 64, z1: 100, wallTop: 22, ridge: 'z', eave: 3, verge: 3, tread: 2, rise: 2, thickness: 4, gables: [true, false] };
const DOOR_X = 16;
/** The inset porch: open in front of a door wall set one metre behind the facade. */
const PORCH = { x0: 9, x1: 23, z0: 116, z1: 124, top: 26 } as const;

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

export function bramblecross(tier: HomeTier): HearthHome {
  if (tier !== 'hut' && tier !== 'cottage') return unfinished('bramblecross', tier);
  const p = new Plan(homeId('bramblecross', tier), rearLimit(tier));
  const extra = tier === 'cottage' ? [GARDEN] : [];
  const wings = [RANGE, CROSS, ...extra];
  for (const w of wings) base(p, w);
  for (const w of wings) walls(p, w);
  studs(p, { facing: 'north', plane: RANGE.z0 }, 32, 56, 26, 12);
  studs(p, westGable, 98, 120, 26, 11);
  studs(p, eastGable, 96, 120, 26, 12);
  if (tier === 'cottage') studs(p, { facing: 'west', plane: GARDEN.x0 }, 68, 96, 22, 14);
  for (const w of wings) hollow(p, w);
  porch(p);
  gables(p, RANGE);
  for (const w of extra) gables(p, w);
  // The hearth stack stands against the back wall and rises where the two ridges cross.
  chimney(p, 34, 44, 95, 103, 8, 60, 'none');
  roof(p, RANGE);
  // The cross gable stands straight up from the street: cut the range eave back where it crosses, then raise
  // the gable after the range roof so its faces stay whole where the two roofs meet.
  p.carve(CROSS.x0, 26, CROSS.z1, CROSS.x1, 60, 128);
  p.carve(CROSS.x0, 18, CROSS.z1 + 1, CROSS.x1, 26, 128);
  gables(p, CROSS);
  roof(p, CROSS);
  for (const w of extra) roof(p, w);
  p.put(38, 28, 91, 40, 46, 92, KIT.trim);

  const entrance = doorway(p, porchWall, DOOR_X, 22, 'low', false);
  window(p, 'cross-parlour', street, { u0: 34, u1: 44, y0: 8, y1: 22 }, { mullion: true });
  trough(p, street, 33, 45, 7, MAT.petal);
  window(p, 'cross-loft', street, { u0: 36, u1: 42, y0: 32, y1: 40 });
  window(p, 'west-hearth', westGable, { u0: 104, u1: 114, y0: 8, y1: 20 }, { mullion: true });
  window(p, 'west-loft', westGable, { u0: 104, u1: 112, y0: 30, y1: 38 });
  window(p, 'east-kitchen', eastGable, { u0: 98, u1: 110, y0: 8, y1: 20 }, { mullion: true });
  window(p, 'east-loft', eastGable, { u0: 104, u1: 112, y0: 30, y1: 38 });

  if (tier === 'cottage') {
    const side = { facing: 'west', plane: GARDEN.x0 } as const;
    window(p, 'garden-west', side, { u0: 76, u1: 88, y0: 8, y1: 18 }, { mullion: true });
    trough(p, side, 75, 89, 7, MAT.blueFlower);
    p.put(17, 22, 63, 19, 37, 64, KIT.trim);
    p.put(11, 28, 63, 25, 30, 64, KIT.trim);
  }
  // A potted bay tree and a moss-softened step stone at the open porch corner.
  p.put(3, 0, 118, 6, 4, 122, KIT.trim);
  p.put(2, 4, 117, 7, 9, 123, MAT.leaf);
  p.put(3, 9, 118, 6, 11, 122, MAT.leaf);
  p.put(10, 0, 127, 13, 1, 128, MAT.moss);
  p.put(19, 0, 125, 21, 1, 126, MAT.moss);
  // The porch bressummer bears on the corner post and on the facade return.
  const supports = [[RANGE.x0 + 1, 122, 0, 28], [PORCH.x1 + 1, 122, 0, 28]] as const;
  return { blueprint: p.blueprint(), entrance, rooms: tier === 'hut' ? [[48, 2, 108]] : [[48, 2, 108], [16, 2, 74]], supports };
}
