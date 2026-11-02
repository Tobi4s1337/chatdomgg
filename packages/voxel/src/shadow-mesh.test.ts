import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelMaterial } from '@chatdom/shared';
import { prepareAssetChunks, rasterizeBlueprint } from './asset';
import { meshVoxelChunk, type VoxelChunkMesh } from './mesh';
import { packVoxelVertex, unpackVoxelVertex } from './packing';
import { createOpaqueShadowChunks, mergeOpaqueShadowChunk } from './shadow-mesh';

const stone: VoxelMaterial = { id: 1, name: 'stone', solid: true, occludesFaces: true, occludesAo: true,
  blocksLight: true, colour: '#777777', surface: 'stone' };
const wood: VoxelMaterial = { ...stone, id: 2, name: 'wood', surface: 'wood' };
const glass: VoxelMaterial = { ...stone, id: 3, name: 'glass', surface: 'glass', occludesFaces: false, occludesAo: false, blocksLight: false };
const materials = [stone, wood, glass];

/** Expand each actual emitted rectangle into independently keyed oriented unit faces. */
function faces(mesh: VoxelChunkMesh, include: (material: number) => boolean): Set<string> {
  const out = new Set<string>();
  for (let q = 0; q < mesh.quadCount; q++) {
    const vertices = Array.from({ length: 4 }, (_, i) => unpackVoxelVertex(mesh.vertices[q * 8 + i * 2]!, mesh.vertices[q * 8 + i * 2 + 1]!));
    const v = vertices[0]!;
    if (!include(v.material)) continue;
    const axis = v.face >> 1, u = (axis + 1) % 3, w = (axis + 2) % 3;
    const coords = vertices.map(p => [p.x, p.y, p.z]);
    const loU = Math.min(...coords.map(p => p[u]!)), hiU = Math.max(...coords.map(p => p[u]!));
    const loV = Math.min(...coords.map(p => p[w]!)), hiV = Math.max(...coords.map(p => p[w]!));
    for (let a = loU; a < hiU; a++) for (let b = loV; b < hiV; b++) {
      const key = `${v.face}:${coords[0]![axis]}:${a}:${b}`;
      if (out.has(key)) throw new Error(`Duplicate emitted face ${key}`);
      out.add(key);
    }
  }
  return out;
}

function source() {
  // The doorway is carved after the wall, glass is installed into one opening, then a mullion restores stone.
  const blueprint = VoxelBlueprintSchema.parse({ version: 1, id: 'shadow-fixture', styleId: 'stone', kind: 'home', lattice: 'build',
    size: [34, 32, 4], boxes: [
      { from: [0, 0, 0], to: [34, 32, 4], material: 1 },
      { from: [2, 0, 0], to: [5, 6, 4], material: 0 },
      { from: [10, 2, 0], to: [15, 6, 4], material: 0 },
      { from: [10, 2, 1], to: [15, 6, 2], material: 3 },
      { from: [12, 2, 0], to: [13, 6, 4], material: 2 },
    ], windows: [] });
  const chunks = prepareAssetChunks(rasterizeBlueprint(blueprint, 5), materials, 7)
    .map(request => ({ coordinate: request.coordinate, mesh: meshVoxelChunk(request) }));
  return { blueprint, chunks };
}

