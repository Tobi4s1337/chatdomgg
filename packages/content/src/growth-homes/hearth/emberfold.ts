import type { HomeTier } from '@chatdom/shared';
import { MAT } from '../../materials';
import { emberfold as emberfoldHut } from '../../homes/hearth/emberfold';
import type { HearthHome } from '../../homes/hearth/family';
import {
  BASE, FLOOR, KIT, Plan, base, chimney, doorway, gables, hollow, hollowJetty, hood, jetty, meet, onFace, passage, rearLimit, ridgeTop, roof,
  roofTop, span, studs, trough, walls, window, type Wing,
} from '../../homes/hearth/grammar';

/**
 * Emberfold, grown toward the street. The address never moves: the same stone footing, the same hooded door on
 * carved brackets, the same west stack and every earlier pane exactly where it was. What changes is what a
 * neighbour reads from across the lane, in the same light, at a glance.
 *
 * - Cottage: a full close-studded storey on the hut, jettied over the east path, under a gable half again as high
 *   with an attic light and a finial; a lean-to aisle sweeps the east roof down over a garden room; the stack
 *   climbs with the ridge; a picket fence, beds, a climbing rose and a kitchen garden behind.
 * - House: a third storey and a gable that tops every neighbour, a kitchen range behind with its own stack, a
 *   second row of lit panes and a gable light.
 * - Manor: a broad cross range across the back of the plot, stone below and close-studded above, its long ridge
 *   and both gable ends standing out either side of the street gable, a west gable-end stack, and a limestone garden
 *   wall with gate piers and clipped yew in place of the fence.
 * - Hall: a stair tower on the street's east corner with a louvred belfry, a tiled spire and a lantern, and a
 *   chamber wing to the garden with its own hooded door.
 *
 * Nothing is ever built in front of a pane: the east path (x ≥ 50, z 102–112) and the west bay (x < 10,
 * z 104–112) stay open at window height for good, and the doorway, step and hood are the hut's cell for cell.
 */
const GROUND: Wing = { x0: 10, x1: 50, z0: 70, z1: 124, wallTop: 26, ridge: 'z', eave: 4, verge: 3, tread: 2, rise: 3, thickness: 5 };
/** The cottage's first floor, jettied two cells east over the side path. */
const UPPER: Wing = { ...GROUND, x1: 52, wallTop: 50 };
/** The house's second floor, straight up from the first. */
const SECOND: Wing = { ...UPPER, wallTop: 72 };
/** The garden aisle under the east lean-to, behind the east parlour's view. */
const AISLE = { x0: 50, x1: 62, z0: 74, z1: 100, wallTop: 22 } as const;
/** The house's two-storey kitchen range on the hall's axis, its own gable to the garden. */
const KITCHEN: Wing = { x0: 16, x1: 44, z0: 40, z1: 72, wallTop: 44, ridge: 'z', eave: 3, verge: 3, verges: [3, -2], tread: 2, rise: 3, thickness: 5, gables: [true, false], barges: [true, false] };
/** From the manor on, the kitchen roof runs in over the cross range's slope to its ridge and meets it in valleys. */
const KITCHEN_JOINED: Wing = { ...KITCHEN, verges: [8, -2], gables: [false, false], barges: [false, false] };
/** The manor's cross range: stone below, close-studded above, its ridge across the plot. */
const GREAT: Wing = { x0: 6, x1: 58, z0: 24, z1: 40, wallTop: 72, ridge: 'x', eave: 4, verge: 2, tread: 2, rise: 3, thickness: 5 };
/** The hall's chamber wing, gable to the garden, its high end against the cross range. */
const CHAMBER: Wing = { x0: 42, x1: 60, z0: 6, z1: 24, wallTop: 30, ridge: 'z', eave: 1, verge: 2, verges: [2, 0], tread: 2, rise: 3, thickness: 4, gables: [true, false], barges: [true, false] };
/** The hall's stair tower on the street's east corner, south of the east parlour's view. */
const TOWER = { x0: 50, x1: 62, z0: 113, z1: 125, top: 104 } as const;
const DOOR_X = 37;
const GARDEN_DOOR_X = 51;
/** Centre of the street gable: its attic lights, king posts and finial line up here. */
const MID = 31;
const TIERS: readonly HomeTier[] = ['hut', 'cottage', 'house', 'manor', 'hall'];

