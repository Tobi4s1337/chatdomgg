import type { Hex } from './colour';
import type { Cell, Slot, VoxelGrid } from './grid';
import type { HeldStyleId } from './recipe';

/*
 * Held toys (the funny tier): small storybook things carried in the person's right hand, the side the portrait
 * shows. The arm hangs at x -4 with the hand in rows 7 and 8; a toy is gripped in the cells in front of the
 * fist and stands clear of everything else the citizen can wear: in front of the forearm at x -4, beside the
 * leg below the hand, and above it only from z 3 forward, where no hair, earring, pin or garment ever reaches.
 * Every toy cell is a held slot, so the runtime moves the whole toy with the hand bone.
 */

/** The fist and the cuff round it: a grip may pass through these cells (a robe's wide cuff is one). */
export const HAND_ZONE = { x: [-4, -3], y: [7, 10], z: [-2, 2] } as const;

/** Each toy's fixed colours besides the one the person chooses (`held`): trims, wood, foam, eyes, shine. */
export interface HeldPalette { readonly colour: Hex; readonly two: Hex; readonly three: Hex; readonly glow: Hex }

export const HELD_PALETTES: Readonly<Record<HeldStyleId, HeldPalette>> = {
  'rubber-duck': { colour: '#ffd23a', two: '#f58a1f', three: '#f58a1f', glow: '#fff6c8' },
  'paper-lantern': { colour: '#d3202a', two: '#3a2a20', three: '#e8b54a', glow: '#ffd98a' },
  balloon: { colour: '#ef4b2c', two: '#f3f1ee', three: '#f3f1ee', glow: '#ffffff' },
  teddy: { colour: '#a8693a', two: '#ecd3a8', three: '#ecd3a8', glow: '#ecd3a8' },
  'wooden-sword': { colour: '#d9b27a', two: '#6a3f22', three: '#8a5a32', glow: '#f1d39a' },
  bouquet: { colour: '#ff6fa8', two: '#4fa83a', three: '#f3ead2', glow: '#ffd23a' },
  'cider-mug': { colour: '#b07a45', two: '#fbf3dc', three: '#5a5f66', glow: '#fbf3dc' },
  baguette: { colour: '#d9a05b', two: '#f1d39a', three: '#a8693a', glow: '#f1d39a' },
  'paper-windmill': { colour: '#43b6ec', two: '#c9a06a', three: '#f6d23c', glow: '#f3f1ee' },
  'frog-plush': { colour: '#5fae4a', two: '#c8e59a', three: '#2f6b2a', glow: '#c8e59a' },
  cupcake: { colour: '#ff9ccc', two: '#e6b73a', three: '#d3202a', glow: '#ffffff' },
  'ice-cream': { colour: '#ff9ccc', two: '#d9a05b', three: '#a8693a', glow: '#f6ead0' },
  storybook: { colour: '#2d5fd8', two: '#f6efd9', three: '#e8b54a', glow: '#f6efd9' },
  'star-wand': { colour: '#ffd23a', two: '#f3f1ee', three: '#ef6fae', glow: '#fff6c8' },
};

type Put = (x: number, y: number, z: number, slot: Slot) => void;

/** Inclusive box helper. */
const box = (put: Put, [x0, x1]: readonly [number, number], [y0, y1]: readonly [number, number], [z0, z1]: readonly [number, number], slot: Slot) => {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) put(x, y, z, slot);
};
/** A 3 × 3 row centred on (x, z) with the corners left off: a plus. */
const plus = (put: Put, x: number, y: number, z: number, slot: Slot) => {
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) put(x + dx, y, z + dz, slot);
};
const cells = (put: Put, list: readonly Cell[], slot: Slot) => { for (const [x, y, z] of list) put(x, y, z, slot); };

