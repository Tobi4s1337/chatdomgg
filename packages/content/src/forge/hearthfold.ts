import type { ForgePieceDefinition } from '@chatdom/shared';
import { MAT, STYLES } from '../materials';
import { COMMON, Shape, connector, definePiece, space, type ForgeForm, type ForgeProfile } from './grammar';

/**
 * Hearthfold: broad steep terracotta gables over plaster panels set one cell back between stout timber posts, on a
 * limestone foot. Every piece faces +Z (its exterior) in local cells; see the README for how they turn and join.
 */
const K = STYLES.hearth;
const STYLE = K.id;
const { bay: BAY, wallHeight: H, wallThickness: T } = COMMON;

/** Finite authored measures. The roof is a 3-up/2-across course roof over a two-bay (32-cell) span. */
export const HEARTHFOLD = {
  cornerArm: 8,
  plinth: 4,
  plate: 22,
  roof: { rise: 3, run: 2, slab: 5, courses: 10, halfSpan: 16, overhang: 4, seat: 6, ridgeBase: 29, verge: 2 },
  window: { width: 8, height: 10, centre: [8, 13, 2] as const },
  door: { opening: [2, 14] as const, height: 20, hinge: [2, 0, 0] as const },
} as const;
const R = HEARTHFOLD.roof;
/** Underside of roof course j, counted from the eave (j = 0) to the crest (j = 9), in slope-local cells. */
const under = (j: number) => R.rise * j;
const id = (form: ForgeForm | 'door-leaf') => `forge-hearthfold-${form}`;

const P = {
  wallSide: 'hearthfold-wall-side', wallFoot: 'hearthfold-wall-foot', wallHead: 'hearthfold-wall-head',
  floorEdge: 'hearthfold-floor-edge', roofSection: 'hearthfold-roof-section', ridgeSeat: 'hearthfold-ridge-seat',
  ridgeSection: 'hearthfold-ridge-section', gableApex: 'hearthfold-gable-apex',
} as const;

/** The whole mating cross-section of each profile (see ForgeProfile for the reading frame). */
export const HEARTHFOLD_PROFILES: readonly ForgeProfile[] = [
  { id: P.wallSide, chiral: false, summary: 'Vertical end of a 4-thick, 24-tall wall run, point at foot centreline. Limestone foot and wall plate are solid across all four cells; the two middle cells are solid full height. The outer skin cell may be a post or a set-back panel.',
    section: [{ u: [-2, 2], v: [0, 4] }, { u: [-1, 1], v: [4, 22] }, { u: [-2, 2], v: [22, 24] }] },
  { id: P.wallFoot, chiral: false, summary: 'A wall post foot standing on a floor top, 2×2 under the post plinth, inset two cells from the floor edge.', section: [{ u: [-1, 1], v: [-1, 1] }] },
  { id: P.wallHead, chiral: false, summary: 'Wall plate top at a bay joint or corner arm end, 4×4 across the wall thickness. Roof slopes and gables bear here.', section: [{ u: [-2, 2], v: [-2, 2] }] },
  { id: P.floorEdge, chiral: false, summary: 'Full 16-wide, 2-tall floor tile edge, point at the bottom centre.', section: [{ u: [-8, 8], v: [0, 2] }] },
  { id: P.roofSection, chiral: true, summary: 'The stepped slab end of a roof slope: ten 2-across courses rising 3, each 5 tall, read from the eave tip bottom toward the crest.',
    section: Array.from({ length: R.courses }, (_, j) => ({ u: [R.run * j, R.run * j + R.run] as const, v: [under(j), under(j) + R.slab] as const })) },
  { id: P.ridgeSeat, chiral: false, summary: 'Crest of two meeting slopes and the ridge roll bearing on it, 4×4 about the crest line.', section: [{ u: [-2, 2], v: [-2, 2] }] },
  { id: P.ridgeSection, chiral: false, summary: 'Ridge roll end: a 4-wide roll over the crest, rounded to 2 at its top, with 2-wide saddles down each slope.',
    section: [{ u: [-4, -2], v: [0, 4] }, { u: [2, 4], v: [0, 4] }, { u: [-2, 2], v: [3, 6] }, { u: [-1, 1], v: [6, 7] }] },
  { id: P.gableApex, chiral: false, summary: 'Gable apex under the crest underside, 4×4 across the gable thickness.', section: [{ u: [-2, 2], v: [-2, 2] }] },
];

