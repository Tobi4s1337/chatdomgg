// The town's walk-through planting: crop rows, tall meadow grass, heather, bracken and cottage borders. Every form is
// passive cover in the dressing style (cell 0.125 m, standing on y=0, no overhangs), drawn instanced and never part of
// collision, so each one stays below the knee or the hip and reads as something a citizen wades through.
import { MAT, STYLES } from '@chatdom/content';
import type { VoxelBlueprint } from '@chatdom/shared';
import { createDressing } from '../../../../../../packages/content/src/props/dressing/registry';
import { toBoxes } from '../../../../../../packages/content/src/props/dressing/cover';

export const TOWN_FORMS = [
  'crop-wheat', 'crop-barley', 'crop-lavender', 'crop-cabbage', 'crop-beans',
  'tall-grass', 'heather', 'bracken', 'border-warm', 'border-cool',
  // Existing dressing cover the town reuses as it is.
  'wildflowers-petal', 'wildflowers-blue', 'wildflowers-gold', 'wildflowers-cream', 'meadow-tufts',
] as const;
export type TownForm = typeof TOWN_FORMS[number];
export type CropKind = 'wheat' | 'barley' | 'lavender' | 'cabbage' | 'beans' | 'ploughed';

export interface TownFormRole {
  /** Always false: nothing this layer plants may stand in anyone's way, because none of it has a collider. */
  readonly solid: false;
  /** How the mount bands it: one-metre crop squares, two-metre cover, or a garden border. */
  readonly family: 'crop' | 'cover' | 'flowers' | 'border';
  /** Crops and borders sit on one level floor cell; loose cover may straddle a half-metre grading step. */
  readonly level: boolean;
}
const crop: TownFormRole = { solid: false, family: 'crop', level: true };
const loose: TownFormRole = { solid: false, family: 'cover', level: false };
const flowers: TownFormRole = { solid: false, family: 'flowers', level: false };
const border: TownFormRole = { solid: false, family: 'border', level: true };
export const TOWN_FORM_ROLES: Readonly<Record<TownForm, TownFormRole>> = {
  'crop-wheat': crop, 'crop-barley': crop, 'crop-lavender': crop, 'crop-cabbage': crop, 'crop-beans': crop,
  'tall-grass': loose, heather: loose, bracken: loose, 'border-warm': border, 'border-cool': border,
  'wildflowers-petal': flowers, 'wildflowers-blue': flowers, 'wildflowers-gold': flowers, 'wildflowers-cream': flowers,
  'meadow-tufts': loose,
};
export const CROP_FORMS: Readonly<Record<Exclude<CropKind, 'ploughed'>, TownForm>> = {
  wheat: 'crop-wheat', barley: 'crop-barley', lavender: 'crop-lavender', cabbage: 'crop-cabbage', beans: 'crop-beans',
};

type Vec = [number, number, number];
/** A material stack per mark, bottom to top. `.` is open ground. */
type Legend = Readonly<Record<string, readonly number[]>>;

/** A height map: one row per Z, one mark per X; each mark is a column of cells standing on y=0. */
function stacks(rows: readonly string[], size: Vec, legend: Legend): Map<string, number> {
  if (rows.length !== size[2] || rows.some(row => row.length !== size[0])) throw new Error(`A town form must be ${size[2]} rows of ${size[0]} marks.`);
  const cells = new Map<string, number>();
  rows.forEach((row, z) => [...row].forEach((mark, x) => {
    if (mark === '.') return;
    const stack = legend[mark];
    if (!stack) throw new Error(`Unknown town form mark "${mark}" at ${x},${z}.`);
    if (stack.length > size[1]) throw new Error(`The column at ${x},${z} rises above ${size[1]} cells.`);
    stack.forEach((material, y) => cells.set(`${x},${y},${z}`, material));
  }));
  return cells;
}

const L = MAT.leaf, Mo = MAT.moss, G = MAT.goldLeaf;
const up = (body: number, count: number, ...top: number[]) => [...Array<number>(count).fill(body), ...top];

/**
 * Wheat, one square metre: two drill rows a half-metre apart, each two cells wide, ripe stalks of uneven height with
 * pale ears and a green straggler here and there. Rows run edge to edge along X, so neighbouring squares join into
 * one unbroken drill and the soil between the rows is the field's own ground.
 */
