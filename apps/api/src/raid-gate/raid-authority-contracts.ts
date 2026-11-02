/**
 * The wire between the API's Raid Gate and Herald's raid authority (RS11). Herald is the only process that holds the
 * source broadcaster's user grant for `channel:manage:raids`; the API never sees a token. One private route, Herald
 * bearer-authenticated, strict JSON in and out:
 *
 * - `standing`: the source's raid grant and the monarch's write consent, for `RaidGrants` and `WriteConsent`.
 * - `live`: Get Streams for up to 100 channels with the app token, for `LiveChannels`.
 * - `start` / `cancel`: one Twitch write per `write.key` (the gate's outbox ID). Herald records the key durably before
 *   calling Twitch and never sends a second write for it; a repeat answers from that record, or `unknown`.
 * - `reconcile`: never writes. Answers from Herald's record of that key, `unknown` when it cannot tell.
 */
import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema, TokenSchema } from '../../../../packages/shared/src/identity';

export const RAID_AUTHORITY_ROUTE = '/internal/herald/raid-gate';
/** A command is a few IDs; the largest is a 100-channel live read. */
export const RAID_AUTHORITY_BODY_LIMIT = 4096;
export const RAID_AUTHORITY_LIVE_BATCH = 100;
/** The only kingdom Herald may write raids for on a live origin (decision 43: tobi4s_). */
export const RAID_AUTHORITY_LIVE_KINGDOM = '129634568';

const Origin = z.enum(['live', 'simulated']);
const Code = z.string().regex(/^[a-z0-9_-]{1,64}$/u);

/** The gate's outbox ID for one Twitch write: `<requestId>/start` or `<requestId>/cancel` (`repository.ts`). */
export const RaidAuthorityKeySchema = z.string().max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\/(?:start|cancel)$/u);

export const RaidAuthorityWriteSchema = z.strictObject({
  key: RaidAuthorityKeySchema, requestId: TokenSchema, from: KingdomIdSchema, to: KingdomIdSchema,
}).refine(write => write.from !== write.to, 'A raid joins different channels.')
  .refine(write => write.key.slice(0, write.key.lastIndexOf('/')) === write.requestId, 'The key names its own request.');

export const RaidAuthorityRequestSchema = z.discriminatedUnion('op', [
  z.strictObject({ version: z.literal(1), origin: Origin, op: z.literal('standing'), kingdomId: KingdomIdSchema }),
  z.strictObject({ version: z.literal(1), origin: Origin, op: z.literal('live'),
    kingdomIds: z.array(KingdomIdSchema).min(1).max(RAID_AUTHORITY_LIVE_BATCH) }),
  z.strictObject({ version: z.literal(1), origin: Origin, op: z.enum(['start', 'cancel', 'reconcile']), write: RaidAuthorityWriteSchema }),
]);

export const RaidAuthorityGrantSchema = z.enum(['granted', 'missing', 'revoked', 'unknown']);
export const RaidAuthorityConsentSchema = z.enum(['enabled', 'disabled']);
export const RaidAuthorityOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('accepted'), createdAt: EpochMsSchema }),
  z.strictObject({ kind: z.literal('rejected'), code: Code }),
  z.strictObject({ kind: z.literal('unknown') }),
]);

export const RaidAuthorityStandingReplySchema = z.strictObject({
  version: z.literal(1), origin: Origin, kingdomId: KingdomIdSchema,
  grant: RaidAuthorityGrantSchema, consent: RaidAuthorityConsentSchema,
});
export const RaidAuthorityLiveReplySchema = z.strictObject({
  version: z.literal(1), origin: Origin, live: z.record(KingdomIdSchema, z.boolean()),
});
export const RaidAuthorityWriteReplySchema = z.strictObject({
  version: z.literal(1), origin: Origin, key: RaidAuthorityKeySchema, outcome: RaidAuthorityOutcomeSchema,
});

export type RaidAuthorityWrite = z.infer<typeof RaidAuthorityWriteSchema>;
export type RaidAuthorityRequest = z.infer<typeof RaidAuthorityRequestSchema>;
export type RaidAuthorityOutcome = z.infer<typeof RaidAuthorityOutcomeSchema>;
export type RaidAuthorityStandingReply = z.infer<typeof RaidAuthorityStandingReplySchema>;
export type RaidAuthorityLiveReply = z.infer<typeof RaidAuthorityLiveReplySchema>;
export type RaidAuthorityWriteReply = z.infer<typeof RaidAuthorityWriteReplySchema>;
