import type { Vec3 } from '@chatdom/shared';
import { MAT, STYLES } from '../../../materials';
import { runs, stroke } from '../../../places/water/millrace/craft';
import { hash } from '../../../places/water/shore/shape';
import type { Livery } from '../piece';
import { archRows, round, type InnShell } from './parts';

/**
 * Everything the inn wears and keeps about it: its painted door and shutters, the striped awning, the hanging sign
 * and its three lanterns, the gutter and rain barrel, and the life of the frontage (bench, barrel table, cask stack,
 * flower trough and window boxes, the slate step) with a brass wren turning on the cross gable. Livery parts take
 * their material from the livery argument; nothing here hard-codes a dye. No people and no lettering.
 */

const TRIM = STYLES.tide.trim;
const IRON = MAT.darkStone;
/** The door's axis and the mirror width that reflects one side of the frontage onto the other. */
const CX = 56, MIRROR = 2 * CX;

export function dressInn(s: InnShell, livery: Livery): { lanterns: Vec3[] } {
  door(s, livery);
  shutters(s, livery);
  windowBoxes(s);
  rainwater(s);
  awning(s, livery);
  bench(s);
  sign(s, livery);
  const lanterns = [
    doorLantern(s, livery, 40),
    doorLantern(s, livery, MIRROR - 41),
    lantern(s, livery, CX, 87, 44),
  ];
  step(s);
  trough(s);
  barrelTable(s);
  caskStack(s);
  wren(s, livery);
  return { lanterns };
}

// ── The door ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The painted door stands open, swung back into the vestibule against the west reveal, so the opening is a real way
 * in. Its frame, transom and the bars of the fanlight in the arch head are painted to match; the knob is brass.
 */
function door(s: InnShell, livery: Livery): void {
  s.put(livery.blue, 50, 2, 66, 51, 22, 76);
  s.put(livery.brass, 51, 11, 67, 52, 12, 68);
  for (const y of [5, 18]) s.put(IRON, 49, y, 72, 50, y + 1, 76);
  for (const x of [50, 61]) s.put(livery.blue, x, 2, 76, x + 1, 22, 79);
  s.put(livery.blue, 50, 22, 76, 62, 23, 79);
  for (const [y, x0, x1] of archRows(CX, 5, 2, 22, 3)) if (y >= 23) s.put(MAT.glass, x0, y, 76, x1, y + 1, 77);
  for (const x of [54, 57]) s.put(livery.blue, x, 23, 76, x + 1, 25, 77);
}

/** Painted shutters folded back beside the two upper casements, each with iron straps and a cut-out light. */
function shutters(s: InnShell, livery: Livery): void {
  for (const [x0, x1] of [[13, 17], [29, 33], [79, 83], [95, 99]] as const) {
    s.put(livery.blue, x0, 34, 70, x1, 44, 71);
    for (const y of [36, 41]) s.put(IRON, x0, y, 71, x1, y + 1, 72);
    s.air(x0 + 1, 38, 70, x0 + 3, 39, 71);
  }
}

/** Timber window boxes on the bressumer under the upper casements: thrift, sea holly and trailing leaves. */
function windowBoxes(s: InnShell): void {
  for (const [x0, x1, seed] of [[17, 29, 1], [83, 95, 2]] as const) {
    s.put(TRIM, x0, 31, 70, x1, 33, 73);
    s.put(MAT.earth, x0 + 1, 32, 71, x1 - 1, 33, 72);
    blooms(s, x0, x1, 33, 71, 73, seed);
    for (let x = x0 + 1; x < x1 - 1; x += 3 + Math.floor(hash(seed, x) * 3)) s.put(MAT.leaf, x, 30, 73, x + 1, 32, 74);
  }
}

