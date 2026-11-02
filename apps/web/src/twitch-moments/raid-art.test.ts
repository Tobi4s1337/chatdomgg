import { describe, expect, it } from 'vitest';
import { MATERIALS } from '@chatdom/content';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import { meshVoxelChunk, prepareAssetChunks, rasterizeBlueprint } from '@chatdom/voxel';
import { raidParts, raidWagonBlueprint } from './raid-art';

const kits = ['hearth', 'tide'] as const;

describe.each(kits)('%s raid art', kit => {
  it('has unique, valid, registered parts within the prop budgets after production meshing', () => {
    const parts = raidParts(kit);
    expect(parts.length).toBeGreaterThan(20);
    expect(new Set(parts.map(part => part.id)).size).toBe(parts.length);
    const materials = new Set(MATERIALS.materials.map(material => material.id));
    for (const part of parts) {
      expect(VoxelBlueprintSchema.safeParse(part).success, part.id).toBe(true);
      expect(part.styleId, part.id).toBe(kit);
      expect(part.boxes.every(box => materials.has(box.material)), part.id).toBe(true);
      expect(part.boxes.length, part.id).toBeLessThanOrEqual(512);
      const asset = rasterizeBlueprint(part);
      const occupied = asset.voxels.reduce((count, material) => count + Number(material !== 0), 0);
      expect(occupied, part.id).toBeGreaterThan(0);
      expect(occupied, part.id).toBeLessThanOrEqual(20_000);
      const triangles = prepareAssetChunks(asset, MATERIALS.materials, MATERIALS.revision)
        .reduce((count, chunk) => count + meshVoxelChunk(chunk).indices.length / 3, 0);
      expect(triangles, part.id).toBeGreaterThan(0);
      expect(triangles, part.id).toBeLessThanOrEqual(40_000);
    }
  });

  it('keeps a covered wagon hollow with open ends beneath its roof and between its sides', () => {
    const asset = rasterizeBlueprint(raidWagonBlueprint(kit, 'covered', 'gules'));
    const [sx, sy] = asset.size;
    const at = (x: number, y: number, z: number) => asset.voxels[x + sx * (y + sy * z)];
    // A continuous cross-section of free headroom runs through both openings and the full wagon length.
    for (let x = 0; x <= 17; x++) for (let y = 9; y <= 14; y++) for (const z of [3, 4, 7, 8]) {
      expect(at(x, y, z), `air at ${x},${y},${z}`).toBe(0);
    }
    for (let x = 2; x <= 15; x++) {
      expect(at(x, 4, 5), `floor at ${x}`).not.toBe(0);
      expect(at(x, 17, 5), `roof at ${x}`).not.toBe(0);
      expect(at(x, 10, 0), `near side at ${x}`).not.toBe(0);
      expect(at(x, 10, 11), `far side at ${x}`).not.toBe(0);
    }
  });
});
