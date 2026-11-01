import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { chimney, gableRoof, gableWall, north, south, east, west, valley, windowIn, type Gable } from '../../../homes/tide/grammar';
import { MAT, STYLES } from '../../../materials';
import { coursed, type Masonry } from '../../../places/water/millrace/craft';
import { hash } from '../../../places/water/shore/shape';
import type { AggmanPiece, Livery } from '../piece';
import { InnShell, archRows, quoins, voussoirs, weatherSlope, type Size } from './parts';
import { dressInn } from './dress';

/**
 * The Wren and Willow, the hamlet's harbour inn, kept by Rowan. A two-storey Tide house grown into a public
 * house: a coursed grey-stone ground floor on a dark plinth, a cream-rendered upper floor jettied out over a timber
 * bressumer, and a big slate roof whose front is broken by a tall cross gable over the door and one wall dormer.
 * The door sits deep in three stepped stone orders under a voussoired arch; the hanging sign, lanterns, awning,
 * bench, barrel table and cask stack belong to `dress.ts`. Front (+Z) faces the quay and the sea.
 *
 * Local frame: build cells, x right, y up, origin at the (0,0,0) corner, y = 0 the ground contact.
 */

export const INN_SIZE: Size = [116, 104, 92];

const STONE = STYLES.tide.stone, WALL = STYLES.tide.wall, ROOF = STYLES.tide.roof, TRIM = STYLES.tide.trim;
/** The coursing's tones: grey stone, salt-pale odd stones, a wet dark foot and moss in the shade. */
const MASONRY: Masonry = { stone: STONE, band: MAT.limestone, wet: MAT.darkStone, moss: MAT.moss };

/** The measured planes of the inn, shared by the factory, the dressing, the metadata and the tests. */
export const INN = {
  /** Ground floor stone walls (outer faces), four cells thick. */
  main: { x0: 8, x1: 104, z0: 24, z1: 68 },
  wall: 4,
  /** Stone to the bressumer, the bressumer (floor) band, and the wall plate the roof sits on. */
  ground: 28, jetty: 31, eaves: 47,
  /** The jettied upper front face of the main range. */
  upperFace: 70,
  /** The entrance wing under the cross gable: ground faces, then its jettied upper faces. */
  wing: { x0: 36, x1: 76, z1: 80, ux0: 34, ux1: 78, uz1: 82 },
  /** The single-storey back kitchen under its catslide. */
  outshot: { x0: 28, x1: 80, z0: 10, top: 22 },
  /** The door's axis, and its clear opening (threshold at y = 2, a slate step down to the ground in front). */
  door: { cx: 56, x: [51, 61] as const, y: [2, 22] as const, z: [76, 83] as const },
  /** The stone door surround standing proud of the wing front. */
  surround: { x: [44, 68] as const, z: [80, 83] as const },
  /** The west section's bow window and the east section's deep casement under the awning. */
  bow: { x: [14, 32] as const, y: [7, 21] as const, z: [68, 73] as const },
  eastWindow: { x: [82, 98] as const, y: [7, 21] as const },
  dormer: { x: [16, 30] as const },
} as const;

const M = INN.main, CX = INN.door.cx;

/** The main roof in three runs along the ridge: the west verge, a run that has settled a cell, and the rest. */
const ROOF_MAIN: Gable = { ridge: 'x', lo: M.z0 - 3, hi: INN.upperFace + 3, baseLo: INN.eaves, baseHi: INN.eaves, along: [4, 108] };
const ROOF_WEST: Gable = { ...ROOF_MAIN, along: [4, 12] };
const ROOF_SAG: Gable = { ...ROOF_MAIN, baseLo: INN.eaves - 1, baseHi: INN.eaves - 1, along: [12, 33] };
const ROOF_EAST: Gable = { ...ROOF_MAIN, along: [33, 108] };
/** The cross gable: its courses run back until they die into the main front slope in a valley. */
const ROOF_WING: Gable = { ridge: 'z', lo: INN.wing.ux0 - 3, hi: INN.wing.ux1 + 3, baseLo: INN.eaves, baseHi: INN.eaves, along: y => [valley(ROOF_EAST, 'hi')(y), INN.wing.uz1 + 4] };
/** The wall dormer over the bow window, set on the settled run. */
const ROOF_DORMER: Gable = { ridge: 'z', lo: INN.dormer.x[0] - 2, hi: INN.dormer.x[1] + 2, baseLo: 55, baseHi: 55, along: y => [valley(ROOF_SAG, 'hi')(y), INN.upperFace + 2] };

