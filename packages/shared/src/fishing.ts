import { z } from 'zod';
import type { KingdomId } from './identity';
import type { Vec3 } from './voxel';
import type { ItemRecord } from './items';

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
  /** One of the four legends: rare, never stacked, and too strong for a chat line. Same odds for everyone. */
  readonly legend?: true;
  /** Share of kingdoms whose water holds this fish (0 < share < 1), fixed per kingdom by `kingdomHoldsFish`.
   * Absent: every water of its kind holds it. */
  readonly share?: number;
}
/** Whether this kingdom's water holds the fish at all. A pure function of the kingdom and the species, so it never moves. */
export function kingdomHoldsFish(kingdomId: KingdomId, species: Pick<FishSpecies, 'id' | 'share'>): boolean {
  if (species.share === undefined) return true;
  return fishingHash(`share:1:${kingdomId}:${species.id}`) % 10_000 < Math.round(species.share * 10_000);
}
export interface FishingRoll {
  readonly speciesId: string; readonly lengthMm: number; readonly weightG: number;
  readonly fight: FishingProfile; readonly strikeMs: number;
}

/** Room feature channel. The original controls remain unchanged; this wrapper adds recovery and owned-tool selection. */
export const FishingChannelRequestSchema = z.union([
  FishingRequestSchema,
  z.strictObject({ type: z.literal('pier.sync'), id: requestId }),
  z.strictObject({ type: z.literal('pier.take'), id: requestId }),
  z.strictObject({ type: z.literal('pier.equip'), id: requestId, itemId: z.string().uuid().nullable() }),
  z.strictObject({ type: z.literal('pier.keep'), id: requestId, castId }),
  z.strictObject({ type: z.literal('pier.marks'), id: requestId }),
]);
export type FishingChannelRequest = z.infer<typeof FishingChannelRequestSchema>;
export const FISHING_CHANNEL = 'fishing';
export const FISHING_PRIVATE_BYTES = 96 * 1024;
export const FISHING_PUBLIC_BYTES = 48 * 1024;
export const FISHING_CAST_PHASES = ['drawing', 'flying', 'waiting', 'bite', 'fighting', 'landing'] as const;
export type FishingCastPhase = (typeof FISHING_CAST_PHASES)[number];
export interface FishingFightView {
  readonly tick: number; readonly tension: number; readonly progress: number;
  readonly phase: 'rest' | 'warning' | 'run'; readonly tired: boolean;
}
export interface FishingOwnerCast {
  readonly id: string; readonly phase: FishingCastPhase; readonly anchor: Vec3; readonly float: Vec3 | null;
  readonly at: number; readonly biteClosesAt?: number; readonly fight?: FishingFightView;
  readonly environment?: FishingEnvironment;
}
/** Explicit public allowlist. Never spread a private domain candidate, item, principal or replay into this. */
export interface FishingPublicCast {
  readonly id: string; readonly walkerId: string; readonly phase: FishingCastPhase;
  readonly anchor: Vec3; readonly float: Vec3 | null; readonly at: number; readonly fight?: FishingFightView;
}
export interface FishingPublicRod { readonly walkerId: string; readonly model: 'tool:rod.willow' }
export interface FishingPublicBeat {
  readonly castId: string; readonly walkerId: string; readonly at: number;
  readonly kind: 'draw' | 'cast' | 'float' | 'nibble' | 'bite' | 'hook' | 'pressure' | 'landing' | 'ended';
  /** Visible end cause only; arbitrary domain refusal text is never copied to observers. */
  readonly outcome?: 'snapped' | 'escaped' | 'missed' | 'cancelled' | 'unkept';
}
export interface FishingCaughtFish { readonly speciesId: string; readonly lengthMm: number; readonly weightG: number }
export type FishingPrivateReply =
  | { readonly type: 'pier.state'; readonly id: string; readonly at: number; readonly revision: number;
      readonly site: FishingPierSite | null; readonly rack: Vec3 | null;
      /** The pier's lantern glass, in world metres, so a walker's view lights them without reading the founded plan. */
      readonly lights?: readonly Vec3[];
      /** The Almanac lectern on the head, in world metres. */
      readonly almanac?: Vec3;
      readonly water: { readonly hour: number; readonly mood: FishingMood } | null;
      readonly casts: readonly FishingPublicCast[]; readonly rods: readonly FishingPublicRod[];
      readonly self: { readonly rod: ItemRecord | null; readonly cast: FishingOwnerCast | null; readonly pendingCastId: string | null } }
  | { readonly type: 'pier.action'; readonly id: string; readonly cast: FishingOwnerCast | null }
  | { readonly type: 'pier.refused'; readonly id?: string; readonly castId?: string; readonly message: string }
  | { readonly type: 'pier.pending'; readonly id?: string; readonly castId: string; readonly message: string }
  | { readonly type: 'pier.kept'; readonly id?: string; readonly castId: string; readonly item: ItemRecord;
      readonly fish: FishingCaughtFish; readonly personalFirst: boolean; readonly kingdomFirst: boolean; readonly replayed: boolean;
      /** The numbered mount a rare catch or a kingdom first leaves on your shelf. */
      readonly keepsake?: ItemRecord | null }
  | { readonly type: 'pier.marks'; readonly id: string; readonly marks: readonly PierAlmanacMark[] };
