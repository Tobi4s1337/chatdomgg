import type { Slot, VoxelGrid } from './grid';
import { EYE_ROW, FACE_Z, SKULL } from './head';
import { FRONT, HAIR_SLOTS, cellHash, slab, type Span } from './hair-kit';
import type { Hex } from './colour';
import { NEW_HATS } from './hats';
import type { EarringStyleId, EyeSpacing, GlassesStyleId, HatStyleId } from './recipe';

/*
 * Accessories with personality (spec L4): hats, glasses, earrings and a flower, all on the avatar lattice.
 * Hats sit on the frozen hat socket (the top of the skull, y 24) and come down to a brim line; the hair under
 * the crown is flattened away and the rest of the hair shows below it, as hair does under a real cap. Glasses
 * stand one cell proud of the face with see-through lenses, so the eye blocks still read behind them.
 */

const X0: number = SKULL.x[0], X1: number = SKULL.x[1], Y0: number = SKULL.y[0], Z0: number = SKULL.z[0];

/** A flat disc of cells around the skull's centre line. */
function disc(g: VoxelGrid, y: number, radius: number, slot: Slot): void {
  const r = Math.ceil(radius);
  for (let x = -r - 1; x <= r; x++) for (let z = -r - 1; z <= r; z++) {
    if ((x + .5) ** 2 + (z + .5) ** 2 <= radius * radius) g.set(x, y, z, slot);
  }
}

/** Repaints a share of a slot's cells in another, by a stable hash: straw weave, knit, felt. */
function speckle(g: VoxelGrid, from: Slot, to: Slot, share: number, salt: number): void {
  for (const [[x, y, z], slot] of [...g.entries()]) if (slot === from && cellHash(x, y, z, salt) < share) g.set(x, y, z, to);
}

export interface Hat {
  /** The lowest row the hat covers: hair at and above it, outside the skull, is under the hat. */
  readonly brim: number;
  /** Where a tucked flower sits, when the hat has a band for it: [y, z] on the person's right side. */
  readonly band?: readonly [number, number];
  draw(g: VoxelGrid): void;
}

/**
 * A six-panel crown: three straight rows one cell proud of the skull, then a flat, rounded top, the way a
 * real cap keeps its shape. A darker seam runs over the top from front to back.
 */
function capCrown(g: VoxelGrid): void {
  for (const y of [22, 23]) slab(g, y, [-5, 5], [-5, 5], 1, 'hat');
  slab(g, 24, [-5, 5], [-5, 5], 2, 'hat');
  slab(g, 25, [-4, 4], [-4, 4], 1, 'hat');
  for (let z = -3; z < 3; z++) if (g.get(-1, 25, z) === 'hat') g.set(-1, 25, z, 'hatDeep');
}

