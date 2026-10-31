import { MAT } from '../materials';
import { CLOTH_ROWS, CLOTH_WIDTH, clothArms, type ClothCut, type CrestCharge } from './arms';
import { lantern, runs, Sculpt, type HeraldicColours, type HeraldicKit, type LandscapeCharacter, type LanternAnchor } from './kit';

/**
 * The founding standard, in build cells. A 4 × 4 faceted pole rises 14 m from a three-stage plinth to a brass
 * lozenge. Its crossbar at y 100..102 carries a cloth 24 cells wide and 56 deep, hung in front of the pole by
 * loops of field cloth; its hem (level, forked or pointed) ends at y 44, above a person's reach, so it reads over a
 * crowd.
 */
export const GENESIS_STANDARD = {
  size: [32, 120, 28],
  pole: { from: [14, 14, 12], to: [18, 112, 16] },
  bar: { from: [1, 100, 13], to: [31, 102, 15] },
  cloth: { x: 4, width: CLOTH_WIDTH, top: 99, rows: CLOTH_ROWS, z: 16, thickness: 2 },
  plinthTop: 16,
} as const;

const { cloth: CLOTH } = GENESIS_STANDARD;

/**
 * Where tassels hang from the hem, as cloth columns: one at each tip of the forked and pennant cuts (found from the
 * hem), five spaced along the square cut's level hem.
 */
const SQUARE_TASSELS = [2, 7, 12, 17, 22] as const;

/**
 * How far each column bellies forward when the cloth is full of air: a broad fold either side of the pole, two
 * shallower ones at the edges. The four columns in front of the pole stay against it. Neighbours never differ by
 * more than a cell, so the two-cell cloth is one face-connected sheet.
 */
const FOLD = [1, 2, 3, 3, 2, 2, 1, 2, 2, 1, 0, 0, 0, 0, 1, 2, 2, 1, 2, 2, 3, 3, 2, 1] as const;
/** The head hangs flat from its loops; the folds deepen a cell every five rows down to their full depth. */
const fold = (col: number, row: number) => Math.min(FOLD[col]!, Math.max(0, Math.floor((row - 2) / 5)));

/** Bands of the binding round the pole, below the cloth and above the bar. */
const BANDS = [24, 34, 104] as const;

