import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelAsset, type VoxelBlueprint } from '@chatdom/shared';
import { executeVoxelJob, rasterizeBlueprint, resultTransferables, unpackVoxelVertex, voxelIndex } from '@chatdom/voxel';
import { createRenderLodAsset } from '../../voxel/src/lod';
import { createHome, createTree } from '../../content/src/core';
import { MATERIALS, MAT, STYLES } from '../../content/src/materials';
import { createRenderLodJob } from './lod';

function blueprint(size: [number, number, number], boxes: VoxelBlueprint['boxes']): VoxelBlueprint {
  return VoxelBlueprintSchema.parse({ version: 1, id: 'lod-proof', styleId: 'hearth',
    kind: 'home', lattice: 'build', size, boxes, windows: [] });
}

/** Independent source-to-destination oracle, deliberately different from the block gather. */
function expectExactCoverage(source: VoxelAsset, reduced: VoxelAsset, factor: number): void {
  const occupied = new Uint8Array(reduced.voxels.length);
  for (let z = 0; z < source.size[2]; z++) for (let y = 0; y < source.size[1]; y++) for (let x = 0; x < source.size[0]; x++) {
    if (source.voxels[voxelIndex(x, y, z, source.size)] !== 0) {
      occupied[voxelIndex(Math.floor(x / factor), Math.floor(y / factor), Math.floor(z / factor), reduced.size)] = 1;
    }
  }
  expect(Uint8Array.from(reduced.voxels, material => Number(material !== 0))).toEqual(occupied);
}

