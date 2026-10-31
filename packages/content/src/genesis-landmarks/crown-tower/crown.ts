import { StyleIdSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../../materials';
import { CREST_HEIGHT, CREST_WIDTH, FLAG_HEIGHT, FLAG_LENGTH, crestGrid, type BannerCut, type CrestCharge, type CrestShape } from '../heraldry';
import { Boxes, LANDMARK_KITS, hash, type LandmarkKit } from '../kit';
import { extentOf, flagBlueprint } from '../parts';
import type { CellBox, LandmarkEmitter, LandmarkGlazing, LandmarkPiece, LandmarkWalk, LocalFacing } from '../types';

/**
 * The crown tower: the mountain kingdom's civic tower, drawn in the silhouette of a chess king, standing over a
 * board at the head of the pass. The kingdom's Chess category is read as a silhouette and a surface only, never as
 * a claim about the community: a wide stepped foot with a bead, a stone stem that narrows as it rises, a projecting
 * collar (the gallery with its balustrade), a head that flares outwards to a crown band, a coronet of eight points
 * round a dome, and a gilded orb and cross on top. In front of the door a terrace is laid as a board of eight by
 * eight squares in pale and dark stone, held at its corners by four rook-shaped posts that carry lanterns in their
 * battlements, with benches along both sides for those who come to watch.
 *
 * `head` follows the recipe's own landmark: a bell-garden kingdom hangs a bell in the head; every other kingdom
 * keeps a watch fire burning in it, seen through the four lookouts. The crest over the door, the two banners hung
 * from the collar and the flag on its mast carry the recipe's crest and banner grammar in snapped kit colours.
 *
 * Frame, in build cells: y = 0 is the ground under the terrace, whose top is `CROWN_TOWER.deck`. Front (+Z) is the
 * door and the board, with steps down to the ground at the board's front edge.
 */
export type CrownTowerHead = 'watch-fire' | 'bell';
export interface CrownTowerOptions {
  readonly style: StyleKey;
  readonly head: CrownTowerHead;
  readonly crest: { readonly shape: CrestShape; readonly charge: CrestCharge };
  readonly bannerCut: BannerCut;
  /** Snapped cloth materials: the field of crest, banners and flag, and their band. */
  readonly colours: { readonly field: number; readonly band: number };
}

export const CROWN_TOWER_SIZE: Vec3 = [128, 256, 228];
/** The tower's axis, in cells. */
export const CROWN_TOWER_AXIS = { x: 64, z: 64 } as const;
const CX = CROWN_TOWER_AXIS.x, CZ = CROWN_TOWER_AXIS.z;

/** The measured planes of the tower, shared by the factory, its metadata and its tests. */
export const CROWN_TOWER = {
  /** The terrace's walking surface. */
  deck: 4,
  terrace: { x: [4, 124] as const, z: [18, 208] as const },
  /** The stepped foot: [half, y0, y1, role]. */
  foot: [
    [42, 4, 11, 'base'], [43, 11, 12, 'band'], [38, 12, 20, 'stone'], [39, 20, 21, 'band'],
    [36, 21, 25, 'band'], [32, 25, 29, 'stone'], [30, 29, 33, 'stone'],
  ] as const,
  /** The stem narrows from `from` to `to` cells of half width, faster near its foot. */
  stem: { y: [33, 144] as const, from: 28, to: 21 },
  courses: [58, 98, 136] as const,
  /** Two glazed storeys of lancets on all four faces: sill and head of the rectangular light. */
  storeys: [{ id: 'lower', y: [64, 84] as const }, { id: 'upper', y: [104, 124] as const }] as const,
  window: { half: 3 },
  /** The collar: three stepped rings under the gallery floor and its balustrade. */
  collar: { rings: [[23, 144, 148], [26, 148, 151], [29, 151, 154]] as const, floor: [154, 158] as const, half: 31, rail: { y: [158, 165] as const, thickness: 2 } },
  /** The head flares from `from` to `to` cells of half width. */
  head: { y: [158, 202] as const, from: 19, to: 26, wall: 3, arch: { half: 6, y: [168, 190] as const } },
  rim: { y: [202, 206] as const, half: 28 },
  coronet: { y: [206, 210] as const, half: 27, points: [210, 218] as const, tip: [218, 221] as const },
  dome: { y: [206, 236] as const, half: 22 },
  orb: { y: [234, 242] as const },
  cross: { y: [242, 256] as const, arm: [247, 251] as const, reach: 7 },
  /** The watch fire's heart is the top of its heaped embers. */
  fire: { heart: 171 },
  bell: { x: 64, y: 178, z: 64, headstock: 194 },
  door: {
    /** The open reveal, from the front of the leaf's ironwork out through the door case. */
    opening: { x: [58, 70] as const, y: [4, 24] as const, z: [102, 112] as const },
    /** Arch rows above the rectangular opening: [y, x0, x1]. */
    arch: [[24, 59, 69], [25, 60, 68], [26, 61, 67], [27, 62, 66]] as const,
    leaf: { x: [58, 70] as const, y: [4, 28] as const, z: [99, 101] as const },
    threshold: 4,
    /** From the terrace down to the ground: [top, z0, z1, x0, x1]; the lowest is the widest. */
    steps: [[3, 208, 212, 40, 88], [2, 212, 216, 38, 90], [1, 216, 220, 36, 92]] as const,
  },
  porch: { x: [50, 78] as const, z: [88, 110] as const, y: [4, 58] as const },
  crest: { x: 57, y: 36, face: 109 },
  /** The board: eight by eight squares of `square` cells, inside a dark frame. */
  board: { x: [20, 108] as const, z: [112, 200] as const, square: 11, frame: 2 },
  rooks: [{ id: 'rook-back-west', x: 12, z: 110 }, { id: 'rook-back-east', x: 116, z: 110 }, { id: 'rook-front-west', x: 12, z: 202 }, { id: 'rook-front-east', x: 116, z: 202 }] as const,
  rook: { glass: { half: 2, y: [29, 34] as const } },
  lanterns: [{ id: 'door-lantern-west', x: 52 }, { id: 'door-lantern-east', x: 76 }] as const,
  lantern: { y: 22, z: 114, glass: 5 },
  benches: [{ id: 'board-bench-west', x: [8, 12] as const, facing: 'east' }, { id: 'board-bench-east', x: [116, 120] as const, facing: 'west' }] as const,
  bench: { y: [7, 8] as const, z: [128, 184] as const },
  banners: { x: [46, 74] as const, width: 8, layer: 26, y: [96, 151] as const },
  mast: { x: [6, 8] as const, z: [95, 97] as const, y: [4, 142] as const },
  /** The flag part's origin at rest, in tower cells, and its hoist pivot in part cells (the mast's centre line). */
  flag: { offset: [8, 124, 95] as const, pivot: [-1, 0, 1] as const },
} as const;

const { deck: DECK } = CROWN_TOWER;
/** A regular-looking octagon's chamfer for a half width. */
const chamfer = (half: number) => Math.round(half * 0.41);

/** Half width of the stem at height `y`. */
export function stemHalf(y: number): number {
  const { y: [y0, y1], from, to } = CROWN_TOWER.stem;
  return Math.round(to + (from - to) * Math.pow(1 - (y - y0) / (y1 - y0), 1.6));
}
/** Half width of the head's outer face at height `y`. */
export function headHalf(y: number): number {
  const { y: [y0, y1], from, to } = CROWN_TOWER.head;
  return Math.round(from + (to - from) * Math.pow((y - y0) / (y1 - y0), 1.3));
}
/** Half width of the dome at height `y`. */
function domeHalf(y: number): number {
  const { y: [y0, y1], half } = CROWN_TOWER.dome;
  // In whole pairs of cells, so the dome climbs in even courses.
  return 2 * Math.round((half / 2) * Math.sqrt(Math.max(0, 1 - ((y - y0) / (y1 - y0)) ** 2)));
}
/** Consecutive rows of `[y0, y1)` with the same value of `f`, as [value, from, to]. */
function runs(y0: number, y1: number, f: (y: number) => number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let y = y0; y < y1; y++) {
    const v = f(y), last = out.at(-1);
    if (last && last[0] === v) last[2] = y + 1;
    else out.push([v, y, y + 1]);
  }
  return out;
}

