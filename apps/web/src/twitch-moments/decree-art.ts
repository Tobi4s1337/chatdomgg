import { MAT, STYLES } from '@chatdom/content';
import type { VoxelBlueprint } from '@chatdom/shared';
import { blueprint, box, type BannerKit, type Box } from './banner';
import { TOWN_COLOURS, TOWN_DYES, type TownColour } from './town';

/**
 * The town deciding together, in build cells (0.125 m), authored for this lane. Every blueprint's origin is its
 * minimum corner; the `*_CELLS` constants say where its pivot sits. The board's front faces +z, +y is up.
 *
 * - Decree board (3 m wide, 3.25 m to the finial): two timber posts on rounded stone footings carry a framed plank
 *   board with a ledge under it; a cream notice is pinned to it with brass tacks, a red heading over two lines of
 *   brown ink, written in words. Knee braces hold a tie beam, and over it a small gabled roof in the kit's own roof
 *   tiles with a cream bargeboard; the gable carries the kingdom's chevron over its light, a brass knob at each
 *   eave and a gilt finial on the ridge. A colours decree (a poll the kingdom carries out) is sealed: a red wax seal
 *   with a gilt impression on the notice, its two ribbon tails splayed over the ledge, and the chevron in gold leaf.
 * - Pole (6.4 m): a timber pole on a stone footing with brass bands, a cleat, a brass collar and a gilt ball finial.
 *   Each choice's pennant climbs it between the two brass travellers (rings) that run on the pole.
 * - Pennant (0.875 × 0.75 m): a swallowtail in the choice's dye: the field with a band of the trim through its
 *   middle that runs into the fork, on a sleeve of the trim. It is drawn column by column from one-cell dye parts so the cloth can ripple, snap and droop.
 * - Town flag (0.625 m): a bunting pennant on the cord, in two alternating weaves of the town's colours (field
 *   hemmed in trim, trim hemmed in field), the same cut as the festival train's so both strings read as one family.
 * - Lantern (0.375 × 0.625 m): an iron-cornered lantern with a brass cap and foot, open sides for its light.
 */

// ---------------------------------------------------------------- the decree board

/** Where the board's parts sit, in its cells. The notice's face is z 5; the roof's eaves are y 18, its ridge y 24. */
export const BOARD_CELLS = {
  size: [24, 26, 8] as const, pivot: [12, 0, 4] as const,
  /** Back of the roof (z 0) and the footings' back (z 2), so the poles behind it stand clear. */
  back: 0, height: 26,
} as const;

/** The board's half widths, row by row from the eaves up: the gable steps in two cells a row. */
const GABLE = [12, 10, 8, 6, 4, 2] as const;
const EAVES = 18;

