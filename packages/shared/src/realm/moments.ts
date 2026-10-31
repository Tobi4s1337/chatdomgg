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
export const RealmSupportNoticeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('entitlement'), personId: PersonIdSchema, act: Entitlement }),
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