const front = { facing: 'south', plane: 124 } as const;
const west = { facing: 'west', plane: 10 } as const;
const east = { facing: 'east', plane: 50 } as const;
const eastUpper = { facing: 'east', plane: 52 } as const;

export function growthHomeId(family: 'emberfold', tier: HomeTier): string {
  return `home-hearth-${family}-${tier}${tier === 'hut' ? '' : '-v2'}`;
}

/** Top of the east lean-to at x: the first floor's own slope, carried on past its eave at the same pitch. */
function leanTop(x: number): number {
  const { b } = span(UPPER);
  if (x < b) return roofTop(UPPER, x);
  return roofTop(UPPER, b - 1) - UPPER.rise * (Math.floor((x - b) / UPPER.tread) + 1);
}

/** The lean-to over the aisle, from x0 to the lot edge, with barge boards at both ends. */
function leanTo(p: Plan, x0: number, l0: number, l1: number): void {
  for (let x = x0; x < 64; x += UPPER.tread) {
    const top = leanTop(x);
    p.put(x, top - UPPER.thickness, l0 + 1, x + UPPER.tread, top, l1 - 1, KIT.roof);
    for (const z of [l0, l1 - 1]) p.put(x, top - UPPER.thickness, z, x + UPPER.tread, top + 1, z + 1, KIT.trim);
  }
}

/** A picket fence along the lane, posts every eight cells, all of it below the lowest sill. */
function picket(p: Plan, x0: number, x1: number, z: number): void {
  for (let x = x0; x + 1 <= x1; x += 2) if ((x - x0) % 8) p.put(x, 0, z, x + 1, 6, z + 1, KIT.trim);
  for (let x = x0; x < x1; x += 8) p.put(x, 0, z, Math.min(x1, x + 2), 7, z + 1, KIT.trim);
  p.put(x0, 2, z - 1, x1, 3, z, KIT.trim);
  p.put(x0, 4, z - 1, x1, 5, z, KIT.trim);
}

/** A planted bed: turned earth, low leaf and flowers on a steady rhythm. */
function bed(p: Plan, x0: number, x1: number, z0: number, z1: number, flowers: number): void {
  p.put(x0, 0, z0, x1, 1, z1, MAT.earth);
  p.put(x0, 1, z0, x1, 2, z1, MAT.leaf);
  for (let x = x0 + 1; x + 1 < x1; x += 3) for (let z = z0; z < z1; z += 2) p.put(x, 2, z, x + 1, 3, z + 1, (x + z) % 4 < 2 ? flowers : MAT.leaf);
}

/** A kitchen garden: furrowed rows of earth with low greens, kept below a citizen's knee. */
function patch(p: Plan, x0: number, x1: number, z0: number, z1: number): void {
  for (let z = z0; z + 2 <= z1; z += 3) {
    p.put(x0, 0, z, x1, 1, z + 2, MAT.earth);
    for (let x = x0 + 1; x + 2 <= x1 - 1; x += 3) p.put(x, 1, z, x + 2, 2, z + 2, (x + z) % 2 ? MAT.leaf : MAT.moss);
  }
}

/** A climbing rose up a stretch of front wall, rooted in its own bed. */
function rose(p: Plan, x0: number, x1: number, plane: number, top: number): void {
  p.put(x0, 0, plane, x1, 1, plane + 2, MAT.earth);
  p.put(x0, 1, plane, x1, top - 4, plane + 1, MAT.leaf);
  for (let y = 4; y < top - 4; y += 5) p.put(x0 + (y % 2), y, plane + 1, x0 + (y % 2) + 1, y + 1, plane + 2, MAT.petal);
  p.put(x0 - 1, top - 4, plane, x1 + 1, top, plane + 1, MAT.leaf);
  p.put(x0, top - 3, plane + 1, x0 + 1, top - 2, plane + 2, MAT.petal);
}

