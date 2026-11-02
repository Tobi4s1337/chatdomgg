import { z } from 'zod';
import { FISHING_HOURS, FISHING_MOODS, FISHING_PROFILES, KingdomIdSchema, fishingHash, kingdomHoldsFish,
  type FishSpecies, type FishingEnvironment, type FishingRoll, type KingdomId } from '@chatdom/shared';

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
  legend: z.literal(true).optional(), share: z.number().gt(0).lt(1).optional(),
}).refine(entry => !entry.legend || entry.rarity === 'rare', 'A legend is always rare.');
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
export interface FishingSpecies {
  all(): readonly FishSpecies[];
  eligible(input: FishingEnvironment): readonly FishSpecies[];
  get(id: string): FishSpecies | undefined;
  forKingdom(id: KingdomId): FishingSpecies;
  lives(fish: FishSpecies, water: FishingEnvironment['water'], biome: string | null): boolean;
  roll(input: FishingEnvironment, seed: number): FishingRoll | null;
}
export function createFishingSpecies(definitions: readonly FishSpecies[]): FishingSpecies {
  if (!definitions.length || definitions.length > 64) throw new Error('Fishing needs 1–64 authored species.');
  const entries = definitions.map(entry => freeze(schema.parse(entry) as FishSpecies)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Duplicate fish species.');
  return view(entries, null);
}

function view(entries: readonly FishSpecies[], kingdomId: KingdomId | null): FishingSpecies {
  const eligible = (input: FishingEnvironment): readonly FishSpecies[] => {
    const env = environment.parse(input);
    return entries.filter(fish => fish.waters.includes(env.water) && (fish.biomes.includes('*') || fish.biomes.includes(env.biome))
      && fish.hours.includes(env.hour) && fish.moods.includes(env.mood) && env.depthM >= fish.minDepthM);
  };
  return {
    /** Every authored species, in id order. */
    all: (): readonly FishSpecies[] => entries,
    eligible,
    get: (id: string): FishSpecies | undefined => entries.find(entry => entry.id === id),
    /** This kingdom's own water: only the fish its water holds can bite there. A pure function of the kingdom id. */
    forKingdom(id: KingdomId) {
      const kingdom = KingdomIdSchema.parse(id);
      if (kingdomId !== null && kingdomId !== kingdom) throw new Error('This fishing view belongs to another kingdom.');
      return view(entries.filter(fish => kingdomHoldsFish(kingdom, fish)), kingdom);
    },
    /** Whether a fish could ever bite at this kingdom's pier: its water and biome, at any hour or mood. */
    lives(fish: FishSpecies, water: FishingEnvironment['water'], biome: string | null): boolean {
      return entries.includes(fish) && fish.waters.includes(water) && (fish.biomes.includes('*') || (biome !== null && fish.biomes.includes(biome)));
    },
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
