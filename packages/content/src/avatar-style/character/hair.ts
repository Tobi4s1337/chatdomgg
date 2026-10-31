import { VoxelGrid } from './grid';
import { FACE_Z } from './head';
import {
  FRONT, HAIR_SLOTS, TOP, X0, X1, Y0, Z0, Z1, cellHash, clearUnderChin, deepen, fringe, guardFace, hairline, locks, scalp, slab, slabs, type HairStyle,
} from './hair-kit';
import { HAIR_CUTS } from './hair-cuts';
import type { BeardStyleId, HairStyleId, MoustacheStyleId } from './recipe';

/*
 * The hair styles (spec L3). The first eight came with the head; the rest are in `hair-cuts.ts`. Close styles
 * stay within a cell of the skull; curls, afro, buns, ponytail and long waves are the silhouette.
 */

type ClassicId = 'short-crop' | 'quiff' | 'curls' | 'afro' | 'buns' | 'ponytail' | 'bob' | 'long-waves';

const CLASSIC: Record<ClassicId, HairStyle> = {
  'short-crop': { draw(g) {
    scalp(g, { front: 21, side: 19, back: 17, fade: 2 });
    slab(g, 25, [-2, 2], [-3, 1], 1);
    slab(g, 24, [-4, 4], [-4, 4], 2);
    slab(g, 23, [-5, 5], [-5, 5], 2);
    slab(g, 22, [-5, 5], [-5, 4], 2);
    fringe(g, [[22, [[-4, 0]]], [21, [[-4, -2]]]]);
    guardFace(g, 21);
    deepen(g, 'hair', 'hairDeep', .06, 1);
  } },

  quiff: { draw(g) {
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
  } },

  curls: { draw(g) {
    scalp(g, { front: 21, side: Y0, back: Y0 });
    slab(g, 26, [-2, 2], [-3, 1], 1);
    slab(g, 25, [-4, 4], [-5, 3], 2);
    slab(g, 24, [-5, 5], [-6, 4], 2);
    slabs(g, [21, 24], [-6, 6], [-6, 5], 2);
    slabs(g, [18, 21], [-6, 6], [-6, 4], 1);
    slabs(g, [15, 18], [-7, 7], [-6, 3], 2);
    slab(g, 14, [-7, 7], [-5, 2], 3);
    // A parting at the crown; the fringe falls in clumps, low over the person's right brow, curling up off
    // the forehead on the left and back down at the temple.
    g.carve([0, 25, 1], [1, 27, 4]);
    hairline(g, [[20, 21], [21, 21], [21, 21], [21, 22], [22, 22], [23, 23], [22, 22], [20, 21]]);
    guardFace(g, 21);
    clearUnderChin(g);
    locks(g, 23, 3);
    deepen(g, 'hair', 'hairDeep', .1, 3);
  } },

  afro: { draw(g) {
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
  } },

  buns: {
    draw(g) {
    scalp(g, { front: 21, side: 18, back: Y0 + 1 });
    slab(g, 25, [-3, 3], [-3, 2], 1);
    slab(g, 24, [-4, 4], [-4, 4], 2);
    slabs(g, [21, 24], [-5, 5], [-5, 4], 2);
    slabs(g, [19, 21], [-5, 5], [-5, 3], 2);
    // Parted on the person's right, the fringe swept over to the left and falling lower there.
    hairline(g, [[20, 21], [22, 22], [TOP], [23, 23], [22, 22], [21, 22], [21, 21], [20, 21]]);
    guardFace(g, 21);
    deepen(g, 'hair', 'hairDeep', .08, 6);
    },
    tied(g) {
      // Two buns, high on the sides of the head.
      for (const [x0, x1] of [[-9, -5], [5, 9]] as const) {
        slabs(g, [19, 24], [x0, x1], [-3, 2], 1);
        slab(g, 18, [x0 + 1, x1 - 1], [-2, 1], 0);
        slab(g, 24, [x0 + 1, x1 - 1], [-2, 1], 0);
      }
      deepen(g, 'hair', 'hairDeep', .08, 6);
    },
  },

  ponytail: {
    draw(g) {
    scalp(g, { front: 21, side: 19, back: Y0 + 1 });
    slab(g, 25, [-3, 3], [-3, 2], 1);
    slab(g, 24, [-4, 4], [-5, 4], 2);
    slabs(g, [20, 24], [-5, 5], [-5, 3], 2);
    // Swept fringe, longer on the person's right, pulled back off the forehead on the left.
    hairline(g, [[20, 21], [21, 21], [21, 21], [21, 22], [22, 22], [22, 23], [23], [21]]);
    guardFace(g, 21);
    deepen(g, 'hair', 'hairDeep', .06, 7);
    },
    tied(g, brim) {
      if (brim !== undefined) {
        // Under a hat the tail comes out low at the back, through the cap's opening, and hangs straight.
        g.fill([-1, brim - 2, -6], [1, brim, -5], 'band');
        g.fill([-1, brim - 3, -8], [1, brim, -6], 'hair');
        g.fill([-1, 15, -9], [1, brim - 2, -7], 'hair');
        g.fill([-1, 13, -9], [1, 15, -8], 'hair');
        deepen(g, 'hair', 'hairDeep', .06, 7);
        return;
      }
      // Tied high at the back of the crown, the tail rises over the head and arcs back and down behind it,
      // so it shows above the crown in a portrait and swings free on the walk.
      g.fill([-1, 25, -5], [1, 26, -2], 'band');
      g.fill([-1, 26, -6], [1, 27, -2], 'hair');
      g.fill([-1, 27, -8], [1, 28, -4], 'hair');
      g.fill([-1, 25, -10], [1, 28, -7], 'hair');
      g.fill([-1, 21, -11], [1, 25, -9], 'hair');
      g.fill([-1, 18, -11], [1, 21, -10], 'hair');
      g.fill([-1, 27, -5], [0, 28, -4], 'hairLight');
      deepen(g, 'hair', 'hairDeep', .06, 7);
    },
  },

  bob: { draw(g) {
    scalp(g, { front: 21, side: Y0, back: Y0 });
    slab(g, 25, [-3, 3], [-4, 3], 1);
    // The crown steps back from the fringe, so the front is a fringe and not a wall.
    slab(g, 24, [-5, 5], [-5, 4], 2);
    slabs(g, [21, 24], [-5, 5], [-5, 5], 1);
    slabs(g, [16, 21], [-5, 5], [-5, 5], 1);
    // A blunt fringe, but cut by hand: a step up over the person's left brow, one longer piece.
    hairline(g, [[20, 21], [21, 21], [21, 21], [21, 22], [22, 22], [22, 22], [22, 23], [20, 21]]);
    guardFace(g, 21);
    deepen(g, 'hair', 'hairDeep', .05, 8);
  } },

  'long-waves': { draw(g) {
    scalp(g, { front: 21, side: Y0, back: Y0 });
    slab(g, 25, [-3, 3], [-4, 3], 1);
    slab(g, 24, [-5, 5], [-5, 4], 2);
    slabs(g, [21, 24], [-5, 5], [-5, 5], 1);
    // Below the fringe the curtains lie flush with the face plane, never forward of it like a hood.
    slabs(g, [10, 21], [-5, 5], [-5, 4], 1);
    // Waves: the outside swings one cell out every other pair of rows.
    for (const y of [10, 11, 14, 15, 18, 19]) slab(g, y, [-6, 6], [-6, 3], 2);
    // A parting just off centre, the curtains falling away from it: longer on the person's right.
    g.carve([0, 25, -1], [1, 26, 4]);
    hairline(g, [[20, 21], [21, 21], [21, 22], [22, 23], [TOP], [23, 23], [22, 22], [20, 21]]);
    guardFace(g, 21);
    fringe(g, [[21, [[-4, -3], [3, 4]]], [20, [[-4, -3], [3, 4]]]], FACE_Z);
    clearUnderChin(g);
    deepen(g, 'hair', 'hairDeep', .08, 9);
  } },
};


