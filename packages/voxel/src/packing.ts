export interface PackedVoxelVertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** +X, -X, +Y, -Y, +Z, -Z. */
  readonly face: number;
  /** Accessibility: 0 is enclosed, 3 is open. */
  readonly ao: number;
  readonly sky: number;
  readonly material: number;
}

/** Two u32 words = eight bytes; position is local integer voxel corners, never metres. */
export function packVoxelVertex(vertex: PackedVoxelVertex): readonly [number, number] {
  const { x, y, z, face, ao, sky, material } = vertex;
  if ([x, y, z].some((n) => !Number.isInteger(n) || n < 0 || n > 32)
    || !Number.isInteger(face) || face < 0 || face > 5
    || !Number.isInteger(ao) || ao < 0 || ao > 3
    || !Number.isInteger(sky) || sky < 0 || sky > 15
    || !Number.isInteger(material) || material < 1 || material > 65535) {
    throw new Error('Invalid packed voxel vertex.');
  }
  return [(x | (y << 6) | (z << 12) | (face << 18) | (ao << 21) | (sky << 23)) >>> 0, material];
}

export function unpackVoxelVertex(word0: number, word1: number): PackedVoxelVertex {
  return { x: word0 & 63, y: (word0 >>> 6) & 63, z: (word0 >>> 12) & 63,
    face: (word0 >>> 18) & 7, ao: (word0 >>> 21) & 3, sky: (word0 >>> 23) & 15, material: word1 & 65535 };
}
