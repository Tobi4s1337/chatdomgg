import { describe, expect, it } from 'vitest';
import { MAT, STYLES } from '../materials';
import { rasterizeBlueprint } from '../../../voxel/src';
import { createForgeOrnament, type ForgeOrnament } from './index';

const tones = {
  hearth: { body: MAT.terracotta, shade: MAT.brick, light: MAT.limestone, dark: MAT.timber, gold: MAT.brass },
  tide: { body: MAT.slate, shade: MAT.darkStone, light: MAT.cream, dark: MAT.timber, gold: MAT.brass },
  grove: { body: MAT.moss, shade: MAT.bark, light: MAT.thatch, dark: MAT.bark, gold: MAT.goldLeaf },
} as const;

function raster(id: ForgeOrnament, family: keyof typeof tones) {
  const model = createForgeOrnament(id, family, 2);
  const { voxels, size: [sx, sy, sz] } = rasterizeBlueprint({ version: 1, id, kind: 'prop', styleId: STYLES[family].id, lattice: 'build', size: model.size, boxes: model.boxes, windows: [] });
  const index = (x: number, y: number, z: number) => x + sx * (y + sy * z);
  const at = (x: number, y: number, z: number) => voxels[index(x, y, z)];
  return { model, voxels, sx, sy, sz, index, at };
}

describe('revision two kit ornaments', () => {
  for (const family of ['hearth', 'tide', 'grove'] as const) {
    const t = tones[family];
    it(`${family}: keeps revision one and the sunflower, and redraws fox, star and shell`, () => {
      for (const id of ['sleeping-fox', 'sunflower', 'scallop-shell', 'shooting-star'] as const)
        expect(createForgeOrnament(id, family, 1)).toEqual(createForgeOrnament(id, family));
      expect(createForgeOrnament('sunflower', family, 2)).toEqual(createForgeOrnament('sunflower', family));
      for (const id of ['sleeping-fox', 'scallop-shell', 'shooting-star'] as const) {
        const { model, voxels, sx, sy, sz, index, at } = raster(id, family);
        const old = createForgeOrnament(id, family);
        expect(model).not.toEqual(old);
        expect(model.size).toEqual([24, 16, 18]);
        expect(model.mount).toEqual([12, 0, 9]);
        expect(at(...model.mount)).toBe(t.shade); // the modest foot stays at the mount
        // Inside the envelope already reserved by the other kit motifs, so lantern surveys are unchanged.
        for (const box of model.boxes) {
          expect(box.from[0]).toBeGreaterThanOrEqual(0);
          expect(box.to[0]).toBeLessThanOrEqual(23);
          expect(box.from[1]).toBeGreaterThanOrEqual(0);
          expect(box.to[1]).toBeLessThanOrEqual(16);
          expect(box.from[2]).toBeGreaterThanOrEqual(2);
          expect(box.to[2]).toBeLessThanOrEqual(17);
          for (let axis = 0; axis < 3; axis++) expect(box.to[axis]).toBeGreaterThan(box.from[axis]!);
        }
        const start = index(...model.mount), queue = [start], seen = new Set(queue);
        for (let i = 0; i < queue.length; i++) {
          const n = queue[i]!, x = n % sx, y = Math.floor(n / sx) % sy, z = Math.floor(n / (sx * sy));
          for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
            const X = x + dx!, Y = y + dy!, Z = z + dz!;
            if (X < 0 || X >= sx || Y < 0 || Y >= sy || Z < 0 || Z >= sz) continue;
            const next = index(X, Y, Z);
            if (voxels[next] !== MAT.air && !seen.has(next)) { seen.add(next); queue.push(next); }
          }
        }
        expect(seen.size).toBe(voxels.filter(n => n !== MAT.air).length);
      }
    });

    it(`${family}: the fox sits up in profile with finish-proof face, ears and brush`, () => {
      const { at } = raster('sleeping-fox', family);
      // Two tall, separate, dark-tipped ears reach the top of the cell.
      expect(at(6, 15, 6)).toBe(t.dark);
      expect(at(10, 15, 11)).toBe(t.dark);
      for (const z of [6, 9, 11]) expect(at(8, 13, z)).toBe(MAT.air);
      // Long muzzle with a dark nose, a closed eye over a pale cheek, on both sides.
      expect(at(0, 8, 8)).toBe(t.dark);
      for (const z of [6, 11]) { expect(at(5, 9, z)).toBe(t.dark); expect(at(4, 8, z)).toBe(t.light); }
      // Pale bib, dark stockings, and a long brush with a pale tip.
      expect(at(4, 5, 9)).toBe(t.light);
      expect(at(4, 2, 9)).toBe(t.dark);
      expect(at(22, 4, 9)).toBe(t.light);
      expect(at(17, 6, 9)).toBe(t.body);
    });

    it(`${family}: the shooting star is one bold five-pointed star with straight streaks behind it`, () => {
      const { at } = raster('shooting-star', family);
      for (const [x, y] of [[7, 15], [1, 11], [13, 11], [2, 3], [12, 3]] as const) expect(at(x, y, 8)).toBe(t.gold);
      expect(at(7, 5, 8)).toBe(MAT.air); // the notch between the two lower points
      expect(at(7, 10, 10)).toBe(t.gold); expect(at(7, 10, 6)).toBe(t.gold); // bevelled on both faces
      // Three separate light streaks, set back from the star's face.
      for (const [x, y] of [[14, 11], [22, 8], [12, 9], [21, 5], [12, 6], [19, 3]] as const) expect(at(x, y, 7)).toBe(t.light);
      expect(at(15, 10, 7)).toBe(MAT.air);
      expect(at(14, 11, 9)).toBe(MAT.air);
    });

    it(`${family}: the scallop shell has ribs, grooves, a bumpy rim and two ears on both faces`, () => {
      const { at } = raster('scallop-shell', family);
      for (const z of [5, 6, 11, 12]) expect(at(12, 12, z)).toBe(t.light); // domed central rib
      expect(at(7, 12, 10)).toBe(t.shade); expect(at(7, 12, 7)).toBe(t.shade); // recessed grooves
      expect(at(7, 12, 11)).toBe(MAT.air);
      expect(at(6, 3, 9)).toBe(t.body); expect(at(18, 3, 9)).toBe(t.body); // the ears at the hinge
      expect(at(7, 4, 9)).toBe(MAT.air);
      expect(at(7, 15, 9)).toBe(t.body); expect(at(8, 15, 9)).toBe(MAT.air); // small rim bumps
      expect(at(12, 15, 9)).toBe(t.body); // one rounded crown, never a two-lobed top
    });
  }
});