export function boardBlueprint(kit: BannerKit, decree: boolean): VoxelBlueprint {
  const roof = STYLES[kit].roof, b: Box[] = [];
  const emblem = decree ? MAT.goldLeaf : MAT.cream;
  // Footings, their top corners knocked off, and the posts standing in them with a bark foot and two brass bands.
  for (const x0 of [2, 18]) {
    b.push(box(x0, 0, 2, x0 + 4, 2, 6, MAT.limestone));
    for (const [x, z] of [[x0, 2], [x0 + 3, 2], [x0, 5], [x0 + 3, 5]] as const) b.push(box(x, 1, z, x + 1, 2, z + 1, MAT.air));
    const px = x0 + 1;
    b.push(box(px, 2, 3, px + 2, 17, 5, MAT.timber), box(px, 2, 3, px + 2, 3, 5, MAT.bark));
    for (const y of [5, 14]) b.push(box(px, y, 3, px + 2, y + 1, 5, MAT.brass));
  }
  // Knee braces out to the eaves, and the tie beam the roof sits on.
  b.push(box(2, 15, 3, 3, 16, 5, MAT.bark), box(1, 16, 3, 2, 17, 5, MAT.bark), box(21, 15, 3, 22, 16, 5, MAT.bark), box(22, 16, 3, 23, 17, 5, MAT.bark));
  b.push(box(1, 17, 2, 23, 18, 6, MAT.bark));
  // The board: timber planks inside a bark frame that stands a cell proud, a ledge along its foot.
  b.push(box(5, 4, 3, 19, 16, 4, MAT.timber));
  b.push(box(5, 4, 3, 19, 5, 5, MAT.bark), box(5, 15, 3, 19, 16, 5, MAT.bark), box(5, 4, 3, 6, 16, 5, MAT.bark), box(18, 4, 3, 19, 16, 5, MAT.bark));
  b.push(box(5, 3, 3, 19, 4, 6, MAT.timber), box(5, 3, 5, 19, 4, 6, MAT.bark));
  // The notice, pinned at its corners: a red heading over two lines of brown ink, in words.
  b.push(box(7, 6, 4, 17, 14, 5, MAT.cream));
  b.push(box(9, 12, 4, 12, 13, 5, MAT.fabricRed), box(13, 12, 4, 15, 13, 5, MAT.fabricRed));
  b.push(box(8, 10, 4, 11, 11, 5, MAT.bark), box(12, 10, 4, 16, 11, 5, MAT.bark), box(8, 8, 4, 10, 9, 5, MAT.bark), box(11, 8, 4, decree ? 12 : 14, 9, 5, MAT.bark));
  for (const [x, y] of [[7, 13], [16, 13], [7, 6], [16, 6]] as const) b.push(box(x, y, 4, x + 1, y + 1, 5, MAT.brass));
  if (decree) {
    // The seal over the notice's foot, its gilt impression, and two short ribbon tails splayed over the ledge.
    b.push(box(14, 5, 4, 15, 6, 5, MAT.fabricRed));
    b.push(box(13, 6, 5, 16, 7, 6, MAT.fabricRed), box(14, 5, 5, 15, 8, 6, MAT.fabricRed), box(14, 6, 5, 15, 7, 6, MAT.goldLeaf));
    b.push(box(13, 4, 5, 14, 5, 6, MAT.fabricRed), box(15, 4, 5, 16, 5, 6, MAT.fabricRed), box(12, 3, 6, 13, 4, 7, MAT.fabricRed), box(16, 3, 6, 17, 4, 7, MAT.fabricRed));
  }
  // The roof: each row's two slopes in the kit's tiles over a timber gable, a cream bargeboard along the front.
  GABLE.forEach((w, i) => {
    const y = EAVES + i, x0 = 12 - w, x1 = 12 + w;
    if (x1 - x0 > 4) b.push(box(x0 + 2, y, 1, x1 - 2, y + 1, 7, MAT.timber));
    b.push(box(x0, y, 0, x0 + 2, y + 1, 8, roof), box(x1 - 2, y, 0, x1, y + 1, 8, roof));
    b.push(box(x0, y, 7, x0 + 2, y + 1, 8, MAT.cream), box(x1 - 2, y, 7, x1, y + 1, 8, MAT.cream));
  });
  b.push(box(0, EAVES, 7, 1, EAVES + 1, 8, MAT.brass), box(23, EAVES, 7, 24, EAVES + 1, 8, MAT.brass));
  // The gable's arms: the kingdom's chevron (one roof) over its light.
  for (let i = 0; i < 3; i++) for (const x of [11 - i, 12 + i]) b.push(box(x, 22 - i, 6, x + 1, 23 - i, 7, emblem));
  b.push(box(11, 19, 6, 13, 20, 7, emblem));
  // Ridge finial: a brass knop and a gilt cap.
  b.push(box(11, 24, 3, 13, 25, 5, MAT.brass), box(11, 25, 3, 13, 26, 5, MAT.goldLeaf));
  return blueprint(`moment-town-board-${kit}${decree ? '-decree' : ''}`, kit, [24, 26, 8], b);
}

// ---------------------------------------------------------------- the poles

/**
 * A pennant pole, 51 cells tall. Pivot: the foot of the shaft's axis, (2, 0, 2). A pennant's hoist top travels
 * between `travel` (cells above the foot); its sleeve hangs against the shaft's +x face. The finial's gilt ball is
 * centred at `finial`; the halyard is made fast at the cleat's top, `cleat` cells up.
 */
export const POLE_CELLS = { size: [4, 51, 4] as const, pivot: [2, 0, 2] as const, travel: [30, 45] as const, finial: [2, 49.5, 2] as const, height: 51, cleat: 9 } as const;

export function poleBlueprint(kit: BannerKit): VoxelBlueprint {
  const b: Box[] = [box(0, 0, 0, 4, 2, 4, MAT.limestone)];
  for (const [x, z] of [[0, 0], [3, 0], [0, 3], [3, 3]] as const) b.push(box(x, 1, z, x + 1, 2, z + 1, MAT.air));
  b.push(box(1, 2, 1, 3, 47, 3, MAT.timber), box(1, 2, 1, 3, 4, 3, MAT.bark));
  for (const y of [10, 19]) b.push(box(1, y, 1, 3, y + 1, 3, MAT.brass));
  // The cleat the halyard is made fast to, on the pennant's side.
  b.push(box(3, 7, 1, 4, 8, 3, MAT.brass), box(3, 6, 2, 4, 9, 3, MAT.brass));
  // Brass collar and a gilt ball: a plus of gold leaf two rows deep, capped.
  b.push(box(0, 47, 0, 4, 48, 4, MAT.brass));
  b.push(box(1, 48, 0, 3, 50, 4, MAT.goldLeaf), box(0, 48, 1, 4, 50, 3, MAT.goldLeaf), box(1, 50, 1, 3, 51, 3, MAT.goldLeaf));
  return blueprint(`moment-town-pole-${kit}`, kit, [4, 51, 4], b);
}

/** A brass traveller ring round the shaft. Pivot: the middle of its underside, (2, 0, 2). */
export const RING_CELLS = { size: [4, 1, 4] as const, pivot: [2, 0, 2] as const } as const;
export function ringBlueprint(kit: BannerKit): VoxelBlueprint {
  return blueprint(`moment-town-ring-${kit}`, kit, [4, 1, 4], [box(0, 0, 0, 4, 1, 4, MAT.brass), box(1, 0, 1, 3, 1, 3, MAT.air)]);
}

