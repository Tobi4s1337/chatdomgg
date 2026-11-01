import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RealmDelivery } from '../realm-delivery/delivery';
import { KingdomIdSchema } from '@chatdom/shared';
import { channelBitsUse } from '../twitch-moments/bits';
import { hypeTrainBegin, hypeTrainProgress } from '../twitch-moments/hype';
import { IGNORED } from '../twitch-moments/normalizer';
import { planSubscriptions } from '../ingest/subscriptions';
import { adaptCliEvent, MOCK_CONDUIT_ID, MOCK_READER_ID, startMockDoor, toFrame, verifySignature } from './door';

const KINGDOM = KingdomIdSchema.parse('129634568');
const plans = planSubscriptions({ broadcasterId: KINGDOM, readerId: MOCK_READER_ID, clientId: 'simulatedmockdoor' });
const sign = (secret: string, id: string, stamp: string, body: string) => `sha256=${createHmac('sha256', secret).update(id + stamp + body).digest('hex')}`;

// Payloads exactly as `twitch event trigger <type> -D -t 129634568` prints them (Twitch CLI 1.1.24).
const CLI_CHEER = { user_id: '41245072', user_login: 'testFromUser', user_name: 'testFromUser', broadcaster_user_id: '129634568',
  broadcaster_user_login: 'testBroadcaster', broadcaster_user_name: 'testBroadcaster', is_anonymous: false, message: 'This is a test event.', bits: 500 };
const CLI_TRAIN = { id: 'c48462e1-ef1d-a120-0f9a-0e45efd4f5ff', broadcaster_user_id: '129634568', broadcaster_user_login: 'testBroadcaster',
  broadcaster_user_name: 'testBroadcaster', level: 2, total: 512, progress: 512, goal: 85533,
  top_contributions: [{ total: 115, type: 'subscription', user_id: '58397591', user_name: 'cli_user1', user_login: 'cli_user1' }],
  last_contribution: { total: 115, type: 'subscription', user_id: '58397591', user_name: 'cli_user1', user_login: 'cli_user1' },
  started_at: '2026-11-01T10:29:18.610168505Z', expires_at: '2026-11-01T10:34:18.610168505Z' };

