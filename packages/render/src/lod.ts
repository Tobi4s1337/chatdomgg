import type { MaterialRegistry, VoxelBlueprint } from '@chatdom/shared';
import type { RenderLodFactor, VoxelJobInput } from '@chatdom/voxel';

/**
 * Request render-only reduction inside the voxel worker. This helper does no raster work.
 * Use the original blueprint for windows, placement, collision and light-field occupancy.
 * Mesh coordinates use the build lattice; apply uniform instance scale = factor, preserving
 * the original asset origin. Fade between detail levels; do not switch geometry visibly.
 */
export function createRenderLodJob(
  blueprint: VoxelBlueprint,
  factor: RenderLodFactor,
  registry: MaterialRegistry,
  revision = 0,
): Extract<VoxelJobInput, { kind: 'blueprint' }> {
  if (factor !== 2 && factor !== 4) throw new Error('Render LOD factor must be 2 or 4.');
  return { kind: 'blueprint', blueprint, revision, materials: registry.materials,
    materialRevision: registry.revision, lodFactor: factor };
}
