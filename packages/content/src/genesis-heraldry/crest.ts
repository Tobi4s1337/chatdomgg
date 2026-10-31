import { MAT } from '../materials';
import { SHIELD_HEIGHT, SHIELD_WIDTH, shieldArms, type CrestCharge, type CrestShape } from './arms';
import { lantern, runs, Sculpt, type HeraldicColours, type HeraldicKit, type LandscapeCharacter, type LanternAnchor } from './kit';

/**
 * The crest monument, in build cells. A coursed pedestal (y 0..27) carries a shield 24 wide (a 30-tall heater or
 * swallowtail, or a 24 roundel) carved with the arms on both faces, standing on a seat between two pillars that
 * each lift a lantern to the shield's shoulder. Three cells of air part the shield's rim from each pillar, so it
 * reads as a carved tablet in a frame. A brass lozenge finial crowns the shield. The slab is z 10..14; field faces
 * are z 10 and 13, and the border, charge and rim stand one cell proud at z 9 and z 14.
 */
export const GENESIS_CREST = {
  size: [46, 72, 24],
  shield: { x: 11, y: 30, width: SHIELD_WIDTH, height: SHIELD_HEIGHT },
  slab: [10, 14],
  faces: [[10, 9], [13, 14]],
  pillars: [[1, 7], [39, 45]],
  pedestalTop: 27,
} as const;

const { shield: SHIELD } = GENESIS_CREST;
/** The monument's axis of symmetry. */
const MID = SHIELD.x + SHIELD.width / 2;

