import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../../materials';

type Box = VoxelBlueprint['boxes'][number];
type Vec = [number, number, number];
export type Cover = { size: Vec; boxes: Box[] };
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
 * - `o`, `O`: stone one or two cells tall (pebbles, or the kit stone of a path form).
 * - `e`, `E`: turned earth one or two cells tall. `s`: a seedling leaf on one earth cell. `t`: a seedling heart,
 *   a leaf and a moss tip on one earth cell. `m`: one cell of moss. `M`: moss on one earth cell.
 *
 * Columns never overhang except a head's `H` cells, so every patch stands on its own ground. `flower` is one
 * material, or a material per head named by its even corner, for a bed planted in blocks of colour.
 */
export function plan(rows: readonly string[], size: Vec, flower?: number | ((hx: number, hz: number) => number), stone: number = MAT.stone): Map<string, number> {
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
    if (mark === 'o' || mark === 'O') return column(x, z, 0, mark === 'o' ? 1 : 2, stone);
    if (mark === 'e' || mark === 'E') return column(x, z, 0, mark === 'e' ? 1 : 2, MAT.earth);
    if (mark === 'm') return column(x, z, 0, 1, MAT.moss);
    if (mark === 'M') { column(x, z, 0, 1, MAT.earth); return column(x, z, 1, 2, MAT.moss); }
    if (mark === 's' || mark === 't') {
      column(x, z, 0, 1, MAT.earth); column(x, z, 1, 2, MAT.leaf);
      return mark === 't' ? column(x, z, 2, 3, MAT.moss) : undefined;
    }
    if (!'FHfh'.includes(mark)) throw new Error(`Unknown plan mark "${mark}" at ${x},${z}.`);
    if (flower === undefined) throw new Error('This patch has no flower.');
    // A head is named by its even corner; the other three columns must complete it.
    const [hx, hz] = [x - (x % 2), z - (z % 2)];
    const quad = [at(hx, hz), at(hx + 1, hz), at(hx, hz + 1), at(hx + 1, hz + 1)];
    const whole = quad.every(m => 'FHfh'.includes(m)) && quad.some(m => 'Ff'.includes(m)) && quad.filter(m => 'fh'.includes(m)).length <= 1;
    if (!whole) throw new Error(`The flower head at ${hx},${hz} is not a 2×2 on even cells with a stem and at most one chipped corner.`);
    if (mark === 'F' || mark === 'f') column(x, z, 0, HEAD[0], MAT.leaf);
    column(x, z, HEAD[0], mark === 'f' || mark === 'h' ? HEAD[0] + 1 : HEAD[1], typeof flower === 'number' ? flower : flower(hx, hz));
  }));
  return cells;
}

/** Cells to boxes: runs along X per course, merged along Z while a run repeats. Each cell is written once. */
export function toBoxes(cells: ReadonlyMap<string, number>, size: Vec): Box[] {
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

/**
 * A front-garden bed being planted: a strip of turned earth with two staggered rows of seedlings, each a small
 * cross of leaves around a lit heart. The back row is full. The front row stops after three, with one seedling
 * only just set and the soil from the planting holes still heaped at its end. It lies flush, so it can stand in a
 * forecourt and is never a seat or a step.
 */
const SEEDLINGS = [
  '........................',
  '..eseeeseeeseeeseeesee..',
  '.estsestsestsestsestsee.',
  '.eeseeeseeeseeeseeeseee.',
  '.eeeseeeseeeseeeeeeeEee.',
  '.eestsestsestseeseeEEEe.',
  '..eeseeeseeeseeeeeeeEe..',
  '........................',
];

export function seedlingBed(): Cover {
  const size: Vec = [24, 3, 8];
  return { size, boxes: toBoxes(plan(SEEDLINGS, size), size) };
}

/**
 * A grower's cutting bed, the stock of a market stall: a strip of turned earth holding three staggered rows of
 * blooms in three blocks of one colour each, pink, then cream, then gold, so it reads as planted rather than wild.
 * Leaves bank against every head. Between the cream and the gold one head has been cut for the stall, leaving
 * its bare stems with the cut ends showing, and the soil is heaped on the path side where it came up. It lies on the
 * ground at half a metre, passive and flush like the seedling bed: nothing to pick, sit on or step up.
 */
const CUTTING = [
  '........................',
  '.eeeeeeeeeeeeeeEeeeeee..',
  '.eFF21Ff12FF21b12eFF21e.',
  '.eFF22FF21Fh12cb1efF12e.',
  '.ee1FF21FF12FF2eFF21FFe.',
  '.eeeFf1eFFe1hF1eFF1eFhe.',
  '.eFF12FF2eFF21FF1eFF2ee.',
  '.eFh1eFF1eFF1eFf2eFF1ee.',
  '.eeeeeeeeeeeeeeeeeeeeee.',
  '........................',
];

export function cuttingBed(): Cover {
  const size: Vec = [24, 4, 10];
  const block = (hx: number) => (hx <= 6 ? MAT.petal : hx <= 12 ? MAT.cream : MAT.goldLeaf);
  return { size, boxes: toBoxes(plan(CUTTING, size, block), size) };
}
