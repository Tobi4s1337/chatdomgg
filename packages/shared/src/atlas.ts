import { z } from 'zod';
import { DisplayNameSchema, EpochMsSchema, KingdomIdSchema, Sha256Schema, TokenSchema, TwitchLoginSchema, UIntSchema } from './identity';

/** Allocation limits, not target visible populations. Parse only at I/O boundaries. */
export const ATLAS_LIMITS = Object.freeze({ settlers: 1_000_000, dabs: 250_000, realms: 65_536 });
export const ATLAS_LIVE_STALE_AFTER_MS = 270_000;
export const ATLAS_LIVE_BYTES_PER_SETTLER = 2;
export const ATLAS_DAB_BYTES = 20;

export const AtlasEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('observed'), asOf: EpochMsSchema }),
  z.strictObject({ kind: z.literal('replay'), asOf: EpochMsSchema, recordingId: TokenSchema }),
  z.strictObject({ kind: z.literal('simulated'), asOf: EpochMsSchema, label: z.literal('SIMULATED') }),
]);
export type AtlasEvidence = z.infer<typeof AtlasEvidenceSchema>;

/** Pure: consumers inject their clock. A fresh HTTP response does not refresh old observations. */
export function atlasFreshness(evidence: AtlasEvidence, now: number): 'fresh' | 'stale' | 'clock-skew' | 'replay' | 'simulated' {
  EpochMsSchema.parse(now);
  AtlasEvidenceSchema.parse(evidence);
  if (evidence.kind !== 'observed') return evidence.kind;
  if (now < evidence.asOf) return 'clock-skew';
  return now - evidence.asOf > ATLAS_LIVE_STALE_AFTER_MS ? 'stale' : 'fresh';
}

export const AtlasTierSchema = z.enum(['hamlet', 'village', 'town', 'city', 'capital']);
export const AtlasRealmIndexSchema = UIntSchema.max(ATLAS_LIMITS.realms - 1);
export const AtlasOrdinalSchema = UIntSchema.max(ATLAS_LIMITS.settlers - 1);
export const AtlasPointSchema = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
export const AtlasEditionSchema = z.strictObject({
  version: z.literal(1),
  id: TokenSchema,
  label: DisplayNameSchema,
  status: z.enum(['preview', 'frozen']),
  foundedAt: EpochMsSchema,
  worldHash: Sha256Schema,
  realmCount: UIntSchema.min(1).max(ATLAS_LIMITS.realms),
});
export type AtlasEdition = z.infer<typeof AtlasEditionSchema>;

/** Immutable land assignment. Mutable names, live state and drawings never enter this record. */
export const AtlasSettlerSchema = z.strictObject({
  ordinal: AtlasOrdinalSchema,
  kingdomId: KingdomIdSchema,
  holdingId: TokenSchema,
  realmIndex: AtlasRealmIndexSchema,
  holdingTier: AtlasTierSchema,
  point: AtlasPointSchema,
  settledAt: EpochMsSchema,
});
export type AtlasSettler = z.infer<typeof AtlasSettlerSchema>;

/** A mutable public projection. No person IDs, positions, homes, follows or passports. */
export const AtlasChannelSchema = z.strictObject({
  kingdomId: KingdomIdSchema,
  login: TwitchLoginSchema,
  displayName: DisplayNameSchema,
  language: z.string().min(1).max(16),
  founded: z.boolean(),
  kingdomName: DisplayNameSchema.nullable(),
  contentClassification: z.enum(['unknown', 'general', 'mature', 'excluded']),
});
export type AtlasChannel = z.infer<typeof AtlasChannelSchema>;

export const AtlasAlignmentSchema = z.strictObject({
  editionId: TokenSchema,
  worldHash: Sha256Schema,
  settlerOrderHash: Sha256Schema,
  settlerCount: UIntSchema.max(ATLAS_LIMITS.settlers),
});
export type AtlasAlignment = z.infer<typeof AtlasAlignmentSchema>;

