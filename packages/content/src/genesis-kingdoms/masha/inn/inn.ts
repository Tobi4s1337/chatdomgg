import { StyleIdSchema, type ContentWindow, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../../../materials';
import { Boxes, LANDMARK_KITS, hash, landmarkPalette, type LandmarkKit } from '../../../genesis-landmarks/kit';
import { extentOf } from '../../../genesis-landmarks/parts';
import type { LandmarkGlazing, LandmarkPiece, LandmarkWalk, LocalFacing } from '../../../genesis-landmarks/types';

/**
 * The Copper Kettle: the mountain inn on Bell Court, at the foot of the city, kept by Tansy. A three-storey alpine
 * inn under one deep, steep roof whose ridge has settled a couple of cells in the middle over the years. The ground
 * floor is coursed rubble stone with pale quoins, deep-set arched windows and a big arched timber door; the two upper
 * storeys are plaster in a timber frame, jettied out over the stone, the top one bowing a cell where the frame has
 * eased. A carved balcony runs the full width of the first floor with geraniums trailing from its boxes and shelters
 * the door below it. The roof carries two dormers, a crooked stone chimney behind the ridge and a smaller one in front.
 * At the door: a brass bracket holding the copper kettle sign, two caged lanterns, a bench, barrels and the winter's
 * firewood stacked under the balcony. Front (+Z) is the door.
 *
 * Every coordinate is in build cells (0.125 m) from the blueprint's (0,0,0) corner; y = 0 is the ground datum.
 */
export interface CopperKettleOptions { readonly style: StyleKey }

export const COPPER_KETTLE_SIZE: Vec3 = [144, 192, 136];

/** The measured planes of the inn, shared by the factory, its metadata and its tests. */
export const COPPER_KETTLE = {
  /** Stone ground floor: walls six cells thick, standing on a plinth one cell proud. */
  stone: { x: [16, 128] as const, z: [20, 116] as const, y: [0, 32] as const, wall: 6 },
  plinth: { x: [15, 129] as const, z: [19, 117] as const, y: [0, 3] as const },
  /** First floor, jettied a cell front and back, and second floor, jettied another, with its bowed middle. */
  first: { z: [18, 118] as const, y: [34, 56] as const, wall: 3 },
  second: { z: [16, 120] as const, y: [58, 78] as const, wall: 3, bow: { x: [44, 100] as const, z: 121 } },
  plate: { y: [78, 80] as const },
  /** The roof: ridge along X over `cz`, 4:3 main pitch down to `eaves` at the wall line, then a kicked eave. */
  roof: { ridge: 153, cz: 68, eaves: 84, front: 120, back: 16, verge: [6, 138] as const, kick: 12, shell: 4, eaveSag: [40, 104] as const },
  /** The settled ridge: [x0, x1, cells of sag at the ridge], easing to nothing at the eaves. */
  sag: [[6, 30, 0], [30, 54, 1], [54, 90, 2], [90, 114, 1], [114, 138, 0]] as const,
  balcony: { x: [14, 130] as const, deck: [32, 34] as const, z: [116, 130] as const, rail: { z: 128, y: [34, 47] as const } },
  door: {
    /** The open reveal, from just in front of the leaf's ironwork to the face of the door case. */
    opening: { x: [64, 80] as const, y: [3, 24] as const, z: [113, 117] as const },
    /** Arch rows above the rectangular opening: [y, x0, x1]. */
    arch: [[24, 65, 79], [25, 66, 78], [26, 68, 76], [27, 70, 74]] as const,
    leaf: { x: [64, 80] as const, y: [3, 28] as const, z: [110, 112] as const },
    threshold: 3,
    /** Steps: [top, z0, z1, x0, x1]; the lowest is the widest. */
    steps: [[3, 117, 120, 60, 84], [2, 120, 123, 59, 85], [1, 123, 126, 58, 86]] as const,
  },
  lanterns: [{ id: 'door-lantern-west', x: 57 }, { id: 'door-lantern-east', x: 87 }] as const,
  lantern: { glass: { y: [17, 22] as const, z: [118, 121] as const } },
  sign: {
    /** The brass arm, and the kettle's profile plane: its rows start at `top` and its columns at `z0`. */
    arm: { x: 50, y: [28, 30] as const, z: [116, 131] as const },
    kettle: { top: 25, z0: 117, x: [49, 52] as const, belly: [48, 53] as const },
  },
  bench: { x: [90, 104] as const, y: [3, 4] as const, z: [117, 121] as const },
  woodpile: { x: [107, 122] as const, y: [0, 19] as const, z: [117, 123] as const },
  chimneys: {
    main: { x: [98, 110] as const, z: [54, 66] as const, y: [124, 173] as const, mouth: [103, 179, 58] as const },
    small: { x: [24, 32] as const, z: [80, 88] as const, y: [120, 148] as const, mouth: [27, 152, 84] as const },
  },
  dormers: [{ id: 'dormer-west', x: 44 }, { id: 'dormer-east', x: 100 }] as const,
  dormer: { half: 9, y: [96, 118] as const, z: [86, 110] as const, window: { y: [102, 114] as const, w: 10 } },
} as const;

export const COPPER_KETTLE_DOOR = COPPER_KETTLE.door;
export const COPPER_KETTLE_LANTERNS = COPPER_KETTLE.lanterns;
export const COPPER_KETTLE_CHIMNEYS = COPPER_KETTLE.chimneys;

/** The inn's own palette: its kit's landmark materials plus the flowers, the brass bracket and the copper kettle. */
export function copperKettlePalette(style: StyleKey): ReadonlySet<number> {
  return new Set([...landmarkPalette(style), MAT.petal, MAT.blueFlower, MAT.brass, MAT.forgeCopper]);
}

const { roof: ROOF } = COPPER_KETTLE;

/** Roof top over depth row `d` from the ridge line, before any sag. */
const roofTop = (d: number) => ROOF.ridge - Math.floor((4 * d) / 3);
/** Sag (cells) at a layer, for a segment whose ridge has settled `s` cells: none at the eaves, all of it at the ridge. */
const sagAt = (s: number, y: number) => Math.round(s * Math.min(1, Math.max(0, (y - ROOF.eaves) / (ROOF.ridge - ROOF.eaves))));
/** The roof mass at layer `y` lowered by `s`: [back z, front z), or null above the ridge. */
function roofSpan(y: number, s: number): readonly [number, number] | null {
  const k = ROOF.ridge - s - y;
  if (k <= 0) return null;
  const dmax = Math.ceil((3 * k) / 4) - 1;
  return [Math.max(ROOF.back, ROOF.cz - dmax - 1), Math.min(ROOF.front, ROOF.cz + dmax + 1)];
}

type Face = LocalFacing;

/**
 * A slab against one face of the inn. `plane` is the face's outer plane (cells lie inside it); `d0..d1` count cells
 * inwards from the plane (negative is proud of it); `u0..u1` run along the face (x on south and north, z on east and
 * west).
 */
function slab(b: Boxes, face: Face, plane: number, d0: number, d1: number, u0: number, u1: number, y0: number, y1: number, m: number): void {
  if (face === 'south') b.add(u0, y0, plane - d1, u1, y1, plane - d0, m);
  else if (face === 'north') b.add(u0, y0, plane + d0, u1, y1, plane + d1, m);
  else if (face === 'east') b.add(plane - d1, y0, u0, plane - d0, y1, u1, m);
  else b.add(plane + d0, y0, u0, plane + d1, y1, u1, m);
}

interface WindowSpec {
  readonly id: string;
  readonly face: Face;
  readonly plane: number;
  readonly u: number;
  readonly w: number;
  readonly y: number;
  readonly h: number;
  /** Wall thickness to cut through to the room. */
  readonly wall: number;
  readonly kind: 'stone' | 'timber';
  readonly shutters?: boolean;
  readonly flowers?: boolean;
  /** A glazed door: a timber panel below the glass. */
  readonly door?: boolean;
}

class InnBoxes extends Boxes {
  readonly windows: ContentWindow[] = [];
}

export function createCopperKettle(options: CopperKettleOptions): LandmarkPiece {
  const { style } = options;
  if (!(style in LANDMARK_KITS)) throw new Error(`Unknown inn style ${String(style)}.`);
  const kit = LANDMARK_KITS[style];
  const b = new InnBoxes();

  groundFloor(b, kit);
  upperFloors(b, kit);
  roof(b, kit);
  dormers(b, kit);
  chimneys(b, kit);
  windows(b, kit);
  door(b, kit);
  balcony(b, kit);
  lanterns(b, kit);
  sign(b, kit);
  frontage(b, kit);

  const blueprint: VoxelBlueprint = {
    version: 1, id: `genesis-masha-inn-${style}`, styleId: StyleIdSchema.parse(STYLES[style].id), kind: 'civic', lattice: 'build',
    size: [...COPPER_KETTLE_SIZE], boxes: b.list, windows: b.windows,
  };
  return { blueprint, parts: [], ...metadata(blueprint) };
}

// ── The stone ground floor ───────────────────────────────────────────────────────────────────────────────────────

function groundFloor(b: Boxes, kit: LandmarkKit): void {
  const { stone, plinth } = COPPER_KETTLE;
  // A plinth a cell proud all round, solid under the floor, then the stone walls and the hollow common room.
  b.add(plinth.x[0], 0, plinth.z[0], plinth.x[1], plinth.y[1], plinth.z[1], kit.base);
  b.add(stone.x[0], plinth.y[1], stone.z[0], stone.x[1], stone.y[1], stone.z[1], kit.stone);
  b.add(stone.x[0] + stone.wall, plinth.y[1], stone.z[0] + stone.wall, stone.x[1] - stone.wall, stone.y[1], stone.z[1] - stone.wall, MAT.air);
  // Coursed rubble: stones of the darker and the paler kit colours laid in three-cell courses, a few standing proud.
  const faces: readonly [Face, number, number, number][] = [
    ['south', stone.z[1], stone.x[0], stone.x[1]], ['north', stone.z[0], stone.x[0], stone.x[1]],
    ['east', stone.x[1], stone.z[0], stone.z[1]], ['west', stone.x[0], stone.z[0], stone.z[1]],
  ];
  faces.forEach(([face, plane, u0, u1], f) => {
    for (let i = 0; i < 26; i++) {
      const course = Math.floor(hash(i, f, 1, 301) * 9), y = 4 + course * 3;
      const w = 3 + Math.floor(hash(i, f, 2, 301) * 5), u = u0 + 9 + Math.floor(hash(i, f, 3, 301) * (u1 - u0 - 18 - w));
      if (face === 'south' && u + w > 56 && u < 90) continue; // the door case and lanterns keep clean stone
      const pick = hash(i, f, 4, 301);
      const m = pick < 0.42 ? kit.rock : pick < 0.72 ? kit.band : kit.stone;
      slab(b, face, plane, pick >= 0.72 ? -1 : 0, 1, u, u + w, y, y + 2, m);
    }
  });
  // Long-and-short quoins at the four corners, a cell proud on both faces.
  for (let y = 4, k = 0; y + 4 <= stone.y[1]; y += 4, k++) {
    const long = 7, short = 4, [a, c] = k % 2 ? [long, short] : [short, long];
    for (const [x, sx] of [[stone.x[0], 1], [stone.x[1], -1]] as const) {
      for (const [z, sz] of [[stone.z[0], 1], [stone.z[1], -1]] as const) {
        const xo = sx > 0 ? x - 1 : x, zo = sz > 0 ? z - 1 : z;
        b.add(Math.min(xo, xo + sx * a), y, zo, Math.max(xo + 1, xo + 1 + sx * a), y + 3, zo + 1, kit.band);
        b.add(xo, y, Math.min(zo, zo + sz * c), xo + 1, y + 3, Math.max(zo + 1, zo + 1 + sz * c), kit.band);
      }
    }
  }
  // Moss where the plinth meets the ground in the shade of the back and the west side.
  for (let i = 0; i < 12; i++) {
    const back = i % 2 === 0, w = 3 + Math.floor(hash(i, 1, 0, 302) * 6), u = 24 + Math.floor(hash(i, 2, 0, 302) * 80);
    if (back) b.add(u, 0, plinth.z[0] - 1, u + w, 1 + Math.floor(hash(i, 3, 0, 302) * 2), plinth.z[0], MAT.moss);
    else b.add(plinth.x[0] - 1, 0, u, plinth.x[0], 1 + Math.floor(hash(i, 3, 0, 302) * 2), u + w, MAT.moss);
  }
}

// ── The timber-framed upper floors ───────────────────────────────────────────────────────────────────────────────

function upperFloors(b: Boxes, kit: LandmarkKit): void {
  const { stone, first, second, plate } = COPPER_KETTLE;
  const [x0, x1] = stone.x;
  // First floor: its joists and floor, a sill band a cell proud, then plaster walls round a hollow room.
  b.add(x0 - 1, stone.y[1], first.z[0] - 1, x1 + 1, first.y[0], first.z[1] + 1, kit.trim);
  b.add(x0, first.y[0], first.z[0], x1, first.y[1], first.z[1], kit.wall);
  b.add(x0 + first.wall, first.y[0], first.z[0] + first.wall, x1 - first.wall, first.y[1], first.z[1] - first.wall, MAT.air);
  // Second floor, jettied again over a proud floor band, bowing out a cell in the middle of the front.
  b.add(x0 - 1, first.y[1], second.z[0] - 1, x1 + 1, second.y[0], second.z[1] + 1, kit.trim);
  b.add(x0, second.y[0], second.z[0], x1, second.y[1], second.z[1], kit.wall);
  b.add(second.bow.x[0], second.y[0], second.z[1], second.bow.x[1], second.y[1], second.bow.z, kit.wall);
  b.add(x0 + second.wall, second.y[0], second.z[0] + second.wall, x1 - second.wall, second.y[1], second.z[1] - second.wall, MAT.air);
  // The wall plate the roof sits on, which is also the attic floor.
  b.add(x0, plate.y[0], second.z[0], x1, plate.y[1], second.z[1], kit.trim);
  b.add(second.bow.x[0], plate.y[0], second.z[1], second.bow.x[1], plate.y[1], second.bow.z, kit.trim);

  // Timber framing, a cell proud of the plaster: sill and head beams, posts, and braces where the panels are wide.
  const beams = (face: Face, plane: number, u0: number, u1: number, y0: number, y1: number) => {
    slab(b, face, plane, -1, 0, u0, u1, y0, y0 + 1, kit.trim);
    slab(b, face, plane, -1, 0, u0, u1, y1 - 1, y1, kit.trim);
  };
  const posts = (face: Face, plane: number, at: readonly number[], y0: number, y1: number) => {
    for (const u of at) slab(b, face, plane, -1, 0, u, u + 2, y0, y1, kit.trim);
  };
  /** A diagonal brace from (u0, y0) to (u1, y1) in two-cell steps. */
  const brace = (face: Face, plane: number, u0: number, u1: number, y0: number, y1: number) => {
    const n = Math.max(1, Math.round(Math.abs(u1 - u0) / 2)), dir = u1 > u0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const ua = u0 + dir * 2 * i, ya = y0 + Math.round(((y1 - y0) * i) / n), yb = y0 + Math.round(((y1 - y0) * (i + 1)) / n);
      slab(b, face, plane, -1, 0, Math.min(ua, ua + 2 * dir), Math.max(ua, ua + 2 * dir), ya, yb + 1, kit.trim);
    }
  };
  const [f0, f1] = first.y, [s0, s1] = second.y;
  // First floor.
  beams('south', first.z[1], x0, x1, f0, f1);
  posts('south', first.z[1], [16, 40, 62, 82, 102, 126], f0, f1);
  beams('north', first.z[0], x0, x1, f0, f1);
  posts('north', first.z[0], [16, 54, 88, 126], f0, f1);
  for (const [face, plane] of [['east', x1], ['west', x0]] as const) {
    beams(face, plane, first.z[0], first.z[1], f0, f1);
    posts(face, plane, [first.z[0], 67, first.z[1] - 2], f0, f1);
    brace(face, plane, 67, 55, f0 + 1, f1 - 1);
    brace(face, plane, 69, 81, f0 + 1, f1 - 1);
  }
  // Second floor, with the bowed middle carrying its own beams and a St Andrew's cross between its windows.
  beams('south', second.z[1], x0, second.bow.x[0], s0, s1);
  beams('south', second.z[1], second.bow.x[1], x1, s0, s1);
  beams('south', second.bow.z, second.bow.x[0], second.bow.x[1], s0, s1);
  posts('south', second.z[1], [16, 42, 100, 126], s0, s1);
  posts('south', second.bow.z, [44, 63, 79, 98], s0, s1);
  brace('south', second.bow.z, 65, 79, s0 + 1, s1 - 1);
  brace('south', second.bow.z, 79, 65, s0 + 1, s1 - 1);
  beams('north', second.z[0], x0, x1, s0, s1);
  posts('north', second.z[0], [16, 54, 88, 126], s0, s1);
  for (const [face, plane] of [['east', x1], ['west', x0]] as const) {
    beams(face, plane, second.z[0], second.z[1], s0, s1);
    posts(face, plane, [second.z[0], 67, second.z[1] - 2], s0, s1);
  }
  // The four corner posts that close the frame where two faces meet.
  for (const [y0, y1, z0, z1] of [[f0, f1, first.z[0], first.z[1]], [s0, s1, second.z[0], second.z[1]]] as const) {
    for (const x of [x0 - 1, x1]) for (const z of [z0 - 1, z1]) b.add(x, y0, z, x + 1, y1, z + 1, kit.trim);
  }
}