export function createCrownTower(options: CrownTowerOptions): LandmarkPiece {
  const { style, head, crest, bannerCut, colours } = options;
  if (!(style in LANDMARK_KITS)) throw new Error(`Unknown landmark style ${String(style)}.`);
  if (head !== 'watch-fire' && head !== 'bell') throw new Error(`Unknown crown tower head ${String(head)}.`);
  const kit = LANDMARK_KITS[style];
  const b = new TowerBoxes();

  terrace(b, kit);
  board(b, kit);
  foot(b, kit);
  stem(b, kit);
  collar(b, kit);
  crownHead(b, kit, head);
  crown(b, kit);
  porch(b, kit);
  crestPanel(b, kit, crest, colours.field);
  banners(b, kit, bannerCut, colours);
  doorLanterns(b, kit);
  for (const rook of CROWN_TOWER.rooks) rookPost(b, kit, rook.x, rook.z);
  benches(b, kit);
  mast(b, kit);
  outcrop(b, kit);

  const id = `genesis-crown-tower-${style}-${head}-${crest.shape}-${crest.charge}-${bannerCut}-${colours.field}-${colours.band}`;
  const blueprint: VoxelBlueprint = {
    version: 1, id, styleId: StyleIdSchema.parse(STYLES[style].id), kind: 'civic', lattice: 'build',
    size: [...CROWN_TOWER_SIZE], boxes: b.list, windows: [],
  };
  const { offset, pivot } = CROWN_TOWER.flag;
  const flag = { id: 'flag', blueprint: flagBlueprint('crown-tower', style, kit, bannerCut, colours), mount: 'flag-hoist', offset: [...offset] as Vec3, pivot: [...pivot] as Vec3 };
  return { blueprint, ...metadata(blueprint, head), glazing: b.glazing, parts: [flag] };
}

// ── Faces ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Sides of an octagon about (cx, cz): 0 front (+Z), 1 east (+X), 2 back (−Z), 3 west (−X). */
type Side = 0 | 1 | 2 | 3;
const SIDES: readonly Side[] = [0, 1, 2, 3];
const FACING: Readonly<Record<Side, LocalFacing>> = { 0: 'south', 1: 'east', 2: 'north', 3: 'west' };

/** The tower's boxes, and the glazed panes laid as it is built. */
class TowerBoxes extends Boxes {
  readonly glazing: LandmarkGlazing[] = [];
  /**
   * Cells between layers `l0..l1` out from the axis (cx, cz) on one side. `a..A` runs along the face from its
   * centre, towards +X on the front and back and towards +Z on the flanks.
   */
  side(side: Side, l0: number, l1: number, a: number, A: number, y: number, Y: number, material: number, cx: number = CX, cz: number = CZ): void {
    if (side === 0) this.add(cx + a, y, cz + l0, cx + A, Y, cz + l1, material);
    else if (side === 2) this.add(cx + a, y, cz - l1, cx + A, Y, cz - l0, material);
    else if (side === 1) this.add(cx + l0, y, cz + a, cx + l1, Y, cz + A, material);
    else this.add(cx - l1, y, cz + a, cx - l0, Y, cz + A, material);
  }
  /**
   * A broad octagon whose chamfers step two cells at a time: the foot and the collar are wide enough that the coarser
   * step still reads as a diagonal, at half the boxes of a one-cell staircase.
   */
  coarse(cx: number, cz: number, half: number, y0: number, y1: number, material: number): void {
    const c = chamfer(half);
    this.add(cx - half, y0, cz - half + c, cx + half, y1, cz + half - c, material);
    for (let i = 0; i < c; i += 2) {
      const n = Math.min(2, c - i), inset = c - i - (n - 1);
      this.add(cx - half + inset, y0, cz - half + i, cx + half - inset, y1, cz - half + i + n, material);
      this.add(cx - half + inset, y0, cz + half - i - n, cx + half - inset, y1, cz + half - i, material);
    }
  }
  /** A pane whose glass fills layer `layer` on `side`; its outer face is the layer's outer plane. */
  pane(opening: string, side: Side, layer: number, a: number, A: number, y: number, Y: number): void {
    const plane = layer + 1, mid = (a + A) / 2, height = (y + Y) / 2;
    const centre: Vec3 = side === 0 ? [CX + mid, height, CZ + plane] : side === 2 ? [CX + mid, height, CZ - plane] : side === 1 ? [CX + plane, height, CZ + mid] : [CX - plane, height, CZ + mid];
    const index = this.glazing.filter(g => g.opening === opening).length;
    this.glazing.push({ id: `${opening}/${index}`, opening, centre, width: A - a, height: Y - y, facing: FACING[side] });
  }
}

