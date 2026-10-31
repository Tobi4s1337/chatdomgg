import type { Slot, VoxelGrid } from './grid';
import { FACE_Z, SKULL } from './head';

/*
 * The hair kit: the shared moves every hair style is built from (spec L3). The scalp is painted, then the
 * volume is stacked as rounded slabs, one per row. A slab is a rectangle with its corners stepped off, so a
 * stack of them makes the stepped dome of a pixel circle: crisp, never blobby. `guardFace` runs last for
 * every style: nothing proud ever sits in front of the face below the hairline, and the eyes and the two rows
 * under them stay clear (the tests hold every style to that).
 */

/**
 * A hair style. `draw` is the head of hair: the scalp, the volume around the skull, the fringe. `tied` is
 * whatever is gathered and worn away from the head (buns, a ponytail, pigtails, a top knot, braids): it is
 * drawn into its own grid and laid over the head, so a hat can flatten the hair under it and the tied parts
 * still come out from under the brim. `brim` is the hat's brim row when a hat is worn: gathered hair that
 * would sit on top of the head goes below it instead (a top knot becomes a low bun, a high tail a low one).
 */
export interface HairStyle {
  draw(g: VoxelGrid): void;
  tied?(g: VoxelGrid, brim?: number): void;
}

/** The slots hair is painted in. */
export const HAIR_SLOTS: readonly Slot[] = ['hair', 'hairDeep', 'hairLight', 'scalp', 'band'];

export const X0: number = SKULL.x[0], X1: number = SKULL.x[1], Y0: number = SKULL.y[0], Y1: number = SKULL.y[1], Z0: number = SKULL.z[0], Z1: number = SKULL.z[1];
export const TOP = Y1, FRONT = Z1;
export type Span = readonly [number, number];

/** A stable per-cell number in [0, 1), for hand-placed irregularity (lumps, locks, the odd darker strand). */
export function cellHash(x: number, y: number, z: number, salt = 0): number {
  let h = Math.imul(x * 73856093 ^ y * 19349663 ^ z * 83492791 ^ salt * 2654435761, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export interface Scalp {
  /** Lowest skull row painted on the face plane (the hairline, y). */
  readonly front: number;
  /** Lowest row painted on the sides. */
  readonly side: number;
  /** Lowest row painted on the back. */
  readonly back: number;
  /** Rows under `side` and `back` painted as a short fade. */
  readonly fade?: number;
}

export function scalp(g: VoxelGrid, s: Scalp): void {
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
export function slab(g: VoxelGrid, y: number, [x0, x1]: Span, [z0, z1]: Span, cut = 1, slot: Slot = 'hair'): void {
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
    if (Math.min(x - x0, x1 - 1 - x) + Math.min(z - z0, z1 - 1 - z) < cut) continue;
    if (!g.has(x, y, z)) g.set(x, y, z, slot);
  }
}

/** Slabs for a run of rows. */
export function slabs(g: VoxelGrid, ys: Span, x: Span, z: Span, cut = 1): void {
  for (let y = ys[0]; y < ys[1]; y++) slab(g, y, x, z, cut);
}

/** Proud cells in front of the face plane, one row of x spans at a time. */
export function fringe(g: VoxelGrid, rows: readonly (readonly [number, readonly Span[]])[], z = FRONT, slot: Slot = 'hair'): void {
  for (const [y, spans] of rows) for (const [a, b] of spans) g.fill([a, y, z], [b, y + 1, z + 1], slot);
}

/** One column of the hairline: the lowest row of hair on the face plane, and the lowest proud row, if any. */
export type HairlineColumn = readonly [flush: number, proud?: number];

const ON_HEAD: readonly Slot[] = ['hair', 'hairDeep', 'hairLight', 'scalp'];

/**
 * Redraws the front of a head of hair column by column, from the person's right (x = -4) to their left. Each
 * column says where the hair meets the forehead and where the fringe stands proud of it, so no fringe is one
 * straight shelf: it parts, steps and sweeps, and the forehead shows through it as in the reference. A flush
 * row of `TOP` shows forehead up to the crown (a parting). `guardFace` still runs after it.
 */
export function hairline(g: VoxelGrid, cols: readonly HairlineColumn[], slot: Slot = 'hair'): void {
  cols.forEach(([flush, proud], i) => {
    const x = X0 + i;
    for (let y = Y0; y < TOP; y++) {
      const face = g.get(x, y, FACE_Z), front = g.get(x, y, FRONT);
      if (y >= flush && face === 'skin') g.set(x, y, FACE_Z, slot);
      else if (y < flush && face && ON_HEAD.includes(face)) g.set(x, y, FACE_Z, 'skin');
      if (proud !== undefined && y >= proud) { if (!front) g.set(x, y, FRONT, slot); }
      else if (front && ON_HEAD.includes(front)) g.delete(x, y, FRONT);
    }
  });
}

/** Breaks the outer surface of a big volume into locks: some outside cells go, a few push one cell out. */
export function locks(g: VoxelGrid, below: number, salt: number, gone = .24, out = .1): void {
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
export function guardFace(g: VoxelGrid, hairline: number): void {
  g.carve([X0, Y0 - 2, FRONT], [X1, hairline, FRONT + 4]);
  g.paint([X0 + 1, Y0, FACE_Z], [X1 - 1, hairline, Z1], 'skin', ['hair', 'hairDeep', 'hairLight', 'scalp']);
}

/** Hair that falls below the jaw stays beside and behind the neck, never under the chin or over the chest. */
export function clearUnderChin(g: VoxelGrid): void {
  const hairy: readonly Slot[] = ['hair', 'hairDeep', 'hairLight'];
  for (const [[x, y, z], slot] of [...g.entries()]) if (y < Y0 && x >= X0 && x < X1 && z >= Z0 + 2 && hairy.includes(slot)) g.delete(x, y, z);
}

/**
 * Under-layers in the deep tone: the lowest cell of each lock, and the odd strand. A beard keeps its face
 * plane in one tone: a darker cell there, under the eyes, reads as a mouth.
 */
export function deepen(g: VoxelGrid, slot: 'hair' | 'beard', deep: 'hairDeep' | 'beardDeep', chance: number, salt: number): void {
  const cells = [...g.entries()].filter(([, s]) => s === slot);
  for (const [[x, y, z]] of cells) {
    const underside = !g.has(x, y - 1, z) && y < TOP - 1;
    const facePlane = slot === 'beard' && z >= FACE_Z;
    if (underside || (!facePlane && cellHash(x, y, z, salt) < chance)) g.set(x, y, z, deep);
  }
}

