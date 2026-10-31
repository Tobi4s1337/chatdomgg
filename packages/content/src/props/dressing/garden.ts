import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../../materials';
import { toBoxes } from './cover';

type Box = VoxelBlueprint['boxes'][number];
export type Vec = [number, number, number];
export type Kit = (typeof STYLES)[StyleKey];
export type Piece = { size: Vec; boxes: Box[] };

/**
 * A solid piece carved cell by cell. A later write replaces an earlier one, so every cell holds one material and
 * `piece()` writes it once. Writing outside the size throws, so a form can never spill out of its box.
 */
export function sculpt(size: Vec) {
  const cells = new Map<string, number>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const set = (x: number, y: number, z: number, material: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2]) throw new Error(`Cell ${x},${y},${z} lies outside ${size.join('×')}.`);
    cells.set(key(x, y, z), material);
  };
  /** Fills the half-open box [x0, x1) × [y0, y1) × [z0, z1). */
  const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number) => {
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) set(x, y, z, material);
  };
  const has = (x: number, y: number, z: number) => cells.has(key(x, y, z));
  const clear = (x: number, y: number, z: number) => { cells.delete(key(x, y, z)); };
  /**
   * Stands one column per mark, one row per Z: `legend` lists each mark's materials from `y0` up. Air in a column
   * leaves that cell as it was, so a head can sit on a stem drawn by another mark. `.` is no column.
   */
  const stand = (rows: readonly string[], x0: number, z0: number, y0: number | ((x: number, z: number) => number), legend: Readonly<Record<string, readonly number[]>>) =>
    rows.forEach((row, z) => [...row].forEach((mark, x) => {
      if (mark === '.') return;
      const column = legend[mark];
      if (!column) throw new Error(`Unknown mark "${mark}" at ${x},${z}.`);
      const base = typeof y0 === 'number' ? y0 : y0(x0 + x, z0 + z);
      column.forEach((material, i) => { if (material !== MAT.air) set(x0 + x, base + i, z0 + z, material); });
    }));
  const piece = (): Piece => ({ size, boxes: toBoxes(cells, size) });
  return { cells, set, fill, has, clear, stand, piece };
}

/** Whether cell (i, j) lies in a round voxel disc `d` cells across. */
export const inDisc = (i: number, j: number, d: number) => i >= 0 && j >= 0 && i < d && j < d && (i - (d - 1) / 2) ** 2 + (j - (d - 1) / 2) ** 2 <= (d / 2) ** 2;

const { leaf, moss, earth, bark, thatch, cream, darkStone, terracotta } = MAT;

/**
 * The bed's planting, one row per Z from the house side, one mark per X, each a column standing on the soil:
 * `1`–`3` leaf that many cells tall, `a`–`c` the same with a moss tip, `m` a moss cushion, `e` a clod of turned
 * soil, `F` a flower-head cell on a leaf stem and `H` a head cell held by its neighbours. The tall leafy mass holds
 * the left end, a lower clump the right; two heads stand off-centre and one patch is left bare where the soil was
 * last turned. Nothing in it is a crop: every green is leaf, not fruit or a head to cut.
 */
const PLANTING = [
  '.1a2.....1a1....12a1',
  '1c3b21..1b21...1b3c2',
  '23c3c2.....1...2c3b1',
  '1b3c31.FF..m...13cb.',
  '.2b21..FH1.1a1..21..',
  '..11..1.1..2b2....HF',
  '.1a1..ee...1a1...1FF',
  '1....m.......m..1...',
];

