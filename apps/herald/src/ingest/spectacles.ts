import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import { RealmMomentNoticeSchema, type RealmMomentNotice } from '@chatdom/shared/realm';
import { z } from 'zod';
import { channelBitsUse } from '../twitch-moments/bits';
import { hypeTrainBegin, hypeTrainEnd, hypeTrainProgress, type HypeUpdate } from '../twitch-moments/hype';
import { IGNORED, type MomentNormalizer } from '../twitch-moments/normalizer';
import type { HeraldEventType } from './subscriptions';

/** A raid's public sides. Only the raiding channel's identity and Twitch's own viewer count are read. */
const RaidEvent = z.object({
  from_broadcaster_user_id: z.string().regex(/^[1-9][0-9]{0,19}$/u),
  from_broadcaster_user_login: z.string().regex(/^[a-z0-9_]{1,64}$/u),
  from_broadcaster_user_name: z.string().min(1).max(128),
  to_broadcaster_user_id: z.string().max(64),
  viewers: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

/**
 * One verified spectacle notification, stripped to the realm's private evidence: who cheered (never the message),
 * the train's state (never contribution amounts) or the raid's source channel and count. Null is malformed or
 * addressed to another channel; `IGNORED` is well-formed but never a moment (a raid of nobody, or out of this kingdom).
 */
export function spectacleNotice(type: HeraldEventType, event: unknown, kingdomId: KingdomId): RealmMomentNotice | typeof IGNORED | null {
  switch (type) {
    case 'channel.bits.use': return fromNormalizer(channelBitsUse, event, kingdomId, use => ({ kind: 'bits', payer: use.payer, act: use.act }));
    case 'channel.hype_train.begin': return fromNormalizer(hypeTrainBegin, event, kingdomId, hype);
    case 'channel.hype_train.progress': return fromNormalizer(hypeTrainProgress, event, kingdomId, hype);
    case 'channel.hype_train.end': return fromNormalizer(hypeTrainEnd, event, kingdomId, hype);
    case 'channel.raid': {
      const parsed = RaidEvent.safeParse(event);
      if (!parsed.success || parsed.data.to_broadcaster_user_id !== kingdomId) return null;
      const e = parsed.data, from = KingdomIdSchema.safeParse(e.from_broadcaster_user_id);
      if (!from.success || from.data === kingdomId) return null;
      // Twitch can report a raid that brought nobody; there is no caravan to draw.
      if (e.viewers < 1) return IGNORED;
      return checked({ kind: 'raid', from: { kingdomId: from.data, login: e.from_broadcaster_user_login, name: e.from_broadcaster_user_name.slice(0, 128) },
        viewers: Math.min(e.viewers, 10_000_000) });
    }
    default: return IGNORED;
  }
}

const hype = (update: HypeUpdate): RealmMomentNotice => ({ kind: 'hype', update: {
  ...update, level: Math.min(update.level, 100_000), contributors: update.contributors.slice(0, 64),
} });

function fromNormalizer<P>(normalizer: MomentNormalizer<P>, event: unknown, kingdomId: KingdomId, map: (parsed: P) => RealmMomentNotice): RealmMomentNotice | typeof IGNORED | null {
  const parsed = normalizer.parse(event, kingdomId);
  if (parsed === null) return null;
  if (parsed === IGNORED) return IGNORED;
  return checked(map(parsed as P));
}

function checked(notice: RealmMomentNotice): RealmMomentNotice | null {
  const result = RealmMomentNoticeSchema.safeParse(notice);
  return result.success ? result.data : null;
}

const StrikeMessage = z.object({ message: z.object({ text: z.string().max(500) }) });
/** `!strike`, alone or followed by words, in any case. The rest of the message is never read or kept. */
export function isStrike(raw: unknown): boolean {
  const parsed = StrikeMessage.safeParse(raw);
  return parsed.success && /^!strike(?:\s|$)/iu.test(parsed.data.message.text.trim());
}
