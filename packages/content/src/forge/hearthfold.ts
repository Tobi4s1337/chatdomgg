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
  /** Open shutter leaves lie flat on the wall face, 5 × 12 each, hinged at the reveal edges. */
  shutter: { leaf: 5, height: 12, mount: [8, 7, 4] as const },
  /** Doorstep: 16-wide terrace modules on the floor-tile grid, 10 deep plus a one-cell step 2 deep. */
  deck: { depth: 10, step: 2, kerb: 2, seats: [7, 9] as const, seatDepth: 7 },
  /** Porch post: 2 × 2 timber on a 4 × 4 limestone foot, 24 tall from the deck top to the hood. */
  post: { height: 24, beamSeat: 21 },
  /** Hood: a 20-wide gabled porch roof in the main roof's 3:2 courses, five a side, 10 deep plus a 2-deep verge. */
  hood: { width: 20, courses: 5, depth: 10, verge: 2, truss: 6 },
} as const;
const R = HEARTHFOLD.roof;
/** Underside of roof course j, counted from the eave (j = 0) to the crest (j = 9), in slope-local cells. */
const under = (j: number) => R.rise * j;
const id = (form: ForgeForm | 'door-leaf') => `forge-hearthfold-${form}`;

const P = {
  wallSide: 'hearthfold-wall-side', wallFoot: 'hearthfold-wall-foot', wallHead: 'hearthfold-wall-head',
  floorEdge: 'hearthfold-floor-edge', roofSection: 'hearthfold-roof-section', ridgeSeat: 'hearthfold-ridge-seat',
  ridgeSection: 'hearthfold-ridge-section', gableApex: 'hearthfold-gable-apex',
  shutterMount: 'hearthfold-shutter-mount', porchFoot: 'hearthfold-porch-foot', beamEnd: 'hearthfold-beam-end',
  porchHead: 'hearthfold-porch-head', beamTop: 'hearthfold-beam-top', canopyLedger: 'hearthfold-canopy-ledger',
  chimneySeat: 'hearthfold-chimney-seat',
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
  { id: P.shutterMount, chiral: false, summary: 'Open shutter leaves bearing on the window bay\'s two face posts, point at the bottom centre of the reveal on the face plane. Each strip is the post behind a leaf, 12 tall.',
    section: [{ u: [-8, -7], v: [0, 12] }, { u: [7, 8], v: [0, 12] }] },
  { id: P.porchFoot, chiral: false, summary: 'A porch post\'s 4×4 limestone foot standing on a deck top.', section: [{ u: [-2, 2], v: [-2, 2] }] },
  { id: P.beamEnd, chiral: false, summary: 'A 2-deep, 3-tall beam framed into a post face, point at the bottom centre of the beam end.', section: [{ u: [-1, 1], v: [0, 3] }] },
  { id: P.porchHead, chiral: false, summary: 'A 2×2 post head carrying the porch hood\'s first course.', section: [{ u: [-1, 1], v: [-1, 1] }] },
  { id: P.beamTop, chiral: false, summary: 'Beam cap under the hood truss\'s king post and sole plate, 2×2 about the beam centre.', section: [{ u: [-1, 1], v: [-1, 1] }] },
  { id: P.canopyLedger, chiral: false, summary: 'A 16-long, 2-tall timber ledger against a wall plate, point at its bottom centre on the wall face.', section: [{ u: [-8, 8], v: [0, 2] }] },
  { id: P.chimneySeat, chiral: true, summary: 'A chimney bearing on the middle of three roof courses: 6 along the slope by the 2-wide course top, read in the slope\'s own axes. Its flashing steps onto the course above and below.',
    section: [{ u: [-3, 3], v: [-1, 1] }] },
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
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'window', connectors: [...bayConnectors(), connector('shutters', P.shutterMount, [...HEARTHFOLD.shutter.mount], 'south')],
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
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'door', blueprint: s.blueprint(STYLE),
    // A porch hood's ledger bears on the wall plate above the door head.
    connectors: [...bayConnectors(), connector('canopy', P.canopyLedger, [8, 22, T], 'south')],
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
    // A chimney seats on the top of course 6 at mid-bay, stepping onto courses 5 and 7.
    connector('chimney', P.chimneySeat, [8, under(6) + R.slab, R.halfSpan + R.overhang - R.run * 6 - 1], 'up'),
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

function shutters(): ForgePieceDefinition {
  // Two panelled leaves opened flat against the face either side of the reveal, two cells past the bay on each
  // side. Local origin is window cell (-2, 7, 4): the leaves bear on the bay's face posts and the sill.
  const { leaf: w, height: h } = HEARTHFOLD.shutter;
  const s = new Shape(id('shutter-pair'), [16 + 4, h, 2]);
  for (const [x0, hinge] of [[0, w - 2], [20 - w, 20 - w]] as const) {
    // Back boards, then a proud frame of stiles and rails around two sunk panels, and brass straps at the hinge.
    s.box(x0, 0, 0, x0 + w, h, 1, K.trim)
      .box(x0, 0, 1, x0 + 1, h, 2, K.trim).box(x0 + w - 1, 0, 1, x0 + w, h, 2, K.trim)
      .box(x0 + 1, 0, 1, x0 + w - 1, 2, 2, K.trim).box(x0 + 1, 6, 1, x0 + w - 1, 7, 2, K.trim).box(x0 + 1, h - 1, 1, x0 + w - 1, h, 2, K.trim);
    for (const y of [3, h - 3]) s.box(hinge, y, 1, hinge + 2, y + 1, 2, MAT.brass);
  }
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'window', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('mount', P.shutterMount, [10, 0, 0], 'north'),
  ] });
}

