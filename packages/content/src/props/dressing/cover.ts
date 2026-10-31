import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../../materials';

type Box = VoxelBlueprint['boxes'][number];
type Vec = [number, number, number];
type Cover = { size: Vec; boxes: Box[] };
export type WildflowerColour = 'petal' | 'blue' | 'gold' | 'cream';

/** The one flower material of each drift. */
const FLOWER: Readonly<Record<WildflowerColour, number>> = { petal: MAT.petal, blue: MAT.blueFlower, gold: MAT.goldLeaf, cream: MAT.cream };
/** Flower heads sit on the third and fourth courses, so a drift stays half a metre tall. */
const HEAD = [2, 4] as const;

/**
 * A cover patch drawn as a height map: one row per Z, one character per X, every mark a column standing on y=0.
 *
 * - `1`–`4`: a leaf column that many cells tall.
 * - `a`–`d`: the same heights, with the top cell in moss: the lit tip of a blade.
 * - `F`: a flower-head column on a two-cell leaf stem. `H`: a head column with no stem, held by the rest of its head.
 *   `f` and `h` are the same with the head's top cell left open: one chipped corner turns a cube into a bloom.
 *   Every head is a 2×2 of these on even X and Z, with a stem and at most one chipped corner, so it holds its
 *   whole LOD-2 cell and nothing else shares it.
 * - `o`, `O`: pebble stone one or two cells tall.
 *
 * Columns never overhang except a head's `H` cells, so every patch stands on its own ground.
 */
function plan(rows: readonly string[], size: Vec, flower?: number): Map<string, number> {
  if (rows.length !== size[2] || rows.some(row => row.length !== size[0])) throw new Error(`A plan must be ${size[2]} rows of ${size[0]} marks.`);
  const cells = new Map<string, number>();
  const column = (x: number, z: number, from: number, to: number, material: number) => {
    if (to > size[1]) throw new Error(`The column at ${x},${z} rises above ${size[1]} cells.`);
    for (let y = from; y < to; y++) cells.set(`${x},${y},${z}`, material);
  };
  const at = (x: number, z: number) => rows[z]?.[x] ?? '.';
  rows.forEach((row, z) => [...row].forEach((mark, x) => {
    if (mark === '.') return;
    if (x === 0 || z === 0 || x === size[0] - 1 || z === size[2] - 1) throw new Error(`The plan mark at ${x},${z} sits on the patch's open margin.`);
    const leaf = '1234'.indexOf(mark) + 1, lit = 'abcd'.indexOf(mark) + 1;
    if (leaf) return column(x, z, 0, leaf, MAT.leaf);
    if (lit) { column(x, z, 0, lit - 1, MAT.leaf); return column(x, z, lit - 1, lit, MAT.moss); }
    if (mark === 'o' || mark === 'O') return column(x, z, 0, mark === 'o' ? 1 : 2, MAT.stone);
    if (!'FHfh'.includes(mark)) throw new Error(`Unknown plan mark "${mark}" at ${x},${z}.`);
    if (flower === undefined) throw new Error('This patch has no flower.');
    // A head is named by its even corner; the other three columns must complete it.
    const [hx, hz] = [x - (x % 2), z - (z % 2)];
    const quad = [at(hx, hz), at(hx + 1, hz), at(hx, hz + 1), at(hx + 1, hz + 1)];
    const whole = quad.every(m => 'FHfh'.includes(m)) && quad.some(m => 'Ff'.includes(m)) && quad.filter(m => 'fh'.includes(m)).length <= 1;
    if (!whole) throw new Error(`The flower head at ${hx},${hz} is not a 2×2 on even cells with a stem and at most one chipped corner.`);
    if (mark === 'F' || mark === 'f') column(x, z, 0, HEAD[0], MAT.leaf);
    column(x, z, HEAD[0], mark === 'f' || mark === 'h' ? HEAD[0] + 1 : HEAD[1], flower);
  }));
  return cells;
}

