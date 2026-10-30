import { CHUNK_SIZE, HALO_SIZE, type Vec3 } from '@chatdom/shared';
export { CHUNK_SIZE, HALO_SIZE, type Vec3 } from '@chatdom/shared';
/** Integer chunk coordinates use floor division, including west/below the origin. */
export const CHUNK_VOLUME = CHUNK_SIZE ** 3;
export const HALO_VOLUME = HALO_SIZE ** 3;

export function voxelIndex(x: number, y: number, z: number, size: Vec3 = [32, 32, 32]): number {
  return x + size[0] * (y + size[1] * z);
}

export function chunkCoordinate(voxel: number): number {
  return Math.floor(voxel / CHUNK_SIZE);
}

export function localCoordinate(voxel: number): number {
  return voxel - chunkCoordinate(voxel) * CHUNK_SIZE;
}

/** Accepts the interior's -1..32 coordinates, including all edge/corner neighbours. */
export function haloIndex(x: number, y: number, z: number): number {
  return x + 1 + HALO_SIZE * (y + 1 + HALO_SIZE * (z + 1));
}

export function checkedVolume(size: Vec3, maximum = 16_777_216): number {
  if (size.some((value) => !Number.isInteger(value) || value <= 0 || value > 4096)) {
    throw new Error('Voxel dimensions must be positive integers no larger than 4096.');
  }
  const count = size[0] * size[1] * size[2];
  if (count > maximum) throw new Error('Voxel volume exceeds the allocation budget.');
  return count;
}

/** A corner edit invalidates eight chunks: the owner and every halo which reads it. */
export function affectedChunkCoordinates(voxel: Vec3): Vec3[] {
  const choices = voxel.map((component) => {
    const owner = chunkCoordinate(component);
    const local = localCoordinate(component);
    return local === 0 ? [owner - 1, owner] : local === 31 ? [owner, owner + 1] : [owner];
  });
  const result: Vec3[] = [];
  for (const x of choices[0]!) for (const y of choices[1]!) for (const z of choices[2]!) result.push([x, y, z]);
  return result;
}
