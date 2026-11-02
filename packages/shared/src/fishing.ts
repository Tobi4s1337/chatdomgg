import { z } from 'zod';
import type { KingdomId } from './identity';
import type { Vec3 } from './voxel';

/** Absolute metres, on the exact founded plan. Local +Z points from the bank out over the water. */
export interface FishingPierSite {
  readonly version: 1;
  readonly id: 'pier:lake';
  /** Centre of the dry end of the landing, at the actual sampled ground height. */
  readonly root: Vec3;
  readonly turn: 0 | 1 | 2 | 3;
  /** The module datum is the deck top; the short root ramp joins it to root[1]. */
  readonly deckY: number;
  readonly waterY: number;
  /** Length of the narrow walk before the four-metre-deep T-head begins, in metres. */
  readonly walk: number;
  readonly water: 'lake' | 'river' | 'sea';
  /** 'unknown' when the adopted plan lacks recipe identity; never a landscape-character substitute. */
  readonly biome: string;
  /** Water depth at metre steps from the dry root through the end of the head. Dry samples are zero. */
  readonly depth: readonly number[];
}

export const FISHING_HOURS = ['dawn', 'day', 'dusk', 'night'] as const;
export const FISHING_MOODS = ['clear', 'breeze', 'mist', 'rain'] as const;
export const FISHING_PROFILES = ['dart', 'steady', 'surge'] as const;
export type FishingHour = (typeof FISHING_HOURS)[number];
export type FishingMood = (typeof FISHING_MOODS)[number];
export type FishingProfile = (typeof FISHING_PROFILES)[number];
export interface FishingEnvironment {
  readonly water: FishingPierSite['water']; readonly biome: string; readonly depthM: number;
  readonly hour: FishingHour; readonly mood: FishingMood;
}

/** One temporary clock mapping: actual UTC day, from /api/realm/clock, never device-local time.
 * Replace this function's body with the shared kingdom clock when that export lands. */
export function kingdomFishingHour(serverTime: number): number {
  if (!Number.isSafeInteger(serverTime) || serverTime < 0) throw new Error('Invalid kingdom time.');
  return serverTime % 86_400_000 / 3_600_000;
}
export function fishingHourBand(hour: number): FishingHour {
  if (!Number.isFinite(hour) || hour < 0 || hour >= 24) throw new Error('Invalid kingdom hour.');
  return hour >= 5 && hour < 8 ? 'dawn' : hour >= 8 && hour < 18 ? 'day' : hour >= 18 && hour < 21 ? 'dusk' : 'night';
}

/** Stable independent keyed rolls. Not a secret generator: the server supplies a cryptographic cast seed. */
export function fishingHash(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15;
  return (hash ^ hash >>> 16) >>> 0;
}
/** One visible local mood per kingdom for each half hour. Sky adoption must use this same function. */
export function kingdomWaterMood(kingdomId: KingdomId, serverTime: number): FishingMood {
  kingdomFishingHour(serverTime);
  const roll = fishingHash(`pier-mood:1:${kingdomId}:${Math.floor(serverTime / 1_800_000)}`) % 100;
  return roll < 48 ? 'clear' : roll < 75 ? 'breeze' : roll < 91 ? 'mist' : 'rain';
}

const requestId = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/);
const castId = z.string().uuid();
const seq = z.number().int().min(1).max(10_000);
/** Controls only. Position, time, seed, species, tape and catch success never come from a browser. */
export const FishingRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('pier.draw'), id: requestId }),
  z.strictObject({ type: z.literal('pier.release'), id: requestId, castId, seq }),
  z.strictObject({ type: z.literal('pier.strike'), id: requestId, castId, seq }),
  z.strictObject({ type: z.literal('pier.reel'), id: requestId, castId, seq, on: z.boolean() }),
  z.strictObject({ type: z.literal('pier.cancel'), id: requestId, castId, seq }),
]);
export type FishingRequest = z.infer<typeof FishingRequestSchema>;

/** Authored content, validated at server setup; wildcards apply only to the biome list. */
export interface FishSpecies {
  readonly id: string; readonly name: string; readonly lore: string; readonly riddle: string;
  readonly rarity: 'common' | 'uncommon' | 'rare'; readonly weight: number;
  readonly waters: readonly FishingPierSite['water'][]; readonly biomes: readonly string[];
  readonly hours: readonly FishingHour[]; readonly moods: readonly FishingMood[]; readonly minDepthM: number;
  readonly lengthMm: readonly [number, number]; readonly weightG: readonly [number, number];
  readonly fight: FishingProfile;
}
export interface FishingRoll {
  readonly speciesId: string; readonly lengthMm: number; readonly weightG: number;
  readonly fight: FishingProfile; readonly strikeMs: number;
}