describe('SIMULATED EventSub door', () => {
  it('accepts only Twitch-style signatures over ID, timestamp and the exact body', () => {
    const secret = 'simulated-door-secret', id = 'm-1', stamp = '2026-11-01T10:00:00.000Z', body = '{"a":1}';
    expect(verifySignature(secret, id, stamp, body, sign(secret, id, stamp, body))).toBe(true);
    expect(verifySignature(secret, id, stamp, `${body} `, sign(secret, id, stamp, body))).toBe(false);
    expect(verifySignature(secret, 'm-2', stamp, body, sign(secret, id, stamp, body))).toBe(false);
    expect(verifySignature('another-secret', id, stamp, body, sign(secret, id, stamp, body))).toBe(false);
    expect(verifySignature(secret, id, stamp, body, 'sha256=00')).toBe(false);
  });

  it('maps the CLI cheer onto channel.bits.use and keeps an anonymous cheer anonymous', () => {
    const named = adaptCliEvent('channel.cheer', '1', CLI_CHEER);
    expect(named).toMatchObject({ type: 'channel.bits.use', version: '1' });
    expect(channelBitsUse.parse(named.event, KINGDOM)).toMatchObject({ payer: { personId: '41245072' }, act: { kind: 'cheer', bits: 500 } });
    const anonymous = adaptCliEvent('channel.cheer', '1', { ...CLI_CHEER, is_anonymous: true });
    expect(channelBitsUse.parse(anonymous.event, KINGDOM)).toMatchObject({ payer: null, act: { kind: 'cheer', bits: 500 } });
  });

  it('maps CLI v1 trains onto v2 without claiming a record, a shared train or a golden one', () => {
    const begin = adaptCliEvent('channel.hype_train.begin', '1', CLI_TRAIN);
    expect(begin).toMatchObject({ type: 'channel.hype_train.begin', version: '2', event: { type: 'regular', is_shared_train: false, all_time_high_level: 0 } });
    expect(begin.event).not.toHaveProperty('last_contribution');
    const parsed = hypeTrainBegin.parse(begin.event, KINGDOM);
    expect(parsed).not.toBe(IGNORED);
    expect(parsed).toMatchObject({ phase: 'begin', level: 2, golden: false });
    const progress = adaptCliEvent('channel.hype_train.progress', '1', CLI_TRAIN);
    expect(hypeTrainProgress.parse(progress.event, KINGDOM)).toMatchObject({ phase: 'progress', level: 2 });
  });

  it('turns the CLI\'s sub and resub into the shared chat notices production reads, one notice per person and month', () => {
    const resub = adaptCliEvent('channel.subscription.message', '1', { user_id: '60365105', user_login: 'testfromuser', user_name: 'testFromUser',
      broadcaster_user_id: '129634568', broadcaster_user_login: 'testBroadcaster', broadcaster_user_name: 'testBroadcaster', tier: '1000',
      message: { text: 'SIMULATED private words', emotes: [] }, cumulative_months: 63, streak_months: 55, duration_months: 1 });
    expect(resub).toMatchObject({ type: 'channel.chat.notification', version: '1', event: { chatter_user_id: '60365105', chatter_user_name: 'testFromUser',
      notice_type: 'resub', message_id: 'cli-channel.subscription.message-60365105-63', resub: { cumulative_months: 63, sub_tier: '1000', is_gift: false } } });
    expect(JSON.stringify(resub)).not.toContain('private');
    const sub = adaptCliEvent('channel.subscribe', '1', { user_id: '60365106', user_login: 'a', user_name: 'A', broadcaster_user_id: '129634568',
      broadcaster_user_login: 'b', broadcaster_user_name: 'B', tier: '2000', is_gift: false });
    expect(sub.event).toMatchObject({ notice_type: 'sub', sub: { sub_tier: '2000', is_prime: false } });
    expect(toFrame({ subscription: { type: 'channel.subscribe', version: '1' }, event: { user_id: '60365106', user_login: 'a', user_name: 'A',
      broadcaster_user_id: '129634568', broadcaster_user_login: 'b', broadcaster_user_name: 'B', tier: '1000', is_gift: false } }, 'd', 5, plans))
      .toMatchObject({ subscription: { type: 'channel.chat.notification', version: '1' } });
  });

  it('frames the town\'s own CLI events (follow v2, rewards, polls) onto Herald\'s plans as they are', () => {
    for (const [type, version] of [['channel.follow', '2'], ['channel.channel_points_custom_reward_redemption.add', '1'], ['channel.poll.begin', '1'],
      ['channel.poll.progress', '1'], ['channel.poll.end', '1']] as const) {
      expect(toFrame({ subscription: { type, version }, event: { broadcaster_user_id: '129634568' } }, 'd', 5, plans)).toMatchObject({ subscription: { type, version } });
    }
    // The retired follow v1 is not a plan.
    expect(toFrame({ subscription: { type: 'channel.follow', version: '1' }, event: { broadcaster_user_id: '129634568' } }, 'd', 5, plans)).toBeNull();
  });

  it('frames only Herald\'s planned subscriptions, on the door\'s own conduit', () => {
    const raid = { to_broadcaster_user_id: '129634568', to_broadcaster_user_login: 'tobi4s_', to_broadcaster_user_name: 'tobi4s_',
      from_broadcaster_user_id: '41245072', from_broadcaster_user_login: 'testfromuser', from_broadcaster_user_name: 'testFromUser', viewers: 40 };
    const frame = toFrame({ subscription: { type: 'channel.raid', version: '1' }, event: raid }, 'delivery-1', 5, plans);
    expect(frame).toMatchObject({ kind: 'notification', meta: { messageId: 'delivery-1', at: 5 },
      subscription: { type: 'channel.raid', version: '1', status: 'enabled', conduitId: MOCK_CONDUIT_ID, condition: { to_broadcaster_user_id: KINGDOM } } });
    expect(toFrame({ subscription: { type: 'channel.cheer', version: '1' }, event: CLI_CHEER }, 'd', 5, plans)?.subscription.type).toBe('channel.bits.use');
    expect(toFrame({ subscription: { type: 'channel.prediction.begin', version: '1' }, event: {} }, 'd', 5, plans)).toBeNull();
    expect(toFrame({ subscription: { type: 'channel.raid', version: '2' }, event: raid }, 'd', 5, plans)).toBeNull();
    const outgoing = { ...raid, to_broadcaster_user_id: '41245072', from_broadcaster_user_id: KINGDOM };
    expect(toFrame({ subscription: { type: 'channel.raid', version: '1' }, event: outgoing }, 'out', 5, plans)?.subscription.condition)
      .toEqual({ from_broadcaster_user_id: KINGDOM });
    expect(toFrame({ subscription: { type: 'channel.raid', version: '1' }, event: { ...raid, to_broadcaster_user_id: '55' } }, 'wrong', 5, plans)).toBeNull();
    expect(toFrame({ subscription: { type: 'channel.raid', version: '1' }, event: outgoing }, 'wrong-side', 5, plans.filter(plan => plan.type !== 'channel.raid' || 'to_broadcaster_user_id' in plan.condition))).toBeNull();
    expect(toFrame('nonsense', 'd', 5, plans)).toBeNull();
  });
});