export type FishingPublicReply =
  | { readonly type: 'pier.casts'; readonly at: number; readonly revision: number; readonly casts: readonly FishingPublicCast[] }
  | { readonly type: 'pier.rod'; readonly at: number; readonly walkerId: string; readonly equipped: boolean }
  | { readonly type: 'pier.beats'; readonly beats: readonly FishingPublicBeat[] }
  | { readonly type: 'pier.caught'; readonly at: number; readonly castId: string; readonly walkerId: string;
      readonly fish: FishingCaughtFish; readonly kingdomFirst: boolean };
export type FishingChannelReply = FishingPrivateReply | FishingPublicReply;

/** Public reads. Approved names only, never a person id; a hidden name reads as null ("a fisher"). */
export const PIER_ALMANAC_ROUTE = '/api/realm/pier/almanac/:kingdomId';
export const PIER_WATCH_ROUTE = '/api/realm/pier/watch/:kingdomId';
export const PIER_CHAT_COMMAND = '!fish';
/** 'caught': caught in this kingdom. 'waiting': lives in these waters, not caught yet. 'elsewhere': not in these waters. */
export type PierAlmanacStatus = 'caught' | 'waiting' | 'elsewhere';
export interface PierAlmanacFact { readonly name: string | null; readonly at: number; readonly via: 'pier' | 'chat' }
export interface PierAlmanacEntry {
  readonly speciesId: string;
  readonly status: PierAlmanacStatus;
  readonly count: number;
  /** The kingdom's first catch of this species. */
  readonly first: PierAlmanacFact | null;
  readonly biggest: (PierAlmanacFact & { readonly weightG: number; readonly lengthMm: number }) | null;
  /** How many numbered mounts of it the kingdom has given. */
  readonly mounts: number;
}
export interface PierAlmanac {
  readonly version: 1;
  readonly kingdomId: KingdomId;
  /** The kingdom's approved name; empty when it has none. */
  readonly kingdom: string;
  readonly asOf: number;
  /** The water at this kingdom's pier, or null where no pier stands. */
  readonly water: FishingPierSite['water'] | null;
  readonly entries: readonly PierAlmanacEntry[];
  readonly caught: number;
  readonly catches: number;
}
/** Your own marks, private over the fishing channel. */
export interface PierAlmanacMark {
  readonly speciesId: string; readonly count: number; readonly firstAt: number;
  readonly bestWeightG: number; readonly bestLengthMm: number; readonly kingdomFirst: boolean;
}

/** A chat fisher is a light, never a body: their float is their window light's colour. */
export const PIER_LIGHT_COLOURS = ['#ffb347', '#ff8a5c', '#ffd36e', '#f5a3c7', '#9fd8ff', '#b9f18c', '#d7b4ff', '#ffe7a8'] as const;
/** A home's light colour on the water. Neighbouring homes always differ: the stride 5 is coprime with the eight colours. */
export function pierLightColour(slot: number): string {
  const n = PIER_LIGHT_COLOURS.length, index = ((Math.trunc(slot) * 5) % n + n) % n;
  return PIER_LIGHT_COLOURS[index]!;
}

/** Who a public pier beat is about: an approved name and, for a chat light, its window slot. Never a person id. */
/** `name` is null when it is hidden from public pages (moderation or a forgotten name): show "a fisher". */
export interface PierFeedWho { readonly name: string | null; readonly slot: number | null; readonly colour: string | null }
export interface PierFeedLine {
  readonly id: string; readonly who: PierFeedWho; readonly via: 'chat' | 'pier';
  readonly phase: 'float' | 'bite' | 'fight'; readonly float: Vec3; readonly at: number;
}
export type PierFeedEvent =
  | { readonly kind: 'lines'; readonly at: number; readonly lines: readonly PierFeedLine[]; readonly cap: number }
  | { readonly kind: 'line'; readonly at: number; readonly line: PierFeedLine }
  | { readonly kind: 'caught'; readonly at: number; readonly id: string; readonly who: PierFeedWho; readonly via: 'chat' | 'pier';
      readonly fish: FishingCaughtFish; readonly kingdomFirst: boolean; readonly keepsake: number | null; readonly float: Vec3 | null }
  /** A legend took a chat line: only a walker could have held it. */
  | { readonly kind: 'broken'; readonly at: number; readonly id: string; readonly who: PierFeedWho; readonly speciesId: string; readonly float: Vec3 }
  | { readonly kind: 'gone'; readonly at: number; readonly id: string; readonly reason: 'escaped' | 'snapped' | 'missed' | 'pulled' | 'cleared' | 'unkept' }
  | { readonly kind: 'full'; readonly at: number; readonly who: PierFeedWho; readonly cap: number };
