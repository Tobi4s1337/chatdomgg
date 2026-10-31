import type { Slot, VoxelGrid } from './grid';
import { FACE_Z } from './head';
import {
  FRONT, X0, X1, Y0, Z0, Z1, cellHash, clearUnderChin, deepen, fringe, guardFace, scalp, slab, slabs, type HairStyle,
} from './hair-kit';

/*
 * The second set of hair styles (spec L3), drawn with the hair kit on the head's frame: +Y up, +Z toward the
 * face, x = -4 is the person's right (the side the portrait camera sees). Close cuts stay within a cell of
 * the skull; the mohawk crest, the wild tuft, locs, braids, pigtails and the top knot are the silhouette.
 * Under a hat everything above the brim and outside the skull goes, so each `draw` still reads as the cut
 * below y 22, and what should come out from under a brim (plaits, bunches, the knot) is `tied`.
 */

type CutId = 'side-part' | 'slicked' | 'spiky' | 'side-shave' | 'mohawk' | 'wild-tuft' | 'locs' | 'braids' | 'pigtails' | 'top-knot';

type Box = readonly [number, number, number];

/** Shaves a box of the head: skin and hair paint there turn to the stubbled scalp tone. */
function shave(g: VoxelGrid, from: Box, to: Box): void {
  g.paint(from, to, 'scalp', ['skin', 'hair']);
}

/** Paints a run of existing hair cells in another hair tone (sheen streaks, comb lines). */
function streak(g: VoxelGrid, from: Box, to: Box, slot: Slot): void {
  g.paint(from, to, slot, ['hair']);
}

/** A round lump of cells around the cell `c`: a pixel ball, never a cube. Only empty or hair cells are taken. */
function ball(g: VoxelGrid, [cx, cy, cz]: Box, radius: number, slot: Slot = 'hair'): void {
  const r = Math.floor(radius);
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
    if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
    const at = g.get(cx + dx, cy + dy, cz + dz);
    if (!at || at === 'hair') g.set(cx + dx, cy + dy, cz + dz, slot);
  }
}

/** Sets cells, one [x, y, z] each. */
function cells(g: VoxelGrid, list: readonly Box[], slot: Slot = 'hair'): void {
  for (const [x, y, z] of list) g.set(x, y, z, slot);
}