const HATS: Record<HatStyleId, Hat> = {
  cap: {
    brim: 22,
    draw(g) {
      capCrown(g);
      // The bill, three cells out over the eyes, its front corners rounded off; a patch on the front panel.
      for (let x = -4; x < 4; x++) for (let z = FRONT + 1; z < FRONT + 4; z++) {
        if (z === FRONT + 3 && (x === -4 || x === 3)) continue;
        g.set(x, 22, z, z === FRONT + 1 ? 'hatTrimDeep' : 'hatTrim');
      }
      g.fill([-2, 23, FRONT], [1, 25, FRONT + 1], 'hatTrim');
    },
  },
  'cap-backwards': {
    brim: 22,
    draw(g) {
      capCrown(g);
      // The bill out over the back, turned a little toward the person's right so it shows past the head.
      for (const [z, x0, x1] of [[-6, -6, 2], [-7, -7, 1], [-8, -7, -1]] as const) for (let x = x0; x < x1; x++) g.set(x, 22, z, z === -6 ? 'hatTrimDeep' : 'hatTrim');
      // The snapback opening at the front: a small window of hair over a strap in the crown's own shade,
      // so it never reads as a second face on the cap.
      g.fill([-2, 22, FRONT], [2, 23, FRONT + 1], 'hatDeep');
      g.fill([-1, 23, FRONT], [1, 24, FRONT + 1], 'hair');
    },
  },
  beanie: {
    brim: 21,
    draw(g) {
      // A ribbed cuff turned up over the brow, the knit above it, a pompom on top.
      for (const y of [21, 22]) slab(g, y, [-5, 5], [-5, 5], 1, 'hatTrim');
      for (const [[x, y, z], slot] of [...g.entries()]) if (slot === 'hatTrim' && y <= 22 && (x + z) % 2 !== 0) g.set(x, y, z, 'hatTrimDeep');
      slab(g, 23, [-5, 5], [-5, 5], 1, 'hat');
      slab(g, 24, [-5, 5], [-5, 5], 2, 'hat');
      slab(g, 25, [-4, 4], [-4, 4], 1, 'hat');
      slab(g, 26, [-3, 3], [-3, 3], 1, 'hat');
      speckle(g, 'hat', 'hatDeep', .14, 31);
      // The pompom: a fat 4-cell ball with its corners knocked off.
      slab(g, 27, [-2, 2], [-2, 2], 1, 'hatTrim');
      slab(g, 28, [-2, 2], [-2, 2], 0, 'hatTrim');
      slab(g, 29, [-2, 2], [-2, 2], 1, 'hatTrim');
    },
  },
  'straw-hat': {
    brim: 22,
    band: [24, 0],
    draw(g) {
      // A wide brim, a coloured band and a low crown, woven in two tones of straw.
      disc(g, 22, 8.1, 'hat');
      slab(g, 23, [-5, 5], [-5, 5], 1, 'hatTrim');
      slab(g, 24, [-5, 5], [-5, 5], 1, 'hat');
      slab(g, 25, [-5, 5], [-5, 5], 3, 'hat');
      // The brim's rim is one row darker, the way a woven edge is bound.
      for (const [[x, y, z], slot] of [...g.entries()]) if (slot === 'hat' && y === 22 && (x + .5) ** 2 + (z + .5) ** 2 > 7.1 ** 2) g.set(x, y, z, 'hatDeep');
      speckle(g, 'hat', 'hatDeep', .16, 37);
      for (const [[x, y, z], slot] of [...g.entries()]) if (slot === 'hatTrim' && cellHash(x, y, z, 38) < .2) g.set(x, y, z, 'hatTrimDeep');
    },
  },
  'pointed-hat': {
    brim: 22,
    band: [24, 0],
    draw(g) {
      // A wizard-ish cone on a round brim. It narrows fast, leans back and over to the person's right as it
      // rises, and the tip flops down on that side, so it stays in the portrait frame and reads at 128 px.
      disc(g, 22, 6.7, 'hat');
      slab(g, 23, [-5, 5], [-5, 5], 2, 'hatTrim');
      slab(g, 24, [-4, 4], [-4, 4], 1, 'hat');
      slab(g, 25, [-4, 3], [-4, 3], 1, 'hat');
      slab(g, 26, [-4, 2], [-4, 2], 1, 'hat');
      slab(g, 27, [-4, 0], [-4, 0], 0, 'hat');
      g.fill([-5, 28, -3], [-1, 29, -1], 'hat');
      g.fill([-7, 29, -3], [-3, 30, -1], 'hat');
      g.fill([-8, 28, -3], [-6, 29, -1], 'hat');
      g.fill([-8, 27, -3], [-7, 28, -2], 'hatTrim');
      speckle(g, 'hat', 'hatDeep', .08, 41);
    },
  },
  ...NEW_HATS,
};

/** The rows a hat starts at, for tests and the builder. */
export const hatBrim = (style: HatStyleId): number => HATS[style].brim;

/** A hat style's shape, for anything that wears hats the same way (the forged hat in `earned-draw.ts`). */
export const hatShape = (style: HatStyleId): Hat => HATS[style];

/** Flattens the hair under the crown, then draws the hat. Tied hair is laid over afterwards. */
export function drawHat(g: VoxelGrid, style: HatStyleId | Hat): void {
  const hat = typeof style === 'string' ? HATS[style] : style;
  const inSkull = (x: number, y: number, z: number) => x >= X0 && x < X1 && y < SKULL.y[1] && z >= Z0 && z < SKULL.z[1];
  for (const [[x, y, z], slot] of [...g.entries()]) {
    if (y < hat.brim || !HAIR_SLOTS.includes(slot)) continue;
    if (inSkull(x, y, z)) g.set(x, y, z, 'hair');
    else g.delete(x, y, z);
  }
  hat.draw(g);
}

/** Lens columns on the face, per eye spacing: the eye and the cell outside it. */
const LENSES: Record<EyeSpacing, readonly (readonly [number, number])[]> = { set: [[1, 2], [5, 6]], wide: [[0, 1], [6, 7]] };
const LENS_ROWS: Span = [EYE_ROW, EYE_ROW + 2];

