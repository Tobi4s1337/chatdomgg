import type { ForgePieceDefinition } from '@chatdom/shared';
import { MAT, STYLES } from '../materials';
import { COMMON, Shape, connector, definePiece, space, type ForgeForm, type ForgeProfile } from './grammar';

/**
 * Tidewake: salt-pale weatherboard over a grey stone plinth, quoined corners, a low 45° slate roof whose long eaves
 * flare out at a 1:2 kick, braced post-and-lintel timber and ledged windows. Every piece faces +Z (its exterior)
 * in local cells; see the README for how they turn and join.
 */
const K = STYLES.tide;
const STYLE = K.id;
const { bay: BAY, wallHeight: H, wallThickness: T } = COMMON;

/** Finite authored measures. The roof is a 1:1 slate roof over a two-bay (32-cell) span, kicked 1:2 at the eave. */
export const TIDEWAKE = {
  cornerArm: 8,
  plinth: 3,
  plate: 22,
  /** Weatherboard: the bottom row of each 3-row board course stands one cell proud of the wall field. */
  laps: [4, 7, 10, 13, 16, 19] as const,
  roof: { halfSpan: 16, overhang: 6, slab: 3, seat: 3, crest: 18, kick: [2, 2, 1, 1, 0, 0] as const },
  window: { width: 8, height: 12, centre: [8, 13, 2] as const },
  door: { opening: [2, 14] as const, height: 20, hinge: [2, 0, 0] as const, leaf: 2 },
  /** Open board-and-ledge shutter leaves, 5 × 14 each, hinged on the window casing. */
  shutter: { leaf: 5, height: 14, mount: [8, 6, 4] as const },
  /** Doorstep: a boardwalk on three stone sleepers, flush with the floor top, and a timber tread down to the street. */
  deck: { depth: 10, step: 2, seats: [7, 9] as const, seatDepth: 7 },
  /** Post and lintel: a 2 × 2 post 21 tall on a 3-tall stone pier carries the beam on its head and a knee brace out under the hood eave. */
  post: { height: 21, knee: 23, pier: 3 },
  /** Hood: a 20-wide gabled slate hood nested under the main verge at the same 1:1 pitch, kicked 1:2 at its eaves. */
  hood: { width: 20, depth: 10, verge: 2, truss: 6 },
} as const;
const R = TIDEWAKE.roof;
/** Underside of the roof column d cells from the crest, in slope-local cells: 1:1 to the wall face, then the kick. */
export const tideUnder = (d: number) => d < R.halfSpan ? R.crest - d : R.kick[d - R.halfSpan]!;
const DEPTH = R.halfSpan + R.overhang;
const id = (form: ForgeForm | 'door-leaf') => `forge-tidewake-${form}`;

const P = {
  wallSide: 'tidewake-wall-side', wallFoot: 'tidewake-wall-foot', wallHead: 'tidewake-wall-head',
  floorEdge: 'tidewake-floor-edge', roofSection: 'tidewake-roof-section', ridgeSeat: 'tidewake-ridge-seat',
  ridgeSection: 'tidewake-ridge-section', gableApex: 'tidewake-gable-apex', shutterMount: 'tidewake-shutter-mount',
  porchFoot: 'tidewake-porch-foot', porchHead: 'tidewake-porch-head', porchKnee: 'tidewake-porch-knee',
  beamTop: 'tidewake-beam-top', canopyLedger: 'tidewake-canopy-ledger', chimneySeat: 'tidewake-chimney-seat',
} as const;

/** The ridge's saddle and board, in slope cells: [d, bottom, top] for the slab columns either side of the crest. */
const RIDGE = [[2, 19, 21], [1, 20, 22], [0, 21, 23]] as const;
const RIDGE_BOARD = [23, 25] as const;

