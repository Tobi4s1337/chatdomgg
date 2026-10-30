import { z } from 'zod';
import {
  AtlasRaidSchema, DisplayNameSchema, EpochMsSchema, KingdomIdSchema, Sha256Schema, TwitchLoginSchema, UIntSchema,
} from '@chatdom/shared';

/**
 * The Atlas service's own observation snapshot: what the running Surveyor saw, exported read-only with its dates and
 * coverage. These records are internal to this service (not a shared wire contract) and are strict, so a person,
 * home, follow or any other unexpected field cannot ride along into a later public projection.
 */
export const SNAPSHOT_KIND = 'chatdom-atlas-observation-snapshot';
export const SOURCE_SWEEP_FLOOR_VIEWERS = 5;
export const SOURCE_SWEEP_CADENCE_MS = 180_000;
/** The source's own candidate rule (`KINGDOM_MIN_AVG`), restated so the export is explicit about it. */
export const KINGDOM_CANDIDATE_MIN_AVERAGE = 25;

/** Same form as the source SQL (viewer_min >= 25 * live_min), on the exported minutes, so check and export agree. */
export function isKingdomCandidate(liveMinutes: number, viewerMinutes: number): boolean {
  return liveMinutes > 0 && viewerMinutes >= KINGDOM_CANDIDATE_MIN_AVERAGE * liveMinutes;
}
export const RAW_CONTENT_MAX_AGE_MS = 86_400_000;
export const EDITION_0_MIN_MS = 48 * 3_600_000;
export const EDITION_I_MIN_MS = 7 * 86_400_000;

const Minutes = z.number().finite().min(0).max(1e12);
export const GameIdSchema = z.string().regex(/^[0-9]{1,20}$/);
const LanguageSchema = z.string().min(1).max(16).regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$|^other$/);
/** Only Twitch's own image CDN; anything else is dropped rather than proxied onto the map. */
export const AvatarUrlSchema = z.string().max(256).regex(/^https:\/\/static-cdn\.jtvnw\.net\/[A-Za-z0-9_./%-]+$/);

export const ChannelStreamSchema = z.strictObject({
  gameId: GameIdSchema.nullable(),
  game: z.string().min(1).max(256).nullable(),
  title: z.string().max(512).nullable(),
  viewers: UIntSchema.nullable(),
  startedAt: EpochMsSchema.nullable(),
});

export const ChannelObservationSchema = z.strictObject({
  kingdomId: KingdomIdSchema,
  login: TwitchLoginSchema,
  displayName: DisplayNameSchema,
  language: LanguageSchema,
  firstSeenAt: EpochMsSchema,
  lastLiveAt: EpochMsSchema,
  liveMinutes: Minutes,
  viewerMinutes: Minutes,
  /** viewer-minutes / live-minutes: the observed average audience, never the current one. */
  averageViewers: z.number().finite().min(0),
  peakViewers: UIntSchema,
  kingdomCandidate: z.boolean(),
  live: z.boolean(),
  /** Last stream facts, dropped once the channel has been offline for a day. */
  stream: ChannelStreamSchema.nullable(),
  categories: z.array(z.strictObject({ gameId: GameIdSchema, minutes: Minutes })).max(512),
  avatarUrl: AvatarUrlSchema.nullable(),
  /** When login/display name/avatar were last confirmed by the source (facts refresh or a live sweep). */
  factsAt: EpochMsSchema,
  /** The source could no longer find the channel on Twitch (deleted or banned). */
  goneAt: EpochMsSchema.nullable(),
  /** The source collects no content labels; unknown is never upgraded to general. */
  contentClassification: z.literal('unknown'),
});
export type ChannelObservation = z.infer<typeof ChannelObservationSchema>;

/** Twitch sometimes reports a category with an empty name; it stays a real category, with the name unknown. */
export const GameSchema = z.strictObject({ gameId: GameIdSchema, name: z.string().min(1).max(256).nullable() });
export type Game = z.infer<typeof GameSchema>;

/** Cumulative per pair. An aggregate never becomes an individual raid or carries invented event times. */
export const RaidPairSchema = z.strictObject({
  fromKingdomId: KingdomIdSchema,
  toKingdomId: KingdomIdSchema,
  raids: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  viewersTotal: UIntSchema,
  lastAt: EpochMsSchema,
}).refine((pair) => pair.fromKingdomId !== pair.toKingdomId, 'A raid pair must join different channels.');
export type RaidPair = z.infer<typeof RaidPairSchema>;

/** One webhook raid kept by the source recorder; `betweenCandidates` is the source's own kept flag. */
export const RaidObservationSchema = z.strictObject({
  raid: AtlasRaidSchema,
  betweenCandidates: z.boolean(),
});
export type RaidObservation = z.infer<typeof RaidObservationSchema>;

export const SweepSchema = z.strictObject({ at: EpochMsSchema, streams: UIntSchema, calls: UIntSchema, ms: UIntSchema });
export type Sweep = z.infer<typeof SweepSchema>;

export const SNAPSHOT_FILES = ['channels', 'games', 'raidPairs', 'raidObservations', 'sweeps'] as const;
export type SnapshotFile = typeof SNAPSHOT_FILES[number];
export const SNAPSHOT_FILE_NAMES: Record<SnapshotFile, string> = {
  channels: 'channels.ndjson',
  games: 'games.ndjson',
  raidPairs: 'raid-pairs.ndjson',
  raidObservations: 'raid-observations.ndjson',
  sweeps: 'sweeps.ndjson',
};
export const SNAPSHOT_RECORD_SCHEMAS: Record<SnapshotFile, z.ZodType> = {
  channels: ChannelObservationSchema,
  games: GameSchema,
  raidPairs: RaidPairSchema,
  raidObservations: RaidObservationSchema,
  sweeps: SweepSchema,
};