// ── The roof ─────────────────────────────────────────────────────────────────────────────────────────────────────

function roof(b: Boxes, kit: LandmarkKit): void {
  const { verge, front, back, shell, kick, eaves } = ROOF;
  const { x: [x0, x1] } = COPPER_KETTLE.stone;
  const wall = COPPER_KETTLE.second.wall;
  for (let y = COPPER_KETTLE.plate.y[1]; y < ROOF.ridge; y++) {
    const full = roofSpan(y, 0)!;
    // Timber bargeboards on the verges, then the roof mass in settled segments, the hollow attic inside it, and
    // the two plastered gables between the slopes.
    b.add(verge[0], y, full[0], verge[0] + 1, y + 1, full[1], kit.trim);
    b.add(verge[1] - 1, y, full[0], verge[1], y + 1, full[1], kit.trim);
    let start = verge[0] + 1, last: readonly [number, number] | null = null;
    const flush = (end: number) => { if (last) b.add(start, y, last[0], end, y + 1, last[1], kit.roof); };
    for (const [s0, , s] of COPPER_KETTLE.sag) {
      const span = roofSpan(y, sagAt(s, y)), a = Math.max(s0, verge[0] + 1);
      if (last && span && span[0] === last[0] && span[1] === last[1]) continue;
      flush(a);
      start = a; last = span;
    }
    flush(verge[1] - 1);
    b.add(verge[0], y, full[0] + shell, verge[1], y + 1, full[1] - shell, MAT.air);
    b.add(x0, y, full[0] + shell, x0 + wall, y + 1, full[1] - shell, kit.wall);
    b.add(x1 - wall, y, full[0] + shell, x1, y + 1, full[1] - shell, kit.wall);
  }
  // The kicked eaves: a flatter run of two rows per cell of fall, three cells thick, out past the walls front and
  // back, with bargeboard ends and a timber fascia.
  // The outer half of the eaves has settled a cell along the middle of each long side.
  const [e0, e1] = ROOF.eaveSag;
  for (let r = 0; r < kick; r += 2) {
    const top = eaves - r / 2;
    for (const [z0, z1] of [[front + r, front + r + 2], [back - r - 2, back - r]] as const) {
      b.add(verge[0], top - 3, z0, verge[1], top, z1, kit.trim);
      b.add(verge[0] + 1, top - 3, z0, verge[1] - 1, top, z1, kit.roof);
      if (r < kick / 2) continue;
      b.add(e0, top - 1, z0, e1, top, z1, MAT.air);
      b.add(e0, top - 4, z0, e1, top - 3, z1, kit.roof);
    }
  }
  const low = eaves - (kick - 2) / 2;
  for (const z of [front + kick - 1, back - kick]) {
    b.add(verge[0], low - 3, z, verge[1], low - 1, z + 1, kit.trim);
    b.add(e0, low - 4, z, e1, low - 3, z + 1, kit.trim);
    b.add(e0, low - 2, z, e1, low - 1, z + 1, kit.roof);
  }
  // Rafter feet under the eaves, every eight cells.
  for (let x = x0 + 2; x < x1 - 2; x += 8) {
    b.add(x, eaves - 6, front, x + 2, eaves - 4, front + 4, kit.trim);
    b.add(x, eaves - 6, back - 4, x + 2, eaves - 4, back, kit.trim);
  }
  // The ridge roll, settling with the ridge.
  for (const [s0, s1, s] of COPPER_KETTLE.sag) {
    const top = ROOF.ridge - s;
    b.add(s0, top - 2, ROOF.cz - 3, s1, top, ROOF.cz + 3, kit.roof);
    b.add(s0, top, ROOF.cz - 1, s1, top + 1, ROOF.cz + 1, kit.roof);
  }
  // A weathervane over the west gable: an iron rod, a brass ball, and a copper arrow with a broad tail.
  const vx = x0 + 1, vz = ROOF.cz, vy = ROOF.ridge + 1;
  b.add(vx, vy, vz - 1, vx + 2, vy + 14, vz + 1, kit.iron);
  b.add(vx - 1, vy + 3, vz - 2, vx + 3, vy + 5, vz + 2, MAT.brass);
  b.add(vx, vy + 10, vz - 7, vx + 2, vy + 11, vz + 7, MAT.forgeCopper);
  b.add(vx, vy + 9, vz + 4, vx + 2, vy + 12, vz + 6, MAT.forgeCopper);
  b.add(vx, vy + 8, vz - 7, vx + 2, vy + 13, vz - 4, MAT.forgeCopper);
  b.add(vx, vy + 14, vz - 1, vx + 2, vy + 15, vz + 1, MAT.brass);
  // Tie beams and posts on the gables, a cell proud of the plaster under the verge.
  for (const [face, plane] of [['east', x1], ['west', x0]] as const) {
    slab(b, face, plane, -1, 0, back + 2, front - 2, COPPER_KETTLE.plate.y[0], COPPER_KETTLE.plate.y[1] + 1, kit.trim);
    for (const z of [44, 56, 78, 90]) {
      const d = z < ROOF.cz ? ROOF.cz - 1 - z : z - ROOF.cz, top = roofTop(d + 2) - shell - 1;
      slab(b, face, plane, -1, 0, z, z + 2, COPPER_KETTLE.plate.y[1], top, kit.trim);
    }
    slab(b, face, plane, -1, 0, ROOF.cz - 1, ROOF.cz + 1, COPPER_KETTLE.plate.y[1], ROOF.ridge - shell - 3, kit.trim);
  }
  // A little moss and lichen on the slates of the shaded back slope.
  for (let i = 0; i < 10; i++) {
    const x = 12 + Math.floor(hash(i, 1, 0, 303) * 116), w = 3 + Math.floor(hash(i, 2, 0, 303) * 6);
    const d = 30 + Math.floor(hash(i, 3, 0, 303) * 18), top = roofTop(d), z = ROOF.cz - 1 - d;
    b.add(x, top - 1, z, x + w, top, z + 1 + Math.floor(hash(i, 4, 0, 303) * 2), MAT.moss);
  }
}

