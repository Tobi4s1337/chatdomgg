import type { Vec3, VoxelAsset, VoxelMaterial } from '@chatdom/shared';
import { checkedVolume, voxelIndex } from './coordinates';
import { materialLookup } from './types';

export type RenderLodFactor = 2 | 4;

/**
 * Worker-only, conservative render reduction of the FINAL raster, after ordered air cuts.
 * A coarse cell survives whenever any source cell survives. This retains thin roofs/walls;
 * nearest-neighbour samples or independently rounded boxes can erase them. Material is the
 * non-air mode, with lower registry ID breaking ties; no invented colours or palette indices.
 *
 * Each source cell is visited once. Beyond the source, storage is two bytes per coarse cell
 * plus less than 0.4 MiB of lookup/histogram scratch. Caller scales the mesh by factor, keeps
 * original window anchors, and never uses this conservative envelope for collision or light.
 * Coordinates can expand by at most factor - 1 source cells on each side; narrow air gaps
 * may close. This is distant presentation, not a replacement for the authored geometry.
 *
 * Background: https://0fps.net/2012/08/20/simplifying-isosurfaces-part-2/ (ideas only).
 */
export function createRenderLodAsset(
  source: VoxelAsset,
  factor: RenderLodFactor,
  materials: readonly VoxelMaterial[],
): VoxelAsset {
  if (factor !== 2 && factor !== 4) throw new Error('Render LOD factor must be 2 or 4.');
  const volume = checkedVolume(source.size);
  if (source.voxels.length !== volume) throw new Error('Asset voxels do not match dimensions.');
  const known = materialLookup(materials).known;
  const size: Vec3 = [Math.ceil(source.size[0] / factor), Math.ceil(source.size[1] / factor), Math.ceil(source.size[2] / factor)];
  const voxels = new Uint16Array(checkedVolume(size));
  const counts = new Uint8Array(65536); // At most 4^3 source cells vote in one block.
  const touched = new Uint16Array(factor ** 3);
  const [sx, sy, sz] = source.size;

  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    let winner = 0, highestCount = 0, touchedCount = 0;
    const endX = Math.min((x + 1) * factor, sx);
    const endY = Math.min((y + 1) * factor, sy);
    const endZ = Math.min((z + 1) * factor, sz);
    for (let az = z * factor; az < endZ; az++) for (let ay = y * factor; ay < endY; ay++) {
      const start = voxelIndex(x * factor, ay, az, source.size);
      const end = start + endX - x * factor;
      for (let index = start; index < end; index++) {
        const material = source.voxels[index]!;
        if (!known[material]) throw new Error(`Unknown voxel material ${material}.`);
        if (material === 0) continue;
        const previousCount = counts[material]!;
        if (previousCount === 0) touched[touchedCount++] = material;
        const count = previousCount + 1;
        counts[material] = count;
        if (count > highestCount || (count === highestCount && material < winner)) {
          winner = material;
          highestCount = count;
        }
      }
    }
    voxels[voxelIndex(x, y, z, size)] = winner;
    for (let index = 0; index < touchedCount; index++) counts[touched[index]!] = 0;
  }
  return { id: `${source.id}:renderlod:${factor}`, revision: source.revision, lattice: source.lattice, size, voxels };
}