/** The whole mating cross-section of each profile (see ForgeProfile for the reading frame). */
export const TIDEWAKE_PROFILES: readonly ForgeProfile[] = [
  { id: P.wallSide, chiral: false, summary: 'Vertical end of a 4-thick, 24-tall weatherboard run, point at foot centreline. The 3-tall stone plinth and the timber plate are solid across all four cells; the two middle cells of the wall field are solid full height. The outer skin cell carries laps or quoins.',
    section: [{ u: [-2, 2], v: [0, 3] }, { u: [-1, 1], v: [3, 22] }, { u: [-2, 2], v: [22, 24] }] },
  { id: P.wallFoot, chiral: false, summary: 'A wall plinth foot standing on a floor top, 2×2, inset two cells from the floor edge.', section: [{ u: [-1, 1], v: [-1, 1] }] },
  { id: P.wallHead, chiral: false, summary: 'Wall plate top at a bay joint or corner arm end, 4×4 across the wall thickness. Roof slopes and gables bear here.', section: [{ u: [-2, 2], v: [-2, 2] }] },
  { id: P.floorEdge, chiral: false, summary: 'Full 16-wide, 2-tall floor tile edge, point at the bottom centre.', section: [{ u: [-8, 8], v: [0, 2] }] },
  { id: P.roofSection, chiral: true, summary: 'The slab end of a slope: twenty-two one-cell columns, 3 tall (1 sarking under 2 slate), read from the eave tip bottom toward the crest. The six eave columns rise 1 every 2 (2,2,1,1,0,0 from the wall), the sixteen inside the wall face 1 every 1.',
    section: Array.from({ length: DEPTH }, (_, c) => ({ u: [c, c + 1] as const, v: [tideUnder(DEPTH - 1 - c), tideUnder(DEPTH - 1 - c) + R.slab] as const })) },
  { id: P.ridgeSeat, chiral: false, summary: 'Crest of two meeting slopes and the ridge saddle bearing on it: 4 along the ridge by the two crest columns.', section: [{ u: [-2, 2], v: [-1, 1] }] },
  { id: P.ridgeSection, chiral: false, summary: 'Ridge end: a stepped slate saddle over the three crest columns each side (2 tall, one higher per column) under a 2×2 timber ridge board.',
    section: [{ u: [-3, -2], v: [0, 2] }, { u: [2, 3], v: [0, 2] }, { u: [-2, -1], v: [1, 3] }, { u: [1, 2], v: [1, 3] }, { u: [-1, 1], v: [2, 6] }] },
  { id: P.gableApex, chiral: false, summary: 'Gable apex under the two crest columns, 2×2 across the gable.', section: [{ u: [-1, 1], v: [-1, 1] }] },
  { id: P.shutterMount, chiral: false, summary: 'Open shutter leaves bearing on the window bay\'s timber casing either side of the reveal, point at the bottom centre of the reveal on the face plane. Each strip is the casing behind a leaf, 14 tall.',
    section: [{ u: [-6, -5], v: [0, 14] }, { u: [5, 6], v: [0, 14] }] },
  { id: P.porchFoot, chiral: false, summary: 'A porch post\'s 2×2 stone pier standing on a deck top.', section: [{ u: [-1, 1], v: [-1, 1] }] },
  { id: P.porchHead, chiral: false, summary: 'A 2×2 post head under the beam bolster that rests on it.', section: [{ u: [-1, 1], v: [-1, 1] }] },
  { id: P.porchKnee, chiral: true, summary: 'A knee brace\'s 1-wide, 2-deep top under the hood\'s outer eave column, read from the post: u runs outward from the point.', section: [{ u: [0, 1], v: [-1, 1] }] },
  { id: P.beamTop, chiral: false, summary: 'Beam cap under the hood truss\'s king post, 2×2 about the beam centre.', section: [{ u: [-1, 1], v: [-1, 1] }] },
  { id: P.canopyLedger, chiral: false, summary: 'A 16-long, 2-tall timber ledger against a wall plate, point at its bottom centre on the wall face.', section: [{ u: [-8, 8], v: [0, 2] }] },
  { id: P.chimneySeat, chiral: true, summary: 'A chimney bearing on one slope column: 4 along the ridge by the 1-wide column top, read in the slope\'s own axes. Its base steps onto the columns either side.',
    section: [{ u: [-2, 2], v: [0, 1] }] },
];

/** Weatherboard field set one cell back, one proud lap row per course, from x0 to x1 along a +Z face at depth z. */
function laps(s: Shape, x0: number, x1: number, z: number): Shape {
  for (const y of TIDEWAKE.laps) s.box(x0, y, z, x1, y + 1, z + 1, K.wall);
  return s;
}

/** Stone plinth, weatherboard field and laps, and the timber wall plate. */
function bay(s: Shape): Shape {
  s.box(0, 0, 0, BAY, TIDEWAKE.plinth, T, K.stone).box(0, TIDEWAKE.plinth, 0, BAY, TIDEWAKE.plate, T - 1, K.wall);
  return laps(s, 0, BAY, T - 1).box(0, TIDEWAKE.plate, 0, BAY, H, T, K.trim);
}