/** Limestone foot, panel set back one cell from the face, a one-cell post at each end and the wall plate. */
function bay(s: Shape): Shape {
  return s.box(0, 0, 0, BAY, 4, T, K.stone)
    .box(1, 4, 0, 15, 22, T - 1, K.wall)
    .box(0, 4, 0, 1, 22, T, K.trim).box(15, 4, 0, 16, 22, T, K.trim)
    .box(0, 22, 0, BAY, H, T, K.trim);
}

const bayConnectors = () => [
  connector('west', P.wallSide, [0, 0, 2], 'west'), connector('east', P.wallSide, [BAY, 0, 2], 'east'),
  connector('foot-west', P.wallFoot, [1, 0, 2], 'down'), connector('foot-east', P.wallFoot, [15, 0, 2], 'down'),
  connector('head-west', P.wallHead, [0, H, 2], 'up'), connector('head-east', P.wallHead, [BAY, H, 2], 'up'),
];

function floor(): ForgePieceDefinition {
  // Limestone bed with a one-cell flag border; the boards inside it are the walking surface at y = 2.
  const s = new Shape(id('floor'), [BAY, 2, BAY]).box(0, 0, 0, BAY, 2, BAY, K.stone).box(1, 1, 1, 15, 2, 15, K.trim);
  const seats = [[7, 14], [9, 14], [7, 2], [9, 2], [2, 7], [2, 9], [14, 7], [14, 9]] as const;
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'floor', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('south', P.floorEdge, [8, 0, BAY], 'south'), connector('east', P.floorEdge, [BAY, 0, 8], 'east'),
    connector('north', P.floorEdge, [8, 0, 0], 'north'), connector('west', P.floorEdge, [0, 0, 8], 'west'),
    ...seats.map(([x, z]) => connector(`seat-${x}-${z}`, P.wallFoot, [x, 2, z], 'up')),
  ] });
}

function wall(): ForgePieceDefinition {
  const s = bay(new Shape(id('wall'), [BAY, H, T]));
  // Stepped knee brackets under the plate, proud of the panel like the posts they brace.
  for (const [x, y] of [[1, 19], [2, 20], [3, 21]] as const) s.box(x, y, 3, x + 1, 22, 4, K.trim).box(15 - x, y, 3, 16 - x, 22, 4, K.trim);
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'wall', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: bayConnectors() });
}

function corner(): ForgePieceDefinition {
  // An L of two 8-cell arms: the south arm runs x 0..8 at z 4..8, the west arm z 0..8 at x 0..4. Both panels sit
  // one cell back from their faces around a 2×2 corner post.
  const s = new Shape(id('wall-corner'), [8, H, 8])
    .box(0, 0, 4, 8, 4, 8, K.stone).box(0, 0, 0, 4, 4, 4, K.stone)
    .box(0, 4, 4, 8, 22, 7, K.wall).box(1, 4, 0, 4, 22, 7, K.wall)
    .box(0, 4, 6, 2, 22, 8, K.trim)
    .box(0, 22, 4, 8, H, 8, K.trim).box(0, 22, 0, 4, H, 4, K.trim);
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'wall', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('east', P.wallSide, [8, 0, 6], 'east'), connector('north', P.wallSide, [2, 0, 0], 'north'),
    connector('foot-east', P.wallFoot, [7, 0, 6], 'down'), connector('foot-north', P.wallFoot, [2, 0, 1], 'down'),
    connector('head-east', P.wallHead, [8, H, 6], 'up'), connector('head-north', P.wallHead, [2, H, 0], 'up'),
  ] });
}

