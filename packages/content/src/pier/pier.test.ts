import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import { MAT } from '../materials';
import { allowedMaterials, meshCost, unsupported, voxels } from '../places/water/piece-checks';
import { BLUEPRINTS, createPierFurnishings } from './index';

describe('pier furnishings', () => {
  it('are strict, grounded, palette-locked and inexpensive in the production mesher', () => {
    expect(BLUEPRINTS).toHaveLength(21);
    expect(new Set(BLUEPRINTS.map(b => b.id)).size).toBe(21);
    for (const style of ['hearth', 'tide', 'grove'] as const) for (const { blueprint: b } of createPierFurnishings(style)) {
      expect(VoxelBlueprintSchema.parse(b)).toEqual(b);
      expect(b.boxes.length).toBeLessThanOrEqual(512);
      for (const box of b.boxes) {
        expect(allowedMaterials(style).has(box.material)).toBe(true);
        for (let i = 0; i < 3; i++) expect(box.to[i]!).toBeLessThanOrEqual(b.size[i]!);
      }
      expect(unsupported(b), b.id).toBe(0);
      expect(meshCost(b).triangles, b.id).toBeLessThan(4000);
    }
  });
  it('leaves lantern glass visible and the board face clear for real records', () => {
    for (const style of ['hearth', 'tide', 'grove'] as const) {
      const pieces = createPierFurnishings(style), lamp = pieces.find(p => p.kind === 'lantern')!, board = pieces.find(p => p.kind === 'board')!;
      expect(lamp.light).toEqual({ position: [2, 16, 2], reach: 32 });
      expect(voxels(lamp.blueprint).at(1, 16, 3)).toBe(MAT.glass);
      expect(board.text).toEqual({ centre: [8, 12, 5], facing: 'south', width: 12, height: 10 });
      for (let x = 2; x < 14; x++) for (let y = 7; y < 17; y++) {
        expect(voxels(board.blueprint).at(x, y, 4)).toBe(MAT.darkStone);
        expect(voxels(board.blueprint).at(x, y, 5)).toBe(0);
      }
    }
  });
});