/** A row of planting from x0 to x1 at height y: leafy clumps with flowers of two colours between them. */
function blooms(s: InnShell, x0: number, x1: number, y: number, z0: number, z1: number, seed: number): void {
  for (let x = x0, i = 0; x < x1; i++) {
    const len = 2 + Math.floor(hash(seed, i, 7) * 3), r = hash(seed, i, 8), end = Math.min(x + len, x1);
    s.put(r < 0.4 ? MAT.leaf : r < 0.7 ? MAT.petal : MAT.blueFlower, x, y, z0, end, y + 1, z1);
    x = end;
  }
}

// ── Rainwater ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A gutter under the west eave, its downpipe clipped to the wall at the jetty, and the rain barrel at its foot. */
function rainwater(s: InnShell): void {
  s.put(IRON, 7, 44, 71, 34, 46, 73);
  s.put(IRON, 6, 43, 69, 7, 46, 73);
  s.put(IRON, 6, 11, 69, 7, 43, 70);
  for (const y of [29, 38]) s.put(IRON, 6, y, 69, 8, y + 1, 70);
  for (const [u0, u1, v0, v1] of round(0, 65, 8)) {
    s.put(TRIM, u0, 0, v0, u1, 11, v1);
    for (const y of [2, 8]) s.put(IRON, u0, y, v0, u1, y + 1, v1);
  }
  for (const [u0, u1, v0, v1] of round(1, 66, 6)) s.put(MAT.bark, u0, 11, v0, u1, 12, v1);
}

// ── The awning and the bench under it ─────────────────────────────────────────────────────────────────────────────

/**
 * A canvas awning in the livery's red and cream stripes over the east casement, falling in five folds from a roller
 * batten under the jetty to a scalloped valance piped in gold, held out on two iron arms.
 */
function awning(s: InnShell, livery: Livery): void {
  const [x0, x1] = [79, 101];
  s.put(TRIM, x0, 25, 68, x1, 27, 69);
  const stripe = (x: number) => ((x - x0) >> 1) % 2 === 0 ? livery.red : livery.cream;
  for (let r = 0; r < 5; r++) {
    const y = 24 - r, z = 68 + 2 * r;
    // Each fold laps a cell over the one below it, so the canvas is one sheet.
    s.put(livery.cream, x0, y, z, x1, y + 1, z + 3);
    for (let x = x0; x < x1; x += 4) s.put(livery.red, x, y, z, Math.min(x + 2, x1), y + 1, z + 3);
  }
  for (let x = x0; x < x1; x += 2) {
    s.put(stripe(x), x, 17, 77, Math.min(x + 2, x1), 20, 78);
    s.air(x + 1, 17, 77, Math.min(x + 2, x1), 18, 78);
  }
  s.put(livery.gold, x0, 20, 78, x1, 21, 79);
  for (const x of [x0, x1 - 1]) runs(stroke([68.5, 13.5], [77.5, 19.5]), (z0, z1, y) => s.put(IRON, x, y, z0, x + 1, y + 1, z1));
}

/** A plain timber bench on two trestles against the wall, out of the wind under the awning. */
function bench(s: InnShell): void {
  s.put(TRIM, 82, 4, 71, 98, 5, 75);
  s.put(MAT.bark, 82, 4, 74, 98, 5, 75);
  for (const x of [83, 95]) for (const z of [71, 74]) s.put(TRIM, x, 0, z, x + 2, 4, z + 1);
  for (const x of [83, 95]) s.put(TRIM, x, 1, 72, x + 2, 2, 74);
  s.put(TRIM, 85, 1, 72, 95, 2, 73);
}

// ── The sign and the lanterns ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The device of The Wren and Willow, painted on the sign's field (18 × 10 cells, rows top to bottom, read from the
 * front): a brown wren with a cream breast and its tail cocked, perched on a willow sprig whose leaves droop in long
 * strands. `.` is the deep-blue field, `b`/`t` the wren's dark and light browns, `c` its breast, `s` the sprig's
 * bark and `l`/`g` the willow's two greens.
 */
export const SIGN_DEVICE = [
  '...............sss',
  '.........t...ssl.g',
  '........tt..s.l..g',
  '..bb...tt..s..l.gl',
  'tbbbbbbbt..s.g..g.',
  '..cccbbbb..s.l..l.',
  '...cccbb..ls.l....',
  '..ssssssssss.g....',
  '...g..l..g..l.....',
  '...l..g..l........',
] as const;