export { ROOF_EAST, ROOF_SAG, ROOF_WEST, ROOF_WING, ROOF_DORMER };

export function createHarbourInn(livery: Livery): AggmanPiece {
  const s = new InnShell(INN_SIZE);
  masonryBody(s);
  upperBody(s);
  hollow(s);
  entrance(s);
  ground(s);
  upper(s);
  quoinsAll(s);
  roofs(s);
  stacks(s);
  const { lanterns } = dressInn(s, livery);
  const blueprint: VoxelBlueprint = {
    version: 1, id: 'genesis-aggman-harbour-inn', styleId: STYLES.tide.id, kind: 'civic', lattice: 'build',
    size: [...INN_SIZE], boxes: s.boxes, windows: s.windows,
  };
  return { blueprint, lanterns, footprint: { from: [0, 7], to: [114, 88] } };
}

// ── Stone ground floor ────────────────────────────────────────────────────────────────────────────────────────────

function masonryBody(s: InnShell): void {
  const { wing, outshot: o } = INN;
  // A dark projecting base course under every wall.
  s.put(MAT.darkStone, M.x0 - 1, 0, M.z0 - 1, M.x1 + 1, 4, M.z1 + 1);
  s.put(MAT.darkStone, wing.x0 - 1, 0, M.z1, wing.x1 + 1, 4, wing.z1 + 1);
  s.put(MAT.darkStone, o.x0 - 1, 0, o.z0 - 1, o.x1 + 1, 4, M.z0);
  s.put(STONE, M.x0, 0, M.z0, M.x1, INN.ground, M.z1);
  s.put(STONE, wing.x0, 0, M.z1, wing.x1, INN.ground, wing.z1);
  s.put(STONE, o.x0, 0, o.z0, o.x1, o.top, M.z0);
  // The base course is washed by spray on the sea front and mossed along the shaded back.
  s.put(MAT.moss, M.x0 - 1, 3, M.z0 - 1, o.x0 - 1, 4, M.z0);
  s.put(MAT.moss, o.x1 + 1, 3, M.z0 - 1, M.x1 + 1, 4, M.z0);
  s.put(MAT.moss, o.x0 - 1, 3, o.z0 - 1, o.x1 + 1, 4, o.z0);

  // Coursed faces: half-metre courses, staggered joints, salt-pale odd stones, moss low on the shaded walls.
  const faces = [
    { normal: 'z', layer: M.z1 - 1, span: [M.x0, wing.x0], seed: 11, top: INN.ground },
    { normal: 'z', layer: M.z1 - 1, span: [wing.x1, M.x1], seed: 12, top: INN.ground },
    { normal: 'z', layer: wing.z1 - 1, span: [wing.x0, wing.x1], seed: 13, top: INN.ground },
    { normal: 'x', layer: wing.x0, span: [M.z1, wing.z1], seed: 14, top: INN.ground },
    { normal: 'x', layer: wing.x1 - 1, span: [M.z1, wing.z1], seed: 15, top: INN.ground },
    { normal: 'x', layer: M.x0, span: [M.z0, M.z1], seed: 16, top: INN.ground, mossTo: 12 },
    { normal: 'x', layer: M.x1 - 1, span: [M.z0, M.z1], seed: 17, top: INN.ground },
    { normal: 'z', layer: M.z0, span: [M.x0, M.x1], seed: 18, top: INN.ground, mossTo: 12 },
    { normal: 'z', layer: o.z0, span: [o.x0, o.x1], seed: 19, top: o.top, mossTo: 12 },
    { normal: 'x', layer: o.x0, span: [o.z0, M.z0], seed: 20, top: o.top, mossTo: 12 },
    { normal: 'x', layer: o.x1 - 1, span: [o.z0, M.z0], seed: 21, top: o.top, mossTo: 12 },
  ] as const;
  for (const { top, span, ...f } of faces) coursed(s, { ...f, span: [span[0], span[1]], y: [4, top] }, MASONRY);
}