function window(): ForgePieceDefinition {
  const { width, height, centre } = HEARTHFOLD.window;
  // One extra cell of depth carries the limestone sill past the face; the joints stay 4 thick.
  const s = bay(new Shape(id('window'), [BAY, H, T + 1]))
    .box(2, 19, 0, 14, 21, T, K.trim)
    .box(2, 6, 0, 14, 7, T + 1, K.stone)
    .air(3, 7, 0, 13, 19, T)
    .box(3, 7, 1, 13, 19, 2, K.trim)
    .box(4, 8, 1, 12, 18, 2, MAT.glass)
    .box(7, 8, 1, 9, 18, 2, K.trim).box(4, 12, 1, 12, 13, 2, K.trim);
  const x0 = centre[0] - width / 2, y0 = centre[1] - height / 2;
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'window', connectors: bayConnectors(),
    blueprint: s.blueprint(STYLE, [{ id: 'glass', centre: [...centre], width, height, facing: 'south' }]),
    // The deep reveal and four cells past the face stay open across the whole light rectangle.
    clearanceBoxes: [space([x0, y0, centre[2]], [x0 + width, y0 + height, T + 4])] });
}

function leaf() {
  // Closed pose in the frame's cells: one board-thick leaf against the inner face, behind a three-cell reveal.
  return new Shape(id('door-leaf'), [BAY, H, T])
    .box(2, 0, 0, 14, 20, 1, K.trim)
    .box(2, 4, 0, 10, 5, 1, MAT.brass).box(2, 15, 0, 10, 16, 1, MAT.brass)
    .box(11, 9, 0, 12, 11, 1, MAT.brass)
    .blueprint(STYLE);
}

function door(): ForgePieceDefinition {
  const [x0, x1] = HEARTHFOLD.door.opening, h = HEARTHFOLD.door.height;
  // A timber door frame under a limestone lintel that answers the foot.
  const s = bay(new Shape(id('door'), [BAY, H, T]))
    .box(1, 4, 0, 2, 20, T, K.trim).box(14, 4, 0, 15, 20, T, K.trim)
    .box(1, 20, 0, 15, 22, T, K.stone)
    .air(x0, 0, 0, x1, h, T)
    // A one-cell rebate in the latch post's inner face lets the leaf's corner clear it; the rest of the post is the stop.
    .air(x1, 0, 0, x1 + 1, h, 1);
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'door', blueprint: s.blueprint(STYLE), connectors: bayConnectors(),
    // Swing reservation for the 12×1 leaf turning inward about its hinge (radius just over 12 cells).
    clearanceBoxes: [space([x0, 0, -13], [x1 + 1, h, 1])],
    door: { leaf: leaf(), hinge: [...HEARTHFOLD.door.hinge], openQuarterTurns: 1, passage: space([x0 + 1, 0, -12], [x1, h, T]), threshold: [8, 0, 2] } });
}

function slope(): ForgePieceDefinition {
  // Local z 0 is the crest plane, z 16 the wall face, z 20 the eave tip. y 6 bears on the wall head.
  const depth = R.halfSpan + R.overhang;
  const s = new Shape(id('roof-slope'), [BAY, under(R.courses - 1) + R.slab, depth]);
  for (let j = 0; j < R.courses; j++) {
    const z1 = depth - R.run * j, u = under(j);
    // Timber sarking under three courses of terracotta: only the underside and eave soffit show the boards.
    s.box(0, u, z1 - R.run, BAY, u + 2, z1, K.trim).box(0, u + 2, z1 - R.run, BAY, u + R.slab, z1, K.roof);
  }
  s.box(0, R.seat, 12, BAY, R.seat + 3, 14, K.trim);
  for (const x of [1, 5, 9, 13]) s.box(x, 1, 16, x + 2, 3, 18, K.trim);
  const crest = under(R.courses - 1) + R.slab;
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'roof', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('west', P.roofSection, [0, 0, depth], 'west'), connector('east', P.roofSection, [BAY, 0, depth], 'east'),
    connector('seat', P.wallHead, [8, R.seat, 14], 'down'), connector('crest', P.ridgeSeat, [8, crest, 0], 'up'),
    connector('gable-west', P.gableApex, [2, under(R.courses - 1), 0], 'down'), connector('gable-east', P.gableApex, [14, under(R.courses - 1), 0], 'down'),
  ] });
}

