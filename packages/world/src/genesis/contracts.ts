import { z } from 'zod';
import {
  AtlasTierSchema, EpochMsSchema, KingdomIdSchema, Sha256Schema, TokenSchema, UIntSchema,
  type KingdomId, type Vec3,
} from '@chatdom/shared';
import type { KingdomLandform } from '../kingdom-land/types';
import type { BoundsXZ, CardinalTurn, XZ } from '../settlement/types';

/** Local proposal contract. Promotion to shared and production adoption belong to chatdom-main. */
export const GENESIS_VERSION = 'channel-genesis-1' as const;
export const GENESIS_LIMITS = Object.freeze({ categories: 16, emotes: 12, colours: 4, recipeBytes: 65_536 });
export type GenesisTier = z.infer<typeof AtlasTierSchema>;
/** The Atlas game families (taxonomy families-1) and the realms that hold no family. */
export const GENESIS_ATLAS_REALMS = [
  'just-chatting', 'creative', 'shooters', 'arenas', 'mmo', 'roleplay', 'sandbox', 'survival', 'adventure', 'strategy',
  'sports', 'fighting', 'retro', 'cozy', 'crossroads', 'wilds', 'isle', 'outer',
] as const;
export type GenesisAtlasRealm = typeof GENESIS_ATLAS_REALMS[number];
export type GenesisBiome = 'meadow' | 'woodland' | 'coastal' | 'highland';
export type GenesisLandmark = 'watermill' | 'lighthouse' | 'watchtower' | 'bell-garden' | 'stone-circle' | 'open-air-stage';
export type EmoteUse = 'statue' | 'weathervane' | 'stained-glass';

const ApprovedAssetSchema = z.strictObject({
  assetHash: Sha256Schema,
  approvalId: TokenSchema,
});

/**
 * Server facts adapter only: an approvalId is a reference, never proof of approval. The adapter resolves
 * valid, current, channel-bound receipts outside this pure compiler; publication resolves them again.
 * Raw descriptions, names, emote images, URLs and model prompts are deliberately absent.
 */
export const ChannelGenesisFactsSchema = z.strictObject({
  version: z.literal(1),
  broadcasterId: KingdomIdSchema,
  evidence: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('observed'), sourceId: TokenSchema, asOf: EpochMsSchema }),
    z.strictObject({ kind: z.literal('simulated'), sourceId: TokenSchema, asOf: EpochMsSchema, label: z.literal('SIMULATED') }),
  ]),
  /** An average over a documented observation window, never the instantaneous live count. */
  audience: z.strictObject({
    averageViewers: z.number().finite().min(0).max(1_000_000_000).nullable(),
    followers: UIntSchema.nullable(),
    windowHours: z.number().finite().positive().max(8784),
  }),
  categories: z.array(z.strictObject({
    categoryId: TokenSchema,
    /** Used only for an exact curated dictionary match; never copied to an output string. */
    name: z.string().min(1).max(128),
    observedMinutes: z.number().finite().positive().max(527_040),
  })).max(GENESIS_LIMITS.categories),
  /** In source preference order. These are colour targets; the style-kit compiler snaps to its palette. */
  profileColours: z.array(z.string().regex(/^#[a-fA-F0-9]{6}$/)).max(GENESIS_LIMITS.colours),
  approvedEmotes: z.array(z.strictObject({
    emoteId: TokenSchema,
    broadcasterId: KingdomIdSchema,
    asset: ApprovedAssetSchema,
    allowedUses: z.array(z.enum(['statue', 'weathervane', 'stained-glass'])).min(1).max(3),
  })).max(GENESIS_LIMITS.emotes),
  /** Authored/judged derivatives of the description, with source lineage; no unjudged fallback copy. */
  approvedDescription: z.strictObject({
    broadcasterId: KingdomIdSchema,
    sourceHash: Sha256Schema,
    motto: ApprovedAssetSchema.nullable(),
    lore: ApprovedAssetSchema.nullable(),
  }).nullable(),
  /** Actual follower evidence only. Null reserves Old Row without inventing a follow year. */
  oldestFollowYear: z.number().int().min(2007).max(9999).nullable(),
  /**
   * The Atlas realm the channel's holding stands in: its game family, or the shared Crossroads, Wilds and language
   * isles. A theme only for a game the curated dictionary does not know; absent means unknown.
   */
  atlasRealm: z.enum(GENESIS_ATLAS_REALMS).optional(),
}).superRefine((facts, context) => {
  for (const [field, values] of [
    ['categories', facts.categories.map(category => category.categoryId)],
    ['approvedEmotes', facts.approvedEmotes.map(emote => emote.emoteId)],
  ] as const) {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path: [field], message: 'Duplicate fact identity.' });
  }
  if (facts.approvedEmotes.some(emote => emote.broadcasterId !== facts.broadcasterId)
    || (facts.approvedDescription && facts.approvedDescription.broadcasterId !== facts.broadcasterId)) {
    context.addIssue({ code: 'custom', message: 'Approved source belongs to another channel.' });
  }
  if (facts.oldestFollowYear !== null && facts.oldestFollowYear > new Date(facts.evidence.asOf).getUTCFullYear()) {
    context.addIssue({ code: 'custom', path: ['oldestFollowYear'], message: 'Follow year is after the observation.' });
  }
});
export type ChannelGenesisFacts = z.infer<typeof ChannelGenesisFactsSchema>;
export type ApprovedGenesisAsset = z.infer<typeof ApprovedAssetSchema>;