function dormers(b: Boxes, kit: LandmarkKit): void {
  const { half, y, z } = COPPER_KETTLE.dormer;
  for (const { x } of COPPER_KETTLE.dormers) {
    // Plastered cheeks and front set into the slope, hollow behind the window, framed in timber.
    b.add(x - half, y[0], z[0], x + half, y[1], z[1], kit.wall);
    b.add(x - half + 2, y[0] + 4, z[0], x + half - 2, y[1] - 2, z[1] - 3, MAT.air);
    slab(b, 'south', z[1], -1, 0, x - half, x + half, y[0] + 3, y[0] + 4, kit.trim);
    slab(b, 'south', z[1], -1, 0, x - half, x - half + 2, y[0] + 3, y[1], kit.trim);
    slab(b, 'south', z[1], -1, 0, x + half - 2, x + half, y[0] + 3, y[1], kit.trim);
    // A steep little gable roof running back into the main slope, its bargeboards three cells out over a plaster
    // gable that is set back a cell behind them.
    for (let k = 0; k < 13; k++) {
      const w = half + 3 - k;
      if (w < 1) break;
      b.add(x - w, y[1] + k, z[0] - 4, x + w, y[1] + k + 1, z[1] + 3, kit.roof);
      b.add(x - w, y[1] + k, z[1] + 2, x + w, y[1] + k + 1, z[1] + 3, kit.trim);
      if (w > 2) {
        b.add(x - w + 2, y[1] + k, z[1] - 1, x + w - 2, y[1] + k + 1, z[1] + 2, kit.wall);
        b.add(x - w + 2, y[1] + k, z[1] + 2, x + w - 2, y[1] + k + 1, z[1] + 3, MAT.air);
      }
    }
  }
}

