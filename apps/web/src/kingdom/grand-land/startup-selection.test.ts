import { describe, expect, it } from 'vitest';
import { BAKED_COMPILERS, type BakedMetadata } from '../../../../../packages/world/src/grand/baked/types';
import { planStartupCoverage, STARTUP_BUDGET_BYTES, stepBalancedLevels } from './startup-selection';

function metadata(): BakedMetadata {
  const hash = 'a'.repeat(64), blob = { hash, gzipHash: hash, rawBytes: 32, gzipBytes: 50 };
  return { version: 1, kingdomId: '123', recipeHash: hash, sourcePlanHash: hash, sourcePlanRevision: 'plan',
    compilers: BAKED_COMPILERS, size: 384, height: 32, seaLevel: 0,
    seat: { offset: [0, 0, 0], columns: { x0: 0, z0: 0, x1: 16, z1: 16 }, band: 96 },
    physicalRegion: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 }, bounds: { min: [0, 0, 0], max: [192, 16, 192] },
    palette: [], surface: blob, regions: Array.from({ length: 9 }, (_, i) => {
      const rx = i % 3, rz = Math.floor(i / 3), exact = i === 4;
      return { rx, rz, exact, bounds: { min: [rx * 64, 0, rz * 64] as const, max: [(rx + 1) * 64, 16, (rz + 1) * 64] as const },
        meshes: Array.from({ length: exact ? 1 : 4 }, (_, level) => ({ ...blob, rx, rz, level, minY: 0, maxY: 0, quadCount: 0, gzipBytes: 50 + level })) };
    }) };
}

describe('first visible land coverage', () => {
  it('requires every visible region and exact physical floor with balanced eight-neighbour levels', () => {
    const input = metadata(), visible = [true, false, false, false, false, false, false, false, true];
    const plan = planStartupCoverage(input, visible, 512);
    expect(plan.required).toEqual([true, false, false, false, true, false, false, false, true]);
    expect(plan.levels).toEqual([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    expect(plan.refs.filter(Boolean)).toHaveLength(3);
    expect(plan.refs[4]).toBe(input.regions[4]!.meshes[0]);
    expect(plan.refs[0]?.level).toBe(1); expect(plan.refs[8]?.level).toBe(1);
    expect(plan.meshBytes).toBe(152);
    expect(plan.plannedBytes).toBe(664);
    expect(plan.budgetBytes).toBe(STARTUP_BUDGET_BYTES);
    expect(plan.budgetExceeded).toBe(false);
  });

  it('moves balanced adjacent targets by at most one level per wave, including reversals', () => {
    const current = [0, 1, 2, 2], desired = [2, 1, 0, 1];
    const next = stepBalancedLevels(current, desired);
    expect(next).toEqual([1, 1, 1, 1]);
    const reverse = stepBalancedLevels(next, current);
    expect(reverse).toEqual(current);
    for (let i = 1; i < next.length; i++) expect(Math.abs(next[i]! - next[i - 1]!)).toBeLessThanOrEqual(1);
    expect(() => stepBalancedLevels([0], [0, 1])).toThrow();
  });

  it('reports an exceeded budget without dropping visible or physical coverage', () => {
    const input = metadata(), visible = Array(9).fill(true);
    const plan = planStartupCoverage(input, visible, STARTUP_BUDGET_BYTES);
    expect(plan.budgetExceeded).toBe(true);
    expect(plan.required.every(Boolean)).toBe(true);
    expect(plan.refs.every(Boolean)).toBe(true);
    expect(plan.plannedBytes).toBe(STARTUP_BUDGET_BYTES + plan.meshBytes);
  });
});