function deck(): ForgePieceDefinition {
  // One 16-wide doorstep module on the floor-tile grid: a limestone bed, a timber board field flush with the floor
  // top, a limestone kerb and a one-cell step down to the street. Modules sit side by side into a terrace.
  const { depth, step, kerb, seats, seatDepth } = HEARTHFOLD.deck;
  const s = new Shape(id('porch-deck'), [BAY, 2, depth + step])
    .box(0, 0, 0, BAY, 2, depth, K.stone)
    .box(0, 1, 0, BAY, 2, depth - kerb, K.trim)
    .box(0, 0, depth, BAY, 1, depth + step, K.stone);
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'porch', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('floor', P.floorEdge, [8, 0, 0], 'north'),
    ...seats.map(x => connector(`seat-${x}`, P.porchFoot, [x, 2, seatDepth], 'up')),
  ] });
}

function post(): ForgePieceDefinition {
  // A 2×2 timber post on a 4×4 limestone foot, with a stepped knee under the beam it carries toward +X.
  const { height, beamSeat } = HEARTHFOLD.post;
  const s = new Shape(id('porch-post'), [5, height, 4])
    .box(0, 0, 0, 4, 2, 4, K.stone)
    .box(1, 2, 1, 3, height, 3, K.trim)
    .box(3, beamSeat - 4, 1, 4, beamSeat, 3, K.trim).box(4, beamSeat - 2, 1, 5, beamSeat, 3, K.trim);
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'porch', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('foot', P.porchFoot, [2, 0, 2], 'down'), connector('beam', P.beamEnd, [3, beamSeat, 2], 'east'),
    connector('head', P.porchHead, [2, height, 2], 'up'),
  ] });
}

function trim(): ForgePieceDefinition {
  // A 16-long, 2-deep timber beam with a 4-deep cap board: a porch bressummer between posts, or a coping on a
  // wall run where its feet meet the wall-head joints.
  const s = new Shape(id('trim'), [BAY, 4, T])
    .box(0, 0, 1, BAY, 3, 3, K.trim)
    .box(0, 3, 0, BAY, 4, T, K.trim);
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'trim', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('west', P.beamEnd, [0, 0, 2], 'west'), connector('east', P.beamEnd, [BAY, 0, 2], 'east'),
    connector('top', P.beamTop, [8, 4, 2], 'up'),
    connector('head-west', P.wallHead, [0, 0, 2], 'down'), connector('head-east', P.wallHead, [BAY, 0, 2], 'down'),
  ] });
}