/** Every kit's bed: soil two courses deep, the rim's top one course above it, the planting on the soil. */
export function gardenBed(kit: Kit): Piece {
  const s = sculpt([24, 5, 12]);
  const flower = kit.id === 'hearth' ? MAT.petal : kit.id === 'tide' ? MAT.blueFlower : MAT.cream;
  if (kit.id === 'hearth') {
    // A boarded edge on a stone footing course; four corner stakes and one stake mid-front stand a cell proud.
    for (let x = 0; x < 24; x++) for (let z = 0; z < 12; z++) {
      if (x > 0 && z > 0 && x < 23 && z < 11) continue;
      s.set(x, 0, z, kit.stone); s.fill(x, 1, z, x + 1, 3, z + 1, kit.trim);
    }
    for (const [x, z] of [[0, 0], [23, 0], [0, 11], [23, 11], [11, 11]] as const) s.fill(x, 0, z, x + 1, 4, z + 1, kit.trim);
  } else if (kit.id === 'tide') {
    // A kerb of rounded shore cobbles, each crowned a course above its joints, laid by hand round the bed.
    const ring: [number, number][] = [];
    for (let x = 0; x < 24; x++) ring.push([x, 0]);
    for (let z = 1; z < 12; z++) ring.push([23, z]);
    for (let x = 22; x >= 0; x--) ring.push([x, 11]);
    for (let z = 10; z > 0; z--) ring.push([0, z]);
    const cobbles = [3, 4, 3, 5, 3, 4, 4, 3, 4, 3, 3, 5, 4, 3, 4, 3, 5, 3, 3, 4, 3, 3];
    let at = 0;
    for (const length of cobbles) for (let i = 0; i < length && at < ring.length; i++, at++) {
      const [x, z] = ring[at]!;
      s.fill(x, 0, z, x + 1, i === 0 || i === length - 1 ? 2 : 3, z + 1, kit.stone);
    }
  } else {
    // Rounded logs two cells thick, front and back running past the ends with their pale end grain showing;
    // a dark boulder steadies the back right corner. Moss has crept along the logs' tops.
    for (const z of [0, 10]) { s.fill(0, 0, z, 24, 2, z + 2, bark); s.fill(0, 2, z + (z ? 0 : 1), 24, 3, z + (z ? 1 : 2), bark); }
    for (const x of [0, 22]) { s.fill(x, 0, 2, x + 2, 2, 10, bark); s.fill(x + (x ? 0 : 1), 2, 2, x + (x ? 1 : 2), 3, 10, bark); }
    for (const x of [0, 23]) for (const z of [0, 1, 10, 11]) for (let y = 0; y < 3; y++) if (s.has(x, y, z)) s.set(x, y, z, thatch);
    for (const [x0, x1, z] of [[3, 9, 1], [14, 18, 1], [6, 12, 10], [17, 21, 10]] as const) for (let x = x0; x < x1; x++) s.set(x, 2, z, moss);
    s.fill(20, 0, 9, 24, 3, 12, kit.stone); s.fill(21, 3, 10, 23, 4, 12, kit.stone); s.set(22, 3, 10, moss);
  }
  const inset = kit.id === 'grove' ? 2 : 1;
  s.fill(inset, 0, inset, 24 - inset, 2, 12 - inset, earth);
  if (kit.id === 'grove') s.fill(20, 0, 9, 24, 3, 12, kit.stone);
  s.stand(PLANTING, 2, 2, 2, {
    1: [leaf], 2: [leaf, leaf], 3: [leaf, leaf, leaf], a: [moss], b: [leaf, moss], c: [leaf, leaf, moss],
    m: [moss], e: [earth], F: [leaf, flower, flower], H: [MAT.air, flower, flower],
  });
  return s.piece();
}

/**
 * Split logs stacked tight under a short bark lean-to against a house wall (low Z). Round logs show their pale end
 * grain inside a bark rind on the garden face, three courses on the left stepping down to two on the right, one split half lying flat side down
 * on top; a few ends stand proud, one is set back, and three are freshly split. Two back posts carry the roof's high
 * edge, two front posts its eave; the bark slabs overlap down the slope and moss has taken the upper left.
 */
