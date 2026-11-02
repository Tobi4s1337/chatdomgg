import type { ItemDefinition, VoxelAsset } from '@chatdom/shared';
import { FISH_SPECIES } from '../fish';
import { createFishMount, fishMountId, fishOfMount } from './mount';

export { createFishMount, fishMountId, fishOfMount } from './mount';
export { composeFishMount, mountPoseOf, type MountPose } from './plaque';

/** Rare catches and a kingdom's first of each species: "No. 3 of the Moonlit Pike in Willowmere". */
export const FISH_MOUNT_DEFINITIONS: readonly ItemDefinition[] = Object.freeze(FISH_SPECIES.map(fish => {
  const id = fishMountId(fish.id);
  return Object.freeze({
    id, branch: 'kept' as const, title: `${fish.name}, mounted`, lore: fish.lore,
    stack: null, keepsake: true, model: id,
    places: Object.freeze(['shelf', 'bag', 'away'] as const),
  });
}));

/** Resolves a keepsake definition's model id to its voxel asset. */
export function createKeepsakeModel(defId: string): VoxelAsset {
  const speciesId = fishOfMount(defId);
  if (!speciesId) throw new Error(`"${defId}" is not a keepsake in the authored catalogue.`);
  return createFishMount(speciesId);
}