const WHEAT = ['........', 'wWvwWwvW', 'WwgvwWwv', '........', '........', 'vwWwgvWw', 'wvwWvwWw', '........'];
const WHEAT_LEGEND: Legend = { w: up(G, 3, MAT.hairGold), W: up(G, 4, MAT.hairGold), v: up(G, 2, MAT.hairGold), g: [L, Mo, G] };

/** Barley: the same drills, shorter and still green-gold, the bearded ears leaning in the cream of the morning. */
const BARLEY = ['........', 'bBbcbBcb', 'BbcbBbbc', '........', '........', 'cbBbbcBb', 'bcbBcbbB', '........'];
const BARLEY_LEGEND: Legend = { b: up(Mo, 2, G), B: up(Mo, 3, G), c: up(Mo, 2, MAT.cream) };

/**
 * Lavender: each drill is a run of rounded grey-green cushions with the violet spikes standing out of their crowns,
 * a pale spike or two catching the light, and a low saddle between the bushes.
 */
const LAVENDER = ['........', 'lLps.lLp', 'pLls.pLl', '........', '........', '.lLpslLp', 'spLl.pLl', '........'];
const LAVENDER_LEGEND: Legend = {
  l: [MAT.fabricMutedGreen, MAT.fabricMutedGreen, MAT.fabricViolet], L: [MAT.fabricMutedGreen, MAT.fabricMutedGreen, MAT.fabricViolet, MAT.fabricViolet],
  p: [MAT.fabricMutedGreen, MAT.fabricViolet, MAT.skinFeyAsh], s: [MAT.fabricMutedGreen, MAT.fabricMutedGreen],
};

/** Cabbages: four blue-green heads per square, staggered along the two drills, each with an outer leaf on the soil. */
const CABBAGE = ['........', '.CCo.CCo', 'oCc..cC.', '........', '........', '.cCo.CCo', 'oCC..Cc.', '........'];
const CABBAGE_LEGEND: Legend = { C: [MAT.skinFeyMoss, MAT.skinFeyMoss], c: [MAT.skinFeyMoss, Mo], o: [L] };

/** Bush beans: two leafy drills with cream flowers just opening at the top. */
const BEANS = ['........', 'bBfbBbfB', 'BbbBfbBb', '........', '........', 'fBbBbfbB', 'bBfbBbBb', '........'];
const BEANS_LEGEND: Legend = { b: [L, L, Mo], B: [L, L, L, Mo], f: [L, L, MAT.cream] };

/**
 * Tall meadow grass, two metres square: five loose clumps of blades to the hip, the tallest carrying seed heads in
 * gold and cream, the dry tufts between them lower, and open ground through the middle so the patch never reads as
 * a slab from above.
 */
const TALL_GRASS = [
  '................',
  '..34............',
  '.35h4.....2y....',
  '.4s53....364....',
  '..453...3h5s3...',
  '...3.....454....',
  '.........23.....',
  '....y...........',
  '...2y3......34..',
  '..36h4.....4s53.',
  '..4s5y.....3h64.',
  '...43.......452.',
  '.......24.......',
  '......3h53......',
  '.......34y......',
  '................',
];
const TALL_LEGEND: Legend = {
  2: [L, Mo], 3: up(L, 2, Mo), 4: up(L, 3, Mo), 5: up(L, 4, Mo), 6: up(L, 5, Mo),
  h: up(L, 4, G), s: up(L, 5, MAT.cream), y: [Mo, Mo, G],
};

/** Heather: low mounded cushions of dusky violet, the flowering tips pink and pale, with moss and bilberry between. */
const HEATHER = [
  '................',
  '...aAa..........',
  '..aPAPa....gm...',
  '..AAPAa...aAa...',
  '...aAa...aPAAa..',
  '....m....aAPAa..',
  '..........aAa...',
  '..gm............',
  '.aAa......mg....',
  'aPAPa...aAAa....',
  'aAAAa..aPAPAa...',
  '.aPa...aAAPAa...',
  '..m.....aAAa..m.',
  '..........m..aAa',
  '.............aPa',
  '................',
];
const HEATHER_LEGEND: Legend = {
  a: [MAT.fabricMutedViolet, MAT.skinFeyAsh], A: [MAT.fabricMutedViolet, MAT.fabricMutedViolet, MAT.skinFeyAsh],
  P: [MAT.fabricMutedViolet, MAT.fabricMutedViolet, MAT.petal], g: [L, Mo], m: [Mo],
};

