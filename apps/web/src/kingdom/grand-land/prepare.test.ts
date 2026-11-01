import { describe, expect, it } from 'vitest';
import { grandRecipeFor } from './recipes';
import { grandLandRecipeHash } from '../../../../../packages/world/src/grand/recipe';
import { installedVisualHeight, regionTouchesPhysical, restoreInstalledFloor } from './prepare';
import type { SeatedKingdom } from '../../../../../packages/world/src/grand/kingdom';
import type { GrandLand } from '../../../../../packages/world/src/grand/types';
import { HOSTED_PAVING } from './palette';
import { createVoxelizeContext, voxelizeChunk } from '../../../../../packages/world/src/grand/voxelize';
import { createQuadBuckets, meshQuadChunk, packQuadBuckets, unpackQuad } from '../../../../../packages/voxel/src/grand/quad-mesher';

const seated = {
  seat: { offset: [16, 5, 32], columns: { x0: 32, z0: 64, x1: 64, z1: 96 }, band: 96 },
  paved: new Uint8Array(128 * 128),
} as unknown as SeatedKingdom;

describe('the hosted land keeps the installed floor', () => {
  it('opts in only the kingdom with a pinned adoption recipe', async () => {
    const recipe = grandRecipeFor('129634568')!;
    expect(recipe.seed.seedKey).toContain('129634568');
    expect(recipe.seed.minSize).toBe(2560);
    expect(grandRecipeFor('other-kingdom')).toBeUndefined();
    expect(grandRecipeFor(undefined)).toBeUndefined();
    expect(grandRecipeFor('tobi4s_')).toBeUndefined();
    expect(await grandLandRecipeHash(recipe)).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(recipe.frame.envelope)).toBe(true);
  });

  it('restores exact top, paving and empty air after the cosmetic voxeliser, including halos', () => {
    const ground = new Uint16Array(128 * 128).fill(8), water = new Uint16Array(128 * 128);
    const land = { size: 128, ground, water, seaLevel: 0 } as GrandLand;
    const volume = new Uint8Array(34 ** 3).fill(48); // a canopy/tuft cannot remain over the installed floor
    const index = (x: number, y: number, z: number) => x + 1 + (y + 1) * 34 + (z + 1) * 34 * 34;
    seated.paved[32 + 64 * 128] = 1;
    restoreInstalledFloor(land, seated, 1, 0, 2, volume);
    expect(volume[index(0, 7, 0)]).toBe(HOSTED_PAVING);
    expect(volume[index(0, 8, 0)]).toBe(0);
    expect(volume[index(0, 31, 0)]).toBe(0);
    expect(volume[index(1, 7, 0)]).toBe(48); // beneath the exact top its original material survives
    expect(volume[index(-1, 8, 0)]).toBe(48); // outside the installed region is the canonical grand source
    const neighbour = new Uint8Array(34 ** 3).fill(48);
    restoreInstalledFloor(land, seated, 0, 0, 2, neighbour);
    expect(neighbour[index(32, 8, 0)]).toBe(0); // shared halo is corrected from exactly the same columns
    expect(neighbour[index(32, 7, 0)]).toBe(HOSTED_PAVING);
  });

  it('keeps the real lake volume below its top and rejects far visual samples', () => {
    const ground = new Uint16Array(128 * 128).fill(8), water = new Uint16Array(128 * 128).fill(12);
    const land = { size: 128, ground, water, seaLevel: 4 } as GrandLand;
    const volume = new Uint8Array(34 ** 3);
    const index = (y: number) => 1 + (y + 1) * 34 + 34 * 34;
    restoreInstalledFloor(land, seated, 1, 0, 2, volume);
    expect(volume[index(9)]).toBe(36);
    expect(volume[index(12)]).toBe(0);
    expect(installedVisualHeight(land, seated, 1, 1)).toBe(-1);
    expect(installedVisualHeight(land, seated, -1000, 1)).toBeNull();
    expect(installedVisualHeight(land, seated, NaN, 1)).toBeNull();
  });

  it('pins every intersecting region, including an unaligned physical edge', () => {
    const edge = { ...seated, seat: { ...seated.seat, columns: { x0: 255, z0: 256, x1: 300, z1: 512 } } };
    expect(regionTouchesPhysical(0, 1, edge)).toBe(true);
    expect(regionTouchesPhysical(1, 1, edge)).toBe(true);
    expect(regionTouchesPhysical(1, 2, edge)).toBe(false);
  });

  it('draws the same exact physical top through the real voxeliser and packed-quad mesher', () => {
    const n = 128 * 128;
    const land = { size: 128, height: 64, seaLevel: 0, snowline: 50,
      seed: { seedKey: 'hosted-floor-mesh' }, style: { stone: 'granite', grass: 'summer', hueDrift: 0, autumn: 0 },
      structureColours: [], structures: new Int32Array(), structureCount: 0,
      ground: new Uint16Array(n).fill(8), water: new Uint16Array(n), cover: new Uint8Array(n).fill(13),
      plot: new Uint16Array(n), plots: [], trees: new Float32Array(), treeCount: 0,
    } as unknown as GrandLand;
    const context = createVoxelizeContext(land), volume = new Uint8Array(34 ** 3);
    voxelizeChunk(context, 0, 1, 0, 2, volume);
    restoreInstalledFloor(land, seated, 1, 0, 2, volume);
    const flags = new Uint8Array(256).fill(3); flags[0] = 0;
    const buckets = createQuadBuckets(); meshQuadChunk(volume, flags, 0, buckets);
    const { quads } = packQuadBuckets(buckets);
    const tops = [];
    for (let i = 0; i < quads.length; i += 2) {
      const quad = unpackQuad(quads[i]!, quads[i + 1]!);
      if (quad.face === 2) tops.push(quad);
    }
    expect(tops.length).toBeGreaterThan(0);
    expect(tops.every(quad => (quad.y + 1) * .5 - seated.seat.offset[1] === -1)).toBe(true);
    expect(tops.some(quad => quad.material === HOSTED_PAVING)).toBe(true);
  });
});
