import { expect, it } from 'vitest';
import type { FishSpecies, FishingEnvironment } from '@chatdom/shared';
import { createFishingSpecies } from './species';

const fish: FishSpecies = { id: 'fish:perch', name: 'Perch', lore: 'Copper in the water.', riddle: 'A flash.', rarity: 'common', weight: 3,
  waters: ['lake'], biomes: ['meadow'], hours: ['day'], moods: ['clear'], minDepthM: 2, lengthMm: [100, 300], weightG: [100, 1200], fight: 'steady' };
const environment: FishingEnvironment = { water: 'lake', biome: 'meadow', hour: 'day', mood: 'clear', depthM: 2 };

it('requires all five environmental dimensions, including exact depth threshold', () => {
  const catalogue = createFishingSpecies([fish]);
  expect(catalogue.eligible(environment).map(f => f.id)).toEqual([fish.id]);
  for (const change of [{ water: 'sea' }, { biome: 'marsh' }, { hour: 'night' }, { mood: 'rain' }, { depthM: 1.999 }] as const) {
    const env = { ...environment, ...change };
    expect(catalogue.eligible(env)).toEqual([]);
    expect(catalogue.roll(env, 1)).toBeNull();
  }
  expect(createFishingSpecies([{ ...fish, biomes: ['*'] }]).eligible({ ...environment, biome: 'marsh' })).toHaveLength(1);
});

it('keeps rolls independent of catalogue order and within weighted species and size rules', () => {
  const rare: FishSpecies = { ...fish, id: 'fish:trout', rarity: 'rare', weight: 1, fight: 'dart', lengthMm: [10, 20], weightG: [20, 40] };
  const first = createFishingSpecies([fish, rare]), second = createFishingSpecies([rare, fish]);
  const counts = new Map<string, number>();
  for (let seed = 0; seed < 1000; seed++) {
    const roll = first.roll(environment, seed)!;
    expect(roll).toEqual(second.roll(environment, seed));
    const chosen = roll.speciesId === fish.id ? fish : rare;
    expect(roll.lengthMm).toBeGreaterThanOrEqual(chosen.lengthMm[0]); expect(roll.lengthMm).toBeLessThanOrEqual(chosen.lengthMm[1]);
    expect(roll.weightG).toBeGreaterThanOrEqual(chosen.weightG[0]); expect(roll.weightG).toBeLessThanOrEqual(chosen.weightG[1]);
    expect(roll.strikeMs).toBe(chosen.rarity === 'rare' ? 900 : 1200);
    counts.set(roll.speciesId, (counts.get(roll.speciesId) ?? 0) + 1);
  }
  expect(counts.get(fish.id)!).toBeGreaterThan(650);
  expect(counts.get(rare.id)!).toBeGreaterThan(150);
});

it('rejects malformed definitions, invalid environments and invalid seeds', () => {
  for (const bad of [{ ...fish, weight: 0 }, { ...fish, lengthMm: [300, 100] }, { ...fish, waters: ['lake', 'lake'] },
    { ...fish, biomes: ['*', 'meadow'] }, { ...fish, biomes: ['unknown'] }, { ...fish, minDepthM: NaN }, { ...fish, rarity: 'legendary' }, { ...fish, extra: true }]) {
    expect(() => createFishingSpecies([bad as FishSpecies])).toThrow();
  }
  expect(() => createFishingSpecies([fish, fish])).toThrow();
  expect(() => createFishingSpecies([])).toThrow();
  const catalogue = createFishingSpecies([fish]);
  for (const seed of [-1, NaN, Infinity, 0.5, 0x1_0000_0000]) expect(() => catalogue.roll(environment, seed)).toThrow();
  for (const invalid of [{ ...environment, depthM: NaN }, { ...environment, depthM: 0 }, { ...environment, hour: 'midnight' }]) expect(() => catalogue.eligible(invalid as FishingEnvironment)).toThrow();
});
