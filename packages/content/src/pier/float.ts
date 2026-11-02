import type { Vec3, VoxelAsset } from '@chatdom/shared';
import { MAT } from '../materials';
import { Sculpt } from '../places/water/critters/rig';

export interface FloatModel {
  readonly asset: VoxelAsset;
  /** Avatar cells. The waterline sits at `waterline`; the line ties on at `eye`. */
  readonly waterline: number;
  readonly eye: Vec3;
}

/**
 * A quill float, scaled up for reading across the water: a red tip that stands proud of the surface, a cream
 * collar so it shows against dusk water, a cork body and a dark keel that rides below.
 */
export function createPierFloat(): FloatModel {
  const s = new Sculpt(3, 7, 3);
  s.set(1, 0, 1, MAT.darkStone);
  s.box(0, 1, 1, 3, 3, 2, MAT.bark).box(1, 1, 0, 2, 3, 3, MAT.bark).set(1, 1, 1, MAT.bark).set(1, 2, 1, MAT.bark);
  s.box(0, 3, 1, 3, 4, 2, MAT.cream).box(1, 3, 0, 2, 4, 3, MAT.cream);
  s.set(1, 4, 1, MAT.fabricRed).set(1, 5, 1, MAT.fabricRed).set(1, 6, 1, MAT.fabricOrange);
  return { asset: { id: 'pier:float', revision: 1, lattice: 'avatar', size: [3, 7, 3], voxels: s.cells }, waterline: 3, eye: [1.5, 7, 1.5] };
}