const AssetFields = {
  path: z.string().max(512).regex(/^\/[A-Za-z0-9_./-]+$/).refine((path) => !path.includes('..') && !path.startsWith('//'), 'Expected a safe absolute asset path.'),
  sha256: Sha256Schema,
  byteLength: UIntSchema.max(ATLAS_LIMITS.dabs * ATLAS_DAB_BYTES + 32_000_000),
};
export const AtlasManifestSchema = z.strictObject({
  version: z.literal(1),
  alignment: AtlasAlignmentSchema,
  evidence: AtlasEvidenceSchema,
  publishedAt: EpochMsSchema,
  realmCount: UIntSchema.min(1).max(ATLAS_LIMITS.realms),
  coverage: z.enum(['complete-sweep', 'partial']),
  live: z.strictObject({ format: z.literal('live-v2'), ...AssetFields }),
  starts: z.strictObject({ format: z.literal('live-starts-v1'), ...AssetFields }),
  dabs: z.strictObject({ format: z.literal('dabs-v1'), count: UIntSchema.max(ATLAS_LIMITS.dabs), ...AssetFields }),
}).superRefine((manifest, ctx) => {
  if (manifest.publishedAt < manifest.evidence.asOf) {
    ctx.addIssue({ code: 'custom', path: ['publishedAt'], message: 'Publication must not precede its observation cut.' });
  }
  if (manifest.live.byteLength !== manifest.alignment.settlerCount * ATLAS_LIVE_BYTES_PER_SETTLER) {
    ctx.addIssue({ code: 'custom', path: ['live', 'byteLength'], message: 'live-v2 needs exactly two bytes per settler.' });
  }
  if (manifest.dabs.byteLength !== manifest.dabs.count * ATLAS_DAB_BYTES) {
    ctx.addIssue({ code: 'custom', path: ['dabs', 'byteLength'], message: 'dabs-v1 needs exactly twenty bytes per dab.' });
  }
});
export type AtlasManifest = z.infer<typeof AtlasManifestSchema>;

/** Class 5 also represents founded hamlets below the sweep's five-viewer cutoff. */
export const AtlasLiveClassSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
// Fixed wire dictionary. Level details stay on the card; ≥3 gets the fireworks variant.
export const ATLAS_SPECTACLE = Object.freeze({ none: 0, raidParty: 1, festival: 2, hypeTrain: 3, hypeTrainFireworks: 4, dragon: 5, crowning: 6 } as const);
export const AtlasLiveSlotSchema = z.strictObject({
  liveClass: AtlasLiveClassSchema,
  spectacle: UIntSchema.max(6),
});
export type AtlasLiveSlot = z.infer<typeof AtlasLiveSlotSchema>;

/** Snapshot-scoped sidecar: every live ordinal appears once. Null means the source did not know the start. */
export const AtlasLiveStartsSchema = z.strictObject({
  version: z.literal(1),
  alignment: AtlasAlignmentSchema,
  asOf: EpochMsSchema,
  entries: z.array(z.strictObject({ ordinal: AtlasOrdinalSchema, startedAt: EpochMsSchema.nullable() })).max(ATLAS_LIMITS.settlers),
}).superRefine((starts, ctx) => {
  let previous = -1;
  for (const [index, entry] of starts.entries.entries()) {
    if (entry.ordinal <= previous || entry.ordinal >= starts.alignment.settlerCount) {
      ctx.addIssue({ code: 'custom', path: ['entries', index, 'ordinal'], message: 'Start ordinals must be unique, increasing and in range.' });
    }
    if (entry.startedAt !== null && entry.startedAt > starts.asOf) {
      ctx.addIssue({ code: 'custom', path: ['entries', index, 'startedAt'], message: 'A stream cannot start after this observation cut.' });
    }
    previous = entry.ordinal;
  }
});
export type AtlasLiveStarts = z.infer<typeof AtlasLiveStartsSchema>;

/** Hash is 64 bits of SHA-256(decimal channel ID), never a person or a login hash. */
export const AtlasDabSchema = z.strictObject({
  realmIndex: AtlasRealmIndexSchema,
  channelHash: z.string().regex(/^[0-9a-f]{16}$/),
  startedAt: EpochMsSchema,
});
export type AtlasDab = z.infer<typeof AtlasDabSchema>;

/** Assert land invariants before publishing a new index. A renamed channel keeps its holding. */
export function assertSettlerIndex(edition: AtlasEdition, settlers: readonly AtlasSettler[]): void {
  AtlasEditionSchema.parse(edition);
  if (settlers.length > ATLAS_LIMITS.settlers) throw new Error('Atlas settler limit exceeded.');
  const channels = new Set<string>();
  const holdings = new Set<string>();
  for (const [ordinal, input] of settlers.entries()) {
    const settler = AtlasSettlerSchema.parse(input);
    if (settler.ordinal !== ordinal || settler.realmIndex >= edition.realmCount) throw new Error('Invalid Atlas settler ordinal or realm.');
    if (channels.has(settler.kingdomId) || holdings.has(settler.holdingId)) throw new Error('A channel or holding has two owners.');
    channels.add(settler.kingdomId);
    holdings.add(settler.holdingId);
  }
}

export function assertSettlersAppendOnly(previous: readonly AtlasSettler[], next: readonly AtlasSettler[]): void {
  if (next.length < previous.length) throw new Error('The settler index cannot shrink.');
  for (const [ordinal, old] of previous.entries()) {
    const current = next[ordinal];
    if (!current || old.ordinal !== current.ordinal || old.kingdomId !== current.kingdomId || old.holdingId !== current.holdingId ||
      old.realmIndex !== current.realmIndex || old.holdingTier !== current.holdingTier || old.point.x !== current.point.x ||
      old.point.y !== current.point.y || old.settledAt !== current.settledAt) throw new Error('Settled land cannot move within an edition.');
  }
}