const TOYS: Record<HeldStyleId, (put: Put) => void> = {
  // Held out by its middle: a chunky duck with a wide orange bill, its tail up behind.
  'rubber-duck'(put) {
    box(put, [-6, -4], [7, 8], [1, 4], 'held');
    for (const [x, z] of [[-6, 1], [-4, 1], [-6, 4], [-4, 4]] as const) put(x, 8, z, 'heldDeep');
    put(-5, 9, 1, 'held');
    box(put, [-6, -4], [9, 10], [3, 4], 'held');
    cells(put, [[-6, 10, 4], [-4, 10, 4]], 'heldInk');
    box(put, [-6, -4], [9, 9], [5, 5], 'heldTwo');
  },
  // Hung from a little hooked handle: dark caps, painted paper, a warm lit band round the middle.
  'paper-lantern'(put) {
    cells(put, [[-4, 7, 1], [-4, 7, 2], [-4, 7, 3], [-5, 7, 3], [-5, 6, 3], [-5, 2, 3]], 'heldTwo');
    plus(put, -5, 5, 3, 'held');
    box(put, [-6, -4], [4, 4], [2, 4], 'heldGlow');
    plus(put, -5, 3, 3, 'held');
  },
  // A round balloon at shoulder height on a stepped string, with a shine on its upper corner.
  balloon(put) {
    cells(put, [[-4, 8, 1], [-4, 9, 2], [-4, 10, 3], [-5, 10, 3]], 'heldTwo');
    put(-5, 10, 4, 'heldDeep');
    plus(put, -5, 11, 4, 'held');
    box(put, [-6, -4], [12, 13], [3, 5], 'held');
    plus(put, -5, 14, 4, 'held');
    put(-6, 13, 5, 'heldGlow');
  },
  // Held up by one paw: a round head with ears and a pale snout, a small body, arms and legs.
  teddy(put) {
    cells(put, [[-4, 7, 1], [-4, 7, 2]], 'held');
    box(put, [-5, -4], [5, 7], [3, 4], 'held');
    cells(put, [[-5, 6, 4], [-4, 6, 4]], 'heldTwo');
    cells(put, [[-6, 7, 4], [-3, 7, 4], [-5, 4, 4], [-4, 4, 4]], 'held');
    box(put, [-6, -4], [8, 10], [3, 5], 'held');
    cells(put, [[-6, 10, 3], [-4, 10, 3]], 'heldDeep');
    cells(put, [[-6, 11, 4], [-4, 11, 4]], 'held');
    cells(put, [[-6, 10, 5], [-4, 10, 5]], 'heldInk');
    put(-5, 9, 6, 'heldTwo');
  },
  // Held upright: a wrapped grip in the fist, a cross guard, a whittled blade.
  'wooden-sword'(put) {
    cells(put, [[-4, 6, 1], [-4, 6, 2]], 'heldThree');
    box(put, [-4, -4], [7, 8], [1, 2], 'heldTwo');
    cells(put, [[-4, 9, 1], [-4, 9, 2], [-4, 9, 3]], 'heldThree');
    box(put, [-4, -4], [10, 13], [2, 2], 'held');
    put(-4, 14, 2, 'heldGlow');
  },
  // A paper cone, a ring of leaves, then the blooms with their yellow hearts and one bud on top.
  bouquet(put) {
    cells(put, [[-4, 7, 1], [-4, 8, 1], [-4, 8, 2], [-4, 9, 2], [-4, 9, 3]], 'heldThree');
    box(put, [-6, -4], [10, 10], [3, 5], 'heldTwo');
    put(-5, 10, 4, 'heldThree');
    cells(put, [[-7, 10, 4], [-3, 10, 4]], 'heldTwo');
    box(put, [-6, -4], [11, 11], [3, 5], 'held');
    plus(put, -5, 12, 4, 'held');
    cells(put, [[-6, 11, 3], [-4, 11, 5], [-5, 12, 4], [-6, 11, 5]], 'heldGlow');
    put(-5, 13, 4, 'heldDeep');
  },
  // A banded wooden mug held by its handle, foam standing over the rim.
  'cider-mug'(put) {
    cells(put, [[-4, 7, 1], [-4, 8, 1]], 'heldDeep');
    box(put, [-6, -4], [6, 8], [2, 4], 'held');
    box(put, [-6, -4], [6, 6], [2, 4], 'heldThree');
    box(put, [-6, -4], [8, 8], [2, 4], 'heldThree');
    box(put, [-6, -4], [9, 9], [2, 4], 'heldTwo');
    put(-5, 10, 3, 'heldTwo');
  },
  // A very long loaf held upright, two cells deep, with pale scoring down the front.
  baguette(put) {
    box(put, [-4, -4], [5, 12], [1, 2], 'held');
    cells(put, [[-4, 5, 1], [-4, 12, 1]], 'heldThree');
    cells(put, [[-4, 6, 2], [-4, 8, 2], [-4, 10, 2]], 'heldTwo');
  },
  // A four-bladed paper pinwheel in two colours on a bent stick, facing forward.
  'paper-windmill'(put) {
    cells(put, [[-4, 7, 1], [-4, 8, 1], [-4, 9, 2], [-4, 10, 2], [-4, 10, 3], [-5, 10, 3], [-6, 10, 3], [-6, 11, 3], [-6, 12, 3]], 'heldTwo');
    const c = [-6, 12, 4] as const;
    put(c[0], c[1], c[2], 'heldGlow');
    const blades: readonly (readonly (readonly [number, number])[])[] = [
      [[0, 1], [0, 2], [1, 1]], [[-1, 0], [-2, 0], [-1, 1]], [[0, -1], [0, -2], [-1, -1]], [[1, 0], [2, 0], [1, -1]],
    ];
    blades.forEach((blade, i) => { for (const [dx, dy] of blade) put(c[0] + dx, c[1] + dy, c[2], i % 2 ? 'heldThree' : 'held'); });
  },
  // A squat plush frog held by a back leg: eye bumps on top, a wide mouth line, a pale belly.
  'frog-plush'(put) {
    cells(put, [[-4, 7, 1], [-4, 7, 2]], 'held');
    box(put, [-6, -4], [6, 8], [2, 4], 'held');
    for (const [x, z] of [[-6, 2], [-4, 2]] as const) put(x, 8, z, 'heldDeep');
    cells(put, [[-6, 9, 3], [-4, 9, 3]], 'held');
    cells(put, [[-6, 9, 4], [-4, 9, 4]], 'heldInk');
    box(put, [-6, -4], [7, 7], [4, 4], 'heldThree');
    put(-5, 6, 4, 'heldTwo');
    cells(put, [[-6, 5, 4], [-4, 5, 4]], 'held');
  },
  // A paper case, a dome of frosting with sprinkles, a cherry on top.
  cupcake(put) {
    cells(put, [[-4, 7, 1], [-4, 7, 2]], 'heldTwo');
    box(put, [-6, -4], [7, 8], [3, 5], 'heldTwo');
    for (let x = -6; x <= -4; x++) for (let z = 3; z <= 5; z++) if ((x + z) % 2 === 0) put(x, 7, z, 'heldDeep');
    box(put, [-6, -4], [9, 9], [3, 5], 'held');
    plus(put, -5, 10, 4, 'held');
    cells(put, [[-6, 9, 5], [-4, 10, 4], [-5, 9, 3]], 'heldGlow');
    put(-5, 11, 4, 'heldThree');
  },
  // A waffle cone held by its rim, a scoop in the chosen flavour and a vanilla scoop on top.
  'ice-cream'(put) {
    cells(put, [[-4, 7, 1], [-4, 7, 2]], 'heldTwo');
    put(-5, 5, 4, 'heldTwo');
    plus(put, -5, 6, 4, 'heldTwo');
    box(put, [-6, -4], [7, 7], [3, 5], 'heldTwo');
    for (let x = -6; x <= -4; x++) for (let z = 3; z <= 5; z++) if ((x + z) % 2 !== 0) put(x, 7, z, 'heldThree');
    box(put, [-6, -4], [8, 9], [3, 5], 'held');
    box(put, [-6, -4], [10, 10], [3, 5], 'heldGlow');
    plus(put, -5, 11, 4, 'heldGlow');
  },
  // A closed book held at the side by its edge: covers, pages showing at three edges, the spine behind.
  storybook(put) {
    for (let x = -7; x <= -5; x++) for (let y = 4; y <= 8; y++) for (let z = -1; z <= 2; z++) {
      const spine = z === -1, edge = y === 4 || y === 8 || z === 2;
      put(x, y, z, spine ? 'heldDeep' : x === -6 && edge ? 'heldTwo' : 'held');
    }
    cells(put, [[-8, 6, 1], [-8, 5, 1], [-8, 7, 1], [-8, 6, 0], [-8, 6, 2]], 'heldThree');
  },
  // A wand: a white stick bending up to a five-pointed star, a ribbon tied under it.
  'star-wand'(put) {
    cells(put, [[-4, 7, 1], [-4, 8, 1], [-4, 9, 2], [-4, 10, 2], [-4, 10, 3], [-4, 11, 3], [-5, 11, 3], [-5, 11, 4], [-5, 12, 4]], 'heldTwo');
    cells(put, [[-5, 14, 4], [-6, 13, 4], [-4, 13, 4], [-6, 12, 4], [-4, 12, 4]], 'held');
    put(-5, 13, 4, 'heldGlow');
    cells(put, [[-4, 11, 4], [-4, 10, 4]], 'heldThree');
  },
};

/** The cells a toy occupies, in a fresh grid: for tests, the builder's card and the contact sheet. */
export function heldCells(style: HeldStyleId): readonly [Cell, Slot][] {
  const out: [Cell, Slot][] = [];
  const seen = new Map<string, number>();
  TOYS[style]((x, y, z, slot) => {
    const key = `${x},${y},${z}`, at = seen.get(key);
    if (at === undefined) { seen.set(key, out.length); out.push([[x, y, z], slot]); } else out[at] = [[x, y, z], slot];
  });
  return out;
}

/** Puts the toy in the hand. It is drawn last, over nothing but the fist's own cells. */
export function drawHeld(g: VoxelGrid, style: HeldStyleId): void {
  for (const [[x, y, z], slot] of heldCells(style)) g.set(x, y, z, slot);
}
