import { describe, expect, it } from 'vitest';
import { createForgeMotif } from '@chatdom/content/forge-motifs';
import { MAT, STYLES } from '@chatdom/content/materials';
import { rasterizeBlueprint } from '@chatdom/voxel';
import type { ForgeHouseSocket, VoxelBlueprint } from '@chatdom/shared';
import { assembleForge, forgeStyleKit } from './index';

const families = ['hearth', 'tide', 'grove'] as const;
const profiles = ['wall', 'roof'] as const;
function socket(profile: typeof profiles[number]): ForgeHouseSocket {
  return { id: profile, kind: 'lantern', profile, origin: [0, 0, 0],
    supports: profile === 'wall' ? [[15, 4, -1], [16, 5, -1]] : [[15, 3, 15], [16, 3, 15], [15, 3, 16], [16, 3, 16]],
    hostId: 'fixture', hostFingerprint: 'fixture', clearanceHeight: 0 };
}

/** Only opaque cells count: glass can never carry this path. */
function reachesMount(blueprint: VoxelBlueprint, profile: typeof profiles[number]): boolean {
  const { voxels, size: [sx, sy, sz] } = rasterizeBlueprint(blueprint);
  const index = (x: number, y: number, z: number) => x + sx * (y + sy * z);
  const start = profile === 'wall' ? [15, 4, 0] : [15, 3, 15];
  const target = profile === 'wall' ? [16, 4, 8] : [16, 7, 16];
  const opaque = (n: number) => n !== MAT.air && n !== MAT.glass;
  const queue = [start], seen = new Set([index(start[0]!, start[1]!, start[2]!)]);
  for (let i = 0; i < queue.length; i++) {
    const [x, y, z] = queue[i]!;
    if (x === target[0] && y === target[1] && z === target[2]) return true;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const X = x! + dx!, Y = y! + dy!, Z = z! + dz!;
      if (X < 0 || X >= sx || Y < 0 || Y >= sy || Z < 0 || Z >= sz) continue;
      const n = index(X, Y, Z);
      if (!seen.has(n) && opaque(voxels[n]!)) { seen.add(n); queue.push([X, Y, Z]); }
    }
  }
  return false;
}

describe('lantern structural support', () => {
  for (const family of families) for (const profile of profiles) {
    it(`${family} ${profile}: opaque support reaches the finished moon through the glass`, () => {
      for (const finish of ['native', 'copper', 'ceramic'] as const) for (const accent of ['none', 'stars', 'leaves', 'scales'] as const) {
        const result = assembleForge({ version: 2, kind: 'lantern', motif: 'crescent-moon', finish, accent }, forgeStyleKit(family), socket(profile));
        expect(reachesMount(result.blueprint, profile), `${finish} / ${accent}`).toBe(true);
        expect(rasterizeBlueprint(result.blueprint).voxels.includes(MAT.glass)).toBe(true);
      }
    });
    it(`${family} ${profile}: legacy lantern retains its original boxes`, () => {
      const result = assembleForge({ version: 1, kind: 'lantern', motif: 'crescent-moon' }, forgeStyleKit(family), socket(profile));
      const motif = createForgeMotif('crescent-moon', family);
      const base: VoxelBlueprint['boxes'] = profile === 'wall'
        ? [{ from: [15, 4, 0], to: [17, 6, 9], material: MAT.brass }, { from: [14, 2, 0], to: [18, 8, 1], material: STYLES[family].trim }]
        : [15, 16].flatMap(x => [15, 16].map(z => ({ from: [x, 3, z] as [number, number, number], to: [x + 1, 5, z + 1] as [number, number, number], material: STYLES[family].stone })));
      // The roof support's input order is explicitly preserved by assembly.
      if (profile === 'roof') { [base[1], base[2]] = [base[2]!, base[1]!]; base.push({ from: [15, 5, 15], to: [17, 7, 17], material: MAT.brass }); }
      const offset = [16 - motif.mount[0], (profile === 'wall' ? 4 : 7) - motif.mount[1], (profile === 'wall' ? 8 : 16) - motif.mount[2]];
      const authored = motif.boxes.map(b => ({ material: b.material, from: b.from.map((n, i) => n + offset[i]!), to: b.to.map((n, i) => n + offset[i]!) }));
      expect(result.blueprint.boxes).toEqual([...base, ...authored]);
    });
  }
});