// ── The terrace and the board ────────────────────────────────────────────────────────────────────────────────────

function terrace(b: TowerBoxes, kit: LandmarkKit): void {
  const { terrace: t } = CROWN_TOWER;
  // A dressed platform with a pale coping round its edge, a few paving flags of the lighter stone let into it.
  b.add(t.x[0], 0, t.z[0], t.x[1], DECK, t.z[1], kit.base);
  b.add(t.x[0], DECK - 1, t.z[0], t.x[1], DECK, t.z[0] + 1, kit.band);
  b.add(t.x[0], DECK - 1, t.z[1] - 1, t.x[1], DECK, t.z[1], kit.band);
  b.add(t.x[0], DECK - 1, t.z[0], t.x[0] + 1, DECK, t.z[1], kit.band);
  b.add(t.x[1] - 1, DECK - 1, t.z[0], t.x[1], DECK, t.z[1], kit.band);
  for (let i = 0; i < 14; i++) {
    const x = t.x[0] + 3 + Math.floor(hash(i, 1, 0, 91) * 108), z = t.z[0] + 3 + Math.floor(hash(i, 2, 0, 91) * 182);
    const w = 3 + Math.floor(hash(i, 3, 0, 91) * 4), d = 3 + Math.floor(hash(i, 4, 0, 91) * 4);
    b.add(x, DECK - 1, z, Math.min(x + w, t.x[1] - 1), DECK, Math.min(z + d, t.z[1] - 1), kit.stone);
  }
  // The steps down to the ground at the board's front, each with a pale nosing.
  for (const [top, z0, z1, x0, x1] of CROWN_TOWER.door.steps) {
    b.add(x0, 0, z0, x1, top, z1, kit.base);
    b.add(x0, top - 1, z1 - 1, x1, top, z1, kit.band);
  }
  // Weathered blocks in the terrace's retaining faces.
  for (let i = 0; i < 12; i++) {
    const along = Math.floor(hash(i, 5, 0, 92) * 170), w = 4 + Math.floor(hash(i, 6, 0, 92) * 5), y = Math.floor(hash(i, 7, 0, 92) * 2);
    if (i % 2) b.add(i % 4 === 1 ? t.x[0] : t.x[1] - 1, y, t.z[0] + 4 + along, i % 4 === 1 ? t.x[0] + 1 : t.x[1], y + 2, t.z[0] + 4 + Math.min(along + w, 180), kit.stone);
    else b.add(t.x[0] + 4 + Math.floor(along * 0.6), y, t.z[0], t.x[0] + 4 + Math.min(Math.floor(along * 0.6) + w, 110), y + 2, t.z[0] + 1, kit.stone);
  }
}

function board(b: TowerBoxes, kit: LandmarkKit): void {
  const { x, z, square, frame } = CROWN_TOWER.board;
  // A dark frame, then the eight by eight squares: pale on the light squares, the dark stone on the dark ones.
  b.add(x[0] - frame, DECK - 1, z[0] - frame, x[1] + frame, DECK, z[1] + frame, kit.iron);
  b.add(x[0], DECK - 1, z[0], x[1], DECK, z[1], kit.band);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      if ((i + j) % 2 === 0) continue;
      b.add(x[0] + i * square, DECK - 1, z[0] + j * square, x[0] + (i + 1) * square, DECK, z[0] + (j + 1) * square, kit.iron);
    }
  }
}

// ── The foot, the stem and the collar ────────────────────────────────────────────────────────────────────────────

function foot(b: TowerBoxes, kit: LandmarkKit): void {
  const material = { base: kit.base, band: kit.band, stone: kit.stone } as const;
  for (const [half, y0, y1, role] of CROWN_TOWER.foot) b.coarse(CX, CZ, half, y0, y1, material[role]);
  // Laid blocks: a few stones of the darker rock in the foot's two broad courses.
  for (let i = 0; i < 16; i++) {
    const side = SIDES[i % 4]!, lower = i % 3 !== 0, half = lower ? 42 : 38, y = lower ? 5 + Math.floor(hash(i, 1, 0, 93) * 4) : 13 + Math.floor(hash(i, 1, 0, 93) * 5);
    const a = Math.floor(hash(i, 2, 0, 93) * 2 * (half - chamfer(half) - 6)) - (half - chamfer(half) - 6), w = 3 + Math.floor(hash(i, 3, 0, 93) * 3);
    if (side === 0 && Math.abs(a) < 20) continue; // the porch stands on the front
    b.side(side, half - 1, half, a, a + w, y, y + 2, kit.rock);
  }
}

function stem(b: TowerBoxes, kit: LandmarkKit): void {
  const { y } = CROWN_TOWER.stem;
  for (const [half, y0, y1] of runs(y[0], y[1], stemHalf)) b.octagon(CX, CZ, half, chamfer(half), y0, y1, kit.stone);
  // Pale string courses, each a cell proud of the stem where it runs.
  for (const course of CROWN_TOWER.courses) {
    const half = stemHalf(course) + 1;
    b.octagon(CX, CZ, half, chamfer(half), course, course + 2, kit.band);
  }
  // Ashlar: darker stones laid into the stem so it reads as built, not cast.
  for (let i = 0; i < 32; i++) {
    const side = SIDES[i % 4]!, yy = 36 + Math.floor(hash(i, 1, 0, 94) * 104), half = stemHalf(yy);
    if (stemHalf(yy + 1) !== half || CROWN_TOWER.courses.some(c => yy + 2 > c - 1 && yy < c + 3)) continue;
    const reach = half - chamfer(half) - 2, a = Math.floor(hash(i, 2, 0, 94) * 2 * reach) - reach, w = 3 + Math.floor(hash(i, 3, 0, 94) * 3);
    // Keep clear of the lancets on the faces and of the porch and banners on the front.
    if (Math.abs(a + w / 2) < 8 || (side === 0 && yy < 60)) continue;
    b.side(side, half - 1, half, a, Math.min(a + w, reach), yy, yy + 2, kit.rock);
  }
  for (const storey of CROWN_TOWER.storeys) for (const side of SIDES) lancet(b, kit, `${storey.id}-${FACING[side]}`, side, storey.y[0], storey.y[1]);
}

/**
 * A lancet on one face of the stem: a light `2 * half` wide from sill to head, then a head that steps in a cell each
 * side every two rows. The glass sits three cells in from the face at the light's head and a small room is carved
 * behind it, so the glass looks into a real space. A pale sill and a hood stand proud of the face.
 */
