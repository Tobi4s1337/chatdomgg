import { MAT } from '../materials';
import { Boxes, blazon, heater, octagon, shield, type CivicKit } from './kit';

/**
 * The kingdom's colours in the plaza and before the castle: a tall standard flying the arms on a swallowtail cloth,
 * and the same arms carved on a shield above a coursed pedestal. Both share the gateway keystone's charge, border,
 * field and stones; Hearth hangs its cloth from brass-capped ends with cream cords, Tide lashes its crossbar to the
 * pole with rope and hangs rope cords.
 */
interface HeraldryTreatment {
  /** The cords that hang from the crossbar ends. */
  readonly cord: number;
  /** What binds the crossbar to the pole: a brass collar, or a rope lashing. */
  readonly binding: number;
}

const TREATMENTS: Readonly<Record<CivicKit['style'], HeraldryTreatment>> = {
  hearth: { cord: MAT.cream, binding: MAT.brass },
  tide: { cord: MAT.thatch, binding: MAT.thatch },
};

/**
 * Banner standard planes in build cells (README, "Banner standard"). A 2 × 2 pole stands at x 7..9, z 7..9 in a
 * stepped stone socket, carries a crossbar at y 56..58 and ends in a brass lozenge at y 64. The cloth hangs in
 * front of the pole and bar: 14 cells wide (x 1..15), from y 57 down to the tips of its tails at y 24.
 */
export const BANNER_STANDARD = {
  size: [16, 64, 16], pole: { from: [7, 7, 7], to: [9, 61, 9] }, bar: { from: [0, 56, 7], to: [16, 58, 9] },
  cloth: { x: [1, 15], top: 57, rows: 34, z: [9, 11], notch: 12 },
} as const;

const CLOTH_WIDTH = 14;
const { rows: CLOTH_ROWS, notch: NOTCH } = BANNER_STANDARD.cloth;

/** The swallowtail: a deep V cut up from the hem, leaving two tails three cells wide at their tips. */
const swallowtail = (col: number, row: number) => {
  const depth = row - (CLOTH_ROWS - NOTCH) + 1;
  return depth <= 0 || Math.abs(col + 0.5 - CLOTH_WIDTH / 2) > depth * (CLOTH_WIDTH / 2 - 3) / NOTCH;
};

/** The arms as they fly: a deep chevron near the head of the cloth and a tall lozenge at its middle. */
export const BANNER_ARMS = blazon(CLOTH_WIDTH, CLOTH_ROWS, swallowtail, { apex: 3, thickness: 3, lozenge: [15.5, 3, 5] });

/**
 * How far each cloth column hangs forward of the pole. Two broad folds belly out either side of the pole; the
 * head stays flat where it is hung, and the columns against the pole never leave it.
 */
const FOLD = [0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0] as const;

export function bannerStandard(kit: CivicKit): Boxes {
  const b = new Boxes(), t = TREATMENTS[kit.style];
  // A stepped socket: a heavy faceted footing, a stone block in two courses, and an oversailing weathered cap.
  octagon(b, 1, 0, 1, 15, 2, 15, kit.base);
  octagon(b, 3, 2, 3, 13, 6, 13, kit.stone);
  octagon(b, 3, 4, 3, 13, 5, 13, MAT.air);
  octagon(b, 4, 4, 4, 12, 5, 12, kit.stone);
  octagon(b, 2, 6, 2, 14, 7, 14, kit.base);
  b.add(2, 2, 12, 4, 3, 14, MAT.moss);
  // The pole is wedged into an iron-dark collar, rises past the crossbar and ends in the arms' lozenge in brass.
  const { pole, bar } = BANNER_STANDARD;
  b.add(6, 7, 6, 10, 9, 10, MAT.darkStone);
  b.add(pole.from[0], pole.from[1], pole.from[2], pole.to[0], pole.to[1], pole.to[2], kit.trim);
  b.add(7, 61, 7, 9, 62, 9, MAT.brass);
  b.add(6, 62, 7, 10, 63, 9, MAT.brass);
  b.add(7, 63, 7, 9, 64, 9, MAT.brass);
  // The crossbar runs through the pole, bound where they cross, with capped ends that carry the cords.
  b.add(6, 55, 6, 10, 59, 9, t.binding);
  b.add(bar.from[0], bar.from[1], bar.from[2], bar.to[0], bar.to[1], bar.to[2], kit.trim);
  for (const x of [0, 15]) {
    b.add(x, 55, 7, x + 1, 59, 9, MAT.brass);
    b.add(x, 46, 7, x + 1, 55, 8, t.cord);
    b.add(x, 42, 7, x + 1, 46, 9, kit.border);
  }
  // The cloth: the arms through both faces, two cells thick, so they read from either side.
  const material = { B: kit.border, F: kit.field, C: kit.charge } as Record<string, number>;
  const [x0] = BANNER_STANDARD.cloth.x, [z0, z1] = BANNER_STANDARD.cloth.z, top = BANNER_STANDARD.cloth.top;
  BANNER_ARMS.forEach((row, i) => {
    const y = top - i;
    let start = 0;
    for (let col = 1; col <= row.length; col++) {
      const fold = (col: number) => (i < 3 ? 0 : FOLD[col]!);
      if (col < row.length && row[col] === row[start] && fold(col) === fold(start)) continue;
      const mark = row[start]!;
      if (mark !== '.') b.add(x0 + start, y, z0 + fold(start), x0 + col, y + 1, z1 + fold(start), material[mark]!);
      start = col;
    }
  });
  // Tabs of the field loop over the bar, so the cloth visibly hangs from it.
  for (const x of [1, 4, 10, 13]) {
    b.add(x, 58, 6, x + 2, 59, 11, kit.field);
    b.add(x, 56, 6, x + 2, 58, 7, kit.field);
  }
  return b;
}

