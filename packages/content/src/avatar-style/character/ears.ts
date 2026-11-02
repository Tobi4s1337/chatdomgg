import type { Slot, VoxelGrid } from './grid';
import { EYE_ROW, FACE_Z, SKULL } from './head';
import type { EarStyleId, EyeSpacing, FacePaintStyleId } from './recipe';

/*
 * Fey ears and face paint, the fey touches of the second wardrobe (Artstyle: citizens are always people, with
 * fey touches such as ears).
 *
 * Ears come out of the sides of the head behind the face, between the eye row and the temple. They are drawn
 * after the hair and any hat, so they always show: an ear starts where the hair at its root ends, overwriting
 * the outermost cell of it, and stands fully outside, so it pokes cleanly through a bob, an afro or a hat's
 * flaps. Under a brim an ear tucks under: it never rises through the brim or stands inside a hat.
 */

/**
 * An ear's profile on the person's right, top row first. Columns step outward from the root (column 0, the cell
 * against the head or the hair). `X` is the root, two cells deep; `i` an inner-ear cell (the warm inside at the
 * front, the ear behind it); `x` ear one cell deep; `b` a tip swept back, two cells deep; `t` a tuft in the hair colour.
 */
interface EarShape { readonly bottom: number; readonly rows: readonly string[] }

const EARS: Record<EarStyleId, EarShape> = {
  pointed: { bottom: 17, rows: ['..x', '.xx', 'Xi.', 'Xi.', 'X..'] },
  'long-fey': { bottom: 17, rows: ['....b', '...xb', '..xx.', '.ix..', 'Xi...', 'Xi...', 'X....'] },
  tufted: { bottom: 17, rows: ['..tt', '..xt', '.xx.', 'Xi..', 'Xi..', 'X...'] },
  droopy: { bottom: 17, rows: ['Xx...', 'Xixx.', 'Xi.xx', '....x'] },
  leaf: { bottom: 17, rows: ['.xx..', 'Xiixb', 'Xiix.', '.xx..'] },
  petite: { bottom: 18, rows: ['.x', 'Xi', 'X.'] },
};

/** The z of an ear's root (the back cell of two) and its front. Real ears sit just behind the middle of the head. */
const BACK = -1, FRONT_Z = 0;

const HAT_SLOTS: readonly Slot[] = ['hat', 'hatDeep', 'hatTrim', 'hatTrimDeep', 'hatWhite', 'hatInk', 'forgeMetal'];

/** The cells of one ear before it is placed: [outward step, y, z, slot]. */
function earCells(style: EarStyleId): [number, number, number, Slot][] {
  const { bottom, rows } = EARS[style];
  const cells: [number, number, number, Slot][] = [];
  rows.forEach((row, r) => [...row].forEach((c, o) => {
    const y = bottom + rows.length - 1 - r;
    if (c === 'X') cells.push([o, y, BACK, 'ear'], [o, y, FRONT_Z, 'ear']);
    else if (c === 'i') cells.push([o, y, BACK, 'ear'], [o, y, FRONT_Z, 'earDeep']);
    else if (c === 'x') cells.push([o, y, BACK, 'ear']);
    else if (c === 'b') cells.push([o, y, BACK, 'ear'], [o, y, BACK - 1, 'ear']);
    else if (c === 't') cells.push([o, y, BACK, 'earTuft']);
  }));
  return cells;
}

/** The rows an ear style's root covers, for tests and the builder. */
export function earRows(style: EarStyleId): readonly number[] {
  return [...new Set(earCells(style).filter(([o]) => o === 0).map(([, y]) => y))];
}

