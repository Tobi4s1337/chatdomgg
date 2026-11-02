import { describe, expect, it } from 'vitest';
import { MAT } from '@chatdom/content';
import { unpackVoxelVertex } from '@chatdom/voxel';
import { generateSettlementPlan } from '@chatdom/world';
import { meshTerrainSurface, prepareTerrainField, sampleRenderedTerrainHeight, terrainSurfaceChunks } from './terrain-worker';
import { todayLandSurface } from './terrain-surface';

describe("today's land surface", () => {
  const plan = generateSettlementPlan({ seed: 'surface-today', tier: 'hamlet', firstYear: 2025, year: 2026 });
  const surfaceAt = todayLandSurface(plan, () => plan.lake.level);

  it('names the material the mesher drew for each metre patch and its rendered height', { timeout: 120_000 }, () => {
    const field = prepareTerrainField(plan), shading = { ao: new Uint8Array(field.heights.length), sky: new Uint16Array(field.heights.length) };
    const counts = new Map<string, number>(), wrong: string[] = [];
    for (const coordinate of terrainSurfaceChunks(field).slice(0, 48)) {
      const mesh = meshTerrainSurface(field, coordinate, { revision: 1, key: field.key } as never, shading);
      // One quad per metre patch: its first vertex is the patch's southwest corner, every vertex carries its material.
      for (let q = 0; q < mesh.vertices.length / 8; q++) {
        const v = unpackVoxelVertex(mesh.vertices[q * 8]!, mesh.vertices[q * 8 + 1]!);
        const x = field.origin[0] + coordinate[0] * 16 + v.x * .5 + .4, z = field.origin[2] + coordinate[2] * 16 + v.z * .5 + .3;
        const sample = surfaceAt(x, z);
        if (!sample) continue;
        const expected = v.material === MAT.waterbed ? 'sand' : v.material === MAT.paving ? 'cobble' : 'grass';
        if (sample.surface !== expected) wrong.push(`${x},${z} ${sample.surface}≠${expected}`);
        if (sample.drawnY !== sampleRenderedTerrainHeight(plan, x, z)) wrong.push(`${x},${z} height`);
        counts.set(expected, (counts.get(expected) ?? 0) + 1);
      }
    }
    expect(wrong.slice(0, 8)).toEqual([]);
    expect(counts.get('grass')).toBeGreaterThan(100);
  });

  it('reports water over the drawn ground and nothing outside the terrain', () => {
    const lake = plan.lake, wet = surfaceAt(lake.x, lake.z)!;
    expect(wet.waterDepth).toBeGreaterThan(0);
    expect(wet.waterDepth).toBeCloseTo(lake.level - wet.drawnY, 9);
    expect(surfaceAt(plan.bounds.maxX + 2, plan.bounds.minZ)).toBeNull();
    expect(todayLandSurface(plan)(lake.x, lake.z)!.waterDepth).toBe(0);
  });
});
