import type { HomeTier } from '@chatdom/shared';
import { MAT } from '../../materials';
import {
  FLOOR, Plan, Reflected, STONE, Shell, TRIM, WALL, chimney, doorway, east, extrude, floor, gableRoof, gableWall, hipRoof, north, south, west,
  windowIn, type Gable, type Hip,
} from './grammar';
import { finished, reached, type TideHome } from './family';

/**
 * Saltbend: a broad, low hipped house that turns its shoulder to the wind. Its front-east corner is cut away into
 * a sheltered porch under the roof, marked by a small boarded entry gable on a timber post; a tall stone skirt
 * keeps the spray off the cream walls.
 */
const SKIRT = 12;
const EAVE = 28;
const MAIN_ROOF: Hip = { x0: 2, z0: 84, x1: 62, z1: 128, base: 24 };
const WING_BASE = 22;
const WING_EAVE = 24;
// The entry gable shares the hip's pitch, so its ridge dies cleanly into the main slope behind the porch.
const ENTRY: Gable = { ridge: 'z', lo: 40, hi: 60, baseLo: 26, baseHi: 26, along: [104, 128], rise: 2, run: 2, thick: 4 };
/**
 * Manor: a low cross range across the back, hipped like the house. The wing's taller roof runs on over it to a
 * hipped end, so the range's courses stop against the wing's in valleys and show as two low shoulders.
 */
const RANGE = { x0: 6, z0: 20, x1: 58, z1: 40 } as const;
const RANGE_ROOF: Hip = { x0: 2, z0: 16, x1: 62, z1: 44, base: WING_BASE };
const wingRing = (z0: number) => (k: number) => ({ x0: 8 + 2 * k, z0: z0 + 2 * k, x1: 56 - 2 * k, z1: 128 });
// The garden door's gable: wide enough that the door's whole stone surround sits under its courses.
const GARDEN: Gable = { ridge: 'z', lo: 18, hi: 46, baseLo: WING_BASE, baseHi: WING_BASE, along: y => [16, y - 2], rise: 2, run: 2, thick: 4 };
/** Hall: the hut's own plan, roof and sheltered corner turned to face the garden, its door the garden door. */
const HALL = { x0: 6, z0: 4, x1: 58, z1: 40 } as const;

/** The sheltered corner: flagged floor, a stout post on its pad, beams carrying a boarded soffit. */
function shelteredCorner(shell: Shell): void {
  shell.put(STONE, 40, 0, 110, 58, FLOOR, 124);
  shell.put(STONE, 53, 0, 119, 58, 8, 124);
  shell.put(TRIM, 54, 8, 120, 58, EAVE, 124);
  shell.put(TRIM, 37, 24, 120, 58, EAVE, 124);
  shell.put(TRIM, 54, 24, 107, 58, EAVE, 120);
  shell.put(TRIM, 40, EAVE - 1, 110, 54, EAVE, 120);
  shell.put(TRIM, 51, 22, 120, 54, 24, 124);
  shell.put(TRIM, 54, 22, 117, 58, 24, 120);
  gableWall(shell, ENTRY, EAVE, 40, 58, 121, 124, TRIM);
}

/** The door at the back of the corner and one broad worn step up onto the porch flags. */
function cornerDoor(shell: Shell): [number, number, number] {
  const focus = doorway(shell, south(110), 42, 3, STONE, false);
  shell.put(STONE, 41, 0, 124, 57, 1, 126);
  shell.put(STONE, 43, 0, 126, 55, 1, 127);
  return focus;
}

/** Sea holly in a stone-edged bed along the skirt. */
function hollyBed(shell: Shell): void {
  shell.put(STONE, 8, 0, 125, 38, 2, 128);
  shell.put(MAT.earth, 9, 1, 125, 37, 2, 127);
  for (const [x0, x1, m] of [[9, 13, MAT.blueFlower], [13, 16, MAT.leaf], [16, 21, MAT.blueFlower], [24, 27, MAT.leaf], [27, 33, MAT.blueFlower], [33, 37, MAT.leaf]] as const) shell.put(m, x0, 2, 125, x1, 3, 127);
}

