import { EpochMsSchema, PersonIdSchema, TokenSchema, UIntSchema, type PersonId } from '@chatdom/shared';
import {
  CreditSchema, MOMENT_CURRENT_LIMIT, PublicNameSchema, PublicRecipientSchema, SlotSchema, TwitchMomentFactSchema, type TwitchMomentFact,
} from '../../../web/src/twitch-moments/contracts';
import { z } from '../../../web/src/twitch-moments/zod';
import type { MomentRecordTransaction } from './ports';

/**
 * Server-only domain records. Only minimal provider IDs, private actor bindings and required domain state:
 * never raw messages, notices, payloads, tokens or display-name identity maps.
 */
export const RECORD_NAMESPACE = 'twitch-moments';
const KEY = /^twitch-moments:[a-z-]+(?::[A-Za-z0-9_.:-]{1,160})?$/u;

/** Upstream entitlement as Twitch last reported it. Months only ever rise; a lapse keeps what was earned. */
export const SubscriberRecordSchema = z.strictObject({
  version: z.literal(1),
  personId: PersonIdSchema,
  tier: z.enum(['prime', '1', '2', '3']),
  active: z.boolean(),
  months: UIntSchema.max(1200),
  gifted: z.boolean(),
  founder: z.boolean(),
  /** Provider time of the newest applied state change; older deliveries cannot override it. */
  changedAt: EpochMsSchema,
});
export type SubscriberRecord = z.infer<typeof SubscriberRecordSchema>;

export const GiftTierSchema = z.enum(['1', '2', '3']);
/** Bound for one gift act's private ledger; it matches the public `total` bound. */
export const GIFT_GROUP_LIMIT = 100_000;
/** Public recipients a gift fact carries; the private ledger keeps every one. */
export const GIFT_SHOWN_LIMIT = 100;

/**
 * One gift act (a community gift or a single gift), keyed by the provider's own group key. The giver's person ID
 * stays here for exact pay-it-forward binding only; it is null when the gift was anonymous. `shown` is the bounded
 * public recipient list exactly as published; `recipients` is the private ledger that dedupes parcels.
 */
export const GiftGroupRecordSchema = z.strictObject({
  version: z.literal(1),
  groupKey: TokenSchema,
  giverId: PersonIdSchema.nullable(),
  anonymous: z.boolean(),
  giver: CreditSchema,
  tier: GiftTierSchema,
  /** The aggregate's own count once its notice arrived; null while only recipient notices are known. */
  total: UIntSchema.min(1).max(GIFT_GROUP_LIMIT).nullable(),
  recipients: z.array(z.strictObject({ personId: PersonIdSchema, noticeKey: TokenSchema, at: EpochMsSchema })).max(GIFT_GROUP_LIMIT),
  shown: z.array(PublicRecipientSchema).max(GIFT_SHOWN_LIMIT),
  forwardedFrom: CreditSchema,
  /** Earliest provider time seen for this group. */
  firstAt: EpochMsSchema,
}).refine(g => !g.anonymous || (g.giverId === null && g.giver === null), 'An anonymous gift keeps no giver');
export type GiftGroupRecord = z.infer<typeof GiftGroupRecordSchema>;

/** The lasting trace of one parcel at a recipient's home: whose seal, and nothing that ranks or counts the giver. */
export const WrappingRecordSchema = z.strictObject({
  version: z.literal(1),
  personId: PersonIdSchema,
  groupKey: TokenSchema,
  giver: CreditSchema,
  forwardedFrom: CreditSchema,
  tier: GiftTierSchema,
  at: EpochMsSchema,
});
export type WrappingRecord = z.infer<typeof WrappingRecordSchema>;

const NamedCreditSchema = z.strictObject({ displayName: PublicNameSchema, slot: SlotSchema.nullable() });

/** A pay-it-forward that arrived before its gift group; consumed once by that gifter's next group in the window. */
export const ForwardRecordSchema = z.strictObject({
  version: z.literal(1),
  giverId: PersonIdSchema,
  from: NamedCreditSchema,
  at: EpochMsSchema,
  consumed: z.boolean(),
});
export type ForwardRecord = z.infer<typeof ForwardRecordSchema>;

/**
 * A gifter's own gift groups inside the short pay-it-forward window, so a forward can bind by exact identity.
 * Pruned to the window on every write: never a history, counter or rank.
 */
export const GifterWindowRecordSchema = z.strictObject({
  version: z.literal(1),
  giverId: PersonIdSchema,
  groups: z.array(z.strictObject({ groupKey: TokenSchema, firstAt: EpochMsSchema })).max(16),
});
export type GifterWindowRecord = z.infer<typeof GifterWindowRecordSchema>;

