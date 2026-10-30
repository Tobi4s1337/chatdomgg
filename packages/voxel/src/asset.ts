import { VoxelBlueprintSchema, type VoxelBlueprint, type VoxelMaterial, type VoxelAsset, type ChunkDependency } from '@chatdom/shared';
import { checkedVolume, HALO_VOLUME, haloIndex, voxelIndex, type Vec3 } from './coordinates';
import { floodLight } from './light';
import { type MeshChunkRequest } from './mesh';
import { assertKnownMaterials, materialLookup } from './types';

export interface PreparedAssetChunk extends MeshChunkRequest {
  readonly coordinate: Vec3;
}

/** Boxes execute in order; material-zero boxes carve openings without a second geometry format. */
export function rasterizeBlueprint(input: VoxelBlueprint, revision = 0): VoxelAsset {
  const blueprint = VoxelBlueprintSchema.parse(input);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid voxel asset revision.');
  const voxels = new Uint16Array(checkedVolume(blueprint.size));
  for (const box of blueprint.boxes) {
    for (let z = box.from[2]; z < box.to[2]; z++) for (let y = box.from[1]; y < box.to[1]; y++) {
      const start = voxelIndex(box.from[0], y, z, blueprint.size);
      voxels.fill(box.material, start, start + box.to[0] - box.from[0]);
    }
  }
  return { id: blueprint.id, revision, lattice: blueprint.lattice, size: blueprint.size, voxels };
}

/** Includes an outside-air shell; one solve sees every roof and floor in this reusable asset. */
export function computeAssetSky(asset: VoxelAsset, materials: readonly VoxelMaterial[]): { size: Vec3; sky: Uint8Array } {
  const count = checkedVolume(asset.size);
  if (asset.voxels.length !== count) throw new Error('Asset voxels do not match dimensions.');
  const lookup = materialLookup(materials);
  assertKnownMaterials(asset.voxels, lookup);
  const size: Vec3 = [asset.size[0] + 2, asset.size[1] + 2, asset.size[2] + 2];
  const occupancy = new Uint8Array(checkedVolume(size));
  const sky = new Uint8Array(occupancy.length);
  const skyBottom = new Uint16Array(size[0] * size[2]);
  for (let z = 0; z < asset.size[2]; z++) for (let y = 0; y < asset.size[1]; y++) for (let x = 0; x < asset.size[0]; x++) {
    occupancy[voxelIndex(x + 1, y + 1, z + 1, size)] = lookup.light[asset.voxels[voxelIndex(x, y, z, asset.size)]!]!;
  }
  // Direct columns seed the entire open sky, reducing queue work in the common empty volume.
  for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
    for (let y = size[1] - 1; y >= 0; y--) {
      const index = voxelIndex(x, y, z, size);
      if (occupancy[index]) { skyBottom[x + size[0] * z] = y + 1; break; }
      sky[index] = 15;
    }
  }
  // Only the sides of unequal-height open columns can illuminate an unseeded cell.
  // Sending every outdoor sky cell through the FIFO wastes most of a large castle solve.
  function* skyEdges(): Generator<number> {
    for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
      const column = x + size[0] * z, bottom = skyBottom[column]!;
      let adjacent = bottom;
      if (x > 0) adjacent = Math.max(adjacent, skyBottom[column - 1]!);
      if (x + 1 < size[0]) adjacent = Math.max(adjacent, skyBottom[column + 1]!);
      if (z > 0) adjacent = Math.max(adjacent, skyBottom[column - size[0]]!);
      if (z + 1 < size[2]) adjacent = Math.max(adjacent, skyBottom[column + size[0]]!);
      for (let y = bottom; y < adjacent; y++) yield voxelIndex(x, y, z, size);
    }
  }
  floodLight(size, occupancy, sky, true, skyEdges());
  return { size, sky };
}

/** Pure preparation for finite, independently instanced assets. Terrain supplies its actual neighbours instead. */
export function prepareAssetChunks(asset: VoxelAsset, materials: readonly VoxelMaterial[], materialRevision = 0): PreparedAssetChunk[] {
  const skyField = computeAssetSky(asset, materials);
  const counts = asset.size.map(n => Math.ceil(n / 32));
  const chunkKey = (x: number, y: number, z: number): string => `${asset.id}:${x},${y},${z}`;
  const chunks: PreparedAssetChunk[] = [];
  for (let cz = 0; cz < counts[2]!; cz++) for (let cy = 0; cy < counts[1]!; cy++) for (let cx = 0; cx < counts[0]!; cx++) {
    const halo = new Uint16Array(HALO_VOLUME);
    const sky = new Uint8Array(HALO_VOLUME);
    let populated = false;
    for (let z = -1; z <= 32; z++) for (let y = -1; y <= 32; y++) for (let x = -1; x <= 32; x++) {
      const ax = cx * 32 + x, ay = cy * 32 + y, az = cz * 32 + z;
      const index = haloIndex(x, y, z);
      if (ax >= 0 && ay >= 0 && az >= 0 && ax < asset.size[0] && ay < asset.size[1] && az < asset.size[2]) {
        const material = asset.voxels[voxelIndex(ax, ay, az, asset.size)]!;
        halo[index] = material;
        if (material !== 0 && x >= 0 && x < 32 && y >= 0 && y < 32 && z >= 0 && z < 32) populated = true;
      }
      // Outside the declared finite asset is known exterior air, unlike an unloaded terrain chunk.
      sky[index] = ax >= -1 && ay >= -1 && az >= -1 && ax <= asset.size[0] && ay <= asset.size[1] && az <= asset.size[2]
        ? skyField.sky[voxelIndex(ax + 1, ay + 1, az + 1, skyField.size)]! : 15;
    }
    if (!populated) continue;
    const dependencies: ChunkDependency[] = [{ key: `${asset.id}:full-sky`, revision: asset.revision }];
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0 && dz === 0) continue;
      const x = cx + dx, y = cy + dy, z = cz + dz;
      const inside = x >= 0 && y >= 0 && z >= 0 && x < counts[0]! && y < counts[1]! && z < counts[2]!;
      dependencies.push({ key: chunkKey(x, y, z), revision: inside ? asset.revision : 0 });
    }
    chunks.push({ stamp: { key: chunkKey(cx, cy, cz), revision: asset.revision, materialRevision, dependencies },
      coordinate: [cx, cy, cz], halo, sky, materials });
  }
  return chunks;
}