/**
 * The hanging sign over the door: a red board with rounded corners and a little arched crest, framed in gold, the
 * inn's device painted on both faces (mirrored on the back, so the wren faces the same way from either side). It
 * hangs on two chains from a wrought crossbar carried out from the wall on two scrolled arms.
 */
function sign(s: InnShell, livery: Livery): void {
  for (const x of [47, 64]) {
    s.put(IRON, x, 41, 82, x + 1, 42, 89);
    s.put(IRON, x, 40, 88, x + 1, 41, 89);
    runs(stroke([82.5, 36.5], [84.5, 39.5]), (z0, z1, y) => s.put(IRON, x, y, z0, x + 1, y + 1, z1));
  }
  s.put(IRON, 46, 41, 87, 66, 42, 88);
  for (const x of [49, 62]) s.put(IRON, x, 39, 87, x + 1, 41, 88);
  const board = (z0: number, z1: number, m: number) => {
    s.put(m, 46, 25, z0, 66, 39, z1);
    s.put(m, 45, 26, z0, 67, 38, z1);
    s.put(m, 52, 39, z0, 60, 40, z1);
    s.put(m, 54, 40, z0, 58, 41, z1);
  };
  board(85, 89, livery.red);
  const paint: Record<string, number> = {
    '.': livery.blue, b: MAT.bark, t: TRIM, c: MAT.cream, s: MAT.bark, l: MAT.moss, g: MAT.grass,
  };
  for (const [z, mirrored] of [[88, false], [85, true]] as const) {
    board(z, z + 1, livery.gold);
    s.put(livery.red, 46, 26, z, 66, 38, z + 1);
    s.put(livery.brass, 54, 40, z, 58, 41, z + 1);
    SIGN_DEVICE.forEach((row, i) => {
      const y = 36 - i;
      for (let c = 0, start = 0; c <= row.length; c++) {
        if (c < row.length && row[c] === row[start]) continue;
        const [x0, x1] = mirrored ? [65 - c, 65 - start] : [47 + start, 47 + c];
        s.put(paint[row[start]!]!, x0, y, z, x1, y + 1, z + 1);
        start = c;
      }
    });
  }
}

/**
 * A caged lantern: a brass foot and finial, four iron corner posts round a cross of glass with its light at the
 * centre, a brass cap and an iron ring to hang it by. Returns the lit cell. `g0` is the glass's lowest row.
 */
function lantern(s: InnShell, livery: Livery, cx: number, cz: number, g0: number): Vec3 {
  s.put(livery.brass, cx, g0 - 2, cz, cx + 1, g0 - 1, cz + 1);
  s.put(livery.brass, cx - 1, g0 - 1, cz - 1, cx + 2, g0, cz + 2);
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) s.put(IRON, cx + dx, g0, cz + dz, cx + dx + 1, g0 + 4, cz + dz + 1);
  s.put(MAT.glass, cx, g0, cz - 1, cx + 1, g0 + 4, cz + 2);
  s.put(MAT.glass, cx - 1, g0, cz, cx + 2, g0 + 4, cz + 1);
  s.put(livery.brass, cx - 1, g0 + 4, cz - 1, cx + 2, g0 + 5, cz + 2);
  s.put(livery.brass, cx, g0 + 5, cz, cx + 1, g0 + 6, cz + 1);
  s.put(IRON, cx, g0 + 6, cz, cx + 1, g0 + 7, cz + 1);
  return [cx, g0 + 2, cz];
}

/** A door lantern hung from an iron arm on a back plate set into the wing front. */
function doorLantern(s: InnShell, livery: Livery, cx: number): Vec3 {
  const cz = 83, g0 = 18;
  s.put(IRON, cx, g0 + 3, 80, cx + 1, g0 + 9, 81);
  s.put(IRON, cx, g0 + 7, 80, cx + 1, g0 + 8, cz + 1);
  return lantern(s, livery, cx, cz, g0);
}

