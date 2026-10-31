import { VOXEL_METRES, type Vec3, type VoxelAsset } from '@chatdom/shared';

export type CritterKind = 'drake' | 'hen' | 'heron' | 'trout' | 'kingfisher' | 'dragonfly' | 'floater';
export type CritterPartId = 'body' | 'head' | 'wing-left' | 'wing-right';
export type CritterVariant = 0 | 1 | 2;

export interface CritterPart {
  readonly id: CritterPartId;
  /** Lattice 'avatar', ids from MAT only, x contiguous. Each dimension is at most 32 cells. */
  readonly asset: VoxelAsset;
  /** This part's own rotation pivot, in avatar cells from its (0,0,0) corner (may lie on a cell corner). */
  readonly pivot: Vec3;
  /** Where that pivot sits, in the body's cells. For the body itself attach equals pivot (the creature's root). */
  readonly attach: Vec3;
}

export interface Critter {
  readonly kind: CritterKind;
  /** Body first. Local axes: +Z is forward (beak/nose), +Y up, +X is the creature's left. */
  readonly parts: readonly CritterPart[];
  /** Metres, nose to tail / overall height, measured from occupied cells in the rest pose. */
  readonly length: number;
  readonly height: number;
  /** Floater only: the lantern's inner centre in body cells (the host puts a small warm glow there). */
  readonly light?: Vec3;
}

export const PART_LIMIT = 32;

/**
 * A small carving block in avatar cells. Writes outside the block throw, so a mis-sculpted cell fails loudly
 * instead of vanishing. Material zero carves.
 */
export class Sculpt {
  readonly cells: Uint16Array;
  constructor(readonly sx: number, readonly sy: number, readonly sz: number) {
    if ([sx, sy, sz].some(n => !Number.isInteger(n) || n < 1 || n > PART_LIMIT)) throw new Error(`Sculpt block ${sx}x${sy}x${sz} is out of range.`);
    this.cells = new Uint16Array(sx * sy * sz);
  }
  private index(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) throw new Error(`Cell ${x},${y},${z} is outside the ${this.sx}x${this.sy}x${this.sz} block.`);
    return x + this.sx * (y + this.sy * z);
  }
  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return 0;
    return this.cells[x + this.sx * (y + this.sy * z)]!;
  }
  set(x: number, y: number, z: number, material: number): this {
    this.cells[this.index(x, y, z)] = material;
    return this;
  }
  /** Half-open box. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number): this {
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, z, material);
    return this;
  }
  /** Repaints every occupied cell; `paint` returns the new material for it. */
  paint(paint: (x: number, y: number, z: number, material: number) => number): this {
    for (let z = 0; z < this.sz; z++) for (let y = 0; y < this.sy; y++) for (let x = 0; x < this.sx; x++) {
      const m = this.get(x, y, z);
      if (m) this.set(x, y, z, paint(x, y, z, m));
    }
    return this;
  }
}

/**
 * Lofts a body from cross-sections along z. Each section is a vertical span and a half-width about `cx`; its top
 * and bottom rows lose a cell each side, so every section is a rounded slab rather than a box.
 */
export interface Section { readonly z: number; readonly y0: number; readonly y1: number; readonly half: number }
export function loft(s: Sculpt, cx: number, sections: readonly Section[], material: number): Sculpt {
  for (const { z, y0, y1, half } of sections) for (let y = y0; y <= y1; y++) {
    const edge = (y === y0 || y === y1) && y1 > y0 && half > 1;
    const w = edge ? half - 1 : half;
    for (let x = 0; x < s.sx; x++) if (Math.abs(x + 0.5 - cx) <= w) s.set(x, y, z, material);
  }
  return s;
}

/** Deterministic small hash for mottling and accents; no clock or global random. */
export function mix(...values: readonly number[]): number {
  let h = 0x9e3779b1;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 0x1_0000_0000;
}

interface Bounds { readonly min: Vec3; readonly max: Vec3 }
function occupiedBounds(s: Sculpt): Bounds {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let z = 0; z < s.sz; z++) for (let y = 0; y < s.sy; y++) for (let x = 0; x < s.sx; x++) {
    if (!s.get(x, y, z)) continue;
    const c = [x, y, z];
    for (let d = 0; d < 3; d++) { min[d] = Math.min(min[d]!, c[d]!); max[d] = Math.max(max[d]!, c[d]! + 1); }
  }
  if (!Number.isFinite(min[0])) throw new Error('A critter part has no occupied cells.');
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}

/** Crops a sculpt to its occupied cells and returns the asset with the crop offset. */
function cropped(id: string, s: Sculpt): { asset: VoxelAsset; offset: Vec3 } {
  const { min, max } = occupiedBounds(s);
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const voxels = new Uint16Array(size[0] * size[1] * size[2]);
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++)
    voxels[x + size[0] * (y + size[1] * z)] = s.get(x + min[0], y + min[1], z + min[2]);
  return { asset: { id, revision: 1, lattice: 'avatar', size, voxels }, offset: min };
}

const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** A limb carved in its own block: its pivot is in that block, `attach` in the body's carving block. */
export interface Limb { readonly id: Exclude<CritterPartId, 'body'>; readonly sculpt: Sculpt; readonly pivot: Vec3; readonly attach: Vec3 }

/**
 * Crops every block to its occupied cells, moves pivots, attaches and the light into the cropped frames, and
 * measures length and height from the assembled rest pose.
 */
export function assemble(kind: CritterKind, variant: CritterVariant, body: Sculpt, root: Vec3, limbs: readonly Limb[], light?: Vec3): Critter {
  const name = (part: CritterPartId) => `water-critter.${kind}.${variant}.${part}`;
  const b = cropped(name('body'), body);
  const parts: CritterPart[] = [{ id: 'body', asset: b.asset, pivot: minus(root, b.offset), attach: minus(root, b.offset) }];
  for (const limb of limbs) {
    const l = cropped(name(limb.id), limb.sculpt);
    parts.push({ id: limb.id, asset: l.asset, pivot: minus(limb.pivot, l.offset), attach: minus(limb.attach, b.offset) });
  }
  let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const part of parts) {
    const [sx, sy, sz] = part.asset.size;
    const shift = minus(part.attach, part.pivot);
    for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
      if (!part.asset.voxels[x + sx * (y + sy * z)]) continue;
      y0 = Math.min(y0, y + shift[1]); y1 = Math.max(y1, y + 1 + shift[1]);
      z0 = Math.min(z0, z + shift[2]); z1 = Math.max(z1, z + 1 + shift[2]);
    }
  }
  const cell = VOXEL_METRES.avatar;
  const critter: Critter = { kind, parts, length: (z1 - z0) * cell, height: (y1 - y0) * cell };
  return light ? { ...critter, light: minus(light, b.offset) } : critter;
}
