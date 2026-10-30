import type { HomeTier } from '@chatdom/shared';
import { MAT } from '../../materials';
import { homeId, unfinished, type HearthHome } from './family';
import { KIT, Plan, base, chimney, doorway, gables, hollow, rearLimit, roof, studs, trough, walls, window, type Wing } from './grammar';

/**
 * Emberfold: a broad front gable to the street, a hooded entry on carved brackets, a stout stone chimney on the
 * west flank and, from cottage tier on, a lower side return tucked behind the east eave.
 */
const HALL: Wing = { x0: 10, x1: 50, z0: 70, z1: 124, wallTop: 26, ridge: 'z', eave: 4, verge: 3, tread: 2, rise: 3, thickness: 5 };
const RETURN: Wing = { x0: 40, x1: 61, z0: 60, z1: 86, wallTop: 22, ridge: 'x', eave: 3, verge: 3, tread: 2, rise: 3, thickness: 5, gables: [false, true] };
const DOOR_X = 37;

const front = { facing: 'south', plane: 124 } as const;
const west = { facing: 'west', plane: 10 } as const;
const east = { facing: 'east', plane: 50 } as const;

/** A small gabled hood over the door, carried on two stepped timber brackets. */
function hood(p: Plan): void {
  const a = DOOR_X - 9, b = DOOR_X + 9;
  for (let i = 0; i < 9; i++) {
    const top = 26 + i;
    for (const [u0, u1] of [[a + i, a + i + 1], [b - i - 1, b - i]] as const) {
      p.put(u0, top - 2, 121, u1, top, 127, KIT.roof);
      p.put(u0, top - 2, 127, u1, top + 1, 128, KIT.trim);
    }
  }
  p.put(DOOR_X - 1, 35, 121, DOOR_X + 1, 36, 128, KIT.roof);
  for (const x of [a + 1, b - 3]) {
    p.put(x, 15, 124, x + 2, 26, 125, KIT.trim);
    p.put(x, 20, 125, x + 2, 26, 126, KIT.trim);
    p.put(x, 23, 126, x + 2, 26, 127, KIT.trim);
  }
}

export function emberfold(tier: HomeTier): HearthHome {
  if (tier !== 'hut' && tier !== 'cottage') return unfinished('emberfold', tier);
  const p = new Plan(homeId('emberfold', tier), rearLimit(tier));
  const wings = tier === 'hut' ? [HALL] : [HALL, RETURN];
  for (const w of wings) base(p, w);
  for (const w of wings) walls(p, w);
  studs(p, east, 76, 122, 24, 12);
  studs(p, west, 74, 122, 24, 12);
  if (tier === 'cottage') studs(p, { facing: 'south', plane: RETURN.z1 }, 52, 58, 20, 12);
  for (const w of wings) hollow(p, w);
  for (const w of wings) gables(p, w);
  // Rear gable: a king post and collar make the carpentry legible on the garden side.
  p.put(29, 26, 69, 31, 56, 70, KIT.trim);
  p.put(20, 40, 69, 40, 42, 70, KIT.trim);
  for (const w of wings) roof(p, w);

  hood(p);
  const entrance = doorway(p, front, DOOR_X, 22, 'high');
  window(p, 'front-parlour', front, { u0: 17, u1: 25, y0: 8, y1: 22 }, { mullion: true });
  trough(p, front, 16, 26, 7, MAT.petal);
  // Front gable: king post either side of the loft light.
  p.put(29, 26, 124, 31, 37, 125, KIT.trim);
  p.put(29, 48, 124, 31, 55, 125, KIT.trim);
  window(p, 'gable-loft', front, { u0: 27, u1: 33, y0: 38, y1: 46 });
  window(p, 'west-hearth', west, { u0: 104, u1: 112, y0: 8, y1: 20 });
  window(p, 'east-parlour', east, { u0: 102, u1: 112, y0: 8, y1: 20 }, { mullion: true });
  chimney(p, 3, 10, 84, 98, 22, 62, 'west');

  if (tier === 'cottage') {
    const gable = { facing: 'east', plane: 61 } as const;
    window(p, 'return-east', gable, { u0: 68, u1: 78, y0: 8, y1: 20 }, { mullion: true });
    window(p, 'return-loft', gable, { u0: 70, u1: 76, y0: 28, y1: 34 });
    trough(p, gable, 67, 79, 7, MAT.blueFlower);
  }

  // A clipped box shrub anchors the garden corner beside the parlour window.
  p.put(2, 0, 115, 9, 1, 123, MAT.earth);
  p.put(3, 1, 116, 8, 4, 122, MAT.leaf);
  p.put(4, 4, 117, 7, 6, 121, MAT.leaf);
  // Each hood bracket carries its slope from the wall plate line down to the stone base.
  const supports = [[DOOR_X - 8, 124, 15, 27], [DOOR_X + 7, 124, 15, 27]] as const;
  return { blueprint: p.blueprint(), entrance, rooms: tier === 'hut' ? [[30, 2, 96]] : [[30, 2, 96], [50, 2, 72]], supports };
}