// ── Timber bressumer and the rendered upper floor ────────────────────────────────────────────────────────────────

function upperBody(s: InnShell): void {
  const { wing } = INN;
  // The floor band: flush timber on the ends and back, jettied three cells over the front and the wing.
  s.put(TRIM, M.x0, INN.ground, M.z0, M.x1, INN.jetty, INN.upperFace + 1);
  s.put(TRIM, wing.x0 - 3, INN.ground, M.z1, wing.x1 + 3, INN.jetty, wing.z1 + 3);
  s.put(WALL, M.x0, INN.jetty, M.z0, M.x1, INN.eaves, INN.upperFace);
  s.put(WALL, wing.ux0, INN.jetty, M.z1, wing.ux1, INN.eaves, wing.uz1);
  // Joist ends and corbels in the jetty's shadow at the corners.
  for (const x of [M.x0 + 1, M.x1 - 3]) s.put(TRIM, x, INN.ground - 3, M.z1, x + 2, INN.ground, M.z1 + 2);
  for (const x of [wing.x0, wing.x1 - 2]) s.put(TRIM, x, INN.ground - 3, wing.z1, x + 2, INN.ground, wing.z1 + 2);
  for (const x of [wing.x0 - 2, wing.x1]) s.put(TRIM, x, INN.ground - 3, wing.z1 - 4, x + 2, INN.ground, wing.z1);
  // The wall plate under the eaves, one cell proud.
  s.put(TRIM, M.x0, INN.eaves - 2, INN.upperFace, wing.ux0, INN.eaves, INN.upperFace + 1);
  s.put(TRIM, wing.ux1, INN.eaves - 2, INN.upperFace, M.x1, INN.eaves, INN.upperFace + 1);
  s.put(TRIM, wing.ux0 - 1, INN.eaves - 2, M.z1 + 2, wing.ux0, INN.eaves, wing.uz1);
  s.put(TRIM, wing.ux1, INN.eaves - 2, M.z1 + 2, wing.ux1 + 1, INN.eaves, wing.uz1);
}

// ── Rooms: the taproom through the door, the upper rooms, the back kitchen ───────────────────────────────────────

function hollow(s: InnShell): void {
  const { wing, outshot: o, wall } = INN;
  s.air(M.x0 + wall, 2, M.z0 + wall, M.x1 - wall, INN.ground, M.z1 - wall);
  s.air(wing.x0 + wall, 2, M.z1 - wall, wing.x1 - wall, INN.ground, wing.z1 - wall);
  s.air(o.x0 + wall, 2, o.z0 + wall, o.x1 - wall, o.top, M.z0 + wall);
  s.put(TRIM, M.x0 + wall, 1, M.z0 + wall, M.x1 - wall, 2, M.z1 - wall);
  s.put(TRIM, wing.x0 + wall, 1, M.z1 - wall, wing.x1 - wall, 2, wing.z1 - wall);
  s.put(STONE, o.x0 + wall, 1, o.z0 + wall, o.x1 - wall, 2, M.z0);
  s.air(M.x0 + wall, INN.jetty, M.z0 + wall, M.x1 - wall, INN.eaves, INN.upperFace - wall);
  s.air(wing.ux0 + wall, INN.jetty, M.z1 - 4, wing.ux1 - wall, INN.eaves, wing.uz1 - wall);
  // The taproom: a hearth in the west wall under its stack, a long counter facing the door, casks racked behind it.
  s.air(M.x0 + 1, 2, 42, M.x0 + wall, 13, 50);
  s.put(STONE, M.x0 + wall, 1, 39, M.x0 + wall + 4, 2, 53);
  s.put(TRIM, M.x0 + wall, 13, 39, M.x0 + wall + 2, 15, 53);
  s.put(TRIM, 44, 2, 38, 68, 11, 42);
  s.put(MAT.bark, 43, 11, 37, 69, 12, 43);
  for (const x of [46, 54, 62]) {
    s.put(TRIM, x, 2, M.z0 + wall, x + 6, 8, M.z0 + wall + 6);
    s.put(MAT.darkStone, x, 4, M.z0 + wall, x + 6, 5, M.z0 + wall + 6);
    s.put(MAT.bark, x + 1, 3, M.z0 + wall + 6, x + 5, 7, M.z0 + wall + 7);
  }
}