describe('SIMULATED door, end to end into Herald', () => {
  it('a signed stream.online and a chat message apply as SIMULATED presence and queue for the realm', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'herald-door-'));
    const posted: string[] = [];
    const realm = await RealmDelivery.open({ url: 'http://127.0.0.1:9', secret: 'x'.repeat(40), directory: join(dir, 'outbox'), origin: 'simulated',
      fetch: (async (_url: unknown, init?: { body?: unknown }) => { posted.push(String(init?.body)); return new Response(JSON.stringify({ version: 1, status: 'accepted' }), { status: 202 }); }) as typeof fetch });
    const secret = 'simulated-door-secret';
    const door = await startMockDoor({ kingdomId: KINGDOM, secret, realm, port: 0 });
    const send = async (type: string, version: string, event: unknown) => {
      const id = `m-${Math.random()}`, stamp = new Date().toISOString(), body = JSON.stringify({ subscription: { type, version }, event });
      const response = await fetch(`http://127.0.0.1:${door.port}/eventsub`, { method: 'POST', body, headers: { 'Twitch-Eventsub-Message-Id': id,
        'Twitch-Eventsub-Message-Timestamp': stamp, 'Twitch-Eventsub-Message-Signature': sign(secret, id, stamp, body), 'Twitch-Eventsub-Message-Type': 'notification' } });
      return response.status;
    };
    try {
      expect(await send('stream.online', '1', { id: '91221913', broadcaster_user_id: KINGDOM, broadcaster_user_login: 'tobi4s_', broadcaster_user_name: 'tobi4s_', type: 'live', started_at: new Date().toISOString() })).toBe(204);
      expect(await send('channel.chat.message', '1', { broadcaster_user_id: KINGDOM, chatter_user_id: '990000101', chatter_user_name: 'Wrenna', chatter_user_login: 'wrenna', message_id: 'chat-1', message: { text: 'evening all' }, source_broadcaster_user_id: null })).toBe(204);
      for (let i = 0; i < 100 && (door.source.health().counters.applied < 2 || !door.source.health().frame?.present); i++) await new Promise(resolve => setTimeout(resolve, 20));
      expect(door.source.health()).toMatchObject({ origin: 'simulated', counters: { applied: 2, rejected: 0 }, frame: { streamLive: true, present: 1 } });
      expect(posted.some(body => body.includes('"origin":"simulated"') && body.includes('990000101'))).toBe(true);
    } finally { await door.stop(); await realm.close(); await rm(dir, { recursive: true, force: true }); }
  });
});