const bayConnectors = () => [
  connector('west', P.wallSide, [0, 0, 2], 'west'), connector('east', P.wallSide, [BAY, 0, 2], 'east'),
  connector('foot-west', P.wallFoot, [1, 0, 2], 'down'), connector('foot-east', P.wallFoot, [15, 0, 2], 'down'),
  connector('head-west', P.wallHead, [0, H, 2], 'up'), connector('head-east', P.wallHead, [BAY, H, 2], 'up'),
];

function floor(): ForgePieceDefinition {
  // Grey stone bed with long boards running the tile's length between two stone flag strips.
  const s = new Shape(id('floor'), [BAY, 2, BAY]).box(0, 0, 0, BAY, 2, BAY, K.stone).box(2, 1, 0, 14, 2, BAY, K.trim);
  const seats = [[7, 14], [9, 14], [7, 2], [9, 2], [2, 7], [2, 9], [14, 7], [14, 9]] as const;
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'floor', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('south', P.floorEdge, [8, 0, BAY], 'south'), connector('east', P.floorEdge, [BAY, 0, 8], 'east'),
    connector('north', P.floorEdge, [8, 0, 0], 'north'), connector('west', P.floorEdge, [0, 0, 8], 'west'),
    ...seats.map(([x, z]) => connector(`seat-${x}-${z}`, P.wallFoot, [x, 2, z], 'up')),
  ] });
}

function wall(): ForgePieceDefinition {
  const s = bay(new Shape(id('wall'), [BAY, H, T]));
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'wall', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: bayConnectors() });
}

function corner(): ForgePieceDefinition {
  // An L of two 8-cell arms (south arm x 0..8 at z 4..8, west arm z 0..8 at x 0..4) closed by long-and-short stone
  // quoins: each board course alternates a 5-cell and a 3-cell block on the two faces.
  const s = new Shape(id('wall-corner'), [8, H, 8])
    .box(0, 0, 4, 8, 3, 8, K.stone).box(0, 0, 0, 4, 3, 4, K.stone)
    .box(0, 3, 4, 8, 22, 7, K.wall).box(1, 3, 0, 4, 22, 7, K.wall);
  laps(s, 0, 8, 7);
  for (const y of TIDEWAKE.laps) s.box(0, y, 0, 1, y + 1, 8, K.wall);
  const courses = [[3, 7], [7, 10], [10, 13], [13, 16], [16, 19], [19, 22]] as const;
  courses.forEach(([y0, y1], n) => {
    const [south, west] = n % 2 === 0 ? [5, 3] : [3, 5];
    s.box(0, y0, 7, south, y1, 8, K.stone).box(0, y0, 8 - west, 1, y1, 8, K.stone);
  });
  s.box(0, 22, 4, 8, H, 8, K.trim).box(0, 22, 0, 4, H, 4, K.trim);
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'wall', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('east', P.wallSide, [8, 0, 6], 'east'), connector('north', P.wallSide, [2, 0, 0], 'north'),
    connector('foot-east', P.wallFoot, [7, 0, 6], 'down'), connector('foot-north', P.wallFoot, [2, 0, 1], 'down'),
    connector('head-east', P.wallHead, [8, H, 6], 'up'), connector('head-north', P.wallHead, [2, H, 0], 'up'),
  ] });
}

