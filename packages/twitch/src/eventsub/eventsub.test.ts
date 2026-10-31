import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTokenSession } from '../app-token';
import { isTwitchFailure, TwitchRequestError } from '../errors';
import { HelixReader } from '../helix';
import { Secret } from '../secret';
import { FAKE_EVENTSUB_URL, FakeEventSub, type FakeEventSubOptions, type FakeSocket, type FakeSubscription } from '../testing/fake-eventsub';
import { FakeTwitch } from '../testing/fake-twitch';
import type { FetchLike } from '../transport';
import { EventSubAdmin, matchesRequest, ShardAssignmentError, type EventSubSubscription } from './admin';
import {
  ChatClearEventSchema,
  ChatClearUserMessagesEventSchema,
  ChatMessageDeleteEventSchema,
  ChatMessageEventSchema,
  MAX_FRAME_CHARS,
  parseFrame,
  parseTwitchTime,
  StreamOnlineEventSchema,
} from './frames';
import {
  ConduitShardConnection,
  EVENTSUB_WS_URL,
  type AttachReason,
  type DeliveryFrame,
  type ShardConnectionOptions,
  type ShardListener,
} from './shard';

/* Everything below is SIMULATED: client, users, sessions, conduits and chat text are synthetic. */
const CLIENT_ID = 'simulatedclient0000000000000001';
const SECRET = 'simulated-client-secret-value-0001';
const BROADCASTER = { id: '900000010', login: 'simulated_monarch', displayName: 'SimulatedMonarch' };
const BOT = { id: '900000011', login: 'simulated_herald', displayName: 'SimulatedHerald' };
const VIEWER = { id: '900000012', login: 'simulated_viewer', displayName: 'SimulatedViewer' };
const CHAT_TEXT = 'SIMULATED chat words that must never leave parsing';
const START = new Date('2026-10-30T12:00:00.000Z');

/** Free-text bodies the fakes send with failures; none of them may reach an error we raise. */
const PROVIDER_TEXTS = [
  'SIMULATED provider detail',
  'conduit limit reached',
  'conduit not found',
  'subscription already exists',
  'subscription missing proper authorization',
  'The websocket session is not connected',
  "outside the conduit's range",
  'app access token required',
];

const CHAT_GRANTS: Record<string, readonly string[]> = {
  [BOT.id]: ['user:read:chat', 'user:bot'],
  [BROADCASTER.id]: ['channel:bot'],
};

interface SetupOptions {
  readonly grants?: Readonly<Record<string, readonly string[]>>;
  readonly eventsub?: FakeEventSubOptions;
  readonly fetch?: (fake: FakeTwitch) => FetchLike;
}

function setup(options: SetupOptions = {}) {
  const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: SECRET, users: [BROADCASTER, BOT, VIEWER], grants: options.grants ?? {} });
  const eventsub = new FakeEventSub(fake, options.eventsub);
  const fetch = options.fetch ? options.fetch(fake) : fake.fetch;
  const tokens = new AppTokenSession({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), fetch });
  const helix = new HelixReader({ tokens, fetch });
  const admin = new EventSubAdmin(helix.session);
  return { fake, eventsub, tokens, helix, admin };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('expected the promise to reject');
}

function expectNoProviderText(error: Error): void {
  const rendered = `${error.message} ${String(error)} ${JSON.stringify(error)}`;
  for (const text of PROVIDER_TEXTS) expect(rendered).not.toContain(text);
}

function chatEvent(messageId = 'simulated-chat-message-1'): Record<string, unknown> {
  return {
    broadcaster_user_id: BROADCASTER.id,
    broadcaster_user_login: BROADCASTER.login,
    broadcaster_user_name: BROADCASTER.displayName,
    chatter_user_id: VIEWER.id,
    chatter_user_login: VIEWER.login,
    chatter_user_name: VIEWER.displayName,
    message_id: messageId,
    message: { text: CHAT_TEXT, fragments: [{ type: 'text', text: CHAT_TEXT, cheermote: null, emote: null, mention: null }] },
    message_type: 'text',
    badges: [{ set_id: 'subscriber', id: '12', info: '12' }],
    color: '#9146FF',
    cheer: null,
    reply: null,
    channel_points_custom_reward_id: null,
    source_broadcaster_user_id: null,
  };
}

/* ------------------------------------------------------------------------------------------------------ */
/* Admin                                                                                                   */
/* ------------------------------------------------------------------------------------------------------ */

