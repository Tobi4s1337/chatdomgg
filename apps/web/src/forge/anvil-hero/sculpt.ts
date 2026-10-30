import { MAT } from '@chatdom/content';
import { VOXEL_METRES } from '@chatdom/shared';

/**
 * The hero stage as one voxel asset: a worn stone block carrying a London-pattern anvil.
 *
 * Authored on the character lattice (h = 0.0625 m, half a build cell), the finest lattice the
 * kingdom already renders. Coordinates below are in h, with the horn toward +X and the mark
 * on the +Z cheek. Row r spans [r·h + Y_OFFSET, (r+1)·h + Y_OFFSET) metres, so the top of row
 * 22 is the 1.43 m working face and the bottom block course sits one h under the street.
 */
export const H = VOXEL_METRES.avatar;
export const FACE_ROW = 22;
export const ANVIL_FACE_HEIGHT = 1.43;
export const Y_OFFSET = ANVIL_FACE_HEIGHT - (FACE_ROW + 1) * H;

/** Registered materials, each given a hero-only treatment by the anvil shader. */
export const ANVIL_MATERIALS = {
  iron: MAT.darkStone,
  steel: MAT.slate,
  rust: MAT.brick,
  dent: MAT.timber,
  stone: MAT.limestone,
  stain: MAT.earth,
} as const;

/** Inclusive-exclusive cell ranges. */
type Span = readonly [number, number];
const MIN: readonly [number, number, number] = [-16, -1, -10];
export const GRID_MIN = MIN;
export const GRID_SIZE: readonly [number, number, number] = [40, 24, 20];

export const BLOCK = { x: [-15, 9] as Span, z: [-9, 9] as Span, rows: [-1, 7] as Span };
export const FEET = { x: [-14, 8] as Span, z: [-6, 6] as Span, rows: [7, 10] as Span };
export const PLATE = { x: [-14, 8] as Span, z: [-4, 4] as Span, rows: [19, 23] as Span };
export const STEP = { x: [8, 12] as Span, z: [-3, 3] as Span, top: 21 };
export const HORN = { x: [12, 22] as Span, rootHalf: 3, rootBottom: 16, top: 21 };
/** Square hardy hole, 2 h from the heel, open right through the plate; pritchel 3 h inboard. */
export const HARDY = { x: [-12, -10] as Span, z: [-1, 1] as Span };
export const PRITCHEL = { x: [-8, -7] as Span, z: [0, 1] as Span };
/** The flat +Z cheek of the waist and the opening behind the mark's cut, one h deep. */
export const CHEEK_Z = 3;
export const MARK_WINDOW = { x: [-6, 0] as Span, rows: [12, 18] as Span };

/** Waist rows: [left edge, right edge, z half-width]. The right edge widens into the belly. */
const WAIST: Readonly<Record<number, readonly [number, number, number]>> = {
  10: [-13, 7, 4], 11: [-11, 5, 3], 12: [-10, 4, 3], 13: [-9, 3, 3], 14: [-9, 3, 3],
  15: [-9, 3, 3], 16: [-9, 3, 3], 17: [-10, 3, 3], 18: [-10, 3, 3],
};

/**
 * One rising curve from the waist's narrowest point to the horn tip (its lower edge, in rows):
 * vertical where it leaves the waist, 6 h deep under the horn root, rising to the point.
 */
export function belly(x: number): number {
  const t = Math.min(1, Math.max(0, (x - 3) / 19));
  return 13.5 + 2.376 * Math.sqrt(t) + 3.855 * t * t;
}
/** Horn half-width in h: 3 h at the root, about half an h at the tip. */
function hornHalf(x: number): number {
  const t = Math.min(1, Math.max(0, (x - HORN.x[0]) / (HORN.x[1] - HORN.x[0])));
  return HORN.rootHalf - 2.45 * Math.pow(t, 1.15);
}
/** Flat top that droops by one h over the last three columns. */
function hornTop(x: number): number { return x >= HORN.x[1] - 3 ? HORN.top - 1 : HORN.top; }

