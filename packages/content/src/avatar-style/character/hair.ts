import type { Slot, VoxelGrid } from './grid';
import { FACE_Z, SKULL } from './head';
import type { BeardStyleId, HairStyleId } from './recipe';

/*
 * Hair is the signature (spec L3). Each style is built around the 8-cell skull in two passes: the scalp is
 * painted, then the volume is stacked as rounded slabs, one per row. A slab is a rectangle with its corners
 * stepped off, so a stack of them makes the stepped dome of a pixel circle: crisp, never blobby. Close
 * styles stay within a cell of the skull; curls, afro, buns, ponytail and long waves are the silhouette.
 * `guardFace` runs last for every style: nothing proud ever sits in front of the face below the hairline,
 * and the eyes and the two rows under them stay clear (the tests hold every style to that).
 */

const X0: number = SKULL.x[0], X1: number = SKULL.x[1], Y0: number = SKULL.y[0], Y1: number = SKULL.y[1], Z0: number = SKULL.z[0], Z1: number = SKULL.z[1];
const TOP = Y1, FRONT = Z1;
type Span = readonly [number, number];

/** A stable per-cell number in [0, 1), for hand-placed irregularity (lumps, locks, the odd darker strand). */
export function cellHash(x: number, y: number, z: number, salt = 0): number {
  let h = Math.imul(x * 73856093 ^ y * 19349663 ^ z * 83492791 ^ salt * 2654435761, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

interface Scalp {
  /** Lowest skull row painted on the face plane (the hairline, y). */
  readonly front: number;
  /** Lowest row painted on the sides. */
  readonly side: number;
  /** Lowest row painted on the back. */
  readonly back: number;
  /** Rows under `side` and `back` painted as a short fade. */
  readonly fade?: number;
}

function scalp(g: VoxelGrid, s: Scalp): void {
  g.paint([X0, TOP - 1, Z0], [X1, TOP, Z1], 'hair', ['skin']);
  g.paint([X0, s.front, FACE_Z], [X1, TOP, Z1], 'hair', ['skin']);
  for (const x of [X0, X1 - 1]) {
    g.paint([x, s.side, Z0], [x + 1, TOP, FACE_Z], 'hair', ['skin']);
    // The front column of each side keeps the hairline: a sideburn, never a cheek of hair.
    g.paint([x, Math.max(s.side, s.front - 1), FACE_Z], [x + 1, TOP, Z1], 'hair', ['skin']);
    if (s.fade) g.paint([x, s.side - s.fade, Z0], [x + 1, s.side, FACE_Z], 'scalp', ['skin']);
  }
  g.paint([X0, s.back, Z0], [X1, TOP, Z0 + 1], 'hair', ['skin']);
  if (s.fade) g.paint([X0, s.back - s.fade, Z0], [X1, s.back, Z0 + 1], 'scalp', ['skin']);
}

/**
 * One row of hair volume: the rectangle x ∈ [x0, x1), z ∈ [z0, z1) with `cut` cells stepped off each corner.
 * Existing cells (the skull, earlier hair) are kept, so the scalp paint shows where the slab is inside it.
 */
function slab(g: VoxelGrid, y: number, [x0, x1]: Span, [z0, z1]: Span, cut = 1, slot: Slot = 'hair'): void {
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
    if (Math.min(x - x0, x1 - 1 - x) + Math.min(z - z0, z1 - 1 - z) < cut) continue;
    if (!g.has(x, y, z)) g.set(x, y, z, slot);
  }
}

/** Slabs for a run of rows. */
function slabs(g: VoxelGrid, ys: Span, x: Span, z: Span, cut = 1): void {
  for (let y = ys[0]; y < ys[1]; y++) slab(g, y, x, z, cut);
}

/** Proud cells in front of the face plane, one row of x spans at a time. */
function fringe(g: VoxelGrid, rows: readonly (readonly [number, readonly Span[]])[], z = FRONT, slot: Slot = 'hair'): void {
  for (const [y, spans] of rows) for (const [a, b] of spans) g.fill([a, y, z], [b, y + 1, z + 1], slot);
}

/** Breaks the outer surface of a big volume into locks: some outside cells go, a few push one cell out. */
function locks(g: VoxelGrid, below: number, salt: number, gone = .24, out = .1): void {
  const outside = (x: number, z: number) => x < X0 - 1 || x >= X1 + 1 || z < Z0 - 1;
  const cells = [...g.entries()].filter(([[x, y, z], s]) => s === 'hair' && y < below && outside(x, z));
  for (const [[x, y, z]] of cells) {
    const h = cellHash(x, y, z, salt);
    const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1]];
    const exposed = dirs.filter(([dx, dz]) => !g.has(x + dx, y, z + dz) && outside(x + dx, z + dz));
    if (!exposed.length) continue;
    if (h < gone) g.delete(x, y, z);
    else if (h > 1 - out) { const [dx, dz] = exposed[0]!; g.set(x + dx, y, z + dz, 'hair'); }
  }
}

