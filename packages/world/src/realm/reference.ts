import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';

/** Explicit SIMULATED reference court, not a founded kingdom or live ownership bootstrap. */
export const REFERENCE_BLOCKS: readonly SolidBox[] = [
  { min: [-20, -1, -20], max: [20, 0, 20] },
  { min: [-3, 0, -2], max: [-1, 1.5, 0] },
  { min: [3, 0, -3], max: [5, .5, 0] },
  { min: [-20, 0, -20], max: [-18, 6, 20] }, { min: [18, 0, -20], max: [20, 6, 20] },
  { min: [-20, 0, -20], max: [20, 6, -18] }, { min: [-20, 0, 18], max: [20, 6, 20] },
];
export const REFERENCE_WORLD: CollisionWorld = {
  revision: 1,
  query: bounds => REFERENCE_BLOCKS.filter(b => b.min.every((n, axis) => n <= bounds.max[axis]! && b.max[axis]! >= bounds.min[axis]!)),
};