// ── The frontage ──────────────────────────────────────────────────────────────────────────────────────────────────

/** One broad dark slate step before the door, its outer corners worn round. */
function step(s: InnShell): void {
  s.put(MAT.darkStone, 47, 0, 83, 65, 1, 87);
  s.put(MAT.darkStone, 46, 0, 83, 66, 1, 86);
}

/** A timber trough along the foot of the bow window, planted thick, with leaves trailing over its lip. */
function trough(s: InnShell): void {
  s.put(TRIM, 14, 0, 73, 32, 5, 76);
  s.put(MAT.earth, 15, 4, 74, 31, 5, 75);
  s.put(MAT.leaf, 15, 5, 74, 31, 6, 76);
  blooms(s, 15, 31, 6, 74, 76, 5);
  for (let x = 15; x < 31; x += 3 + Math.floor(hash(6, x) * 3)) s.put(MAT.leaf, x, 2, 76, x + 1, 5, 77);
}

/** An upright cask with a round board on it for a table, two small casks for stools, and two pewter tankards left out. */
function barrelTable(s: InnShell): void {
  for (const [u0, u1, v0, v1] of round(18, 80, 8)) {
    s.put(TRIM, u0, 0, v0, u1, 9, v1);
    for (const y of [1, 7]) s.put(IRON, u0, y, v0, u1, y + 1, v1);
  }
  for (const [u0, u1, v0, v1] of round(16, 78, 12)) s.put(TRIM, u0, 9, v0, u1, 10, v1);
  for (const [x, z] of [[20, 82], [24, 85]] as const) {
    s.put(IRON, x, 10, z, x + 1, 12, z + 1);
    s.put(MAT.cream, x, 12, z, x + 1, 13, z + 1);
  }
  for (const x of [12, 28]) for (const [u0, u1, v0, v1] of round(x, 82, 4)) {
    s.put(TRIM, u0, 0, v0, u1, 5, v1);
    s.put(IRON, u0, 3, v0, u1, 4, v1);
  }
}

/**
 * Three casks stacked against the east gable, ends out: two on the ground and one in the groove between them,
 * banded with iron, their heads in dark end grain.
 */
function caskStack(s: InnShell): void {
  const cask = (y0: number, z0: number) => {
    const [x0, x1] = [104, 114];
    for (const [u0, u1, v0, v1] of round(z0, y0, 8)) {
      s.put(TRIM, x0, v0, u0, x1, v1, u1);
      for (const x of [x0 + 1, x1 - 2]) s.put(IRON, x, v0, u0, x + 1, v1, u1);
    }
    for (const [u0, u1, v0, v1] of round(z0 + 1, y0 + 1, 6)) s.put(MAT.bark, x1 - 1, v0, u0, x1, v1, u1);
  };
  cask(0, 52);
  cask(0, 60);
  cask(6, 56);
  for (const z of [51, 68]) s.put(TRIM, 106, 0, z, 112, 2, z + 1);
}

/** A wren with its tail cocked, cut from brass, on a perch and rod at the cross gable's apex. Rows top to bottom. */
const WREN = [
  '.........xx',
  '........xx.',
  '..xx...xx..',
  '.xxxxxxxx..',
  'xxxxxxxxx..',
  '.xxxxxxx...',
  '...x..x....',
  'xxxxxxxxxxx',
] as const;

function wren(s: InnShell, livery: Livery): void {
  const z = 85, base = 90, x0 = CX - 5;
  s.put(IRON, CX, 82, z, CX + 1, base, z + 1);
  const cells: [number, number][] = [];
  WREN.forEach((row, i) => { for (let u = 0; u < row.length; u++) if (row[u] === 'x') cells.push([u, WREN.length - 1 - i]); });
  runs(cells, (u0, u1, v) => s.put(livery.brass, x0 + u0, base + v, z, x0 + u1, base + v + 1, z + 1));
}
