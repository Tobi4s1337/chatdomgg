import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import { MAT } from '../materials';
import { createDoorLantern, createGateBrazier } from './index';

describe('arrival lights', () => {
  it('uses registered materials and bounded, valid passive geometry for every style', () => {
    const palette = new Set<number>(Object.values(MAT));
    for (const style of ['hearth', 'tide', 'grove'] as const) for (const make of [createDoorLantern, createGateBrazier]) {
      const asset = make(style);
      expect(VoxelBlueprintSchema.safeParse(asset).success, asset.id).toBe(true);
      expect(asset.windows).toEqual([]);
      expect(asset.boxes.every(box => palette.has(box.material) && box.from.every((v, i) => v >= 0 && v < box.to[i]! && box.to[i]! <= asset.size[i]!)), asset.id).toBe(true);
      expect(make(style)).toEqual(asset);
    }
  });
});