describe('opaque shadow mesh', () => {
  it('preserves the exact oriented unit-face union, including ordered openings, glass and chunk edges', () => {
    const { chunks } = source(), shadows = createOpaqueShadowChunks(chunks, materials);
    expect(chunks).toHaveLength(2); expect(shadows).toHaveLength(2);
    const orientations = new Set<number>(); let plane32 = false, excludedGlass = 0;
    for (let i = 0; i < chunks.length; i++) {
      const input = chunks[i]!, output = shadows[i]!;
      expect(output.coordinate).toEqual(input.coordinate); expect(output.mesh.stamp).toEqual(input.mesh.stamp);
      const expected = faces(input.mesh, id => id !== 3), actual = faces(output.mesh, () => true);
      excludedGlass += faces(input.mesh, id => id === 3).size;
      expect(actual).toEqual(expected); expect(output.mesh.quadCount).toBeLessThanOrEqual(input.mesh.quadCount);
      for (const key of actual) { const [face, plane] = key.split(':').map(Number); orientations.add(face!); if (plane === 32) plane32 = true; }
    }
    expect(excludedGlass).toBeGreaterThan(0);
    expect(orientations).toEqual(new Set([0, 1, 2, 3, 4, 5]));
    expect(plane32).toBe(true);
  });

  it('merges contiguous coplanar faces despite independent material, AO and sky differences', () => {
    const { chunks } = source();
    const input = chunks[0]!.mesh;
    const output = mergeOpaqueShadowChunk(input, materials);
    expect(output.quadCount).toBeLessThan(input.quadCount);
    expect(faces(output, () => true)).toEqual(faces(input, id => id !== 3));
    expect(output.vertices.buffer).not.toBe(input.vertices.buffer);
    expect(output.indices.buffer).not.toBe(input.indices.buffer);
    for (let i = 0; i < output.vertices.length; i += 2) {
      const vertex = unpackVoxelVertex(output.vertices[i]!, output.vertices[i + 1]!);
      expect(vertex.ao).toBe(3); expect(vertex.sky).toBe(15);
    }
  });

  it('merges across material, AO and sky seams on the plane at coordinate 32', () => {
    const words: number[] = [], indices: number[] = [];
    for (let x = 0; x < 2; x++) {
      for (const [dx, y] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
        words.push(...packVoxelVertex({ x: x + dx, y, z: 32, face: 4,
          material: x + 1, ao: x, sky: x ? 13 : 2 }));
      }
      const base = x * 4; indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const input: VoxelChunkMesh = { stamp: { key: 'seams', revision: 2, materialRevision: 3, dependencies: [] },
      vertices: new Uint32Array(words), indices: new Uint32Array(indices), quadCount: 2,
      bounds: { min: [0, 0, 32], max: [2, 1, 32] } };
    const output = mergeOpaqueShadowChunk(input, materials);
    expect(output.quadCount).toBe(1);
    expect(faces(output, () => true)).toEqual(new Set(['4:32:0:0', '4:32:1:0']));
    expect(output.stamp).toEqual(input.stamp);
  });

  it('never invents the opaque face hidden by an occluding glass neighbour', () => {
    const opaqueGlass = { ...glass, occludesFaces: true };
    const blueprint = VoxelBlueprintSchema.parse({ version: 1, id: 'occluding-glass', styleId: 'stone', kind: 'prop', lattice: 'build',
      size: [2, 1, 1], boxes: [{ from: [0, 0, 0], to: [1, 1, 1], material: 1 },
        { from: [1, 0, 0], to: [2, 1, 1], material: 3 }], windows: [] });
    const chunk = prepareAssetChunks(rasterizeBlueprint(blueprint), [stone, opaqueGlass])[0]!;
    const colour = meshVoxelChunk(chunk), shadow = mergeOpaqueShadowChunk(colour, [stone, opaqueGlass]);
    const expected = faces(colour, id => id !== 3), actual = faces(shadow, () => true);
    expect(expected.has('0:1:0:0')).toBe(false);
    expect(actual.has('0:1:0:0')).toBe(false);
    expect(actual).toEqual(expected);
  });

  it('returns empty geometry for both empty and glass-only chunks', () => {
    const blueprint = VoxelBlueprintSchema.parse({ version: 1, id: 'glass-only', styleId: 'stone', kind: 'prop', lattice: 'build',
      size: [1, 1, 1], boxes: [{ from: [0, 0, 0], to: [1, 1, 1], material: 3 }], windows: [] });
    const colour = meshVoxelChunk(prepareAssetChunks(rasterizeBlueprint(blueprint), [glass])[0]!);
    expect(colour.quadCount).toBeGreaterThan(0);
    const empty: VoxelChunkMesh = { ...colour, vertices: new Uint32Array(), indices: new Uint32Array(), quadCount: 0, bounds: null };
    for (const input of [colour, empty]) {
      const result = mergeOpaqueShadowChunk(input, [glass]);
      expect(result.quadCount).toBe(0); expect(result.bounds).toBeNull();
      expect(result.vertices).toHaveLength(0); expect(result.indices).toHaveLength(0);
      expect(result.stamp).toEqual(input.stamp);
    }
  });

  it('falls back to the two original rectangles when greedy retiling would produce three', () => {
    const words: number[] = [], indices: number[] = [];
    for (const [u, v, width, height] of [[2, 2, 2, 1], [1, 3, 7, 4]] as const) {
      const base = words.length / 2;
      for (const [du, dv] of [[0, 0], [width, 0], [width, height], [0, height]] as const)
        words.push(...packVoxelVertex({ x: v + dv, y: 1, z: u + du, face: 2, material: 1, ao: 3, sky: 15 }));
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const colour: VoxelChunkMesh = { stamp: { key: 'fallback', revision: 1, materialRevision: 1, dependencies: [] },
      vertices: new Uint32Array(words), indices: new Uint32Array(indices), quadCount: 2,
      bounds: { min: [2, 1, 1], max: [7, 1, 8] } };
    const shadow = mergeOpaqueShadowChunk(colour, [stone]);
    expect(shadow.quadCount).toBe(2);
    expect(faces(shadow, () => true)).toEqual(faces(colour, () => true));
    expect(shadow.vertices).toEqual(colour.vertices); expect(shadow.indices).toEqual(colour.indices);
  });

  it('preserves caller bytes and rejects malformed or hostile mesh input', () => {
    const input = source().chunks[0]!.mesh, vertices = input.vertices.slice(), indices = input.indices.slice();
    mergeOpaqueShadowChunk(input, materials);
    expect(input.vertices).toEqual(vertices); expect(input.indices).toEqual(indices);
    const badIndex = indices.slice(); badIndex[0] = 0xffffffff;
    const badMaterial = vertices.slice(); badMaterial[1] = 65535;
    const badCoord = vertices.slice(); badCoord[0] = (badCoord[0]! & ~63) | 63;
    const badFace = vertices.slice(); badFace[0] = (badFace[0]! & ~(7 << 18)) | (7 << 18);
    const badCorner = vertices.slice(); const v = unpackVoxelVertex(badCorner[0]!, badCorner[1]!);
    badCorner.set(packVoxelVertex({ ...v, x: Math.min(32, v.x + 1) }), 0);
    for (const broken of [
      { ...input, indices: badIndex }, { ...input, vertices: badMaterial }, { ...input, vertices: badCoord },
      { ...input, vertices: badFace }, { ...input, vertices: badCorner }, { ...input, vertices: vertices.subarray(1) },
      { ...input, quadCount: 196_609 }, { ...input, bounds: null },
    ]) expect(() => mergeOpaqueShadowChunk(broken, materials)).toThrow();
  });
});
