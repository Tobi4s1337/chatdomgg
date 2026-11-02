import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import type { Vec3, VoxelAsset } from '@chatdom/shared';
import { executeVoxelJob } from '../../../voxel/src/protocol';
import { MATERIALS } from '../materials';
import { createWillowRod, WILLOW_ROD_DEFINITION } from '../pier/rod';
import { createFishModel, FISH_ITEM_DEFINITIONS, FISH_SPECIES } from './index';

const registered = new Set(MATERIALS.materials.filter(material => material.id !== 0).map(material => material.id));
function occupied(asset: VoxelAsset): Vec3[] {
  const [sx, sy, sz] = asset.size, points: Vec3[] = [];
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) if (asset.voxels[x + sx * (y + sy * z)]) points.push([x, y, z]);
  return points;
}
function components(cells: readonly Vec3[]): number {
  const remaining = new Set(cells.map(cell => cell.join(','))); let count = 0;
  while (remaining.size) {
    count++; const start = remaining.values().next().value!; remaining.delete(start);
    const queue = [start];
    while (queue.length) {
      const [x, y, z] = queue.pop()!.split(',').map(Number) as [number, number, number];
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const neighbour = [x + dx, y + dy, z + dz].join(',');
        if (remaining.delete(neighbour)) queue.push(neighbour);
      }
    }
  }
  return count;
}
const inBounds = (point: Vec3, size: Vec3) => point.every((coordinate, axis) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= size[axis]!);
function check(asset: VoxelAsset, anchors: readonly Vec3[]) {
  expect(asset.lattice).toBe('avatar');
  expect(asset.size.every(value => Number.isInteger(value) && value > 0 && value <= 32)).toBe(true);
  expect(asset.voxels).toBeInstanceOf(Uint16Array);
  expect(asset.voxels.length).toBe(asset.size[0] * asset.size[1] * asset.size[2]);
  expect([...asset.voxels].every(value => value === 0 || registered.has(value))).toBe(true);
  const cells = occupied(asset);
  expect(cells.length).toBeGreaterThan(0); expect(cells.length).toBeLessThanOrEqual(4096);
  expect(components(cells)).toBe(1);
  expect(anchors.every(anchor => inBounds(anchor, asset.size))).toBe(true);
  const result = executeVoxelJob({ id: 1, kind: 'asset', asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
  expect(result.kind).toBe('asset');
  if (result.kind !== 'asset') throw new Error('Expected an asset mesh');
  const triangles = result.chunks.reduce((sum, chunk) => sum + chunk.mesh.indices.length / 3, 0);
  expect(triangles).toBeGreaterThan(0); expect(triangles).toBeLessThanOrEqual(12_000);
  return { cells, triangles };
}

it('authors twelve distinct, connected fish with independent buffers and real meshed geometry', () => {
  expect(FISH_SPECIES).toHaveLength(12);
  expect(new Set(FISH_SPECIES.map(fish => fish.id)).size).toBe(12);
  expect(new Set(FISH_SPECIES.map(fish => fish.name)).size).toBe(12);
  expect(FISH_ITEM_DEFINITIONS.map(def => def.id)).toEqual(FISH_SPECIES.map(fish => fish.id));
  const shapes = new Set<string>(), costs: string[] = [];
  for (const fish of FISH_SPECIES) {
    const first = createFishModel(fish.id), second = createFishModel(fish.id);
    expect(first.asset.id).toBe(fish.id);
    expect(first.asset.voxels).toEqual(second.asset.voxels);
    expect(first.asset.voxels).not.toBe(second.asset.voxels);
    expect(first.asset.voxels.buffer).not.toBe(second.asset.voxels.buffer);
    const { cells, triangles } = check(first.asset, [first.mouth, first.tail]);
    // Translation-normalized occupancy, with colours removed: recolouring a shape cannot make it unique.
    const minima = [0, 1, 2].map(axis => Math.min(...cells.map(cell => cell[axis]!)));
    const shape = cells.map(cell => cell.map((value, axis) => value - minima[axis]!).join(',')).sort().join(';');
    shapes.add(createHash('sha256').update(shape).digest('hex'));
    costs.push(`${fish.id}=${triangles}`);
  }
  expect(shapes.size).toBe(12);
  console.info(`Fish triangles: ${costs.join(', ')}`);
  expect(() => createFishModel('fish:missing')).toThrow();
});

it('builds a deterministic, face-connected willow rod with valid grip, tip and mesh', () => {
  const rod = createWillowRod(), again = createWillowRod();
  expect(rod.asset.id).toBe(WILLOW_ROD_DEFINITION.id);
  expect(rod.asset.voxels).toEqual(again.asset.voxels);
  expect(rod.asset.voxels.buffer).not.toBe(again.asset.voxels.buffer);
  const { triangles } = check(rod.asset, [rod.grip, rod.tip]);
  expect(rod.tip[1]).toBeGreaterThan(rod.grip[1]);
  console.info(`Rod triangles: ${triangles}`);
});