function lancet(b: TowerBoxes, kit: LandmarkKit, id: string, side: Side, y0: number, y1: number): void {
  const h = CROWN_TOWER.window.half, rows: [number, number, number][] = [[y0, y1, h]];
  for (let k = 1, y = y1; h - k > 0; k++, y += 2) rows.push([y, y + 2, h - k]);
  const top = rows.at(-1)![1], outer = stemHalf(y0), inner = stemHalf(top), glass = inner - 3;
  // The room behind the glass.
  b.side(side, glass - 8, glass, -h - 2, h + 2, y0 - 2, top + 2, MAT.air);
  for (const [r0, r1, half] of rows) {
    b.side(side, glass + 1, outer + 1, -half, half, r0, r1, MAT.air);
    b.side(side, glass, glass + 1, -half, half, r0, r1, MAT.glass);
    b.pane(id, side, glass, -half, half, r0, r1);
  }
  b.side(side, outer - 1, outer + 1, -h - 1, h + 1, y0 - 2, y0, kit.band);
  b.side(side, inner - 1, inner + 1, -h - 1, h + 1, top, top + 1, kit.band);
  b.side(side, inner - 1, inner + 1, -h + 1, h - 1, top + 1, top + 2, kit.band);
}

function collar(b: TowerBoxes, kit: LandmarkKit): void {
  const { rings, floor, half, rail } = CROWN_TOWER.collar;
  // Three rings stepping out under the gallery, the top one pale, then the gallery floor.
  for (const [r, y0, y1] of rings) b.coarse(CX, CZ, r, y0, y1, r === rings[2][0] ? kit.band : kit.stone);
  b.coarse(CX, CZ, half, floor[0], floor[1], kit.stone);
  b.coarse(CX, CZ, half + 1, floor[0], floor[0] + 1, kit.band);
  // The balustrade: a ring two cells thick, open between balusters on its four straight faces, under a pale rail.
  b.coarse(CX, CZ, half, rail.y[0], rail.y[1] - 1, kit.stone);
  b.coarse(CX, CZ, half, rail.y[1] - 1, rail.y[1], kit.band);
  b.coarse(CX, CZ, half - rail.thickness, rail.y[0], rail.y[1], MAT.air);
  const run = half - chamfer(half);
  for (const side of SIDES) for (let a = -run + 2; a + 2 <= run - 2; a += 4) b.side(side, half - rail.thickness, half, a, a + 2, rail.y[0] + 1, rail.y[1] - 2, MAT.air);
}

// ── The head and the crown ───────────────────────────────────────────────────────────────────────────────────────

function crownHead(b: TowerBoxes, kit: LandmarkKit, head: CrownTowerHead): void {
  const { y, wall, arch } = CROWN_TOWER.head;
  const segments = runs(y[0], y[1], headHalf);
  for (const [half, y0, y1] of segments) b.octagon(CX, CZ, half, chamfer(half), y0, y1, kit.wall);
  // Pale quoins at the four diagonal corners, alternately long and short.
  for (let yy = y[0] + 2, k = 0; yy + 4 <= y[1] - 2; yy += 4, k++) {
    if (k % 2) continue;
    const half = headHalf(yy), c = chamfer(half), reach = k % 4 ? 3 : 5;
    b.octagon(CX, CZ, half, c, yy, yy + 4, kit.stone);
    const inner = half - c - reach;
    b.add(CX - inner, yy, CZ - half, CX + inner, yy + 4, CZ + half, kit.wall);
    b.add(CX - half, yy, CZ - inner, CX + half, yy + 4, CZ + inner, kit.wall);
  }
  // The room inside, from the gallery floor to the ceiling under the crown: two stages, so the walls thicken a
  // little as the head flares.
  const mid = Math.round((y[0] + y[1]) / 2), low = headHalf(y[0]) - wall, high = headHalf(mid) - wall;
  b.octagon(CX, CZ, low, chamfer(low), y[0], mid, MAT.air);
  b.octagon(CX, CZ, high, chamfer(high), mid, y[1] - 2, MAT.air);
  for (const side of SIDES) {
    // A pale ring a cell proud round each lookout, a timber sill, and the opening right through the flared wall.
    for (const [half, y0, y1] of runs(arch.y[0] - 1, arch.y[1] + 5, headHalf)) b.side(side, half - 1, half + 1, -arch.half - 1, arch.half + 1, y0, y1, kit.band);
    b.side(side, 0, 32, -arch.half, arch.half, arch.y[0], arch.y[1], MAT.air);
    b.side(side, 0, 32, -arch.half + 1, arch.half - 1, arch.y[1], arch.y[1] + 2, MAT.air);
    b.side(side, 0, 32, -arch.half + 3, arch.half - 3, arch.y[1] + 2, arch.y[1] + 3, MAT.air);
    b.side(side, headHalf(arch.y[0]) - wall - 1, headHalf(arch.y[0]) + 1, -arch.half, arch.half, arch.y[0] - 1, arch.y[0], kit.trim);
  }
  // The ceiling's joists, seen through the lookouts.
  for (const a of [-10, -3, 4, 11]) b.add(CX - 22, y[1] - 4, CZ + a - 1, CX + 22, y[1] - 2, CZ + a + 1, kit.trim);
  const { fire, bell } = CROWN_TOWER;
  if (head === 'watch-fire') {
    // A stone pedestal, a bright bowl, its coals, and the fire's hot heart heaped above them.
    b.octagon(CX, CZ, 3, 1, y[0], 166, kit.stone);
    b.octagon(CX, CZ, 4, 1, 165, 166, kit.band);
    b.octagon(CX, CZ, 6, 2, 166, 170, kit.metal);
    b.octagon(CX, CZ, 5, 2, 167, 170, MAT.air);
    b.octagon(CX, CZ, 5, 2, 167, 169, kit.iron);
    b.octagon(CX, CZ, 3, 1, 169, 170, MAT.fabricOrange);
    b.octagon(CX, CZ, 1, 0, 170, fire.heart, MAT.fabricGold);
    for (let i = 0; i < 14; i++) {
      const x = CX - 4 + Math.floor(hash(i, 1, 0, 95) * 8), z = CZ - 4 + Math.floor(hash(i, 2, 0, 95) * 8);
      b.add(x, 169, z, x + 1, 170, z + 1, i % 3 ? MAT.fabricOrange : MAT.fabricGold);
    }
    // Iron hoops of the fire basket.
    for (const [x, z] of [[-6, -1], [5, -1], [-1, -6], [-1, 5]] as const) b.add(CX + x, 170, CZ + z, CX + x + 1, 173, CZ + z + 2, kit.iron);
  } else {
    // A bell on a timber headstock spanning the head: lip, waist, crown and the iron clapper.
    const span = headHalf(bell.headstock) - wall;
    b.add(CX - span, bell.headstock, CZ - 1, CX + span, bell.headstock + 2, CZ + 1, kit.trim);
    b.add(bell.x - 1, 188, bell.z - 1, bell.x + 1, bell.headstock, bell.z + 1, kit.metal);
    b.add(bell.x - 2, 181, bell.z - 2, bell.x + 2, 188, bell.z + 2, kit.metal);
    b.add(bell.x - 3, bell.y, bell.z - 3, bell.x + 3, 181, bell.z + 3, kit.metal);
    b.add(bell.x - 1, bell.y - 2, bell.z - 1, bell.x + 1, bell.y, bell.z + 1, kit.iron);
  }
}