// ---------------------------------------------------------------- pennants, from dye cells

/** The pennant's cut: `length` columns from the sleeve (column 0) to the swallowtail, `rows` from the top hem. */
export const PENNANT_CELLS = { length: 7, rows: 6 } as const;

type Weave = 'field' | 'trim' | null;
/** Column c (0 = sleeve), row r (0 = top hem) of the pennant. */
function pennantWeave(c: number, r: number): Weave {
  const last = PENNANT_CELLS.rows - 1;
  if (c === 0) return 'trim';
  if (c === PENNANT_CELLS.length - 1) return r === 0 || r === last ? 'field' : null;
  if (c === PENNANT_CELLS.length - 2 && r > 1 && r < last - 1) return null;
  // A band of the trim through the middle of the field, running into the fork.
  return r > 1 && r < last - 1 ? 'trim' : 'field';
}

/** A vertical run of one dye in a pennant column: rows `r0` (inclusive) to `r1` (exclusive), top down. */
export interface PennantRun { readonly r0: number; readonly r1: number; readonly material: number }

/** The pennant in a colour as columns of runs, sleeve first. */
export function pennantColumns(colour: TownColour): readonly (readonly PennantRun[])[] {
  const dye = TOWN_DYES[colour], columns: PennantRun[][] = [];
  for (let c = 0; c < PENNANT_CELLS.length; c++) {
    const runs: PennantRun[] = [];
    let start = 0;
    for (let r = 1; r <= PENNANT_CELLS.rows; r++) {
      const weave = pennantWeave(c, start);
      if (r < PENNANT_CELLS.rows && pennantWeave(c, r) === weave) continue;
      if (weave) runs.push({ r0: start, r1: r, material: weave === 'field' ? dye.field : dye.trim });
      start = r;
    }
    columns.push(runs);
  }
  return columns;
}

/** Every material a town cloth is woven from, plus gilt (the winner's motes) and stone dust (the board rising). */
export const DYE_MATERIALS: readonly number[] = [...new Set([...TOWN_COLOURS.flatMap(c => [TOWN_DYES[c].field, TOWN_DYES[c].trim]), MAT.goldLeaf, MAT.limestone])];

/** One cell of a dye. Pivot: its minimum corner. */
export const dyeCellBlueprint = (kit: BannerKit, material: number): VoxelBlueprint =>
  blueprint(`moment-town-dye-${kit}-${material}`, kit, [1, 1, 1], [box(0, 0, 0, 1, 1, 1, material)]);

// ---------------------------------------------------------------- bunting and lanterns

/** A bunting pennant, the festival train's cut: 5 wide, 5 rows from its hem. Pivot: the middle of its top edge. */
export const TOWN_FLAG_CELLS = { size: [5, 5, 1] as const, pivot: [2.5, 5, 0.5] as const, weaves: 2 } as const;

/** Weave 0: the field hemmed and tipped in the trim; weave 1: the trim hemmed and tipped in the field. */
export function townFlagBlueprint(kit: BannerKit, colour: TownColour, weave: number): VoxelBlueprint {
  const dye = TOWN_DYES[colour], [cloth, hem] = weave % 2 === 0 ? [dye.field, dye.trim] : [dye.trim, dye.field];
  const b: Box[] = [box(0, 4, 0, 5, 5, 1, hem), box(0, 3, 0, 5, 4, 1, cloth), box(1, 1, 0, 4, 3, 1, cloth), box(2, 0, 0, 3, 1, 1, hem)];
  return blueprint(`moment-town-flag-${kit}-${colour}-${weave % 2}`, kit, [5, 5, 1], b);
}

/** A festival lantern. Pivot: the hook's top, (1.5, 5, 1.5); its light fills the open cell at `glass`. */
export const LANTERN_CELLS = { size: [3, 5, 3] as const, pivot: [1.5, 5, 1.5] as const, glass: [1.5, 2, 1.5] as const } as const;
export function lanternBlueprint(kit: BannerKit): VoxelBlueprint {
  const b: Box[] = [box(1, 4, 1, 2, 5, 2, MAT.darkStone), box(0, 3, 0, 3, 4, 3, MAT.brass), box(0, 0, 0, 3, 1, 3, MAT.brass)];
  for (const [x, z] of [[0, 0], [2, 0], [0, 2], [2, 2]] as const) b.push(box(x, 1, z, x + 1, 3, z + 1, MAT.darkStone));
  return blueprint(`moment-town-lantern-${kit}`, kit, [3, 5, 3], b);
}

/** Every decree, colours and festival part, for meshing up front. */
export function decreeParts(kit: BannerKit): VoxelBlueprint[] {
  return [
    boardBlueprint(kit, false), boardBlueprint(kit, true), poleBlueprint(kit), ringBlueprint(kit), lanternBlueprint(kit),
    ...DYE_MATERIALS.map(m => dyeCellBlueprint(kit, m)),
    ...TOWN_COLOURS.flatMap(c => Array.from({ length: TOWN_FLAG_CELLS.weaves }, (_, w) => townFlagBlueprint(kit, c, w))),
  ];
}
