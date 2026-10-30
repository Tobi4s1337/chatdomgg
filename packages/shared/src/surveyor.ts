import { z } from 'zod';
import { DisplayNameSchema, EpochMsSchema, KingdomIdSchema, PositiveIntSchema, TwitchLoginSchema, UIntSchema } from './identity';

// Observed legacy wire shapes, NOT the proposed Atlas feed. Source paths and capture date are in README.md.
const SweepSchema = z.strictObject({ at: EpochMsSchema, streams: UIntSchema, calls: UIntSchema, ms: UIntSchema });
const RecorderFrameSchema = z.strictObject({ at: EpochMsSchema, streams: UIntSchema, bytes: UIntSchema });
export const SurveyorStatusSchema = z.strictObject({
  since: EpochMsSchema,
  sweeps: UIntSchema,
  lastSweep: SweepSchema.nullable(),
  channels: UIntSchema,
  kingdoms: UIntSchema,
  kingdomsWith2LiveHours: UIntSchema,
  liveNow: UIntSchema,
  liveKingdoms: UIntSchema,
  raidWatch: z.strictObject({
    watching: UIntSchema,
    verified: UIntSchema,
    cost: z.strictObject({ total: UIntSchema, max: UIntSchema }),
    enabled: z.boolean(),
  }),
  raids: z.strictObject({
    pairs: UIntSchema,
    total: UIntSchema,
    sinceStart: z.strictObject({ kept: UIntSchema, dropped: UIntSchema }),
  }),
  recorder: z.strictObject({
    enabled: z.boolean(),
    keepDays: PositiveIntSchema,
    frames: UIntSchema,
    firstFrame: EpochMsSchema.nullable(),
    lastFrame: RecorderFrameSchema.nullable(),
    frameBytes: UIntSchema,
    channels: UIntSchema,
    raidEvents: UIntSchema,
    raidEventsBetweenKingdoms: UIntSchema,
  }),
  helixRemaining: UIntSchema,
  streamClients: UIntSchema,
});
export type SurveyorStatus = z.infer<typeof SurveyorStatusSchema>;

/** Legacy channel facts may not yet have been populated. Do not manufacture missing names. */
export const SurveyorChannelRefSchema = z.strictObject({
  id: KingdomIdSchema,
  login: TwitchLoginSchema.nullable(),
  name: DisplayNameSchema.nullable(),
});
export const SurveyorRaidSchema = z.strictObject({
  from: SurveyorChannelRefSchema,
  to: SurveyorChannelRefSchema,
  viewers: UIntSchema.min(5),
  at: EpochMsSchema,
}).refine((raid) => raid.from.id !== raid.to.id, { message: 'A raid must join different channels.' });
export type SurveyorRaid = z.infer<typeof SurveyorRaidSchema>;

/** n/viewers are cumulative per pair, not the latest raid's traveller count. No IDs are supplied. */
export const SurveyorRecentRaidPairSchema = z.strictObject({
  from_login: TwitchLoginSchema.nullable(),
  to_login: TwitchLoginSchema.nullable(),
  n: PositiveIntSchema,
  viewers: UIntSchema,
  last_at: EpochMsSchema,
});
export const SurveyorRecentRaidsSchema = z.array(SurveyorRecentRaidPairSchema).max(30);
export type SurveyorRecentRaidPair = z.infer<typeof SurveyorRecentRaidPairSchema>;