export function drawGlasses(g: VoxelGrid, style: GlassesStyleId, spacing: EyeSpacing): void {
  if (style !== 'round' && style !== 'square' && style !== 'goggles') return drawShapedGlasses(g, style, spacing);
  const at = (col: number, row: number, z: number = FRONT, slot: Slot = 'frame') => g.set(X0 + col, Y0 + row, z, slot);
  const lens = LENSES[spacing];
  const [l, r] = [lens[0]!, lens[1]!];
  const top = LENS_ROWS[1], outer = spacing === 'set';
  for (const [a, b] of lens) for (let c = a; c <= b; c++) for (let row = LENS_ROWS[0]; row < top; row++) {
    at(c, row, FRONT, 'lens');
    if (style === 'goggles') at(c, row, FRONT + 1, 'lens');
  }
  if (style === 'round') {
    // Thin wire rings round each lens with the corners left open: at this size that is what reads round.
    // A side that falls off the face plane wraps onto the side of the head.
    const side = (c: number, row: number) => (c < 0 ? g.set(X0 - 1, Y0 + row, FACE_Z, 'frame') : c > 7 ? g.set(X1, Y0 + row, FACE_Z, 'frame') : at(c, row));
    for (const [a, b] of lens) {
      for (let c = a; c <= b; c++) { at(c, top); at(c, LENS_ROWS[0] - 1); }
      for (let row = LENS_ROWS[0]; row < top; row++) { side(a - 1, row); side(b + 1, row); }
    }
  } else {
    // A heavy brow bar across both lenses and the bridge, corners and all, and the outer sides.
    for (let c = outer ? 0 : l[0]; c <= (outer ? 7 : r[1]); c++) at(c, top);
    if (outer) for (let row = LENS_ROWS[0]; row < top; row++) { at(0, row); at(7, row); }
    for (let c = l[1] + 1; c < r[0]; c++) at(c, EYE_ROW + 1);
    if (style === 'goggles') for (let c = l[1] + 1; c < r[0]; c++) at(c, EYE_ROW);
  }
  // Temples back along the sides of the head, under any hair there; for goggles, the strap all the way
  // round over the hair.
  const temple = style === 'round' ? top : EYE_ROW + 1;
  for (const x of [X0 - 1, X1]) {
    if (!outer) g.set(x, Y0 + temple, FACE_Z, 'frame');
    for (let z = style === 'goggles' ? Z0 - 1 : 1; z < FACE_Z + (outer ? 1 : 0); z++) {
      if (style === 'goggles') { g.set(x, Y0 + temple, z, 'frame'); g.set(x, Y0 + temple + 1, z, 'frame'); }
      else if (!g.has(x, Y0 + temple, z)) g.set(x, Y0 + temple, z, 'frame');
    }
  }
  if (style === 'goggles') for (let x = X0 - 1; x <= X1; x++) for (const row of [temple, temple + 1]) g.set(x, Y0 + row, Z0 - 1, 'frame');
}

/**
 * Earrings hang beside the jaw on both sides, just outside whatever is at the ear: skin or hair. Cells are
 * [y, z] in the earring's metal, or [y, z, slot] for a pearl, a tassel's threads or a cherry and its stalk.
 */
type EarringCell = readonly [number, number] | readonly [number, number, Slot];
const EARRINGS: Record<EarringStyleId, readonly EarringCell[]> = {
  stud: [[17, 0]],
  hoop: [[16, 0], [15, -1], [15, 1], [14, 0]],
  drop: [[17, 0], [16, 0], [15, 0]],
  // A thin crescent moon, horns to the front.
  crescent: [[17, 0], [16, -1], [15, -1], [14, 0], [17, 1], [14, 1]],
  // A wire and a fat pearl.
  pearl: [[17, 0], [16, 0], [15, 0, 'bead'], [15, 1, 'bead'], [14, 0, 'bead'], [14, 1, 'bead']],
  // A metal cap and a silk tassel.
  tassel: [[17, 0], [16, 0], [15, -1, 'bead'], [15, 0, 'bead'], [15, 1, 'bead'], [14, -1, 'bead'], [14, 1, 'bead'], [13, 0, 'bead']],
  // Two cherries on forked stalks.
  cherries: [[17, 0, 'leaf'], [16, -1, 'leaf'], [16, 1, 'leaf'], [15, -1, 'bead'], [15, 1, 'bead']],
};

export function drawEarrings(g: VoxelGrid, style: EarringStyleId): void {
  const cells = EARRINGS[style];
  for (const side of [-1, 1] as const) {
    // The outermost cell on this side over the earring's rows, so a stud is never buried in a bob.
    let edge = side < 0 ? X0 : X1 - 1;
    for (const [[x, y, z]] of g.entries()) if (cells.some(([cy, cz]) => cy === y && cz === z) && (side < 0 ? x < edge : x > edge)) edge = x;
    for (const [y, z, slot = 'metal'] of cells) g.set(edge + side, y, z, slot);
  }
}

/** The fixed colour of an earring's second material: a pearl, a red silk tassel, a cherry. */
export const EARRING_BEADS: Partial<Record<EarringStyleId, Hex>> = { pearl: '#f1ece2', tassel: '#d8344a', cherries: '#d3202a' };

/**
 * Glasses with a shape of their own, drawn on the face plane per eye: dark shades across the eyes, half-moon
 * readers under them, heart and star frames round them, and a monocle on the person's right eye. The eye itself
 * is only ever behind glass, never behind frame.
 */
