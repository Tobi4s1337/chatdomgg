import type { VoxelGrid } from './grid';

/*
 * The upper body the bust portrait shows: a short neck, a compact torso narrower than the head, and short
 * upper arms. The full body, patterns and layers come with the wardrobe (spec L5); this is the plain tee
 * every recipe can wear, so a portrait always has shoulders and a colour under the face.
 */
export const TORSO = { x: [-3, 3], y: [8, 15], z: [-2, 2] } as const;
export const NECK = { x: [-1, 1], y: [15, 16], z: [-1, 1] } as const;
/** The arm columns hang just outside the torso. */
export const ARM = { x: 1, y: [8, 15], z: [-1, 1], sleeve: 12 } as const;

export function drawBust(g: VoxelGrid): void {
  g.fill([NECK.x[0], NECK.y[0], NECK.z[0]], [NECK.x[1], NECK.y[1], NECK.z[1]], 'skin');
  g.fill([TORSO.x[0], TORSO.y[0], TORSO.z[0]], [TORSO.x[1], TORSO.y[1], TORSO.z[1]], 'top');
  // A rounded shoulder line: the top row is one cell shorter at each end.
  g.carve([TORSO.x[0], TORSO.y[1] - 1, TORSO.z[0]], [TORSO.x[0] + 1, TORSO.y[1], TORSO.z[1]]);
  g.carve([TORSO.x[1] - 1, TORSO.y[1] - 1, TORSO.z[0]], [TORSO.x[1], TORSO.y[1], TORSO.z[1]]);
  // Crew neck: a notch of skin at the collar, the collar's inside in the deep tone.
  g.fill([-1, TORSO.y[1] - 1, TORSO.z[1] - 1], [1, TORSO.y[1], TORSO.z[1]], 'skin');
  g.fill([-1, TORSO.y[1] - 1, TORSO.z[1] - 2], [1, TORSO.y[1], TORSO.z[1] - 1], 'topDeep');
  for (const side of [-1, 1] as const) {
    const x = side < 0 ? TORSO.x[0] - ARM.x : TORSO.x[1];
    g.fill([x, ARM.y[0], ARM.z[0]], [x + ARM.x, ARM.sleeve, ARM.z[1]], 'skin');
    g.fill([x, ARM.sleeve, ARM.z[0]], [x + ARM.x, ARM.y[1] - 1, ARM.z[1]], 'top');
    // The sleeve hem: one row in the deep tone.
    g.fill([x, ARM.sleeve, ARM.z[0]], [x + ARM.x, ARM.sleeve + 1, ARM.z[1]], 'topDeep');
  }
}
