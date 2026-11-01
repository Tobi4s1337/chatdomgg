import { EpochMsSchema, PersonIdSchema, TokenSchema, UIntSchema, type PersonId } from '@chatdom/shared';
import {
  CreditSchema, MOMENT_CURRENT_LIMIT, PublicNameSchema, PublicRecipientSchema, SlotSchema, StatePhaseSchema, TwitchMomentFactSchema,
  type TwitchMomentFact,
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

export const DragonFormSchema = z.enum(['young', 'elder', '10', '25', '50', '100', 'record', 'golden']);
/** Named contributors kept for one train; the public list carries the same bound. */
export const HYPE_CONTRIBUTOR_LIMIT = 32;

/**
 * One Hype Train, keyed by the provider train's own token. The newest state is chosen by provider state (total,
 * level, expiry, phase), never by receipt order; once `end` is recorded nothing can reopen it. `allTimeHighLevel`
 * is exactly what `begin` reported (only begin carries it) and `recordFromRead` only what a status read proved;
 * neither is ever inferred. `contributors` holds the named people Twitch showed as top contributors, never quiet
 * or anonymous ones and never their amounts. `summoned` is the last dragon form requested for this train.
 */
export const HypeTrainRecordSchema = z.strictObject({
  version: z.literal(1),
  trainKey: TokenSchema,
  phase: StatePhaseSchema,
  level: UIntSchema.min(1).max(100_000),
  total: UIntSchema,
  progress: UIntSchema,
  goal: UIntSchema.min(1),
  startedAt: EpochMsSchema,
  endsAt: EpochMsSchema,
  golden: z.boolean(),
  treasure: z.boolean(),
  /** A stable token for a shared train's one battle identity; null when the train is not shared. */
  sharedSessionKey: TokenSchema.nullable(),
  allTimeHighLevel: UIntSchema.nullable(),
  recordFromRead: z.boolean(),
  contributors: z.array(z.strictObject({ personId: PersonIdSchema, credit: NamedCreditSchema })).max(HYPE_CONTRIBUTOR_LIMIT),
  summoned: DragonFormSchema.nullable(),
  /** Provider time of the newest applied delivery. */
  changedAt: EpochMsSchema,
});
export type HypeTrainRecord = z.infer<typeof HypeTrainRecordSchema>;

/** The last authoritative battle state applied: its revision orders later reports; a finished battle stays finished. */
export const BattleRecordSchema = z.strictObject({
  version: z.literal(1),
  battleKey: TokenSchema,
  revision: UIntSchema,
  phase: z.enum(['summoning', 'active', 'victory', 'retreat']),
  observedAt: EpochMsSchema,
});
export type BattleRecord = z.infer<typeof BattleRecordSchema>;

/** Families with at most one current public fact. `order` (a start time) decides which occupant is newest. */
export type CurrentSlot = 'hype' | 'battle' | 'poll';
export const CurrentSlotRecordSchema = z.strictObject({ version: z.literal(1), key: TokenSchema, order: EpochMsSchema });
/** Claim families claimed only once their delivery changed something. */
export type ChangeClaimFamily = 'observation' | 'battle-revision';

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
  /** Replace the current public state for one semantic key; returns false when the bounded index is full. */
  async function setCurrent(fact: TwitchMomentFact): Promise<boolean> {
    const index = await read(tx, key('current-index'), CurrentIndexSchema) ?? { version: 1 as const, keys: [] };
    if (!index.keys.includes(fact.body.key)) {
      if (index.keys.length >= MOMENT_CURRENT_LIMIT) return false;
      index.keys.push(fact.body.key);
      await tx.put(key('current-index'), CurrentIndexSchema.parse(index));
    }
    await tx.put(key('current', fact.body.key), TwitchMomentFactSchema.parse(fact));
    return true;
  }
  /** Drop one key from the current public state; the domain records behind it stay. */
  async function dropCurrent(factKey: string): Promise<void> {
    const index = await read(tx, key('current-index'), CurrentIndexSchema);
    if (!index?.keys.includes(factKey)) return;
    await tx.put(key('current-index'), CurrentIndexSchema.parse({ version: 1, keys: index.keys.filter(k => k !== factKey) }));
    await tx.put(key('current', factKey), null);
  }
  return {
    claimDelivery: (deliveryId: string) => tx.claim(key('delivery', TokenSchema.parse(deliveryId))),
    /**
     * Families claimed only once their work changed something: chat metadata IDs and authoritative battle
     * revisions each live in their own family, so they never collide with an EventSub delivery ID or each other.
     */
    claimedIn: async (family: ChangeClaimFamily, id: string) => ((await tx.get(key(family, TokenSchema.parse(id)))) ?? null) !== null,
    claimIn: (family: ChangeClaimFamily, id: string) => tx.claim(key(family, TokenSchema.parse(id))),
    subscriber: (personId: PersonId) => read(tx, key('subscriber', personId), SubscriberRecordSchema),
    putSubscriber: (record: SubscriberRecord) => tx.put(key('subscriber', record.personId), SubscriberRecordSchema.parse(record)),
    giftGroup: (groupKey: string) => read(tx, key('gift-group', groupKey), GiftGroupRecordSchema),
    putGiftGroup: (record: GiftGroupRecord) => tx.put(key('gift-group', record.groupKey), GiftGroupRecordSchema.parse(record)),
    putWrapping: (record: WrappingRecord) => tx.put(key('wrapping', `${record.personId}:${record.groupKey}`), WrappingRecordSchema.parse(record)),
    forward: (giverId: PersonId) => read(tx, key('forward', giverId), ForwardRecordSchema),
    putForward: (record: ForwardRecord) => tx.put(key('forward', record.giverId), ForwardRecordSchema.parse(record)),
    gifterWindow: (giverId: PersonId) => read(tx, key('gifter-window', giverId), GifterWindowRecordSchema),
    putGifterWindow: (record: GifterWindowRecord) => tx.put(key('gifter-window', record.giverId), GifterWindowRecordSchema.parse(record)),
    hypeTrain: (trainKey: string) => read(tx, key('hype-train', TokenSchema.parse(trainKey)), HypeTrainRecordSchema),
    putHypeTrain: (record: HypeTrainRecord) => tx.put(key('hype-train', record.trainKey), HypeTrainRecordSchema.parse(record)),
    /** One dragon request per train and form, claimed in the same transaction that decided to send it. */
    claimSummon: (requestKey: string) => tx.claim(key('summon', TokenSchema.parse(requestKey))),
    battle: (battleKey: string) => read(tx, key('battle', TokenSchema.parse(battleKey)), BattleRecordSchema),
    putBattle: (record: BattleRecord) => tx.put(key('battle', record.battleKey), BattleRecordSchema.parse(record)),
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
    setCurrent,
    /**
     * Make `fact` the one current fact of its slot, replacing the previous occupant. A fact whose `order` is older
     * than the occupant's is still published but stays out of current state (`superseded`), so a late report of
     * an earlier train never displaces the newer one; `full` means the bounded index has no room.
     */
    async setSlotCurrent(slot: CurrentSlot, fact: TwitchMomentFact, order: number): Promise<'current' | 'superseded' | 'full'> {
      const occupant = await read(tx, key('current-slot', slot), CurrentSlotRecordSchema);
      if (occupant && occupant.key !== fact.body.key && occupant.order > order) return 'superseded';
      if (occupant && occupant.key !== fact.body.key) await dropCurrent(occupant.key);
      if (!await setCurrent(fact)) return 'full';
      await tx.put(key('current-slot', slot), CurrentSlotRecordSchema.parse({ version: 1, key: fact.body.key, order }));
      return 'current';
    },
    /** A finished occupant leaves its slot and the current state; anyone else's occupancy is untouched. */
    async releaseSlot(slot: CurrentSlot, factKey: string): Promise<void> {
      const occupant = await read(tx, key('current-slot', slot), CurrentSlotRecordSchema);
      if (occupant?.key !== factKey) return;
      await dropCurrent(factKey);
      await tx.put(key('current-slot', slot), null);
    },
    watermark: async () => (await read(tx, key('watermark'), WatermarkSchema))?.throughSeq ?? 0,
    putWatermark: (throughSeq: number) => tx.put(key('watermark'), WatermarkSchema.parse({ version: 1, throughSeq })),
  };
}
export type MomentRepository = ReturnType<typeof momentRepository>;