export function genesisStandard(kit: HeraldicKit, colours: HeraldicColours, character: LandscapeCharacter, cut: ClothCut, charge: CrestCharge): { boxes: Sculpt; lanterns: LanternAnchor[]; arms: string[] } {
  const arms = clothArms(cut, charge);
  const b = new Sculpt();
  // The plinth: an octagonal footing, a step, a die cut by two joints with quoins, and an oversailing cornice.
  b.chamfer(1, 0, 1, 31, 3, 27, 3, kit.base);
  b.chamfer(3, 3, 3, 29, 6, 25, 2, kit.stone);
  b.add(6, 6, 6, 26, 14, 22, kit.stone);
  for (const y of [9, 12]) {
    b.add(6, y, 6, 26, y + 1, 7, MAT.air);
    b.add(6, y, 21, 26, y + 1, 22, MAT.air);
    b.add(6, y, 6, 7, y + 1, 22, MAT.air);
    b.add(25, y, 6, 26, y + 1, 22, MAT.air);
  }
  [[6, 9], [10, 12], [13, 14]].forEach(([y, Y], course) => {
    const [lx, lz] = course % 2 ? [2, 3] : [3, 2];
    for (const [x, X] of [[6, 6 + lx], [26 - lx, 26]]) for (const [z, Z] of [[6, 6 + lz], [22 - lz, 22]]) b.add(x!, y!, z!, X!, Y!, Z!, kit.band);
  });
  // A sunk panel on both broad faces holds the kingdom's lozenge in brass.
  for (const [face, back] of [[21, 22], [6, 7]] as const) {
    b.add(12, 7, face, 20, 12, back, MAT.air);
    for (const [y, half] of [[7, 1], [8, 2], [9, 3], [10, 2], [11, 1]] as const) b.add(16 - half, y, face, 16 + half, y + 1, back, MAT.brass);
  }
  b.chamfer(4, 14, 4, 28, 15, 24, 2, kit.base);
  b.chamfer(5, 15, 5, 27, 16, 23, 2, kit.stone);
  dressFooting(b, kit, character);

  // The pole is wedged into a dark iron collar and rises to a brass lozenge, the kingdom's finial.
  b.add(12, 16, 10, 20, 19, 18, MAT.darkStone);
  b.add(13, 19, 11, 19, 20, 17, MAT.darkStone);
  const { pole, bar } = GENESIS_STANDARD;
  b.chamfer(pole.from[0], pole.from[1], pole.from[2], pole.to[0], pole.to[1], pole.to[2], 1, kit.trim);
  for (const y of BANDS) b.chamfer(13, y, 11, 19, y + 2, 17, 1, kit.binding);
  if (character === 'coastal-harbour') for (const y of [20, 22]) b.chamfer(13, y, 11, 19, y + 1, 17, 1, MAT.thatch);
  b.chamfer(13, 110, 11, 19, 112, 17, 1, MAT.brass);
  for (const [y, half] of [[112, 1], [113, 1], [114, 2], [115, 2], [116, 3], [117, 2], [118, 1], [119, 1]] as const) b.add(16 - half, y, 13, 16 + half, y + 1, 15, MAT.brass);

  // The crossbar runs through the pole, bound where they cross, with brass knobs. From each knob a cord lets down a
  // lantern beside the cloth's edge, level with the arms, so the device is lit at night from both sides.
  b.chamfer(13, 99, 11, 19, 103, 17, 1, kit.binding);
  b.add(bar.from[0], bar.from[1], bar.from[2], bar.to[0], bar.to[1], bar.to[2], kit.trim);
  const lanterns: LanternAnchor[] = [];
  for (const [x, side] of [[0, 'west'], [28, 'east']] as const) {
    const knob = x ? 30 : 0;
    b.add(knob, 99, 12, knob + 2, 103, 16, MAT.brass);
    const cord = knob ? 30 : 1;
    b.add(cord, 78, 13, cord + 1, 99, 14, kit.cord);
    b.add(x + 1, 77, 13, x + 3, 78, 15, MAT.brass);
    lanterns.push(lantern(b, `standard-lantern-${side}-arms`, x, 70, 12));
    b.add(x + 1, 68, 13, x + 3, 70, 15, colours.border);
  }

  // The cloth: the arms through both faces, two cells thick, pleated forward of the pole.
  const material = { B: colours.border, F: colours.field, C: colours.charge } as Record<string, number>;
  arms.forEach((row, i) => {
    const y = CLOTH.top - i;
    runs(row.length, col => row[col] === '.' ? null : `${row[col]}${fold(col, i)}`, (from, to, key) => {
      const z = CLOTH.z + Number(key.slice(1));
      b.add(CLOTH.x + from, y, z, CLOTH.x + to, y + 1, z + CLOTH.thickness, material[key[0]!]!);
    });
  });
  // Loops of field cloth wrap over the bar, so the cloth visibly hangs from it.
  for (const x of [5, 10, 20, 25]) {
    b.add(x, 102, 12, x + 2, 103, 18, colours.field);
    b.add(x, 100, 12, x + 2, 102, 13, colours.field);
    b.add(x, 100, CLOTH.z, x + 2, 102, CLOTH.z + CLOTH.thickness, colours.field);
  }
  // Brass-headed tassels in the border colour hang from the hem.
  const last = arms[CLOTH.rows - 1]!, hem = CLOTH.top - CLOTH.rows + 1, tassels: number[] = [];
  if (cut === 'square') tassels.push(...SQUARE_TASSELS);
  else runs(last.length, col => last[col] === '.' ? null : 1, (from, to) => tassels.push(Math.floor((from + to) / 2)));
  for (const col of tassels) {
    const centre = CLOTH.x + col, z = CLOTH.z + fold(col, CLOTH.rows - 1);
    b.add(centre - 1, hem - 1, z, centre + 1, hem, z + 2, MAT.brass);
    b.add(centre - 1, hem - 5, z, centre + 1, hem - 1, z + 2, colours.border);
  }

  // Two more on the cornice light the hem and the plinth from below.
  lanterns.push(lantern(b, 'standard-lantern-west', 6, 16, 17), lantern(b, 'standard-lantern-east', 22, 16, 17));
  return { boxes: b, lanterns, arms };
}

/**
 * The land shows at the foot of the standard. By a harbour the footing is dark with damp and a mooring ring hangs
 * from the step; in a river valley moss and forget-me-nots grow from the shaded joints; on a mountain pass the plinth
 * is braced by rough boulders bedded against the footing.
 */
function dressFooting(b: Sculpt, kit: HeraldicKit, character: LandscapeCharacter): void {
  if (character === 'coastal-harbour') {
    b.chamfer(1, 0, 1, 31, 1, 27, 3, MAT.darkStone);
    for (const z of [25, 2]) {
      b.add(14, 5, z, 18, 6, z + 1, MAT.darkStone);
      b.add(14, 3, z, 15, 5, z + 1, MAT.darkStone);
      b.add(17, 3, z, 18, 5, z + 1, MAT.darkStone);
    }
  } else if (character === 'river-valley') {
    b.add(3, 3, 22, 9, 4, 25, MAT.moss);
    b.add(23, 3, 3, 29, 4, 6, MAT.moss);
    b.add(1, 0, 20, 4, 1, 27, MAT.moss);
    for (const [x, z, flower] of [[4, 23, MAT.blueFlower], [7, 24, MAT.blueFlower], [25, 4, MAT.petal], [5, 4, MAT.blueFlower]] as const) b.add(x, 4, z, x + 1, 5, z + 1, flower);
  } else {
    for (const [x, z, X, Z, Y] of [[0, 2, 5, 7, 4], [27, 20, 32, 26, 5], [24, 0, 30, 4, 3], [1, 22, 6, 27, 3]] as const) {
      b.add(x, 0, z, X, Y, Z, kit.base);
      b.add(x + 1, Y, z + 1, X - 1, Y + 1, Z - 1, kit.base);
    }
    b.add(0, 0, 13, 2, 2, 17, MAT.darkStone);
    b.add(30, 0, 8, 32, 2, 12, MAT.darkStone);
  }
}
