import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { KingdomIdSchema, kingdomHoldsFish, type Vec3, type VoxelAsset } from '@chatdom/shared';
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

const COUNT = FISH_SPECIES.length;

it('authors 24 to 30 fish with lore and a riddle each, from common through four legends', () => {
  expect(COUNT).toBeGreaterThanOrEqual(24); expect(COUNT).toBeLessThanOrEqual(30);
  const legends = FISH_SPECIES.filter(fish => fish.legend);
  expect(legends).toHaveLength(4);
  expect(legends.every(fish => fish.rarity === 'rare')).toBe(true);
  for (const rarity of ['common', 'uncommon', 'rare'] as const) expect(FISH_SPECIES.some(fish => fish.rarity === rarity)).toBe(true);
  for (const fish of FISH_SPECIES) {
    expect(fish.lore.length).toBeGreaterThan(40); expect(fish.riddle.length).toBeGreaterThan(20);
    expect(fish.lore).not.toBe(fish.riddle);
    if (fish.share !== undefined) { expect(fish.share).toBeGreaterThan(0); expect(fish.share).toBeLessThan(1); }
  }
  expect(new Set(FISH_SPECIES.map(fish => fish.riddle)).size).toBe(COUNT);
});

it('lets every kingdom catch at least fourteen fish at its own lake pier, and not the same fourteen everywhere', () => {
  const lake = FISH_SPECIES.filter(fish => fish.waters.includes('lake') && fish.biomes.includes('*'));
  const seen = new Set<string>();
  for (let n = 0; n < 400; n++) {
    const kingdomId = KingdomIdSchema.parse(String(1000 + n * 7919));
    const held = lake.filter(fish => kingdomHoldsFish(kingdomId, fish)).map(fish => fish.id);
    expect(held.length).toBeGreaterThanOrEqual(14);
    seen.add(held.join(','));
  }
  expect(seen.size).toBeGreaterThan(8);
  // Some fish live only elsewhere: the sea, or a biome no founded lake pier has.
  expect(FISH_SPECIES.some(fish => !fish.waters.includes('lake') || !fish.biomes.includes('*'))).toBe(true);
});

it('authors distinct, connected fish with independent buffers and real meshed geometry', () => {
  expect(new Set(FISH_SPECIES.map(fish => fish.id)).size).toBe(COUNT);
  expect(new Set(FISH_SPECIES.map(fish => fish.name)).size).toBe(COUNT);
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
  expect(shapes.size).toBe(COUNT);
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
