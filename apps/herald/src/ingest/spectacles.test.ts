import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { RealmMomentNoticeSchema } from '@chatdom/shared/realm';
import { describe, expect, it } from 'vitest';
import { IGNORED } from '../twitch-moments/normalizer';
import { isStrike, spectacleNotice, streamNotice } from './spectacles';

const K = KingdomIdSchema.parse('424242');
const NEIGHBOUR = KingdomIdSchema.parse('515151');
const CHEERER = PersonIdSchema.parse('81000001'), RIDER = PersonIdSchema.parse('81000002');

const bits = (overrides: Record<string, unknown> = {}) => ({
  broadcaster_user_id: K, broadcaster_user_login: 'simulated_kingdom', broadcaster_user_name: 'SIMULATED Kingdom',
  user_id: CHEERER, user_login: 'cheerer', user_name: 'Cheerer', bits: 500, type: 'cheer', power_up: null,
  message: { text: 'SIMULATED private cheer words Cheer500', fragments: [{ type: 'text', text: 'SIMULATED private cheer words' }] },
  ...overrides,
});
const TRAIN_ID = '1b0AsbInCHZW2SQFQkCzqN07Ib2';
const train = (overrides: Record<string, unknown> = {}) => ({
  id: TRAIN_ID, broadcaster_user_id: K, broadcaster_user_login: 'simulated_kingdom', broadcaster_user_name: 'SIMULATED Kingdom',
  total: 1200, level: 2, started_at: '2026-10-30T20:00:00.000Z', type: 'regular', is_shared_train: false, shared_train_participants: null,
  top_contributions: [{ user_id: RIDER, user_login: 'rider', user_name: 'Rider', type: 'bits', total: 900 }],
  ...overrides,
});
const running = (overrides: Record<string, unknown> = {}) => train({ progress: 200, goal: 1800, expires_at: '2026-10-30T20:05:00.000Z', ...overrides });
const raid = (overrides: Record<string, unknown> = {}) => ({
  from_broadcaster_user_id: NEIGHBOUR, from_broadcaster_user_login: 'neighbour', from_broadcaster_user_name: 'Neighbour',
  to_broadcaster_user_id: K, to_broadcaster_user_login: 'simulated_kingdom', to_broadcaster_user_name: 'SIMULATED Kingdom', viewers: 42,
  ...overrides,
});