export const CurrentIndexSchema = z.strictObject({ version: z.literal(1), keys: z.array(TokenSchema).max(MOMENT_CURRENT_LIMIT) });
export const WatermarkSchema = z.strictObject({ version: z.literal(1), throughSeq: UIntSchema });

const key = (family: string, id?: string) => {
  const value = id === undefined ? `${RECORD_NAMESPACE}:${family}` : `${RECORD_NAMESPACE}:${family}:${id}`;
  if (!KEY.test(value)) throw new Error('Record key escapes the twitch-moments namespace');
  return value;
};

async function read<T>(tx: MomentRecordTransaction, recordKey: string, schema: z.ZodType<T>): Promise<T | null> {
  const value = await tx.get(recordKey);
  if (value === undefined || value === null) return null;
  const parsed = schema.safeParse(value);
  // A record that no longer validates is corruption, not absence: fail the transaction and publish nothing.
  if (!parsed.success) throw new Error(`Record ${recordKey.split(':')[1]} failed validation`);
  return parsed.data;
}

/** Typed, namespaced access for one transaction. */
export function momentRepository(tx: MomentRecordTransaction) {
  return {
    claimDelivery: (deliveryId: string) => tx.claim(key('delivery', TokenSchema.parse(deliveryId))),
    /** Chat metadata IDs live in their own family, so they can never collide with an EventSub delivery ID. */
    observationClaimed: async (deliveryId: string) => ((await tx.get(key('observation', TokenSchema.parse(deliveryId)))) ?? null) !== null,
    claimObservation: (deliveryId: string) => tx.claim(key('observation', TokenSchema.parse(deliveryId))),
    subscriber: (personId: PersonId) => read(tx, key('subscriber', personId), SubscriberRecordSchema),
    putSubscriber: (record: SubscriberRecord) => tx.put(key('subscriber', record.personId), SubscriberRecordSchema.parse(record)),
    giftGroup: (groupKey: string) => read(tx, key('gift-group', groupKey), GiftGroupRecordSchema),
    putGiftGroup: (record: GiftGroupRecord) => tx.put(key('gift-group', record.groupKey), GiftGroupRecordSchema.parse(record)),
    putWrapping: (record: WrappingRecord) => tx.put(key('wrapping', `${record.personId}:${record.groupKey}`), WrappingRecordSchema.parse(record)),
    forward: (giverId: PersonId) => read(tx, key('forward', giverId), ForwardRecordSchema),
    putForward: (record: ForwardRecord) => tx.put(key('forward', record.giverId), ForwardRecordSchema.parse(record)),
    gifterWindow: (giverId: PersonId) => read(tx, key('gifter-window', giverId), GifterWindowRecordSchema),
    putGifterWindow: (record: GifterWindowRecord) => tx.put(key('gifter-window', record.giverId), GifterWindowRecordSchema.parse(record)),
    /** The published current fact for one semantic key, if any. */
    currentFact: (factKey: string) => read(tx, key('current', TokenSchema.parse(factKey)), TwitchMomentFactSchema),
    async currentFacts(): Promise<TwitchMomentFact[]> {
      const index = await read(tx, key('current-index'), CurrentIndexSchema);
      const facts: TwitchMomentFact[] = [];
      for (const factKey of index?.keys ?? []) {
        const fact = await read(tx, key('current', factKey), TwitchMomentFactSchema);
        if (fact) facts.push(fact);
      }
      return facts;
    },
    /** Replace the current public state for one semantic key; returns false when the bounded index is full. */
    async setCurrent(fact: TwitchMomentFact): Promise<boolean> {
      const index = await read(tx, key('current-index'), CurrentIndexSchema) ?? { version: 1 as const, keys: [] };
      if (!index.keys.includes(fact.body.key)) {
        if (index.keys.length >= MOMENT_CURRENT_LIMIT) return false;
        index.keys.push(fact.body.key);
        await tx.put(key('current-index'), CurrentIndexSchema.parse(index));
      }
      await tx.put(key('current', fact.body.key), TwitchMomentFactSchema.parse(fact));
      return true;
    },
    watermark: async () => (await read(tx, key('watermark'), WatermarkSchema))?.throughSeq ?? 0,
    putWatermark: (throughSeq: number) => tx.put(key('watermark'), WatermarkSchema.parse({ version: 1, throughSeq })),
  };
}
export type MomentRepository = ReturnType<typeof momentRepository>;
