import { describe, expect, it } from 'vitest';
import { planGrandLand } from './plan';
import { GRAND_REGION, type GrandLandSeed } from './types';

const seed: GrandLandSeed = { seedKey: 'twitch:129634568', kingdomId: '129634568', name: 'Willowmere', biome: 'meadow', tier: 'hamlet', character: 'river-valley' };

describe('installed settlement land size', () => {
  it('keeps the existing recipe and expands the same seeded landscape to whole streaming regions', () => {
    const original = planGrandLand(seed);
    expect(planGrandLand({ ...seed, minSize: 1 })).toEqual(original);
    const expanded = planGrandLand({ ...seed, minSize: 2561 });
    expect(expanded.size).toBe(2816);
    expect(expanded.size % GRAND_REGION).toBe(0);
    expect(expanded.seed).toBe(original.seed);
    expect(expanded.rotation).toBe(original.rotation);
    expect(planGrandLand({ ...seed, minSize: 2561 })).toEqual(expanded);
    for (const minSize of [0, -1, 1.5, Infinity, NaN]) expect(() => planGrandLand({ ...seed, minSize })).toThrow(/positive safe integer/);
  });
});