function chimneys(b: Boxes, kit: LandmarkKit): void {
  const { main, small } = COPPER_KETTLE.chimneys;
  // The great chimney behind the ridge: a stone stack that kinks east twice as it climbs, banded at each kink,
  // a heavy cap, and two pots of different heights.
  const [mx0, mx1] = main.x, [mz0, mz1] = main.z;
  b.add(mx0, main.y[0], mz0, mx1, 158, mz1, kit.stone);
  b.add(mx0 - 1, 156, mz0 - 1, mx1 + 1, 158, mz1 + 1, kit.band);
  b.add(mx0 + 1, 158, mz0, mx1 + 1, 166, mz1, kit.stone);
  b.add(mx0, 164, mz0 - 1, mx1 + 2, 166, mz1 + 1, kit.band);
  b.add(mx0 + 2, 166, mz0, mx1 + 2, 170, mz1, kit.stone);
  b.add(mx0 + 1, 170, mz0 - 1, mx1 + 3, main.y[1], mz1 + 1, kit.band);
  for (let i = 0; i < 9; i++) {
    const y = 146 + Math.floor(hash(i, 1, 0, 304) * 9), w = 2 + Math.floor(hash(i, 2, 0, 304) * 4), u = Math.floor(hash(i, 3, 0, 304) * (12 - w));
    if (i % 2) b.add(mx0 + u, y, mz1, mx0 + u + w, y + 2, mz1 + 1, kit.rock);
    else b.add(mx1 - 1, y, mz0 + u, mx1, y + 2, mz0 + u + w, kit.rock);
  }
  const [px, py, pz] = main.mouth;
  b.octagon(px, pz, 2, 0, main.y[1], py, kit.base);
  b.octagon(px, pz, 3, 1, main.y[1], main.y[1] + 1, kit.base);
  b.add(px - 1, py - 3, pz - 1, px + 1, py, pz + 1, MAT.air);
  b.octagon(px + 5, pz + 3, 2, 0, main.y[1], py - 2, kit.base);
  b.add(px + 4, py - 5, pz + 2, px + 6, py - 2, pz + 4, MAT.air);
  // The small chimney in front of the ridge: rendered, leaning west at its band, with a stone cap and one pot.
  const [sx0, sx1] = small.x, [sz0, sz1] = small.z;
  b.add(sx0, small.y[0], sz0, sx1, 140, sz1, kit.wall);
  b.add(sx0 - 1, 138, sz0 - 1, sx1 + 1, 140, sz1 + 1, kit.band);
  b.add(sx0 - 1, 140, sz0, sx1 - 1, 146, sz1, kit.wall);
  b.add(sx0 - 2, 146, sz0 - 1, sx1, small.y[1], sz1 + 1, kit.stone);
  const [qx, qy, qz] = small.mouth;
  b.octagon(qx, qz, 2, 0, small.y[1], qy, kit.base);
  b.add(qx - 1, qy - 3, qz - 1, qx + 1, qy, qz + 1, MAT.air);
}

// ── Windows ──────────────────────────────────────────────────────────────────────────────────────────────────────