// ── The entrance: three stepped orders under a voussoired arch, deep in a dressed surround ──────────────────────────

function entrance(s: InnShell): void {
  const { surround, wing, door } = INN;
  s.put(STONE, surround.x[0], 0, surround.z[0], surround.x[1], INN.ground, surround.z[1]);
  // Jambs: dressed stones, long and short, the pale ones salt-bleached.
  for (let y = 0, k = 0; y < 20; y += 4, k++) {
    const reach = k % 2 ? 2 : 3;
    s.pair(2 * CX, surround.x[0], y, surround.z[1] - 1, surround.x[0] + reach, y + 4, surround.z[1], MAT.limestone);
    s.pair(2 * CX, surround.x[0], y, surround.z[0], surround.x[0] + 1, y + 4, surround.z[1], k % 2 ? STONE : MAT.limestone);
  }
  // The voussoirs, alternately pale and grey, with a proud keystone at the crown.
  for (const [x, y, sector] of voussoirs(CX, 9, 20, 6, 3, 11)) {
    if (y >= INN.ground) continue;
    s.put(sector % 2 ? STONE : MAT.limestone, x, y, surround.z[1] - 1, x + 1, y + 1, surround.z[1]);
    if (sector === 5) s.put(MAT.limestone, x, y, surround.z[1], x + 1, y + 1, surround.z[1] + 1);
  }
  // The three orders, each a step deeper and narrower; the innermost is the door itself.
  for (const [y, x0, x1] of archRows(CX, 9, 2, 20, 6)) s.air(x0, y, surround.z[1] - 1, x1, y + 1, surround.z[1]);
  for (const [y, x0, x1] of archRows(CX, 7, 2, 21, 5)) s.air(x0, y, surround.z[0], x1, y + 1, surround.z[1] - 1);
  for (const [y, x0, x1] of archRows(CX, 5, 2, 22, 3)) s.air(x0, y, wing.z1 - INN.wall, x1, y + 1, wing.z1);
  // The threshold: one worn stone through all three orders, flush with the boards inside.
  s.put(STONE, door.x[0], 0, door.z[0], door.x[1], 2, door.z[1]);
  s.put(MAT.limestone, door.x[0] + 2, 1, door.z[1] - 2, door.x[1] - 2, 2, door.z[1]);
}

// ── Ground floor openings ─────────────────────────────────────────────────────────────────────────────────────────

