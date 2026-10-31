import { PersonIdSchema, TwitchIdSchema, type KingdomId, type PersonId } from '@chatdom/shared';
import { z } from '../../../web/src/twitch-moments/zod';
import { providerToken } from './credit';
import { applyEntitlement, type EntitlementAct } from './entitlement';
import { receiveAggregate, receiveForward, receiveRecipient, type GiftTier, type NoticeGifter } from './gifts';
import { IGNORED, type MomentNormalizer, type NormalizedFact } from './normalizer';

// Only the fields a support act needs are read. `message`, `system_message`, `badges`, `color`, fragments and
// every login are never read, kept or forwarded; unknown fields are stripped by the parser.
const Tier = z.enum(['1000', '2000', '3000']);
const TIER = { 1000: '1', 2000: '2', 3000: '3' } as const;
const Name = z.string().max(128);
const Months = z.number().int().min(0).max(100_000);

const NoticeEnvelope = z.object({
  broadcaster_user_id: TwitchIdSchema,
  // The anonymous gifter account is still a string ID; it is never resolved or kept.
  chatter_user_id: z.string().max(64),
  chatter_user_name: Name,
  chatter_is_anonymous: z.boolean(),
  message_id: z.string().min(1).max(128),
  notice_type: z.string().min(1).max(64).regex(/^[a-z_]+$/u),
  source_broadcaster_user_id: TwitchIdSchema.nullish(),
});

const OWNED = {
  sub: z.object({ sub_tier: Tier, is_prime: z.boolean() }),
  // Twitch renamed `sub_plan` to `sub_tier` (2023-11-07); older recordings still carry the old name.
  resub: z.object({ cumulative_months: Months, sub_tier: Tier.optional(), sub_plan: Tier.optional(), is_prime: z.boolean().nullish(),
    is_gift: z.boolean().nullish() }).refine(r => r.sub_tier !== undefined || r.sub_plan !== undefined, 'A resub names its tier'),
  sub_gift: z.object({ recipient_user_id: TwitchIdSchema, recipient_user_name: Name, sub_tier: Tier,
    community_gift_id: z.string().min(1).max(128).nullish() }),
  community_sub_gift: z.object({ id: z.string().min(1).max(128), total: z.number().int().min(1).max(100_000), sub_tier: Tier }),
  gift_paid_upgrade: z.object({}),
  prime_paid_upgrade: z.object({ sub_tier: Tier }),
  pay_it_forward: z.object({ gifter_is_anonymous: z.boolean().nullish(), gifter_user_id: TwitchIdSchema.nullish(), gifter_user_name: Name.nullish() }),
} as const;
type Owned = keyof typeof OWNED;
const isOwned = (type: string): type is Owned => Object.hasOwn(OWNED, type);

export type ChatNotice =
  | { readonly kind: 'entitlement'; readonly personId: PersonId; readonly act: EntitlementAct }
  | { readonly kind: 'recipient'; readonly groupKey: string; readonly single: boolean; readonly gifter: NoticeGifter; readonly tier: GiftTier;
      readonly noticeKey: string; readonly recipientId: PersonId; readonly recipientName: string }
  | { readonly kind: 'aggregate'; readonly groupKey: string; readonly gifter: NoticeGifter; readonly tier: GiftTier; readonly total: number }
  | { readonly kind: 'forward'; readonly giverId: PersonId; readonly from: { personId: PersonId; name: string | null } };

/** The gifter of a gift notice is its chatter; an anonymous chatter is never resolved, whatever its account ID. */
function gifterOf(envelope: z.infer<typeof NoticeEnvelope>): NoticeGifter | null {
  if (envelope.chatter_is_anonymous) return { personId: null, name: null };
  const id = PersonIdSchema.safeParse(envelope.chatter_user_id);
  return id.success ? { personId: id.data, name: envelope.chatter_user_name } : null;
}

