import { describe, expect, it } from 'vitest';
import { MAT, STYLES } from '../materials';
import { rasterizeBlueprint } from '../../../voxel/src';
import { createForgeOrnament } from './index';

describe('sleeping fox kit revision', () => {
  for (const family of ['hearth', 'tide', 'grove'] as const) {
    it(`${family}: keeps legacy output and builds a connected revision two`, () => {
      const old = createForgeOrnament('sleeping-fox', family);
      expect(createForgeOrnament('sleeping-fox', family, 1)).toEqual(old);
      for (const other of ['sunflower', 'scallop-shell', 'shooting-star'] as const)
        expect(createForgeOrnament(other, family, 2)).toEqual(createForgeOrnament(other, family));
      const fox = createForgeOrnament('sleeping-fox', family, 2);
      expect(fox).not.toEqual(old);
      expect(fox.mount).toEqual(old.mount);
      expect(fox.size).toEqual(old.size);
      for (const box of fox.boxes) for (let axis = 0; axis < 3; axis++) {
        expect(box.from[axis]).toBeGreaterThanOrEqual(0);
        expect(box.to[axis]).toBeLessThanOrEqual(fox.size[axis]!);
      }
      const { voxels, size: [sx, sy, sz] } = rasterizeBlueprint({ version: 1, id: 'fox', kind: 'prop', styleId: STYLES[family].id, lattice: 'build', size: fox.size, boxes: fox.boxes, windows: [] });
      const index = (x: number, y: number, z: number) => x + sx * (y + sy * z);
      const start = index(...fox.mount), queue = [start], seen = new Set(queue);
      expect(voxels[start]).not.toBe(MAT.air);
      for (let i = 0; i < queue.length; i++) {
        const n = queue[i]!, x = n % sx, y = Math.floor(n / sx) % sy, z = Math.floor(n / (sx * sy));
        for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
          const X=x+dx!, Y=y+dy!, Z=z+dz!;
          if (X<0 || X>=sx || Y<0 || Y>=sy || Z<0 || Z>=sz) continue;
          const next=index(X,Y,Z);
          if (voxels[next] !== MAT.air && !seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      expect(seen.size).toBe(voxels.filter(n => n !== MAT.air).length);
    });
  }
});
