import type { VoxelMaterial } from '@chatdom/shared';
export type { VoxelMaterial, ChunkDependency, MeshStamp, VoxelAsset } from '@chatdom/shared';

export interface MaterialLookup {
  readonly known: Uint8Array;
  readonly faces: Uint8Array;
  readonly ao: Uint8Array;
  readonly light: Uint8Array;
}

export function materialLookup(materials: readonly VoxelMaterial[]): MaterialLookup {
  const known = new Uint8Array(65536);
  const faces = new Uint8Array(65536);
  const ao = new Uint8Array(65536);
  const light = new Uint8Array(65536);
  known[0] = 1;
  for (const material of materials) {
    const { id } = material;
    if (!Number.isInteger(id) || id < 0 || id > 65535 || (id !== 0 && known[id])) {
      throw new Error('Material IDs must be unique unsigned 16-bit values.');
    }
    if (id === 0 && (material.solid || material.occludesFaces || material.occludesAo || material.blocksLight)) {
      throw new Error('Material zero must remain empty air.');
    }
    known[id] = 1;
    faces[id] = Number(material.occludesFaces);
    ao[id] = Number(material.occludesAo);
    light[id] = Number(material.blocksLight);
  }
  return { known, faces, ao, light };
}

export function assertKnownMaterials(voxels: Uint16Array, lookup: MaterialLookup): void {
  for (const material of voxels) if (!lookup.known[material]) throw new Error(`Unknown voxel material ${material}.`);
}