/** Cells to boxes: runs along X per course, merged along Z while a run repeats. Each cell is written once. */
function toBoxes(cells: ReadonlyMap<string, number>, size: Vec): Box[] {
  const boxes: Box[] = [];
  for (let y = 0; y < size[1]; y++) {
    let open: Box[] = [];
    for (let z = 0; z < size[2]; z++) {
      const runs: Box[] = [];
      for (let x = 0; x < size[0];) {
        const material = cells.get(`${x},${y},${z}`);
        if (material === undefined) { x++; continue; }
        let end = x + 1;
        while (end < size[0] && cells.get(`${end},${y},${z}`) === material) end++;
        const above = open.find(b => b.from[0] === x && b.to[0] === end && b.material === material);
        if (above) { above.to[2] = z + 1; runs.push(above); } else { const box: Box = { from: [x, y, z], to: [end, y + 1, z + 1], material }; boxes.push(box); runs.push(box); }
        x = end;
      }
      open = runs;
    }
  }
  return boxes;
}

/**
 * Six tufts on open ground, in two loose pairs and two singles. Each is a pinched clump whose blades stand at
 * uneven heights, tallest off-centre; only the tallest blades carry a moss tip. The big tuft and its small
 * companion hold the back left, a tall tuft and a sprig the back right, a short one sits left of centre and a low,
 * wide one runs along the front right. The middle stays open.
 */
const TUFTS = [
  '................',
  '................',
  '...121.....12...',
  '..13d21...13d1..',
  '..233d1...2d2...',
  '..1232.....11...',
  '...11..21....1..',
  '.......1.....21.',
  '.............1..',
  '................',
  '.....1..........',
  '....1c2.........',
  '.....21...121...',
  '.........12c231.',
  '..........1121..',
  '................',
];

export function meadowTufts(): Cover {
  const size: Vec = [16, 4, 16];
  return { size, boxes: toBoxes(plan(TUFTS, size), size) };
}

/**
 * One loose drift from the front left to the back right. At its two hearts a pair of heads stands corner to corner
 * inside one 4×4 block, each on a short stem with leaves banked against it from outside the block, so the flower
 * still outnumbers the leaf in that block at LOD 4. Single heads thin the drift out at either end and to one side,
 * each nestled in its own tuft; one plain tuft keeps the back left green. Leaves stand as high as the heads' lower
 * course around them, so a bloom sits in its foliage rather than on it.
 */
const DRIFT = [
  '................',
  '............21..',
  '..12.......3Ff2.',
  '.1c31....13cFF3.',
  '..221.....hF3...',
  '...1.....1HF3...',
  '.......3FH2.1...',
  '...23c.3Fh.1....',
  '...dFh..31......',
  '...3FH1.....21..',
  '...1.2HFc..2FF3.',
  '...21.hF3..3FFc.',
  '.3FF2.32....23..',
  '.2Ff3....12.....',
  '..23.....b1.....',
  '................',
];

/** The drift, recoloured per flower so every colour reads as the same kind of wild planting. */
export function wildflowers(colour: WildflowerColour): Cover {
  const size: Vec = [16, 4, 16];
  return { size, boxes: toBoxes(plan(DRIFT, size, FLOWER[colour]), size) };
}

/**
 * Low clover in two rounded mats with moss along their sunny rims and a few raised leaves, and four pebbles
 * bedded into the lawn: a domed one at the back right, one tucked against the larger mat, one at the left and a
 * small flat one at the front.
 */
const CLOVER = [
  '................',
  '................',
  '..a11.......oo..',
  '.a1211a....oOOo.',
  '.111112a...oOOo.',
  '..11111a....oo..',
  '...111aaoo......',
  '.....aa.oo......',
  '................',
  '.........111....',
  '..oo....11211a..',
  '.oOo...1111aa2..',
  '..o....112111a..',
  '....ooo.11111...',
  '.....oo...11....',
  '................',
];

export function cloverPebbles(): Cover {
  const size: Vec = [16, 2, 16];
  return { size, boxes: toBoxes(plan(CLOVER, size), size) };
}
