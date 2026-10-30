import type { HomeTier } from '@chatdom/shared';
import { MAT } from '../../materials';
import { homeId, type HearthHome } from './family';
import { BASE, FLOOR, KIT, Plan, base, chimney, doorway, gables, hollow, hollowJetty, hood, jetty, passage, rearLimit, ridgeTop, roof, studs, trough, walls, window, type Wing } from './grammar';

/**
 * Emberfold: a broad front gable to the street, a hooded entry on carved brackets, a stout stone chimney on the
 * west flank and, from cottage tier on, a lower side return tucked behind the east eave. The house adds a
 * lower kitchen behind the hall on the same axis, its roof running in under the hall's verge, with a second
 * stout stack on its west flank: the same hand building the same way.
 *
 * The manor raises a great hall at the end of that axis: the family's tallest gable, its upper storey jettied
 * out over the garden on a bressummer and close-studded, with a third west stack, the tallest of the three.
 * Seen from the street, a second gable now rises behind the first. The hall tier sets a lower chamber wing
 * beside it, so two gables face the garden, opens a hooded garden door in the chamber's gable that repeats the
 * hut's own street front, and crowns the great hall's ridge with a louvred lantern.
 */
const HALL: Wing = { x0: 10, x1: 50, z0: 70, z1: 124, wallTop: 26, ridge: 'z', eave: 4, verge: 3, tread: 2, rise: 3, thickness: 5 };
const RETURN: Wing = { x0: 40, x1: 61, z0: 60, z1: 86, wallTop: 22, ridge: 'x', eave: 3, verge: 3, tread: 2, rise: 3, thickness: 5 };
/** Ridge 38 stays under the hall's rear verge across the whole span, so the kitchen meets the hall gable cleanly. */
const KITCHEN: Wing = { x0: 14, x1: 40, z0: 42, z1: 72, wallTop: 22, ridge: 'z', eave: 3, verge: 3, verges: [3, 0], tread: 2, rise: 2, thickness: 4, gables: [true, false] };
/** From manor tier the kitchen roof stops against the great hall's south wall instead of oversailing into it. */
const KITCHEN_JOINED: Wing = { ...KITCHEN, verges: [-2, 0], barges: [false, false] };
/** The great hall's ground storey; its wall plate is the jetty line. */
const GREAT_GROUND: Wing = { x0: 12, x1: 42, z0: 22, z1: 44, wallTop: 24, ridge: 'z', eave: 4, verge: 3, tread: 2, rise: 3, thickness: 5 };
/** The oversailing upper storey and roof: two cells out to the west, east and garden, flush with the kitchen. */
const GREAT: Wing = { x0: 10, x1: 44, z0: 20, z1: 44, wallTop: 38, ridge: 'z', eave: 4, verge: 3, tread: 2, rise: 3, thickness: 5 };
/** The chamber wing beside it: a narrower gable to the garden with the eave held tight to the lot line. */
const CHAMBER: Wing = { x0: 44, x1: 62, z0: 8, z1: 44, wallTop: 30, ridge: 'z', eave: 2, verge: 3, tread: 2, rise: 3, thickness: 5 };
const DOOR_X = 37;
const GARDEN_DOOR_X = 53;

const front = { facing: 'south', plane: 124 } as const;
const west = { facing: 'west', plane: 10 } as const;
const east = { facing: 'east', plane: 50 } as const;
const TIERS: readonly HomeTier[] = ['hut', 'cottage', 'house', 'manor', 'hall'];

/** A louvred timber lantern astride the great hall's ridge: a curb, four posts, slatted sides and a tiled cap. */
function lantern(p: Plan, cx: number, cz: number): void {
  const crest = ridgeTop(GREAT);
  const x0 = cx - 4, x1 = cx + 4, z0 = cz - 4, z1 = cz + 4, y0 = crest - 3, y1 = crest + 11;
  p.put(x0, y0, z0, x1, crest + 3, z1, KIT.trim);
  for (const x of [x0, x1 - 2]) for (const z of [z0, z1 - 2]) p.put(x, crest + 3, z, x + 2, y1, z + 2, KIT.trim);
  // Slats on all four sides, inset one cell, with dark gaps between them.
  for (let y = crest + 4; y < y1 - 1; y += 2) {
    p.put(x0 + 2, y, z0 + 1, x1 - 2, y + 1, z0 + 2, KIT.trim);
    p.put(x0 + 2, y, z1 - 2, x1 - 2, y + 1, z1 - 1, KIT.trim);
    p.put(x0 + 1, y, z0 + 2, x0 + 2, y + 1, z1 - 2, KIT.trim);
    p.put(x1 - 2, y, z0 + 2, x1 - 1, y + 1, z1 - 2, KIT.trim);
  }
  p.put(x0, y1, z0, x1, y1 + 1, z1, KIT.trim);
  for (let k = 0; k < 4; k++) p.put(x0 - 1 + k, y1 + 1 + k, z0 - 1 + k, x1 + 1 - k, y1 + 2 + k, z1 + 1 - k, KIT.roof);
  p.put(cx - 1, y1 + 5, cz - 1, cx + 1, y1 + 8, cz + 1, KIT.trim);
}