const WINDOWS: readonly WindowSpec[] = (() => {
  const { stone, first, second } = COPPER_KETTLE;
  const list: WindowSpec[] = [];
  const st = { kind: 'stone' as const, w: 14, y: 10, h: 14, wall: stone.wall };
  const f1 = { kind: 'timber' as const, w: 10, y: 38, h: 14, wall: first.wall };
  const f2 = { kind: 'timber' as const, w: 10, y: 62, h: 12, wall: second.wall };
  // Front.
  list.push({ ...st, id: 'front-ground-west', face: 'south', plane: stone.z[1], u: 35 });
  list.push({ ...st, id: 'front-ground-east', face: 'south', plane: stone.z[1], u: 99 });
  for (const [u, id] of [[30, 'west'], [52, 'mid-west'], [92, 'mid-east'], [114, 'east']] as const) list.push({ ...f1, id: `front-first-${id}`, face: 'south', plane: first.z[1], u });
  list.push({ ...f1, id: 'front-balcony-door', face: 'south', plane: first.z[1], u: 72, y: 34, h: 20, door: true });
  list.push({ ...f2, id: 'front-second-west', face: 'south', plane: second.z[1], u: 30, shutters: true });
  list.push({ ...f2, id: 'front-second-mid-west', face: 'south', plane: second.bow.z, u: 56, wall: second.wall + 1, flowers: true });
  list.push({ ...f2, id: 'front-second-mid-east', face: 'south', plane: second.bow.z, u: 88, wall: second.wall + 1, flowers: true });
  list.push({ ...f2, id: 'front-second-east', face: 'south', plane: second.z[1], u: 114, shutters: true });
  // Sides.
  for (const [face, plane] of [['east', stone.x[1]], ['west', stone.x[0]]] as const) {
    // On the flanks u is z, so the window nearer the back has the smaller u.
    for (const [u, name] of [[44, 'back'], [92, 'front']] as const) {
      list.push({ ...st, id: `${face}-ground-${name}`, face, plane, u, shutters: true });
      list.push({ ...f1, id: `${face}-first-${name}`, face, plane, u, flowers: name === 'front' });
      list.push({ ...f2, id: `${face}-second-${name}`, face, plane, u });
    }
    list.push({ kind: 'timber', id: `${face}-gable`, face, plane, u: ROOF.cz, w: 8, y: 96, h: 12, wall: second.wall, shutters: true });
  }
  // Back.
  for (const [u, id] of [[40, 'west'], [104, 'east']] as const) list.push({ ...st, id: `back-ground-${id}`, face: 'north', plane: stone.z[0], u });
  for (const [u, id] of [[40, 'west'], [72, 'mid'], [104, 'east']] as const) {
    list.push({ ...f1, id: `back-first-${id}`, face: 'north', plane: first.z[0], u });
    list.push({ ...f2, id: `back-second-${id}`, face: 'north', plane: second.z[0], u });
  }
  // Dormers.
  const { dormer } = COPPER_KETTLE;
  for (const { id, x } of COPPER_KETTLE.dormers) {
    list.push({ kind: 'timber', id, face: 'south', plane: dormer.z[1], u: x, w: dormer.window.w, y: dormer.window.y[0], h: dormer.window.y[1] - dormer.window.y[0], wall: 4 });
  }
  return list;
})();

/** Glass sits two cells in from the face of plaster, four in from the face of stone. */
const glassDepth = (spec: WindowSpec) => (spec.kind === 'stone' ? 4 : 2);

function windows(b: InnBoxes, kit: LandmarkKit): void {
  for (const spec of WINDOWS) {
    const { face, plane, u, w, y, h, wall } = spec;
    const u0 = u - w / 2, u1 = u + w / 2, y1 = y + h, g = glassDepth(spec);
    if (spec.kind === 'stone') {
      // A pale segmental arch of voussoirs, a proud sill, and the opening cut through the thick wall.
      slab(b, face, plane, 0, 1, u0 - 2, u1 + 2, y1, y1 + 3, kit.band);
      slab(b, face, plane, -1, 0, u - 1, u + 1, y1 + 1, y1 + 4, kit.band);
      slab(b, face, plane, -2, 1, u0 - 1, u1 + 1, y - 2, y, kit.band);
      slab(b, face, plane, -1, wall, u0, u1, y, y1, MAT.air);
      slab(b, face, plane, 0, wall, u0 + 2, u1 - 2, y1, y1 + 1, MAT.air);
      slab(b, face, plane, g, g + 1, u0, u1, y, y1, MAT.glass);
      slab(b, face, plane, g, g + 1, u0 + 2, u1 - 2, y1, y1 + 1, MAT.glass);
    } else {
      // A proud timber casing with a little hood and sill board.
      slab(b, face, plane, -1, 0, u0 - 1, u1 + 1, y - 1, y1 + 1, kit.trim);
      slab(b, face, plane, -2, 0, u0 - 2, u1 + 2, y1 + 1, y1 + 2, kit.trim);
      if (!spec.door) slab(b, face, plane, -2, 0, u0 - 2, u1 + 2, y - 2, y - 1, kit.trim);
      slab(b, face, plane, -1, wall, u0, u1, y, y1, MAT.air);
      slab(b, face, plane, g, g + 1, u0, u1, y, y1, MAT.glass);
    }
    // Mullion and transom: a cross of timber in the glass.
    const transom = spec.door ? y + 8 : y + Math.round(h * 0.62);
    slab(b, face, plane, g, g + 1, u - 1, u + 1, y, y1, kit.trim);
    slab(b, face, plane, g, g + 1, u0, u1, transom, transom + 1, kit.trim);
    if (spec.door) slab(b, face, plane, g, g + 1, u0, u1, y, y + 8, kit.trim);
    if (spec.shutters) shutters(b, kit, spec);
    if (spec.flowers) flowerBox(b, kit, face, plane, u0 - 2, u1 + 2, y - 2, hash(u, y, plane, 305));
    const normal = face === 'south' || face === 'east' ? plane - g : plane + g;
    const centre: [number, number, number] = face === 'south' || face === 'north' ? [u, y + h / 2, normal] : [normal, y + h / 2, u];
    b.windows.push({ id: spec.id, centre, width: w, height: h, facing: face });
  }
}

/** Board shutters folded back against the wall, each with a batten and a heart cut through it. */
function shutters(b: Boxes, kit: LandmarkKit, spec: WindowSpec): void {
  const { face, plane, u, w, y, h } = spec;
  const sw = Math.ceil(w / 2), u0 = u - w / 2, u1 = u + w / 2, gap = 1;
  for (const [a, c] of [[u0 - gap - sw, u0 - gap], [u1 + gap, u1 + gap + sw]] as const) {
    slab(b, face, plane, -1, 0, a, c, y, y + h, kit.trim);
    slab(b, face, plane, -2, -1, a, c, y + 2, y + 3, MAT.bark);
    slab(b, face, plane, -2, -1, a, c, y + h - 3, y + h - 2, MAT.bark);
    const m = Math.floor((a + c) / 2);
    slab(b, face, plane, -1, 0, m - 1, m + 1, y + Math.floor(h / 2), y + Math.floor(h / 2) + 1, MAT.air);
    slab(b, face, plane, -1, 0, m, m + 1, y + Math.floor(h / 2) - 1, y + Math.floor(h / 2), MAT.air);
  }
}

/**
 * A flower box hung below a window: a timber trough, a cushion of leaves, bright heads of geranium and cornflower,
 * and a few trails falling over the front. Everything sits below `top`, so the window above stays clear.
 */
function flowerBox(b: Boxes, kit: LandmarkKit, face: Face, plane: number, u0: number, u1: number, top: number, seed: number): void {
  const s = Math.floor(seed * 1000);
  slab(b, face, plane, -4, 0, u0, u1, top - 4, top - 2, kit.trim);
  slab(b, face, plane, -4, -1, u0, u1, top - 2, top - 1, MAT.leaf);
  slab(b, face, plane, -3, -1, u0 + 1, u1 - 1, top - 1, top, MAT.leaf);
  for (let u = u0 + 1; u < u1 - 1; u += 2) {
    const r = hash(u, s, 1, 306);
    if (r < 0.25) continue;
    slab(b, face, plane, -3 - (r > 0.8 ? 1 : 0), -2, u, u + 1, top - 1, top, r < 0.7 ? MAT.petal : MAT.blueFlower);
  }
  for (let u = u0 + 1; u < u1 - 1; u += 3) {
    const r = hash(u, s, 2, 306), drop = 2 + Math.floor(r * 4);
    slab(b, face, plane, -5, -4, u, u + 1, top - 4 - drop, top - 2, MAT.leaf);
    if (r > 0.45) slab(b, face, plane, -5, -4, u, u + 1, top - 5 - drop, top - 4 - drop, MAT.petal);
  }
}