export interface GenesisSize {
  tier: GenesisTier;
  basis: 'average' | 'unknown';
  /** Space reserved for homes, not deeds, people, occupied buildings, lights or a walker count. */
  homeCapacity: number;
  wards: number;
  cathedralSite: boolean;
  /** Optional planning evidence only; this does not assign a citizen, plot or higher Atlas tier. */
  followerGrowthHint: number | null;
  growth: 'append-only';
}

export interface GenesisLandscape {
  id: string;
  rank: 0 | 1 | 2;
  character: 'coastal-harbour' | 'river-valley' | 'mountain-pass';
  /** Existing v2 terrain primitives. This is NOT the complete coast/island surface. */
  terrainCore: KingdomLandform;
  /** No existing LandformPlan version expresses subtractive ocean water with dry islands. */
  surfaceCompiler: 'genesis-coast-1';
  coast: { shoreline: readonly XZ[]; oceanToward: CardinalTurn; level: 0 };
  islands: readonly { id: string; centre: XZ; radiusX: number; radiusZ: number; height: number }[];
  forest: { id: string; boundary: readonly XZ[]; clearing: XZ };
  mountainPass: { saddle: Vec3; betweenHillIds: readonly [string, string]; width: number };
  /** Dry settlement reserve; the layout compiler proves slope, road access and full lot clearance. */
  settlementReserve: BoundsXZ;
  places: readonly { id: string; name: string; purpose: 'castle' | 'plaza' | 'tavern' | 'forge' | 'campfire' | 'gate' | 'old-row'; anchor: XZ }[];
}

export interface ChannelKingdomRecipe {
  version: typeof GENESIS_VERSION;
  kingdomId: KingdomId;
  /** Full decimal identity remains in keys; the 32-bit terrain seed is not an identity or content hash. */
  seedKey: string;
  evidence: ChannelGenesisFacts['evidence'];
  status: 'potential';
  size: GenesisSize;
  identity: {
    biome: GenesisBiome;
    categoryBasis: readonly string[];
    landmark: GenesisLandmark;
    styleFamily: 'hearth' | 'tide' | 'grove';
    profileColourTargets: readonly string[];
    crest: { shape: 'heater' | 'round' | 'swallowtail'; charge: 'oak' | 'star' | 'wave' | 'mountain'; seedKey: string };
    banner: { cut: 'square' | 'forked' | 'pennant'; seedKey: string };
    emoteWorks: readonly { emoteId: string; use: EmoteUse; asset: ApprovedGenesisAsset }[];
    description: ChannelGenesisFacts['approvedDescription'];
  };
  /** Initial composition only; the live ceremony may select either of the other two candidates. */
  recommendedLandscapeId: string;
  landscapes: readonly [GenesisLandscape, GenesisLandscape, GenesisLandscape];
  soul: {
    oldRow: { name: 'Old Row'; oldestFollowYear: number | null; allocation: 'follow-year-then-sub-months-once' };
    keepers: readonly { role: 'innkeeper' | 'lamplighter' | 'ferryman'; name: string; placeId: string; carriesPresenceLight: false }[];
    history: 'witnessed-facts-only';
    weatherSeedKey: string;
    clock: 'realm-time';
    soundscape: GenesisBiome;
    population: 'real-presence-only';
  };
}

export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

/** An already founded world is resolved from its adopted bytes, never from this generator. */
export type GenesisEntryDecision =
  | { kind: 'adopted'; manifest: import('@chatdom/shared/realm').RealmFoundedManifest }
  | { kind: 'potential'; recipe: DeepReadonly<ChannelKingdomRecipe>; label: 'Unfounded land'; canSettle: false };