function drawShapedGlasses(g: VoxelGrid, style: Exclude<GlassesStyleId, 'round' | 'square' | 'goggles'>, spacing: EyeSpacing): void {
  // A frame cell that falls off the face plane wraps onto the side of the head.
  const at = (col: number, row: number, slot: Slot = 'frame') => {
    if (col < 0) g.set(X0 - 1, Y0 + row, FACE_Z, slot);
    else if (col > 7) g.set(X1, Y0 + row, FACE_Z, slot);
    else g.set(X0 + col, Y0 + row, FRONT, slot);
  };
  const eyes = spacing === 'set' ? [2, 5] as const : [1, 6] as const;
  const outer = (a: number) => (a < 4 ? a - 1 : a + 1);
  const r0 = EYE_ROW, r1 = EYE_ROW + 1;
  let temple = r1;
  if (style === 'shades') {
    // One dark band of glass across both eyes, a bar over it, the bridge between.
    for (let c = 0; c <= 7; c++) for (const row of [r0, r1]) at(c, row, 'lens');
    for (let c = 0; c <= 7; c++) at(c, r1 + 1);
    for (let c = eyes[0] + 2; c <= eyes[1] - 2; c++) at(c, r1);
    temple = r1 + 1;
  } else if (style === 'half-moon') {
    // Reading glasses: lens over the lower half of each eye, a rim under them, peered over.
    for (const a of eyes) {
      const [c0, c1] = [Math.min(a, outer(a)), Math.max(a, outer(a))];
      for (let c = c0; c <= c1; c++) { at(c, r0, 'lens'); at(c, r0 - 1); }
      at(c0 - 1, r0); at(c1 + 1, r0);
    }
    temple = r0;
  } else if (style === 'heart') {
    // Two lobes over each eye with the notch between, sides, and the point under the eye.
    for (const a of eyes) {
      at(a, r0, 'lens'); at(a, r1, 'lens');
      for (const c of [a - 1, a + 1]) { at(c, r1 + 1); at(c, r1); }
      at(a, r0 - 1);
    }
  } else if (style === 'star') {
    // A five-pointed star round each eye: the top point, two arms, two feet.
    for (const a of eyes) {
      at(a, r0, 'lens'); at(a, r1, 'lens');
      at(a, r1 + 1);
      for (const c of [a - 1, a + 1]) { at(c, r1); at(c, r0 - 1); }
    }
  } else {
    // A monocle on the person's right eye: a ring of glass three cells wide, its chain down the cheek.
    const a = eyes[0];
    for (let c = a - 1; c <= a + 1; c++) { at(c, r0, 'lens'); at(c, r1, 'lens'); at(c, r1 + 1); at(c, r0 - 1); }
    at(a - 2, r0); at(a - 2, r1); at(a + 2, r0); at(a + 2, r1);
    for (const [x, y, z] of [[X0 - 1, Y0 + r0 - 1, FACE_Z - 1], [X0 - 1, Y0 + r0 - 2, FACE_Z - 2], [X0 - 1, Y0 + r0 - 3, FACE_Z - 3]] as const) {
      if (!g.has(x, y, z)) g.set(x, y, z, 'metal');
    }
    return;
  }
  // The bridge: on the lens row for readers, a row up for the others.
  if (style !== 'shades') for (let c = eyes[0] + (spacing === 'set' ? 1 : 2); c < eyes[1] - (spacing === 'set' ? 0 : 1); c++) at(c, style === 'half-moon' ? r0 : r1);
  // Temples back along the sides of the head, under any hair there.
  for (const x of [X0 - 1, X1]) for (let z = 1; z <= FACE_Z; z++) if (!g.has(x, Y0 + temple, z)) g.set(x, Y0 + temple, z, 'frame');
}

/**
 * A flower over the ear on the person's right (the side the portrait shows), facing out: a heart, four
 * petals, a leaf. With a banded hat it is tucked into the band; otherwise it sits on the hair's outer surface.
 */
export function drawFlower(g: VoxelGrid, worn: HatStyleId | Hat | null): void {
  const hat = typeof worn === 'string' ? HATS[worn] : worn;
  const [yc, zc] = hat?.band ?? [hat ? hat.brim - 1 : 21, 1];
  let side = X0;
  for (const [[x, y, z]] of g.entries()) if (Math.abs(y - yc) <= 1 && Math.abs(z - zc) <= 1 && x < side) side = x;
  const x = side - 1;
  for (const [dy, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) g.set(x, yc + dy, zc + dz, 'petal');
  g.set(x, yc, zc, 'petalHeart');
  g.set(x - 1, yc, zc, 'petalHeart');
  g.set(x, yc - 1, zc - 1, 'leaf');
  g.set(x, yc - 2, zc - 1, 'leaf');
}