function ground(s: InnShell): void {
  const { eastWindow: ew, wing, wall, outshot: o } = INN;
  bowWindow(s);
  windowIn(s, south(M.z1), { id: 'taproom-east', u: ew.x[0], y: ew.y[0], w: ew.x[1] - ew.x[0], h: ew.y[1] - ew.y[0], wall, recess: 2, mullion: true, transom: 15, sill: MAT.limestone, head: MAT.limestone });
  // Extra glazing bars, so the casement reads as many small panes of old glass.
  for (const x of [85, 94]) s.put(TRIM, x, ew.y[0], M.z1 - 3, x + 1, ew.y[1], M.z1 - 2);
  s.put(TRIM, ew.x[0], 11, M.z1 - 3, ew.x[1], 12, M.z1 - 2);
  windowIn(s, west(wing.x0), { id: 'porch-west', u: 70, y: 8, w: 4, h: 10, wall, recess: 1, sill: MAT.limestone, head: MAT.limestone });
  windowIn(s, east(wing.x1), { id: 'porch-east', u: 70, y: 8, w: 4, h: 10, wall, recess: 1, sill: MAT.limestone, head: MAT.limestone });
  for (const [id, u] of [['west-rear', 30], ['west-front', 56]] as const) windowIn(s, west(M.x0), { id, u, y: 8, w: 6, h: 10, wall, recess: 1, sill: MAT.limestone, head: MAT.limestone });
  windowIn(s, east(M.x1), { id: 'east-ground', u: 30, y: 8, w: 10, h: 12, wall, recess: 1, mullion: true, sill: MAT.limestone, head: MAT.limestone });
  windowIn(s, north(M.z0), { id: 'rear-west', u: 14, y: 8, w: 8, h: 12, wall, recess: 1, sill: MAT.limestone, head: MAT.limestone });
  windowIn(s, north(M.z0), { id: 'rear-east', u: 90, y: 8, w: 8, h: 12, wall, recess: 1, sill: MAT.limestone, head: MAT.limestone });
  windowIn(s, north(o.z0), { id: 'kitchen-west', u: 34, y: 6, w: 8, h: 10, wall, recess: 1, sill: MAT.limestone });
  windowIn(s, north(o.z0), { id: 'kitchen-east', u: 66, y: 6, w: 8, h: 10, wall, recess: 1, sill: MAT.limestone });
  // The back door: a closed ledged door of boards under a timber lintel, two strap hinges and a step.
  s.air(49, 2, o.z0, 59, 20, o.z0 + wall);
  s.put(TRIM, 47, 20, o.z0 - 1, 61, 22, o.z0 + 2);
  s.put(TRIM, 49, 2, o.z0 + 2, 59, 20, o.z0 + 3);
  for (const x of [51, 54, 57]) s.put(MAT.bark, x, 2, o.z0 + 1, x + 1, 20, o.z0 + 2);
  for (const y of [5, 15]) s.put(MAT.darkStone, 49, y, o.z0 + 1, 57, y + 1, o.z0 + 2);
  s.put(STONE, 49, 0, o.z0, 59, 2, o.z0 + wall);
  s.put(MAT.slate, 48, 0, o.z0 - 3, 60, 1, o.z0);
}

/**
 * The bow window on the west section: a timber bay on a stone apron, glazed in small panes on its front and both
 * cheeks, under its own little slate hood tucked beneath the jetty.
 */
function bowWindow(s: InnShell): void {
  const { x: [x0, x1], y: [y0, y1], z: [, z1] } = INN.bow;
  // Open the wall into the bay, then build the apron, posts, head and hood.
  s.air(x0 + 2, y0, M.z1 - INN.wall, x1 - 2, y1, M.z1);
  s.put(STONE, x0, 0, M.z1, x1, y0 - 1, z1);
  s.put(MAT.limestone, x0 - 1, y0 - 1, M.z1, x1 + 1, y0, z1 + 1);
  s.put(TRIM, x0, y1, M.z1, x1, y1 + 2, z1);
  for (const x of [x0, x1 - 2]) s.put(TRIM, x, y0, z1 - 2, x + 2, y1, z1);
  for (const x of [x0, x1 - 1]) s.put(TRIM, x, y0, M.z1, x + 1, y1, M.z1 + 1);
  s.put(MAT.glass, x0 + 2, y0, z1 - 2, x1 - 2, y1, z1 - 1);
  for (const x of [x0 + 6, x1 - 7]) s.put(TRIM, x, y0, z1 - 2, x + 1, y1, z1 - 1);
  for (const y of [11, 16]) s.put(TRIM, x0 + 2, y, z1 - 2, x1 - 2, y + 1, z1 - 1);
  s.put(MAT.glass, x0, y0, M.z1 + 1, x0 + 1, y1, z1 - 2);
  s.put(MAT.glass, x1 - 1, y0, M.z1 + 1, x1, y1, z1 - 2);
  for (const x of [x0, x1 - 1]) s.put(TRIM, x, 14, M.z1 + 1, x + 1, 15, z1 - 2);
  // The hood: three slate courses stepping back to the wall under the bressumer.
  s.put(ROOF, x0 - 1, y1 + 2, M.z1, x1 + 1, y1 + 3, z1 + 2);
  s.put(ROOF, x0, y1 + 3, M.z1, x1, y1 + 4, z1);
  s.put(ROOF, x0 + 1, y1 + 4, M.z1, x1 - 1, INN.ground, z1 - 2);
  const front = z1 - 1;
  s.windows.push({ id: 'bow-front', centre: [(x0 + x1) / 2, (y0 + y1) / 2, front], width: x1 - x0 - 4, height: y1 - y0, facing: 'south' });
  s.windows.push({ id: 'bow-west', centre: [x0, (y0 + y1) / 2, M.z1 + 2], width: 2, height: y1 - y0, facing: 'west' });
  s.windows.push({ id: 'bow-east', centre: [x1, (y0 + y1) / 2, M.z1 + 2], width: 2, height: y1 - y0, facing: 'east' });
}

