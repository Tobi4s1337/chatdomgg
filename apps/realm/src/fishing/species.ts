import { z } from 'zod';
import { FISHING_HOURS, FISHING_MOODS, FISHING_PROFILES, fishingHash,
  type FishSpecies, type FishingEnvironment, type FishingRoll } from '@chatdom/shared';

const range = z.tuple([z.number().int().min(1).max(1_000_000), z.number().int().min(1).max(1_000_000)])
  .refine(([low, high]) => low <= high, 'Reversed size range.');
const unique = <T>(entries: readonly T[]) => new Set(entries).size === entries.length;
const schema = z.strictObject({
  id: z.string().regex(/^fish:[a-z][a-z0-9-]{0,63}$/), name: z.string().trim().min(1).max(80),
  lore: z.string().trim().min(1).max(300), riddle: z.string().trim().min(1).max(200),
  rarity: z.enum(['common', 'uncommon', 'rare']), weight: z.number().int().min(1).max(10_000),
  waters: z.array(z.enum(['lake', 'river', 'sea'])).min(1).max(3).refine(unique),
  biomes: z.array(z.string().regex(/^(\*|[a-z][a-z0-9-]{0,63})$/)).min(1).max(16).refine(unique)
    .refine(values => !values.includes('unknown') && (!values.includes('*') || values.length === 1)),
  hours: z.array(z.enum(FISHING_HOURS)).min(1).max(4).refine(unique),
  moods: z.array(z.enum(FISHING_MOODS)).min(1).max(4).refine(unique), minDepthM: z.number().finite().min(1).max(1000),
  lengthMm: range, weightG: range, fight: z.enum(FISHING_PROFILES),
});
const environment = z.strictObject({
  water: z.enum(['lake', 'river', 'sea']), biome: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  depthM: z.number().finite().min(1).max(10_000), hour: z.enum(FISHING_HOURS), mood: z.enum(FISHING_MOODS),
});
function freeze(species: FishSpecies): FishSpecies {
  for (const list of [species.waters, species.biomes, species.hours, species.moods, species.lengthMm, species.weightG]) Object.freeze(list);
  return Object.freeze(species);
}
export function validFishingSeed(seed: number): boolean { return Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff; }

/** Catalogue order cannot change a seeded roll. Content is parsed/copied once, before accepting casts. */
export function createFishingSpecies(definitions: readonly FishSpecies[]) {
  if (!definitions.length || definitions.length > 64) throw new Error('Fishing needs 1–64 authored species.');
  const entries = definitions.map(entry => freeze(schema.parse(entry))).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Duplicate fish species.');
  const eligible = (input: FishingEnvironment): readonly FishSpecies[] => {
    const env = environment.parse(input);
    return entries.filter(fish => fish.waters.includes(env.water) && (fish.biomes.includes('*') || fish.biomes.includes(env.biome))
      && fish.hours.includes(env.hour) && fish.moods.includes(env.mood) && env.depthM >= fish.minDepthM);
  };
  return {
    eligible,
    get: (id: string): FishSpecies | undefined => entries.find(entry => entry.id === id),
    roll(input: FishingEnvironment, seed: number): FishingRoll | null {
      if (!validFishingSeed(seed)) throw new Error('Invalid fishing seed.');
      const fish = eligible(input);
      const total = fish.reduce((sum, entry) => sum + entry.weight, 0);
      if (!total) return null;
      let choice = Math.floor(fishingHash(`species:1:${seed}`) / 0x1_0000_0000 * total);
      const picked = fish.find(entry => { choice -= entry.weight; return choice < 0; })!;
      // Same percentile links a fish's length and mass; no impossible tiny heavy specimen.
      const size = fishingHash(`size:1:${seed}`) / 0xffff_ffff;
      return Object.freeze({ speciesId: picked.id, lengthMm: Math.round(picked.lengthMm[0] + size * (picked.lengthMm[1] - picked.lengthMm[0])),
        weightG: Math.round(picked.weightG[0] + size * size * size * (picked.weightG[1] - picked.weightG[0])),
        fight: picked.fight, strikeMs: picked.rarity === 'common' ? 1200 : picked.rarity === 'uncommon' ? 1050 : 900 });
    },
  };
}
export type FishingSpecies = ReturnType<typeof createFishingSpecies>;
