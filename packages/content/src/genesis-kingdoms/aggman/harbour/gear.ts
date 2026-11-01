import { MAT } from '../../../materials';
import { type Grid, noise, ring } from './grid';

/**
 * Small working gear shared by the boats and the quay: lobster pots, coils of rope, barrels, a wicker basket and
 * net mesh. Each helper writes through `put`, so a boat can lay gear only into air it has left open while the
 * shore pieces write freely.
 */
export type Put = (x: number, y: number, z: number, material: number) => void;

/** Hemp rope, as the lake boats use it. */
export const ROPE = MAT.thatch;
/** Wrought iron and tarred twine. */
export const IRON = MAT.darkStone;
/** Withy, cane and the darker end of wood. */
export const WITHY = MAT.bark;
/** Tanned netting: the cutch-brown of working nets. */
export const NET = MAT.cloth;

/** Strict gear: every cell must be air in `g`. */
export const freePut = (g: Grid): Put => (x, y, z, m) => g.free(x, y, z, x + 1, y + 1, z + 1, m);
export const setPut = (g: Grid): Put => (x, y, z, m) => g.set(x, y, z, m);

/** Net mesh: twine where either coordinate is even, a dark hole where both are odd. */
export const mesh = (u: number, v: number): number => (u % 2 === 0 || v % 2 === 0 ? NET : IRON);

export const CREEL = { length: 7, height: 4, width: 5 } as const;

/**
 * A lobster pot, 0.9 m long: a timber base with darker corner blocks, three withy hoops (the ends and the middle)
 * standing in a D over it, and tanned netting between them with dark holes in the mesh. One end carries the
 * funnel's eye. `along` is the axis its length runs on; `eyeHigh` puts the eye at the far end of that axis.
 */
export function layCreel(put: Put, x0: number, y0: number, z0: number, along: 'x' | 'z', eyeHigh = false): void {
  const { length, height, width } = CREEL;
  const at = (u: number, y: number, w: number, m: number) => along === 'x' ? put(x0 + u, y0 + y, z0 + w, m) : put(x0 + w, y0 + y, z0 + u, m);
  const hoops = new Set([0, 3, length - 1]);
  for (let u = 0; u < length; u++) for (let w = 0; w < width; w++) {
    const corner = (u === 0 || u === length - 1) && (w === 0 || w === width - 1);
    at(u, 0, w, corner ? WITHY : MAT.timber);
  }
  for (let u = 0; u < length; u++) {
    const hoop = hoops.has(u);
    // The D: two upright sides and a three-cell crown, the corners left open so the top reads round.
    const shell: [number, number][] = [[1, 0], [2, 0], [1, width - 1], [2, width - 1], [3, 1], [3, 2], [3, 3]];
    for (const [y, w] of shell) at(u, y, w, hoop ? WITHY : mesh(u + w, y + w));
    const end = u === 0 || u === length - 1;
    if (!end) continue;
    const eye = (u === length - 1) === eyeHigh;
    for (let y = 1; y < height - 1; y++) for (let w = 1; w < width - 1; w++) {
      const centre = y === 2 && w === 2;
      at(u, y, w, eye ? (centre ? IRON : NET) : mesh(y, w));
    }
  }
}

/**
 * A coil of rope lying flat: a full turn on the deck, a second smaller turn on top set off-centre, and the end led
 * away along +X for `tail` cells. Centre (cx, cz) is a cell-space point; y is the coil's bottom row.
 */
export function layCoil(put: Put, cx: number, y: number, cz: number, outer = 2.9, tail = 3): void {
  const cells = new Map<string, readonly [number, number, number]>();
  const add = (x: number, yy: number, z: number) => cells.set(`${x},${yy},${z}`, [x, yy, z]);
  const bottom = ring(cx, cz, outer - 1.7, outer);
  for (const [x, z] of bottom) add(x, y, z);
  for (const [x, z] of ring(cx + 0.4, cz - 0.3, outer - 2, outer - 0.6)) add(x, y + 1, z);
  // The end leaves the outermost turn on the +Z side and runs off along +X.
  const zEnd = Math.max(...bottom.map(([, z]) => z));
  const xEnd = Math.max(...bottom.filter(([, z]) => z === zEnd).map(([x]) => x));
  for (let i = 1; i <= tail; i++) add(xEnd + i, y, zEnd);
  for (const [x, yy, z] of cells.values()) put(x, yy, z, ROPE);
}

/**
 * A barrel standing on end: an octagonal body of staves, a cell wider at the belly, iron hoops at the chime and
 * the quarters, and a lid of end grain. `r` is the half-width at the chimes (barrels here are 6 or 8 cells wide).
 */
export function layBarrel(put: Put, x0: number, y0: number, z0: number, height: number, half: number, seed: number): void {
  const w = half * 2;
  const belly = (y: number) => y > 0 && y < height - 1;
  for (let y = 0; y < height; y++) {
    const grow = belly(y) && y >= 2 && y < height - 2 ? 1 : 0;
    const hoop = y === 1 || y === height - 2 || (height >= 7 && (y === 3 || y === height - 4));
    for (let x = -grow; x < w + grow; x++) for (let z = -grow; z < w + grow; z++) {
      const cx = Math.min(x + grow, w + grow - 1 - x), cz = Math.min(z + grow, w + grow - 1 - z);
      if (cx + cz < 1 + grow) continue; // cut corners: an octagon
      const edge = x === -grow || z === -grow || x === w + grow - 1 || z === w + grow - 1 || cx + cz === 1 + grow;
      const top = y === height - 1;
      const stave = (x + z + seed) % 3 === 0 ? MAT.bark : MAT.timber;
      put(x0 + x, y0 + y, z0 + z, top ? (edge ? MAT.timber : MAT.bark) : hoop && edge ? IRON : stave);
    }
  }
  // The bung, a brass dot on the belly.
  put(x0 + half, y0 + Math.floor(height / 2), z0 + w + 1, MAT.brass);
}

/**
 * A round wicker basket: a woven body in two withy tones that alternate by row and stagger by column, a rolled
 * rim, and two handles. `fill` is what is heaped in it, a cell over the rim.
 */
export function layBasket(put: Put, x0: number, y0: number, z0: number, fill: number): void {
  const d = 6, h = 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < d; x++) for (let z = 0; z < d; z++) {
    const cx = Math.min(x, d - 1 - x), cz = Math.min(z, d - 1 - z);
    if (cx + cz < 1) continue;
    const wall = x === 0 || z === 0 || x === d - 1 || z === d - 1 || cx + cz === 1;
    if (!wall && y > 0 && y < h - 1) continue;
    const m = y === h - 1 && wall ? MAT.bark : !wall && y === h - 1 ? fill : (x + z + y) % 2 ? MAT.thatch : MAT.bark;
    put(x0 + x, y0 + y, z0 + z, m);
  }
  for (let x = 2; x < 4; x++) for (let z = 2; z < 4; z++) put(x0 + x, y0 + h, z0 + z, fill);
  put(x0, y0 + h, z0 + 2, MAT.bark); put(x0 + d - 1, y0 + h, z0 + 3, MAT.bark);
}

/** A few cells of shingle round a foot, so heavy things sit into the beach instead of on it. */
export function layScatter(put: Put, cells: readonly (readonly [number, number])[], seed: number): void {
  cells.forEach(([x, z], i) => put(x, 0, z, noise(seed, i) < 0.5 ? MAT.stone : MAT.limestone));
}
