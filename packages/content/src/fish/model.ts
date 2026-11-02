import type { Vec3, VoxelAsset } from '@chatdom/shared';
import { Sculpt } from '../places/water/critters/rig';

export { Sculpt, loft } from '../places/water/critters/rig';

/** +Z nose, +Y up, +X left. Anchors are avatar cells; consumers convert once at the scene boundary. */
export interface FishModel {
  readonly asset: VoxelAsset;
  readonly mouth: Vec3;
  /** Tail wrist, for a later swimming deformation; the rest model is also the bag portrait. */
  readonly tail: Vec3;
}

/** Every call owns its buffer. Authored bounds stay stable so animation anchors never depend on cropping. */
export function fishModel(id: string, sculpt: Sculpt, mouth: Vec3, tail: Vec3): FishModel {
  return { asset: { id, revision: 1, lattice: 'avatar', size: [sculpt.sx, sculpt.sy, sculpt.sz], voxels: sculpt.cells }, mouth, tail };
}
