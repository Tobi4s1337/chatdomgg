import { PersonIdSchema, TwitchIdSchema, type PersonId } from '@chatdom/shared';
import type { Credit, MomentBodyOf } from '../../../web/src/twitch-moments/contracts';
import { z } from '../../../web/src/twitch-moments/zod';
import { providerToken, resolveCredit } from './credit';
import { applyEntitlement, type EntitlementAct, type EntitlementResult } from './entitlement';
import { GIFT_BEAT_WINDOW_MS, giftsKey, type GiftTier } from './gifts';
import type { MomentNormalizer, NormalizeResult, NormalizerContext } from './normalizer';

export { SUB_BEAT_WINDOW_MS, subscriptionHomeKey } from './entitlement';

// Provider payloads: unknown extra fields are stripped, never forwarded. Logins and provider display names are
// read only to validate shape; identity comes from user_id, and the public name from the citizen directory.
const Tier = z.enum(['1000', '2000', '3000']);
const TIER = { 1000: '1', 2000: '2', 3000: '3' } as const;
const Person = { user_id: TwitchIdSchema, user_login: z.string().max(64), user_name: z.string().max(128), broadcaster_user_id: TwitchIdSchema };

const ChannelSubscribeEvent = z.object({ ...Person, tier: Tier, is_gift: z.boolean() });
const SubscriptionEndEvent = z.object({ ...Person, tier: Tier, is_gift: z.boolean() });
// The shared message itself is never read or kept: only who, which tier and the cumulative months.
const SubscriptionMessageEvent = z.object({ ...Person, tier: Tier, cumulative_months: z.number().int().min(0).max(100_000) });
const SubscriptionGiftEvent = z.object({
  user_id: TwitchIdSchema.nullable(), user_name: z.string().max(128).nullable(), broadcaster_user_id: TwitchIdSchema,
  total: z.number().int().min(1).max(100_000), tier: Tier, is_anonymous: z.boolean(),
}).refine(e => e.is_anonymous || e.user_id !== null, 'A named gift names its gifter');

type Entitled = { readonly personId: PersonId; readonly act: EntitlementAct };

const asResult = (result: EntitlementResult): NormalizeResult => result.outcome === 'stale' ? result : { outcome: 'applied', facts: result.facts };
const entitled = (type: string, parse: MomentNormalizer<Entitled>['parse']): MomentNormalizer<Entitled> => ({
  type, version: '1', parse,
  apply: async ({ personId, act }, { kingdomId, notification, repository, directory }: NormalizerContext) =>
    asResult(await applyEntitlement({ kingdomId, repository, directory }, personId, notification.occurredAt, act)),
});

/**
 * `channel.subscribe` v1: first subscriptions and each gifted recipient; never resubs. Prime arrives as tier
 * 1000 and cannot be told apart here, so it is tier 1. It never carries months, so a new sub has at least one
 * and earned months never fall. A gifted recipient's entitlement updates silently: the parcel belongs to the
 * gift family, and in this structured source no recipient is ever correlated to a gift group.
 */
export const channelSubscribe = entitled('channel.subscribe', (event, kingdomId) => {
  const parsed = ChannelSubscribeEvent.safeParse(event);
  if (!parsed.success || parsed.data.broadcaster_user_id !== kingdomId) return null;
  const tier = TIER[parsed.data.tier];
  return { personId: PersonIdSchema.parse(parsed.data.user_id), act: parsed.data.is_gift ? { kind: 'gift', tier } : { kind: 'start', tier } };
});

/** `channel.subscription.end` v1: a quiet lapse. State only and never announced; earned months and tier stay. */
export const channelSubscriptionEnd = entitled('channel.subscription.end', (event, kingdomId) => {
  const parsed = SubscriptionEndEvent.safeParse(event);
  if (!parsed.success || parsed.data.broadcaster_user_id !== kingdomId) return null;
  return { personId: PersonIdSchema.parse(parsed.data.user_id), act: { kind: 'lapse', tier: TIER[parsed.data.tier] } };
});

/** `channel.subscription.message` v1: a resub the subscriber chose to share. It celebrates; months never fall. */
export const channelSubscriptionMessage = entitled('channel.subscription.message', (event, kingdomId) => {
  const parsed = SubscriptionMessageEvent.safeParse(event);
  if (!parsed.success || parsed.data.broadcaster_user_id !== kingdomId) return null;
  return { personId: PersonIdSchema.parse(parsed.data.user_id),
    act: { kind: 'resub', tier: TIER[parsed.data.tier], months: Math.min(parsed.data.cumulative_months, 1200), gifted: null } };
});

type StructuredGift = { readonly giver: { personId: PersonId; name: string | null } | null; readonly total: number; readonly tier: GiftTier };

/**
 * `channel.subscription.gift` v1: one collective gift act, a wave of `total` parcels. This source has no shared
 * key with the per-recipient `channel.subscribe` events, so it never lists recipients and never guesses them from
 * time, count or name; those recipients only change entitlement. `cumulative_total` is never read or kept.
 */
export const channelSubscriptionGift: MomentNormalizer<StructuredGift> = {
  type: 'channel.subscription.gift',
  version: '1',
  parse(event, kingdomId) {
    const parsed = SubscriptionGiftEvent.safeParse(event);
    if (!parsed.success || parsed.data.broadcaster_user_id !== kingdomId) return null;
    const { is_anonymous, user_id, user_name, total, tier } = parsed.data;
    return { giver: is_anonymous ? null : { personId: PersonIdSchema.parse(user_id), name: user_name }, total, tier: TIER[tier] };
  },
  async apply({ giver, total, tier }, { kingdomId, notification, directory }) {
    const at = notification.occurredAt, groupKey = providerToken('sg', notification.deliveryId);
    // Anonymous gifts stay anonymous even if another private record could identify the payer.
    const credit: Credit = giver === null ? null : await resolveCredit(directory, kingdomId, giver.personId, giver.name);
    const body: MomentBodyOf<'gifts'> = { kind: 'gifts', key: giftsKey(groupKey), displayUntil: at + GIFT_BEAT_WINDOW_MS, groupKey, giver: credit,
      tier, total, recipients: [], forwardedFrom: null };
    return { outcome: 'applied', facts: [{ current: true, body }] };
  },
};
