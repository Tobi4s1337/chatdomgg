import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ItemDefIdSchema, type Vec3, type VoxelAsset } from '@chatdom/shared';
import { executeVoxelJob } from '../../../voxel/src/protocol';
import { MATERIALS } from '../materials';
import { createFishModel, FISH_ITEM_DEFINITIONS, FISH_SPECIES } from '../fish';
import { voxelSheet } from '../fish/preview.test';
import { createFishMount, createKeepsakeModel, FISH_MOUNT_DEFINITIONS, fishMountId, fishOfMount, mountPoseOf } from './index';

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
function histogram(asset: VoxelAsset): Map<number, number> {
  const counts = new Map<number, number>();
  for (const m of asset.voxels) if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
  return counts;
}

describe('fish-mount keepsakes', () => {
  it('defines one numbered, unstacked keepsake per species, with valid ids and lore', () => {
    expect(FISH_MOUNT_DEFINITIONS).toHaveLength(FISH_SPECIES.length);
    expect(Object.isFrozen(FISH_MOUNT_DEFINITIONS)).toBe(true);
    const ids = new Set<string>();
    for (const [i, fish] of FISH_SPECIES.entries()) {
      const def = FISH_MOUNT_DEFINITIONS[i]!;
      expect(Object.isFrozen(def) && Object.isFrozen(def.places)).toBe(true);
      expect(ItemDefIdSchema.safeParse(def.id).success).toBe(true);
      expect(def.id).toBe(`keepsake:mount.${fish.id.slice(5)}`);
      expect(def).toEqual({ id: def.id, branch: 'kept', title: `${fish.name}, mounted`, lore: fish.lore, stack: null,
        keepsake: true, model: def.id, places: ['shelf', 'bag', 'away'] });
      expect(fishOfMount(def.id)).toBe(fish.id);
      expect(FISH_ITEM_DEFINITIONS.some(item => item.id === def.id)).toBe(false);
      ids.add(def.id);
    }
    expect(ids.size).toBe(FISH_SPECIES.length);
    expect(fishMountId('fish:moonlit-pike')).toBe('keepsake:mount.moonlit-pike');
    expect(fishOfMount('keepsake:mount.missing')).toBeNull();
    expect(fishOfMount('fish:moonlit-pike')).toBeNull();
    expect(() => fishMountId('moonlit-pike')).toThrow(/not a fish species/);
    expect(() => createKeepsakeModel('keepsake:mount.missing')).toThrow(/not a keepsake/);
    expect(() => createFishMount('fish:missing')).toThrow(/no authored fish/);
  });

  it('mounts every species as one deterministic, connected, meshable carved plaque', () => {
    const report: string[] = [];
    for (const fish of FISH_SPECIES) {
      const id = fishMountId(fish.id);
      const asset = createKeepsakeModel(id), again = createFishMount(fish.id);
      expect(asset.id).toBe(id); expect(asset.revision).toBe(1); expect(asset.lattice).toBe('avatar');
      expect(asset.voxels).toBeInstanceOf(Uint16Array);
      expect(asset.voxels.length).toBe(asset.size[0] * asset.size[1] * asset.size[2]);
      expect(asset.size.every(n => Number.isInteger(n) && n > 0 && n < 48)).toBe(true);
      expect(asset.voxels).toEqual(again.voxels);
      expect(asset.voxels.buffer).not.toBe(again.voxels.buffer);
      again.voxels[0] = 99; expect(asset.voxels[0]).not.toBe(99);
      expect([...asset.voxels].every(value => value === 0 || registered.has(value))).toBe(true);
      const cells = occupied(asset);
      expect(cells.length).toBeLessThan(12_000);
      expect(components(cells)).toBe(1);
      // The back is flat at z=0 and the whole fish is carried over, cell for cell, by its quarter turns.
      expect(cells.some(([, , z]) => z === 0)).toBe(true);
      const model = histogram(createFishModel(fish.id).asset), mount = histogram(asset);
      for (const [m, n] of model) expect(mount.get(m) ?? 0).toBeGreaterThanOrEqual(n);
      const result = executeVoxelJob({ id: 1, kind: 'asset', asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
      if (result.kind !== 'asset') throw new Error('Expected an asset mesh');
      const triangles = result.chunks.reduce((sum, chunk) => sum + chunk.mesh.indices.length / 3, 0);
      expect(triangles).toBeGreaterThan(0); expect(triangles).toBeLessThanOrEqual(24_000);
      report.push(`${id} ${mountPoseOf(createFishModel(fish.id).asset)} ${asset.size.join('x')} ${cells.length} cells ${triangles} tris`);
    }
    console.info(`Fish mounts:\n${report.join('\n')}`);
  }, 60_000);

  /** PIER_PREVIEW_MOUNTS=1, or a comma list of species ids, draws a CPU review sheet of mounts. */
  it.skipIf(!process.env.PIER_PREVIEW_MOUNTS)('draws a review sheet of mounts', () => {
    const wanted = process.env.PIER_PREVIEW_MOUNTS === '1'
      ? ['fish:bell-minnow', 'fish:copper-perch', 'fish:moonlit-pike', 'fish:lantern-eel', ...FISH_SPECIES.filter(f => f.legend).map(f => f.id)]
      : process.env.PIER_PREVIEW_MOUNTS!.split(',');
    const out = resolve(process.env.PIER_PREVIEW_OUT ?? `${process.cwd()}/../../shots/pier/mounts.png`);
    voxelSheet(wanted.map(createFishMount), out);
    console.info(`Mount sheet: ${out}`);
  });
});