const FileEntrySchema = z.strictObject({
  path: z.string().regex(/^[a-z-]+\.ndjson$/),
  sha256: Sha256Schema,
  bytes: UIntSchema,
  records: UIntSchema,
});

export const RevisionIdSchema = z.string().regex(/^obs-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$/);

export const SnapshotManifestSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal(SNAPSHOT_KIND),
  revision: RevisionIdSchema,
  /** SHA-256 over the canonical list of file names and hashes; equal sources give equal revisions. */
  contentHash: Sha256Schema,
  importedAt: EpochMsSchema,
  /** The observation cut: the last complete source sweep in the snapshot. Never the import or publication time. */
  asOf: EpochMsSchema,
  window: z.strictObject({
    firstObservationAt: EpochMsSchema,
    lastObservationAt: EpochMsSchema,
    hours: z.number().finite().min(0),
    sweeps: UIntSchema,
    cadenceMs: z.literal(SOURCE_SWEEP_CADENCE_MS),
    gapCount: UIntSchema,
    gaps: z.array(z.strictObject({ after: EpochMsSchema, before: EpochMsSchema, minutes: z.number().finite().min(0) })).max(50),
  }),
  coverage: z.strictObject({
    sweep: z.strictObject({
      method: z.literal('helix-get-streams-by-viewers'),
      floorViewers: z.literal(SOURCE_SWEEP_FLOOR_VIEWERS),
      note: z.string().max(400),
    }),
    raidWatch: z.strictObject({
      enabled: z.boolean(), watching: UIntSchema, verified: UIntSchema, costTotal: UIntSchema, costMax: UIntSchema,
      liveCandidates: UIntSchema, note: z.string().max(400),
    }),
    recorder: z.strictObject({
      enabled: z.boolean(), keepDays: UIntSchema, frames: UIntSchema,
      firstFrameAt: EpochMsSchema.nullable(), lastFrameAt: EpochMsSchema.nullable(),
    }),
    contentLabels: z.literal('not-collected'),
    sourceSettledHoldings: UIntSchema,
    missing: z.array(z.string().max(300)).max(20),
  }),
  founding: z.strictObject({
    status: z.literal('not-founded'),
    edition0EligibleAt: EpochMsSchema,
    editionIEligibleAt: EpochMsSchema,
    observedMs: UIntSchema,
  }),
  source: z.strictObject({
    http: z.strictObject({
      base: z.string().max(512),
      readAt: EpochMsSchema,
      statusSince: EpochMsSchema,
      statusSweeps: UIntSchema,
      statusLastSweepAt: EpochMsSchema.nullable(),
      statusChannels: UIntSchema,
      statusLiveNow: UIntSchema,
      recentPairs: UIntSchema,
      recentPairsMatched: UIntSchema,
    }),
    database: z.strictObject({
      path: z.string().max(1024),
      bytes: UIntSchema,
      walBytes: UIntSchema.nullable(),
      readOnly: z.literal(true),
      transaction: z.literal('single-read'),
      openedAt: EpochMsSchema,
      readMs: UIntSchema,
      sweeps: UIntSchema,
      lagSweeps: z.number().int(),
    }),
  }),
  counts: z.strictObject({
    channels: UIntSchema,
    kingdomCandidates: UIntSchema,
    liveChannels: UIntSchema,
    liveCandidates: UIntSchema,
    games: UIntSchema,
    categoryRows: UIntSchema,
    raidPairs: UIntSchema,
    raidObservations: UIntSchema,
    raidObservationsBetweenCandidates: UIntSchema,
    avatarsDropped: UIntSchema,
    streamsExpired: UIntSchema,
    rejected: z.record(z.string().max(64), UIntSchema),
    rejectedSamples: z.array(z.string().max(120)).max(10),
  }),
  retention: z.strictObject({
    streamFactsMaxOfflineMs: z.literal(RAW_CONTENT_MAX_AGE_MS),
    avatarMaxAgeMs: z.literal(RAW_CONTENT_MAX_AGE_MS),
    keepRevisions: UIntSchema,
  }),
  files: z.strictObject({
    channels: FileEntrySchema, games: FileEntrySchema, raidPairs: FileEntrySchema,
    raidObservations: FileEntrySchema, sweeps: FileEntrySchema,
  }),
});
export type SnapshotManifest = z.infer<typeof SnapshotManifestSchema>;

export const CurrentPointerSchema = z.strictObject({
  version: z.literal(1),
  revision: RevisionIdSchema,
  manifestSha256: Sha256Schema,
  switchedAt: EpochMsSchema,
});
export type CurrentPointer = z.infer<typeof CurrentPointerSchema>;

export const LedgerEntrySchema = z.strictObject({
  version: z.literal(1),
  at: EpochMsSchema,
  outcome: z.enum(['published', 'unchanged', 'failed']),
  revision: RevisionIdSchema.nullable(),
  asOf: EpochMsSchema.nullable(),
  code: z.string().max(40).nullable(),
  message: z.string().max(700).nullable(),
  details: z.array(z.string().max(220)).max(6),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