function window(): ForgePieceDefinition {
  const { width, height, centre } = TIDEWAKE.window;
  // Two extra cells of depth carry the projecting ledges: a stone sill on two corbels below, a slate drip hood above.
  const s = bay(new Shape(id('window'), [BAY, H, T + 2]))
    .box(2, 6, T - 1, 3, 20, T, K.trim).box(13, 6, T - 1, 14, 20, T, K.trim).box(2, 20, T - 1, 14, 21, T, K.trim)
    .air(3, 6, 0, 13, 20, T)
    // A one-over-one sash: timber frame, glass one cell in from the inner face and a heavy meeting rail.
    .box(3, 6, 1, 13, 20, 2, K.trim)
    .box(4, 7, 1, 12, 19, 2, MAT.glass)
    .box(4, 12, 1, 12, 14, 2, K.trim)
    .box(2, 5, 0, 14, 6, T + 2, K.stone)
    .box(3, 4, T, 5, 5, T + 1, K.stone).box(11, 4, T, 13, 5, T + 1, K.stone)
    .box(1, 20, T, 15, 21, T + 2, K.roof).box(2, 21, T, 14, 22, T + 1, K.roof);
  const x0 = centre[0] - width / 2, y0 = centre[1] - height / 2;
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'window', connectors: [...bayConnectors(), connector('shutters', P.shutterMount, [...TIDEWAKE.shutter.mount], 'south')],
    blueprint: s.blueprint(STYLE, [{ id: 'glass', centre: [...centre], width, height, facing: 'south' }]),
    // The reveal and four cells past the face stay open across the whole light rectangle, between sill and hood.
    clearanceBoxes: [space([x0, y0, centre[2]], [x0 + width, y0 + height, T + 4])] });
}

function leaf() {
  // Closed pose in the frame's cells: a ledged and braced leaf against the inner face. Boards fill the opening one
  // cell thick; the outer layer is three ledges and two climbing braces stopping one cell short of the latch edge
  // (so its corner swings inside the opening), with iron straps on the hinge-side ledges and a brass latch.
  const s = new Shape(id('door-leaf'), [BAY, H, T]).box(2, 0, 0, 14, 20, 1, K.trim);
  for (const y of [2, 9, 16]) s.box(2, y, 1, 13, y + 2, 2, K.trim).box(2, y, 1, 9, y + 1, 2, MAT.darkStone);
  for (const y0 of [4, 11]) for (let k = 0; k < 5; k++) s.box(3 + 2 * k, y0 + k, 1, Math.min(13, 5 + 2 * k), y0 + k + 1, 2, K.trim);
  return s.box(12, 12, 1, 13, 14, 2, MAT.brass).blueprint(STYLE);
}

function door(): ForgePieceDefinition {
  const [x0, x1] = TIDEWAKE.door.opening, h = TIDEWAKE.door.height;
  const s = bay(new Shape(id('door'), [BAY, H, T]))
    .box(1, 3, 0, 2, h, T, K.trim).box(14, 3, 0, 15, h, T, K.trim)
    .box(1, h, 0, 15, 22, T, K.trim)
    .air(x0, 0, 0, x1, h, T)
    // A one-cell rebate in the latch jamb's inner face lets the boards' corner clear it; the rest of the jamb stops it.
    .air(x1, 0, 0, x1 + 1, h, 1);
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'door', blueprint: s.blueprint(STYLE),
    // A porch hood's ledger bears on the wall plate above the door head.
    connectors: [...bayConnectors(), connector('canopy', P.canopyLedger, [8, 22, T], 'south')],
    // Swing reservation for the leaf turning inward about its inner hinge corner: the boards sweep just past the
    // latch edge into the rebate (radius just over 12 cells), the narrower ledge layer stays inside the opening.
    clearanceBoxes: [space([x0, 0, -13], [x1 + 1, h, 1]), space([x0, 0, 1], [x1, h, TIDEWAKE.door.leaf])],
    door: { leaf: leaf(), hinge: [...TIDEWAKE.door.hinge], openQuarterTurns: 1, passage: space([x0 + TIDEWAKE.door.leaf, 0, -12], [x1, h, T]), threshold: [8, 0, 2] } });
}

function slope(): ForgePieceDefinition {
  // Local z 0 is the crest plane, z 16 the wall face, z 22 the eave tip. y 3 bears on the wall head.
  const s = new Shape(id('roof-slope'), [BAY, R.crest + R.slab, DEPTH]);
  for (let d = 0; d < DEPTH; d++) {
    const u = tideUnder(d);
    // One cell of timber sarking under two of slate: the soffit shows boards, the top a fine slate stair.
    s.box(0, u, d, BAY, u + 1, d + 1, K.trim).box(0, u + 1, d, BAY, u + R.slab, d + 1, K.roof);
  }
  // Timber sprockets fill from the wall plate up to the slab over the wall's four cells.
  for (let d = R.halfSpan - T; d < R.halfSpan - 1; d++) s.box(0, R.seat, d, BAY, tideUnder(d), d + 1, K.trim);
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'roof', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('west', P.roofSection, [0, 0, DEPTH], 'west'), connector('east', P.roofSection, [BAY, 0, DEPTH], 'east'),
    connector('seat', P.wallHead, [8, R.seat, R.halfSpan - 2], 'down'), connector('crest', P.ridgeSeat, [8, R.crest + R.slab, 0], 'up'),
    connector('gable-west', P.gableApex, [2, R.crest, 0], 'down'), connector('gable-east', P.gableApex, [14, R.crest, 0], 'down'),
    // A chimney seats on the top of column 4 at mid-bay, stepping onto columns 3, 5 and 6.
    connector('chimney', P.chimneySeat, [8, tideUnder(4) + R.slab, 4], 'up'),
  ] });
}