function ridge(): ForgePieceDefinition {
  // Base y 0 is three cells below the crest; saddles sit on the second course down, the roll on the crest.
  const s = new Shape(id('roof-ridge'), [BAY, 7, 8])
    .box(0, 0, 0, BAY, 4, 2, K.roof).box(0, 0, 6, BAY, 4, 8, K.roof)
    .box(0, 3, 2, BAY, 6, 6, K.roof).box(0, 6, 3, BAY, 7, 5, K.roof);
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'roof', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('west', P.ridgeSection, [0, 0, 4], 'west'), connector('east', P.ridgeSection, [BAY, 0, 4], 'east'),
    connector('seat', P.ridgeSeat, [8, 3, 4], 'down'),
  ] });
}

function gable(): ForgePieceDefinition {
  // Spans the 24 interior cells between the side walls (x = d + 12), standing on the end wall plates.
  const s = new Shape(id('roof-gable'), [24, under(R.courses - 1) - R.seat, T]);
  const step = (j: number) => ({ x0: R.run * (j - 4), x1: 24 - R.run * (j - 4), h: under(j) - R.seat });
  for (let j = 4; j < R.courses; j++) { const { x0, x1, h } = step(j); s.box(x0, 0, 0, x1, h, T - 1, K.wall); }
  // Hung terracotta tiles in the upper triangle, a collar beam below them, and a king post down to the sill beam.
  for (let j = 6; j < R.courses; j++) { const { x0, x1, h } = step(j); s.box(x0, 11, T - 1, x1, h, T, K.roof); }
  s.box(4, 9, T - 1, 20, 11, T, K.trim).box(11, 1, T - 1, 13, 9, T, K.trim).box(0, 0, 0, 24, 1, T, K.trim);
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'roof', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('foot-west', P.wallHead, [4, 0, 2], 'down'), connector('foot-east', P.wallHead, [20, 0, 2], 'down'),
    connector('apex', P.gableApex, [12, under(R.courses - 1) - R.seat, 2], 'up'),
  ] });
}

function verge(): ForgePieceDefinition {
  // Terracotta verge tiles across the whole roof end (x = d + 21), one cell proud of the slab above and below.
  const s = new Shape(id('roof-verge'), [42, 41, R.verge]);
  const band = (x0: number, x1: number, j: number) => s.box(x0, under(j), 0, x1, under(j) + R.slab + 2, R.verge, K.roof);
  for (let j = 0; j < R.courses; j++) band(39 - 2 * j, 41 - 2 * j, j).box(1 + 2 * j, under(j), 0, 3 + 2 * j, under(j) + R.slab + 2, R.verge, K.roof);
  band(41, 42, 0).box(0, 0, 0, 1, R.slab + 2, R.verge, K.roof);
  // The apex closes the ridge end and carries a small terracotta finial.
  s.box(17, 31, 0, 25, 35, R.verge, K.roof).box(19, 34, 0, 23, 38, R.verge, K.roof).box(20, 38, 0, 22, 41, R.verge, K.roof);
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'roof', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('slope-west', P.roofSection, [1, 1, 0], 'north'), connector('slope-east', P.roofSection, [41, 1, 0], 'north'),
    connector('ridge', P.ridgeSection, [21, R.ridgeBase + 1, 0], 'north'),
  ] });
}

export const HEARTHFOLD_PIECES: Partial<Record<ForgeForm, () => ForgePieceDefinition>> = {
  floor, wall, 'wall-corner': corner, door, window, 'roof-slope': slope, 'roof-ridge': ridge, 'roof-gable': gable, 'roof-verge': verge,
};
