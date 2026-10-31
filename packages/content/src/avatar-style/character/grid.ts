/*
 * The citizen is drawn into one sparse voxel grid of paint slots, in root-local avatar cells (1/16 m, +Y up,
 * +Z forward, the frozen rig's frame). Slots are resolved to colours from the look only at meshing time, so
 * any hair or dye colour works without a registered material per colour.
 */
export const SLOTS = [
  'skin', 'eye', 'blush', 'freckle',
  'hair', 'hairDeep', 'hairLight', 'scalp', 'band',
  'beard', 'beardDeep', 'stubble', 'stache', 'stacheDeep',
  'hat', 'hatDeep', 'hatTrim', 'hatTrimDeep',
  'frame', 'lens', 'metal', 'petal', 'petalHeart', 'leaf',
  'top', 'topDeep', 'topAccent', 'topMix', 'topTrim',
  'outer', 'outerDeep', 'outerAccent', 'outerMix',
  'bottom', 'bottomDeep', 'bottomAccent', 'bottomMix',
  'neck', 'neckDeep', 'neckAccent',
  'shoe', 'shoeDeep', 'sole', 'button',
] as const;
/** Slots that are glass: meshed apart and drawn see-through, so the eyes show behind a lens. */
export const GLASS_SLOTS: readonly Slot[] = ['lens'];
export type Slot = typeof SLOTS[number];
export type Cell = readonly [number, number, number];

const OFFSET = 64, SPAN = 128;
const key = (x: number, y: number, z: number) => ((x + OFFSET) * SPAN + (y + OFFSET)) * SPAN + (z + OFFSET);
const unkey = (k: number): Cell => [Math.floor(k / (SPAN * SPAN)) - OFFSET, Math.floor(k / SPAN) % SPAN - OFFSET, k % SPAN - OFFSET];

export class VoxelGrid {
  private readonly cells = new Map<number, Slot>();

  get size(): number { return this.cells.size; }

  get(x: number, y: number, z: number): Slot | undefined { return this.cells.get(key(x, y, z)); }
  has(x: number, y: number, z: number): boolean { return this.cells.has(key(x, y, z)); }

  set(x: number, y: number, z: number, slot: Slot): this {
    if ([x, y, z].some(n => n < -OFFSET || n >= OFFSET)) throw new Error(`Cell ${x},${y},${z} is outside the avatar lattice.`);
    this.cells.set(key(x, y, z), slot);
    return this;
  }

  delete(x: number, y: number, z: number): this { this.cells.delete(key(x, y, z)); return this; }

  /** Fills the half-open box [from, to). */
  fill(from: Cell, to: Cell, slot: Slot): this {
    for (let x = from[0]; x < to[0]; x++) for (let y = from[1]; y < to[1]; y++) for (let z = from[2]; z < to[2]; z++) this.set(x, y, z, slot);
    return this;
  }

  /** Clears the half-open box [from, to). */
  carve(from: Cell, to: Cell): this {
    for (let x = from[0]; x < to[0]; x++) for (let y = from[1]; y < to[1]; y++) for (let z = from[2]; z < to[2]; z++) this.delete(x, y, z);
    return this;
  }

  /** Repaints only cells that already exist (hair over scalp, freckles over skin). */
  paint(from: Cell, to: Cell, slot: Slot, only?: readonly Slot[]): this {
    for (let x = from[0]; x < to[0]; x++) for (let y = from[1]; y < to[1]; y++) for (let z = from[2]; z < to[2]; z++) {
      const at = this.get(x, y, z);
      if (at && (!only || only.includes(at))) this.set(x, y, z, slot);
    }
    return this;
  }

  /** Every cell, in a stable order. */
  *entries(): IterableIterator<[Cell, Slot]> {
    for (const k of [...this.cells.keys()].sort((a, b) => a - b)) yield [unkey(k), this.cells.get(k)!];
  }

  bounds(): { min: Cell; max: Cell } {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const [c] of this.entries()) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, c[i]!); max[i] = Math.max(max[i]!, c[i]! + 1); }
    return { min: min as unknown as Cell, max: max as unknown as Cell };
  }
}
