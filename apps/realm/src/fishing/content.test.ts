import { expect, it } from 'vitest';
import { FISHING_HOURS, FISHING_MOODS, type FishingEnvironment } from '@chatdom/shared';
import { FISH_ITEM_DEFINITIONS, FISH_SPECIES } from '../../../../packages/content/src/fish';
import { WILLOW_ROD_DEFINITION } from '../../../../packages/content/src/pier/rod';
import { createItemCatalogue } from '../items';
import { createFishingSpecies } from './species';

it('validates the complete content and provides common catches for every environment on an unknown biome', () => {
  const catalogue = createFishingSpecies(FISH_SPECIES);
  expect(FISH_SPECIES).toHaveLength(12);
  for (const water of ['lake', 'river', 'sea'] as const) for (const hour of FISHING_HOURS) for (const mood of FISHING_MOODS) {
    const environment: FishingEnvironment = { water, hour, mood, biome: 'unknown', depthM: 1 };
    const eligible = catalogue.eligible(environment);
    for (const id of ['fish:bell-minnow', 'fish:silver-dace']) expect(eligible.some(fish => fish.id === id && fish.rarity === 'common'), `${water}/${hour}/${mood}/${id}`).toBe(true);
    expect(catalogue.roll(environment, 42)).not.toBeNull();
  }
});

it('restricts eel to night and trout to dawn mist and makes every authored species selectable', () => {
  const catalogue = createFishingSpecies(FISH_SPECIES);
  const base: FishingEnvironment = { water: 'lake', hour: 'night', mood: 'mist', biome: 'unknown', depthM: 10 };
  for (const hour of FISHING_HOURS) for (const mood of FISHING_MOODS) {
    const ids = catalogue.eligible({ ...base, hour, mood }).map(fish => fish.id);
    expect(ids.includes('fish:lantern-eel')).toBe(hour === 'night');
    expect(ids.includes('fish:mistfin-trout')).toBe(hour === 'dawn' && mood === 'mist');
  }
  for (const fish of FISH_SPECIES) {
    const environment: FishingEnvironment = { water: fish.waters[0]!, hour: fish.hours[0]!, mood: fish.moods[0]!, biome: fish.biomes[0] === '*' ? 'unknown' : fish.biomes[0]!, depthM: fish.minDepthM };
    expect(catalogue.eligible(environment).map(entry => entry.id)).toContain(fish.id);
    let found = false;
    for (let seed = 0; seed < 10_000 && !found; seed++) found = catalogue.roll(environment, seed)?.speciesId === fish.id;
    expect(found, fish.id).toBe(true);
  }
});

it('validates corresponding item definitions and rejects untrusted paid selection input', () => {
  const items = createItemCatalogue([...FISH_ITEM_DEFINITIONS, WILLOW_ROD_DEFINITION]);
  for (const fish of FISH_SPECIES) {
    const item = items.get(fish.id)!;
    expect(item).toMatchObject({ id: fish.id, branch: 'gathered', model: fish.id, keepsake: false, stack: fish.rarity === 'rare' ? null : 99 });
  }
  expect(items.get(WILLOW_ROD_DEFINITION.id)).toMatchObject({ branch: 'held', stack: null });
  const catalogue = createFishingSpecies(FISH_SPECIES);
  const environment: FishingEnvironment = { water: 'lake', hour: 'day', mood: 'clear', biome: 'unknown', depthM: 2 };
  for (const field of ['bits', 'subscriber', 'rank', 'paidLuck', 'rodBonus']) expect(() => catalogue.roll({ ...environment, [field]: 100 }, 5)).toThrow();
});

it('uses real Genesis biome ids to restrict carp and char without inferring an unknown biome', () => {
  const catalogue = createFishingSpecies(FISH_SPECIES);
  const carp: FishingEnvironment = { water: 'lake', hour: 'day', mood: 'clear', biome: 'meadow', depthM: 2 };
  for (const biome of ['meadow', 'woodland']) expect(catalogue.eligible({ ...carp, biome }).some(fish => fish.id === 'fish:mossback-carp'), biome).toBe(true);
  for (const biome of ['unknown', 'highland']) expect(catalogue.eligible({ ...carp, biome }).some(fish => fish.id === 'fish:mossback-carp'), biome).toBe(false);
  const char: FishingEnvironment = { water: 'lake', hour: 'dawn', mood: 'breeze', biome: 'highland', depthM: 4 };
  expect(catalogue.eligible(char).some(fish => fish.id === 'fish:redfin-char')).toBe(true);
  for (const biome of ['unknown', 'meadow', 'woodland']) expect(catalogue.eligible({ ...char, biome }).some(fish => fish.id === 'fish:redfin-char'), biome).toBe(false);
});