function crown(b: TowerBoxes, kit: LandmarkKit): void {
  const { rim, coronet, dome, orb, cross, head } = CROWN_TOWER;
  // The ceiling over the head, the crown band with a bright boss on every face, and the coronet's ring.
  b.octagon(CX, CZ, headHalf(head.y[1] - 1), chamfer(headHalf(head.y[1] - 1)), head.y[1] - 2, head.y[1], kit.wall);
  b.octagon(CX, CZ, rim.half, chamfer(rim.half), rim.y[0], rim.y[1], kit.band);
  for (const side of SIDES) for (const a of [-12, -1, 10]) b.side(side, rim.half, rim.half + 1, a, a + 2, rim.y[0] + 1, rim.y[1] - 1, kit.metal);
  const ch = chamfer(coronet.half), t = 3;
  b.octagon(CX, CZ, coronet.half, ch, coronet.y[0], coronet.y[1], kit.stone);
  b.octagon(CX, CZ, coronet.half - t, chamfer(coronet.half - t), coronet.y[0], coronet.y[1], MAT.air);
  // Eight points: one on every straight face and one on every diagonal, each with a stepped tip and a bright ball.
  const [p0, p1] = coronet.points, [t0, t1] = coronet.tip;
  for (const side of SIDES) {
    b.side(side, coronet.half - t, coronet.half, -5, 5, p0, p1, kit.stone);
    b.side(side, coronet.half - t, coronet.half, -3, 3, t0, t1, kit.band);
    b.side(side, coronet.half - 2, coronet.half - 1, -1, 1, t1, t1 + 2, kit.metal);
  }
  const d = coronet.half - Math.round(ch / 2) - 2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const x = sx < 0 ? CX - d - 3 : CX + d - 2, z = sz < 0 ? CZ - d - 3 : CZ + d - 2;
    b.add(x, p0, z, x + 5, p1, z + 5, kit.stone);
    b.add(x + 1, t0, z + 1, x + 4, t1, z + 4, kit.band);
    b.add(x + 2, t1, z + 2, x + 3, t1 + 2, z + 3, kit.metal);
  }
  // The dome, its four pale ribs, the orb and the cross.
  for (const [half, y0, y1] of runs(dome.y[0], dome.y[1], domeHalf)) {
    if (half < 1) continue;
    b.octagon(CX, CZ, half, chamfer(half), y0, y1, kit.roof);
    if (half > 7) for (const side of SIDES) b.side(side, half - 1, half + 1, -1, 1, y0, y1, kit.band);
  }
  const [o0, o1] = orb.y;
  for (const [half, y0, y1] of [[2, o0, o0 + 1], [3, o0 + 1, o0 + 2], [4, o0 + 2, o1 - 2], [3, o1 - 2, o1 - 1], [2, o1 - 1, o1]] as const) b.octagon(CX, CZ, half, 1, y0, y1, kit.metal);
  b.add(CX - 2, cross.y[0], CZ - 2, CX + 2, cross.y[1], CZ + 2, kit.metal);
  b.add(CX - cross.reach, cross.arm[0], CZ - 2, CX + cross.reach, cross.arm[1], CZ + 2, kit.metal);
  b.add(CX - 2, cross.arm[0], CZ - cross.reach, CX + 2, cross.arm[1], CZ + cross.reach, kit.metal);
  // Flared ends on the four arms.
  b.add(CX - cross.reach, cross.arm[0] - 1, CZ - 2, CX - cross.reach + 1, cross.arm[1] + 1, CZ + 2, kit.metal);
  b.add(CX + cross.reach - 1, cross.arm[0] - 1, CZ - 2, CX + cross.reach, cross.arm[1] + 1, CZ + 2, kit.metal);
  b.add(CX - 2, cross.arm[0] - 1, CZ - cross.reach, CX + 2, cross.arm[1] + 1, CZ - cross.reach + 1, kit.metal);
  b.add(CX - 2, cross.arm[0] - 1, CZ + cross.reach - 1, CX + 2, cross.arm[1] + 1, CZ + cross.reach, kit.metal);
}

// ── The porch, the crest, the banners and the lights ─────────────────────────────────────────────────────────────