function ridge(): ForgePieceDefinition {
  // Local z 3 is the crest plane; y 0 is slope y 19. A stepped slate saddle thickens the three crest columns each
  // side, and a timber ridge board stands on the crest.
  const s = new Shape(id('roof-ridge'), [BAY, RIDGE_BOARD[1] - 19, 6]);
  for (const [d, y0, y1] of RIDGE) s.box(0, y0 - 19, 2 - d, BAY, y1 - 19, 3 - d, K.roof).box(0, y0 - 19, 3 + d, BAY, y1 - 19, 4 + d, K.roof);
  s.box(0, RIDGE_BOARD[0] - 19, 2, BAY, RIDGE_BOARD[1] - 19, 4, K.trim);
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'roof', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('west', P.ridgeSection, [0, 0, 3], 'west'), connector('east', P.ridgeSection, [BAY, 0, 3], 'east'),
    connector('seat', P.ridgeSeat, [8, R.crest + R.slab - 19, 3], 'down'),
  ] });
}

function gable(): ForgePieceDefinition {
  // Spans the 24 interior cells between the side walls, standing on the end wall plates. Column i sits d cells from
  // the crest and rises to the slope underside (15 − d). Weatherboard laps continue the walls' courses; a sill beam,
  // a king post and two struts climbing to the rafters brace it.
  const top = R.crest - R.seat, s = new Shape(id('roof-gable'), [24, top, T]);
  for (let d = 0; d < 12; d++) s.box(11 - d, 0, 0, 13 + d, top - d, T - 1, K.wall);
  for (const y of [1, 4, 7, 10, 13]) { const reach = Math.min(11, top - 1 - y); s.box(11 - reach, y, T - 1, 13 + reach, y + 1, T, K.wall); }
  s.box(0, 0, 0, 24, 1, T, K.trim).box(11, 1, T - 1, 13, top, T, K.trim);
  // Column 10 − k rises to 14 − k: the last step of each strut runs up to meet the rafter.
  for (let k = 0; k < 6; k++) {
    const y1 = k === 5 ? top - 1 - k : 3 + k;
    s.box(10 - k, 1 + k, T - 1, 11 - k, y1, T, K.trim).box(13 + k, 1 + k, T - 1, 14 + k, y1, T, K.trim);
  }
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'roof', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('foot-west', P.wallHead, [4, 0, 2], 'down'), connector('foot-east', P.wallHead, [20, 0, 2], 'down'),
    connector('apex', P.gableApex, [12, top, 2], 'up'),
  ] });
}

function verge(): ForgePieceDefinition {
  // Across the whole roof end (x = d + 23 east, 22 − d west), one cell past each eave tip; y 0 is slope y −2. Each
  // column is a 2-tall timber bargeboard under the slab and slate one cell proud above it; the apex covers the
  // ridge saddle and board ends.
  const width = 2 * DEPTH + 2, s = new Shape(id('roof-verge'), [width, RIDGE_BOARD[1] + 2, 2]);
  const top = (d: number) => Math.max(tideUnder(d) + R.slab + 1, ...RIDGE.filter(r => r[0] === d).map(r => r[2]), d === 0 ? RIDGE_BOARD[1] : 0) + 2;
  const column = (x: number, d: number) => s.box(x, tideUnder(d), 0, x + 1, tideUnder(d) + 2, 2, K.trim).box(x, tideUnder(d) + 2, 0, x + 1, top(d), 2, K.roof);
  for (let d = 0; d < DEPTH; d++) column(DEPTH - d, d).box(DEPTH + 1 + d, tideUnder(d), 0, DEPTH + 2 + d, tideUnder(d) + 2, 2, K.trim).box(DEPTH + 1 + d, tideUnder(d) + 2, 0, DEPTH + 2 + d, top(d), 2, K.roof);
  column(0, DEPTH - 1).box(width - 1, 0, 0, width, 2, 2, K.trim).box(width - 1, 2, 0, width, top(DEPTH - 1), 2, K.roof);
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'roof', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('slope-west', P.roofSection, [1, 2, 0], 'north'), connector('slope-east', P.roofSection, [width - 1, 2, 0], 'north'),
    connector('ridge', P.ridgeSection, [DEPTH + 1, 21, 0], 'north'),
  ] });
}