describe('spectacleNotice', () => {
  it('turns a cheer into a bits notice credited by person ID that never carries its message', () => {
    const notice = spectacleNotice('channel.bits.use', bits(), K);
    expect(notice).toEqual({ kind: 'bits', payer: { personId: CHEERER, name: 'Cheerer' }, act: { kind: 'cheer', bits: 500 } });
    expect(RealmMomentNoticeSchema.safeParse(notice).success).toBe(true);
    expect(JSON.stringify(notice)).not.toContain('private');
    expect(JSON.stringify(notice)).not.toContain('cheerer');
  });

  it('turns each kind of Power-up into its effect, the emote it names or the custom reward token', () => {
    expect(spectacleNotice('channel.bits.use', bits({ type: 'power_up', power_up: { type: 'celebration', emote: null, message_effect_id: null } }), K))
      .toEqual({ kind: 'bits', payer: { personId: CHEERER, name: 'Cheerer' }, act: { kind: 'power-up', effect: 'celebration', emoteId: null, mappingKey: null } });
    expect(spectacleNotice('channel.bits.use', bits({ type: 'power_up', power_up: { type: 'message_effect', emote: null, message_effect_id: 'simmer' } }), K))
      .toMatchObject({ kind: 'bits', act: { kind: 'power-up', effect: 'message-effect', emoteId: null } });
    expect(spectacleNotice('channel.bits.use', bits({ type: 'power_up', power_up: { type: 'gigantify_an_emote', emote: { id: 'emotesv2_abc', name: 'Kappa' } } }), K))
      .toMatchObject({ kind: 'bits', act: { kind: 'power-up', effect: 'emote-balloon', emoteId: 'emotesv2_abc', mappingKey: null } });
    expect(spectacleNotice('channel.bits.use', bits({ type: 'custom_power_up', custom_power_up: { reward_id: 'reward-7', title: 'SIMULATED private title' } }), K))
      .toMatchObject({ kind: 'bits', act: { kind: 'power-up', effect: 'custom', emoteId: null, mappingKey: 'cp.reward-7' } });
  });

  it('keeps a null user or one of the stand-in accounts anonymous', () => {
    for (const who of [{ user_id: null, user_login: null, user_name: null }, { user_id: '407665396', user_login: 'ananonymouscheerer', user_name: 'AnAnonymousCheerer' },
      { user_id: '999', user_login: 'AnAnonymousCheerer', user_name: 'AnAnonymousCheerer' }]) {
      expect(spectacleNotice('channel.bits.use', bits(who), K)).toEqual({ kind: 'bits', payer: null, act: { kind: 'cheer', bits: 500 } });
    }
  });

  it('refuses Bits addressed to another channel or malformed, and never invents a payer', () => {
    expect(spectacleNotice('channel.bits.use', bits(), NEIGHBOUR)).toBeNull();
    expect(spectacleNotice('channel.bits.use', bits({ broadcaster_user_id: NEIGHBOUR }), K)).toBeNull();
    expect(spectacleNotice('channel.bits.use', bits({ bits: 0 }), K)).toBeNull();
    expect(spectacleNotice('channel.bits.use', bits({ type: 'tip' }), K)).toBeNull();
    expect(spectacleNotice('channel.bits.use', bits({ user_id: 'not-a-number' }), K)).toBeNull();
    expect(spectacleNotice('channel.bits.use', bits({ type: 'power_up', power_up: null }), K)).toBeNull();
    expect(spectacleNotice('channel.bits.use', bits({ type: 'power_up', power_up: { type: 'gigantify_an_emote', emote: null } }), K)).toBeNull();
    expect(spectacleNotice('channel.bits.use', null, K)).toBeNull();
  });

  it('clamps an enormous cheer to the public bound', () => {
    expect(spectacleNotice('channel.bits.use', bits({ bits: 2 ** 40 }), K)).toMatchObject({ act: { kind: 'cheer', bits: 100_000_000 } });
  });

  it('turns hype begin, progress and end v2 into hype notices stripped to train state', () => {
    const begin = spectacleNotice('channel.hype_train.begin', running({ all_time_high_level: 4, all_time_high_total: 9000 }), K);
    expect(begin).toEqual({ kind: 'hype', update: {
      trainKey: `ht.${TRAIN_ID}`, sharedSessionKey: null, phase: 'begin', level: 2, total: 1200, progress: 200, goal: 1800,
      startedAt: Date.parse('2026-10-30T20:00:00.000Z'), endsAt: Date.parse('2026-10-30T20:05:00.000Z'), golden: false, treasure: false,
      allTimeHighLevel: 4, recordVerified: false, contributors: [{ personId: RIDER, name: 'Rider' }],
    } });
    expect(JSON.stringify(begin)).not.toContain('900');
    expect(JSON.stringify(begin)).not.toContain('9000');

    expect(spectacleNotice('channel.hype_train.progress', running({ level: 3, total: 2400, type: 'golden_kappa', is_shared_train: true }), K))
      .toMatchObject({ kind: 'hype', update: { phase: 'progress', level: 3, total: 2400, golden: true, allTimeHighLevel: null, sharedSessionKey: `hts.${TRAIN_ID}` } });

    const end = spectacleNotice('channel.hype_train.end', train({ level: 4, ended_at: '2026-10-30T20:07:00.000Z', cooldown_ends_at: '2026-10-30T21:07:00.000Z' }), K);
    expect(end).toMatchObject({ kind: 'hype', update: { phase: 'end', level: 4, progress: null, goal: null, endsAt: Date.parse('2026-10-30T20:07:00.000Z') } });
    for (const notice of [begin, end]) expect(RealmMomentNoticeSchema.safeParse(notice).success).toBe(true);
  });

  it('keeps anonymous contributors off the train and refuses another channel’s or a malformed train', () => {
    const anonymous = spectacleNotice('channel.hype_train.progress', running({ top_contributions: [
      { user_id: '274598607', user_login: 'ananonymousgifter', user_name: 'AnAnonymousGifter', type: 'subscription', total: 500 },
      { user_id: RIDER, user_login: 'rider', user_name: 'Rider', type: 'bits', total: 100 },
      { user_id: RIDER, user_login: 'rider', user_name: 'Rider', type: 'subscription', total: 500 },
    ] }), K);
    expect(anonymous).toMatchObject({ update: { contributors: [{ personId: RIDER, name: 'Rider' }] } });
    expect(spectacleNotice('channel.hype_train.progress', running({ broadcaster_user_id: NEIGHBOUR }), K)).toBeNull();
    expect(spectacleNotice('channel.hype_train.begin', running(), K)).toBeNull();
    expect(spectacleNotice('channel.hype_train.end', train(), K)).toBeNull();
    expect(spectacleNotice('channel.hype_train.progress', running({ expires_at: 'next tuesday' }), K)).toBeNull();
  });

  it('turns a raid into this kingdom into the raiding channel and Twitch’s viewer count', () => {
    const notice = spectacleNotice('channel.raid', raid(), K);
    expect(notice).toEqual({ kind: 'raid', from: { kingdomId: NEIGHBOUR, login: 'neighbour', name: 'Neighbour' }, viewers: 42 });
    expect(RealmMomentNoticeSchema.safeParse(notice).success).toBe(true);
    expect(spectacleNotice('channel.raid', raid({ viewers: 1 }), K)).toMatchObject({ viewers: 1 });
    expect(spectacleNotice('channel.raid', raid({ viewers: 50_000_000 }), K)).toMatchObject({ viewers: 10_000_000 });
  });

  it('ignores a valid outgoing raid without creating an incoming caravan', () => {
    expect(spectacleNotice('channel.raid', raid({ from_broadcaster_user_id: K, to_broadcaster_user_id: NEIGHBOUR }), K)).toBe(IGNORED);
  });

  it('ignores a raid that brought nobody and refuses one addressed elsewhere, from itself or malformed', () => {
    expect(spectacleNotice('channel.raid', raid({ viewers: 0 }), K)).toBe(IGNORED);
    expect(spectacleNotice('channel.raid', raid({ to_broadcaster_user_id: NEIGHBOUR, from_broadcaster_user_id: '616161' }), K)).toBeNull();
    expect(spectacleNotice('channel.raid', raid({ from_broadcaster_user_id: K }), K)).toBeNull();
    expect(spectacleNotice('channel.raid', raid({ from_broadcaster_user_login: 'Neighbour' }), K)).toBeNull();
    expect(spectacleNotice('channel.raid', raid({ viewers: -1 }), K)).toBeNull();
    expect(spectacleNotice('channel.raid', 'raid', K)).toBeNull();
  });

  it('ignores every event type that is not a spectacle', () => {
    expect(spectacleNotice('channel.chat.message', { broadcaster_user_id: K, message: { text: '!strike' } }, K)).toBe(IGNORED);
    expect(spectacleNotice('channel.chat.clear', {}, K)).toBe(IGNORED);
  });
});

