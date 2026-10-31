import { StyleIdSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../../materials';
import { CREST_HEIGHT, CREST_WIDTH, FLAG_HEIGHT, FLAG_LENGTH, crestGrid, type BannerCut, type CrestCharge, type CrestShape } from '../heraldry';
import { Boxes, LANDMARK_KITS, hash, type LandmarkKit } from '../kit';
import { extentOf, flagBlueprint } from '../parts';
import type { CellBox, LandmarkPiece, LandmarkWalk } from '../types';

/**
 * The coastal harbour watchtower: a battered dark plinth on a skirt of sea boulders, a tall chamfered shaft of
 * stone that changes to render above the second string course, a corbelled gallery and crenellated parapet, and a
 * watch loft whose four arches show the beacon burning inside under a steep bell-cast roof. The kingdom's flag flies
 * from the pole above it, as a separate part on its hoist. At its foot: a deep arched door with a hooded porch and two lanterns, steps down to the
 * quay, a bench, mooring bollards, creels, a coil of rope and a ship's anchor leaning on the plinth, and a cargo
 * hoist swung out from the gallery. Front (+Z) is the door.
 *
 * `crown` follows the recipe's own landmark: a lighthouse kingdom glazes the loft into a lamp room; every other
 * kingdom keeps the open beacon loft. The crest over the door and the flag carry the recipe's crest and banner
 * grammar in snapped kit colours.
 */
export type WatchtowerCrown = 'beacon-loft' | 'lamp-room';
export interface HarbourWatchtowerOptions {
  readonly style: StyleKey;
  readonly crown: WatchtowerCrown;
  readonly crest: { readonly shape: CrestShape; readonly charge: CrestCharge };
  readonly bannerCut: BannerCut;
  /** Snapped cloth materials: the field of crest and flag, and the flag's band. */
  readonly colours: { readonly field: number; readonly band: number };
}

export const WATCHTOWER_SIZE: Vec3 = [96, 240, 96];
/** The tower's axis, in cells. */
export const WATCHTOWER_AXIS = { x: 48, z: 44 } as const;

const CX = WATCHTOWER_AXIS.x, CZ = WATCHTOWER_AXIS.z;

/** The measured planes of the tower, shared by the factory, its metadata and its tests. */
export const WATCHTOWER = {
  footing: { half: 30, y: [0, 4] as const },
  /** Lower shaft (stone), upper shaft (render): outer half widths and heights. */
  shaft: { lower: { half: 24, y: [32, 72] as const }, upper: { half: 23, y: [74, 158] as const }, wall: 5 },
  door: {
    /** The open reveal, from the front of the leaf's ironwork to the porch face. */
    opening: { x: [42, 54] as const, y: [3, 23] as const, z: [68, 76] as const },
    /** Arch rows above the rectangular opening: [y, x0, x1]. */
    arch: [[23, 43, 53], [24, 44, 52], [25, 45, 51], [26, 47, 49]] as const,
    leaf: { x: [42, 54] as const, y: [3, 27] as const, z: [66, 67] as const },
    threshold: 3,
    /** Steps: [top, z0, z1, x0, x1]; the lowest is the widest. */
    steps: [[3, 76, 79, 36, 60], [2, 79, 83, 35, 61], [1, 83, 87, 34, 62]] as const,
  },
  porch: { x: [34, 62] as const, y: [3, 34] as const, z: [62, 76] as const },
  lanterns: [{ id: 'door-lantern-west', x: 37 }, { id: 'door-lantern-east', x: 59 }] as const,
  lantern: { glass: { y: [23, 28] as const, z: [78, 80] as const } },
  crest: { x: 41, y: 44, face: 67 },
  gallery: { floor: [158, 160] as const, half: 27, parapet: { y: [160, 169] as const, thickness: 2 } },
  loft: { half: 19, y: [160, 188] as const, wall: 3, arch: { half: 7, y: [164, 182] as const } },
  eaves: { y: [188, 190] as const, half: 23 },
  roof: { y: [190, 218] as const },
  /** `heart` is the top of the fire's heaped embers; `lens` the lighthouse lamp's glass. */
  beacon: { heart: 170, lens: [167, 174] as const },
  pole: { x: [47, 49] as const, z: [43, 45] as const, y: [218, 240] as const },
  /** The flag part's origin at rest, in tower cells, and its hoist pivot in part cells (the pole's centre line). */
  flag: { offset: [49, 226, 43] as const, pivot: [-1, 0, 1] as const },
  bench: { x: [22, 34] as const, y: [3, 4] as const, z: [76, 80] as const },
  hoist: { beam: { x: [70, 88] as const, y: [164, 166] as const, z: [43, 45] as const }, rope: { x: 86, z: 43, y: [128, 161] as const } },
} as const;

/** Half width of the shaft's outer face at height `y`. */
const shaftHalf = (y: number) => (y < WATCHTOWER.shaft.lower.y[1] + 1 ? WATCHTOWER.shaft.lower.half : WATCHTOWER.shaft.upper.half);

export function createHarbourWatchtower(options: HarbourWatchtowerOptions): LandmarkPiece {
  const { style, crown, crest, bannerCut, colours } = options;
  if (!(style in LANDMARK_KITS)) throw new Error(`Unknown landmark style ${String(style)}.`);
  if (crown !== 'beacon-loft' && crown !== 'lamp-room') throw new Error(`Unknown watchtower crown ${String(crown)}.`);
  const kit = LANDMARK_KITS[style];
  const b = new Boxes();

  plinth(b, kit);
  shaft(b, kit);
  windows(b, kit);
  gallery(b, kit);
  loft(b, kit, crown);
  roof(b, kit);
  porch(b, kit);
  crestPanel(b, kit, crest, colours.field);
  lanterns(b, kit);
  hoist(b, kit);
  quay(b, kit);

  const id = `genesis-harbour-watchtower-${style}-${crown}-${crest.shape}-${crest.charge}-${bannerCut}-${colours.field}-${colours.band}`;
  const blueprint: VoxelBlueprint = {
    version: 1, id, styleId: StyleIdSchema.parse(STYLES[style].id), kind: 'civic', lattice: 'build',
    size: [...WATCHTOWER_SIZE], boxes: b.list, windows: [],
  };
  const { offset, pivot } = WATCHTOWER.flag;
  const flag = { id: 'flag', blueprint: flagBlueprint('harbour', style, kit, bannerCut, colours), mount: 'flag-hoist', offset: [...offset] as Vec3, pivot: [...pivot] as Vec3 };
  return { blueprint, ...metadata(blueprint, crown), parts: [flag] };
}

// ── Plinth and shaft ─────────────────────────────────────────────────────────────────────────────────────────────

function plinth(b: Boxes, kit: LandmarkKit): void {
  // A wide footing course, three battered courses each set back a cell, and a pale weathering cap.
  b.octagon(CX, CZ, 30, 10, 0, 4, kit.base);
  b.octagon(CX, CZ, 29, 10, 4, 12, kit.base);
  b.octagon(CX, CZ, 28, 9, 12, 20, kit.base);
  b.octagon(CX, CZ, 27, 9, 20, 30, kit.base);
  b.octagon(CX, CZ, 28, 9, 30, 32, kit.band);
  // Weathered blocks: a few stones of the shaft's colour let into the dark plinth, and weed at the waterline.
  for (let i = 0; i < 28; i++) {
    const side = i % 4, along = Math.floor(hash(i, 1, 0, 71) * 30) - 15, y = 5 + Math.floor(hash(i, 2, 0, 71) * 22);
    const course = (h: number) => (h < 12 ? 29 : h < 20 ? 28 : 27), half = course(y), w = 3 + Math.floor(hash(i, 3, 0, 71) * 3);
    if (Math.abs(along) + w > half - 10 || course(y + 1) !== half || y + 2 > 30) continue;
    if (side === 0 && Math.abs(along) < 16) continue; // the porch stands on the front
    face(b, side, half, along, along + w, y, y + 2, kit.stone);
  }
  for (let i = 0; i < 22; i++) {
    const side = 1 + (i % 3), along = Math.floor(hash(i, 4, 0, 72) * 36) - 18, w = 2 + Math.floor(hash(i, 5, 0, 72) * 5);
    if (Math.abs(along) + w > 19) continue;
    face(b, side, 30, along, along + w, 0, 1 + Math.floor(hash(i, 6, 0, 72) * 3), MAT.moss);
  }
}

/**
 * Cells between layers `l0..l1` out from the axis on one side: side 0 front (+Z), 1 east (+X), 2 back (−Z), 3 west
 * (−X). `a..A` runs along the face from its centre, towards +X on the front and back and towards +Z on the flanks.
 */
function slab(b: Boxes, side: number, l0: number, l1: number, a: number, A: number, y: number, Y: number, material: number): void {
  if (side === 0) b.add(CX + a, y, CZ + l0, CX + A, Y, CZ + l1, material);
  else if (side === 2) b.add(CX + a, y, CZ - l1, CX + A, Y, CZ - l0, material);
  else if (side === 1) b.add(CX + l0, y, CZ + a, CX + l1, Y, CZ + A, material);
  else b.add(CX - l1, y, CZ + a, CX - l0, Y, CZ + A, material);
}
/** The outermost layer of a face of half width `half`. */
const face = (b: Boxes, side: number, half: number, a: number, A: number, y: number, Y: number, m: number) => slab(b, side, half - 1, half, a, A, y, Y, m);
/** One cell standing proud of a face. */
const proud = (b: Boxes, side: number, half: number, a: number, A: number, y: number, Y: number, m: number) => slab(b, side, half, half + 1, a, A, y, Y, m);
/** Air through the wall of a face, `depth` cells deep. */
const cut = (b: Boxes, side: number, half: number, a: number, A: number, y: number, Y: number, depth: number) => slab(b, side, half - depth, half, a, A, y, Y, MAT.air);
/** One layer `depth` cells in from the outer face. */
const inset = (b: Boxes, side: number, half: number, a: number, A: number, y: number, Y: number, depth: number, m: number) => slab(b, side, half - depth, half - depth + 1, a, A, y, Y, m);

function shaft(b: Boxes, kit: LandmarkKit): void {
  const { lower, upper } = WATCHTOWER.shaft;
  b.octagon(CX, CZ, lower.half, 8, lower.y[0], lower.y[1], kit.stone);
  b.octagon(CX, CZ, lower.half + 1, 8, 72, 74, kit.band);
  b.octagon(CX, CZ, upper.half, 8, 74, 112, kit.stone);
  b.octagon(CX, CZ, upper.half + 1, 8, 112, 114, kit.band);
  // Render above the second course, held by long-and-short stone quoins on all eight corners.
  b.octagon(CX, CZ, upper.half, 8, 114, upper.y[1], kit.wall);
  for (let y = 114, k = 0; y < 150; y += 4, k++) {
    const reach = k % 2 ? 3 : 5;
    b.octagon(CX, CZ, upper.half, 8, y, y + 4, kit.stone);
    const inner = upper.half - 8 - reach;
    b.add(CX - inner, y, CZ - upper.half, CX + inner, y + 4, CZ + upper.half, kit.wall);
    b.add(CX - upper.half, y, CZ - inner, CX + upper.half, y + 4, CZ + inner, kit.wall);
  }
  // Ashlar: a few darker stones in the lower shaft so the stone reads as laid blocks, not as a cast.
  for (let i = 0; i < 40; i++) {
    const side = i % 4, y = 34 + Math.floor(hash(i, 1, 0, 73) * 76), half = shaftHalf(y);
    const along = Math.floor(hash(i, 2, 0, 73) * 26) - 13, w = 3 + Math.floor(hash(i, 3, 0, 73) * 3);
    if (y >= 70 && y < 76) continue;
    if (side === 0 && y < 64 && Math.abs(along) < 12) continue; // keep the crest's wall clean
    face(b, side, half, along, Math.min(along + w, half - 9), y, y + 2, kit.rock);
  }
  // Hollow inside, so the slit windows open onto real darkness.
  b.octagon(CX, CZ, upper.half - WATCHTOWER.shaft.wall, 6, 36, 156, MAT.air);
}

/** Arrow-slit windows staggered up the faces as if following a stair: [side, y]. */
export const WATCHTOWER_SLITS = [
  [0, 86], [0, 124], [1, 48], [1, 96], [1, 136], [2, 58], [2, 118], [3, 80], [3, 130],
] as const;

function windows(b: Boxes, kit: LandmarkKit): void {
  for (const [side, y] of WATCHTOWER_SLITS) {
    const half = shaftHalf(y), depth = WATCHTOWER.shaft.wall + 2;
    // Through the wall, two cells wide and ten high, with a pointed head of one cell.
    cut(b, side, half, -1, 1, y, y + 10, depth);
    cut(b, side, half, 0, 1, y + 10, y + 11, depth);
    // A proud band sill and a deep lintel.
    proud(b, side, half, -2, 2, y - 1, y, kit.band);
    proud(b, side, half, -2, 2, y + 11, y + 13, kit.band);
  }
}



// ── Gallery, loft, roof and flag ─────────────────────────────────────────────────────────────────────────────────

function gallery(b: Boxes, kit: LandmarkKit): void {
  const top = WATCHTOWER.shaft.upper.half;
  // Three tiers of corbels on every straight face, each tier reaching one cell further, so the gallery sits on a
  // row of brackets with shadowed gaps between them.
  for (let side = 0; side < 4; side++) {
    for (let a = -13; a <= 11; a += 4) {
      for (let tier = 0; tier < 3; tier++) {
        const y = 150 + tier * 3;
        slab(b, side, top, top + tier + 1, a, a + 2, y, y + 3, kit.stone);
      }
    }
  }
  const { half, floor, parapet } = WATCHTOWER.gallery;
  b.octagon(CX, CZ, half, 9, floor[0], floor[1], kit.stone);
  b.octagon(CX, CZ, half, 9, floor[0], floor[0] + 1, kit.band);
  // Parapet: a ring two cells thick, cut into merlons, each capped by a pale coping.
  b.octagon(CX, CZ, half, 9, parapet.y[0], parapet.y[1], kit.stone);
  b.octagon(CX, CZ, half - parapet.thickness, 8, parapet.y[0], parapet.y[1], MAT.air);
  b.octagon(CX, CZ, half, 9, parapet.y[1] - 1, parapet.y[1], kit.band);
  b.octagon(CX, CZ, half - parapet.thickness, 8, parapet.y[1] - 1, parapet.y[1], MAT.air);
  for (let side = 0; side < 4; side++) {
    for (const a of [-15, -8, -1, 6, 13]) cut(b, side, half, a - 1, a + 2, parapet.y[0] + 4, parapet.y[1], parapet.thickness);
  }
}

function loft(b: Boxes, kit: LandmarkKit, crown: WatchtowerCrown): void {
  const { half, y, wall, arch } = WATCHTOWER.loft;
  b.octagon(CX, CZ, half, 6, y[0], y[1], kit.stone);
  b.octagon(CX, CZ, half - wall, 5, y[0], y[1], MAT.air);
  // Pale quoins on the loft's corners, alternating long and short.
  for (let yy = y[0], k = 0; yy < y[1]; yy += 3, k++) {
    if (k % 2) continue;
    b.octagon(CX, CZ, half, 6, yy, yy + 3, kit.band);
    b.add(CX - half + 8, yy, CZ - half, CX + half - 8, yy + 3, CZ + half, kit.stone);
    b.add(CX - half, yy, CZ - half + 8, CX + half, yy + 3, CZ + half - 8, kit.stone);
    b.octagon(CX, CZ, half - wall, 5, yy, yy + 3, MAT.air);
  }
  for (let side = 0; side < 4; side++) {
    // An arch ring one cell proud, then the opening through the wall with a rounded head.
    proud(b, side, half, -arch.half - 1, arch.half + 1, arch.y[0] - 1, arch.y[1] + 2, kit.band);
    proud(b, side, half, -arch.half, arch.half, arch.y[0], arch.y[1], MAT.air);
    cut(b, side, half + 1, -arch.half, arch.half, arch.y[0], arch.y[1] - 2, wall + 1);
    cut(b, side, half + 1, -arch.half + 1, arch.half - 1, arch.y[1] - 2, arch.y[1], wall + 1);
    cut(b, side, half + 1, -arch.half + 3, arch.half - 3, arch.y[1], arch.y[1] + 1, wall + 1);
    proud(b, side, half, -arch.half + 3, arch.half - 3, arch.y[1], arch.y[1] + 1, MAT.air);
    // A timber sill to lean on.
    proud(b, side, half, -arch.half, arch.half, arch.y[0] - 1, arch.y[0], kit.trim);
    if (crown === 'lamp-room') {
      // Glazed: a pane set two cells into the arch, framed by bright mullions and a transom.
      inset(b, side, half, -arch.half, arch.half, arch.y[0], arch.y[1] - 2, 2, MAT.glass);
      inset(b, side, half, -arch.half + 1, arch.half - 1, arch.y[1] - 2, arch.y[1], 2, MAT.glass);
      inset(b, side, half, -arch.half + 3, arch.half - 3, arch.y[1], arch.y[1] + 1, 2, MAT.glass);
      for (const a of [-4, 3]) inset(b, side, half, a, a + 1, arch.y[0], arch.y[1], 2, kit.metal);
      inset(b, side, half, -arch.half, arch.half, 175, 176, 2, kit.metal);
    }
  }
  // The beacon: a stone pedestal, a bright bowl, its coals and the hot heart of the fire.
  b.octagon(CX, CZ, 3, 1, y[0], 165, kit.stone);
  b.octagon(CX, CZ, 4, 1, 164, 165, kit.band);
  if (crown === 'beacon-loft') {
    b.octagon(CX, CZ, 6, 2, 165, 169, kit.metal);
    b.octagon(CX, CZ, 5, 2, 166, 169, MAT.air);
    b.octagon(CX, CZ, 5, 2, 166, 168, kit.iron);
    b.octagon(CX, CZ, 3, 1, 168, 169, MAT.fabricOrange);
    b.octagon(CX, CZ, 1, 0, 169, WATCHTOWER.beacon.heart, MAT.fabricGold);
    for (let i = 0; i < 14; i++) {
      const x = CX - 4 + Math.floor(hash(i, 1, 0, 74) * 8), z = CZ - 4 + Math.floor(hash(i, 2, 0, 74) * 8);
      b.add(x, 168, z, x + 1, 169, z + 1, i % 3 ? MAT.fabricOrange : MAT.fabricGold);
    }
    // Iron hoops of the fire basket, rising above the bowl.
    for (const [x, z] of [[-6, -1], [5, -1], [-1, -6], [-1, 5]] as const) b.add(CX + x, 169, CZ + z, CX + x + 1, 172, CZ + z + 2, kit.iron);
  } else {
    // A lighthouse lamp: a bright base, a glass lens and a cap.
    b.octagon(CX, CZ, 4, 1, 165, 167, kit.metal);
    b.octagon(CX, CZ, 3, 1, WATCHTOWER.beacon.lens[0], WATCHTOWER.beacon.lens[1], MAT.glass);
    b.octagon(CX, CZ, 4, 1, WATCHTOWER.beacon.lens[1], WATCHTOWER.beacon.lens[1] + 2, kit.metal);
  }
  // The loft's ceiling joists, seen through the arches.
  for (const a of [-12, -4, 4, 12]) b.add(CX - half + wall, y[1] - 2, CZ + a - 1, CX + half - wall, y[1], CZ + a + 1, kit.trim);
}


function roof(b: Boxes, kit: LandmarkKit): void {
  const { eaves, roof } = WATCHTOWER;
  // A timber fascia under bell-cast eaves, then a steep octagonal spire that flares at its foot.
  b.octagon(CX, CZ, eaves.half, 7, eaves.y[0], eaves.y[0] + 1, kit.trim);
  b.octagon(CX, CZ, eaves.half, 7, eaves.y[0] + 1, eaves.y[1], kit.roof);
  const rows = roof.y[1] - roof.y[0];
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const half = Math.max(1, Math.round(1 + 20.5 * (1 - t) ** 1.25));
    b.octagon(CX, CZ, half, Math.round(half * 0.33), roof.y[0] + r, roof.y[0] + r + 1, kit.roof);
  }
  // Four dormers with their own small hoods, facing the four ways: the watch's eyes in the roof. Each body runs
  // back into the slope; its face stands three cells out from the course below it.
  const base = 198, front = 17;
  for (let side = 0; side < 4; side++) {
    slab(b, side, 9, front, -3, 3, base, base + 6, kit.wall);
    slab(b, side, front - 1, front, -1, 1, base + 1, base + 5, MAT.glass);
    slab(b, side, 9, front + 1, -4, 4, base - 1, base, kit.trim);
    for (let k = 0; k < 5; k++) slab(b, side, 9, front + 1, -4 + k, 4 - k, base + 6 + k, base + 7 + k, kit.roof);
  }
  // A bright finial and the flagpole.
  b.octagon(CX, CZ, 2, 0, roof.y[1], roof.y[1] + 1, kit.metal);
  b.octagon(CX, CZ, 3, 1, roof.y[1] + 1, roof.y[1] + 3, kit.metal);
  b.octagon(CX, CZ, 2, 0, roof.y[1] + 3, roof.y[1] + 4, kit.metal);
  const { pole } = WATCHTOWER;
  b.add(pole.x[0], roof.y[1] + 4, pole.z[0], pole.x[1], pole.y[1] - 1, pole.z[1], kit.trim);
  b.add(pole.x[0], pole.y[1] - 1, pole.z[0], pole.x[1], pole.y[1], pole.z[1], kit.metal);
}

