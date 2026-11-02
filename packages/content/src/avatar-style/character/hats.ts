import type { Slot, VoxelGrid } from './grid';
import { cellHash, slab } from './hair-kit';
import type { Hat } from './accessories';
import type { HatStyleId } from './recipe';

/*
 * The second shelf of hats: everyday ones in the base set (beret, bucket hat, top hat, flat cap, flower crown,
 * earflap hat) and the funny tier (frog, teapot, party cone, fish, chef's hat, propeller cap, antlers, nightcap,
 * toadstool, bee antennae). They follow the first shelf's rules: a hat sits on the top of the skull, comes down
 * to its brim line and is drawn over flattened hair; the person's right (-x) is the side the portrait shows, so
 * anything that leans, flops or sticks out does it that way. Colours come from the hat's own two dyes plus a
 * fixed white and ink for eyes, spots and pompoms.
 */

export type NewHatStyleId = Exclude<HatStyleId, 'cap' | 'cap-backwards' | 'beanie' | 'straw-hat' | 'pointed-hat'>;

/** A flat disc around the skull's centre line, overwriting what is there (a brim pressed onto the hair). */
function disc(g: VoxelGrid, y: number, radius: number, slot: Slot): void {
  const r = Math.ceil(radius);
  for (let x = -r - 1; x <= r; x++) for (let z = -r - 1; z <= r; z++) {
    if ((x + .5) ** 2 + (z + .5) ** 2 <= radius * radius) g.set(x, y, z, slot);
  }
}

/** Repaints a share of a slot's cells by a stable hash, optionally only in some rows. */
function speckle(g: VoxelGrid, from: Slot, to: Slot, share: number, salt: number, rows?: readonly [number, number]): void {
  for (const [[x, y, z], slot] of [...g.entries()]) {
    if (slot !== from || (rows && (y < rows[0] || y > rows[1]))) continue;
    if (cellHash(x, y, z, salt) < share) g.set(x, y, z, to);
  }
}

/** Repaints the cells of one slot in some rows by a rule on their position. */
function repaint(g: VoxelGrid, from: Slot, to: Slot, rule: (x: number, y: number, z: number) => boolean): void {
  for (const [[x, y, z], slot] of [...g.entries()]) if (slot === from && rule(x, y, z)) g.set(x, y, z, to);
}

const set = (g: VoxelGrid, list: readonly (readonly [number, number, number])[], slot: Slot) => { for (const [x, y, z] of list) g.set(x, y, z, slot); };

/**
 * A ring of cells hugging whatever is at a row (the hair, or the bare skull), just outside it: the empty cells
 * next to an occupied one, within reach of the head. Used by the flower crown, so it sits on any hair.
 */
function hug(g: VoxelGrid, y: number): [number, number][] {
  const ring: [number, number][] = [];
  for (let x = -10; x <= 9; x++) for (let z = -10; z <= 9; z++) {
    if (g.has(x, y, z)) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => g.has(x + dx!, y, z + dz!))) ring.push([x, z]);
  }
  return ring;
}

/**
 * A headband over the top of the head from ear to ear at z 0 and 1: on the hair's top surface, then down the
 * outside of the hair on both sides to the temple.
 */
function headband(g: VoxelGrid, slot: Slot): void {
  for (const z of [0, 1]) {
    // Over the top: one cell above the highest thing in each column.
    for (let x = -4; x < 4; x++) {
      let top = 23;
      for (let y = 23; y < 30; y++) if (g.has(x, y, z)) top = y;
      g.set(x, top + 1, z, slot);
    }
    // Down the sides: one cell outside the outermost thing in each row.
    for (const side of [-1, 1] as const) for (let y = 20; y <= 24; y++) {
      let edge = side < 0 ? -4 : 3;
      for (let n = 0; n < 8; n++) { const x = edge + side; if (g.has(x, y, z)) edge = x; else break; }
      g.set(edge + side, y, z, slot);
    }
  }
}