// ── The door ─────────────────────────────────────────────────────────────────────────────────────────────────────

function door(b: Boxes, kit: LandmarkKit): void {
  const { opening, arch, leaf, threshold, steps } = COPPER_KETTLE.door;
  const face = COPPER_KETTLE.stone.z[1];
  // A pale case a cell proud of the stone, its arch ring of voussoirs, and a keystone that pushes up to the joists.
  b.add(opening.x[0] - 3, threshold, face, opening.x[1] + 3, 26, face + 1, kit.band);
  for (const [y, x0, x1] of [[26, 62, 82], [27, 63, 81], [28, 64, 80], [29, 66, 78], [30, 69, 75]] as const) b.add(x0, y, face, x1, y + 1, face + 1, kit.band);
  for (let y = threshold, k = 0; y < 24; y += 4, k++) if (k % 2) {
    b.add(opening.x[0] - 3, y, face, opening.x[0] - 2, y + 4, face + 1, kit.stone);
    b.add(opening.x[1] + 2, y, face, opening.x[1] + 3, y + 4, face + 1, kit.stone);
  }
  b.add(71, 27, face, 73, 32, face + 2, kit.band);
  // The reveal, cut back to the leaf, and the arched head.
  b.add(opening.x[0], opening.y[0], leaf.z[1], opening.x[1], opening.y[1], opening.z[1], MAT.air);
  for (const [y, x0, x1] of arch) b.add(x0, y, leaf.z[1], x1, y + 1, opening.z[1], MAT.air);
  // The leaf: broad planks with dark seams, following the arch.
  b.add(leaf.x[0], leaf.y[0], leaf.z[0], leaf.x[1], 24, leaf.z[1], kit.trim);
  for (const [y, x0, x1] of arch) b.add(x0, y, leaf.z[0], x1, y + 1, leaf.z[1], kit.trim);
  for (const x of [67, 71, 72, 76]) b.add(x, leaf.y[0], leaf.z[1] - 1, x + 1, 24, leaf.z[1], MAT.bark);
  // Long strap hinges, studs, a bright ring and a small barred grille to look out through.
  for (const y of [7, 19]) b.add(leaf.x[0], y, leaf.z[1], leaf.x[0] + 11, y + 1, leaf.z[1] + 1, kit.iron);
  for (const y of [7, 19]) b.add(leaf.x[0] + 10, y - 1, leaf.z[1], leaf.x[0] + 11, y + 2, leaf.z[1] + 1, kit.iron);
  for (const [x, y] of [[66, 12], [77, 12], [66, 23], [77, 23]] as const) b.add(x, y, leaf.z[1], x + 1, y + 1, leaf.z[1] + 1, kit.iron);
  b.add(74, 12, leaf.z[1], 76, 13, leaf.z[1] + 1, kit.metal);
  b.add(74, 10, leaf.z[1], 75, 12, leaf.z[1] + 1, kit.metal);
  b.add(70, 17, leaf.z[0], 74, 21, leaf.z[1], MAT.glass);
  b.add(69, 16, leaf.z[1], 75, 22, leaf.z[1] + 1, kit.iron);
  b.add(70, 17, leaf.z[1], 74, 21, leaf.z[1] + 1, MAT.air);
  for (const x of [71, 73]) b.add(x, 17, leaf.z[1], x + 1, 21, leaf.z[1] + 1, kit.iron);
  // The worn sill and the steps down to the court.
  b.add(opening.x[0], 0, leaf.z[1], opening.x[1], threshold, opening.z[1], kit.stone);
  for (const [top, z0, z1, x0, x1] of steps) {
    b.add(x0, 0, z0, x1, top, z1, kit.stone);
    b.add(x0, top - 1, z1 - 1, x1, top, z1, kit.band);
  }
}

// ── The balcony ──────────────────────────────────────────────────────────────────────────────────────────────────

function balcony(b: Boxes, kit: LandmarkKit): void {
  const { x, deck, z, rail } = COPPER_KETTLE.balcony;
  const face = COPPER_KETTLE.stone.z[1];
  // Cantilevered joists out of the stone, their ends showing under the deck, and two knee braces at the ends.
  for (const jx of [18, 27, 36, 56, 88, 97, 106, 115, 124]) b.add(jx, deck[0] - 2, face, jx + 2, deck[0], z[1], kit.trim);
  b.add(x[0], deck[0] - 2, z[1] - 2, x[1], deck[0], z[1], kit.trim);
  for (const jx of [18, 124]) for (let k = 0; k < 6; k++) b.add(jx, 20 + 2 * k, face, jx + 2, 22 + 2 * k, face + 2 + 2 * k, kit.trim);
  // The deck boards.
  b.add(x[0], deck[0], face, x[1], deck[1], z[1], kit.trim);
  b.add(x[0], deck[0], z[1] - 1, x[1], deck[1], z[1], MAT.bark);
  // The carved railing: a solid board panel front and sides, sawn into pairs of boards with vase-shaped gaps,
  // a bottom rail, a broad top rail and posts.
  const [ry0, ry1] = rail.y, zr = rail.z;
  b.add(x[0], ry0, zr, x[1], ry1 - 2, zr + 1, kit.trim);
  b.add(x[0], ry0, COPPER_KETTLE.first.z[1], x[0] + 1, ry1 - 2, zr, kit.trim);
  b.add(x[1] - 1, ry0, COPPER_KETTLE.first.z[1], x[1], ry1 - 2, zr, kit.trim);
  for (let gx = x[0] + 4; gx < x[1] - 3; gx += 4) {
    if ((gx - x[0]) % 28 === 0) continue;
    b.add(gx, ry0 + 1, zr, gx + 1, ry1 - 3, zr + 1, MAT.air);
    b.add(gx - 1, ry0 + 4, zr, gx + 2, ry0 + 8, zr + 1, MAT.air);
  }
  for (const side of [x[0], x[1] - 1]) for (const gz of [121, 125]) {
    b.add(side, ry0 + 1, gz, side + 1, ry1 - 3, gz + 1, MAT.air);
    b.add(side, ry0 + 4, gz - 1, side + 1, ry0 + 8, gz + 2, MAT.air);
  }
  b.add(x[0], ry0, zr - 1, x[1], ry0 + 1, zr + 2, kit.trim);
  b.add(x[0] - 1, ry1 - 2, zr - 1, x[1] + 1, ry1, zr + 2, kit.trim);
  b.add(x[0] - 1, ry1 - 2, COPPER_KETTLE.first.z[1], x[0] + 2, ry1, zr, kit.trim);
  b.add(x[1] - 2, ry1 - 2, COPPER_KETTLE.first.z[1], x[1] + 1, ry1, zr, kit.trim);
  for (let px = x[0]; px < x[1]; px += 28) b.add(px, ry0, zr - 1, px + 2, ry1 - 2, zr + 2, MAT.bark);
  b.add(x[1] - 2, ry0, zr - 1, x[1], ry1 - 2, zr + 2, MAT.bark);
  // Geranium boxes hung outside the rail between the posts.
  for (const [u0, u1] of [[18, 38], [46, 64], [80, 98], [106, 126]] as const) railBox(b, kit, u0, u1, hash(u0, u1, 0, 307));
}