/**
 * Crest plinth planes in build cells (README, "Crest plinth"). A coursed pedestal (y 0..17) carries a seat
 * (x 8..16, y 17..19) on which a carved heater shield stands point down. The shield slab is z 7..9, its arms
 * stand proud at z 6 and z 9 on both faces, and its stone rim encloses x 3..21, y 19..39.
 */
export const CREST_PLINTH = {
  size: [24, 40, 16], seat: { from: [8, 17, 5], to: [16, 19, 11] }, shield: { x: 4, y: 20, width: 16, height: 18 },
  slab: [7, 9], faces: [[7, 6], [8, 9]],
} as const;

/** The arms carved on the crest: a deep chevron and a broad lozenge on a 16 × 18 heater. */
export const CREST_ARMS = blazon(16, 18, heater(16, 18, 8), { apex: 2, thickness: 3, lozenge: [12.5, 3, 3.5] });

export function crestPlinth(kit: CivicKit): Boxes {
  const b = new Boxes();
  // The pedestal: a broad footing, a step, then a die of three courses with quoins in the band stone, and a
  // cornice whose drip oversails the die on every side.
  octagon(b, 0, 0, 0, 24, 2, 16, kit.base);
  b.add(2, 2, 2, 22, 4, 14, kit.stone);
  b.add(4, 4, 4, 20, 15, 12, kit.stone);
  for (const y of [8, 12]) {
    b.add(4, y, 4, 20, y + 1, 5, MAT.air);
    b.add(4, y, 11, 20, y + 1, 12, MAT.air);
    b.add(4, y, 4, 5, y + 1, 12, MAT.air);
    b.add(19, y, 4, 20, y + 1, 12, MAT.air);
  }
  // Quoins alternate long and short faces course by course at the four corners.
  [[4, 8], [9, 12], [13, 15]].forEach(([y, Y], course) => {
    const [lx, lz] = course % 2 ? [2, 3] : [3, 2];
    for (const [x, X] of [[4, 4 + lx], [20 - lx, 20]]) for (const [z, Z] of [[4, 4 + lz], [12 - lz, 12]]) b.add(x!, y!, z!, X!, Y!, Z!, kit.band);
  });
  b.add(3, 15, 3, 21, 16, 13, kit.base);
  b.add(2, 16, 2, 22, 17, 14, kit.base);
  // Wear: moss where the step meets the footing on the shaded side.
  b.add(2, 2, 13, 7, 3, 14, MAT.moss);
  b.add(19, 2, 2, 22, 3, 3, MAT.moss);
  // The seat the shield's point stands on: a block stepping in from a broader footing on the cornice.
  const { seat, shield: s } = CREST_PLINTH;
  b.add(seat.from[0] - 2, seat.from[1], seat.from[2] - 1, seat.to[0] + 2, seat.from[1] + 1, seat.to[2] + 1, kit.base);
  b.add(seat.from[0], seat.from[1] + 1, seat.from[2], seat.to[0], seat.to[1], seat.to[2], kit.stone);
  // The shield: a stone slab one cell larger than the arms all round, its rim standing proud as a frame.
  const inside = (col: number, row: number) => CREST_ARMS[row]?.[col] !== undefined && CREST_ARMS[row]![col] !== '.';
  const near = (col: number, row: number) => [-1, 0, 1].some(dc => [-1, 0, 1].some(dr => inside(col + dc, row + dr)));
  for (let row = -1; row <= s.height; row++) {
    const y = s.y + s.height - 1 - row;
    runs(s.width + 2, i => near(i - 1, row), (from, to) => b.add(s.x - 1 + from, y, CREST_PLINTH.slab[0], s.x - 1 + to, y + 1, CREST_PLINTH.slab[1], kit.stone));
    runs(s.width + 2, i => near(i - 1, row) && !inside(i - 1, row), (from, to) => {
      for (const [, proud] of CREST_PLINTH.faces) b.add(s.x - 1 + from, y, proud, s.x - 1 + to, y + 1, proud + 1, kit.stone);
    });
  }
  for (const [face, proud] of CREST_PLINTH.faces) shield(b, kit, CREST_ARMS, s.x, s.y, face, proud);
  return b;
}

/** Calls `emit` once for every maximal run of indices in [0, length) where `test` holds. */
function runs(length: number, test: (i: number) => boolean, emit: (from: number, to: number) => void): void {
  let start = -1;
  for (let i = 0; i <= length; i++) {
    const on = i < length && test(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) { emit(start, i); start = -1; }
  }
}