function porch(b: TowerBoxes, kit: LandmarkKit): void {
  const { porch: p, door } = CROWN_TOWER;
  b.add(p.x[0], p.y[0], p.z[0], p.x[1], p.y[1], p.z[1], kit.stone);
  b.add(p.x[0] - 1, p.y[0], p.z[0], p.x[1] + 1, p.y[0] + 3, p.z[1] + 1, kit.base);
  // Long-and-short quoins on the porch's two front corners.
  for (let y = p.y[0] + 3, k = 0; y + 4 <= p.y[1]; y += 4, k++) {
    const long = k % 2 ? 3 : 5;
    b.add(p.x[0], y, p.z[1] - (k % 2 ? 5 : 3), p.x[0] + long, y + 4, p.z[1], kit.band);
    b.add(p.x[1] - long, y, p.z[1] - (k % 2 ? 5 : 3), p.x[1], y + 4, p.z[1], kit.band);
  }
  // A stepped gable roof over the porch, its front a stone gable inside the roof's overhang.
  for (let k = 0; ; k++) {
    const x0 = p.x[0] - 1 + 2 * k, x1 = p.x[1] + 1 - 2 * k, y = p.y[1] + k;
    if (x1 - x0 < 2) break;
    b.add(x0, y, p.z[0], x1, y + 1, p.z[1] + 1, kit.roof);
    if (x1 - x0 > 4) b.add(x0 + 2, y, p.z[1] - 2, x1 - 2, y + 1, p.z[1], kit.stone);
    if (x1 - x0 > 4) b.add(x0 + 2, y, p.z[1], x1 - 2, y + 1, p.z[1] + 1, MAT.air);
  }
  // The door case: a pale ring two cells proud with a stepped head and a keystone.
  const { opening, leaf } = door;
  b.add(opening.x[0] - 3, door.threshold, p.z[1], opening.x[1] + 3, opening.y[1] + 4, opening.z[1], kit.band);
  for (const [y, x0, x1] of [[28, 56, 72], [29, 57, 71], [30, 59, 69], [31, 61, 67]] as const) b.add(x0, y, p.z[1], x1, y + 1, opening.z[1], kit.band);
  b.add(CX - 1, 27, p.z[1], CX + 1, 33, opening.z[1] + 1, kit.band);
  // The opening, the closed leaf deep in it, its planks, strap hinges, studs and a bright ring.
  b.add(opening.x[0], opening.y[0], leaf.z[0], opening.x[1], opening.y[1], opening.z[1], MAT.air);
  for (const [y, x0, x1] of door.arch) b.add(x0, y, leaf.z[0], x1, y + 1, opening.z[1], MAT.air);
  b.add(leaf.x[0], leaf.y[0], leaf.z[0], leaf.x[1], opening.y[1], leaf.z[1], kit.trim);
  for (const [y, x0, x1] of door.arch) b.add(x0, y, leaf.z[0], x1, y + 1, leaf.z[1], kit.trim);
  for (const x of [61, 64, 67]) b.add(x, leaf.y[0], leaf.z[0], x + 1, 26, leaf.z[1], MAT.bark);
  for (const y of [8, 19]) b.add(leaf.x[0], y, leaf.z[1], leaf.x[0] + 9, y + 1, leaf.z[1] + 1, kit.iron);
  for (const x of [60, 64, 68]) for (const y of [12, 15, 23]) b.add(x, y, leaf.z[1], x + 1, y + 1, leaf.z[1] + 1, kit.iron);
  b.add(65, 13, leaf.z[1], 66, 14, leaf.z[1] + 1, kit.metal);
  b.add(64, 12, leaf.z[1], 67, 13, leaf.z[1] + 1, kit.metal);
  // The sill under the leaf and the reveal, flush with the terrace.
  b.add(opening.x[0], DECK - 1, leaf.z[0], opening.x[1], DECK, opening.z[1], kit.stone);
}

function crestPanel(b: TowerBoxes, kit: LandmarkKit, crest: CrownTowerOptions['crest'], field: number): void {
  const { x, y, face } = CROWN_TOWER.crest;
  // A pale frame proud of the porch and a sill under it; the field flush in the face, border and charge proud.
  b.add(x - 2, y - 2, face + 1, x + CREST_WIDTH + 2, y + CREST_HEIGHT + 2, face + 2, kit.band);
  b.add(x - 1, y - 1, face + 1, x + CREST_WIDTH + 1, y + CREST_HEIGHT + 1, face + 2, MAT.air);
  b.add(x - 3, y - 3, face + 1, x + CREST_WIDTH + 3, y - 2, face + 3, kit.band);
  const material: Record<string, number> = { B: kit.metal, C: kit.charge };
  crestGrid(crest.shape, crest.charge).forEach((row, i) => {
    const yy = y + CREST_HEIGHT - 1 - i;
    for (let c = 0; c < row.length; c++) {
      const mark = row[c]!;
      if (mark === '.') continue;
      b.add(x + c, yy, face, x + c + 1, yy + 1, face + 1, field);
      if (mark !== 'F') b.add(x + c, yy, face + 1, x + c + 1, yy + 1, face + 2, material[mark]!);
    }
  });
}

/**
 * Two long banners hung from the collar's top ring down the front of the stem, clear of its face, each on an iron
 * rod. The foot follows the recipe's banner cut: square with a short fringe, forked, or drawn to a point.
 */
function banners(b: TowerBoxes, kit: LandmarkKit, cut: BannerCut, colours: CrownTowerOptions['colours']): void {
  const { x: xs, width, layer, y: [foot, top] } = CROWN_TOWER.banners, z = CZ + layer;
  for (const x0 of xs) {
    const x1 = x0 + width;
    b.add(x0, foot, z, x1, top, z + 1, colours.field);
    b.add(x0 + 3, foot + 4, z, x0 + 5, top - 4, z + 1, colours.band);
    b.add(x0, top - 6, z, x1, top - 5, z + 1, colours.band);
    b.add(x0 - 1, top - 2, z, x1 + 1, top - 1, z + 2, kit.iron);
    if (cut === 'forked') for (let k = 0; k < 4; k++) b.add(x0 + 1 + k, foot + k, z, x0 + 7 - k, foot + k + 1, z + 1, MAT.air);
    else if (cut === 'pennant') for (let k = 0; k < 4; k++) { b.add(x0, foot + k, z, x0 + 3 - k, foot + k + 1, z + 1, MAT.air); b.add(x0 + 5 + k, foot + k, z, x1, foot + k + 1, z + 1, MAT.air); }
    else for (let x = x0; x < x1; x += 2) b.add(x, foot, z, x + 1, foot + 1, z + 1, MAT.air);
  }
}

/** A caged lantern whose glass is centred on (gx, gz) from `gy`, hung from an arm back to a face at `wall` along +Z. */
function lantern(b: TowerBoxes, kit: LandmarkKit, gx: number, gy: number, gz: number, wall: number): void {
  const g = CROWN_TOWER.lantern.glass;
  b.add(gx - 1, gy, gz - 1, gx + 2, gy + g, gz + 2, MAT.glass);
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) b.add(gx + dx, gy, gz + dz, gx + dx + 1, gy + g, gz + dz + 1, kit.iron);
  b.add(gx - 2, gy - 1, gz - 2, gx + 3, gy, gz + 3, kit.metal);
  b.add(gx - 2, gy + g, gz - 2, gx + 3, gy + g + 1, gz + 3, kit.metal);
  b.add(gx - 1, gy + g + 1, gz - 1, gx + 2, gy + g + 2, gz + 2, kit.metal);
  b.add(gx, gy + g + 2, gz, gx + 1, gy + g + 4, gz + 1, kit.iron);
  b.add(gx, gy + g + 4, wall, gx + 1, gy + g + 5, gz + 1, kit.iron);
}