function parseNotice(event: unknown, kingdomId: KingdomId): ChatNotice | typeof IGNORED | null {
  const parsed = NoticeEnvelope.safeParse(event);
  if (!parsed.success || parsed.data.broadcaster_user_id !== kingdomId) return null;
  const envelope = parsed.data, type = envelope.notice_type;
  // `shared_chat_*` twins and anything raised in another channel are that channel's support, not this kingdom's.
  if (!isOwned(type)) return IGNORED;
  if (envelope.source_broadcaster_user_id != null && envelope.source_broadcaster_user_id !== kingdomId) return IGNORED;
  const raw = (event as Record<string, unknown>)[type];
  const detail = <K extends Owned>(k: K): z.infer<typeof OWNED[K]> | null => {
    const result = OWNED[k].safeParse(raw);
    return result.success ? result.data as z.infer<typeof OWNED[K]> : null;
  };
  const gifter = gifterOf(envelope);
  if (gifter === null) return null;
  const self = gifter.personId;
  const noticeKey = providerToken(null, envelope.message_id);
  switch (type) {
    case 'sub': {
      const d = detail('sub');
      if (!d) return null;
      return self === null ? IGNORED : { kind: 'entitlement', personId: self, act: { kind: 'start', tier: d.is_prime ? 'prime' : TIER[d.sub_tier] } };
    }
    case 'resub': {
      const d = detail('resub');
      if (!d) return null;
      // A resub notice is shared by definition, gifted or not.
      return self === null ? IGNORED : { kind: 'entitlement', personId: self,
        act: { kind: 'resub', tier: d.is_prime ? 'prime' : TIER[(d.sub_tier ?? d.sub_plan)!], months: Math.min(d.cumulative_months, 1200), gifted: d.is_gift ?? null } };
    }
    case 'sub_gift': {
      const d = detail('sub_gift');
      if (!d) return null;
      const community = d.community_gift_id ?? null;
      return { kind: 'recipient', groupKey: community === null ? providerToken('g', envelope.message_id) : providerToken('cg', community), single: community === null,
        gifter, tier: TIER[d.sub_tier], noticeKey, recipientId: PersonIdSchema.parse(d.recipient_user_id), recipientName: d.recipient_user_name };
    }
    case 'community_sub_gift': {
      const d = detail('community_sub_gift');
      if (!d) return null;
      return { kind: 'aggregate', groupKey: providerToken('cg', d.id), gifter, tier: TIER[d.sub_tier], total: d.total };
    }
    case 'gift_paid_upgrade':
      if (!detail('gift_paid_upgrade')) return null;
      // The notice carries no tier: the known tier stays (tier 1 when nothing is known).
      return self === null ? IGNORED : { kind: 'entitlement', personId: self, act: { kind: 'upgrade', tier: null } };
    case 'prime_paid_upgrade': {
      const d = detail('prime_paid_upgrade');
      if (!d) return null;
      return self === null ? IGNORED : { kind: 'entitlement', personId: self, act: { kind: 'upgrade', tier: TIER[d.sub_tier] } };
    }
    case 'pay_it_forward': {
      const d = detail('pay_it_forward');
      if (!d) return null;
      // An anonymous original gifter has no public credit to attribute, so nothing is kept at all.
      if (self === null || d.gifter_is_anonymous === true || d.gifter_user_id == null) return IGNORED;
      return { kind: 'forward', giverId: self, from: { personId: PersonIdSchema.parse(d.gifter_user_id), name: d.gifter_user_name ?? null } };
    }
  }
}

/**
 * `channel.chat.notification` v1, the canonical support source whenever it is planned. Subs, shared resubs and
 * paid upgrades map to entitlement acts; gift notices feed one private group per provider group key, so the
 * aggregate and its recipient notices coalesce in any order. Other notice types belong to other families and
 * are ignored before any record is touched.
 */
export const channelChatNotification: MomentNormalizer<ChatNotice> = {
  type: 'channel.chat.notification',
  version: '1',
  parse: parseNotice,
  async apply(notice, { kingdomId, notification, repository, directory }) {
    const ledger = { kingdomId, repository, directory }, at = notification.occurredAt;
    switch (notice.kind) {
      case 'entitlement': {
        const result = await applyEntitlement(ledger, notice.personId, at, notice.act);
        return result.outcome === 'stale' ? result : { outcome: 'applied', facts: result.facts };
      }
      case 'recipient': {
        // The recipient's own home changes silently; the parcel is the group's. A stale entitlement still delivers it.
        const entitlement = await applyEntitlement(ledger, notice.recipientId, at, { kind: 'gift', tier: notice.tier });
        const facts: NormalizedFact[] = entitlement.outcome === 'applied' ? [...entitlement.facts] : [];
        facts.push(...await receiveRecipient(ledger, { ...notice, at }));
        return { outcome: 'applied', facts };
      }
      case 'aggregate':
        return { outcome: 'applied', facts: await receiveAggregate(ledger, { ...notice, at }) };
      case 'forward':
        return { outcome: 'applied', facts: await receiveForward(ledger, { ...notice, at }) };
    }
  },
};