const within = (v: number, s: Span) => v >= s[0] && v < s[1];

/** Is the iron cell at (x,row,z) solid, before holes, chips and wear. */
export function ironCell(x: number, row: number, z: number): boolean {
  const zc = z + .5, ax = Math.abs(zc);
  if (row >= FEET.rows[0] && row < FEET.rows[1]) {
    if (!within(x, FEET.x) || !within(z, FEET.z)) return false;
    // The top course of the feet steps in, so the base reads as a flare, not a slab.
    if (row === FEET.rows[1] - 1 && (x === FEET.x[0] || x === FEET.x[1] - 1 || ax > 5)) return false;
    // Arches of air: 8 h on the long sides and 4 h on the ends, 2 h tall, leaving four feet.
    if (row < FEET.rows[1] - 1) {
      if (x >= -7 && x < 1 && ax > 3) return false;
      if (ax < 2 && (x < -11 || x >= 5)) return false;
    }
    return true;
  }
  if (row >= PLATE.rows[0] && row < PLATE.rows[1]) {
    if (within(x, PLATE.x) && within(z, PLATE.z)) return true;
    if (within(x, STEP.x) && within(z, STEP.z) && row <= STEP.top) return true;
  }
  // Horn and throat: one continuous belly from the waist up to the drooping point.
  if (x >= 3 && x < HORN.x[1] && row <= hornTop(x) && row + .5 >= belly(x + .5)) {
    const half = x < HORN.x[0] ? 3 : hornHalf(x + .5);
    // Round the belly: the lowest course of each column is one h narrower.
    const lowest = row + .5 < belly(x + .5) + 1 && x >= HORN.x[0];
    if (ax <= half - (lowest ? 1 : 0) + .01) return true;
  }
  const waist = WAIST[row];
  if (waist && x >= waist[0] && x < waist[1] && ax <= waist[2]) return true;
  return false;
}

export interface AnvilSculpt {
  size: [number, number, number];
  voxels: Uint16Array;
}