/** Nothing proud in front of the face below the hairline; no hair paint on the face below it either. */
function guardFace(g: VoxelGrid, hairline: number): void {
  g.carve([X0, Y0 - 2, FRONT], [X1, hairline, FRONT + 4]);
  g.paint([X0 + 1, Y0, FACE_Z], [X1 - 1, hairline, Z1], 'skin', ['hair', 'hairDeep', 'hairLight', 'scalp']);
}

/** Hair that falls below the jaw stays beside and behind the neck, never under the chin or over the chest. */
function clearUnderChin(g: VoxelGrid): void {
  const hairy: readonly Slot[] = ['hair', 'hairDeep', 'hairLight'];
  for (const [[x, y, z], slot] of [...g.entries()]) if (y < Y0 && x >= X0 && x < X1 && z >= Z0 + 2 && hairy.includes(slot)) g.delete(x, y, z);
}

/**
 * Under-layers in the deep tone: the lowest cell of each lock, and the odd strand. A beard keeps its face
 * plane in one tone: a darker cell there, under the eyes, reads as a mouth.
 */
function deepen(g: VoxelGrid, slot: 'hair' | 'beard', deep: 'hairDeep' | 'beardDeep', chance: number, salt: number): void {
  const cells = [...g.entries()].filter(([, s]) => s === slot);
  for (const [[x, y, z]] of cells) {
    const underside = !g.has(x, y - 1, z) && y < TOP - 1;
    const facePlane = slot === 'beard' && z >= FACE_Z;
    if (underside || (!facePlane && cellHash(x, y, z, salt) < chance)) g.set(x, y, z, deep);
  }
}