export function drawEars(g: VoxelGrid, style: EarStyleId): void {
  const cells = earCells(style);
  const roots = cells.filter(([o]) => o === 0);
  for (const side of [-1, 1] as const) {
    // The first column outside the skull on this side, then out past whatever hair or flap covers the root.
    const first = side < 0 ? SKULL.x[0] - 1 : SKULL.x[1];
    let depth = 0;
    for (const [, y, z] of roots) {
      let n = 0;
      while (n < 8 && g.has(first + side * n, y, z)) n++;
      depth = Math.max(depth, n);
    }
    const root = first + side * Math.max(0, depth - 1);
    for (const [o, y, z, slot] of cells) {
      const x = root + side * o;
      if (HAT_SLOTS.includes(g.get(x, y, z)!)) continue;
      // Under a brim the ear tucks under it rather than rising through.
      let underBrim = false;
      for (let below = y - 1; below >= y - 4 && !underBrim; below--) underBrim = HAT_SLOTS.includes(g.get(x, below, z)!);
      if (!underBrim) g.set(x, y, z, slot);
    }
  }
}

/*
 * Face paint: small festival marks in one colour from the paint pot, painted over the skin of the cheeks and
 * round the eyes and never over the eyes, the hair, a beard or the mouth area. Cells are [column, row] on the
 * face plane, columns from the person's right as in `head.ts`; `heart` sits round an eye with the eye in its
 * notch, `mask-band` is the widest and still leaves the face below the eyes bare.
 */
type FaceCells = readonly (readonly [number, number])[];
const mirror = (cells: FaceCells): FaceCells => [...cells, ...cells.map(([c, r]) => [7 - c, r] as const)];

const PAINTS: Record<FacePaintStyleId, Record<EyeSpacing, FaceCells>> = {
  'cheek-stripes': { set: mirror([[0, 1], [1, 1]]), wide: mirror([[0, 1], [1, 1]]) },
  // An x of five cells under the right eye: the eye cell itself is never painted, so on a set face it keeps four.
  'cheek-star': { set: [[1, 1], [0, 0], [2, 0], [0, 2], [2, 2]], wide: [[1, 1], [0, 0], [2, 0], [0, 2], [2, 2]] },
  'paint-dots': { set: mirror([[0, 2], [1, 1], [0, 0]]), wide: mirror([[0, 1], [2, 1], [1, 0]]) },
  heart: {
    set: [[1, 2], [3, 2], [1, 1], [2, 1], [3, 1], [2, 0]],
    wide: [[0, 2], [2, 2], [0, 1], [1, 1], [2, 1], [1, 0]],
  },
  daisy: {
    set: [[6, 1], [5, 1], [7, 1], [6, 2], [6, 0]],
    wide: [[5, 1], [4, 1], [6, 1], [5, 2], [5, 0]],
  },
  'mask-band': {
    set: [0, 1, 2, 3, 4, 5, 6, 7].flatMap(c => [[c, EYE_ROW], [c, EYE_ROW + 1]] as const),
    wide: [0, 1, 2, 3, 4, 5, 6, 7].flatMap(c => [[c, EYE_ROW], [c, EYE_ROW + 1]] as const),
  },
};

/** Which face cells a paint style covers; the centre of the daisy is its yellow heart. */
export function paintCells(style: FacePaintStyleId, spacing: EyeSpacing): FaceCells {
  return PAINTS[style][spacing];
}

const PAINTABLE: readonly Slot[] = ['skin', 'blush', 'freckle'];

export function drawFacePaint(g: VoxelGrid, style: FacePaintStyleId, spacing: EyeSpacing): void {
  const x0 = SKULL.x[0], y0 = SKULL.y[0];
  const cells = PAINTS[style][spacing];
  cells.forEach(([c, r], i) => {
    const at = g.get(x0 + c, y0 + r, FACE_Z);
    if (at && PAINTABLE.includes(at)) g.set(x0 + c, y0 + r, FACE_Z, style === 'daisy' && i === 0 ? 'petalHeart' : 'paint');
  });
  // Stripes and the band wrap a cell round onto the sides of the face, so they read from the three-quarter view.
  if (style === 'cheek-stripes' || style === 'mask-band') {
    const rows = style === 'mask-band' ? [EYE_ROW, EYE_ROW + 1] : [1];
    for (const x of [SKULL.x[0], SKULL.x[1] - 1]) for (const r of rows) {
      const at = g.get(x, y0 + r, FACE_Z - 1);
      if (at && PAINTABLE.includes(at)) g.set(x, y0 + r, FACE_Z - 1, 'paint');
    }
  }
}