/** Deterministic: the same stage every time, never above the face and within the 1.5 m radius. */
export function sculptAnvilStage(): AnvilSculpt {
  const [nx, ny, nz] = GRID_SIZE;
  const voxels = new Uint16Array(nx * ny * nz);
  const at = (x: number, row: number, z: number) => (x - MIN[0]) + nx * ((row - MIN[1]) + ny * (z - MIN[2]));
  const get = (x: number, row: number, z: number) =>
    x < MIN[0] || row < MIN[1] || z < MIN[2] || x >= MIN[0] + nx || row >= MIN[1] + ny || z >= MIN[2] + nz ? 0 : voxels[at(x, row, z)]!;
  const set = (x: number, row: number, z: number, material: number) => { voxels[at(x, row, z)] = material; };
  const { iron, steel, rust, dent, stone, stain } = ANVIL_MATERIALS;

  // The block: sunk one h, arrises chamfered one h, its top falling one h toward the street side.
  for (let row = BLOCK.rows[0]; row < BLOCK.rows[1]; row++) for (let x = BLOCK.x[0]; x < BLOCK.x[1]; x++) for (let z = BLOCK.z[0]; z < BLOCK.z[1]; z++) {
    const ex = Math.min(x - BLOCK.x[0], BLOCK.x[1] - 1 - x), ez = Math.min(z - BLOCK.z[0], BLOCK.z[1] - 1 - z);
    const top = BLOCK.rows[1] - 1 - (z >= 6 ? 1 : 0);
    if (row > top) continue;
    if (ex === 0 && ez === 0 && row >= 0) continue;
    if (row === top && (ex === 0 || ez === 0)) continue;
    set(x, row, z, stone);
  }
  // A chipped corner, broken away at the back of the horn end.
  for (const [x, row, z] of [[8, 6, -9], [8, 5, -9], [7, 6, -9], [8, 6, -8], [7, 6, -8], [8, 5, -8]] as const) set(x, row, z, 0);

  for (let row = FEET.rows[0]; row < PLATE.rows[1]; row++) for (let x = MIN[0]; x < MIN[0] + nx; x++) for (let z = MIN[2]; z < MIN[2] + nz; z++) {
    if (ironCell(x, row, z)) set(x, row, z, iron);
  }
  // Openings: the hardy hole right through the plate, the pritchel, and the mark's window.
  for (let row = PLATE.rows[0]; row < PLATE.rows[1]; row++) {
    for (let x = HARDY.x[0]; x < HARDY.x[1]; x++) for (let z = HARDY.z[0]; z < HARDY.z[1]; z++) set(x, row, z, 0);
    for (let x = PRITCHEL.x[0]; x < PRITCHEL.x[1]; x++) for (let z = PRITCHEL.z[0]; z < PRITCHEL.z[1]; z++) set(x, row, z, 0);
  }
  for (let x = MARK_WINDOW.x[0]; x < MARK_WINDOW.x[1]; x++) for (let row = MARK_WINDOW.rows[0]; row < MARK_WINDOW.rows[1]; row++) set(x, row, CHEEK_Z - 1, 0);
  // Bruised heel corners: the outer top corners are knocked off, and the iron around them is bright.
  for (const z of [PLATE.z[0], PLATE.z[1] - 1]) {
    set(PLATE.x[0], FACE_ROW, z, 0);
    for (const [x, row, zz] of [[PLATE.x[0], FACE_ROW - 1, z], [PLATE.x[0] + 1, FACE_ROW, z], [PLATE.x[0], FACE_ROW, z + (z < 0 ? 1 : -1)]] as const) set(x, row, zz, steel);
  }
  // The front face edge nearest the horn takes the most work: bright steel along its arris.
  for (let z = PLATE.z[0]; z < PLATE.z[1]; z++) set(PLATE.x[1] - 1, FACE_ROW, z, steel);
  for (let z = STEP.z[0]; z < STEP.z[1]; z++) set(STEP.x[0], STEP.top, z, steel);
  // The horn tip, polished by every bent ring.
  for (let x = HORN.x[1] - 2; x < HORN.x[1]; x++) for (let row = 16; row <= HORN.top; row++) for (let z = -2; z < 2; z++) if (get(x, row, z)) set(x, row, z, steel);
  // Six hammer dents across the face, where a missed blow bruised it.
  for (const [x, z] of [[-5, 1], [-2, -2], [1, 2], [3, -1], [-9, -3], [5, 1]] as const) set(x, FACE_ROW, z, dent);
  // Rust sits only where nothing polishes it: the foot soles and the hollow of the waist,
  // never the mark's cheek.
  for (let x = FEET.x[0]; x < FEET.x[1]; x++) for (let z = FEET.z[0]; z < FEET.z[1]; z++) if (get(x, FEET.rows[0], z) === iron) set(x, FEET.rows[0], z, rust);
  for (let row = 13; row <= 15; row++) for (let x = MIN[0]; x < MIN[0] + nx; x++) for (let z = -3; z < CHEEK_Z - 1; z++) {
    if (get(x, row, z) !== iron || x >= 3) continue;
    const exposed = !get(x - 1, row, z) || !get(x, row, z - 1);
    if (exposed) set(x, row, z, rust);
  }
  // A ring of scale and soot one h wide round the feet, where hot scale has fallen for years.
  for (let x = FEET.x[0] - 1; x <= FEET.x[1]; x++) for (let z = FEET.z[0] - 1; z <= FEET.z[1]; z++) {
    const row = BLOCK.rows[1] - 1;
    if (get(x, row, z) === stone && !get(x, row + 1, z)) set(x, row, z, stain);
  }
  return { size: [nx, ny, nz], voxels };
}