function shutters(): ForgePieceDefinition {
  // Two board leaves opened flat on the face either side of the reveal, each with two proud ledges carrying long
  // iron strap hinges from the hinge edge. Local origin is window cell (−2, 6, 4): the leaves bear on the casing at
  // window x 2 and 13.
  const { leaf: w, height: h } = TIDEWAKE.shutter;
  const s = new Shape(id('shutter-pair'), [16 + 4, h, 2]);
  for (const [x0, strap] of [[0, [1, w]], [20 - w, [20 - w, 19]]] as const) {
    s.box(x0, 0, 0, x0 + w, h, 1, K.trim);
    for (const y of [2, h - 4]) s.box(x0, y, 1, x0 + w, y + 2, 2, K.trim).box(strap[0], y + 1, 1, strap[1], y + 2, 2, MAT.darkStone);
  }
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'window', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('mount', P.shutterMount, [10, 0, 0], 'north'),
  ] });
}

function deck(): ForgePieceDefinition {
  // A 16-wide boardwalk module: timber boards flush with the floor top on three grey stone sleepers, so the open
  // bays between them show from the side, and a timber tread one cell down to the street.
  const { depth, step, seats, seatDepth } = TIDEWAKE.deck;
  const s = new Shape(id('porch-deck'), [BAY, 2, depth + step]);
  for (const z of [0, 4, 8]) s.box(0, 0, z, BAY, 1, z + 2, K.stone);
  s.box(0, 1, 0, BAY, 2, depth, K.trim).box(0, 0, depth, BAY, 1, depth + step, K.trim);
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'porch', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('floor', P.floorEdge, [8, 0, 0], 'north'),
    ...seats.map(x => connector(`seat-${x}`, P.porchFoot, [x, 2, seatDepth], 'up')),
  ] });
}

function post(): ForgePieceDefinition {
  // A 2×2 timber post on a stone pier of its own section, so it stands clear of the doorway. The beam rests on its
  // head; a two-step knee brace climbs outward (−X) to the hood's outer eave column. The right-hand post is the
  // same piece turned twice.
  const { height, knee, pier } = TIDEWAKE.post;
  const s = new Shape(id('porch-post'), [5, knee + 1, 4])
    .box(3, 0, 1, 5, pier, 3, K.stone)
    .box(3, pier, 1, 5, height, 3, K.trim)
    .box(2, 16, 1, 3, knee + 1, 3, K.trim).box(1, 19, 1, 2, knee, 3, K.trim);
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'porch', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('foot', P.porchFoot, [4, 0, 2], 'down'), connector('head', P.porchHead, [4, height, 2], 'up'),
    connector('knee', P.porchKnee, [1, knee, 2], 'up'),
  ] });
}

function trim(): ForgePieceDefinition {
  // A 16-long lintel: 2 × 2 timber beam on two bolsters that sit on post heads, under a 4-deep slate cap. Its ends
  // also meet the wall-head joints, so it can cope a free wall run.
  const s = new Shape(id('trim'), [BAY, 4, T])
    .box(0, 0, 0, 3, 1, T, K.trim).box(13, 0, 0, 16, 1, T, K.trim)
    .box(0, 1, 1, BAY, 3, 3, K.trim)
    .box(0, 3, 0, BAY, 4, T, K.roof);
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'trim', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('post-west', P.porchHead, [1, 0, 2], 'down'), connector('post-east', P.porchHead, [15, 0, 2], 'down'),
    connector('top', P.beamTop, [8, 4, 2], 'up'),
    connector('head-west', P.wallHead, [0, 0, 2], 'down'), connector('head-east', P.wallHead, [BAY, 0, 2], 'down'),
  ] });
}

/** Hood column underside, k cells out from its centre line: 1:1 from the crest, then a 1:2 kick past the beam. */
const hoodUnder = (k: number) => k <= 7 ? 10 - k : k === 8 ? 2 : 1;