/**
 * Bracken at the woods' edge: two crowns of fronds arching out from a taller heart, the tips low on the ground and
 * one frond already turning rust.
 */
const BRACKEN = [
  '................',
  '....1...........',
  '...121..1.......',
  '....232.21......',
  '.1...3432.......',
  '.2233454332r1...',
  '..1.3454.2......',
  '...23.32..1.....',
  '..12...21....1..',
  '..1.......1.21..',
  '.........12.3...',
  '.......1223453r.',
  '..........3543..',
  '.........2.32.1.',
  '........1...21..',
  '................',
];
const BRACKEN_LEGEND: Legend = {
  1: [Mo], 2: [L, Mo], 3: up(L, 2, Mo), 4: up(L, 3, Mo), 5: up(L, 4, Mo), r: [L, G],
};

/**
 * A cottage border, three metres by one: tall spires at the back (hollyhock pink and cream in the warm border,
 * delphinium blue in the cool one), a middle row of mixed blooms, and low cushions spilling over the front edge.
 */
const BORDER = [
  '........................',
  '.HL.KH.lH.K.LH.KlH.HK.L.',
  '.LPGlBPLGPlBGPLlPBGlPGL.',
  '.PlBGLPGlBPLGlPBGLPlBGP.',
  '.lGPlCGPLlGBPLCGPlGLPCl.',
  '.mCmlmCmlCmmlCmlmCmmCml.',
  '..m..m...m..m...m...m...',
  '........................',
];
const borderLegend = (spire: number, crown: number): Legend => ({
  H: up(L, 4, spire, spire), K: up(L, 3, crown, crown), G: [L, L, G], P: [L, L, MAT.petal], B: [L, L, MAT.blueFlower],
  C: [L, MAT.cream], l: [L], L: [L, L], m: [Mo],
});

const AUTHORED: Partial<Record<TownForm, () => { size: Vec; boxes: VoxelBlueprint['boxes'] }>> = {
  'crop-wheat': () => grow(WHEAT, [8, 5, 8], WHEAT_LEGEND),
  'crop-barley': () => grow(BARLEY, [8, 4, 8], BARLEY_LEGEND),
  'crop-lavender': () => grow(LAVENDER, [8, 4, 8], LAVENDER_LEGEND),
  'crop-cabbage': () => grow(CABBAGE, [8, 2, 8], CABBAGE_LEGEND),
  'crop-beans': () => grow(BEANS, [8, 4, 8], BEANS_LEGEND),
  'tall-grass': () => grow(TALL_GRASS, [16, 6, 16], TALL_LEGEND),
  heather: () => grow(HEATHER, [16, 3, 16], HEATHER_LEGEND),
  bracken: () => grow(BRACKEN, [16, 5, 16], BRACKEN_LEGEND),
  'border-warm': () => grow(BORDER, [24, 6, 8], borderLegend(MAT.petal, MAT.cream)),
  'border-cool': () => grow(BORDER, [24, 6, 8], borderLegend(MAT.blueFlower, MAT.cream)),
};
function grow(rows: readonly string[], size: Vec, legend: Legend) { return { size, boxes: toBoxes(stacks(rows, size, legend), size) }; }

const made = new Map<TownForm, VoxelBlueprint>();
/** One shared blueprint per form for the whole town: placements share it and the mount batches by it. */
export function townBlueprint(form: TownForm): VoxelBlueprint {
  const known = made.get(form);
  if (known) return known;
  const authored = AUTHORED[form];
  let blueprint: VoxelBlueprint;
  if (authored) {
    const { size, boxes } = authored();
    blueprint = { version: 1, id: `town-${form}`, styleId: STYLES.grove.id, kind: 'flora', lattice: 'build', size, boxes, windows: [] };
  } else blueprint = createDressing(form as Extract<TownForm, `wildflowers-${string}` | 'meadow-tufts'>);
  made.set(form, blueprint);
  return blueprint;
}

/** Footprint in metres (x along the form's rows, z across them). */
export function formSize(form: TownForm): readonly [number, number] {
  const b = townBlueprint(form);
  return [b.size[0] * 0.125, b.size[2] * 0.125];
}