/** A flower box hung on the outside of the balcony rail, with geraniums standing up and trailing down. */
function railBox(b: Boxes, kit: LandmarkKit, u0: number, u1: number, seed: number): void {
  const { rail } = COPPER_KETTLE.balcony, z0 = rail.z + 2, top = rail.y[1];
  const s = Math.floor(seed * 1000);
  b.add(u0, top - 5, z0, u1, top - 1, z0 + 3, kit.trim);
  b.add(u0, top - 1, z0, u1, top, z0 + 3, MAT.leaf);
  b.add(u0 + 1, top, z0, u1 - 1, top + 1, z0 + 3, MAT.leaf);
  for (let u = u0 + 1; u < u1 - 1; u += 2) {
    const r = hash(u, s, 1, 308);
    if (r < 0.2) continue;
    const m = r < 0.78 ? MAT.petal : MAT.blueFlower, z = z0 + Math.floor(hash(u, s, 2, 308) * 3);
    b.add(u, top + 1, z, u + 1, top + 2 + (r > 0.6 ? 1 : 0), z + 1, r > 0.9 ? MAT.leaf : m);
    if (r > 0.6) b.add(u, top + 2, z, u + 1, top + 3, z + 1, m);
  }
  for (let u = u0 + 1; u < u1 - 1; u += 2) {
    const r = hash(u, s, 3, 308), drop = 2 + Math.floor(r * 6);
    if (r < 0.3) continue;
    b.add(u, top - 1 - drop, z0 + 3, u + 1, top, z0 + 4, MAT.leaf);
    if (r > 0.55) b.add(u, top - 2 - drop, z0 + 3, u + 1, top - 1 - drop, z0 + 4, MAT.petal);
  }
}

// ── Lanterns and the sign ────────────────────────────────────────────────────────────────────────────────────────

function lanterns(b: Boxes, kit: LandmarkKit): void {
  const { glass } = COPPER_KETTLE.lantern, face = COPPER_KETTLE.stone.z[1];
  for (const { x } of COPPER_KETTLE.lanterns) {
    // A wall plate and a bracket with a curl, a hanger, and a caged lantern with a bright cap, finial and foot.
    b.add(x, 20, face, x + 1, 27, face + 1, kit.iron);
    b.add(x, 25, face, x + 1, 26, face + 5, kit.iron);
    b.add(x, 26, face + 4, x + 1, 27, face + 6, kit.iron);
    b.add(x, 21, face + 1, x + 1, 22, face + 2, kit.iron);
    for (let k = 0; k < 3; k++) b.add(x, 22 + k, face + 1 + k, x + 1, 23 + k, face + 3 + k, kit.iron);
    b.add(x, 24, face + 3, x + 1, 25, face + 4, kit.iron);
    b.add(x - 1, 23, glass.z[0], x + 2, 24, glass.z[1], kit.metal);
    b.add(x - 2, 22, glass.z[0] - 1, x + 3, 23, glass.z[1] + 1, kit.metal);
    for (const dx of [-2, 2]) for (const dz of [glass.z[0] - 1, glass.z[1]]) b.add(x + dx, glass.y[0], dz, x + dx + 1, glass.y[1], dz + 1, kit.iron);
    b.add(x - 1, glass.y[0], glass.z[0], x + 2, glass.y[1], glass.z[1], MAT.glass);
    b.add(x - 2, glass.y[0] - 1, glass.z[0] - 1, x + 3, glass.y[0], glass.z[1] + 1, kit.metal);
    b.add(x, glass.y[0] - 2, glass.z[0] + 1, x + 1, glass.y[0] - 1, glass.z[0] + 2, kit.metal);
  }
}

/** The kettle in profile, rows top to bottom, columns towards the court: H handle, B brass, D knob, K body, S spout. */
export const KETTLE_PROFILE = [
  '......HHHHHH......',
  '.....HH....HH.....',
  '.....H..DD..H.....',
  '.....HBBBBBBH.....',
  '....KKKKKKKKK....S',
  '...KKKKKKKKKKK..SS',
  '..KKKKKKKKKKKK.SS.',
  '..KKKKKKKKKKKKSS..',
  '..KKKKKKKKKKKKS...',
  '..KKKKKKKKKKKK....',
  '...KKKKKKKKKK.....',
  '....BBBBBBBB......',
] as const;

function sign(b: Boxes, kit: LandmarkKit): void {
  const { arm, kettle } = COPPER_KETTLE.sign, face = COPPER_KETTLE.stone.z[1];
  // The brass bracket: a wall plate, the arm with a scroll at its end, and a raking brace with a curl.
  b.add(arm.x - 1, 21, face, arm.x + 2, 31, face + 1, MAT.brass);
  b.add(arm.x, arm.y[0], arm.z[0], arm.x + 1, arm.y[1], arm.z[1], MAT.brass);
  b.add(arm.x, arm.y[0] - 2, arm.z[1] - 1, arm.x + 1, arm.y[0], arm.z[1], MAT.brass);
  b.add(arm.x, arm.y[0] - 2, arm.z[1] - 2, arm.x + 1, arm.y[0] - 1, arm.z[1] - 1, MAT.brass);
  b.add(arm.x, arm.y[1], arm.z[1] - 2, arm.x + 1, arm.y[1] + 1, arm.z[1] + 1, MAT.brass);
  for (let k = 0; k < 6; k++) b.add(arm.x, 22 + k, face + 1 + k, arm.x + 1, 23 + k, face + 3 + k, MAT.brass);
  b.add(arm.x, 25, face + 1, arm.x + 1, 26, face + 3, MAT.brass);
  // The kettle hangs from a ring at the middle of its handle.
  const material: Record<string, number> = { H: MAT.forgeCopper, K: MAT.forgeCopper, S: MAT.forgeCopper, B: MAT.brass, D: kit.iron };
  const thick: Record<string, readonly [number, number]> = { H: [arm.x, arm.x + 1], S: [arm.x, arm.x + 1], D: [arm.x, arm.x + 1], B: kettle.x, K: kettle.x };
  KETTLE_PROFILE.forEach((row, i) => {
    const y = kettle.top - 1 - i;
    let start = 0;
    for (let c = 1; c <= row.length; c++) {
      if (c < row.length && row[c] === row[start]) continue;
      const mark = row[start]!;
      if (mark !== '.') b.add(thick[mark]![0], y, kettle.z0 + start, thick[mark]![1], y + 1, kettle.z0 + c, material[mark]!);
      start = c;
    }
  });
  // A rounder belly, and a bright band round it.
  for (let i = 6; i <= 9; i++) b.add(kettle.belly[0], kettle.top - 1 - i, kettle.z0 + 3, kettle.belly[1], kettle.top - i, kettle.z0 + 13, MAT.forgeCopper);
  b.add(kettle.belly[0], kettle.top - 8, kettle.z0 + 2, kettle.belly[1], kettle.top - 7, kettle.z0 + 14, MAT.brass);
  const ring = kettle.z0 + 8;
  b.add(arm.x, kettle.top, ring, arm.x + 1, arm.y[0], ring + 2, kit.iron);
}

// ── At the door: bench, barrels, firewood and ivy ────────────────────────────────────────────────────────────────