/** The highest band cell at a column, for rooting antlers and antennae on it. */
function bandTop(g: VoxelGrid, x: number, slot: Slot): number {
  let top = 24;
  for (let y = 23; y < 31; y++) if (g.get(x, y, 0) === slot) top = y;
  return top;
}

export const NEW_HATS: Record<NewHatStyleId, Hat> = {
  beret: {
    brim: 22,
    draw(g) {
      // A tight band, then a soft felt pancake pulled down over the person's right, with a stalk on top.
      slab(g, 22, [-5, 5], [-5, 5], 1, 'hatDeep');
      slab(g, 23, [-6, 5], [-6, 5], 2, 'hat');
      slab(g, 24, [-7, 5], [-6, 5], 2, 'hat');
      slab(g, 25, [-6, 3], [-5, 4], 2, 'hat');
      g.set(-7, 23, -1, 'hat').set(-7, 23, 0, 'hat');
      g.set(-2, 26, -1, 'hatDeep');
      speckle(g, 'hat', 'hatDeep', .08, 51);
    },
  },
  'bucket-hat': {
    brim: 21,
    band: [22, 0],
    draw(g) {
      // A floppy brim all round that turns down at its edge, a stitched band, a round soft crown.
      slab(g, 21, [-7, 7], [-7, 7], 3, 'hat');
      repaint(g, 'hat', 'hatDeep', (x, y, z) => y === 21 && (x + .5) ** 2 + (z + .5) ** 2 > 5.6 ** 2);
      slab(g, 22, [-5, 5], [-5, 5], 1, 'hatTrim');
      for (const y of [23, 24]) slab(g, y, [-5, 5], [-5, 5], 1, 'hat');
      slab(g, 25, [-4, 4], [-4, 4], 1, 'hat');
      repaint(g, 'hatTrim', 'hatTrimDeep', (x, _y, z) => (x + z) % 3 === 0);
    },
  },
  'top-hat': {
    brim: 22,
    band: [23, 0],
    draw(g) {
      // A flat round brim, a ribbon band, a tall straight crown with a slightly flared top.
      disc(g, 22, 6.2, 'hat');
      slab(g, 23, [-5, 5], [-5, 5], 1, 'hatTrim');
      for (let y = 24; y <= 27; y++) slab(g, y, [-4, 4], [-4, 4], 1, 'hat');
      slab(g, 28, [-5, 5], [-5, 5], 2, 'hat');
      slab(g, 29, [-4, 4], [-4, 4], 1, 'hatDeep');
      repaint(g, 'hat', 'hatDeep', (x, y, z) => y === 22 && (x + .5) ** 2 + (z + .5) ** 2 > 5.3 ** 2);
    },
  },
  'flat-cap': {
    brim: 22,
    band: [23, 0],
    draw(g) {
      // A low tweed cap: the crown slopes forward over a short stiff peak, with a button on top.
      slab(g, 22, [-5, 5], [-5, 5], 1, 'hat');
      slab(g, 23, [-5, 5], [-5, 6], 1, 'hat');
      slab(g, 24, [-5, 5], [-4, 7], 2, 'hat');
      for (let x = -4; x < 4; x++) g.set(x, 22, 5, 'hatDeep');
      for (let x = -3; x < 3; x++) g.set(x, 22, 6, 'hatDeep');
      speckle(g, 'hat', 'hatTrim', .2, 53);
      g.set(-1, 25, 1, 'hatDeep');
    },
  },
  'flower-crown': {
    brim: 26,
    band: [23, 0],
    draw(g) {
      // A green vine round the head at the brow, on top of whatever hair is there, with blooms all round:
      // two colours and white, each with a yellow heart where there is room for one.
      const ring = hug(g, 23).sort(([ax, az], [bx, bz]) => Math.atan2(ax + .5, az + .5) - Math.atan2(bx + .5, bz + .5));
      for (const [x, z] of ring) g.set(x, 23, z, 'hat');
      ring.forEach(([x, z], i) => {
        if (i % 3 !== 0) return;
        const bloom: Slot = (i / 3) % 3 === 0 ? 'hatTrim' : (i / 3) % 3 === 1 ? 'hatWhite' : 'hatTrim';
        g.set(x, 23, z, 'petalHeart');
        if (!g.has(x, 24, z)) g.set(x, 24, z, bloom);
        if (!g.has(x, 22, z)) g.set(x, 22, z, bloom);
      });
    },
  },
  'earflap-hat': {
    brim: 21,
    draw(g) {
      // A trapper's hat: a fleece cuff, a quilted crown, flaps down over the ears, a little tie under each.
      slab(g, 21, [-5, 5], [-5, 5], 1, 'hatTrim');
      for (const y of [22, 23]) slab(g, y, [-5, 5], [-5, 5], 1, 'hat');
      slab(g, 24, [-5, 5], [-5, 5], 2, 'hat');
      slab(g, 25, [-4, 4], [-4, 4], 1, 'hat');
      repaint(g, 'hat', 'hatDeep', (x, y, z) => y >= 24 && (x === -1 || z === -1));
      for (const side of [-1, 1] as const) {
        // Outside whatever is at the ear, so the flap lies over a bob instead of inside it.
        let edge = side < 0 ? -4 : 3;
        for (const [[x, y, z]] of g.entries()) if (y >= 17 && y <= 20 && z >= -2 && z <= 1 && (side < 0 ? x < edge : x > edge)) edge = x;
        const x = edge + side;
        for (let y = 17; y <= 20; y++) for (let z = -2; z <= 1; z++) g.set(x, y, z, y === 17 ? 'hatTrim' : 'hat');
        g.set(x, 16, 0, 'hatTrimDeep');
      }
    },
  },
  'frog-hat': {
    brim: 21,
    draw(g) {
      // A green knit cap with a frog's wide smile across the brow and two big eyes on top.
      for (const y of [21, 22, 23]) slab(g, y, [-5, 5], [-5, 5], 1, 'hat');
      slab(g, 24, [-5, 5], [-5, 5], 2, 'hat');
      slab(g, 25, [-4, 4], [-4, 4], 1, 'hat');
      for (let x = -3; x < 3; x++) g.set(x, 22, 4, 'hatDeep');
      g.set(-4, 23, 4, 'hatDeep').set(3, 23, 4, 'hatDeep');
      for (const x0 of [-4, 2]) {
        g.fill([x0, 26, 0], [x0 + 2, 28, 2], 'hatWhite');
        g.fill([x0, 26, -1], [x0 + 2, 27, 0], 'hat');
      }
      g.set(-3, 26, 1, 'hatInk').set(2, 26, 1, 'hatInk');
      speckle(g, 'hat', 'hatDeep', .08, 57, [23, 25]);
    },
  },
  'teapot-hat': {
    brim: 22,
    draw(g) {
      // A round china pot with a painted band of dots, a lid and a knob, the spout out to the person's right.
      slab(g, 22, [-5, 5], [-5, 5], 1, 'hat');
      slab(g, 23, [-6, 6], [-6, 6], 2, 'hat');
      slab(g, 24, [-6, 6], [-6, 6], 2, 'hatTrim');
      slab(g, 25, [-5, 5], [-5, 5], 1, 'hat');
      slab(g, 26, [-3, 3], [-3, 3], 0, 'hatTrim');
      slab(g, 27, [-1, 1], [-1, 1], 0, 'hatTrim');
      repaint(g, 'hatTrim', 'hatWhite', (x, y, z) => y === 24 && (x + z) % 2 === 0);
      set(g, [[-7, 23, 0], [-7, 24, 0], [-8, 24, 0], [-8, 25, 0], [-9, 25, 0], [-9, 26, 0]], 'hat');
      set(g, [[6, 23, 0], [7, 23, 0], [7, 24, 0], [7, 25, 0], [6, 25, 0]], 'hat');
    },
  },
  'party-cone': {
    brim: 24,
    draw(g) {
      // A striped cardboard cone, a little askew, with a white pompom.
      slab(g, 24, [-3, 3], [-3, 3], 1, 'hat');
      slab(g, 25, [-3, 3], [-3, 3], 2, 'hatTrim');
      slab(g, 26, [-3, 2], [-2, 2], 1, 'hat');
      slab(g, 27, [-3, 1], [-2, 2], 1, 'hatTrim');
      slab(g, 28, [-2, 0], [-1, 1], 0, 'hat');
      slab(g, 29, [-2, 0], [-1, 1], 0, 'hatTrim');
      slab(g, 30, [-3, 1], [-2, 2], 1, 'hatWhite');
      slab(g, 31, [-2, 0], [-1, 1], 0, 'hatWhite');
    },
  },
  'fish-hat': {
    brim: 24,
    draw(g) {
      // A fat fish lying on the head nose to the front, a fin up, an eye each side, its tail flipped up behind.
      slab(g, 24, [-3, 3], [-5, 5], 2, 'hatTrim');
      slab(g, 25, [-3, 3], [-5, 5], 2, 'hat');
      slab(g, 26, [-2, 2], [-4, 4], 1, 'hat');
      set(g, [[-1, 27, -1], [0, 27, -1], [-1, 27, 0], [0, 27, 0], [-1, 28, -1], [0, 28, -1]], 'hatDeep');
      set(g, [[-3, 25, 2], [2, 25, 2]], 'hatWhite');
      set(g, [[-4, 25, 2], [3, 25, 2]], 'hatInk');
      set(g, [[-1, 24, 4], [0, 24, 4]], 'hatDeep');
      set(g, [[-1, 25, -6], [0, 25, -6], [-1, 26, -6], [0, 26, -6], [-1, 24, -7], [0, 24, -7], [-1, 27, -7], [0, 27, -7], [-1, 28, -7], [0, 28, -7]], 'hatDeep');
      speckle(g, 'hat', 'hatDeep', .1, 59);
    },
  },
  'chef-toque': {
    brim: 22,
    draw(g) {
      // A pleated band and a tall puff that mushrooms out at the top.
      for (const y of [22, 23]) slab(g, y, [-5, 5], [-5, 5], 1, 'hat');
      repaint(g, 'hat', 'hatDeep', (x, y, z) => y <= 23 && (x + z) % 2 !== 0);
      for (const y of [24, 25]) slab(g, y, [-5, 5], [-5, 5], 1, 'hat');
      slab(g, 26, [-6, 6], [-6, 6], 2, 'hat');
      slab(g, 27, [-6, 6], [-6, 6], 2, 'hat');
      slab(g, 28, [-6, 6], [-6, 6], 3, 'hat');
      slab(g, 29, [-4, 4], [-4, 4], 2, 'hat');
      repaint(g, 'hat', 'hatDeep', (x, y, z) => y >= 24 && y <= 26 && (x - z + 99) % 3 === 0 && Math.abs(x + .5) + Math.abs(z + .5) > 5);
    },
  },
  'propeller-cap': {
    brim: 22,
    draw(g) {
      // A beanie cap in four panels of two colours, a white hub and a propeller turned to the camera.
      for (const y of [22, 23]) slab(g, y, [-5, 5], [-5, 5], 1, 'hat');
      slab(g, 24, [-5, 5], [-5, 5], 2, 'hat');
      slab(g, 25, [-4, 4], [-4, 4], 1, 'hat');
      repaint(g, 'hat', 'hatTrim', (x, _y, z) => (x < 0) !== (z < 0));
      g.fill([-1, 26, -1], [1, 27, 1], 'hatWhite');
      for (let x = -6; x <= -2; x++) g.set(x, 27, x === -6 ? 1 : 0, 'hatTrim');
      for (let x = 1; x <= 5; x++) g.set(x, 27, x === 5 ? -1 : 0, 'hat');
      g.set(-1, 27, 0, 'hatWhite').set(0, 27, 0, 'hatWhite');
    },
  },
  'antler-band': {
    brim: 25,
    draw(g) {
      // A felt headband with two soft branching antlers standing up from it.
      headband(g, 'hat');
      for (const antler of [[-3, 0], [2, 1]] as const) {
        const [x, side] = antler, s = side ? 1 : -1, y = bandTop(g, x, 'hat') + 1;
        const cells: [number, number, number][] = [
          [x, y, 0], [x, y, 1], [x, y + 1, 0], [x, y + 1, 1],
          [x + s, y + 2, 0], [x + 2 * s, y + 3, 0], [x, y + 2, 0], [x, y + 3, 0], [x + 2 * s, y + 2, 0], [x + 3 * s, y + 2, 0],
        ];
        set(g, cells, 'hatTrim');
        g.set(x + 2 * s, y + 4, 0, 'hatTrimDeep').set(x, y + 4, 0, 'hatTrimDeep');
      }
    },
  },
  nightcap: {
    brim: 21,
    draw(g) {
      // A white cuff, then a long striped stocking cap that flops over behind on the person's right,
      // a white pompom at its tip.
      for (const y of [21, 22]) slab(g, y, [-5, 5], [-5, 5], 1, 'hatWhite');
      slab(g, 23, [-5, 5], [-5, 5], 1, 'hat');
      slab(g, 24, [-5, 5], [-5, 5], 2, 'hatTrim');
      slab(g, 25, [-5, 4], [-5, 4], 1, 'hat');
      slab(g, 26, [-5, 2], [-5, 2], 1, 'hatTrim');
      slab(g, 27, [-6, 0], [-6, 0], 1, 'hat');
      g.fill([-7, 26, -6], [-4, 27, -4], 'hatTrim');
      g.fill([-8, 25, -6], [-6, 26, -4], 'hat');
      g.fill([-9, 23, -6], [-7, 25, -4], 'hatWhite');
    },
  },
  'toadstool-cap': {
    brim: 22,
    draw(g) {
      // A wide round toadstool cap with white spots, its pale gills showing under the rim.
      disc(g, 22, 7.2, 'hatTrim');
      slab(g, 23, [-7, 7], [-7, 7], 3, 'hat');
      slab(g, 24, [-6, 6], [-6, 6], 2, 'hat');
      slab(g, 25, [-5, 5], [-5, 5], 2, 'hat');
      slab(g, 26, [-3, 3], [-3, 3], 1, 'hat');
      repaint(g, 'hatTrim', 'hatTrimDeep', (x, y, z) => y === 22 && (x + z) % 2 === 0);
      const spots: [number, number, number][] = [
        [-7, 23, 0], [-6, 23, 3], [-5, 24, -3], [-2, 26, 1], [1, 26, -2], [-6, 24, 1], [2, 25, 3], [5, 24, -1], [-1, 25, 4], [-4, 25, 2], [3, 23, -6], [-3, 24, -5], [6, 23, 2],
      ];
      for (const [x, y, z] of spots) if (g.get(x, y, z) === 'hat') g.set(x, y, z, 'hatWhite');
    },
  },
  'bee-antennae': {
    brim: 25,
    draw(g) {
      // A headband with two wobbly ink stalks ending in fat little balls.
      headband(g, 'hat');
      for (const [x, s] of [[-3, -1], [2, 1]] as const) {
        const y = bandTop(g, x, 'hat') + 1;
        set(g, [[x, y, 0], [x, y + 1, 0], [x + s, y + 2, 0], [x + s, y + 3, 0]], 'hatInk');
        const bx = s < 0 ? x - 2 : x + 1;
        g.fill([bx, y + 4, 0], [bx + 2, y + 6, 2], 'hatTrim');
        g.set(s < 0 ? bx : bx + 1, y + 5, 1, 'hatWhite');
      }
    },
  },
};