// ── The door, the crest and the lanterns ─────────────────────────────────────────────────────────────────────────

function porch(b: Boxes, kit: LandmarkKit): void {
  const { porch, door } = WATCHTOWER;
  b.add(porch.x[0], 0, porch.z[0], porch.x[1], porch.y[1], porch.z[1], kit.stone);
  b.add(porch.x[0] - 1, 0, porch.z[0], porch.x[1] + 1, door.threshold, porch.z[1] + 1, kit.base);
  // A pale arch ring two cells wide, its jambs alternately long and short.
  b.add(40, door.threshold, 74, 56, 23, 76, kit.band);
  for (const [y, x0, x1] of [[23, 41, 55], [24, 41, 55], [25, 42, 54], [26, 42, 54], [27, 43, 53], [28, 45, 51]] as const) b.add(x0, y, 74, x1, y + 1, 76, kit.band);
  for (let y = door.threshold, k = 0; y < 23; y += 4, k++) if (k % 2) { b.add(40, y, 74, 41, y + 4, 76, kit.stone); b.add(55, y, 74, 56, y + 4, 76, kit.stone); }
  b.add(47, 27, 74, 49, 31, 77, kit.band);
  // The opening and the leaf.
  const { opening, leaf } = door;
  b.add(opening.x[0], opening.y[0], leaf.z[0], opening.x[1], opening.y[1], opening.z[1], MAT.air);
  for (const [y, x0, x1] of door.arch) b.add(x0, y, leaf.z[0], x1, y + 1, opening.z[1], MAT.air);
  b.add(leaf.x[0], leaf.y[0], leaf.z[0], leaf.x[1], 23, leaf.z[1], kit.trim);
  for (const [y, x0, x1] of door.arch) b.add(x0, y, leaf.z[0], x1, y + 1, leaf.z[1], kit.trim);
  for (const x of [45, 48, 51]) b.add(x, leaf.y[0], leaf.z[0], x + 1, 25, leaf.z[1], MAT.bark);
  // Strap hinges, studs and a bright ring.
  for (const y of [7, 18]) b.add(leaf.x[0], y, leaf.z[1], leaf.x[0] + 9, y + 1, leaf.z[1] + 1, kit.iron);
  for (const [x, y] of [[44, 12], [52, 12], [44, 22], [52, 22], [48, 9]] as const) b.add(x, y, leaf.z[1], x + 1, y + 1, leaf.z[1] + 1, kit.iron);
  b.add(49, 13, leaf.z[1], 50, 14, leaf.z[1] + 1, kit.metal);
  b.add(48, 11, leaf.z[1], 51, 12, leaf.z[1] + 1, kit.metal);
  // The sill: worn stone, a cell lower at the leaf's foot.
  b.add(opening.x[0], 0, opening.z[0], opening.x[1], door.threshold, opening.z[1], kit.stone);
  // The steps down to the quay.
  for (const [top, z0, z1, x0, x1] of door.steps) {
    b.add(x0, 0, z0, x1, top, z1, kit.stone);
    b.add(x0, top - 1, z1 - 1, x1, top, z1, kit.band);
  }
  // A gabled hood on two timber brackets, its gable rendered and framed by the roof's overhang.
  for (const x of [35, 60]) { b.add(x, 30, 76, x + 1, 34, 78, kit.trim); b.add(x, 33, 78, x + 1, 34, 80, kit.trim); }
  for (let k = 0; k < 9; k++) {
    const x0 = porch.x[0] - 1 + 2 * k, x1 = porch.x[1] + 1 - 2 * k;
    if (x1 - x0 < 2) break;
    b.add(x0, porch.y[1] + k, 68, x1, porch.y[1] + k + 1, 81, kit.roof);
    if (x1 - x0 > 4) b.add(x0 + 2, porch.y[1] + k, 79, x1 - 2, porch.y[1] + k + 1, 80, k ? kit.wall : kit.trim);
    if (x1 - x0 > 4) b.add(x0 + 2, porch.y[1] + k, 80, x1 - 2, porch.y[1] + k + 1, 81, MAT.air);
  }
}

