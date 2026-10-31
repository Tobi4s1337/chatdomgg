import type { VoxelGrid } from './grid';

/*
 * The short, compact body under the head (spec L1): 24 cells tall with the 8-cell head on top, so the head is a
 * third of the figure, the founder's chibi proportion. The torso is six cells wide, narrower than the head as
 * in the reference; arms are one-cell columns just outside it, legs two-cell columns under the hips. Everything
 * is drawn in skin first and the wardrobe dresses it.
 *
 * Joints follow the frozen rig's rows: the hips (pelvis) at y 8, the knees at y 4, the ankles at y 1, the
 * shoulders at y 15 and the wrists at y 8. The arm columns hang at x ±3.5 and the legs at x ±2.
 */
export const TORSO = { x: [-3, 3], y: [8, 15], z: [-2, 2] } as const;
export const NECK = { x: [-1, 1], y: [15, 16], z: [-1, 1] } as const;
/** The hips join the legs to the torso; the bottom garment always covers them. */
export const HIPS = { x: [-3, 3], y: [6, 8], z: [-2, 2] } as const;
/** One-cell arm columns either side of the torso; the hand is the bottom two rows. */
export const ARM = { y: [7, 14], z: [-1, 1], hand: 9 } as const;
/** Two-cell leg columns with a two-cell gap, the feet at the bottom two rows. */
export const LEG = { y: [0, 6], z: [-1, 1], foot: 2 } as const;

/** The front plane of the torso (the last cell row in z) and the first cell proud of it. */
export const CHEST_Z: number = TORSO.z[1] - 1;
export const PROUD_Z: number = TORSO.z[1];
export const BACK_Z: number = TORSO.z[0];

export const SIDES = [-1, 1] as const;
export type Side = typeof SIDES[number];
/** The x of an arm column on a side (the person's right is -1). */
export const armX = (side: Side): number => (side < 0 ? TORSO.x[0] - 1 : TORSO.x[1]);
/** The first x of a leg column on a side. */
export const legX = (side: Side): number => (side < 0 ? TORSO.x[0] : TORSO.x[1] - 2);

export function drawBody(g: VoxelGrid): void {
  g.fill([NECK.x[0], NECK.y[0], NECK.z[0]], [NECK.x[1], NECK.y[1], NECK.z[1]], 'skin');
  g.fill([TORSO.x[0], TORSO.y[0], TORSO.z[0]], [TORSO.x[1], TORSO.y[1], TORSO.z[1]], 'skin');
  // A rounded shoulder line: the top row is one cell shorter at each end.
  g.carve([TORSO.x[0], TORSO.y[1] - 1, TORSO.z[0]], [TORSO.x[0] + 1, TORSO.y[1], TORSO.z[1]]);
  g.carve([TORSO.x[1] - 1, TORSO.y[1] - 1, TORSO.z[0]], [TORSO.x[1], TORSO.y[1], TORSO.z[1]]);
  g.fill([HIPS.x[0], HIPS.y[0], HIPS.z[0]], [HIPS.x[1], HIPS.y[1], HIPS.z[1]], 'skin');
  for (const side of SIDES) {
    const ax = armX(side), lx = legX(side);
    g.fill([ax, ARM.y[0], ARM.z[0]], [ax + 1, ARM.y[1], ARM.z[1]], 'skin');
    g.fill([lx, LEG.y[0], LEG.z[0]], [lx + 2, LEG.y[1], LEG.z[1]], 'skin');
  }
}
