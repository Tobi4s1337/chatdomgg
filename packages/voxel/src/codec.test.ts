import { describe, expect, it } from 'vitest';
import { decodeVoxelChunk, encodeVoxelChunk } from './codec';

const metadata = { lattice: 'build' as const, coordinate: [-3, 0, 2] as const, revision: 17 };

describe('palette chunk interchange', () => {
  it.each([1, 2, 3, 4, 5, 16, 17, 256])('round trips %i real material IDs without confusing palette offsets', (count) => {
    const voxels = Uint16Array.from({ length: 32768 }, (_, i) => (i % count) * 251);
    const packed = encodeVoxelChunk(voxels, metadata);
    expect(packed.palette.length).toBe(count);
    expect(packed.indices.byteLength).toBe(32768 * packed.bits / 8);
    expect(decodeVoxelChunk(packed)).toEqual(voxels);
    expect(packed.coordinate).toEqual([-3, 0, 2]);
  });

  it('encodes uniform chunks without an index buffer', () => {
    const packed = encodeVoxelChunk(new Uint16Array(32768).fill(65535), metadata);
    expect([...packed.palette]).toEqual([65535]);
    expect(packed.bits).toBe(0);
    expect(packed.indices.byteLength).toBe(0);
  });

  it('rejects too many materials, truncation and palette references outside the table', () => {
    expect(() => encodeVoxelChunk(Uint16Array.from({ length: 32768 }, (_, i) => i % 257), metadata)).toThrow();
    const packed = encodeVoxelChunk(Uint16Array.from({ length: 32768 }, (_, i) => i % 3), metadata);
    expect(() => decodeVoxelChunk({ ...packed, indices: packed.indices.subarray(1) })).toThrow();
    packed.indices[0] = 255;
    expect(() => decodeVoxelChunk(packed)).toThrow('out of range');
  });

  it('requires canonical sorted unique palettes and safe coordinates', () => {
    const packed = encodeVoxelChunk(Uint16Array.from({ length: 32768 }, (_, i) => i % 2), metadata);
    expect(() => decodeVoxelChunk({ ...packed, palette: Uint16Array.of(2, 1) })).toThrow();
    expect(() => encodeVoxelChunk(new Uint16Array(32768), { ...metadata, coordinate: [0.5, 0, 0] })).toThrow();
  });
});