function crestPanel(b: Boxes, kit: LandmarkKit, crest: HarbourWatchtowerOptions['crest'], field: number): void {
  const { x, y, face } = WATCHTOWER.crest;
  // A pale frame proud of the shaft, then the arms: field flush in the face, border and charge one cell proud.
  b.add(x - 2, y - 2, face + 1, x + CREST_WIDTH + 2, y + CREST_HEIGHT + 2, face + 2, kit.band);
  b.add(x - 1, y - 1, face + 1, x + CREST_WIDTH + 1, y + CREST_HEIGHT + 1, face + 2, MAT.air);
  b.add(x - 3, y + CREST_HEIGHT + 2, face + 1, x + CREST_WIDTH + 3, y + CREST_HEIGHT + 4, face + 3, kit.band);
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

function lanterns(b: Boxes, kit: LandmarkKit): void {
  const { glass } = WATCHTOWER.lantern;
  for (const { x } of WATCHTOWER.lanterns) {
    // A bracket from the porch face, a hanger, and a caged lantern with a bright cap and foot.
    b.add(x, 31, 76, x + 1, 32, 80, kit.iron);
    b.add(x, 30, 79, x + 1, 31, 80, kit.iron);
    b.add(x - 1, 29, 78, x + 2, 30, 81, kit.metal);
    b.add(x - 2, 28, 77, x + 3, 29, 82, kit.metal);
    for (const [dx, dz] of [[-2, 77], [2, 77], [-2, 81], [2, 81]] as const) b.add(x + dx, glass.y[0], dz, x + dx + 1, glass.y[1], dz + 1, kit.iron);
    b.add(x - 1, glass.y[0], glass.z[0], x + 2, glass.y[1], glass.z[1] + 1, MAT.glass);
    b.add(x - 2, 22, 77, x + 3, 23, 82, kit.metal);
    b.add(x, 21, 79, x + 1, 22, 80, kit.metal);
  }
}

// ── The harbour at its foot ──────────────────────────────────────────────────────────────────────────────────────

function hoist(b: Boxes, kit: LandmarkKit): void {
  const { beam, rope } = WATCHTOWER.hoist;
  // A cargo arm swung out from the gallery on a raking brace, a pulley block, and a rope with a hook.
  b.add(beam.x[0], beam.y[0], beam.z[0], beam.x[1], beam.y[1], beam.z[1], kit.trim);
  b.add(beam.x[0], WATCHTOWER.gallery.floor[1], beam.z[0], beam.x[0] + 2, beam.y[0], beam.z[1], kit.trim);
  for (let k = 0; k < 7; k++) b.add(73 + k, 157 + k, 43, 75 + k, 158 + k, 45, kit.trim);
  b.add(rope.x - 1, rope.y[1], rope.z - 1, rope.x + 2, beam.y[0], rope.z + 2, MAT.bark);
  b.add(rope.x, rope.y[0], rope.z, rope.x + 1, rope.y[1], rope.z + 1, kit.cord);
  b.add(rope.x - 1, rope.y[0] - 2, rope.z, rope.x + 2, rope.y[0], rope.z + 1, kit.iron);
  b.add(rope.x - 1, rope.y[0] - 4, rope.z, rope.x, rope.y[0] - 2, rope.z + 1, kit.iron);
}

function quay(b: Boxes, kit: LandmarkKit): void {
  // Boulders heaped round the sides and the seaward back, half sunk, some with weed on their crowns.
  for (let i = 0; i < 34; i++) {
    const angle = (i / 34) * Math.PI * 2 + hash(i, 1, 0, 75) * 0.15;
    const sx = Math.sin(angle), cz = Math.cos(angle);
    if (cz > 0.55 || (sx > 0.8 && Math.abs(cz) < 0.5)) continue; // the front stays open, the anchor's flank too
    const r = 30 + hash(i, 2, 0, 75) * 9, w = 4 + Math.floor(hash(i, 3, 0, 75) * 5), d = 4 + Math.floor(hash(i, 4, 0, 75) * 5);
    const h = 3 + Math.floor(hash(i, 5, 0, 75) * (i % 3 ? 4 : 8));
    const x = Math.round(CX + sx * r - w / 2), z = Math.round(CZ + cz * r - d / 2);
    const x0 = Math.max(0, x), z0 = Math.max(0, z), x1 = Math.min(96, x + w), z1 = Math.min(96, z + d);
    const material = i % 2 ? kit.rock : kit.stone;
    b.add(x0, 0, z0 + 1, x1, h, z1 - 1, material);
    b.add(x0 + 1, 0, z0, x1 - 1, h - 1, z1, material);
    b.add(x0 + 1, h, z0 + 1, x1 - 1, h + 1, z1 - 1, material);
    if (i % 3 === 0) b.add(x0 + 1, h, z0 + 1, x1 - 1, h + 1, z1 - 1, MAT.moss);
  }
  // Two mooring bollards with rope turned about them.
  for (const [x, z] of [[14, 82], [86, 70]] as const) {
    b.octagon(x, z, 3, 1, 0, 2, kit.iron);
    b.octagon(x, z, 2, 0, 2, 9, kit.iron);
    b.octagon(x, z, 3, 1, 9, 11, kit.iron);
    b.octagon(x, z, 3, 1, 4, 6, kit.cord);
    b.add(x - 2, 4, z - 2, x + 2, 6, z + 2, kit.iron);
  }
  b.add(14, 4, 85, 15, 5, 92, kit.cord);
  b.add(14, 0, 91, 15, 4, 92, kit.cord);
  // A bench against the porch side, facing the water.
  const { bench } = WATCHTOWER;
  b.add(bench.x[0], bench.y[0], bench.z[0], bench.x[1], bench.y[1], bench.z[1], kit.trim);
  for (const x of [bench.x[0] + 1, bench.x[1] - 3]) b.add(x, 0, bench.z[0] + 1, x + 2, bench.y[0], bench.z[1] - 1, MAT.bark);
  // Creels stacked by the steps: woven cord over timber hoops, with a slatted crate.
  for (const [x, y, z] of [[64, 0, 78], [71, 0, 79], [67, 6, 79]] as const) {
    b.add(x, y, z, x + 7, y + 1, z + 9, MAT.bark);
    b.add(x, y + 1, z + 1, x + 7, y + 5, z + 8, kit.cord);
    b.add(x + 1, y + 5, z + 1, x + 6, y + 6, z + 8, kit.cord);
    for (const dz of [1, 4, 7]) { b.add(x, y + 1, z + dz, x + 7, y + 5, z + dz + 1, kit.trim); b.add(x + 1, y + 5, z + dz, x + 6, y + 6, z + dz + 1, kit.trim); }
    b.add(x + 2, y + 2, z + 6, x + 5, y + 4, z + 8, MAT.air);
  }
  b.add(70, 0, 88, 78, 6, 95, kit.trim);
  for (const y of [1, 4]) b.add(70, y, 95, 78, y + 1, 96, MAT.bark);
  b.add(71, 6, 89, 77, 7, 94, MAT.bark);
  // A coil of rope on the quay.
  b.octagon(24, 88, 4, 1, 0, 2, kit.cord);
  b.octagon(24, 88, 2, 0, 1, 2, MAT.air);
  // A ship's anchor stood against the plinth's east face.
  b.add(79, 2, 37, 81, 28, 39, kit.iron);
  b.add(78, 28, 37, 82, 29, 39, kit.iron);
  b.add(78, 29, 37, 79, 32, 39, kit.iron);
  b.add(81, 29, 37, 82, 32, 39, kit.iron);
  b.add(78, 32, 37, 82, 33, 39, kit.iron);
  b.add(76, 23, 37, 84, 25, 39, kit.trim);
  b.add(79, 0, 29, 81, 3, 47, kit.iron);
  for (const [z0, z1] of [[28, 30], [46, 48]] as const) { b.add(79, 0, z0, 81, 6, z1, kit.iron); b.add(78, 4, z0 - (z0 < 40 ? 1 : 0), 82, 7, z1 + (z0 < 40 ? 0 : 1), kit.iron); }
}

// ── Metadata ─────────────────────────────────────────────────────────────────────────────────────────────────────

function metadata(blueprint: VoxelBlueprint, crown: WatchtowerCrown): Omit<LandmarkPiece, 'blueprint' | 'parts'> {
  const { door, bench, lanterns, lantern, beacon, pole, flag: banner, hoist: crane, loft: watch } = WATCHTOWER;
  const hoistAt: Vec3 = [(pole.x[0] + pole.x[1]) / 2, banner.offset[1], (pole.z[0] + pole.z[1]) / 2];
  const depth = blueprint.size[2];
  const ground = 6, head = 20;
  const outer = depth + ground;
  const tops: number[] = [];
  for (let z = door.opening.z[0]; z < outer; z++) {
    const step = door.steps.find(([, z0, z1]) => z >= z0 && z < z1);
    tops.push(z < door.steps[0][1] ? door.threshold : step ? step[0] : 0);
  }
  const approach: LandmarkWalk = { id: 'door-approach', axis: 'z', along: [door.opening.z[0], outer], across: [door.opening.x[0], door.opening.x[1]], tops };
  // The fire's heart sits on the coals; a lamp's sits in the middle of its lens.
  const beaconAt: Vec3 = crown === 'lamp-room' ? [CX, beacon.lens[0] + (beacon.lens[1] - beacon.lens[0]) / 2, CZ] : [CX, beacon.heart, CZ];
  const flameFrom = crown === 'lamp-room' ? beacon.lens[1] + 2 : beacon.heart;
  return {
    extent: extentOf(blueprint),
    footings: [
      { id: 'plinth', box: { from: [CX - 30, 0, CZ - 30], to: [CX + 30, 4, CZ + 30] }, embed: 0 },
      { id: 'steps', box: { from: [door.steps[2][3], 0, door.steps[0][1]], to: [door.steps[2][4], 1, door.steps[2][2]] }, embed: 0 },
      { id: 'boulders', box: { from: [0, 0, 0], to: [96, 1, CZ + 18] }, embed: 4 },
    ],
    doorways: [{
      id: 'door', facing: 'south',
      opening: { from: [door.opening.x[0], door.opening.y[0], door.opening.z[0]], to: [door.opening.x[1], door.opening.y[1], door.opening.z[1]] },
      leaf: { from: [door.leaf.x[0], door.leaf.y[0], door.leaf.z[0]], to: [door.leaf.x[1], door.leaf.y[1], door.leaf.z[1]] },
      threshold: door.threshold, approach,
      clearance: { from: [door.opening.x[0], door.threshold, door.opening.z[0]], to: [door.opening.x[1], door.threshold + head, outer] },
      groundAt: 0, state: 'closed',
    }],
    walks: [approach],
    seats: [{ id: 'quay-bench', box: { from: [bench.x[0], bench.y[0], bench.z[0]], to: [bench.x[1], bench.y[1], bench.z[1]] }, facing: 'south' }],
    emitters: [
      { id: 'beacon', kind: 'beacon', position: beaconAt, reach: 160 },
      ...lanterns.map(({ id, x }) => ({ id, kind: 'lantern' as const, position: [x + 0.5, (lantern.glass.y[0] + lantern.glass.y[1]) / 2, (lantern.glass.z[0] + lantern.glass.z[1]) / 2] as Vec3, reach: 48 })),
    ],
    sounds: [
      { id: 'beacon-fire', kind: 'beacon-fire', position: beaconAt },
      { id: 'flag', kind: 'flag', position: [hoistAt[0] + FLAG_LENGTH / 2, hoistAt[1] + FLAG_HEIGHT / 2, hoistAt[2]] },
      { id: 'hoist', kind: 'rope-creak', position: [crane.rope.x + 0.5, crane.beam.y[0], crane.rope.z + 0.5] },
      { id: 'surf', kind: 'surf', position: [CX, 2, 6] },
    ],
    mounts: [
      { id: 'flag-hoist', position: hoistAt, axis: [0, 1, 0] },
      { id: 'hoist-pulley', position: [crane.rope.x + 0.5, crane.beam.y[0] - 1.5, crane.rope.z + 0.5], axis: [0, 0, 1] },
    ],
    clear: [
      { id: 'doorway', role: 'doorway', box: { from: [door.opening.x[0], door.opening.y[0], door.opening.z[0]], to: [door.opening.x[1], door.opening.y[1], door.opening.z[1]] } },
      { id: 'door-approach', role: 'approach', box: { from: [door.opening.x[0], door.threshold, door.opening.z[1]], to: [door.opening.x[1], door.threshold + head, outer] } },
      ...(['front', 'east', 'back', 'west'] as const).map((name, side) => ({ id: `lookout-${name}`, role: 'lookout' as const, box: lookout(side, crown) })),
      { id: 'flag-swing', role: 'flag-swing', box: { from: [CX - FLAG_LENGTH - 2, hoistAt[1], CZ - FLAG_LENGTH - 2], to: [CX + FLAG_LENGTH + 2, hoistAt[1] + FLAG_HEIGHT, CZ + FLAG_LENGTH + 2] } },
      { id: 'beacon-flame', role: 'beacon-flame', box: { from: [CX - 4, flameFrom, CZ - 4], to: [CX + 4, watch.y[1] - 2, CZ + 4] } },
    ],
    affordances: [
      { id: 'enter', kind: 'enter', uses: ['door', 'door-approach'], status: 'needs-host', requires: 'A host door action and an interior; the leaf stays closed in this piece.' },
      { id: 'sit', kind: 'sit', uses: ['quay-bench'], status: 'needs-host', requires: 'Host seat registration from the placed bench edge.' },
      { id: 'tend-beacon', kind: 'tend-beacon', uses: ['beacon', 'beacon-flame'], status: 'needs-host', requires: 'Host beacon light driven by real presence; content never lights it.' },
      { id: 'look-out', kind: 'look-out', uses: ['lookout-front', 'lookout-east', 'lookout-back', 'lookout-west'], status: 'needs-host', requires: 'A host climb or camera to the loft; the piece has no stair.' },
    ],
  };
}

/** The open arch of the loft on one side: through its wall, or only the reveal outside a lamp room's glass. */
function lookout(side: number, crown: WatchtowerCrown): CellBox {
  const { half, wall, arch } = WATCHTOWER.loft;
  const a = arch.half, h = half + 1, d = crown === 'lamp-room' ? 2 : wall + 1;
  const lo = arch.y[0], hi = arch.y[1] - 2;
  if (side === 0) return { from: [CX - a, lo, CZ + h - d], to: [CX + a, hi, CZ + h] };
  if (side === 2) return { from: [CX - a, lo, CZ - h], to: [CX + a, hi, CZ - h + d] };
  if (side === 1) return { from: [CX + h - d, lo, CZ - a], to: [CX + h, hi, CZ + a] };
  return { from: [CX - h, lo, CZ - a], to: [CX - h + d, hi, CZ + a] };
}
