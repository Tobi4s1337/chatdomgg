import { describe, expect, it } from 'vitest';
import { balanceLevels, chooseLevel, finestNeeded, type LodState } from './lod';

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
