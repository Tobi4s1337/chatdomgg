import { describe, expect, it } from 'vitest';
import { canonicalSceneJson, sha256Hex, utf8 } from '../../founded-world/codec';
import { encodeBakedRegion, decodeBakedRegion, encodeBakedSurface, decodeBakedSurface, encodeBakedMetadata, decodeBakedMetadata } from './codec';
import { createBakedMetadata } from './metadata';
import { bakedNativeWater, bakedVisualHeight } from './surface';
import { BAKED_METADATA_BYTES, BAKED_REGION_HEADER_BYTES, BAKED_SURFACE_HEADER_BYTES, type BakedRegionMesh, type BakedRegionRef } from './types';
import { fixture, refFor, TEST_IDENTITY } from './fixtures.test-helper';

const mesh: BakedRegionMesh = { level: 0, rx: 0, rz: 0, minY: 0, maxY: 32,
  quads: new Uint32Array([1 | (7 << 5) | (2 << 10) | (3 << 15) | (4 << 20) | (2 << 25), 126 | (255 << 8)]),
  offsets: new Int32Array([0, 0, 0, 1, 1, 1, 1]) };
function metadata(size = 256) {
  const prepared = fixture(size), refs: BakedRegionRef[] = [];
  for (let rz = 0; rz < size / 256; rz++) for (let rx = 0; rx < size / 256; rx++)
    for (let level = 0; level < (rx || rz ? 4 : 1); level++)
      refs.push({ ...refFor(BAKED_REGION_HEADER_BYTES + 8), rx, rz, level, minY: 0, maxY: 32, quadCount: 1 });
  return createBakedMetadata(prepared, TEST_IDENTITY, refFor(BAKED_SURFACE_HEADER_BYTES + size ** 2 * 4), refs);
}
describe('portable immutable baked land', () => {
  it('writes fixed little-endian headers, offsets in quads and detached decoded arrays', () => {
    const bytes = encodeBakedRegion(mesh);
    expect(Array.from(bytes.subarray(0, 16))).toEqual([71, 68, 82, 49, 1, 0, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(bytes.subarray(64, 72))).toEqual([225, 136, 65, 4, 126, 255, 0, 0]);
    const result = decodeBakedRegion(bytes);
    expect(result).toEqual(mesh);
    bytes.fill(0);
    expect(result.quads).toEqual(mesh.quads);
  });
  it('handles unaligned network buffers and rejects truncation, overflow, reserved flags, bad bucket faces and spans', () => {
    const bytes = encodeBakedRegion(mesh), unaligned = new Uint8Array(bytes.length + 1);
    unaligned.set(bytes, 1); expect(decodeBakedRegion(unaligned.subarray(1))).toEqual(mesh);
    expect(() => decodeBakedRegion(bytes.subarray(0, -1))).toThrow();
    for (const [at, value] of [[24, 0xffffffff], [60, 1], [44, 4], [64, 0xffffffff]]) {
      const bad = bytes.slice(); new DataView(bad.buffer).setUint32(at!, value!, true);
      expect(() => decodeBakedRegion(bad)).toThrow();
    }
    expect(() => encodeBakedRegion({ ...mesh, level: 4 })).toThrow();
    expect(() => encodeBakedRegion({ ...mesh, rx: 16 })).toThrow();
    expect(() => encodeBakedRegion({ ...mesh, quads: new Uint32Array([0, 0]) })).toThrow();
  });
  it('preserves exact ground/water and supplies the existing native water owner without trees', () => {
    const { land, seated } = fixture(), i = 32 + 64 * land.size;
    land.ground[i] = 6; land.water[i] = 12;
    const encoded = encodeBakedSurface(land), result = decodeBakedSurface(encoded);
    expect(Buffer.from(result.ground.buffer).equals(Buffer.from(land.ground.buffer))).toBe(true);
    expect(Buffer.from(result.water.buffer).equals(Buffer.from(land.water.buffer))).toBe(true);
    expect(bakedVisualHeight(result, seated.seat, .1, .1)).toBe(-2);
    expect(bakedVisualHeight(result, seated.seat, -17, 0)).toBeNull();
    expect(bakedVisualHeight(result, seated.seat, NaN, 0)).toBeNull();
    const native = bakedNativeWater(result, seated.seat);
    expect(native.ground.data[i]).toBe(-2); expect(native.levels[i]).toBe(1);
    expect(native.levels[0]).toBeNaN(); expect(native.ground.origin).toEqual([-16, -32]);
    const bad = encoded.slice(); new DataView(bad.buffer).setUint32(8, 0xffffffff, true);
    expect(() => decodeBakedSurface(bad)).toThrow();
    expect(() => decodeBakedSurface(encoded.subarray(0, -1))).toThrow();
    land.ground[0] = land.height + 1;
    expect(() => encodeBakedSurface(land)).toThrow();
  });
  it('canonicalizes metadata, contains only projected public fields and freezes decoded values', async () => {
    const m = metadata(512), bytes = encodeBakedMetadata(m), decoded = decodeBakedMetadata(bytes);
    expect(decoded).toEqual(m); expect(Object.isFrozen(decoded.regions[0]!.meshes[0])).toBe(true);
    expect(await sha256Hex(bytes)).toBe(await sha256Hex(encodeBakedMetadata(metadata(512))));
    expect(new TextDecoder().decode(bytes)).not.toMatch(/trees|paved|citizen|millis|homes/);
    expect(bytes.length).toBeLessThan(BAKED_METADATA_BYTES);
    expect(() => decodeBakedMetadata(utf8(JSON.stringify(m, null, 2)))).toThrow(/canonical/);
    expect(() => decodeBakedMetadata(utf8(canonicalSceneJson({ ...m, citizen: 'private' })))).toThrow();
  });
  it('rejects incomplete LODs, coarse physical floor, inconsistent bounds and out-of-budget metadata', () => {
    const m = metadata(512);
    expect(() => encodeBakedMetadata({ ...m, regions: m.regions.slice(1) })).toThrow();
    expect(() => encodeBakedMetadata({ ...m, regions: m.regions.map((r, i) => i ? r : { ...r, exact: false }) })).toThrow();
    expect(() => encodeBakedMetadata({ ...m, regions: m.regions.map((r, i) => i === 1 ? { ...r, meshes: r.meshes.slice(1) } : r) })).toThrow();
    expect(() => encodeBakedMetadata({ ...m, bounds: { ...m.bounds, max: [1, 1, 1] } })).toThrow();
    expect(() => decodeBakedMetadata(new Uint8Array(BAKED_METADATA_BYTES + 1))).toThrow();
    expect(() => encodeBakedMetadata({ ...m, surface: { ...m.surface, rawBytes: 1 } })).toThrow();
  });
});