export const HAIR_CUTS: Record<CutId, HairStyle> = {
  'side-part': { draw(g) {
    scalp(g, { front: 21, side: 19, back: 17, fade: 2 });
    const part = -2;
    // The swept side heaps up left of the parting; the short side lies flat to the right of it.
    slab(g, 25, [part + 1, 3], [-3, 3], 1);
    slab(g, 24, [-5, 5], [-5, 4], 2);
    slab(g, 23, [-5, 5], [-5, 4], 2);
    slab(g, 22, [-5, 5], [-5, 4], 2);
    // The parting: a groove of scalp from the brow to the crown.
    g.carve([part, 24, -3], [part + 1, 25, 5]);
    g.paint([part, 23, -3], [part + 1, 24, Z1], 'scalp', ['hair']);
    g.paint([part, 22, FACE_Z], [part + 1, 24, Z1], 'scalp', ['hair']);
    // The fringe sweeps from the parting over to the person's left and flicks out past the temple.
    fringe(g, [[23, [[part + 1, 4]]], [22, [[0, 4]]], [21, [[2, 4]]]]);
    cells(g, [[4, 22, FRONT], [4, 21, FRONT]]);
    streak(g, [part + 1, 25, -3], [part + 2, 26, 3], 'hairLight');
    guardFace(g, 21);
    deepen(g, 'hair', 'hairDeep', .03, 21);
  } },

  slicked: { draw(g) {
    scalp(g, { front: 22, side: 19, back: 17, fade: 1 });
    // Combed flat and back: one cell over the crown, flush with the brow, a little fuller at the nape.
    slab(g, 24, [-4, 4], [-5, 4], 1);
    slabs(g, [22, 24], [-5, 5], [-5, 3], 1);
    slabs(g, [18, 22], [-4, 4], [-5, -4], 0);
    // Sheen: long streaks front to back over the crown, along each side and across the back.
    streak(g, [-3, 24, -4], [-2, 25, 3], 'hairLight');
    streak(g, [1, 24, -5], [2, 25, 2], 'hairLight');
    streak(g, [X0 - 1, 23, -4], [X0, 24, 3], 'hairLight');
    streak(g, [X1, 23, -4], [X1 + 1, 24, 3], 'hairLight');
    streak(g, [-3, 20, -5], [3, 21, -4], 'hairLight');
    guardFace(g, 21);
    deepen(g, 'hair', 'hairDeep', .03, 22);
  } },

  spiky: { draw(g) {
    scalp(g, { front: 21, side: 19, back: 17, fade: 2 });
    slab(g, 24, [-4, 4], [-4, 4], 1);
    slabs(g, [22, 24], [-5, 5], [-5, 5], 2);
    // Spikes: a 2 × 2 root and a one-cell point, the outer ones leaning out.
    // Spikes on a grid over the crown, a cell apart: a 2 × 2 root and a one-cell point on the outer corner,
    // taller down the middle, so the silhouette is a crisp saw.
    for (const x of [-4, -1, 2]) for (const z of [-4, -1, 2]) {
      const h = x === -1 && z > -4 ? 3 : 2;
      g.fill([x, 25, z], [x + 2, 24 + h, z + 2], 'hair');
      const tx = x < -1 ? x : x > -1 ? x + 1 : x + (z > 0 ? 1 : 0), tz = z < -1 ? z : z > -1 ? z + 1 : z;
      g.set(tx, 24 + h, tz, 'hair');
    }
    // A jagged fringe, and points out over the ears and the nape.
    fringe(g, [[23, [[-4, 4]]], [22, [[-4, 4]]], [21, [[-4, -3], [-1, 0], [2, 3]]]]);
    cells(g, [[-6, 23, 0], [-6, 23, -3], [5, 23, 0], [5, 23, -3], [-2, 23, -6], [1, 23, -6]]);
    guardFace(g, 21);
    deepen(g, 'hair', 'hairDeep', .06, 23);
  } },

  'side-shave': { draw(g) {
    scalp(g, { front: 21, side: 17, back: 17 });
    // Clippered on the person's right, from the temple round to the back.
    shave(g, [X0, 17, Z0], [X0 + 2, 24, FACE_Z]);
    shave(g, [X0, 19, FACE_Z], [X0 + 1, 24, Z1]);
    shave(g, [X0, 17, Z0], [-1, 24, Z0 + 1]);
    // Everything else swept over to the left, in one long fall that covers the left ear.
    slab(g, 25, [-3, 3], [-4, 3], 1);
    slab(g, 24, [-3, 5], [-5, 4], 1);
    slabs(g, [17, 24], [X1, X1 + 1], [-4, 4], 0);
    slabs(g, [19, 24], [X1 + 1, X1 + 2], [-4, 3], 0);
    slabs(g, [21, 24], [-1, 5], [Z0 - 1, Z0], 0);
    fringe(g, [[24, [[-3, 3]]], [23, [[-3, 5]]], [22, [[0, 5]]], [21, [[2, 5]]]]);
    // The swept lock falls past the left temple, beside the eye, never over it.
    cells(g, [[4, 20, FRONT], [4, 19, FRONT], [5, 20, FACE_Z]]);
    streak(g, [-2, 25, -3], [2, 26, 2], 'hairLight');
    streak(g, [X1 + 1, 22, -4], [X1 + 2, 23, 3], 'hairLight');
    guardFace(g, 21);
    deepen(g, 'hair', 'hairDeep', .06, 24);
  } },

  mohawk: { draw(g) {
    scalp(g, { front: 22, side: 22, back: 17 });
    // Shaved everywhere but a two-cell strip from the brow over the crown to the nape.
    shave(g, [X0, 18, Z0], [X1, 24, Z1]);
    g.paint([X0 + 1, Y0, FACE_Z], [X1 - 1, 22, Z1], 'skin', ['scalp']);
    g.paint([-1, 22, Z0], [1, 24, Z1], 'hair', ['scalp']);
    g.paint([-1, 17, Z0], [1, 24, Z0 + 1], 'hair', ['scalp', 'skin']);
    // The crest: tall over the crown, raked forward at the brow, tapering down the back.
    const crest: readonly (readonly [number, number, number])[] = [
      // z, lowest row, top row (exclusive)
      [5, 25, 27], [4, 23, 27], [3, 24, 28], [2, 24, 29], [1, 24, 28], [0, 24, 29], [-1, 24, 28],
      [-2, 24, 28], [-3, 24, 27], [-4, 24, 26], [-5, 18, 25], [-6, 21, 24],
    ];
    for (const [z, y0, y1] of crest) g.fill([-1, y0, z], [1, y1, z + 1], 'hair');
    for (const [z, , y1] of crest) g.set(0, y1 - 1, z, 'hairLight');
    guardFace(g, 21);
    deepen(g, 'hair', 'hairDeep', .05, 25);
  } },

  'wild-tuft': { draw(g) {
    scalp(g, { front: 21, side: 19, back: 17, fade: 1 });
    slab(g, 24, [-4, 4], [-4, 4], 1);
    slabs(g, [21, 24], [-5, 5], [-5, 4], 2);
    // Messy: odd cells stick out of the crop, others are missing.
    for (const [[x, y, z], slot] of [...g.entries()]) {
      if (slot !== 'hair' || y < 21 || (x >= X0 && x < X1 && z >= Z0 && z < Z1 && y < 24)) continue;
      const h = cellHash(x, y, z, 26);
      const dx = x < X0 ? -1 : x >= X1 ? 1 : 0, dz = z < Z0 ? -1 : z >= Z1 ? 1 : 0;
      if (h < .12) g.delete(x, y, z);
      else if (h > .84 && (dx || dz) && !g.has(x + dx, y, z + dz)) g.set(x + dx, y, z + dz, 'hair');
    }
    fringe(g, [[23, [[-4, 4]]], [22, [[-4, -1], [0, 4]]], [21, [[-3, -2], [1, 3]]]]);
    // The tuft: up from the front of the crown, over, and flopping down past the person's right.
    const tuft: readonly (readonly [number, number, number])[] = [
      // y, x from, x to
      [25, -2, 2], [26, -3, 1], [27, -5, 0], [28, -7, -2], [27, -8, -5], [26, -8, -6], [25, -8, -7],
    ];
    for (const [y, x0, x1] of tuft) g.fill([x0, y, -1], [x1, y + 1, 2], 'hair');
    g.fill([-1, 25, 2], [1, 26, 3], 'hair');
    g.fill([-6, 28, 0], [-3, 29, 2], 'hairLight');
    guardFace(g, 21);
    deepen(g, 'hair', 'hairDeep', .08, 26);
  } },

  locs: { draw(g) {
    scalp(g, { front: 21, side: Y0, back: Y0 });
    slab(g, 24, [-5, 5], [-5, 4], 2);
    slabs(g, [22, 24], [-5, 5], [-5, 3], 1);
    // Every loc is a 2 × 2 rope, alternating light and dark so each one reads alone.
    const tone = (i: number): Slot => (i % 2 ? 'hairDeep' : 'hairLight');
    // Their roots knot the crown.
    const crown: readonly (readonly [number, number])[] = [[-4, -4], [-1, -4], [2, -4], [-4, -1], [-1, -1], [2, -1], [-4, 2], [-1, 2], [2, 2]];
    for (const [i, [x, z]] of crown.entries()) g.fill([x, 25, z], [x + 2, 26, z + 2], tone(i + 1));
    // Down to the shoulders. Over the ears they fan out, each loc further back hanging a cell further out,
    // so from the front every rope shows its own face; from the crown they splay out to that line. Each
    // is a different length, kinks once, and every third wears a cuff.
    const ropes: readonly (readonly [number, number, number])[] = [
      // x, z where the rope hangs, how far it splays out from the head
      [-6, 1, 0], [-7, -2, 1], [-8, -5, 2], [-5, -7, 0], [-2, -7, 0], [1, -7, 0], [3, -7, 0], [6, -5, 2], [5, -2, 1], [4, 1, 0],
    ];
    for (const [i, [x, z, splay]] of ropes.entries()) {
      const end = 10 + Math.floor(cellHash(x, 0, z, 27) * 5);
      const kink = 14 + Math.floor(cellHash(x, 1, z, 27) * 3);
      const inward = x < 0 ? 1 : -1;
      for (let y = end; y < 24; y++) {
        const dx = inward * Math.max(0, Math.min(splay, y - 20)), dz = y >= kink && y < kink + 2 ? -1 : 0;
        g.fill([x + dx, y, z + dz], [x + dx + 2, y + 1, z + dz + 2], tone(i));
      }
      // A rounded tip: the end row is one cell.
      g.carve([x + (x < 0 ? 0 : 1), end, z], [x + (x < 0 ? 1 : 2), end + 1, z + 2]).carve([x, end, z], [x + 2, end + 1, z + 1]);
      if (i % 3 === 1) g.fill([x, kink + 3, z], [x + 2, kink + 4, z + 2], 'band');
    }
    // Short locs over the brow, and one falling beside each cheek.
    for (const [i, [x0, x1, y0]] of ([[-4, -2, 21], [-1, 1, 22], [2, 4, 21]] as const).entries()) g.fill([x0, y0, FRONT], [x1, 24, FRONT + 1], tone(i));
    g.fill([X0 - 1, 15, FACE_Z - 1], [X0, 23, Z1], 'hairDeep');
    g.fill([X1, 15, FACE_Z - 1], [X1 + 1, 23, Z1], 'hairLight');
    guardFace(g, 21);
    clearUnderChin(g);
    deepen(g, 'hair', 'hairDeep', .03, 27);
  } },

  braids: {
    draw(g) {
      scalp(g, { front: 21, side: 17, back: Y0 });
      // Neat and close, parted in the middle, pulled back behind the ears into two plaits.
      slab(g, 24, [-4, 4], [-4, 4], 1);
      slabs(g, [19, 24], [-5, 5], [-5, 2], 1);
      fringe(g, [[23, [[-4, -1], [1, 4]]], [22, [[-4, -2], [2, 4]]]]);
      g.paint([-1, 22, FACE_Z], [1, 24, Z1], 'scalp', ['hair']);
      g.carve([-1, 24, 0], [1, 25, 4]);
      g.paint([-1, 23, 0], [1, 24, FACE_Z], 'scalp', ['hair']);
      guardFace(g, 21);
      deepen(g, 'hair', 'hairDeep', .04, 28);
    },
    tied(g) {
      for (const x of [-6, 4]) {
        // Woven: each row's dark strand on the other side of the rope from the row above.
        for (let y = 12; y < 21; y++) for (let dx = 0; dx < 2; dx++) for (let z = -1; z < 1; z++) {
          g.set(x + dx, y, z, (dx + z + y) % 2 === 0 ? 'hair' : 'hairDeep');
        }
        g.fill([x, 11, -1], [x + 2, 12, 1], 'band');
        g.fill([x, 10, -1], [x + 2, 11, 1], 'hair');
        g.fill([x + (x < 0 ? -1 : 2), 9, -1], [x + (x < 0 ? 1 : 3), 10, 1], 'hair');
      }
    },
  },

  pigtails: {
    draw(g) {
      scalp(g, { front: 21, side: 18, back: Y0 });
      slab(g, 25, [-3, 3], [-3, 2], 1);
      slab(g, 24, [-4, 4], [-4, 4], 2);
      slabs(g, [19, 24], [-5, 5], [-5, 3], 2);
      // A centre parting, the fringe falling to each side.
      fringe(g, [[23, [[-4, -1], [1, 4]]], [22, [[-4, -1], [1, 4]]], [21, [[-4, -2], [2, 4]]]]);
      guardFace(g, 21);
      deepen(g, 'hair', 'hairDeep', .07, 29);
    },
    tied(g) {
      for (const side of [-1, 1]) {
        // Outward offsets from the side of the head, mirrored: o = 0 is the hair over the ear.
        const box = (o0: number, o1: number, y0: number, y1: number, z0: number, z1: number, slot: Slot = 'hair') => {
          const [a, b] = side < 0 ? [-4 - o1, -4 - o0] : [4 + o0, 4 + o1];
          g.fill([a, y0, z0], [b, y1, z1], slot);
        };
        // Tied low behind each ear; the bunch springs out from the band and hangs to a point at the shoulder.
        box(1, 2, 17, 19, -2, 0, 'band');
        box(2, 3, 19, 20, -2, 0);
        box(2, 4, 17, 19, -2, 0);
        box(2, 4, 17, 19, -3, -2);
        box(2, 4, 17, 19, 0, 1);
        box(3, 5, 15, 17, -3, 1);
        box(2, 3, 16, 17, -2, 0);
        box(3, 5, 14, 15, -2, 0);
        box(4, 5, 13, 14, -2, -1);
      }
      g.carve([-9, 16, -3], [-7, 17, -2]).carve([7, 16, 0], [9, 17, 1]);
      deepen(g, 'hair', 'hairDeep', .07, 29);
    },
  },

  'top-knot': {
    draw(g) {
      scalp(g, { front: 21, side: 18, back: 17, fade: 1 });
      // Everything pulled up tight toward the crown: close sides, no fringe, comb lines rising to the knot.
      slab(g, 24, [-4, 4], [-4, 4], 1);
      slabs(g, [22, 24], [-5, 5], [-5, 4], 2);
      for (const z of [-3, 0]) {
        streak(g, [X0 - 1, 22, z], [X0, 24, z + 1], 'hairLight');
        streak(g, [X1, 22, z], [X1 + 1, 24, z + 1], 'hairLight');
      }
      streak(g, [-3, 24, -2], [-2, 25, 3], 'hairLight');
      streak(g, [1, 24, -2], [2, 25, 3], 'hairLight');
      guardFace(g, 21);
      deepen(g, 'hair', 'hairDeep', .04, 30);
    },
    tied(g, brim) {
      if (brim !== undefined) {
        // Under a hat the knot comes down to the nape: a low bun behind the head, clear of any crown.
        ball(g, [0, 18, -7], 2.3);
        g.paint([-2, 16, -5], [3, 21, -4], 'band', ['hair']);
        deepen(g, 'hair', 'hairDeep', .06, 30);
        return;
      }
      // The knot: a round bun high on the crown, the band tucked under its widest row.
      ball(g, [0, 26, -1], 2.3);
      g.paint([-2, 25, -3], [3, 26, 2], 'band', ['hair']);
      g.fill([-1, 28, -1], [1, 29, 0], 'hairLight');
      deepen(g, 'hair', 'hairDeep', .06, 30);
    },
  },
};
