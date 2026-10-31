import { PersonIdSchema, TokenSchema, TwitchIdSchema, type PersonId } from '@chatdom/shared';
import type { Credit, MomentBodyOf } from '../../../web/src/twitch-moments/contracts';
import { z } from '../../../web/src/twitch-moments/zod';
import { isAnonymousAccount, providerToken, resolveCredit } from './credit';
import type { MomentNormalizer } from './normalizer';

/** A cheer or Power-up may begin for one minute after Twitch reports it; later it has already passed. */
export const BITS_BEAT_WINDOW_MS = 60_000;
/** The public cheer bound. Larger amounts are clamped: the ladder tops out long before it. */
export const CHEER_BITS_MAX = 100_000_000;

// Only who, how many Bits and which effect are read. `message`, its text and fragments, every login beyond the
// anonymous check, the custom Power-up title and `message_effect_id` are never read, kept or forwarded.
const BitsUseEvent = z.object({
  broadcaster_user_id: TwitchIdSchema,
  user_id: z.string().max(64).nullable(),
  user_login: z.string().max(64).nullable(),
  user_name: z.string().max(128).nullable(),
  bits: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  type: z.enum(['cheer', 'power_up', 'custom_power_up']),
  power_up: z.object({
    type: z.enum(['message_effect', 'celebration', 'gigantify_an_emote']),
    emote: z.object({ id: z.string().max(128) }).nullish(),
  }).nullish(),
  custom_power_up: z.object({ reward_id: z.string().min(1).max(128) }).nullish(),
});

type Effect = MomentBodyOf<'power-up'>['effect'];
export type BitsUse = {
  readonly payer: { readonly personId: PersonId; readonly name: string | null } | null;
  readonly act: { readonly kind: 'cheer'; readonly bits: number }
    | { readonly kind: 'power-up'; readonly effect: Effect; readonly emoteId: string | null; readonly mappingKey: string | null };
};

const POWER_UP: Readonly<Record<'message_effect' | 'celebration', Effect>> = { message_effect: 'message-effect', celebration: 'celebration' };

/**
 * `channel.bits.use` v1: cheers and Power-ups, one shared moment for the whole town each. A gigantified emote
 * names its emote (approval stays with the emote owner's lookup); a custom Power-up names its reward through a
 * provider token the monarch's approved mapping can reference. Credit is by person ID only. An anonymous cheer,
 * a null user or one of Twitch's stand-in accounts, stays anonymous even if a private record could identify the
 * payer. These are transient beats: no Bits total, counter or rank is recorded anywhere.
 */
export const channelBitsUse: MomentNormalizer<BitsUse> = {
  type: 'channel.bits.use',
  version: '1',
  parse(event, kingdomId) {
    const parsed = BitsUseEvent.safeParse(event);
    if (!parsed.success || parsed.data.broadcaster_user_id !== kingdomId) return null;
    const e = parsed.data;
    let payer: BitsUse['payer'] = null;
    if (!isAnonymousAccount(e.user_id, e.user_login)) {
      const id = PersonIdSchema.safeParse(e.user_id);
      if (!id.success) return null;
      payer = { personId: id.data, name: e.user_name };
    }
    switch (e.type) {
      case 'cheer':
        return { payer, act: { kind: 'cheer', bits: Math.min(e.bits, CHEER_BITS_MAX) } };
      case 'power_up': {
        if (!e.power_up) return null;
        if (e.power_up.type !== 'gigantify_an_emote') return { payer, act: { kind: 'power-up', effect: POWER_UP[e.power_up.type], emoteId: null, mappingKey: null } };
        const emote = TokenSchema.safeParse(e.power_up.emote?.id);
        return emote.success ? { payer, act: { kind: 'power-up', effect: 'emote-balloon', emoteId: emote.data, mappingKey: null } } : null;
      }
      case 'custom_power_up':
        if (!e.custom_power_up) return null;
        return { payer, act: { kind: 'power-up', effect: 'custom', emoteId: null, mappingKey: providerToken('cp', e.custom_power_up.reward_id) } };
    }
  },
  async apply({ payer, act }, { kingdomId, notification, directory }) {
    const at = notification.occurredAt, displayUntil = at + BITS_BEAT_WINDOW_MS;
    const credit: Credit = payer === null ? null : await resolveCredit(directory, kingdomId, payer.personId, payer.name);
    const body: MomentBodyOf<'cheer' | 'power-up'> = act.kind === 'cheer'
      ? { kind: 'cheer', key: providerToken('cheer', notification.deliveryId), displayUntil, credit, bits: act.bits }
      : { kind: 'power-up', key: providerToken('power-up', notification.deliveryId), displayUntil, credit, effect: act.effect, emoteId: act.emoteId,
          mappingKey: act.mappingKey };
    return { outcome: 'applied', facts: [{ current: false, body }] };
  },
};
