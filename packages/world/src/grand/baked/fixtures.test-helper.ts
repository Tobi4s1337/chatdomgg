import type { GrandLand } from '../types';
import type { PreparedGrandLand } from './prepare';
import type { BakedBlobRef, BakedIdentity } from './types';

export const TEST_IDENTITY: BakedIdentity = { kingdomId: '129634568', recipeHash: 'a'.repeat(64),
  sourcePlanHash: 'b'.repeat(64), sourcePlanRevision: 'test-plan-1' };
export const refFor = (rawBytes: number): BakedBlobRef => ({ hash: 'c'.repeat(64), rawBytes, gzipHash: 'd'.repeat(64), gzipBytes: 64 });
export function fixture(size = 256): PreparedGrandLand {
  const n = size ** 2;
  const land = { size, height: 256, seaLevel: 0, snowline: 200,
    seed: { kingdomId: TEST_IDENTITY.kingdomId, seedKey: 'baked-floor-mesh' },
    style: { stone: 'granite', grass: 'summer', hueDrift: 0, autumn: 0 },
    structureColours: [], structures: new Int32Array(), structureCount: 0,
    ground: new Uint16Array(n).fill(8), water: new Uint16Array(n), cover: new Uint8Array(n).fill(13),
    plot: new Uint16Array(n), plots: [], trees: new Float32Array(), treeCount: 0,
  } as unknown as GrandLand;
  return { land, seated: { seat: { offset: [16, 5, 32], columns: { x0: 32, z0: 64, x1: 64, z1: 96 }, band: 96 },
    paved: new Uint8Array(n), identity: { planRevision: TEST_IDENTITY.sourcePlanRevision,
      region: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 } } } as unknown as PreparedGrandLand['seated'] };
}