/** Every style but bald. */
export const HAIR_STYLES: Record<Exclude<HairStyleId, 'bald'>, HairStyle> = { ...CLASSIC, ...HAIR_CUTS };

/** The head of hair. Tied parts are drawn separately (`drawTiedHair`), after any hat. */
export function drawHair(g: VoxelGrid, style: HairStyleId): void {
  if (style === 'bald') drawBald(g);
  else HAIR_STYLES[style].draw(g);
}

/**
 * Bald keeps the skull but steps its top edge in by a cell all round, the way every style's slabs step, so the
 * crown reads as a dome and not a box lid. The face keeps its square (only its two top corners go), the head
 * keeps its 8-cell footprint, and a hat still sits over the whole of it.
 */
function drawBald(g: VoxelGrid): void {
  for (let x = X0; x < X1; x++) for (let z = Z0; z < Z1; z++) {
    if (x === X0 || x === X1 - 1 || z === Z0) g.delete(x, TOP - 1, z);
  }
}

/**
 * Lays a style's tied parts (buns, tails, braids) over the citizen. They replace hair and empty space but
 * never a hat, skin or the face, so a tail comes out from under a brim and a bun sits beside a cap.
 */
export function drawTiedHair(g: VoxelGrid, style: HairStyleId, brim?: number): void {
  const hair = style === 'bald' ? undefined : HAIR_STYLES[style];
  if (!hair?.tied) return;
  const parts = new VoxelGrid();
  hair.tied(parts, brim);
  for (const [[x, y, z], slot] of parts.entries()) {
    const at = g.get(x, y, z);
    if (!at || HAIR_SLOTS.includes(at)) g.set(x, y, z, slot);
  }
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
  goatee(g) {
    // The middle of the chin row, and one short point under it at the front: never a second chin.
    g.paint([-2, Y0, FACE_Z], [2, Y0 + 1, Z1], 'beard', ['skin', 'blush', 'freckle']);
    g.fill([-1, Y0 - 1, FACE_Z], [1, Y0, Z1], 'beardDeep');
  },
  stubble(g) {
    // Shadow, not volume: the jaw and the chin rows tinted, nothing proud.
    g.paint([X0, Y0, FACE_Z], [X1, Y0 + 1, Z1], 'stubble', ['skin', 'blush', 'freckle']);
    g.paint([X0, Y0 + 1, FACE_Z], [X0 + 1, Y0 + 2, Z1], 'stubble', ['skin', 'blush', 'freckle']);
    g.paint([X1 - 1, Y0 + 1, FACE_Z], [X1, Y0 + 2, Z1], 'stubble', ['skin', 'blush', 'freckle']);
    for (const x of [X0, X1 - 1]) g.paint([x, Y0, 0], [x + 1, Y0 + 4, FACE_Z], 'stubble', ['skin']);
    g.paint([X0 + 1, Y0, 0], [X1 - 1, Y0 + 1, FACE_Z], 'stubble', ['skin']);
  },
};

export function drawBeard(g: VoxelGrid, style: BeardStyleId): void {
  BEARDS[style](g);
}

/*
 * Moustaches are their own part, worn with or without a beard and in their own colour. They stand one cell
 * proud on the row under the eyes, so their depth and shadow keep them apart from the eye blocks even in
 * black hair. Columns count from the person's right, like the face.
 */
const MOUSTACHES: Record<MoustacheStyleId, readonly (readonly [number, number])[]> = {
  // Wide and bushy, its ends drooping; the middle stays open over the chin so it never reads as lips.
  walrus: [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [0, 0], [1, 0], [6, 0], [7, 0]],
  // Wider, with tips curling up beside the eyes.
  handlebar: [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [0, 2], [7, 2]],
  // Ends that fall past the chin.
  horseshoe: [[2, 1], [3, 1], [4, 1], [5, 1], [2, 0], [5, 0], [2, -1], [5, -1]],
};

export function drawMoustache(g: VoxelGrid, style: MoustacheStyleId): void {
  for (const [col, row] of MOUSTACHES[style]) g.set(X0 + col, Y0 + row, FRONT, row < 1 ? 'stacheDeep' : 'stache');
}
