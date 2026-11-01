import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema, PersonIdSchema, TokenSchema, UIntSchema } from '../identity';

/** Private Herald → realm evidence. Provider bodies, chat text and browser-selected credits never enter it. */
const Tier = z.enum(['prime', '1', '2', '3']);
const GiftTier = z.enum(['1', '2', '3']);
const Name = z.string().max(128);
const Gifter = z.strictObject({ personId: PersonIdSchema.nullable(), name: Name.nullable() })
  .refine(gifter => gifter.personId !== null || gifter.name === null, 'Anonymous gifts keep no name');
const Entitlement = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('start'), tier: Tier }),
  z.strictObject({ kind: z.literal('resub'), tier: Tier, months: UIntSchema.max(1200), gifted: z.boolean().nullable() }),
  z.strictObject({ kind: z.literal('upgrade'), tier: Tier.nullable() }),
]);
const Payer = z.strictObject({ personId: PersonIdSchema, name: Name.nullable() });
const BitsAct = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('cheer'), bits: UIntSchema.min(1).max(100_000_000) }),
  z.strictObject({ kind: z.literal('power-up'), effect: z.enum(['emote-balloon', 'message-effect', 'celebration', 'custom']),
    emoteId: TokenSchema.nullable(), mappingKey: TokenSchema.nullable() }),
]);
const HypeUpdate = z.strictObject({
  trainKey: TokenSchema, sharedSessionKey: TokenSchema.nullable(), phase: z.enum(['begin', 'progress', 'end']),
  level: UIntSchema.min(1).max(100_000), total: UIntSchema, progress: UIntSchema.nullable(), goal: UIntSchema.nullable(),
  startedAt: EpochMsSchema, endsAt: EpochMsSchema, golden: z.boolean(), treasure: z.boolean(),
  allTimeHighLevel: UIntSchema.nullable(), recordVerified: z.boolean(),
  contributors: z.array(z.strictObject({ personId: PersonIdSchema, name: Name.nullable() })).max(64),
});
const Person = z.strictObject({ personId: PersonIdSchema, name: Name });
const PollChoice = z.strictObject({ id: TokenSchema, title: z.string().min(1).max(25), votes: UIntSchema, paidVotes: UIntSchema })
  .refine(choice => choice.paidVotes <= choice.votes, "Paid votes are part of the votes");
const RaidSource = z.strictObject({ kingdomId: KingdomIdSchema, login: z.string().regex(/^[a-z0-9_]{1,64}$/u), name: Name });
export const RealmSupportNoticeSchema = z.discriminatedUnion('kind', [
  /** `name` is the public name Twitch showed with the notice, so a subscriber with no home yet can be settled. */
  z.strictObject({ kind: z.literal('entitlement'), personId: PersonIdSchema, act: Entitlement, name: Name.nullable().optional() }),
  z.strictObject({ kind: z.literal('recipient'), groupKey: TokenSchema, single: z.boolean(), gifter: Gifter, tier: GiftTier,
    noticeKey: TokenSchema, recipientId: PersonIdSchema, recipientName: Name }),
  z.strictObject({ kind: z.literal('aggregate'), groupKey: TokenSchema, gifter: Gifter, tier: GiftTier, total: UIntSchema.min(1).max(100_000) }),
  z.strictObject({ kind: z.literal('forward'), giverId: PersonIdSchema, from: z.strictObject({ personId: PersonIdSchema, name: Name.nullable() }) }),
]);
export const RealmSupportObservationSchema = z.strictObject({
  version: z.literal(1), id: TokenSchema, kingdomId: KingdomIdSchema, origin: z.enum(['live', 'simulated']),
  occurredAt: EpochMsSchema, receivedAt: EpochMsSchema, notice: RealmSupportNoticeSchema,
}).refine(value => value.occurredAt <= value.receivedAt + 5_000, 'Provider time is too far in the future');
export type RealmSupportObservation = z.infer<typeof RealmSupportObservationSchema>;

/** Private Herald → realm evidence for the town's spectacles (Bits, the Hype Train, incoming raids) and the acts that shape it. */
export const RealmMomentNoticeSchema = z.discriminatedUnion('kind', [
  /** `channel.bits.use`: who (or nobody, when anonymous) and the act. No message, total or rank. */
  z.strictObject({ kind: z.literal('bits'), payer: Payer.nullable(), act: BitsAct }),
  /** One provider report of a Hype Train (`channel.hype_train.*` v2), already stripped to train state. */
  z.strictObject({ kind: z.literal('hype'), update: HypeUpdate }),
  /** `channel.raid` into this kingdom: the raiding channel's public identity and Twitch's viewer count. */
  z.strictObject({ kind: z.literal('raid'), from: RaidSource, viewers: UIntSchema.min(1).max(10_000_000) }),
  /** `channel.follow` v2: who followed (by the name Twitch shows) and when. The follow date is tenure evidence. */
  z.strictObject({ kind: z.literal('follow'), person: Person, followedAt: EpochMsSchema }),
  /** `stream.online` (a live broadcast only) or `stream.offline`: the night opens or rests. */
  z.strictObject({ kind: z.literal('stream'), phase: z.enum(['online', 'offline']), streamId: TokenSchema.nullable(), startedAt: EpochMsSchema.nullable() }),
  /** `channel.channel_points_custom_reward_redemption.add`: the reward's own title and the redeemer. Never the input text. */
  z.strictObject({ kind: z.literal('redemption'), redemptionId: TokenSchema, rewardId: TokenSchema, rewardTitle: z.string().min(1).max(45),
    person: Person, status: z.enum(['unfulfilled', 'fulfilled', 'canceled', 'unknown']) }),
  /** `channel.poll.begin/progress/end`: the question and each choice's votes; `paidVotes` (channel points, and the retired Bits votes when a payload still carries them) are inside `votes`. */
  z.strictObject({ kind: z.literal('poll'), pollId: TokenSchema, phase: z.enum(['begin', 'progress', 'end']), title: z.string().min(1).max(60),
    choices: z.array(PollChoice).min(2).max(5), startedAt: EpochMsSchema, endsAt: EpochMsSchema,
    status: z.enum(['active', 'completed', 'terminated', 'archived', 'moderated', 'invalid']) }),
]);
export type RealmMomentNotice = z.infer<typeof RealmMomentNoticeSchema>;
/** Durable like support evidence: Herald's outbox resends it under its EventSub message ID until the realm answers. */
export const RealmMomentObservationSchema = z.strictObject({
  version: z.literal(1), id: TokenSchema, kingdomId: KingdomIdSchema, origin: z.enum(['live', 'simulated']),
  occurredAt: EpochMsSchema, receivedAt: EpochMsSchema, notice: RealmMomentNoticeSchema,
}).refine(value => value.occurredAt <= value.receivedAt + 5_000, 'Provider time is too far in the future');
export type RealmMomentObservation = z.infer<typeof RealmMomentObservationSchema>;

/**
 * A chat `!strike` witnessed by Herald, relayed transiently to the realm's dragon battle. Never stored, never retried:
 * the realm alone decides whether it lands (an active battle, the person's cadence).
 */
export const RealmStrikeSchema = z.strictObject({
  version: z.literal(1), kingdomId: KingdomIdSchema, personId: PersonIdSchema, messageId: TokenSchema,
  origin: z.enum(['live', 'simulated']), observedAt: EpochMsSchema,
});
export type RealmStrike = z.infer<typeof RealmStrikeSchema>;
