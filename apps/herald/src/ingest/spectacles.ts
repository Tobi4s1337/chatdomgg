import { KingdomIdSchema, PersonIdSchema, type KingdomId } from '@chatdom/shared';
import { parseTwitchTime } from '@chatdom/twitch';
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

const UserId = z.string().regex(/^[1-9][0-9]{0,19}$/u);
const Time = z.string().min(1).max(64);
/** `channel.follow` v2: only who followed and when. */
const FollowEvent = z.object({
  user_id: UserId, user_name: z.string().min(1).max(128), broadcaster_user_id: z.string().max(64), followed_at: Time,
});
/** A redemption of a channel-point reward: the reward's title and the redeemer. `user_input` is never read. */
const RedemptionEvent = z.object({
  id: z.string().min(1).max(128), broadcaster_user_id: z.string().max(64), user_id: UserId, user_name: z.string().min(1).max(128),
  status: z.string().max(32), reward: z.object({ id: z.string().min(1).max(128), title: z.string().min(1).max(45) }),
});
/** A poll's question and choices with their votes. Bits voting is retired on Twitch and never read. */
const PollEvent = z.object({
  id: z.string().min(1).max(128), broadcaster_user_id: z.string().max(64), title: z.string().min(1).max(60),
  choices: z.array(z.object({ id: z.string().min(1).max(128), title: z.string().min(1).max(25),
    votes: z.number().int().min(0).optional(), channel_points_votes: z.number().int().min(0).optional(),
    bits_votes: z.number().int().min(0).optional() })).min(2).max(5),
  started_at: Time, ends_at: Time.optional(), ended_at: Time.optional(), status: z.string().max(32).optional(),
});
const POLL_STATUS = new Set(['active', 'completed', 'terminated', 'archived', 'moderated', 'invalid']);
const REDEMPTION_STATUS = new Set(['unfulfilled', 'fulfilled', 'canceled']);

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
      if (!parsed.success) return null;
      // Outgoing observations belong to the gate authority, never the incoming caravan renderer.
      if (parsed.data.from_broadcaster_user_id === kingdomId && parsed.data.to_broadcaster_user_id !== kingdomId
        && KingdomIdSchema.safeParse(parsed.data.to_broadcaster_user_id).success) return IGNORED;
      if (parsed.data.to_broadcaster_user_id !== kingdomId) return null;
      const e = parsed.data, from = KingdomIdSchema.safeParse(e.from_broadcaster_user_id);
      if (!from.success || from.data === kingdomId) return null;
      // Twitch can report a raid that brought nobody; there is no caravan to draw.
      if (e.viewers < 1) return IGNORED;
      return checked({ kind: 'raid', from: { kingdomId: from.data, login: e.from_broadcaster_user_login, name: e.from_broadcaster_user_name.slice(0, 128) },
        viewers: Math.min(e.viewers, 10_000_000) });
    }
    case 'channel.follow': {
      const parsed = FollowEvent.safeParse(event);
      if (!parsed.success || parsed.data.broadcaster_user_id !== kingdomId) return null;
      const e = parsed.data, followedAt = parseTwitchTime(e.followed_at);
      // The broadcaster cannot follow their own channel; a follow without a time is not evidence.
      if (e.user_id === kingdomId || followedAt === null) return null;
      return checked({ kind: 'follow', person: { personId: PersonIdSchema.parse(e.user_id), name: e.user_name }, followedAt });
    }
    case 'channel.channel_points_custom_reward_redemption.add': {
      const parsed = RedemptionEvent.safeParse(event);
      if (!parsed.success || parsed.data.broadcaster_user_id !== kingdomId) return null;
      const e = parsed.data;
      return checked({ kind: 'redemption', redemptionId: e.id, rewardId: e.reward.id, rewardTitle: e.reward.title,
        person: { personId: PersonIdSchema.parse(e.user_id), name: e.user_name },
        status: REDEMPTION_STATUS.has(e.status) ? e.status as 'unfulfilled' : 'unknown' });
    }
    case 'channel.poll.begin': case 'channel.poll.progress': case 'channel.poll.end': {
      const parsed = PollEvent.safeParse(event);
      if (!parsed.success || parsed.data.broadcaster_user_id !== kingdomId) return null;
      const e = parsed.data, phase = type === 'channel.poll.begin' ? 'begin' : type === 'channel.poll.end' ? 'end' : 'progress';
      const startedAt = parseTwitchTime(e.started_at), endsAt = parseTwitchTime(e.ended_at ?? e.ends_at ?? '');
      if (startedAt === null || endsAt === null) return null;
      const status = phase === 'end' ? (POLL_STATUS.has(e.status ?? '') ? e.status as 'completed' : 'invalid') : 'active';
      return checked({ kind: 'poll', pollId: e.id, phase, title: e.title, startedAt, endsAt, status,
        choices: e.choices.map(choice => {
          const votes = choice.votes ?? 0;
          // One person, one vote: votes bought with channel points (or Bits, retired on Twitch) are counted apart.
          return { id: choice.id, title: choice.title, votes, paidVotes: Math.min(votes, (choice.channel_points_votes ?? 0) + (choice.bits_votes ?? 0)) };
        }) });
    }
    default: return IGNORED;
  }
}

/** A broadcast opened (only a `live` stream) or closed: the night's evidence, beside the presence beacon. */
export function streamNotice(live: boolean, streamId: string | null, startedAt: number | null): RealmMomentNotice | null {
  return checked({ kind: 'stream', phase: live ? 'online' : 'offline', streamId: streamId !== null && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(streamId) ? streamId : null, startedAt });
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