// ── Upper floor openings ──────────────────────────────────────────────────────────────────────────────────────────

function upper(s: InnShell): void {
  const { wing, wall, upperFace } = INN;
  windowIn(s, south(upperFace), { id: 'upper-west', u: 18, y: 34, w: 10, h: 10, wall, recess: 1, mullion: true });
  windowIn(s, south(upperFace), { id: 'upper-east', u: 84, y: 34, w: 10, h: 10, wall, recess: 1, mullion: true });
  windowIn(s, south(wing.uz1), { id: 'wing-west', u: 40, y: 34, w: 6, h: 10, wall, recess: 1 });
  windowIn(s, south(wing.uz1), { id: 'wing-east', u: 66, y: 34, w: 6, h: 10, wall, recess: 1 });
  for (const [id, u] of [['west-upper-rear', 30], ['west-upper-front', 56]] as const) windowIn(s, west(M.x0), { id, u, y: 34, w: 6, h: 10, wall, recess: 1, sill: MAT.limestone });
  windowIn(s, east(M.x1), { id: 'east-upper', u: 30, y: 34, w: 10, h: 10, wall, recess: 1, mullion: true, sill: MAT.limestone });
  windowIn(s, north(M.z0), { id: 'rear-upper-west', u: 14, y: 34, w: 10, h: 10, wall, recess: 1, mullion: true, sill: MAT.limestone });
  windowIn(s, north(M.z0), { id: 'rear-upper-east', u: 88, y: 34, w: 10, h: 10, wall, recess: 1, mullion: true, sill: MAT.limestone });
  windowIn(s, north(M.z0), { id: 'rear-upper', u: 49, y: 36, w: 10, h: 8, wall, recess: 1, mullion: true });
}

function quoinsAll(s: InnShell): void {
  const { wing, outshot: o, ground: g, jetty, eaves, upperFace } = INN;
  // Pale stones on the grey ground floor; grey stones on the cream above.
  quoins(s, MAT.limestone, M.x0, M.z1, 1, -1, 4, g);
  quoins(s, MAT.limestone, M.x1, M.z1, -1, -1, 4, g);
  quoins(s, MAT.limestone, M.x0, M.z0, 1, 1, 4, g);
  quoins(s, MAT.limestone, M.x1, M.z0, -1, 1, 4, g);
  quoins(s, MAT.limestone, wing.x0, wing.z1, 1, -1, 4, g);
  quoins(s, MAT.limestone, wing.x1, wing.z1, -1, -1, 4, g);
  quoins(s, MAT.limestone, o.x0, o.z0, 1, 1, 4, o.top);
  quoins(s, MAT.limestone, o.x1, o.z0, -1, 1, 4, o.top);
  quoins(s, STONE, M.x0, upperFace, 1, -1, jetty, eaves);
  quoins(s, STONE, M.x1, upperFace, -1, -1, jetty, eaves);
  quoins(s, STONE, M.x0, M.z0, 1, 1, jetty, eaves);
  quoins(s, STONE, M.x1, M.z0, -1, 1, jetty, eaves);
  quoins(s, STONE, wing.ux0, wing.uz1, 1, -1, jetty, eaves);
  quoins(s, STONE, wing.ux1, wing.uz1, -1, -1, jetty, eaves);
}