export function woodpile(): Piece {
  const s = sculpt([20, 12, 7]);
  for (const x of [0, 18]) { s.fill(x, 0, 0, x + 2, 11, 1, bark); s.fill(x, 0, 5, x + 2, 9, 6, bark); }
  s.fill(0, 11, 0, 20, 12, 3, bark);
  s.fill(0, 10, 2, 20, 11, 5, bark);
  s.fill(0, 9, 4, 20, 10, 7, bark);
  for (const x of [2, 3, 7, 12, 13, 17]) s.clear(x, 9, 6);
  s.fill(2, 11, 1, 6, 12, 2, moss); s.fill(3, 11, 2, 5, 12, 3, moss); s.fill(1, 10, 3, 5, 11, 4, moss);
  /**
   * A round log end-on: a bark body three cells across whose end shows a plus of end grain inside its bark rind. The
   * rinds of neighbouring logs meet, so the stack reads packed tight, with no daylight through it. The exposed end's
   * corners are weathered brown sapwood rather than black bark, so from the garden each end reads as a round tan
   * disc and not a pale cross.
   */
  const log = (cx: number, cy: number, front: number, end: number) => {
    for (let z = 1; z <= front; z++) {
      s.fill(cx - 1, cy - 1, z, cx + 2, cy + 2, z + 1, bark);
      if (z !== front && z !== 1) continue;
      const material = z === front ? end : thatch;
      s.set(cx, cy, z, material);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) s.set(cx + dx, cy + dy, z, material);
      if (z === front) for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) s.set(cx + dx, cy + dy, z, earth);
    }
  };
  const ends: [number, number, number, number][] = [
    [3, 1, 5, thatch], [6, 1, 6, thatch], [9, 1, 5, cream], [12, 1, 5, thatch], [15, 1, 6, thatch],
    [3, 4, 6, thatch], [6, 4, 5, thatch], [9, 4, 4, thatch], [12, 4, 5, cream], [15, 4, 5, thatch],
    [3, 7, 5, thatch], [6, 7, 6, cream], [9, 7, 5, thatch],
  ];
  for (const [cx, cy, front, end] of ends) log(cx, cy, front, end);
  // The split half: flat side down across the top of the fourth stack, its fresh face pale.
  for (let z = 1; z <= 5; z++) { s.fill(11, 6, z, 14, 7, z + 1, z === 5 ? cream : bark); s.set(12, 7, z, z === 5 ? cream : bark); }
  return s.piece();
}

/** One barrel's courses from the ground up: its diameter, and whether the course is an iron hoop. */
const BIG_BARREL: readonly [number, boolean][] = [[5, false], [5, true], [7, false], [7, true], [7, false], [7, false], [7, true], [7, false], [5, true], [5, false]];
const SMALL_BARREL: readonly [number, boolean][] = [[4, false], [6, true], [6, false], [6, false], [6, true], [6, false], [6, true], [4, false]];

/**
 * Two closed barrels side by side. The tall one stands at the back in honey-coloured staves; the shorter, darker one
 * is set a cell forward and turned so its bung sits on the other side. Each bellies out between its iron hoops and
 * carries a flush lid of the same wood with its bung stopped.
 */
export function barrels(): Piece {
  const s = sculpt([14, 10, 7]);
  const barrel = (x0: number, z0: number, courses: readonly [number, boolean][], wood: number, bung: [number, number]) => {
    const widest = Math.max(...courses.map(([d]) => d));
    courses.forEach(([d, hoop], y) => {
      const o = (widest - d) / 2;
      for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) if (inDisc(i, j, d)) s.set(x0 + o + i, y, z0 + o + j, hoop ? darkStone : wood);
    });
    s.set(x0 + bung[0], courses.length - 1, z0 + bung[1], wood === bark ? thatch : bark);
  };
  barrel(0, 0, BIG_BARREL, thatch, [4, 2]);
  barrel(8, 1, SMALL_BARREL, bark, [1, 2]);
  return s.piece();
}

/**
 * Two closed crates and a sack. The bottom crate has battened corners, a mid rail across its front and recessed
 * plank panels; the smaller top crate is turned the other way, set back and to the right, with a diagonal brace.
 * A tied grain sack slumps against the bottom crate's side, leaning in, its neck bound with straw cord.
 */