function canopy(): ForgePieceDefinition {
  // A small gabled hood in the main roof's 3:2 courses (2 timber under 3 terracotta), local y 2 at its eaves. Its
  // ledger bears on the wall plate over the door, the first courses on the post heads, and a king-post truss on
  // the beam; a verge band finishes the street end. It sits under a gable verge, never under an eave.
  const { width, courses, depth, verge, truss } = HEARTHFOLD.hood;
  const s = new Shape(id('porch-canopy'), [width, 23, depth + verge]);
  const span = (j: number): [number, number][] => [[R.run * j, R.run * j + R.run], [width - R.run * j - R.run, width - R.run * j]];
  const under = (j: number) => 2 + R.rise * j;
  for (let j = 0; j < courses; j++) for (const [x0, x1] of span(j)) {
    s.box(x0, under(j), 0, x1, under(j) + 2, depth, K.trim).box(x0, under(j) + 2, 0, x1, under(j) + R.slab, depth, K.roof)
      .box(x0, under(j) - 1, depth, x1, under(j) + R.slab + 1, depth + verge, K.roof);
  }
  // Against the wall: the ledger, then plaster up to each course.
  s.box(2, 0, 0, width - 2, 2, 1, K.trim);
  for (let j = 1; j < courses; j++) for (const [x0, x1] of span(j)) s.box(x0, 2, 0, x1, under(j), 1, K.wall);
  // The open front: a sole plate on the beam, plaster set back one cell and a king post under the crest.
  s.box(2, 3, truss, width - 2, 4, truss + 2, K.trim);
  for (let j = 1; j < courses; j++) for (const [x0, x1] of span(j)) s.box(x0, 4, truss, x1, under(j), truss + 1, K.wall);
  s.box(width / 2 - 1, 4, truss, width / 2 + 1, under(courses - 1), truss + 2, K.trim);
  // Ridge roll in front of the main verge, and a small finial over the street end.
  const crest = under(courses - 1) + R.slab;
  s.box(width / 2 - 1, crest, verge, width / 2 + 1, crest + 2, depth, K.roof)
    .box(width / 2 - 1, crest + 1, depth, width / 2 + 1, crest + 4, depth + verge, K.roof);
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'porch', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('wall', P.canopyLedger, [width / 2, 0, 0], 'north'),
    connector('post-west', P.porchHead, [1, 2, truss + 1], 'down'), connector('post-east', P.porchHead, [width - 1, 2, truss + 1], 'down'),
    connector('beam', P.beamTop, [width / 2, 3, truss + 1], 'down'),
  ] });
}

function chimney(): ForgePieceDefinition {
  // Local x runs along the ridge, +Z down the slope, y 0 the top of course 5. A 6×6 limestone stack steps onto three
  // courses, a proud limestone drip course marks the set-off, and the upper stack leans one cell along the ridge before a
  // lid on four piers caps the open flue.
  const s = new Shape(id('chimney'), [8, 24, 8])
    .box(1, 0, 5, 7, 13, 7, K.stone).box(1, 3, 3, 7, 13, 5, K.stone).box(1, 6, 1, 7, 13, 3, K.stone)
    .box(0, 13, 0, 8, 14, 8, K.stone)
    .box(2, 14, 1, 6, 17, 5, K.stone).box(3, 17, 1, 7, 20, 5, K.stone)
    .air(4, 16, 2, 6, 20, 4);
  for (const [x, z] of [[3, 1], [6, 1], [3, 4], [6, 4]] as const) s.box(x, 20, z, x + 1, 22, z + 1, K.stone);
  s.box(2, 22, 0, 8, 23, 6, K.roof).box(3, 23, 1, 7, 24, 5, K.roof);
  return definePiece({ id: s.id, familyId: 'hearthfold', kind: 'chimney', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('seat', P.chimneySeat, [4, 3, 4], 'down'),
  ] });
}

export const HEARTHFOLD_PIECES: Partial<Record<ForgeForm, () => ForgePieceDefinition>> = {
  floor, wall, 'wall-corner': corner, door, window, 'shutter-pair': shutters, 'roof-slope': slope, 'roof-ridge': ridge, 'roof-gable': gable,
  'roof-verge': verge, 'porch-deck': deck, 'porch-post': post, 'porch-canopy': canopy, chimney, trim,
};