function doorLanterns(b: TowerBoxes, kit: LandmarkKit): void {
  const { y, z } = CROWN_TOWER.lantern;
  for (const { x } of CROWN_TOWER.lanterns) lantern(b, kit, x, y, z, CROWN_TOWER.porch.z[1]);
}

/**
 * A rook-shaped post at a corner of the board: a moulded foot, a plain shaft, a collar, and a battlemented head
 * whose chamber holds a lantern's glass, seen through an arched light on every side.
 */
function rookPost(b: TowerBoxes, kit: LandmarkKit, cx: number, cz: number): void {
  const { glass } = CROWN_TOWER.rook;
  b.octagon(cx, cz, 5, 2, DECK, DECK + 3, kit.base);
  b.octagon(cx, cz, 5, 2, DECK + 3, DECK + 4, kit.band);
  b.octagon(cx, cz, 4, 1, DECK + 4, 26, kit.stone);
  b.octagon(cx, cz, 5, 2, 26, 28, kit.band);
  b.octagon(cx, cz, 5, 2, 28, 38, kit.stone);
  b.octagon(cx, cz, 3, 1, 29, 38, MAT.air);
  b.octagon(cx, cz, 3, 1, 35, 36, kit.metal);
  b.add(cx - glass.half, glass.y[0], cz - glass.half, cx + glass.half, glass.y[1], cz + glass.half, MAT.glass);
  for (const side of SIDES) {
    b.side(side, 3, 5, -1, 1, 30, 34, MAT.air, cx, cz);
    b.side(side, 3, 5, -1, 1, 36, 38, MAT.air, cx, cz);
    b.side(side, 5, 6, -2, 2, 29, 30, kit.band, cx, cz);
  }
}

function benches(b: TowerBoxes, kit: LandmarkKit): void {
  const { benches, bench } = CROWN_TOWER;
  for (const { x } of benches) {
    b.add(x[0], bench.y[0], bench.z[0], x[1], bench.y[1], bench.z[1], kit.trim);
    for (let z = bench.z[0] + 2; z + 4 <= bench.z[1]; z += 24) b.add(x[0], DECK, z, x[1], bench.y[0], z + 4, kit.stone);
  }
}

function mast(b: TowerBoxes, kit: LandmarkKit): void {
  const { x, z, y } = CROWN_TOWER.mast, mx = (x[0] + x[1]) / 2, mz = (z[0] + z[1]) / 2;
  // A stepped stone socket, the timber mast with iron collars, and a bright finial.
  b.octagon(mx, mz, 3, 1, DECK, DECK + 3, kit.base);
  b.octagon(mx, mz, 2, 0, DECK + 3, DECK + 5, kit.band);
  b.add(x[0], DECK + 5, z[0], x[1], y[1] - 2, z[1], kit.trim);
  for (const yy of [40, 80, 116]) b.add(x[0] - 1, yy, z[0] - 1, x[1] + 1, yy + 1, z[1] + 1, kit.iron);
  b.add(x[0] - 1, y[1] - 2, z[0] - 1, x[1] + 1, y[1], z[1] + 1, kit.metal);
}

/** A shoulder of rock behind the terrace, where the mountain comes down to it, and a few boulders at its sides. */
function outcrop(b: TowerBoxes, kit: LandmarkKit): void {
  for (let i = 0; i < 22; i++) {
    const back = i < 13;
    const x = back ? Math.floor(hash(i, 1, 0, 96) * 118) : (i % 2 ? 0 : 120) + Math.floor(hash(i, 1, 0, 96) * 4);
    const z = back ? Math.floor(hash(i, 2, 0, 96) * 12) : 22 + Math.floor(hash(i, 2, 0, 96) * 60);
    const w = 5 + Math.floor(hash(i, 3, 0, 96) * 6), d = back ? 5 + Math.floor(hash(i, 4, 0, 96) * 8) : 4 + Math.floor(hash(i, 4, 0, 96) * 4);
    const h = (back ? 4 : 3) + Math.floor(hash(i, 5, 0, 96) * (back ? 9 : 5));
    const x0 = Math.max(0, x), z0 = Math.max(0, z), x1 = Math.min(back ? 128 : x + w, x + w), z1 = Math.min(back ? CROWN_TOWER.terrace.z[0] : z + d, z + d);
    if (x1 - x0 < 3 || z1 - z0 < 3) continue;
    const material = i % 3 ? kit.rock : kit.stone;
    b.add(x0, 0, z0 + 1, Math.min(128, x1), h, z1 - 1, material);
    b.add(x0 + 1, 0, z0, Math.min(128, x1) - 1, h - 1, z1, material);
    b.add(x0 + 1, h, z0 + 1, Math.min(128, x1) - 1, h + 1, z1 - 1, i % 4 === 0 ? MAT.moss : material);
  }
}

// ── Metadata ─────────────────────────────────────────────────────────────────────────────────────────────────────

