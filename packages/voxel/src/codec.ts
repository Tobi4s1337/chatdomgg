import { type PackedVoxelChunk, type Vec3, type VoxelLattice, VoxelLatticeSchema } from '@chatdom/shared';
import { CHUNK_VOLUME } from './coordinates';

export interface ChunkEncodingMetadata {
  readonly lattice: VoxelLattice;
  readonly coordinate: Vec3;
  readonly revision: number;
}

function validateMetadata(metadata: ChunkEncodingMetadata): void {
  VoxelLatticeSchema.parse(metadata.lattice);
  if (metadata.coordinate.length !== 3 || metadata.coordinate.some(n => !Number.isSafeInteger(n))
    || !Number.isSafeInteger(metadata.revision) || metadata.revision < 0) throw new Error('Invalid chunk metadata.');
}

function widthFor(count: number): 0 | 1 | 2 | 4 | 8 {
  if (count < 1 || count > 256) throw new Error('Chunks require 1..256 distinct materials.');
  return count === 1 ? 0 : count <= 2 ? 1 : count <= 4 ? 2 : count <= 16 ? 4 : 8;
}

/** Canonical numeric palette order makes equal chunks byte-identical, independent of edit history. */
export function encodeVoxelChunk(voxels: Uint16Array, metadata: ChunkEncodingMetadata): PackedVoxelChunk {
  validateMetadata(metadata);
  if (voxels.length !== CHUNK_VOLUME) throw new Error('A chunk must contain exactly 32³ material IDs.');
  const palette = Uint16Array.from([...new Set(voxels)].sort((a, b) => a - b));
  const bits = widthFor(palette.length);
  const indices = new Uint8Array(CHUNK_VOLUME * bits / 8);
  if (bits !== 0) {
    const inverse = new Map([...palette].map((material, index) => [material, index]));
    for (let i = 0; i < voxels.length; i++) {
      const bit = i * bits, offset = bit >>> 3;
      indices[offset] = indices[offset]! | (inverse.get(voxels[i]!)! << (bit & 7));
    }
  }
  return { version: 1, lattice: metadata.lattice, coordinate: metadata.coordinate,
    revision: metadata.revision, palette, bits, indices };
}

export function decodeVoxelChunk(chunk: PackedVoxelChunk): Uint16Array {
  validateMetadata(chunk);
  if (chunk.version !== 1 || widthFor(chunk.palette.length) !== chunk.bits
    || chunk.indices.length !== CHUNK_VOLUME * chunk.bits / 8) throw new Error('Invalid packed chunk layout.');
  for (let i = 1; i < chunk.palette.length; i++) {
    if (chunk.palette[i - 1]! >= chunk.palette[i]!) throw new Error('Chunk palette must be strictly increasing.');
  }
  const voxels = new Uint16Array(CHUNK_VOLUME);
  if (chunk.bits === 0) return voxels.fill(chunk.palette[0]!);
  const mask = (1 << chunk.bits) - 1;
  for (let i = 0; i < voxels.length; i++) {
    const bit = i * chunk.bits;
    const index = (chunk.indices[bit >>> 3]! >>> (bit & 7)) & mask;
    if (index >= chunk.palette.length) throw new Error('Chunk palette index is out of range.');
    voxels[i] = chunk.palette[index]!;
  }
  return voxels;
}