const STYLES: Record<Exclude<HairStyleId, 'bald'>, (g: VoxelGrid) => void> = {
  'short-crop'(g) {
    scalp(g, { front: 21, side: 19, back: 17, fade: 2 });
    slab(g, 25, [-2, 2], [-3, 1], 1);
    slab(g, 24, [-4, 4], [-4, 4], 2);
    slab(g, 23, [-5, 5], [-5, 5], 2);
    slab(g, 22, [-5, 5], [-5, 4], 2);
    fringe(g, [[22, [[-4, 0]]], [21, [[-4, -2]]]]);
    guardFace(g, 21);
    deepen(g, 'hair', 'hairDeep', .06, 1);
  },

  quiff(g) {
    scalp(g, { front: 21, side: 20, back: 19, fade: 2 });
    slab(g, 26, [-2, 2], [0, 5], 1);
    slab(g, 25, [-3, 3], [-3, 5], 1);
    slab(g, 24, [-4, 4], [-4, 5], 2);
    slab(g, 23, [-5, 5], [-5, 5], 2);
    slab(g, 22, [-5, 5], [-5, 3], 2);
    // The peak, swept forward and up, and one forelock over the left brow.
    g.fill([-2, 26, 5], [1, 27, 6], 'hairLight');
    fringe(g, [[22, [[-4, -2]]], [21, [[2, 3]]], [22, [[2, 3]]]]);
    guardFace(g, 21);
    g.fill([2, 21, FRONT], [3, 23, FRONT + 1], 'hair');
    deepen(g, 'hair', 'hairDeep', .05, 2);
  },

  curls(g) {
    scalp(g, { front: 21, side: Y0, back: Y0 });
    slab(g, 26, [-2, 2], [-3, 1], 1);
    slab(g, 25, [-4, 4], [-5, 3], 2);
    slab(g, 24, [-5, 5], [-6, 4], 2);
    slabs(g, [21, 24], [-6, 6], [-6, 5], 2);
    slabs(g, [18, 21], [-6, 6], [-6, 4], 1);
    slabs(g, [15, 18], [-7, 7], [-6, 3], 2);
    slab(g, 14, [-7, 7], [-5, 2], 3);
    // A parting at the crown, a fringe that falls in clumps.
    g.carve([0, 25, 1], [1, 27, 4]);
    fringe(g, [[21, [[-4, -2], [1, 2]]]]);
    guardFace(g, 21);
    clearUnderChin(g);
    locks(g, 23, 3);
    deepen(g, 'hair', 'hairDeep', .1, 3);
  },

  afro(g) {
    scalp(g, { front: 21, side: Y0 + 1, back: Y0 });
    const c = [-.5, 22, -1], r = [7.1, 5.9, 6.7];
    for (let x = -8; x < 8; x++) for (let y = 15; y < 29; y++) for (let z = -9; z < FRONT + 1; z++) {
      const d = ((x + .5 - c[0]!) / r[0]!) ** 2 + ((y + .5 - c[1]!) / r[1]!) ** 2 + ((z + .5 - c[2]!) / r[2]!) ** 2;
      if (d > 1 || g.has(x, y, z)) continue;
      // Coils: a third of the outermost cells are left out, so the edge breaks into nubs.
      if (d > .8 && cellHash(x, y, z, 4) < .34) continue;
      g.set(x, y, z, 'hair');
    }
    guardFace(g, 21);
    clearUnderChin(g);
    fringe(g, [[21, [[-4, -1], [1, 4]]]]);
    deepen(g, 'hair', 'hairDeep', .12, 5);
  },

  buns(g) {
    scalp(g, { front: 21, side: 18, back: Y0 + 1 });
    slab(g, 25, [-3, 3], [-3, 2], 1);
    slab(g, 24, [-4, 4], [-4, 4], 2);
    slabs(g, [21, 24], [-5, 5], [-5, 4], 2);
    slabs(g, [19, 21], [-5, 5], [-5, 3], 2);
    // A centre parting, the fringe swept to each side.
    fringe(g, [[23, [[-4, -1], [0, 4]]], [22, [[-4, -1], [1, 4]]], [21, [[-4, -2], [2, 4]]]]);
    // Two buns, high on the sides of the head.
    for (const [x0, x1] of [[-9, -5], [5, 9]] as const) {
      slabs(g, [19, 24], [x0, x1], [-3, 2], 1);
      slab(g, 18, [x0 + 1, x1 - 1], [-2, 1], 0);
      slab(g, 24, [x0 + 1, x1 - 1], [-2, 1], 0);
    }
    guardFace(g, 21);
    deepen(g, 'hair', 'hairDeep', .08, 6);
  },

  ponytail(g) {
    scalp(g, { front: 21, side: 19, back: Y0 + 1 });
    slab(g, 25, [-3, 3], [-3, 2], 1);
    slab(g, 24, [-4, 4], [-5, 4], 2);
    slabs(g, [20, 24], [-5, 5], [-5, 3], 2);
    // Swept fringe, longer on the person's right.
    fringe(g, [[23, [[-4, 4]]], [22, [[-4, 2]]], [21, [[-4, -1]]]]);
    // Tied high at the back of the crown, the tail rises over the head and arcs back and down behind it,
    // so it shows above the crown in a portrait and swings free on the walk.
    g.fill([-1, 25, -5], [1, 26, -2], 'band');
    g.fill([-1, 26, -6], [1, 27, -2], 'hair');
    g.fill([-1, 27, -8], [1, 28, -4], 'hair');
    g.fill([-1, 25, -10], [1, 28, -7], 'hair');
    g.fill([-1, 21, -11], [1, 25, -9], 'hair');
    g.fill([-1, 18, -11], [1, 21, -10], 'hair');
    g.fill([-1, 27, -5], [0, 28, -4], 'hairLight');
    guardFace(g, 21);
    deepen(g, 'hair', 'hairDeep', .06, 7);
  },

  bob(g) {
    scalp(g, { front: 21, side: Y0, back: Y0 });
    slab(g, 25, [-3, 3], [-4, 3], 1);
    slab(g, 24, [-5, 5], [-5, 5], 2);
    slabs(g, [21, 24], [-5, 5], [-5, 5], 1);
    slabs(g, [16, 21], [-5, 5], [-5, 5], 1);
    guardFace(g, 21);
    // A blunt fringe with one cell out of line.
    g.delete(1, 21, FRONT);
    deepen(g, 'hair', 'hairDeep', .05, 8);
  },

  'long-waves'(g) {
    scalp(g, { front: 21, side: Y0, back: Y0 });
    slab(g, 25, [-3, 3], [-4, 3], 1);
    slab(g, 24, [-5, 5], [-5, 4], 2);
    slabs(g, [21, 24], [-5, 5], [-5, 5], 1);
    // Below the fringe the curtains lie flush with the face plane, never forward of it like a hood.
    slabs(g, [10, 21], [-5, 5], [-5, 4], 1);
    // Waves: the outside swings one cell out every other pair of rows.
    for (const y of [10, 11, 14, 15, 18, 19]) slab(g, y, [-6, 6], [-6, 3], 2);
    // A centre parting with curtains to each side.
    g.carve([-1, 22, FRONT], [1, 26, FRONT + 1]).carve([0, 25, -1], [1, 26, 4]);
    guardFace(g, 21);
    fringe(g, [[21, [[-4, -3], [3, 4]]], [20, [[-4, -3], [3, 4]]]], FACE_Z);
    clearUnderChin(g);
    deepen(g, 'hair', 'hairDeep', .08, 9);
  },
};