describe('isStrike', () => {
  const chat = (text: unknown) => ({ message_id: 'm-1', message: { text } });

  it('reads !strike alone or followed by words, in any case and with leading space', () => {
    expect(isStrike(chat('!strike'))).toBe(true);
    expect(isStrike(chat('!STRIKE now'))).toBe(true);
    expect(isStrike(chat('  !strike'))).toBe(true);
    expect(isStrike(chat('!Strike\tthe wing'))).toBe(true);
  });

  it('refuses a longer command, a strike mid-sentence, missing text and anything that is not a message', () => {
    expect(isStrike(chat('!striker'))).toBe(false);
    expect(isStrike(chat('hello !strike'))).toBe(false);
    expect(isStrike(chat('strike'))).toBe(false);
    expect(isStrike(chat(undefined))).toBe(false);
    expect(isStrike(chat(42))).toBe(false);
    expect(isStrike(chat(`!strike ${'a'.repeat(500)}`))).toBe(false);
    expect(isStrike({ message: null })).toBe(false);
    expect(isStrike({})).toBe(false);
    expect(isStrike(null)).toBe(false);
    expect(isStrike('!strike')).toBe(false);
  });
});

describe('the town’s evidence: follows, rewards, polls and the night', () => {
  const FOLLOWER = PersonIdSchema.parse('15395959');
  const follow = (overrides: Record<string, unknown> = {}) => ({ user_id: FOLLOWER, user_login: 'testfromuser', user_name: 'testFromUser',
    broadcaster_user_id: K, broadcaster_user_login: 'kingdom', broadcaster_user_name: 'Kingdom', followed_at: '2026-11-01T13:49:06.624686193Z', ...overrides });

  it('keeps a follow’s person, public name and Twitch’s own follow time (nanoseconds and all)', () => {
    expect(spectacleNotice('channel.follow', follow(), K)).toEqual({ kind: 'follow', person: { personId: FOLLOWER, name: 'testFromUser' },
      followedAt: Date.UTC(2026, 10, 1, 13, 49, 6, 624) });
    expect(spectacleNotice('channel.follow', follow({ broadcaster_user_id: NEIGHBOUR }), K)).toBeNull();
    expect(spectacleNotice('channel.follow', follow({ user_id: K }), K)).toBeNull();
    expect(spectacleNotice('channel.follow', follow({ followed_at: 'yesterday' }), K)).toBeNull();
  });

  it('reads a redemption by its reward’s title and never by what the viewer typed', () => {
    const notice = spectacleNotice('channel.channel_points_custom_reward_redemption.add', {
      id: '95f79965-3cca-818c-b8bd-cea0bdb94e47', broadcaster_user_id: K, broadcaster_user_login: 'kingdom', broadcaster_user_name: 'Kingdom',
      user_id: '84617073', user_login: 'testfromuser', user_name: 'testFromUser', user_input: 'SIMULATED private words', status: 'unfulfilled',
      reward: { id: '6047fec9-0135-0b8e-f64b-82f3d0fcd6a2', title: 'Ring the Bell', cost: 150, prompt: 'SIMULATED prompt' }, redeemed_at: '2026-11-01T13:49:06.703918586Z',
    }, K);
    expect(notice).toEqual({ kind: 'redemption', redemptionId: '95f79965-3cca-818c-b8bd-cea0bdb94e47', rewardId: '6047fec9-0135-0b8e-f64b-82f3d0fcd6a2',
      rewardTitle: 'Ring the Bell', person: { personId: PersonIdSchema.parse('84617073'), name: 'testFromUser' }, status: 'unfulfilled' });
    expect(JSON.stringify(notice)).not.toContain('private');
    expect(JSON.stringify(notice)).not.toContain('prompt');
  });

  it('carries a poll’s tallies with what was paid for counted apart, and its result only at the end', () => {
    const event = { id: '4001115b-5a62-a821-dcc9-58e69559f349', broadcaster_user_id: K, broadcaster_user_login: 'kingdom', broadcaster_user_name: 'Kingdom',
      title: 'Our colours', choices: [{ id: 'c1', title: 'Ember', bits_votes: 0, channel_points_votes: 1, votes: 10 }, { id: 'c2', title: 'Tide', bits_votes: 9, channel_points_votes: 8, votes: 24 }],
      bits_voting: { is_enabled: true, amount_per_vote: 10 }, channel_points_voting: { is_enabled: true, amount_per_vote: 500 },
      status: 'completed', started_at: '2026-11-01T13:49:06.7878314Z', ended_at: '2026-11-01T14:04:06.7878314Z' };
    const end = spectacleNotice('channel.poll.end', event, K);
    expect(end).toMatchObject({ kind: 'poll', phase: 'end', status: 'completed', title: 'Our colours',
      choices: [{ id: 'c1', votes: 10, paidVotes: 1 }, { id: 'c2', votes: 24, paidVotes: 17 }] });
    expect(spectacleNotice('channel.poll.end', { ...event, status: 'unexpected-provider-status' }, K)).toMatchObject({ status: 'invalid' });
    const running: Record<string, unknown> = { ...event };
    delete running.ended_at; delete running.status;
    expect(spectacleNotice('channel.poll.progress', { ...running, ends_at: '2026-11-01T14:04:06Z' }, K)).toMatchObject({ phase: 'progress', status: 'active' });
    expect(spectacleNotice('channel.poll.begin', { ...running, choices: [{ id: 'c1', title: 'Ember' }, { id: 'c2', title: 'Tide' }], ends_at: '2026-11-01T14:04:06Z' }, K))
      .toMatchObject({ phase: 'begin', choices: [{ votes: 0, paidVotes: 0 }, { votes: 0, paidVotes: 0 }] });
  });

  it('turns a broadcast into the night’s evidence', () => {
    expect(streamNotice(true, '40078987165', Date.UTC(2026, 10, 1, 19))).toEqual({ kind: 'stream', phase: 'online', streamId: '40078987165', startedAt: Date.UTC(2026, 10, 1, 19) });
    expect(streamNotice(false, null, null)).toEqual({ kind: 'stream', phase: 'offline', streamId: null, startedAt: null });
  });
});