export function emberfold(tier: HomeTier): HearthHome {
  const level = TIERS.indexOf(tier);
  const p = new Plan(homeId('emberfold', tier), rearLimit(tier));
  const kitchen = level >= 3 ? KITCHEN_JOINED : KITCHEN;
  const wings = [HALL, RETURN, kitchen, CHAMBER].filter((_, i) => i === 3 ? level >= 4 : i <= level);
  for (const w of wings) base(p, w);
  if (level >= 3) base(p, GREAT_GROUND);
  for (const w of wings) walls(p, w);
  if (level >= 3) {
    walls(p, GREAT_GROUND);
    jetty(p, GREAT_GROUND, GREAT);
  }
  if (level >= 4) {
    // The slot under the great hall's east jetty is closed up into one thick party wall with the chamber.
    p.put(GREAT_GROUND.x1, BASE, GREAT_GROUND.z0, CHAMBER.x0, GREAT_GROUND.wallTop, GREAT_GROUND.z1, KIT.wall);
  }
  studs(p, east, 76, 122, 24, 12);
  studs(p, west, 74, 122, 24, 12);
  if (level >= 1) studs(p, { facing: 'south', plane: RETURN.z1 }, 52, 58, 20, 12);
  if (level >= 2) {
    studs(p, { facing: 'north', plane: KITCHEN.z0 }, 18, 36, 20, 12);
    studs(p, { facing: 'east', plane: KITCHEN.x1 }, 45, 58, 20, 12);
  }
  if (level >= 3) {
    // Close studding on the jettied storey: the costly, upright timbering of a house that has done well.
    const top = GREAT.wallTop - 2, from = GREAT_GROUND.wallTop + 2;
    studs(p, { facing: 'north', plane: GREAT.z0 }, GREAT.x0 + 3, GREAT.x1 - 3, top, 4, from, null);
    studs(p, { facing: 'west', plane: GREAT.x0 }, GREAT.z0 + 3, GREAT.z1, top, 4, from, null);
    if (level === 3) studs(p, { facing: 'east', plane: GREAT.x1 }, GREAT.z0 + 3, GREAT.z1, top, 4, from, null);
    studs(p, { facing: 'south', plane: GREAT.z1 }, GREAT.x0 + 3, GREAT.x1 - 3, top, 4, KITCHEN.wallTop, null);
    studs(p, { facing: 'north', plane: GREAT_GROUND.z0 }, GREAT_GROUND.x0 + 3, GREAT_GROUND.x1 - 3, GREAT_GROUND.wallTop - 2, 12);
  }
  if (level >= 4) {
    studs(p, { facing: 'east', plane: CHAMBER.x1 }, CHAMBER.z0 + 3, CHAMBER.z1, CHAMBER.wallTop - 2, 11);
    studs(p, { facing: 'west', plane: CHAMBER.x0 }, CHAMBER.z0 + 3, GREAT.z0 - 1, CHAMBER.wallTop - 2, 11);
  }
  for (const w of wings) hollow(p, w);
  if (level >= 3) hollowJetty(p, GREAT_GROUND, GREAT);
  for (const w of wings) gables(p, w);
  if (level >= 3) gables(p, GREAT);
  // The return's west gable closes its attic behind the hall; inside the hall it would only wall off the loft.
  if (level >= 1) p.carve(RETURN.x0, RETURN.wallTop, HALL.z0 + 3, RETURN.x0 + 3, 60, RETURN.z1 + 3);
  // Rear gable: a king post and collar make the carpentry legible on the garden side.
  p.put(29, 26, 69, 31, 56, 70, KIT.trim);
  p.put(20, 40, 69, 40, 42, 70, KIT.trim);
  if (level >= 2) {
    // The kitchen's own gable carries a short king post under its ridge, until the great hall takes it in.
    if (level === 2) p.put(26, 22, KITCHEN.z0 - 1, 28, 36, KITCHEN.z0, KIT.trim);
    roof(p, kitchen);
  }
  roof(p, HALL);
  if (level >= 1) roof(p, RETURN);
  if (level >= 3) {
    roof(p, GREAT);
    // Garden gable: king post and collar again, now framing the loft light.
    p.put(26, 52, GREAT.z0 - 1, 28, 62, GREAT.z0, KIT.trim);
    p.put(18, 52, GREAT.z0 - 1, 36, 54, GREAT.z0, KIT.trim);
  }
  if (level >= 4) {
    roof(p, CHAMBER);
    lantern(p, 27, 32);
  }

  hood(p, front, DOOR_X, 26);
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

  if (level >= 1) {
    const gable = { facing: 'east', plane: 61 } as const;
    window(p, 'return-east', gable, { u0: 68, u1: 78, y0: 8, y1: 20 }, { mullion: true });
    window(p, 'return-loft', gable, { u0: 70, u1: 76, y0: 28, y1: 34 });
    trough(p, gable, 67, 79, 7, MAT.blueFlower);
  }

  if (level >= 2) {
    // Through the old rear wall into the kitchen, on the hall's own axis.
    passage(p, 'z', 21, 33, KITCHEN.z1 - 3, HALL.z0 + 3, FLOOR + 19);
    window(p, 'kitchen-west', { facing: 'west', plane: KITCHEN.x0 }, { u0: 60, u1: 68, y0: 8, y1: 20 });
    window(p, 'kitchen-east', { facing: 'east', plane: KITCHEN.x1 }, { u0: 46, u1: 56, y0: 8, y1: 20 }, { mullion: true });
    // The bake oven's stack: a smaller twin of the hall chimney, on the same west side.
    chimney(p, 7, 14, 46, 58, 18, 50, 'west');
  }

  if (level >= 3) {
    // Through the kitchen's old gable into the great hall, still on the axis.
    passage(p, 'z', 21, 33, GREAT.z1 - 3, KITCHEN.z0 + 3, FLOOR + 19);
    const garden = { facing: 'north', plane: GREAT_GROUND.z0 } as const;
    window(p, 'great-garden', garden, { u0: 21, u1: 33, y0: 8, y1: 20 }, { mullion: true });
    trough(p, garden, 20, 34, 7, MAT.petal);
    window(p, 'great-upper', { facing: 'north', plane: GREAT.z0 }, { u0: 22, u1: 32, y0: 27, y1: 35 }, { mullion: true });
    window(p, 'great-loft', { facing: 'north', plane: GREAT.z0 }, { u0: 24, u1: 30, y0: 44, y1: 50 });
    // A low, wide light: the eave comes down close over the jettied storey.
    window(p, 'great-west', { facing: 'west', plane: GREAT.x0 }, { u0: 21, u1: 29, y0: 28, y1: 32 });
    // The third stack, the tallest, warms the great hall from the same west flank.
    chimney(p, 4, 12, 30, 42, 20, 76, 'west');
  }

  const exits: HearthHome['exits'][number][] = [];
  if (level >= 4) {
    passage(p, 'x', 27, 37, GREAT_GROUND.x1 - 3, CHAMBER.x0 + 3, FLOOR + 19);
    const gable = { facing: 'north', plane: CHAMBER.z0 } as const;
    // The garden door repeats the hut's street front: the same hood on the same brackets, the same open leaf.
    hood(p, gable, GARDEN_DOOR_X, 26);
    exits.push({ at: doorway(p, gable, GARDEN_DOOR_X, 22, 'low'), facing: 'north' });
    // The chamber gable is too small for a loft light above the hood: a king post carries its ridge instead.
    p.put(GARDEN_DOOR_X - 1, 36, CHAMBER.z0 - 1, GARDEN_DOOR_X + 1, 44, CHAMBER.z0, KIT.trim);
    const side = { facing: 'east', plane: CHAMBER.x1 } as const;
    // The east wall stands two cells off the lot line, too close for a trough; the court side gets the flowers.
    window(p, 'chamber-east', side, { u0: 14, u1: 24, y0: 8, y1: 20 }, { mullion: true });
    window(p, 'chamber-garden', side, { u0: 30, u1: 40, y0: 8, y1: 20 }, { mullion: true });
    const court = { facing: 'west', plane: CHAMBER.x0 } as const;
    window(p, 'chamber-west', court, { u0: 10, u1: 18, y0: 8, y1: 20 });
    trough(p, court, 9, 19, 7, MAT.blueFlower);
  }

  // A clipped box shrub anchors the garden corner beside the parlour window.
  p.put(2, 0, 115, 9, 1, 123, MAT.earth);
  p.put(3, 1, 116, 8, 4, 122, MAT.leaf);
  p.put(4, 4, 117, 7, 6, 121, MAT.leaf);
  // Each hood bracket carries its slope from the wall plate line down to the stone base.
  const supports: (readonly [number, number, number, number])[] = [[DOOR_X - 8, 124, 15, 27], [DOOR_X + 7, 124, 15, 27]];
  if (level >= 4) supports.push([GARDEN_DOOR_X - 8, CHAMBER.z0 - 1, 15, 27], [GARDEN_DOOR_X + 7, CHAMBER.z0 - 1, 15, 27]);
  const rooms: (readonly [number, number, number])[] = [[30, 2, 96]];
  if (level >= 1) rooms.push([55, 2, 72]);
  if (level >= 2) rooms.push([27, 2, 54]);
  if (level >= 3) rooms.push([27, 2, 32]);
  if (level >= 4) rooms.push([53, 2, 20]);
  return { blueprint: p.blueprint(), entrance, exits, rooms, supports };
}
