import type { ItemDefinition, Vec3, VoxelAsset } from '@chatdom/shared';
import { MAT } from '../materials';
import { Sculpt } from '../places/water/critters/rig';

export interface WillowRodModel {
  readonly asset: VoxelAsset;
  /** Avatar cells: held at grip, the line starts at tip. +Y runs towards the tip, +Z faces the reel. */
  readonly grip: Vec3;
  readonly tip: Vec3;
}

/** What a rod has earned: tally notches (one per ten fish, at most twelve) and the ribbon of its first legend. */
export interface RodMarks { readonly notches?: number; readonly ribbon?: boolean }

/**
 * The tally: little pale cuts standing out on either side of the foregrip, two to a row, read from the reel up.
 * Rod cells, in the order they are earned.
 */
export const ROD_NOTCH_CELLS: readonly Vec3[] = Object.freeze(Array.from({ length: 12 }, (_, index): Vec3 =>
  Object.freeze([index % 2 ? 1 : 3, 13 + Math.floor(index / 2), 1]) as unknown as Vec3));
export const ROD_NOTCH_MATERIAL = MAT.cream;

/** The first legend's ribbon: a red band tied below the foregrip with a gold knot and two short tails. Rod cells. */
export const ROD_RIBBON_CELLS: readonly (readonly [number, number, number, number])[] = Object.freeze([
  [1, 11, 1, MAT.fabricRed], [3, 11, 1, MAT.fabricRed], [2, 11, 2, MAT.fabricRed], [2, 11, 0, MAT.fabricGold],
  [1, 11, 0, MAT.fabricRed], [3, 11, 0, MAT.fabricRed], [3, 10, 0, MAT.fabricRed], [3, 9, 0, MAT.fabricRed], [1, 10, 0, MAT.fabricRed],
].map(cell => Object.freeze(cell) as unknown as readonly [number, number, number, number]));

/** The ribbon alone, in the rod's own cells, for a layer that ties it onto a drawn rod. */
export function createRodRibbon(): VoxelAsset {
  const s = new Sculpt(5, 32, 5);
  for (const [x, y, z, material] of ROD_RIBBON_CELLS) s.set(x, y, z, material);
  return { id: 'tool:rod.willow.ribbon', revision: 1, lattice: 'avatar', size: [5, 32, 5], voxels: s.cells };
}

/** One notch, a single pale cell at the origin, placed per notch by a layer. */
export function createRodNotch(): VoxelAsset {
  const s = new Sculpt(1, 1, 1);
  s.set(0, 0, 0, ROD_NOTCH_MATERIAL);
  return { id: 'tool:rod.willow.notch', revision: 1, lattice: 'avatar', size: [1, 1, 1], voxels: s.cells };
}

export function createWillowRod(marks: RodMarks = {}): WillowRodModel {
  const s = new Sculpt(5, 32, 5);
  // A willow wand, with a heavier bark grip and three pale bindings. The upper stem leans gently forwards.
  s.box(2, 0, 1, 3, 7, 3, MAT.bark);
  s.box(2, 7, 1, 3, 20, 2, MAT.timber);
  s.box(2, 19, 1, 3, 21, 3, MAT.timber).box(2, 20, 2, 3, 32, 3, MAT.timber);
  for (const y of [1, 5, 12, 24]) {
    const z = y > 19 ? 2 : 1;
    s.set(2, y, z, MAT.cream);
  }
  // Wooden spool in a brass shoe. Its two stepped cheeks read as a reel, not a block on the handle.
  s.box(2, 3, 2, 3, 5, 4, MAT.brass);
  s.box(1, 2, 3, 4, 6, 4, MAT.darkStone);
  for (const x of [0, 4]) {
    s.box(x, 3, 2, x + 1, 5, 5, MAT.timber).box(x, 2, 3, x + 1, 6, 4, MAT.timber);
    s.set(x, 3, 3, MAT.brass);
  }
  s.set(4, 4, 4, MAT.brass);
  s.set(2, 30, 3, MAT.brass).set(2, 31, 3, MAT.brass);
  const notches = Math.max(0, Math.min(ROD_NOTCH_CELLS.length, Math.trunc(marks.notches ?? 0)));
  for (const [x, y, z] of ROD_NOTCH_CELLS.slice(0, notches)) s.set(x, y, z, ROD_NOTCH_MATERIAL);
  if (marks.ribbon) for (const [x, y, z, material] of ROD_RIBBON_CELLS) s.set(x, y, z, material);
  return { asset: { id: 'tool:rod.willow', revision: 1, lattice: 'avatar', size: [5, 32, 5], voxels: s.cells }, grip: [2.5, 6, 2], tip: [2.5, 31.5, 3.5] };
}

export const WILLOW_ROD_DEFINITION: ItemDefinition = Object.freeze({
  id: 'tool:rod.willow', branch: 'held', title: 'Willow Rod',
  lore: 'A patient willow wand, bound in linen. The handle remembers every hand that held it.',
  stack: null, keepsake: false, model: 'tool:rod.willow', places: Object.freeze(['hand', 'hotbar', 'bag', 'away'] as const),
});