export function crates(): Piece {
  const s = sculpt([12, 12, 7]);
  const crate = (x0: number, y0: number, z0: number, w: number, h: number, d: number, brace: boolean) => {
    const [x1, y1, z1] = [x0 + w - 1, y0 + h - 1, z0 + d - 1];
    s.fill(x0, y0, z0, x1 + 1, y1 + 1, z1 + 1, thatch);
    const edge = (x: number, y: number, z: number) => Number(x === x0 || x === x1) + Number(y === y0 || y === y1) + Number(z === z0 || z === z1) >= 2;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      if (edge(x, y, z)) { s.set(x, y, z, bark); continue; }
      // The side panels sit a cell inside their battens; the lid stays flush and closed.
      const side = x === x0 || x === x1 || z === z0 || z === z1;
      if (side && y !== y1) s.clear(x, y, z);
    }
    if (brace) for (let i = 1; i < Math.min(w, h) - 1; i++) { s.set(x0 + i, y0 + i, z1, bark); s.set(x0 + i + 1, y0 + i, z1, bark); }
    else for (let x = x0 + 1; x < x1; x++) s.set(x, y0 + Math.floor(h / 2), z1, bark);
    return { x1, y1, z1 };
  };
  crate(0, 0, 0, 7, 6, 7, false);
  crate(2, 6, 0, 5, 5, 6, true);
  s.stand([
    '.cbb.',
    'ccccb',
    'ddcca',
    'dccca',
    '.cca.',
  ], 7, 1, 0, {
    a: [cream], b: [cream, cream], c: [cream, cream, cream], d: [cream, cream, cream, cream],
  });
  s.fill(7, 4, 2, 9, 5, 4, thatch);
  s.set(7, 3, 2, cream); s.set(8, 3, 2, cream); s.set(7, 3, 3, cream); s.set(8, 3, 3, cream);
  s.set(7, 5, 2, cream); s.set(7, 5, 3, cream); s.set(8, 5, 3, cream); s.set(7, 6, 3, cream);
  return s.piece();
}

/**
 * A two-wheeled garden cart parked with its shafts run down to the ground toward +X and its front resting on two
 * short legs. Iron-tyred wheels with four spokes stand on the ground at either side; the box has terracotta-painted
 * boards in a bark frame with corner stakes. It is empty except for one tied sack lying in it.
 */
export function handcart(): Piece {
  const s = sculpt([24, 14, 12]);
  // Wheels: eleven cells across on an axle at (7, 5); the outer ring is the iron tyre, the inner the felloe.
  const [cx, cy, r, ri] = [7, 5, 5.5, 4.2];
  for (const z of [1, 10]) {
    for (let x = cx - 5; x <= cx + 5; x++) for (let y = cy - 5; y <= cy + 5; y++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 > r * r) continue;
      if (d2 > ri * ri) {
        const outer = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (x + dx! - cx) ** 2 + (y + dy! - cy) ** 2 > r * r);
        s.set(x, y, z, outer ? darkStone : bark);
      } else if (x === cx || y === cy || (Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1)) s.set(x, y, z, bark);
    }
    s.set(cx, cy, z === 1 ? 0 : 11, darkStone);
  }
  s.fill(cx, cy, 2, cx + 1, cy + 1, 10, darkStone);
  // Frame and shafts: one beam each side, level under the box, then run down to the ground ahead.
  const shaft = [5, 5, 4, 4, 3, 3, 2, 2, 1, 0];
  for (const z of [3, 8]) {
    s.fill(1, 5, z, 15, 6, z + 1, bark);
    shaft.forEach((h, i) => s.fill(14 + i, h, z, 15 + i, (shaft[i - 1] ?? h) + 1, z + 1, bark));
    s.fill(13, 0, z, 14, 5, z + 1, bark);
  }
  s.fill(22, 1, 4, 23, 2, 8, bark);
  // The box: a plank floor, painted side and end boards, a bark top rail and corner stakes a cell proud.
  s.fill(1, 6, 3, 15, 7, 9, thatch);
  for (const z of [3, 8]) { s.fill(1, 7, z, 15, 9, z + 1, terracotta); s.fill(1, 9, z, 15, 10, z + 1, bark); }
  for (const x of [1, 14]) { s.fill(x, 7, 4, x + 1, 9, 8, terracotta); s.fill(x, 9, 4, x + 1, 10, 8, bark); }
  for (const x of [1, 14]) for (const z of [3, 8]) s.fill(x, 6, z, x + 1, 11, z + 1, bark);
  s.fill(7, 7, 3, 8, 10, 4, bark); s.fill(7, 7, 8, 8, 10, 9, bark);
  // The sack, lying in the box with its neck toward the tail.
  s.stand([
    '.bbb.',
    'bccdb',
    'bcddb',
    '.bbb.',
  ], 8, 4, 7, { b: [cream], c: [cream, cream], d: [cream, cream, cream] });
  s.fill(6, 7, 5, 8, 8, 7, thatch);
  s.set(5, 7, 5, cream); s.set(5, 7, 6, cream);
  return s.piece();
}