/** The stair tower: a limestone base storey, plaster above, a jettied belfry, a tiled spire and a lantern finial. */
function tower(p: Plan): void {
  const { x0, x1, z0, z1, top } = TOWER;
  p.put(x0 - 1, 0, z0 - 1, x1 + 1, BASE, z1 + 1, KIT.stone);
  p.put(x0, BASE, z0, x1, 30, z1, KIT.stone);
  p.put(x0, 30, z0, x1, top, z1, KIT.wall);
  for (const y of [28, 54, 80]) p.put(x0 - 1, y, z0 - 1, x1 + 1, y + 2, z1 + 1, KIT.trim);
  for (const x of [x0, x1 - 2]) p.put(x, 32, z1 - 1, x + 2, top, z1 + 1, KIT.trim);
  // The belfry oversails one cell all round on a timber curb; its louvres are dark slots between slats.
  p.put(x0 - 1, top, z0 - 1, x1 + 1, top + 2, z1 + 1, KIT.trim);
  p.put(x0 - 1, top + 2, z0 - 1, x1 + 1, top + 12, z1 + 1, KIT.wall);
  for (const [u0, u1] of [[x0 + 1, x0 + 5], [x1 - 5, x1 - 1]] as const) {
    p.carve(u0, top + 3, z1, u1, top + 10, z1 + 1);
    for (let y = top + 4; y < top + 10; y += 2) p.put(u0, y, z1, u1, y + 1, z1 + 1, KIT.trim);
  }
  p.put(x0 - 2, top + 12, z0 - 2, x1 + 2, top + 14, z1 + 2, KIT.trim);
  // A steep tiled spire.
  for (let k = 0; k < 7; k++) p.put(x0 - 1 + k, top + 14 + k * 3, z0 - 1 + k, x1 + 1 - k, top + 17 + k * 3, z1 + 1 - k, KIT.roof);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, crest = top + 35;
  // The lantern: a curb, four posts, a cap and a finial.
  p.put(cx - 3, crest, cz - 3, cx + 3, crest + 2, cz + 3, KIT.trim);
  for (const [dx, dz] of [[-3, -3], [2, -3], [-3, 2], [2, 2]] as const) p.put(cx + dx, crest + 2, cz + dz, cx + dx + 1, crest + 8, cz + dz + 1, KIT.trim);
  p.put(cx - 4, crest + 8, cz - 4, cx + 4, crest + 9, cz + 4, KIT.trim);
  for (let k = 0; k < 3; k++) p.put(cx - 3 + k, crest + 9 + k, cz - 3 + k, cx + 3 - k, crest + 10 + k, cz + 3 - k, KIT.roof);
  p.put(cx - 1, crest + 12, cz - 1, cx + 1, crest + 16, cz + 1, KIT.trim);
  // A stair core inside, floored, from the ground to the belfry.
  p.carve(x0 + 3, FLOOR, z0 + 3, x1 - 3, top + 10, z1 - 3);
  p.put(x0 + 3, FLOOR - 1, z0 + 3, x1 - 3, FLOOR, z1 - 3, KIT.trim);
}