export function saltbend(tier: HomeTier): TideHome {
  finished('saltbend', tier, ['hut', 'cottage', 'house', 'manor', 'hall']);
  const shell = new Shell(), garden = new Reflected(shell);
  const plan = new Plan().add(6, 88, 58, 124).cut(40, 110, 58, 124);
  const grown = reached(tier, 'cottage'), house = reached(tier, 'house'), manor = reached(tier, 'manor'), hall = reached(tier, 'hall');
  if (grown) plan.add(10, house ? 40 : 64, 54, 88);
  if (manor && !hall) plan.add(RANGE.x0, RANGE.z0, RANGE.x1, RANGE.z1);
  if (hall) plan.add(HALL.x0, HALL.z0, HALL.x1, HALL.z1).cut(40, 4, 58, 18);

  floor(shell, plan, 3);
  extrude(shell, plan.band(3), STONE, 0, SKIRT);
  extrude(shell, plan.ring(1), STONE, 0, 2);
  // The drip course caps the skirt of the house proper; the outshut's plain stone wall runs up to its eave.
  extrude(shell, plan.ring(1), STONE, SKIRT - 2, SKIRT, { x0: 0, z0: 87, x1: 64, z1: 128 });
  if (hall) extrude(shell, plan.ring(1), STONE, SKIRT - 2, SKIRT, { x0: 0, z0: 0, x1: 64, z1: 41 });
  extrude(shell, plan.northRing(1), MAT.moss, 2, 3);
  extrude(shell, plan.band(3), WALL, SKIRT, EAVE, { x0: 0, z0: 88, x1: 64, z1: 128 });

  if (grown) {
    // Cottage: a lean-to outshut along the back under its own hipped ends; the old back wall becomes a partition.
    // House: the outshut walls are raised and carried back into a full wing, hipped like the house it serves.
    extrude(shell, plan.band(3), WALL, SKIRT, house ? WING_EAVE : 18, { x0: 0, z0: 0, x1: 64, z1: 88 });
    shell.put(WALL, 10, FLOOR, 88, 54, EAVE, 91);
    shell.air(38, FLOOR, 88, 50, FLOOR + 21, 91);
    if (!house) hipRoof(shell, { x0: 6, z0: 60, x1: 58, z1: 88, base: 14, open: 'south', courses: 6 });
  }
  // The hall stands as tall as the hut, so its walls rise on to the hut's eave.
  if (hall) extrude(shell, plan.band(3), WALL, WING_EAVE, EAVE, { x0: 0, z0: 0, x1: 64, z1: HALL.z1 });

  shelteredCorner(shell);
  if (hall) shelteredCorner(garden);

  hipRoof(shell, MAIN_ROOF, TRIM);
  if (hall) hipRoof(garden, MAIN_ROOF, TRIM);
  if (manor && !hall) hipRoof(shell, { ...RANGE_ROOF, under: wingRing(RANGE_ROOF.z0) }, TRIM);
  if (house) {
    // The wing's ridge stays a course below the house's; each ring runs on into the main course at its height.
    // At the hall it dies into the garden roof the same way; at the manor it rides over the range to a hipped end.
    const meet = (k: number) => Math.max(88, MAIN_ROOF.z0 + 2 * (k - (MAIN_ROOF.base - WING_BASE) / 2) + 4);
    const wing: Hip = { x0: 8, z0: manor ? RANGE_ROOF.z0 : 36, x1: 56, z1: 88, base: WING_BASE, open: 'south', courses: 10, southAt: meet };
    hipRoof(shell, hall ? { ...wing, northAt: k => 128 - meet(k) } : wing, TRIM);
  }
  if (manor && !hall) {
    // The garden door under its own small gable: the eaves are cut back beneath it, then the boarded gable is set.
    // Each row clears between the gable's own courses: in front of the wall, and inside it above the door's head.
    for (let y = GARDEN.baseLo, i = 0; GARDEN.hi - GARDEN.lo - 8 - 4 * i > 0; y += 2, i++) {
      shell.air(GARDEN.lo + 4 + 2 * i, y, 16, GARDEN.hi - 4 - 2 * i, y + 2, y < 26 ? RANGE.z0 : RANGE.z0 + 3);
    }
    doorway(shell, north(RANGE.z0), 26, 3);
    gableWall(shell, GARDEN, 27, GARDEN.lo, GARDEN.hi, RANGE.z0, RANGE.z0 + 3, TRIM);
    gableRoof(shell, GARDEN, { cap: TRIM, barge: ['lo'] });
  }
  gableRoof(shell, ENTRY, { cap: TRIM, barge: ['hi'] });
  if (hall) gableRoof(garden, ENTRY, { cap: TRIM, barge: ['hi'] });

  // A broad stack rises from the hearth on the back wall through the rear slope.
  shell.put(STONE, 23, FLOOR, 91, 33, 24, 94);
  shell.air(25, FLOOR, 91, 31, 10, 94);
  shell.put(TRIM, 22, 10, 92, 34, 12, 95);
  chimney(shell, { x: 24, z: 86, w: 8, d: 6, base: 0, top: 54, lean: [0, 1] });

  const entrance = cornerDoor(shell);
  if (hall) cornerDoor(garden);
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
  if (house) {
    windowIn(shell, west(10), { id: 'wing-west', u: 48, y: 13, w: 10, h: 8, wall: 3, recess: 1, mullion: true, sill: STONE });
    windowIn(shell, east(54), { id: 'wing-east', u: 52, y: 13, w: 10, h: 8, wall: 3, recess: 1, mullion: true, sill: STONE });
  }
  // The range's north wall is where the hall will stand, so its windows look east and west.
  if (manor) {
    windowIn(shell, west(RANGE.x0), { id: 'range-west', u: 26, y: 13, w: 10, h: 8, wall: 3, recess: 1, mullion: true, sill: STONE });
    windowIn(shell, east(RANGE.x1), { id: 'range-east', u: 26, y: 13, w: 10, h: 8, wall: 3, recess: 1, mullion: true, sill: STONE });
  }
  if (hall) {
    windowIn(shell, north(HALL.z0), { id: 'garden-west', u: 11, y: 13, w: 10, h: 10, wall: 3, recess: 1, mullion: true, sill: STONE });
    windowIn(shell, north(HALL.z0), { id: 'garden-east', u: 26, y: 13, w: 10, h: 10, wall: 3, recess: 1, mullion: true, sill: STONE });
    windowIn(shell, east(40), { id: 'garden-porch', u: 9, y: 13, w: 6, h: 10, wall: 3, recess: 1, sill: STONE });
    windowIn(shell, west(HALL.x0), { id: 'hall-west', u: 10, y: 13, w: 10, h: 10, wall: 3, recess: 1, mullion: true, sill: STONE });
  }

  hollyBed(shell);
  if (hall) hollyBed(garden);
  return { blueprint: shell.blueprint(`home-tide-saltbend-${tier}`), entrance };
}
