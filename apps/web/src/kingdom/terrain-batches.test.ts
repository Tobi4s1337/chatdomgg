import { expect, it } from 'vitest';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { StyleIdSchema } from '@chatdom/shared';
import { geometryFromChunks } from '@chatdom/render';
import { executeVoxelJob, type AssetChunkMesh } from '@chatdom/voxel';
import { terrainBatches } from './terrain-batches';

it('preserves all worker triangles and packed coordinates while culling offscreen terrain tiles', () => {
  const result = executeVoxelJob({ id: 1, kind: 'blueprint', revision: 0, materials: MATERIALS.materials, materialRevision: MATERIALS.revision,
    blueprint: { version: 1, id: 'tile-proof', kind: 'prop', styleId: StyleIdSchema.parse('hearth'), lattice: 'build', size: [8, 8, 8], windows: [],
      boxes: [{ from: [0, 0, 0], to: [8, 8, 8], material: 3 }] } });
  if (result.kind !== 'asset') throw new Error('Expected worker mesh');
  // Both sides of each tile boundary, including vertical layers in one tile.
  const chunks: AssetChunkMesh[] = ([ [0, 0, 0], [0, 1, 0], [3, 0, 0], [4, 0, 0], [0, 0, 4], [4, 0, 4] ] as const)
    .map(coordinate => ({ coordinate, mesh: result.chunks[0]!.mesh }));
  const tiles = terrainBatches(chunks);
  expect(tiles).toHaveLength(4);
  expect(tiles.flat()).toHaveLength(chunks.length);
  expect(new Set(tiles.flat()).size).toBe(chunks.length);
  const whole = geometryFromChunks(chunks, 'terrain');
  const geometries = tiles.map(tile => geometryFromChunks(tile, 'terrain'));
  try {
    expect(geometries.reduce((sum, geometry) => sum + geometry.index!.count, 0)).toBe(whole.index!.count);
    const offsets = new Map<AssetChunkMesh, number>();
    let offset = 0;
    for (const chunk of chunks) { offsets.set(chunk, offset); offset += chunk.mesh.vertices.length / 2; }
    for (const [tileIndex, tile] of tiles.entries()) {
      let tileOffset = 0, indexOffset = 0;
      for (const chunk of tile) {
        const start = offsets.get(chunk)!, count = chunk.mesh.vertices.length / 2;
        for (const name of ['aPacked', 'aMaterial']) {
          const actual = geometries[tileIndex]!.getAttribute(name).array;
          const expected = whole.getAttribute(name).array;
          expect(actual.slice(tileOffset, tileOffset + count)).toEqual(expected.slice(start, start + count));
        }
        expect(geometries[tileIndex]!.index!.array.slice(indexOffset, indexOffset + chunk.mesh.indices.length))
          .toEqual(Uint32Array.from(chunk.mesh.indices, index => index + tileOffset));
        indexOffset += chunk.mesh.indices.length;
        tileOffset += count;
      }
    }
    const camera = new THREE.PerspectiveCamera(50, 390 / 844, .15, 2200);
    const centre = whole.boundingBox!.getCenter(new THREE.Vector3());
    camera.position.copy(centre).add(new THREE.Vector3(0, 15, 15));
    camera.lookAt(centre); camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    expect(frustum.intersectsBox(whole.boundingBox!)).toBe(true);
    const visible = geometries.filter(geometry => frustum.intersectsBox(geometry.boundingBox!.clone().expandByScalar(2)));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(geometries.length);
  } finally { whole.dispose(); for (const geometry of geometries) geometry.dispose(); }
});