describe('render-only voxel detail', () => {
  it.each([2, 4] as const)('retains one-cell walls and roof while leaving the wholly empty interior open at factor %i', (factor) => {
    const source = rasterizeBlueprint(blueprint([12, 12, 12], [
      { from: [0, 0, 0], to: [12, 12, 12], material: MAT.plaster },
      { from: [1, 1, 1], to: [11, 11, 11], material: MAT.air },
      { from: [0, 11, 0], to: [12, 12, 12], material: MAT.terracotta },
    ]), 17);
    const before = source.voxels.slice();
    const reduced = createRenderLodAsset(source, factor, MATERIALS.materials);
    expectExactCoverage(source, reduced, factor);
    expect(reduced.voxels[voxelIndex(1, 1, 1, reduced.size)]).toBe(MAT.air);
    expect(reduced.voxels[voxelIndex(1, reduced.size[1] - 1, 1, reduced.size)]).toBe(MAT.terracotta);
    expect(reduced.voxels[voxelIndex(0, 1, 1, reduced.size)]).toBe(MAT.plaster);
    expect(source.voxels).toEqual(before);
    expect(reduced).toMatchObject({ id: `lod-proof:renderlod:${factor}`, revision: 17, lattice: 'build' });
    expect(createRenderLodAsset(source, factor, MATERIALS.materials)).toEqual(reduced);
  });

  it('honours overlapping air cuts and later refills before deciding occupancy', () => {
    const original = blueprint([4, 4, 4], [
      { from: [0, 0, 0], to: [4, 4, 4], material: MAT.stone },
      { from: [0, 0, 0], to: [3, 4, 4], material: MAT.air },
      { from: [1, 0, 0], to: [4, 4, 4], material: MAT.air },
    ]);
    const before = structuredClone(original);
    expect(createRenderLodAsset(rasterizeBlueprint(original), 4, MATERIALS.materials).voxels).toEqual(new Uint16Array([0]));
    const refilled = { ...original, boxes: [...original.boxes,
      { from: [3, 3, 3], to: [4, 4, 4], material: MAT.brass } satisfies VoxelBlueprint['boxes'][number]] };
    expect(createRenderLodAsset(rasterizeBlueprint(refilled), 4, MATERIALS.materials).voxels).toEqual(new Uint16Array([MAT.brass]));
    expect(original).toEqual(before);
  });

  it('chooses categorical material mode, breaks ties by registry ID, and never averages IDs', () => {
    const source: VoxelAsset = { id: 'materials', revision: 1, lattice: 'build', size: [4, 2, 2],
      voxels: new Uint16Array([MAT.slate, MAT.plaster, MAT.slate, MAT.slate,
        MAT.plaster, MAT.slate, MAT.slate, MAT.plaster, MAT.slate, MAT.plaster, 0, 0, MAT.plaster, MAT.slate, 0, 0]) };
    expect(createRenderLodAsset(source, 2, MATERIALS.materials).voxels).toEqual(new Uint16Array([MAT.plaster, MAT.slate]));
    const highId = { ...MATERIALS.materials[1]!, id: 65535 };
    expect(createRenderLodAsset({ ...source, size: [1, 1, 1], voxels: new Uint16Array([65535]) }, 4, [highId]).voxels[0]).toBe(65535);
  });

  it.each([2, 4] as const)('bounds a partial edge block and matches final occupancy for irregular ordered boxes at factor %i', (factor) => {
    const boxes: VoxelBlueprint['boxes'] = [];
    for (let index = 0; index < 90; index++) {
      const x = index * 7 % 13, y = index * 3 % 10, z = index * 5 % 11;
      boxes.push({ from: [x, y, z], to: [Math.min(x + 3, 13), Math.min(y + 5, 10), Math.min(z + 7, 11)],
        material: index % 3 === 0 ? MAT.air : MAT.timber });
    }
    const source = rasterizeBlueprint(blueprint([13, 10, 11], boxes));
    const reduced = createRenderLodAsset(source, factor, MATERIALS.materials);
    expect(reduced.size).toEqual(source.size.map(axis => Math.ceil(axis / factor)));
    expectExactCoverage(source, reduced, factor);
    for (let axis = 0; axis < 3; axis++) {
      expect(reduced.size[axis]! * factor - source.size[axis]!).toBeGreaterThanOrEqual(0);
      expect(reduced.size[axis]! * factor - source.size[axis]!).toBeLessThan(factor);
    }
  });

  it('rejects unsupported factors, malformed rasters and unknown minority materials', () => {
    const source = rasterizeBlueprint(blueprint([4, 4, 4], [{ from: [0, 0, 0], to: [4, 4, 4], material: MAT.stone }]));
    expect(() => createRenderLodAsset(source, 3 as 2, MATERIALS.materials)).toThrow('factor');
    expect(() => createRenderLodAsset({ ...source, voxels: new Uint16Array(1) }, 2, MATERIALS.materials)).toThrow('dimensions');
    source.voxels[63] = 65535;
    expect(() => createRenderLodAsset(source, 4, MATERIALS.materials)).toThrow('Unknown voxel material 65535');
    expect(() => createRenderLodJob(blueprint([1, 1, 1], []), 3 as 2, MATERIALS)).toThrow('factor');
  });

  it('runs reduction in the existing worker job and retains original identity, revision and transferable meshes', () => {
    const original = blueprint([9, 4, 4], [{ from: [0, 0, 0], to: [9, 4, 4], material: MAT.stone }]);
    const before = structuredClone(original);
    const job = createRenderLodJob(original, 4, MATERIALS, 9);
    expect(job.blueprint).toBe(original);
    const result = executeVoxelJob({ ...job, id: 72 });
    if (result.kind !== 'asset') throw new Error('Expected asset meshes');
    expect(result).toMatchObject({ id: 72, assetId: original.id, revision: 9 });
    expect(result.chunks[0]!.mesh.stamp).toMatchObject({ key: 'lod-proof:renderlod:4:0,0,0', revision: 9, materialRevision: MATERIALS.revision });
    expect(result.chunks[0]!.mesh.stamp.dependencies).toContainEqual({ key: 'lod-proof:renderlod:4:full-sky', revision: 9 });
    const vertices = result.chunks[0]!.mesh.vertices;
    const xs = Array.from({ length: vertices.length / 2 }, (_, i) => unpackVoxelVertex(vertices[2 * i]!, vertices[2 * i + 1]!).x);
    expect(Math.max(...xs)).toBe(3);
    expect(resultTransferables(result)).toEqual(result.chunks.flatMap(({ mesh }) => [mesh.vertices.buffer, mesh.indices.buffer]));
    expect(original).toEqual(before);
  });

  it('keeps a real home doorway, pitched roof and tree canopy while reducing actual mesh cost', () => {
    for (const original of [createHome('cottage', 'hearth', 0), createTree(1)]) {
      const before = structuredClone(original);
      const source = rasterizeBlueprint(original);
      const triangles: number[] = [];
      for (const factor of [1, 2, 4] as const) {
        const job = factor === 1 ? { kind: 'blueprint' as const, blueprint: original, revision: 0,
          materials: MATERIALS.materials, materialRevision: MATERIALS.revision } : createRenderLodJob(original, factor, MATERIALS);
        const result = executeVoxelJob({ ...job, id: factor });
        if (result.kind !== 'asset') throw new Error('Expected asset meshes');
        triangles.push(result.chunks.reduce((sum, chunk) => sum + chunk.mesh.indices.length / 3, 0));
        if (factor !== 1) {
          const reduced = createRenderLodAsset(source, factor, MATERIALS.materials);
          expectExactCoverage(source, reduced, factor);
          if (original.kind === 'home') {
            // Floor through the middle of the actual open doorway, plus a point on each roof slope.
            expect(reduced.voxels[voxelIndex(Math.floor(29 / factor), Math.floor(8 / factor), Math.floor(73 / factor), reduced.size)]).toBe(0);
            expect(reduced.voxels).toContain(STYLES.hearth.roof);
          } else {
            expect(reduced.voxels).toContain(MAT.bark);
            expect(reduced.voxels).toContain(MAT.goldLeaf);
          }
        }
      }
      expect(triangles[1]!).toBeLessThan(triangles[0]! * 0.75);
      expect(triangles[2]!).toBeLessThan(triangles[0]! * 0.4);
      expect(original).toEqual(before);
    }
  });
});