// ── Roofs ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Sea-facing slates: the odd darker slate, salt-weathered. */
const seaSlates = (r: number) => (r > 0.9 ? MAT.darkStone : undefined);
/** The shaded back: moss gathers in the lowest courses, with the odd dark slate higher up. */
const backSlates = (r: number, k: number) => (k < 4 && r < 0.22 - k * 0.04 ? MAT.moss : r > 0.9 ? MAT.darkStone : undefined);

function roofs(s: InnShell): void {
  const { wing, outshot: o, eaves, upperFace } = INN;
  // The gable ends of the main range, and the cross gable's front, filled up under their courses.
  gableWall(s, ROOF_MAIN, eaves, M.z0, upperFace, M.x0, M.x0 + INN.wall);
  gableWall(s, ROOF_MAIN, eaves, M.z0, upperFace, M.x1 - INN.wall, M.x1);
  gableWall(s, ROOF_WING, eaves, wing.ux0, wing.ux1, wing.uz1 - INN.wall, wing.uz1);
  // Gable lights go in before the courses, so the slates close over their heads.
  windowIn(s, south(wing.uz1), { id: 'gable', u: 50, y: 52, w: 12, h: 12, wall: INN.wall, recess: 1, mullion: true, transom: 59, sill: MAT.limestone, head: MAT.limestone });
  windowIn(s, east(M.x1), { id: 'east-gable', u: 54, y: 50, w: 6, h: 8, wall: INN.wall, recess: 1, sill: MAT.limestone });

  // The back kitchen's catslide: courses two cells tall stepping three in, lapped under the main eave.
  for (let k = 0, z = o.z0 - 3; z < M.z0; k++, z += 3) {
    const y = o.top + 2 * k;
    for (const x of [o.x0, o.x1 - INN.wall]) s.put(STONE, x, y, Math.max(o.z0, z), x + INN.wall, y + 2, M.z0);
  }
  for (let k = 0, z = o.z0 - 3; z < M.z0; k++, z += 3) {
    const y = o.top + 2 * k;
    s.put(ROOF, o.x0 - 3, y, z, o.x1 + 3, y + 2, Math.min(z + 5, M.z0 + 4));
    for (const x of [o.x0 - 3, o.x1 + 2]) s.put(TRIM, x, y, z, x + 1, y + 1, Math.min(z + 5, M.z0));
    for (let x = o.x0 - 3, i = 0; x < o.x1 + 3; i++) {
      const len = 3 + Math.floor(hash(31, k, i) * 4), r = hash(31, k, i, 1), x1 = Math.min(x + len, o.x1 + 3);
      const m = k < 3 && r < 0.3 ? MAT.moss : r > 0.88 ? MAT.darkStone : undefined;
      if (m !== undefined) s.put(m, x, y + 1, z, x1, y + 2, z + 3);
      x += len;
    }
  }

  const runs: [Gable, ('lo' | 'hi')[]][] = [[ROOF_WEST, ['lo']], [ROOF_SAG, []], [ROOF_EAST, ['hi']]];
  runs.forEach(([g, barge], i) => {
    gableRoof(s, g, { cap: MAT.darkStone, barge });
    weatherSlope(s, g, 'hi', 41 + i, seaSlates);
    weatherSlope(s, g, 'lo', 51 + i, backSlates);
  });
  // Joints between the ridge tiles.
  for (let x = 9; x < 106; x += 7) {
    const top = x >= 12 && x < 33 ? 83 : 84;
    s.air(x, top, 42, x + 1, top + 1, 52);
  }

  // The cross gable over the door, its verge deep enough to shade the gable window.
  gableRoof(s, ROOF_WING, { cap: MAT.darkStone, barge: ['hi'] });
  weatherSlope(s, ROOF_WING, 'lo', 61, seaSlates);
  weatherSlope(s, ROOF_WING, 'hi', 62, seaSlates);
  // A carved pendant hangs from the apex of the bargeboards.
  s.put(TRIM, CX - 1, 72, wing.uz1 + 2, CX + 1, 80, wing.uz1 + 4);
  s.put(MAT.bark, CX - 1, 69, wing.uz1 + 2, CX + 1, 72, wing.uz1 + 4);

  // The wall dormer: the eave is stopped either side, the face rises flush with the wall below.
  const [dx0, dx1] = INN.dormer.x;
  s.air(dx0, eaves - 1, upperFace, dx1, 60, upperFace + 4);
  s.put(WALL, dx0, eaves - 1, upperFace - 10, dx1, 56, upperFace);
  s.air(dx0 + 2, eaves, upperFace - 14, dx1 - 2, 55, upperFace - INN.wall);
  gableWall(s, ROOF_DORMER, 55, dx0, dx1, upperFace - INN.wall, upperFace);
  gableRoof(s, ROOF_DORMER, { cap: MAT.darkStone, barge: ['hi'] });
  windowIn(s, south(upperFace), { id: 'dormer', u: 20, y: 47, w: 6, h: 8, wall: INN.wall, recess: 1 });
}

