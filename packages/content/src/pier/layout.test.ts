import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import { PIER_REVIEW_SITE } from '../places/water/pier';
import { allowedMaterials, meshCost } from '../places/water/piece-checks';
import { createFishingPier } from './layout';

describe('fishing pier content', () => {
  it.each(['hearth', 'tide', 'grove'] as const)('%s merges furnishings into valid, affordable deck modules', style => {
    const pier = createFishingPier(style, PIER_REVIEW_SITE);
    expect(pier).toEqual(createFishingPier(style, PIER_REVIEW_SITE));
    expect(pier.modules.length).toBeGreaterThan(1);
    expect(pier.modules.length).toBeLessThanOrEqual(9);
    expect(new Set(pier.modules.map(m => m.id)).size).toBe(pier.modules.length);
    expect(pier.lights.length).toBeGreaterThanOrEqual(4);
    expect(pier.lights.every(l => l.reach > 0 && l.at.every(Number.isFinite))).toBe(true);
    let triangles = 0;
    for (const module of pier.modules) {
      const blueprint = VoxelBlueprintSchema.parse(module.blueprint);
      expect(blueprint.styleId).toBe(style);
      expect(blueprint.boxes.length).toBeGreaterThan(0);
      expect(blueprint.boxes.every(box => allowedMaterials(style).has(box.material))).toBe(true);
      for (const box of blueprint.boxes) for (let axis = 0; axis < 3; axis++) {
        expect(box.from[axis]).toBeGreaterThanOrEqual(0);
        expect(box.to[axis]).toBeLessThanOrEqual(blueprint.size[axis]!);
        expect(box.to[axis]).toBeGreaterThan(box.from[axis]!);
      }
      triangles += meshCost(blueprint).triangles;
    }
    expect(triangles).toBeLessThanOrEqual(80_000);
    expect(pier.anchors.fishing).toHaveLength(3);
  }, 120_000);
});
