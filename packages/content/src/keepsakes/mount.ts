import type { VoxelAsset } from '@chatdom/shared';
import { createFishModel, FISH_SPECIES } from '../fish';
import { composeFishMount } from './plaque';

const PREFIX = 'keepsake:mount.';

/** 'fish:moonlit-pike' -> 'keepsake:mount.moonlit-pike'. */
export function fishMountId(speciesId: string): string {
  if (!/^fish:[a-z0-9][a-z0-9-]*$/.test(speciesId)) throw new Error(`"${speciesId}" is not a fish species id, so it has no mount.`);
  return PREFIX + speciesId.slice('fish:'.length);
}

/** The species a mount shows, or null when the id is not a mount of an authored fish. */
export function fishOfMount(defId: string): string | null {
  if (!defId.startsWith(PREFIX)) return null;
  const speciesId = `fish:${defId.slice(PREFIX.length)}`;
  return FISH_SPECIES.some(fish => fish.id === speciesId) ? speciesId : null;
}

/**
 * A numbered keepsake's model: the real fish, turned in exact quarter turns onto a carved plaque. Front +Z, up +Y,
 * the board's back at z=0, the fish's nose to +X. Flat fish (rays, flounders) show their back instead of a flank.
 * Avatar lattice, one face-connected part, a fresh buffer on every call.
 */
export function createFishMount(speciesId: string): VoxelAsset {
  const species = FISH_SPECIES.find(fish => fish.id === speciesId);
  if (!species) throw new Error(`There is no authored fish "${speciesId}" to mount.`);
  return composeFishMount(fishMountId(speciesId), createFishModel(speciesId).asset, species.name);
}
