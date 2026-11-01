import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema, PersonIdSchema, TokenSchema } from '../../../../packages/shared/src/identity';

export const RAID_GUEST_WINDOW_MS = 600_000;
export const RAID_GUEST_CLOCK_ALLOWANCE_MS = 5_000;
export const RAID_GUEST_BODY_BYTES = 2_048;
export const RAID_GUEST_PREFIX = '/api/raid-gate/guest';
export const RaidGuestRaidIdSchema = z.string().regex(/^raid\.[a-f0-9]{64}$/u);
const Origin = z.enum(['live', 'simulated']);
const Channel = z.strictObject({ kingdomId: KingdomIdSchema, login: z.string().regex(/^[a-z0-9_]{1,64}$/u),
  name: z.string().min(1).max(128).regex(/^[^\p{Cc}\p{Cf}]*$/u) });

/** Public request: identity, destination and origin come from the authenticated host and route. */
export const RaidGuestBeginRequestSchema = z.strictObject({ version: z.literal(1), raidId: RaidGuestRaidIdSchema });
export const RaidGuestBeginBodySchema = RaidGuestBeginRequestSchema;
/** Compatible with the existing bounded sign-in return-path grammar; carries no authority. */
export function raidWelcomePath(kingdomId: string, raidId: string): string {
  const kingdom = KingdomIdSchema.parse(kingdomId), digest = RaidGuestRaidIdSchema.parse(raidId).slice(5);
  return `/raid/${kingdom}/${digest.slice(0, 32)}/${digest.slice(32)}`;
}
export function parseRaidWelcomePath(pathname: string): { kingdomId: z.infer<typeof KingdomIdSchema>; raidId: string } | null {
  const match = /^\/raid\/([1-9][0-9]{0,31})\/([a-f0-9]{32})\/([a-f0-9]{32})$/u.exec(pathname);
  return match ? { kingdomId: KingdomIdSchema.parse(match[1]), raidId: `raid.${match[2]}${match[3]}` } : null;
}
const Session = { version: z.literal(1), origin: Origin, sessionId: z.uuid(), personId: PersonIdSchema, kingdomId: KingdomIdSchema };
export const RaidGuestBeginSchema = z.strictObject({ ...Session, raidId: RaidGuestRaidIdSchema });
export const RaidGuestReadSchema = z.strictObject({ ...Session, entryId: z.uuid().optional(), raidId: RaidGuestRaidIdSchema.optional() });
/** Server-only room callback; NEVER expose this schema as an HTTP write route. */
export const RaidGuestRoomReceiptSchema = z.strictObject({ version: z.literal(1), origin: Origin,
  entryId: z.uuid(), personId: PersonIdSchema, kingdomId: KingdomIdSchema, at: EpochMsSchema });
/** Authenticated Herald evidence only; chat text and display names are intentionally absent. */
export const RaidGuestChatSchema = z.strictObject({ version: z.literal(1), origin: Origin,
  kingdomId: KingdomIdSchema, messageId: TokenSchema, personId: PersonIdSchema, at: EpochMsSchema });
export const RaidGuestInvitationSchema = z.strictObject({ raidId: RaidGuestRaidIdSchema,
  kingdomId: KingdomIdSchema, from: Channel, expiresAt: EpochMsSchema })
  .refine(value => value.from.kingdomId !== value.kingdomId, 'A guest comes from another kingdom.');
export const RaidGuestProjectionSchema = z.strictObject({ version: z.literal(1), origin: Origin,
  raidId: RaidGuestRaidIdSchema, kingdomId: KingdomIdSchema, personId: PersonIdSchema, entryId: z.uuid(),
  from: Channel, to: Channel, arrivedAt: EpochMsSchema, raidOccurredAt: EpochMsSchema })
  .refine(value => value.to.kingdomId === value.kingdomId && value.from.kingdomId !== value.kingdomId
    && value.arrivedAt >= value.raidOccurredAt && value.arrivedAt < value.raidOccurredAt + RAID_GUEST_WINDOW_MS,
  'A guest projection preserves the witnessed destination and arrival window.');
export const RaidGuestAttributionSchema = z.strictObject({ raidId: RaidGuestRaidIdSchema, from: Channel, to: Channel, occurredAt: EpochMsSchema })
  .refine(value => value.from.kingdomId !== value.to.kingdomId, 'A raid connects two kingdoms.');
export const RaidGuestRewardSchema = z.strictObject({ eligible: z.boolean(), reason: z.enum(['eligible', 'small_raid', 'day_cap']),
  day: z.number().int().nonnegative() }).refine(value => value.eligible === (value.reason === 'eligible'));
export const RaidGuestStampSchema = z.strictObject({ id: TokenSchema, kind: z.enum(['visit', 'raid']), kingdomId: KingdomIdSchema,
  occurredAt: EpochMsSchema, raidId: RaidGuestRaidIdSchema.nullable(), arrivedWith: RaidGuestAttributionSchema.nullable(),
  reward: RaidGuestRewardSchema }).superRefine((stamp, context) => {
  if ((stamp.kind === 'raid') !== (stamp.raidId !== null) || (stamp.kind === 'visit') !== (stamp.arrivedWith !== null)) {
    context.addIssue({ code: 'custom', message: 'A walk-in is a visit, never an inferred outbound march.' });
  }
  if (stamp.arrivedWith && stamp.arrivedWith.to.kingdomId !== stamp.kingdomId) {
    context.addIssue({ code: 'custom', message: 'Visit attribution must end in the visited kingdom.' });
  }
});
export const RaidGuestRefusalReasonSchema = z.enum(['unknown_raid', 'expired', 'session', 'citizen_here', 'entry', 'no_intent', 'not_tied', 'not_signed_in', 'superseded']);
export const RaidGuestBeginReplySchema = z.discriminatedUnion('status', [
  z.strictObject({ version: z.literal(1), status: z.literal('pending'), invitation: RaidGuestInvitationSchema }),
  z.strictObject({ version: z.literal(1), status: z.literal('refused'), reason: RaidGuestRefusalReasonSchema }),
]);
export const RaidGuestReadReplySchema = z.strictObject({ version: z.literal(1), guest: RaidGuestProjectionSchema.nullable() });
export type RaidGuestBegin = z.infer<typeof RaidGuestBeginSchema>;
export type RaidGuestRead = z.infer<typeof RaidGuestReadSchema>;
export type RaidGuestRoomReceipt = z.infer<typeof RaidGuestRoomReceiptSchema>;
export type RaidGuestChat = z.infer<typeof RaidGuestChatSchema>;
export type RaidGuestProjection = z.infer<typeof RaidGuestProjectionSchema>;
export type RaidGuestStamp = z.infer<typeof RaidGuestStampSchema>;
export type RaidGuestReward = z.infer<typeof RaidGuestRewardSchema>;
export type RaidGuestRefusalReason = z.infer<typeof RaidGuestRefusalReasonSchema>;
export type RaidGuestBeginReply = z.infer<typeof RaidGuestBeginReplySchema>;
