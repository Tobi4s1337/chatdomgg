import { describe, expect, it } from 'vitest';
import { balanceLevels, budgetQuads, chooseLevel, finestNeeded, fitLodBudget, type LodState } from './lod';

// A cell of level l at `depth` metres: 0.5 m · 2^l · projection / depth, projection 1000 px.
const at = (depth: number) => (level: number) => 0.5 * (1 << level) * 1000 / depth;
const state = (shown: number | null): LodState => ({ shown, ideal: 3, desired: 3, coarsenSince: 0 });

describe('grand LOD choice', () => {
  it('picks the coarsest level whose cells stay under the target', () => {
    expect(finestNeeded(at(100), 1, 4)).toBe(0);
    expect(finestNeeded(at(1000), 1, 4)).toBe(1);
    expect(finestNeeded(at(5000), 1, 4)).toBe(3);
  });

  it('refines only past 1.2× the target', () => {
    // Shown at level 1, 1.1× over target: hold. 1.3×: refine.
    const s = state(1);
    expect(chooseLevel(s, at(1000 / 1.1), 1, 4, 0)).toBe(1);
    expect(chooseLevel(s, at(1000 / 1.3), 1, 4, 0)).toBe(0);
  });

  it('coarsens only below 0.8× for half a second, and a reversal cancels the wait', () => {
    const s = state(0);
    const far = at(1000 / 0.7);          // level 1 would be 0.7 px
    expect(chooseLevel(s, far, 1, 4, 1000)).toBe(0);
    expect(chooseLevel(s, far, 1, 4, 1300)).toBe(0);
    expect(chooseLevel(s, at(1000 / 0.95), 1, 4, 1400)).toBe(0); // back inside the band: the wait resets
    expect(s.coarsenSince).toBe(0);
    expect(chooseLevel(s, far, 1, 4, 1500)).toBe(0);
    expect(chooseLevel(s, far, 1, 4, 2000)).toBe(1);
  });

  it('never flips between levels for a camera resting on a threshold', () => {
    const s = state(1);
    const resting = at(1000);            // level 1 exactly on target
    const seen = new Set<number>();
    for (let t = 0; t < 5000; t += 16) seen.add(chooseLevel(s, resting, 1, 4, t));
    expect([...seen]).toEqual([1]);
  });

  it('balances neighbours to at most one level apart', () => {
    // A row of five regions: the first wants full detail, the rest want the coarsest.
    const row = [0, 3, 3, 3, 3].map(level => ({ shown: level, ideal: level, desired: level, coarsenSince: 0 }));
    balanceLevels(row, row.map((_, i) => [i - 1, i + 1].filter(n => n >= 0 && n < row.length)), 4);
    expect(row.map(r => r.desired)).toEqual([0, 1, 2, 3, 3]);
  });
});

describe('the main-view land budget', () => {
  // A row of regions 100 m apart, each 1000 quads at level 0 and a quarter as many per level coarser.
  const row = (count: number, options: { pinned?: number[]; hidden?: number[] } = {}) => Array.from({ length: count }, (_, i) => {
    const s: LodState = { shown: 0, ideal: 0, desired: 0, coarsenSince: 0 };
    return { state: s, visible: !options.hidden?.includes(i), pinned: !!options.pinned?.includes(i),
      quads: [1000, 250, 62, 16], pixels: at(100 * (i + 1)) };
  });
  const line = (count: number) => Array.from({ length: count }, (_, i) => [i - 1, i + 1].filter(n => n >= 0 && n < count));

  it('leaves the levels alone when the estimate already fits', () => {
    const regions = row(4);
    expect(fitLodBudget(regions, line(4), { quads: 4000, maxPixels: 99 }, 4)).toEqual({ estimated: 4000, coarsened: 0, fits: true });
    expect(regions.map(r => r.state.desired)).toEqual([0, 0, 0, 0]);
  });

  it('coarsens the farthest regions first, balanced, until the estimate fits', () => {
    const regions = row(6);
    const fit = fitLodBudget(regions, line(6), { quads: 3000, maxPixels: 99 }, 4);
    expect(fit.fits).toBe(true);
    expect(fit.estimated).toBe(budgetQuads(regions));
    const levels = regions.map(r => r.state.desired);
    // Monotonic away from the camera, never more than one level between neighbours, nearest untouched.
    expect(levels[0]).toBe(0);
    levels.forEach((level, i) => { if (i) { expect(level).toBeGreaterThanOrEqual(levels[i - 1]!); expect(level - levels[i - 1]!).toBeLessThanOrEqual(1); } });
  });

  it('never coarsens the pinned town, hidden regions or past the pixel cap', () => {
    const regions = row(5, { pinned: [4], hidden: [3] });
    // Level 1 of region 2 (300 m) is 3.3 px, of region 1 (200 m) 5 px: a 3.5 px cap allows only region 2.
    const fit = fitLodBudget(regions, line(5), { quads: 100, maxPixels: 3.5 }, 4);
    expect(fit.fits).toBe(false);
    expect(regions[4]!.state.desired).toBe(0);
    expect(regions[3]!.state.desired).toBe(0);
    expect(regions.slice(0, 3).map(r => r.state.desired)).toEqual([0, 0, 1]);
  });

  it('gives the same levels for the same camera every time', () => {
    const first = row(8), second = row(8);
    fitLodBudget(first, line(8), { quads: 2500, maxPixels: 99 }, 4);
    fitLodBudget(second, line(8), { quads: 2500, maxPixels: 99 }, 4);
    expect(second.map(r => r.state.desired)).toEqual(first.map(r => r.state.desired));
  });
});