describe('EventSubAdmin', () => {
  it('creates a conduit and resizes it, never listing the client\'s conduits', async () => {
    const { fake, eventsub, admin } = setup();
    const conduit = await admin.createConduit(1);
    expect(conduit.id).toMatch(/^simulated-conduit-/);
    expect(conduit.shardCount).toBe(1);
    expect(eventsub.conduits.get(conduit.id)).toHaveLength(1);

    expect(await admin.setShardCount(conduit.id, 2)).toBe(2);
    expect(eventsub.conduits.get(conduit.id)).toHaveLength(2);
    // Like Twitch, shards that never had a transport are not listed.
    expect(await admin.getShards(conduit.id)).toEqual([]);
    expect(fake.count('GET', 'api.twitch.tv/helix/eventsub/conduits')).toBe(0);
  });

  it('reports the conduit limit as limit_reached and never retries the 429', async () => {
    const { fake, admin } = setup({ eventsub: { conduitLimit: 1 } });
    await admin.createConduit(1);
    const error = await rejection(admin.createConduit(1));
    expect(isTwitchFailure(error, 'limit_reached')).toBe(true);
    expect((error as TwitchRequestError).status).toBe(429);
    expectNoProviderText(error);
    expect(fake.count('POST', 'api.twitch.tv/helix/eventsub/conduits')).toBe(2);
    expect(fake.calls.filter(call => call.status === 429)).toHaveLength(1);
  });

  it('never retries a 429 on a subscription write either', async () => {
    const { fake, eventsub, admin } = setup();
    const conduitId = eventsub.addConduit(1);
    fake.fail('POST', 'api.twitch.tv/helix/eventsub/subscriptions', 429, 5, { 'ratelimit-remaining': '700' });
    const error = await rejection(admin.createSubscription(conduitId, { type: 'stream.online', version: '1', condition: { broadcaster_user_id: BROADCASTER.id } }));
    expect(isTwitchFailure(error, 'limit_reached')).toBe(true);
    expectNoProviderText(error);
    expect(fake.count('POST', 'api.twitch.tv/helix/eventsub/subscriptions')).toBe(1);
  });

  // A limit 429 still reports points left; it must not stall the shared budget (and with it the shard PATCH).
  it('keeps reading normally after a write hit a Twitch limit', async () => {
    const { eventsub, admin } = setup({ eventsub: { conduitLimit: 1 } });
    const conduit = await admin.createConduit(1);
    await rejection(admin.createConduit(1));
    expect(await admin.getShards(conduit.id)).toEqual([]);
    expect(eventsub.conduits.size).toBe(1);
  });

  it('reports an unknown conduit as not_found', async () => {
    const { fake, admin } = setup();
    const error = await rejection(admin.getShards('simulated-conduit-unknown'));
    expect(isTwitchFailure(error, 'not_found')).toBe(true);
    expectNoProviderText(error);
    const patch = await rejection(admin.assignWebSocket('simulated-conduit-unknown', '0', 'simulated-session-x'));
    expect(isTwitchFailure(patch, 'not_found')).toBe(true);
    expect(fake.count('GET', 'api.twitch.tv/helix/eventsub/conduits')).toBe(0);
  });

  it('rejects malformed conduit and subscription IDs before any request', async () => {
    const { fake, admin } = setup();
    await expect(admin.getShards('../conduits')).rejects.toThrow();
    await expect(admin.deleteSubscription('id with spaces')).rejects.toThrow();
    expect(fake.calls.filter(call => call.path.startsWith('api.twitch.tv/'))).toHaveLength(0);
  });

  it('raises ShardAssignmentError with only the short code when the session is not connected', async () => {
    const { eventsub, admin } = setup();
    const conduitId = eventsub.addConduit(1);
    const error = await rejection(admin.assignWebSocket(conduitId, '0', 'simulated-session-not-open'));
    expect(error).toBeInstanceOf(ShardAssignmentError);
    expect((error as ShardAssignmentError).code).toBe('websocket_session_not_connected');
    expectNoProviderText(error);
    expect(eventsub.shard(conduitId)?.status).toBe('websocket_disconnected');

    const outside = await rejection(admin.assignWebSocket(conduitId, '7', 'simulated-session-not-open'));
    expect((outside as ShardAssignmentError).code).toBe('invalid_parameter');
    expectNoProviderText(outside);
  });

  it('assigns a connected session to the shard', async () => {
    const { eventsub, admin } = setup({ eventsub: { autoWelcome: false } });
    const conduitId = eventsub.addConduit(1);
    const socket = eventsub.socketFactory(FAKE_EVENTSUB_URL) as FakeSocket;
    eventsub.welcome(socket);
    const sessionId = socket.sessionId ?? '';
    const shard = await admin.assignWebSocket(conduitId, '0', sessionId);
    expect(shard).toEqual({ id: '0', status: 'enabled', sessionId });
    expect(await admin.getShards(conduitId)).toEqual([{ id: '0', status: 'enabled', sessionId }]);
    socket.close();
  });

  it('lists only this conduit\'s subscriptions, filtering by conduit_id alone', async () => {
    const urls: URL[] = [];
    const { fake, eventsub, admin } = setup({
      grants: CHAT_GRANTS,
      fetch: twitch => (input, init) => {
        urls.push(new URL(input));
        return twitch.fetch(input, init);
      },
    });
    const conduitId = eventsub.addConduit(1);
    const otherConduit = eventsub.addConduit(1);
    eventsub.addForeignSubscription('stream.online', { broadcaster_user_id: BROADCASTER.id });
    const own = await admin.createSubscription(conduitId, { type: 'stream.offline', version: '1', condition: { broadcaster_user_id: BROADCASTER.id } });
    await admin.createSubscription(otherConduit, { type: 'stream.online', version: '1', condition: { broadcaster_user_id: VIEWER.id } });

    const listed = await admin.listConduitSubscriptions(conduitId);
    expect(listed).toEqual([{ id: own.id, status: 'enabled', type: 'stream.offline', version: '1', condition: { broadcaster_user_id: BROADCASTER.id }, conduitId }]);

    const gets = urls.filter(url => url.pathname === '/helix/eventsub/subscriptions' && url.searchParams.size > 0);
    expect(gets).toHaveLength(1);
    expect([...gets[0]!.searchParams.keys()]).toEqual(['conduit_id']);
    expect(gets[0]!.searchParams.get('conduit_id')).toBe(conduitId);
    expect(fake.count('GET', 'api.twitch.tv/helix/eventsub/subscriptions')).toBe(1);
    expect(fake.count('GET', 'api.twitch.tv/helix/eventsub/conduits')).toBe(0);
  });

  it('drops foreign entries even when the answer ignores the conduit filter', async () => {
    const { eventsub, admin } = setup({
      fetch: twitch => (input, init) => {
        const url = new URL(input);
        if (url.pathname === '/helix/eventsub/subscriptions' && (init.method ?? 'GET') === 'GET') url.searchParams.delete('conduit_id');
        return twitch.fetch(url.toString(), init);
      },
    });
    const conduitId = eventsub.addConduit(1);
    const otherConduit = eventsub.addConduit(1);
    eventsub.addForeignSubscription('stream.online', { broadcaster_user_id: BROADCASTER.id });
    await admin.createSubscription(otherConduit, { type: 'stream.online', version: '1', condition: { broadcaster_user_id: VIEWER.id } });
    const own = await admin.createSubscription(conduitId, { type: 'stream.offline', version: '1', condition: { broadcaster_user_id: BROADCASTER.id } });
    const listed = await admin.listConduitSubscriptions(conduitId);
    expect(listed.map(entry => entry.id)).toEqual([own.id]);
  });

  it('creates, refuses duplicates as conflict, refuses missing grants as forbidden, and deletes', async () => {
    const { fake, eventsub, admin } = setup({ grants: { [BOT.id]: ['user:read:chat', 'user:bot'] } });
    const conduitId = eventsub.addConduit(1);
    const chat = { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: BROADCASTER.id, user_id: BOT.id } };

    // The broadcaster has not granted channel:bot yet.
    const forbidden = await rejection(admin.createSubscription(conduitId, chat));
    expect(isTwitchFailure(forbidden, 'forbidden')).toBe(true);
    expectNoProviderText(forbidden);
    expect(eventsub.subscriptions).toHaveLength(0);

    fake.grants.set(BROADCASTER.id, new Set(['channel:bot']));
    const created = await admin.createSubscription(conduitId, chat);
    expect(created).toMatchObject({ status: 'enabled', type: 'channel.chat.message', version: '1', conduitId });
    expect(matchesRequest(created, chat)).toBe(true);

    const conflict = await rejection(admin.createSubscription(conduitId, chat));
    expect(isTwitchFailure(conflict, 'conflict')).toBe(true);
    expect((conflict as TwitchRequestError).status).toBe(409);
    expectNoProviderText(conflict);
    expect(eventsub.subscriptions).toHaveLength(1);

    await admin.deleteSubscription(created.id);
    expect(eventsub.subscriptions).toHaveLength(0);
    expect(await admin.listConduitSubscriptions(conduitId)).toEqual([]);
    expect(fake.count('DELETE', 'api.twitch.tv/helix/eventsub/subscriptions')).toBe(1);

    const missing = await rejection(admin.deleteSubscription(created.id));
    expect(isTwitchFailure(missing, 'not_found')).toBe(true);
    expectNoProviderText(missing);
    expect(fake.count('GET', 'api.twitch.tv/helix/eventsub/conduits')).toBe(0);
  });

  it('keeps every admin error free of provider text when Twitch fails', async () => {
    const { fake, eventsub, admin } = setup();
    const conduitId = eventsub.addConduit(1);
    fake.fail('GET', 'api.twitch.tv/helix/eventsub/conduits/shards', 500);
    fake.fail('PATCH', 'api.twitch.tv/helix/eventsub/conduits/shards', 503);
    fake.fail('GET', 'api.twitch.tv/helix/eventsub/subscriptions', 400);
    const errors = [
      await rejection(admin.getShards(conduitId)),
      await rejection(admin.assignWebSocket(conduitId, '0', 'simulated-session-1')),
      await rejection(admin.listConduitSubscriptions(conduitId)),
    ];
    expect(errors.map(error => (error as TwitchRequestError).kind)).toEqual(['provider', 'provider', 'bad_request']);
    for (const error of errors) expectNoProviderText(error);
  });

  it('matches a listed subscription only on exact type, version and condition', () => {
    const listed: EventSubSubscription = {
      id: 'simulated-subscription-1', status: 'enabled', type: 'channel.chat.message', version: '1', conduitId: 'simulated-conduit-1',
      condition: { broadcaster_user_id: BROADCASTER.id, user_id: BOT.id, moderator_user_id: '' },
    };
    const request = { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: BROADCASTER.id, user_id: BOT.id } };
    expect(matchesRequest(listed, request)).toBe(true);
    expect(matchesRequest(listed, { ...request, version: '2' })).toBe(false);
    expect(matchesRequest(listed, { ...request, type: 'channel.chat.clear' })).toBe(false);
    expect(matchesRequest(listed, { ...request, condition: { broadcaster_user_id: BROADCASTER.id, user_id: VIEWER.id } })).toBe(false);
    expect(matchesRequest(listed, { ...request, condition: { broadcaster_user_id: BROADCASTER.id } })).toBe(false);
    expect(matchesRequest(listed, { ...request, condition: { ...request.condition, extra: 'x' } })).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------------ */
/* Frames                                                                                                  */
/* ------------------------------------------------------------------------------------------------------ */

const NANO_TIME = '2026-10-30T12:00:00.123456789Z';
const SUBSCRIPTION_WIRE = {
  id: 'simulated-subscription-1',
  status: 'enabled',
  type: 'channel.chat.message',
  version: '1',
  condition: { broadcaster_user_id: BROADCASTER.id, user_id: BOT.id },
  transport: { method: 'conduit', conduit_id: 'simulated-conduit-1' },
  created_at: NANO_TIME,
  cost: 0,
};

function frameText(messageType: string, payload: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ metadata: { message_id: 'simulated-delivery-1', message_type: messageType, message_timestamp: NANO_TIME, ...extra }, payload });
}