function metadata(blueprint: VoxelBlueprint, head: CrownTowerHead): Omit<LandmarkPiece, 'blueprint' | 'parts'> {
  const { door, terrace: t, board: bd, benches: seats, bench, rooks, rook, lanterns, lantern: lamp, mast: m, flag: banner, fire, bell, head: h } = CROWN_TOWER;
  const ground = 6, headroom = 20, outer = blueprint.size[2] + ground;
  const tops: number[] = [];
  for (let z = door.opening.z[0]; z < outer; z++) {
    const step = door.steps.find(([, z0, z1]) => z >= z0 && z < z1);
    tops.push(z < door.steps[0][1] ? door.threshold : step ? step[0] : 0);
  }
  const approach: LandmarkWalk = { id: 'door-approach', axis: 'z', along: [door.opening.z[0], outer], across: [door.opening.x[0], door.opening.x[1]], tops };
  const hoistAt: Vec3 = [(m.x[0] + m.x[1]) / 2, banner.offset[1], (m.z[0] + m.z[1]) / 2];
  const fireAt: Vec3 = [CX, fire.heart, CZ];
  const emitters: LandmarkEmitter[] = [
    ...(head === 'watch-fire' ? [{ id: 'watch-fire', kind: 'beacon' as const, position: fireAt, reach: 160 }] : []),
    ...lanterns.map(({ id, x }) => ({ id, kind: 'lantern' as const, position: [x + 0.5, lamp.y + lamp.glass / 2, lamp.z + 0.5] as Vec3, reach: 40 })),
    ...rooks.map(({ id, x, z }) => ({ id, kind: 'lantern' as const, position: [x, (rook.glass.y[0] + rook.glass.y[1]) / 2, z] as Vec3, reach: 40 })),
  ];
  const crownAt: Vec3 = [CX, CROWN_TOWER.rim.y[1], CZ];
  return {
    extent: extentOf(blueprint),
    footings: [
      { id: 'terrace', box: { from: [t.x[0], 0, t.z[0]], to: [t.x[1], 1, t.z[1]] }, embed: 0 },
      { id: 'steps', box: { from: [door.steps[2][3], 0, door.steps[0][1]], to: [door.steps[2][4], 1, door.steps[2][2]] }, embed: 0 },
      { id: 'outcrop', box: { from: [0, 0, 0], to: [128, 1, 82] }, embed: 6 },
    ],
    doorways: [{
      id: 'door', facing: 'south',
      opening: { from: [door.opening.x[0], door.opening.y[0], door.opening.z[0]], to: [door.opening.x[1], door.opening.y[1], door.opening.z[1]] },
      leaf: { from: [door.leaf.x[0], door.leaf.y[0], door.leaf.z[0]], to: [door.leaf.x[1], door.leaf.y[1], door.leaf.z[1]] },
      threshold: door.threshold, approach,
      clearance: { from: [door.opening.x[0], door.threshold, door.opening.z[0]], to: [door.opening.x[1], door.threshold + headroom, outer] },
      groundAt: 0, state: 'closed',
    }],
    walks: [approach],
    seats: seats.map(({ id, x, facing }) => ({ id, box: { from: [x[0], bench.y[0], bench.z[0]], to: [x[1], bench.y[1], bench.z[1]] } as CellBox, facing })),
    emitters,
    sounds: [
      head === 'watch-fire' ? { id: 'watch-fire', kind: 'beacon-fire' as const, position: fireAt } : { id: 'bell', kind: 'bell' as const, position: [bell.x, bell.y + 6, bell.z] as Vec3 },
      { id: 'flag', kind: 'flag', position: [hoistAt[0] + FLAG_LENGTH / 2, hoistAt[1] + FLAG_HEIGHT / 2, hoistAt[2]] },
      { id: 'wind', kind: 'wind', position: crownAt },
    ],
    mounts: [
      { id: 'flag-hoist', position: hoistAt, axis: [0, 1, 0] },
      ...(head === 'bell' ? [{ id: 'bell-headstock', position: [bell.x, bell.headstock + 1, bell.z] as Vec3, axis: [1, 0, 0] as Vec3 }] : []),
    ],
    clear: [
      { id: 'doorway', role: 'doorway', box: { from: [door.opening.x[0], door.opening.y[0], door.opening.z[0]], to: [door.opening.x[1], door.opening.y[1], door.opening.z[1]] } },
      { id: 'door-approach', role: 'approach', box: { from: [door.opening.x[0], door.threshold, door.opening.z[1]], to: [door.opening.x[1], door.threshold + headroom, outer] } },
      { id: 'board', role: 'board', box: { from: [bd.x[0], DECK, bd.z[0]], to: [bd.x[1], DECK + 16, bd.z[1]] } },
      ...SIDES.map(side => ({ id: `lookout-${FACING[side]}`, role: 'lookout' as const, box: lookout(side) })),
      { id: 'flag-swing', role: 'flag-swing', box: { from: [hoistAt[0] - FLAG_LENGTH - 2, hoistAt[1], hoistAt[2] - FLAG_LENGTH - 2], to: [hoistAt[0] + FLAG_LENGTH + 2, hoistAt[1] + FLAG_HEIGHT, hoistAt[2] + FLAG_LENGTH + 2] } },
      head === 'watch-fire'
        ? { id: 'fire-flame', role: 'beacon-flame', box: { from: [CX - 4, fire.heart, CZ - 4], to: [CX + 4, h.y[1] - 6, CZ + 4] } }
        : { id: 'bell-swing', role: 'bell-swing', box: { from: [bell.x - 8, bell.y - 2, bell.z - 8], to: [bell.x + 8, bell.headstock, bell.z + 8] } },
    ],
    affordances: [
      { id: 'enter', kind: 'enter', uses: ['door', 'door-approach'], status: 'needs-host', requires: 'A host door action and the tower interior; the leaf stays closed in this piece.' },
      { id: 'sit', kind: 'sit', uses: seats.map(s => s.id), status: 'needs-host', requires: 'Host seat registration from the placed bench edges.' },
      { id: 'play-board', kind: 'play-board', uses: ['board'], status: 'needs-host', requires: 'A host game on the board between the monarch and chat, with its own pieces set down by real moves; the board is empty in this piece.' },
      { id: 'look-out', kind: 'look-out', uses: SIDES.map(side => `lookout-${FACING[side]}`), status: 'needs-host', requires: 'A host climb or camera to the head; the piece has no stair.' },
      head === 'watch-fire'
        ? { id: 'tend-fire', kind: 'tend-beacon', uses: ['watch-fire', 'fire-flame'], status: 'needs-host', requires: 'Host fire light driven by real presence; content never lights it.' }
        : { id: 'ring-bell', kind: 'ring-bell', uses: ['bell-headstock', 'bell-swing'], status: 'needs-host', requires: 'A host bell rung by a real civic moment, swinging the bell on its headstock; content never rings it.' },
    ],
  };
}

/** A lookout of the head on one side: right through the flared wall, the height of its rectangular opening. */
function lookout(side: Side): CellBox {
  const { arch, wall } = CROWN_TOWER.head, a = arch.half;
  const lo = headHalf(arch.y[0]) - wall - 1, hi = headHalf(arch.y[1]) + 1;
  if (side === 0) return { from: [CX - a, arch.y[0], CZ + lo], to: [CX + a, arch.y[1], CZ + hi] };
  if (side === 2) return { from: [CX - a, arch.y[0], CZ - hi], to: [CX + a, arch.y[1], CZ - lo] };
  if (side === 1) return { from: [CX + lo, arch.y[0], CZ - a], to: [CX + hi, arch.y[1], CZ + a] };
  return { from: [CX - hi, arch.y[0], CZ - a], to: [CX - lo, arch.y[1], CZ + a] };
}