export function emberfoldGrowth(tier: HomeTier): HearthHome {
  const level = TIERS.indexOf(tier);
  if (level < 0) throw new Error(`Unknown home tier ${String(tier)}.`);
  // The hut is the family's own hut, cell for cell: an installed hut stays exactly what it was.
  if (level === 0) return emberfoldHut('hut');
  const p = new Plan(growthHomeId('emberfold', tier), rearLimit(tier));
  const street = level >= 2 ? SECOND : UPPER;
  const kitchen = level >= 3 ? KITCHEN_JOINED : KITCHEN;

  // ---- Footings, walls and storeys ----
  base(p, GROUND);
  p.put(AISLE.x0 - 1, 0, AISLE.z0 - 1, AISLE.x1 + 1, BASE, AISLE.z1 + 1, KIT.stone);
  if (level >= 2) base(p, KITCHEN);
  if (level >= 3) base(p, GREAT);
  if (level >= 4) base(p, CHAMBER);
  walls(p, GROUND);
  jetty(p, GROUND, UPPER);
  if (level >= 2) { jetty(p, UPPER, SECOND); walls(p, KITCHEN); }
  if (level >= 3) {
    walls(p, GREAT);
    // A limestone ground storey under a moulded string course: the cross range is built to last.
    p.put(GREAT.x0, BASE, GREAT.z0, GREAT.x1, 30, GREAT.z1, KIT.stone);
    p.put(GREAT.x0 - 1, 30, GREAT.z0 - 1, GREAT.x1 + 1, 32, GREAT.z1 + 1, KIT.trim);
  }
  if (level >= 4) walls(p, CHAMBER);
  // The aisle: under the jetty to the first floor's plate, then up to the lean-to's underside.
  p.put(AISLE.x0, BASE, AISLE.z0, UPPER.x1, GROUND.wallTop, AISLE.z1, KIT.wall);
  for (let x = UPPER.x1; x < AISLE.x1; x += 2) p.put(x, BASE, AISLE.z0, x + 2, leanTop(x) - UPPER.thickness, AISLE.z1, KIT.wall);

  // ---- Timbering: plain studs on the ground storey, close studding where the family has done well ----
  studs(p, east, 76, 122, 24, 12);
  studs(p, west, 74, 122, 24, 12);
  studs(p, front, 12, 49, 48, 4, 28, null);
  studs(p, west, 72, 123, 48, 4, 28, null);
  studs(p, eastUpper, 102, 123, 48, 4, 28, null);
  studs(p, { facing: 'east', plane: AISLE.x1 }, 76, 99, 24, 6, BASE, 14);
  if (level >= 2) {
    studs(p, front, 12, 49, 70, 4, 52, null);
    studs(p, west, 72, 123, 70, 4, 52, null);
    studs(p, eastUpper, 72, 123, 70, 4, 52, null);
    studs(p, { facing: 'west', plane: KITCHEN.x0 }, 42, 70, 42, 6, BASE, 22);
    studs(p, { facing: 'east', plane: KITCHEN.x1 }, 42, 70, 42, 6, BASE, 22);
  }
  if (level >= 3) studs(p, { facing: 'north', plane: GREAT.z0 }, GREAT.x0 + 3, GREAT.x1 - 3, GREAT.wallTop - 2, 4, 32, null);
  if (level >= 4) studs(p, { facing: 'east', plane: CHAMBER.x1 }, CHAMBER.z0 + 3, CHAMBER.z1, CHAMBER.wallTop - 2, 6, BASE, 14);
  // The storey line on the street front and the west flank, either side of the door hood.
  onFace(p, front, 9, 28, 26, 28, 0, 1, KIT.trim);
  onFace(p, front, 46, 53, 26, 28, 0, 1, KIT.trim);
  onFace(p, west, 69, 125, 26, 28, 0, 1, KIT.trim);
  if (level >= 2) {
    onFace(p, front, 9, 53, 50, 52, 0, 1, KIT.trim);
    onFace(p, west, 69, 125, 50, 52, 0, 1, KIT.trim);
  }

  // ---- Rooms and floors ----
  hollowJetty(p, GROUND, UPPER);
  if (level >= 2) p.carve(UPPER.x0 + 3, UPPER.wallTop, UPPER.z0 + 3, UPPER.x1 - 3, SECOND.wallTop, UPPER.z1 - 3);
  p.carve(AISLE.x0 + 3, FLOOR, AISLE.z0 + 3, AISLE.x1 - 3, AISLE.wallTop, AISLE.z1 - 3);
  p.put(AISLE.x0 + 3, FLOOR - 1, AISLE.z0 + 3, AISLE.x1 - 3, FLOOR, AISLE.z1 - 3, KIT.trim);
  if (level >= 2) hollow(p, KITCHEN);
  if (level >= 3) hollow(p, GREAT);
  if (level >= 4) hollow(p, CHAMBER);
  // Boarded floors: every storey is a room of its own.
  p.put(GROUND.x0 + 3, GROUND.wallTop, GROUND.z0 + 3, UPPER.x1 - 3, GROUND.wallTop + 2, GROUND.z1 - 3, KIT.trim);
  if (level >= 2) {
    p.put(UPPER.x0 + 3, UPPER.wallTop, UPPER.z0 + 3, UPPER.x1 - 3, UPPER.wallTop + 2, UPPER.z1 - 3, KIT.trim);
    p.put(KITCHEN.x0 + 3, 24, KITCHEN.z0 + 3, KITCHEN.x1 - 3, 26, KITCHEN.z1 - 3, KIT.trim);
  }
  if (level >= 3) p.put(GREAT.x0 + 3, 32, GREAT.z0 + 3, GREAT.x1 - 3, 34, GREAT.z1 - 3, KIT.trim);
  // From the parlour into the aisle, and on along the hall's axis into each new range.
  passage(p, 'x', 80, 92, GROUND.x1 - 3, AISLE.x0 + 3, FLOOR + 19);
  if (level >= 2) passage(p, 'z', 24, 36, KITCHEN.z1 - 3, GROUND.z0 + 3, FLOOR + 19);
  if (level >= 3) passage(p, 'z', 24, 36, GREAT.z1 - 3, KITCHEN.z0 + 3, FLOOR + 19);
  if (level >= 4) passage(p, 'z', 46, 56, CHAMBER.z1 - 3, GREAT.z0 + 3, FLOOR + 19);

  // ---- Gables and roofs ----
  gables(p, street);
  if (level === 2) gables(p, KITCHEN);
  if (level >= 3) gables(p, GREAT);
  if (level >= 4) gables(p, CHAMBER);
  roof(p, street);
  leanTo(p, level >= 2 ? UPPER.x1 : span(UPPER).b, AISLE.z0 - 2, AISLE.z1 + 2);
  if (level >= 2) roof(p, kitchen);
  if (level >= 3) { roof(p, GREAT); meet(p, kitchen, GREAT); }
  if (level >= 4) roof(p, CHAMBER);
  // King posts either side of the gable's highest light, and a turned finial at the apex.
  const crest = ridgeTop(street), light = level >= 2 ? [80, 88] as const : [58, 66] as const;
  p.put(MID - 1, street.wallTop, front.plane, MID + 1, light[0] - 1, front.plane + 1, KIT.trim);
  p.put(MID - 1, light[1] + 2, front.plane, MID + 1, crest - 4, front.plane + 1, KIT.trim);
  p.put(MID - 1, crest, front.plane + 1, MID + 1, crest + 7, front.plane + 3, KIT.trim);
  p.put(MID - 2, crest + 5, front.plane + 1, MID + 2, crest + 6, front.plane + 3, KIT.trim);

  // ---- The address: the hut's hood and door ----
  hood(p, front, DOOR_X, 26);
  const entrance = doorway(p, front, DOOR_X, 22, 'high');

  // ---- Windows: the hut's four first, in its order and at its anchors, then each tier's in turn ----
  window(p, 'front-parlour', front, { u0: 17, u1: 25, y0: 8, y1: 22 }, { mullion: true });
  trough(p, front, 16, 26, 7, MAT.petal);
  window(p, 'gable-loft', front, { u0: 27, u1: 33, y0: 38, y1: 46 });
  window(p, 'west-hearth', west, { u0: 104, u1: 112, y0: 8, y1: 20 });
  window(p, 'east-parlour', east, { u0: 102, u1: 112, y0: 8, y1: 20 }, { mullion: true });
  window(p, 'upper-west', front, { u0: 13, u1: 23, y0: 38, y1: 46 }, { mullion: true });
  window(p, 'upper-east', front, { u0: 39, u1: 45, y0: 38, y1: 46 });
  window(p, 'west-upper', west, { u0: 104, u1: 112, y0: 34, y1: 42 });
  window(p, 'east-upper', eastUpper, { u0: 104, u1: 112, y0: 34, y1: 42 }, { mullion: true });
  window(p, 'aisle-east', { facing: 'east', plane: AISLE.x1 }, { u0: 82, u1: 92, y0: 8, y1: 18 }, { mullion: true });
  window(p, 'gable-attic', front, { u0: 28, u1: 34, y0: 58, y1: 66 });
  if (level >= 2) {
    window(p, 'second-west', front, { u0: 13, u1: 23, y0: 58, y1: 66 }, { mullion: true });
    window(p, 'second-east', front, { u0: 39, u1: 45, y0: 58, y1: 66 });
    window(p, 'gable-light', front, { u0: 28, u1: 34, y0: light[0], y1: light[1] });
    window(p, 'kitchen-west', { facing: 'west', plane: KITCHEN.x0 }, { u0: 44, u1: 52, y0: 8, y1: 20 });
    window(p, 'kitchen-east', { facing: 'east', plane: KITCHEN.x1 }, { u0: 48, u1: 58, y0: 8, y1: 20 }, { mullion: true });
    window(p, 'kitchen-upper', { facing: 'east', plane: KITCHEN.x1 }, { u0: 48, u1: 58, y0: 30, y1: 38 }, { mullion: true });
  }
  if (level >= 3) {
    const garden = { facing: 'north', plane: GREAT.z0 } as const;
    window(p, 'great-garden', garden, { u0: 18, u1: 30, y0: 8, y1: 22 }, { mullion: true });
    trough(p, garden, 17, 31, 7, MAT.petal);
    window(p, 'great-upper', garden, { u0: 18, u1: 30, y0: 38, y1: 52 }, { mullion: true });
    window(p, 'great-high', garden, { u0: 18, u1: 30, y0: 56, y1: 66 }, { mullion: true });
    window(p, 'great-gable', { facing: 'east', plane: GREAT.x1 }, { u0: 30, u1: 34, y0: 74, y1: 80 });
  }

  // ---- Stacks: the west hearth climbs with the ridge; the kitchen and the cross range add their own ----
  chimney(p, 3, 10, 84, 98, 22, crest + 6, 'west');
  if (level >= 2) chimney(p, 9, 16, 56, 68, 20, ridgeTop(KITCHEN) + 8, 'west');
  if (level >= 3) chimney(p, GREAT.x0, GREAT.x0 + 7, 26, 38, 22, ridgeTop(GREAT) + 8, 'none');

  // ---- The hall: a tower on the street corner and a chamber wing with a garden door ----
  const exits: HearthHome['exits'][number][] = [];
  const supports: (readonly [number, number, number, number])[] = [[DOOR_X - 8, 124, 15, 27], [DOOR_X + 7, 124, 15, 27]];
  if (level >= 4) {
    // The street roof's east verge stops at the tower's flank instead of running on across its face.
    p.carve(TOWER.x0, GROUND.wallTop, TOWER.z1, 64, TOWER.top, 128);
    tower(p);
    const face = { facing: 'south', plane: TOWER.z1 } as const;
    window(p, 'tower-low', face, { u0: 53, u1: 59, y0: 36, y1: 46 });
    window(p, 'tower-mid', face, { u0: 53, u1: 59, y0: 60, y1: 70 });
    window(p, 'tower-high', face, { u0: 53, u1: 59, y0: 84, y1: 94 });
    window(p, 'tower-east', { facing: 'east', plane: TOWER.x1 }, { u0: 116, u1: 122, y0: 60, y1: 70 });
    const gable = { facing: 'north', plane: CHAMBER.z0 } as const;
    hood(p, gable, GARDEN_DOOR_X, 26);
    exits.push({ at: doorway(p, gable, GARDEN_DOOR_X, 22, 'low'), facing: 'north' });
    supports.push([GARDEN_DOOR_X - 8, CHAMBER.z0 - 1, 15, 27], [GARDEN_DOOR_X + 7, CHAMBER.z0 - 1, 15, 27]);
    window(p, 'chamber-east', { facing: 'east', plane: CHAMBER.x1 }, { u0: 12, u1: 20, y0: 8, y1: 20 }, { mullion: true });
  }

  // ---- The garden: fence, beds and a rose; from the manor a coped wall, gate piers and clipped yew ----
  if (level >= 3) {
    for (const [x0, x1] of [[0, 25], [49, 64]] as const) {
      p.put(x0, 0, 126, x1, 5, 128, KIT.stone);
      p.put(x0, 5, 126, x1, 6, 128, KIT.trim);
    }
    for (const x of [25, 46]) {
      p.put(x, 0, 125, x + 3, 8, 128, KIT.stone);
      p.put(x, 8, 125, x + 3, 9, 128, KIT.trim);
      p.put(x + 1, 9, 126, x + 2, 11, 127, KIT.stone);
    }
    p.put(3, 6, 116, 8, 14, 122, MAT.leaf);
    p.put(4, 14, 117, 7, 20, 121, MAT.leaf);
    p.put(5, 20, 118, 6, 23, 120, MAT.leaf);
  } else {
    picket(p, 0, 27, 127);
    picket(p, 47, 64, 127);
  }
  bed(p, 1, 9, 124, 126, MAT.petal);
  if (level < 3) bed(p, 53, 63, 116, 124, MAT.blueFlower);
  rose(p, 11, 14, 124, 30);
  if (level === 1) patch(p, 14, 46, 50, 64);
  if (level === 2) patch(p, 50, 62, 46, 68);
  // The clipped box shrub that has stood by the west corner since the hut.
  p.put(2, 0, 115, 9, 1, 123, MAT.earth);
  p.put(3, 1, 116, 8, 4, 122, MAT.leaf);
  p.put(4, 4, 117, 7, 6, 121, MAT.leaf);

  const rooms: (readonly [number, number, number])[] = [[30, 2, 96], [56, 2, 86]];
  if (level >= 2) rooms.push([30, 2, 56]);
  if (level >= 3) rooms.push([30, 2, 32]);
  if (level >= 4) rooms.push([51, 2, 14]);
  return { blueprint: p.blueprint(), entrance, exits, rooms, supports };
}