export function genesisCrest(kit: HeraldicKit, colours: HeraldicColours, character: LandscapeCharacter, shape: CrestShape, charge: CrestCharge): { boxes: Sculpt; lanterns: LanternAnchor[]; arms: string[] } {
  const arms = shieldArms(shape, charge), height = SHIELD.height[shape];
  const b = new Sculpt();
  // The pedestal: an octagonal footing and step, a die with two joints and a sunk brass panel, and a cornice.
  b.chamfer(0, 0, 0, 46, 3, 24, 3, kit.base);
  b.chamfer(2, 3, 2, 44, 6, 22, 2, kit.stone);
  b.add(7, 6, 5, 39, 24, 19, kit.stone);
  for (const y of [11, 17]) {
    b.add(7, y, 5, 39, y + 1, 6, MAT.air);
    b.add(7, y, 18, 39, y + 1, 19, MAT.air);
  }
  for (const [face, back] of [[18, 19], [5, 6]] as const) {
    b.add(16, 12, face, 30, 17, back, MAT.air);
    b.add(16, 12, face, 30, 13, back, kit.band);
    for (const [y, half] of [[13, 2], [14, 4], [15, 2]] as const) b.add(MID - half, y, face, MID + half, y + 1, back, MAT.brass);
  }
  b.chamfer(4, 24, 3, 42, 26, 21, 2, kit.base);
  b.chamfer(5, 26, 4, 41, 27, 20, 1, kit.stone);

  // Two pillars engaged into the ends of the die, banded by courses, each capped and carrying a lantern.
  const lanterns: LanternAnchor[] = [];
  GENESIS_CREST.pillars.forEach(([x, X], side) => {
    b.chamfer(x, 3, 8, X, 44, 16, 1, kit.stone);
    for (const y of [14, 24, 34]) b.chamfer(x, y, 8, X, y + 1, 16, 1, kit.band);
    b.chamfer(x - 1, 44, 7, X + 1, 46, 17, 1, kit.base);
    lanterns.push(lantern(b, side ? 'crest-lantern-east' : 'crest-lantern-west', x + 1, 46, 10));
  });

  // The shield: a stone slab one cell larger than the arms all round, its rim standing proud as a frame.
  const [slabFrom, slabTo] = GENESIS_CREST.slab;
  const inside = (col: number, row: number) => arms[row]?.[col] !== undefined && arms[row]![col] !== '.';
  const near = (col: number, row: number) => [-1, 0, 1].some(dc => [-1, 0, 1].some(dr => inside(col + dc, row + dr)));

  // The seat: a stone block under each point the shield stands on (one for the heater and roundel, two for the
  // swallowtail, whose notch stays open), on a footing course two cells broader than the points.
  let lo = Infinity, hi = -Infinity;
  runs(SHIELD.width + 2, i => near(i - 1, height) ? 1 : null, (from, to) => {
    b.add(SHIELD.x - 1 + from, 28, 9, SHIELD.x - 1 + to, 30, 15, kit.stone);
    lo = Math.min(lo, SHIELD.x - 1 + from);
    hi = Math.max(hi, SHIELD.x - 1 + to);
  });
  b.add(lo - 2, 27, 8, hi + 2, 28, 16, kit.base);

  for (let row = -1; row <= height; row++) {
    const y = SHIELD.y + height - 1 - row;
    runs(SHIELD.width + 2, i => near(i - 1, row) ? 1 : null, (from, to) => b.add(SHIELD.x - 1 + from, y, slabFrom, SHIELD.x - 1 + to, y + 1, slabTo, kit.stone));
    runs(SHIELD.width + 2, i => near(i - 1, row) && !inside(i - 1, row) ? 1 : null, (from, to) => {
      for (const [, proud] of GENESIS_CREST.faces) b.add(SHIELD.x - 1 + from, y, proud, SHIELD.x - 1 + to, y + 1, proud + 1, kit.stone);
    });
  }
  // The arms on both faces: the field is flush with the slab, border and charge stand one cell proud.
  const material = { B: colours.border, F: colours.field, C: colours.charge } as Record<string, number>;
  arms.forEach((row, i) => {
    const y = SHIELD.y + height - 1 - i;
    runs(row.length, col => row[col] === '.' ? null : row[col]!, (from, to, mark) => {
      for (const [face, proud] of GENESIS_CREST.faces) {
        b.add(SHIELD.x + from, y, face, SHIELD.x + to, y + 1, face + 1, colours.field);
        if (mark !== 'F') b.add(SHIELD.x + from, y, proud, SHIELD.x + to, y + 1, proud + 1, material[mark]!);
      }
    });
  });

  // A short stone stem lifts a brass lozenge, the kingdom's finial, above the shield.
  const top = SHIELD.y + height;
  b.add(MID - 2, top + 1, 11, MID + 2, top + 2, 13, kit.stone);
  for (const [dy, half] of [[2, 1], [3, 2], [4, 3], [5, 4], [6, 3], [7, 2], [8, 1], [9, 1]] as const) b.add(MID - half, top + dy, 11, MID + half, top + dy + 1, 13, MAT.brass);

  dressFooting(b, kit, character);
  return { boxes: b, lanterns, arms };
}

/** The same land marks as the standard's foot: damp by the sea, moss and flowers by a river, boulders on a pass. */
function dressFooting(b: Sculpt, kit: HeraldicKit, character: LandscapeCharacter): void {
  if (character === 'coastal-harbour') {
    b.chamfer(0, 0, 0, 46, 1, 24, 3, MAT.darkStone);
  } else if (character === 'river-valley') {
    b.add(2, 3, 19, 10, 4, 22, MAT.moss);
    b.add(34, 3, 2, 43, 4, 5, MAT.moss);
    b.add(0, 0, 17, 3, 1, 24, MAT.moss);
    for (const [x, z, flower] of [[3, 20, MAT.blueFlower], [8, 21, MAT.blueFlower], [37, 3, MAT.petal], [41, 4, MAT.blueFlower]] as const) b.add(x, 4, z, x + 1, 5, z + 1, flower);
  } else {
    for (const [x, z, X, Z, Y] of [[0, 1, 5, 6, 4], [41, 18, 46, 24, 5], [36, 0, 42, 3, 3]] as const) {
      b.add(x, 0, z, X, Y, Z, kit.base);
      b.add(x + 1, Y, z + 1, X - 1, Y + 1, Z - 1, kit.base);
    }
    b.add(44, 0, 8, 46, 2, 12, MAT.darkStone);
  }
}