function frontage(b: Boxes, kit: LandmarkKit): void {
  const { bench, woodpile } = COPPER_KETTLE;
  // A plank bench against the wall, on two stout legs, with a back rail pegged to the stone.
  b.add(bench.x[0], bench.y[0], bench.z[0], bench.x[1], bench.y[1], bench.z[1], kit.trim);
  for (const x of [bench.x[0] + 1, bench.x[1] - 3]) b.add(x, 0, bench.z[0] + 1, x + 2, bench.y[0], bench.z[1] - 1, MAT.bark);
  b.add(bench.x[0], 6, bench.z[0], bench.x[1], 8, bench.z[0] + 1, kit.trim);
  for (const x of [bench.x[0] + 1, bench.x[1] - 3]) b.add(x, bench.y[1], bench.z[0], x + 2, 6, bench.z[0] + 1, kit.trim);
  // Two hooped barrels and a keg on its side, under the sign.
  for (const [cx, cz, h] of [[45, 121, 9], [53, 120, 8]] as const) {
    b.octagon(cx, cz, 3, 2, 0, 1, kit.trim);
    b.octagon(cx, cz, 3, 1, 1, h - 1, kit.trim);
    b.octagon(cx, cz, 3, 2, h - 1, h, kit.trim);
    for (const y of [1, h - 3]) b.octagon(cx, cz, 3, 1, y, y + 1, kit.iron);
    b.octagon(cx, cz, 2, 1, h - 1, h, MAT.bark);
  }
  b.add(40, 0, 126, 46, 4, 130, kit.trim);
  b.add(41, 0, 125, 45, 5, 131, kit.trim);
  b.add(40, 2, 125, 46, 3, 131, kit.iron);
  b.add(42, 1, 131, 44, 3, 132, MAT.bark);
  // The winter's firewood under the balcony: split logs stacked end-out, light faces among dark bark.
  const [wx0, wx1] = woodpile.x, [wz0, wz1] = woodpile.z;
  b.add(wx0, 0, wz0, wx1, woodpile.y[1], wz1, MAT.bark);
  for (let y = 0; y < woodpile.y[1]; y += 2) {
    for (let x = wx0 + (y % 4 ? 1 : 0); x < wx1 - 1; x += 3) {
      const r = hash(x, y, 0, 309);
      if (r < 0.3) continue;
      b.add(x, y, wz1 - (r > 0.85 ? 0 : 1), x + 2, y + 2, wz1 + (r > 0.85 ? 1 : 0), r < 0.75 ? kit.trim : MAT.earth);
    }
  }
  for (let x = wx0; x < wx1; x += 3) {
    const h = Math.floor(hash(x, 1, 0, 310) * 3);
    if (h) b.add(x, woodpile.y[1], wz0 + 1, x + 3, woodpile.y[1] + h, wz1 - 1, MAT.bark);
  }
  // A chopping block with its axe.
  b.octagon(102, 129, 3, 1, 0, 5, MAT.bark);
  b.octagon(102, 129, 2, 1, 5, 6, kit.trim);
  b.add(101, 6, 128, 102, 13, 129, kit.trim);
  b.add(100, 5, 127, 103, 7, 129, kit.iron);
  // Ivy climbing the stone at the south-west corner.
  const face = COPPER_KETTLE.stone.z[1];
  for (let i = 0; i < 16; i++) {
    const y = Math.floor(hash(i, 1, 0, 311) * 28), x = 17 + Math.floor(hash(i, 2, 0, 311) * 7), w = 2 + Math.floor(hash(i, 3, 0, 311) * 3);
    b.add(x, y, face, x + w, Math.min(31, y + 3 + Math.floor(hash(i, 4, 0, 311) * 4)), face + 1, MAT.leaf);
  }
  b.add(19, 0, face, 21, 30, face + 1, MAT.leaf);
}

// ── Metadata ─────────────────────────────────────────────────────────────────────────────────────────────────────

function metadata(blueprint: VoxelBlueprint): Omit<LandmarkPiece, 'blueprint' | 'parts'> {
  const { door: d, bench, lanterns: lamps, lantern, chimneys: stacks, plinth } = COPPER_KETTLE;
  const depth = blueprint.size[2], ground = 6, head = 20, outer = depth + ground;
  const tops: number[] = [];
  for (let z = d.opening.z[0]; z < outer; z++) {
    const step = d.steps.find(([, z0, z1]) => z >= z0 && z < z1);
    tops.push(z < d.steps[0][1] ? d.threshold : step ? step[0] : 0);
  }
  const approach: LandmarkWalk = { id: 'door-approach', axis: 'z', along: [d.opening.z[0], outer], across: [d.opening.x[0], d.opening.x[1]], tops };
  const glazing: LandmarkGlazing[] = blueprint.windows.map(w => ({ id: w.id, opening: w.id, centre: [...w.centre] as Vec3, width: w.width, height: w.height, facing: w.facing }));
  const kettle = COPPER_KETTLE.sign;
  return {
    extent: extentOf(blueprint),
    footings: [
      { id: 'plinth', box: { from: [plinth.x[0], 0, plinth.z[0]], to: [plinth.x[1], 1, plinth.z[1]] }, embed: 0 },
      { id: 'steps', box: { from: [d.steps[2][3], 0, d.steps[0][1]], to: [d.steps[2][4], 1, d.steps[2][2]] }, embed: 0 },
    ],
    doorways: [{
      id: 'door', facing: 'south',
      opening: { from: [d.opening.x[0], d.opening.y[0], d.opening.z[0]], to: [d.opening.x[1], d.opening.y[1], d.opening.z[1]] },
      leaf: { from: [d.leaf.x[0], d.leaf.y[0], d.leaf.z[0]], to: [d.leaf.x[1], d.leaf.y[1], d.leaf.z[1]] },
      threshold: d.threshold, approach,
      clearance: { from: [d.opening.x[0], d.threshold, d.opening.z[0]], to: [d.opening.x[1], d.threshold + head, outer] },
      groundAt: 0, state: 'closed',
    }],
    walks: [approach],
    seats: [{ id: 'door-bench', box: { from: [bench.x[0], bench.y[0], bench.z[0] + 1], to: [bench.x[1], bench.y[1], bench.z[1]] }, facing: 'south' }],
    emitters: lamps.map(({ id, x }) => ({ id, kind: 'lantern' as const, position: [x + 0.5, (lantern.glass.y[0] + lantern.glass.y[1]) / 2, (lantern.glass.z[0] + lantern.glass.z[1]) / 2] as Vec3, reach: 48 })),
    sounds: [
      { id: 'sign-creak', kind: 'rope-creak', position: [kettle.arm.x + 0.5, kettle.arm.y[0], kettle.kettle.z0 + 9] },
      { id: 'chimney-wind', kind: 'wind', position: [...stacks.main.mouth] as Vec3 },
    ],
    mounts: [
      { id: 'chimney-smoke', position: [...stacks.main.mouth] as Vec3, axis: [0, 1, 0] },
      { id: 'chimney-smoke-small', position: [...stacks.small.mouth] as Vec3, axis: [0, 1, 0] },
    ],
    clear: [
      { id: 'doorway', role: 'doorway', box: { from: [d.opening.x[0], d.opening.y[0], d.opening.z[0]], to: [d.opening.x[1], d.opening.y[1], d.opening.z[1]] } },
      { id: 'door-approach', role: 'approach', box: { from: [d.opening.x[0], d.threshold, d.opening.z[1]], to: [d.opening.x[1], d.threshold + head, outer] } },
    ],
    affordances: [
      { id: 'enter', kind: 'enter', uses: ['door', 'door-approach'], status: 'needs-host', requires: 'A host door action and the inn interior; the leaf stays closed in this piece.' },
      { id: 'sit', kind: 'sit', uses: ['door-bench'], status: 'needs-host', requires: 'Host seat registration from the placed bench edge.' },
    ],
    glazing,
  };
}