// ── Chimneys ──────────────────────────────────────────────────────────────────────────────────────────────────────

function stacks(s: InnShell): void {
  // West: a broad breast built against the gable end, stepping in under slate weatherings, its stack carried up
  // through the verge with a crook, a corbelled cap and two clay pots of different heights.
  s.put(MAT.darkStone, 1, 0, 37, M.x0, 4, 55);
  s.put(STONE, 2, 4, 38, M.x0, 30, 54);
  coursed(s, { normal: 'x', layer: 2, span: [38, 54], y: [4, 30], seed: 71 }, MASONRY);
  s.put(ROOF, 1, 30, 37, M.x0, 31, 55);
  s.put(STONE, 3, 31, 40, M.x0, 56, 52);
  coursed(s, { normal: 'x', layer: 3, span: [40, 52], y: [31, 56], seed: 72 }, MASONRY);
  s.put(ROOF, 2, 56, 39, M.x0, 57, 53);
  s.put(STONE, 3, 57, 42, M.x0 + 1, 88, 50);
  coursed(s, { normal: 'x', layer: 3, span: [42, 50], y: [57, 88], seed: 73 }, MASONRY);
  s.put(STONE, 3, 88, 43, M.x0 + 1, 95, 51);
  s.put(MAT.limestone, 2, 95, 42, M.x0 + 2, 97, 52);
  s.put(ROOF, 2, 97, 42, M.x0 + 2, 98, 52);
  s.put(MAT.terracotta, 3, 98, 44, 6, 102, 47);
  s.put(MAT.terracotta, 5, 98, 47, 8, 101, 50);
  s.air(4, 99, 45, 5, 102, 46);
  s.air(6, 99, 48, 7, 101, 49);
  // East: the kitchen flue on the ridge, the Tide stack with its crook and corbelled cap.
  chimney(s, { x: 92, z: 44, w: 8, d: 8, base: INN.jetty, top: 90, lean: [-1, 0] });
}

/** Where the inn meets its quay, for the host's camera and placement. */
export const HARBOUR_INN_FRONT = {
  door: {
    /** The middle of the clear opening, halfway up and halfway through the wall. */
    centre: [CX, 12, 78] as Vec3,
    /** Clear opening, half-open build cells: 10 wide, 20 tall, through all three orders. */
    opening: { from: [INN.door.x[0], INN.door.y[0], INN.door.z[0]] as Vec3, to: [INN.door.x[1], INN.door.y[1], INN.door.z[1]] as Vec3 },
    /** Threshold surface height, one cell above the slate step, two above the ground. */
    threshold: INN.door.y[0],
    /** A standing cell on the ground in front of the slate step, facing the door. */
    approach: [CX, 0, 89] as Vec3,
    facing: 'south' as const,
  },
  /** The sign's blank face for the host's name treatment: its outward plane, facing the quay. */
  signFace: { centre: [CX, 32, 89] as Vec3, facing: 'south' as const, width: 18, height: 10 },
} as const;