export function drawHair(g: VoxelGrid, style: HairStyleId): void {
  if (style !== 'bald') STYLES[style](g);
}

const BEARDS: Record<BeardStyleId, (g: VoxelGrid) => void> = {
  full(g) {
    // Flush over the two face rows under the eyes and up the jaw to the sideburns, with a short tip under
    // the chin: a beard, never a muzzle.
    g.paint([X0, Y0, FACE_Z], [X1, Y0 + 2, Z1], 'beard', ['skin', 'blush', 'freckle']);
    for (const x of [X0, X1 - 1]) g.paint([x, Y0, -1], [x + 1, Y0 + 5, Z1], 'beard', ['skin', 'hair', 'hairDeep', 'scalp']);
    g.fill([X0 + 1, Y0 - 1, 0], [X1 - 1, Y0, Z1], 'beard');
    g.fill([-2, Y0 - 2, 1], [2, Y0 - 1, Z1], 'beard');
    deepen(g, 'beard', 'beardDeep', .1, 11);
  },
  chinstrap(g) {
    g.paint([X0, Y0, FACE_Z], [X1, Y0 + 1, Z1], 'beard', ['skin', 'blush', 'freckle']);
    for (const x of [X0, X1 - 1]) g.paint([x, Y0, 0], [x + 1, Y0 + 5, Z1], 'beard', ['skin', 'hair', 'hairDeep', 'scalp']);
    g.fill([X0 + 2, Y0 - 1, 1], [X1 - 2, Y0, FRONT], 'beard');
    deepen(g, 'beard', 'beardDeep', .08, 12);
  },
};

export function drawBeard(g: VoxelGrid, style: BeardStyleId): void {
  BEARDS[style](g);
}