function canopy(): ForgePieceDefinition {
  // A 20-wide gabled hood at the main roof's 1:1 pitch with the same kicked eaves, so it nests under the main verge.
  // Its ledger bears on the door bay's plate, its king-post truss on the beam and its outer eaves on the post knees.
  const { width, depth, verge, truss } = TIDEWAKE.hood;
  const s = new Shape(id('porch-canopy'), [width, 15, depth + verge]);
  const columns = Array.from({ length: width / 2 }, (_, k) => [[width / 2 + k, k], [width / 2 - 1 - k, k]] as const).flat();
  for (const [x, k] of columns) {
    const u = hoodUnder(k);
    s.box(x, u, 0, x + 1, u + 1, depth, K.trim).box(x, u + 1, 0, x + 1, u + R.slab, depth, K.roof)
      .box(x, u - 1, depth, x + 1, u, depth + verge, K.trim).box(x, u, depth, x + 1, u + R.slab + 1, depth + verge, K.roof);
  }
  // Against the wall: the ledger, then weatherboard up to each column over the door bay.
  s.box(2, 0, 0, width - 2, 2, 1, K.trim);
  for (const [x, k] of columns) if (hoodUnder(k) > 2) s.box(x, 2, 0, x + 1, hoodUnder(k), 1, K.wall);
  // The open front: a king post and two struts climbing from the beam to the rafters.
  s.box(width / 2 - 1, 3, truss, width / 2 + 1, hoodUnder(0), truss + 2, K.trim);
  for (let k = 0; k < 3; k++) s.box(width / 2 - 2 - k, 3 + k, truss, width / 2 - 1 - k, 5 + k, truss + 2, K.trim).box(width / 2 + 1 + k, 3 + k, truss, width / 2 + 2 + k, 5 + k, truss + 2, K.trim);
  // A ridge board over the crest, stopping under the front verge's slate.
  s.box(width / 2 - 1, hoodUnder(0) + R.slab, 2, width / 2 + 1, hoodUnder(0) + R.slab + 1, depth, K.trim);
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'porch', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('wall', P.canopyLedger, [width / 2, 0, 0], 'north'),
    connector('beam', P.beamTop, [width / 2, 3, truss + 1], 'down'),
    connector('knee-west', P.porchKnee, [0, 1, truss + 1], 'down'), connector('knee-east', P.porchKnee, [width, 1, truss + 1], 'down'),
  ] });
}

function chimney(): ForgePieceDefinition {
  // Local x runs along the ridge, +Z down the slope; local z 1..5 sit on slope columns 3..6 and y 0 is the top of
  // column 6. A narrow 4×4 stone stack steps onto four columns, a slate string course rings it, and an iron-dark cowl
  // closes the windward (ridge) side and the top, leaving the flue's mouth open down the slope.
  const s = new Shape(id('chimney'), [6, 19, 6]);
  [3, 2, 1, 0].forEach((bottom, i) => s.box(1, bottom, 1 + i, 5, 17, 2 + i, K.stone));
  s.box(0, 11, 0, 6, 12, 6, K.roof)
    .air(2, 12, 2, 4, 17, 4).air(2, 14, 4, 4, 17, 5)
    .box(0, 14, 0, 6, 17, 1, MAT.darkStone)
    .box(0, 15, 1, 1, 17, 4, MAT.darkStone).box(5, 15, 1, 6, 17, 4, MAT.darkStone)
    .box(0, 17, 0, 6, 18, 5, MAT.darkStone).box(1, 18, 0, 5, 19, 3, MAT.darkStone);
  return definePiece({ id: s.id, familyId: 'tidewake', kind: 'chimney', blueprint: s.blueprint(STYLE), clearanceBoxes: [], connectors: [
    connector('seat', P.chimneySeat, [3, 2, 2], 'down'),
  ] });
}

export const TIDEWAKE_PIECES: Partial<Record<ForgeForm, () => ForgePieceDefinition>> = {
  floor, wall, 'wall-corner': corner, door, window, 'shutter-pair': shutters, 'roof-slope': slope, 'roof-ridge': ridge, 'roof-gable': gable,
  'roof-verge': verge, 'porch-deck': deck, 'porch-post': post, 'porch-canopy': canopy, chimney, trim,
};
