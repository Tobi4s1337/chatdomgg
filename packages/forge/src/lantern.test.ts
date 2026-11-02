import { describe, expect, it } from 'vitest';
import { MAT } from '@chatdom/content/materials';
import { rasterizeBlueprint } from '@chatdom/voxel';
import type { ForgeHouseSocket } from '@chatdom/shared';
import { assembleForge, forgeStyleKit } from './index';

describe('lantern chamber', () => {
  for (const family of ['hearth', 'tide', 'grove'] as const) for (const profile of ['roof', 'wall'] as const) {
    it(`${family} ${profile}: glass encloses the glow and an opaque frame reaches the ornament`, () => {
      const socket: ForgeHouseSocket = { id: profile, kind: 'lantern', profile, origin: [0, 0, 0],
        supports: profile === 'wall' ? [[15, 4, -1], [16, 5, -1]] : [[15, 3, 15], [16, 3, 15], [15, 3, 16], [16, 3, 16]],
        hostId: 'fixture', hostFingerprint: 'fixture', clearanceHeight: 0 };
      const part = assembleForge({ version: 2, kind: 'lantern', motif: 'crescent-moon', finish: 'native', accent: 'none' }, forgeStyleKit(family, 2), socket);
      const { voxels, size: [sx, sy, sz] } = rasterizeBlueprint(part.blueprint);
      const index = (x: number, y: number, z: number) => x + sx * (y + sy * z);
      expect(voxels[index(...part.emitter)]).toBe(MAT.glass);
      const centreZ = profile === 'wall' ? 8 : 16, top = profile === 'wall' ? 4 : 7;
      const queue: [number, number, number][] = [profile === 'wall' ? [15, 4, 0] : [15, 3, 15]];
      const seen = new Set<number>([index(...queue[0]!) ]);
      for (let i = 0; i < queue.length; i++) {
        const [x, y, z] = queue[i]!;
        for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
          const X = x + dx!, Y = y + dy!, Z = z + dz!;
          if (X < 0 || X >= sx || Y < 0 || Y >= sy || Z < 0 || Z >= sz) continue;
          const n = index(X, Y, Z);
          if (!seen.has(n) && voxels[n] !== MAT.air && voxels[n] !== MAT.glass) { seen.add(n); queue.push([X, Y, Z]); }
        }
      }
      expect(seen.has(index(16, top + 9, centreZ))).toBe(true);
      // A broad exposed glass face remains between the frame and its caps.
      for (let x = 14; x < 18; x++) for (let y = top + 1; y < top + 7; y++)
        expect(voxels[index(x, y, centreZ + 1)]).toBe(MAT.glass);
    });
  }
});