describe('parseFrame', () => {
  const at = Date.UTC(2026, 9, 30, 12, 0, 0, 123);

  it('parses a welcome, defaulting the keepalive when absent', () => {
    const frame = parseFrame(frameText('session_welcome', { session: { id: 'simulated-session-1', status: 'connected', keepalive_timeout_seconds: 25, reconnect_url: null, connected_at: NANO_TIME } }));
    expect(frame).toEqual({ kind: 'welcome', meta: { messageId: 'simulated-delivery-1', at }, sessionId: 'simulated-session-1', keepaliveSeconds: 25 });
    const defaulted = parseFrame(frameText('session_welcome', { session: { id: 'simulated-session-1', status: 'connected', keepalive_timeout_seconds: null } }));
    expect(defaulted).toMatchObject({ kind: 'welcome', keepaliveSeconds: 10 });
    expect(parseFrame(frameText('session_welcome', { session: { id: '', status: 'connected' } }))).toBeNull();
    expect(parseFrame(frameText('session_welcome', { session: { id: 'simulated-session-1', status: 'connected', keepalive_timeout_seconds: 0 } }))).toBeNull();
  });

  it('parses a keepalive', () => {
    expect(parseFrame(frameText('session_keepalive', {}))).toEqual({ kind: 'keepalive', meta: { messageId: 'simulated-delivery-1', at } });
  });

  it('parses a reconnect only when it carries a URL', () => {
    expect(parseFrame(frameText('session_reconnect', { session: { id: 'simulated-session-1', status: 'reconnecting', reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?id=simulated' } })))
      .toMatchObject({ kind: 'reconnect', reconnectUrl: 'wss://eventsub.wss.twitch.tv/ws?id=simulated' });
    expect(parseFrame(frameText('session_reconnect', { session: { id: 'simulated-session-1', status: 'reconnecting', reconnect_url: null } }))).toBeNull();
  });

  it('parses a notification and leaves its event for a narrow schema', () => {
    const event = chatEvent();
    const frame = parseFrame(frameText('notification', { subscription: SUBSCRIPTION_WIRE, event }, { subscription_type: 'channel.chat.message', subscription_version: '1' }));
    expect(frame?.kind).toBe('notification');
    if (frame?.kind !== 'notification') return;
    expect(frame.meta).toEqual({ messageId: 'simulated-delivery-1', at });
    expect(frame.subscription).toEqual({ id: 'simulated-subscription-1', status: 'enabled', type: 'channel.chat.message', version: '1', condition: SUBSCRIPTION_WIRE.condition, conduitId: 'simulated-conduit-1' });
    expect(frame.event).toEqual(event);
  });

  it('parses a revocation', () => {
    const frame = parseFrame(frameText('revocation', { subscription: { ...SUBSCRIPTION_WIRE, status: 'authorization_revoked' } }, { subscription_type: 'channel.chat.message' }));
    expect(frame).toMatchObject({ kind: 'revocation', subscription: { status: 'authorization_revoked', conduitId: 'simulated-conduit-1' } });
  });

  it('reports a non-conduit transport as no conduit', () => {
    const frame = parseFrame(frameText('revocation', { subscription: { ...SUBSCRIPTION_WIRE, transport: { method: 'webhook', callback: 'https://simulated.invalid/' } } }));
    expect(frame).toMatchObject({ kind: 'revocation', subscription: { conduitId: null } });
  });

  it('returns null for anything malformed', () => {
    const notification = { subscription: SUBSCRIPTION_WIRE, event: chatEvent() };
    expect(parseFrame('{not json')).toBeNull();
    expect(parseFrame('')).toBeNull();
    expect(parseFrame('null')).toBeNull();
    expect(parseFrame('[]')).toBeNull();
    expect(parseFrame(JSON.stringify({ payload: {} }))).toBeNull();
    expect(parseFrame(frameText('session_keepalive', {}).padEnd(MAX_FRAME_CHARS + 1, ' '))).toBeNull();
    expect(parseFrame(frameText('mystery_type', {}))).toBeNull();
    expect(parseFrame(frameText('notification', notification, { subscription_type: 'stream.online' }))).toBeNull();
    expect(parseFrame(frameText('notification', { subscription: SUBSCRIPTION_WIRE }))).toBeNull();
    expect(parseFrame(frameText('notification', { subscription: { ...SUBSCRIPTION_WIRE, id: 'bad id/with slash' }, event: {} }))).toBeNull();
    expect(parseFrame(frameText('session_keepalive', {}, { message_timestamp: '2026-10-30 12:00:00Z' }))).toBeNull();
    expect(parseFrame(frameText('session_keepalive', {}, { message_timestamp: 'yesterday' }))).toBeNull();
    expect(parseFrame(frameText('session_keepalive', {}, { message_id: '' }))).toBeNull();
    expect(parseFrame(frameText('session_keepalive', {}, { message_id: 'x'.repeat(129) }))).toBeNull();
  });

  it('accepts a frame exactly at the size limit', () => {
    const text = frameText('session_keepalive', {});
    expect(parseFrame(text.padEnd(MAX_FRAME_CHARS, ' '))).toMatchObject({ kind: 'keepalive' });
  });
});

describe('parseTwitchTime', () => {
  it('reads RFC3339 with up to nanoseconds and offsets', () => {
    expect(parseTwitchTime('2026-10-30T12:00:00.123456789Z')).toBe(Date.UTC(2026, 9, 30, 12, 0, 0, 123));
    expect(parseTwitchTime('2026-10-30T12:00:00Z')).toBe(Date.UTC(2026, 9, 30, 12, 0, 0));
    expect(parseTwitchTime('2026-10-30T12:00:00.5Z')).toBe(Date.UTC(2026, 9, 30, 12, 0, 0, 500));
    expect(parseTwitchTime('2026-10-30T14:00:00.000+02:00')).toBe(Date.UTC(2026, 9, 30, 12, 0, 0));
  });

  it('refuses anything else', () => {
    for (const raw of ['2026-10-30T12:00:00', '2026-10-30 12:00:00Z', '2026-10-30T12:00:00.1234567890Z', '1969-12-31T23:59:59Z', 'yesterday', '', `2026-10-30T12:00:00Z${' '.repeat(60)}`, '2026-13-45T99:99:99Z']) {
      expect(parseTwitchTime(raw), raw).toBeNull();
    }
  });
});

describe('narrow event schemas', () => {
  it('keep chat identity and drop text, badges and colour', () => {
    const parsed = ChatMessageEventSchema.parse(chatEvent());
    expect(parsed).toEqual({
      broadcaster_user_id: BROADCASTER.id,
      chatter_user_id: VIEWER.id,
      chatter_user_name: VIEWER.displayName,
      message_id: 'simulated-chat-message-1',
      source_broadcaster_user_id: null,
    });
    for (const key of ['message', 'badges', 'color', 'reply', 'cheer']) expect(parsed).not.toHaveProperty(key);
    expect(JSON.stringify(parsed)).not.toContain(CHAT_TEXT);
    expect(JSON.stringify(parsed)).not.toContain('SIMULATED chat');
  });

  it('refuse events whose IDs are not Twitch IDs', () => {
    expect(ChatMessageEventSchema.safeParse({ ...chatEvent(), chatter_user_id: 'not-a-number' }).success).toBe(false);
    expect(ChatMessageEventSchema.safeParse({ ...chatEvent(), broadcaster_user_id: '012' }).success).toBe(false);
  });

  it('reduce the other chat and stream events to their keys', () => {
    expect(ChatMessageDeleteEventSchema.parse({ broadcaster_user_id: BROADCASTER.id, target_user_id: VIEWER.id, target_user_name: VIEWER.displayName, message_id: 'simulated-chat-message-1' }))
      .toEqual({ broadcaster_user_id: BROADCASTER.id, target_user_id: VIEWER.id, message_id: 'simulated-chat-message-1' });
    expect(ChatClearEventSchema.parse({ broadcaster_user_id: BROADCASTER.id, broadcaster_user_name: 'x' })).toEqual({ broadcaster_user_id: BROADCASTER.id });
    expect(ChatClearUserMessagesEventSchema.parse({ broadcaster_user_id: BROADCASTER.id, target_user_id: VIEWER.id, target_user_login: VIEWER.login }))
      .toEqual({ broadcaster_user_id: BROADCASTER.id, target_user_id: VIEWER.id });
    expect(StreamOnlineEventSchema.parse({ id: 'simulated-stream-1', broadcaster_user_id: BROADCASTER.id, type: 'live', started_at: NANO_TIME }))
      .toEqual({ id: 'simulated-stream-1', broadcaster_user_id: BROADCASTER.id, type: 'live', started_at: Date.UTC(2026, 9, 30, 12, 0, 0, 123) });
    expect(StreamOnlineEventSchema.safeParse({ id: 'simulated-stream-1', broadcaster_user_id: BROADCASTER.id, type: 'live', started_at: 'soon' }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------------ */
/* Shard                                                                                                   */
/* ------------------------------------------------------------------------------------------------------ */

interface Recorded {
  readonly log: string[];
  readonly attached: Array<{ readonly reason: AttachReason; readonly gap: { readonly from: number; readonly to: number } | null }>;
  readonly detached: string[];
  readonly frames: DeliveryFrame[];
  readonly fatal: string[];
}

function recorder(): { readonly listener: ShardListener; readonly rec: Recorded } {
  const rec: Recorded = { log: [], attached: [], detached: [], frames: [], fatal: [] };
  const listener: ShardListener = {
    attached: (reason, gap) => {
      rec.log.push(`attached:${reason}`);
      rec.attached.push({ reason, gap });
    },
    detached: reason => {
      rec.log.push(`detached:${reason}`);
      rec.detached.push(reason);
    },
    frame: frame => {
      rec.log.push(`frame:${frame.kind}`);
      rec.frames.push(frame);
    },
    fatal: reason => {
      rec.log.push(`fatal:${reason}`);
      rec.fatal.push(reason);
    },
  };
  return { listener, rec };
}

type AdminLike = ShardConnectionOptions['admin'];

interface ShardSetupOptions extends SetupOptions {
  readonly wrapAdmin?: (admin: EventSubAdmin) => AdminLike;
  readonly shard?: Partial<Omit<ShardConnectionOptions, 'admin' | 'conduitId' | 'listener'>>;
}

function shardSetup(options: ShardSetupOptions = {}) {
  const base = setup(options);
  const conduitId = base.eventsub.addConduit(1);
  const { listener, rec } = recorder();
  const maxOpen = { value: 0 };
  const factory = base.eventsub.socketFactory;
  const shard = new ConduitShardConnection({
    admin: options.wrapAdmin ? options.wrapAdmin(base.admin) : base.admin,
    conduitId,
    listener,
    socketFactory: url => {
      const socket = factory(url);
      maxOpen.value = Math.max(maxOpen.value, base.eventsub.openSockets.length);
      return socket;
    },
    url: FAKE_EVENTSUB_URL,
    random: () => 0.5,
    ...options.shard,
  });
  const chat: FakeSubscription = {
    id: 'simulated-subscription-chat', status: 'enabled', type: 'channel.chat.message', version: '1',
    condition: { broadcaster_user_id: BROADCASTER.id, user_id: BOT.id }, transport: { method: 'conduit', conduit_id: conduitId },
  };
  base.eventsub.subscriptions.push(chat);
  return { ...base, conduitId, shard, rec, maxOpen };
}

/** Lets fetch chains, Response bodies and fake socket microtasks run to completion without moving the clock. */
async function settle(): Promise<void> {
  for (let i = 0; i < 25; i++) await new Promise<void>(resolve => setImmediate(resolve));
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

function socketAt(eventsub: FakeEventSub, index: number): FakeSocket {
  const socket = eventsub.sockets[index];
  if (!socket) throw new Error(`no socket ${index}`);
  return socket;
}

describe('ConduitShardConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('attaches a fresh welcomed session to shard 0', async () => {
    const { eventsub, conduitId, shard, rec, fake } = shardSetup();
    shard.start();
    await settle();
    expect(rec.log).toEqual(['attached:fresh']);
    expect(rec.attached[0]?.gap).toBeNull();
    const socket = socketAt(eventsub, 0);
    expect(socket.url).toBe(FAKE_EVENTSUB_URL);
    expect(eventsub.shard(conduitId)).toEqual({ id: '0', status: 'enabled', sessionId: socket.sessionId });
    expect(shard.attached).toBe(true);
    expect(shard.sessionId).toBe(socket.sessionId);
    expect(shard.health()).toMatchObject({ state: 'attached', attached: true, sockets: 1, attempt: 0, lostSince: null, counters: { sessions: 1, attaches: 1 } });
    expect(fake.count('PATCH', 'api.twitch.tv/helix/eventsub/conduits/shards')).toBe(1);
    expect(fake.count('POST', 'api.twitch.tv/helix/eventsub/subscriptions')).toBe(0);
    shard.start();
    expect(eventsub.sockets).toHaveLength(1);
    shard.stop();
  });

  it('assigns within the attach deadline measured from the welcome', async () => {
    const seen: Array<number | undefined> = [];
    const { shard } = shardSetup({
      wrapAdmin: admin => ({
        assignWebSocket: (conduitId, shardId, sessionId, options) => {
          seen.push(options?.deadline);
          return admin.assignWebSocket(conduitId, shardId, sessionId, options);
        },
      }),
    });
    shard.start();
    await settle();
    expect(seen).toEqual([START.getTime() + 10_000]);
    shard.stop();
  });

  it('delivers notifications and revocations only after the welcome', async () => {
    const { eventsub, shard, rec } = shardSetup({ eventsub: { autoWelcome: false } });
    shard.start();
    const socket = socketAt(eventsub, 0);
    eventsub.sendFrame(socket, 'notification', { subscription: { ...SUBSCRIPTION_WIRE }, event: chatEvent('simulated-early') }, { timestamp: NANO_TIME });
    expect(rec.frames).toHaveLength(0);
    expect(shard.health().counters.ignoredFrames).toBe(1);

    eventsub.welcome(socket);
    await settle();
    expect(rec.log).toEqual(['attached:fresh']);
    eventsub.deliver('channel.chat.message', chatEvent('simulated-chat-2'));
    expect(rec.frames).toHaveLength(1);
    const delivered = rec.frames[0];
    expect(delivered?.kind).toBe('notification');
    if (delivered?.kind === 'notification') expect(delivered.event).toMatchObject({ message_id: 'simulated-chat-2' });

    eventsub.revokeAuthorization(BROADCASTER.id);
    expect(rec.frames.map(frame => frame.kind)).toEqual(['notification', 'revocation']);
    shard.stop();
  });

  it('counts malformed frames and never delivers them', async () => {
    const { eventsub, shard, rec } = shardSetup();
    shard.start();
    await settle();
    const socket = socketAt(eventsub, 0);
    eventsub.sendRaw(socket, '{not json');
    eventsub.sendRaw(socket, 42);
    eventsub.sendRaw(socket, new Uint8Array([1, 2, 3]));
    eventsub.sendRaw(socket, 'x'.repeat(MAX_FRAME_CHARS + 1));
    eventsub.sendFrame(socket, 'mystery_type', {});
    eventsub.sendFrame(socket, 'notification', { subscription: SUBSCRIPTION_WIRE, event: chatEvent() }, { timestamp: 'not a time' });
    expect(shard.health().counters.malformedFrames).toBe(6);
    expect(rec.frames).toHaveLength(0);
    expect(shard.attached).toBe(true);
    eventsub.deliver('channel.chat.message', chatEvent());
    expect(rec.frames).toHaveLength(1);
    shard.stop();
  });

  it('retries with a fresh session when the assignment fails, without reporting a gap', async () => {
    const { fake, eventsub, conduitId, shard, rec } = shardSetup();
    fake.fail('PATCH', 'api.twitch.tv/helix/eventsub/conduits/shards', 500);
    shard.start();
    await settle();
    expect(rec.log).toEqual(['detached:attach_provider']);
    expect(socketAt(eventsub, 0).closed).toBe(true);
    expect(shard.health()).toMatchObject({ state: 'backoff', attached: false, attempt: 1, lostSince: null, lastDetachReason: 'attach_provider' });

    await advance(999);
    expect(eventsub.sockets).toHaveLength(1);
    await advance(1);
    expect(eventsub.sockets).toHaveLength(2);
    expect(rec.log).toEqual(['detached:attach_provider', 'attached:fresh']);
    expect(rec.attached[0]?.gap).toBeNull();
    expect(eventsub.shard(conduitId)?.sessionId).toBe(socketAt(eventsub, 1).sessionId);
    shard.stop();
  });

  it('treats a refused shard update as loss and reports its short code', async () => {
    const { eventsub, shard, rec } = shardSetup({ eventsub: { autoWelcome: false } });
    shard.start();
    // A welcome for a session the edge does not know: Twitch refuses to point the shard at it.
    eventsub.sendFrame(socketAt(eventsub, 0), 'session_welcome', { session: { id: 'simulated-session-unknown', status: 'connected', keepalive_timeout_seconds: 10 } });
    await settle();
    expect(rec.detached).toEqual(['shard_refused:websocket_session_not_connected']);
    shard.stop();
  });

  it('retries when no welcome arrives in time', async () => {
    const { eventsub, shard, rec } = shardSetup({ eventsub: { autoWelcome: false } });
    shard.start();
    await advance(14_999);
    expect(rec.log).toEqual([]);
    await advance(1);
    expect(rec.log).toEqual(['detached:welcome_timeout']);
    expect(socketAt(eventsub, 0).closed).toBe(true);
    eventsub.autoWelcome = true;
    await advance(1_000);
    expect(eventsub.sockets).toHaveLength(2);
    expect(rec.log).toEqual(['detached:welcome_timeout', 'attached:fresh']);
    shard.stop();
  });

  it('stays attached while keepalives arrive', async () => {
    const { shard, rec } = shardSetup();
    shard.start();
    await settle();
    await advance(120_000);
    expect(rec.log).toEqual(['attached:fresh']);
    expect(shard.health().lastFrameAt).toBe(START.getTime() + 120_000);
    shard.stop();
  });

  it('declares keepalive loss after the keepalive interval plus grace and repairs with a gap', async () => {
    const { eventsub, conduitId, shard, rec } = shardSetup({ eventsub: { keepaliveSeconds: 5 } });
    shard.start();
    await settle();
    const first = socketAt(eventsub, 0);
    first.silent = true;
    await advance(7_999);
    expect(rec.detached).toEqual([]);
    await advance(1);
    expect(rec.log).toEqual(['attached:fresh', 'detached:keepalive_timeout']);
    expect(first.closed).toBe(true);
    const lostAt = START.getTime() + 8_000;
    expect(shard.health()).toMatchObject({ attached: false, lostSince: lostAt, state: 'backoff' });

    await advance(1_000);
    expect(eventsub.sockets).toHaveLength(2);
    const second = socketAt(eventsub, 1);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(rec.attached[1]).toEqual({ reason: 'repair', gap: { from: lostAt, to: lostAt + 1_000 } });
    expect(eventsub.shard(conduitId)?.sessionId).toBe(second.sessionId);
    expect(shard.health()).toMatchObject({ lostSince: null, counters: { repairs: 1, losses: 1 } });
    shard.stop();
  });

  it('repairs an ordinary drop with a fresh session and a gap from the first loss', async () => {
    const { fake, eventsub, shard, rec } = shardSetup();
    shard.start();
    await settle();
    await advance(5_000);
    eventsub.drop(socketAt(eventsub, 0));
    await settle();
    const lostAt = START.getTime() + 5_000;
    expect(rec.detached).toEqual(['closed_4006']);
    // While the shard is down Twitch has nowhere to deliver.
    eventsub.deliver('channel.chat.message', chatEvent());
    expect(eventsub.dropped).toBe(1);

    // The first repair attempt fails too; the gap still starts at the first loss.
    fake.fail('PATCH', 'api.twitch.tv/helix/eventsub/conduits/shards', 503);
    await advance(1_000);
    expect(rec.detached).toEqual(['closed_4006', 'attach_provider']);
    await advance(1_500);
    expect(rec.attached).toEqual([
      { reason: 'fresh', gap: null },
      { reason: 'repair', gap: { from: lostAt, to: lostAt + 2_500 } },
    ]);
    expect(eventsub.sockets).toHaveLength(3);
    eventsub.deliver('channel.chat.message', chatEvent());
    expect(rec.frames).toHaveLength(1);
    expect(fake.count('POST', 'api.twitch.tv/helix/eventsub/subscriptions')).toBe(0);
    shard.stop();
  });

  it('repairs on request when an outside check finds the shard elsewhere', async () => {
    const { eventsub, shard, rec } = shardSetup();
    shard.repair('not_attached_yet');
    expect(rec.log).toEqual([]);
    shard.start();
    await settle();
    shard.repair('shard_mismatch');
    expect(rec.log).toEqual(['attached:fresh', 'detached:shard_mismatch']);
    expect(socketAt(eventsub, 0).closed).toBe(true);
    await advance(1_000);
    expect(rec.attached[1]?.reason).toBe('repair');
    expect(rec.attached[1]?.gap).toEqual({ from: START.getTime(), to: START.getTime() + 1_000 });
    shard.stop();
  });

  it('treats a shard reported elsewhere or disabled after the update as loss', async () => {
    let calls = 0;
    const { eventsub, shard, rec } = shardSetup({
      wrapAdmin: admin => ({
        assignWebSocket: async (conduitId, shardId, sessionId, options) => {
          calls++;
          if (calls === 1) return { id: shardId, status: 'enabled', sessionId: 'simulated-session-elsewhere' };
          if (calls === 2) return { id: shardId, status: 'websocket_disconnected', sessionId };
          return admin.assignWebSocket(conduitId, shardId, sessionId, options);
        },
      }),
    });
    shard.start();
    await settle();
    expect(rec.log).toEqual(['detached:shard_elsewhere']);
    await advance(1_000);
    expect(rec.log).toEqual(['detached:shard_elsewhere', 'detached:shard_disabled']);
    await advance(1_500);
    expect(rec.log).toEqual(['detached:shard_elsewhere', 'detached:shard_disabled', 'attached:fresh']);
    expect(eventsub.sockets).toHaveLength(3);
    expect(eventsub.openSockets).toHaveLength(1);
    shard.stop();
  });

  it('follows a controlled reconnect: the old socket delivers until the new one is welcomed', async () => {
    const { fake, eventsub, conduitId, shard, rec, maxOpen } = shardSetup();
    shard.start();
    await settle();
    const old = socketAt(eventsub, 0);
    eventsub.autoWelcome = false;
    eventsub.reconnect(old);
    expect(eventsub.sockets).toHaveLength(2);
    const next = socketAt(eventsub, 1);
    expect(next.url).toMatch(/^ws:\/\/127\.0\.0\.1:1\/ws\?reconnect=/);
    expect(eventsub.openSockets).toHaveLength(2);
    expect(shard.health().sockets).toBe(2);

    eventsub.deliver('channel.chat.message', chatEvent('simulated-before-handover'));
    expect(rec.frames).toHaveLength(1);

    // Keepalives keep coming on the old socket while the new one waits.
    await advance(12_000);
    expect(rec.detached).toEqual([]);

    eventsub.welcome(next);
    expect(old.closed).toBe(true);
    expect(eventsub.openSockets).toEqual([next]);
    await settle();
    expect(rec.log).toEqual(['attached:fresh', 'frame:notification', 'attached:handover']);
    expect(rec.attached[1]).toEqual({ reason: 'handover', gap: null });
    expect(eventsub.shard(conduitId)).toEqual({ id: '0', status: 'enabled', sessionId: next.sessionId });
    expect(shard.sessionId).toBe(next.sessionId);
    expect(shard.health()).toMatchObject({ state: 'attached', sockets: 1, counters: { handovers: 1, losses: 0 } });

    eventsub.deliver('channel.chat.message', chatEvent('simulated-after-handover'));
    expect(rec.frames).toHaveLength(2);
    expect(maxOpen.value).toBeLessThanOrEqual(2);
    expect(fake.count('POST', 'api.twitch.tv/helix/eventsub/subscriptions')).toBe(0);

    // The new socket's watchdog is armed: silence on it is loss.
    next.silent = true;
    await advance(13_000);
    expect(rec.detached).toEqual(['keepalive_timeout']);
    shard.stop();
  });

  it('reports the old socket closing before the new welcome as a gap, then completes the handover', async () => {
    const { eventsub, conduitId, shard, rec, maxOpen } = shardSetup();
    shard.start();
    await settle();
    const old = socketAt(eventsub, 0);
    eventsub.autoWelcome = false;
    eventsub.reconnect(old);
    const next = socketAt(eventsub, 1);
    const closedAt = Date.now();
    eventsub.drop(old, 4004);
    await settle();
    // Nothing is delivered until the new session is attached: the listener hears it at once.
    expect(rec.detached).toEqual(['handover_gap']);
    expect(shard.attached).toBe(false);
    expect(shard.sessionId).toBeNull();
    expect(shard.health()).toMatchObject({ state: 'connecting', sockets: 1, lostSince: closedAt, lastDetachReason: 'handover_gap', counters: { losses: 1 } });
    // Longer than the old watchdog would have allowed: it must not fire for a closed socket.
    await advance(14_000);
    expect(rec.detached).toEqual(['handover_gap']);
    eventsub.welcome(next);
    await settle();
    expect(rec.log).toEqual(['attached:fresh', 'detached:handover_gap', 'attached:handover']);
    expect(rec.attached[1]).toEqual({ reason: 'handover', gap: { from: closedAt, to: Date.now() } });
    expect(eventsub.shard(conduitId)?.sessionId).toBe(next.sessionId);
    expect(shard.health()).toMatchObject({ state: 'attached', sockets: 1, lostSince: null, counters: { handovers: 1, losses: 1 } });
    expect(maxOpen.value).toBeLessThanOrEqual(2);
    shard.stop();
  });

  it('abandons a reconnect target that never welcomes and keeps the old socket', async () => {
    const { eventsub, shard, rec } = shardSetup();
    shard.start();
    await settle();
    eventsub.autoWelcome = false;
    eventsub.reconnect(socketAt(eventsub, 0));
    const next = socketAt(eventsub, 1);
    await advance(15_000);
    expect(next.closed).toBe(true);
    expect(socketAt(eventsub, 0).closed).toBe(false);
    expect(rec.log).toEqual(['attached:fresh']);
    expect(shard.health().sockets).toBe(1);
    eventsub.deliver('channel.chat.message', chatEvent());
    expect(rec.frames).toHaveLength(1);
    shard.stop();
  });

  it('reports loss when both the old socket and the reconnect target fail', async () => {
    const { eventsub, shard, rec } = shardSetup();
    shard.start();
    await settle();
    eventsub.autoWelcome = false;
    eventsub.reconnect(socketAt(eventsub, 0));
    const closedAt = Date.now();
    eventsub.drop(socketAt(eventsub, 0));
    await settle();
    expect(rec.detached).toEqual(['handover_gap']);
    await advance(15_000);
    expect(rec.detached).toEqual(['handover_gap', 'handover_failed']);
    // The gap began when the old socket closed, not when the handover was given up.
    expect(shard.health().lostSince).toBe(closedAt);
    eventsub.autoWelcome = true;
    await advance(1_000);
    expect(rec.attached.map(entry => entry.reason)).toEqual(['fresh', 'repair']);
    expect(rec.attached[1]!.gap?.from).toBe(closedAt);
    shard.stop();
  });

  it('ignores a second reconnect while one is pending, so at most two sockets exist', async () => {
    const { eventsub, shard, maxOpen } = shardSetup();
    shard.start();
    await settle();
    eventsub.autoWelcome = false;
    eventsub.reconnect(socketAt(eventsub, 0));
    eventsub.reconnect(socketAt(eventsub, 0));
    eventsub.reconnect(socketAt(eventsub, 1));
    expect(eventsub.sockets).toHaveLength(2);
    expect(shard.health().counters.ignoredFrames).toBe(1);
    expect(maxOpen.value).toBe(2);
    shard.stop();
  });

  it('ignores reconnect URLs on another host or scheme', async () => {
    const { eventsub, shard, rec } = shardSetup();
    shard.start();
    await settle();
    const socket = socketAt(eventsub, 0);
    eventsub.reconnect(socket, 'ws://127.0.0.2:1/ws');
    eventsub.reconnect(socket, 'wss://eventsub.simulated.invalid/ws');
    eventsub.reconnect(socket, 'http://127.0.0.1:1/ws');
    eventsub.reconnect(socket, 'not a url');
    expect(eventsub.sockets).toHaveLength(1);
    expect(shard.health().counters.ignoredFrames).toBe(4);
    expect(rec.log).toEqual(['attached:fresh']);
    shard.stop();
  });

  it('follows only same-host wss reconnects for the production endpoint', async () => {
    const { eventsub, shard } = shardSetup({ shard: { url: EVENTSUB_WS_URL } });
    shard.start();
    await settle();
    const socket = socketAt(eventsub, 0);
    expect(socket.url).toBe(EVENTSUB_WS_URL);
    eventsub.autoWelcome = false;
    eventsub.reconnect(socket, 'ws://eventsub.wss.twitch.tv/ws');
    eventsub.reconnect(socket, 'wss://eventsub.wss.twitch.tv.simulated.invalid/ws');
    expect(eventsub.sockets).toHaveLength(1);
    eventsub.reconnect(socket, 'wss://eventsub.wss.twitch.tv/ws?id=simulated-reconnect');
    expect(eventsub.sockets).toHaveLength(2);
    expect(socketAt(eventsub, 1).url).toBe('wss://eventsub.wss.twitch.tv/ws?id=simulated-reconnect');
    shard.stop();
  });

  it.each([0, 0.5, 0.999999, 1])('keeps backoff within 1-60 s across many consecutive failures (random %s)', async value => {
    const opened: number[] = [];
    const { shard, rec } = shardSetup({
      shard: {
        random: () => value,
        socketFactory: () => {
          opened.push(Date.now());
          throw new Error('SIMULATED connect refusal');
        },
      },
    });
    shard.start();
    for (let i = 0; i < 60 && opened.length < 30; i++) await vi.advanceTimersByTimeAsync(60_000);
    expect(opened.length).toBeGreaterThanOrEqual(30);
    const delays = opened.slice(1).map((at, index) => at - opened[index]!);
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(1_000);
      expect(delay).toBeLessThanOrEqual(60_000);
    }
    expect(delays[0]).toBe(1_000);
    for (let i = 1; i < delays.length; i++) expect(delays[i]!).toBeGreaterThanOrEqual(delays[i - 1]!);
    // Settled at the cap step: the upper half of 60 s, placed by the jitter.
    expect(delays.at(-1)).toBe(Math.round(30_000 + value * 30_000));
    expect(new Set(rec.detached)).toEqual(new Set(['connect_failed']));
    expect(shard.health().attempt).toBe(opened.length);
    shard.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops for good when the conduit is gone', async () => {
    const { eventsub, conduitId, shard, rec } = shardSetup();
    eventsub.conduits.delete(conduitId);
    shard.start();
    await settle();
    expect(rec.log).toEqual(['fatal:conduit_missing']);
    expect(shard.health()).toMatchObject({ state: 'failed', attached: false, sockets: 0, lastDetachReason: 'conduit_missing' });
    expect(socketAt(eventsub, 0).closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await advance(300_000);
    expect(eventsub.sockets).toHaveLength(1);
    expect(rec.log).toEqual(['fatal:conduit_missing']);
  });

  it('stops for good when the conduit disappears during a repair', async () => {
    const { eventsub, conduitId, shard, rec } = shardSetup();
    shard.start();
    await settle();
    eventsub.conduits.delete(conduitId);
    eventsub.drop(socketAt(eventsub, 0));
    await settle();
    await advance(1_000);
    expect(rec.log).toEqual(['attached:fresh', 'detached:closed_4006', 'fatal:conduit_missing']);
    await advance(300_000);
    expect(eventsub.sockets).toHaveLength(2);
    expect(eventsub.openSockets).toHaveLength(0);
  });

  it('stop() closes every socket and leaves no timers, even mid-handover', async () => {
    const { eventsub, shard, rec } = shardSetup();
    shard.start();
    await settle();
    eventsub.autoWelcome = false;
    eventsub.reconnect(socketAt(eventsub, 0));
    expect(eventsub.openSockets).toHaveLength(2);
    shard.stop();
    expect(eventsub.openSockets).toHaveLength(0);
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    expect(shard.health()).toMatchObject({ state: 'stopped', attached: false, sockets: 0 });
    expect(shard.attached).toBe(false);
    expect(shard.sessionId).toBeNull();
    expect(rec.log).toEqual(['attached:fresh']);

    eventsub.welcome(socketAt(eventsub, 1));
    shard.start();
    shard.repair('after_stop');
    await advance(300_000);
    expect(eventsub.sockets).toHaveLength(2);
    expect(rec.log).toEqual(['attached:fresh']);
  });

  it('stop() during backoff cancels the retry', async () => {
    const { eventsub, shard, rec } = shardSetup();
    shard.start();
    await settle();
    eventsub.drop(socketAt(eventsub, 0));
    await settle();
    expect(rec.detached).toEqual(['closed_4006']);
    shard.stop();
    expect(vi.getTimerCount()).toBe(0);
    await advance(120_000);
    expect(eventsub.sockets).toHaveLength(1);
  });

  it('stop() aborts an assignment in flight and reports nothing afterwards', async () => {
    const signals: AbortSignal[] = [];
    const { eventsub, shard, rec } = shardSetup({
      wrapAdmin: () => ({
        assignWebSocket: (_conduitId, _shardId, _sessionId, options) => new Promise((_resolve, reject) => {
          const signal = options?.signal;
          if (signal) {
            signals.push(signal);
            signal.addEventListener('abort', () => reject(new TwitchRequestError('aborted', 'update conduit shards')));
          }
        }),
      }),
    });
    shard.start();
    await settle();
    expect(signals).toHaveLength(1);
    expect(shard.health().state).toBe('attaching');
    shard.stop();
    await settle();
    expect(signals[0]?.aborted).toBe(true);
    expect(rec.log).toEqual([]);
    expect(eventsub.openSockets).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
