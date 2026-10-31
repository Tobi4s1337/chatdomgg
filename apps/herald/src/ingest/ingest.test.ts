import { KingdomIdSchema, PRESENCE_LEASE_MS, type KingdomPresenceFrame } from '@chatdom/shared';
import { AppTokenSession, EventSubAdmin, HelixReader, Secret } from '@chatdom/twitch';
import { FAKE_EVENTSUB_URL, FakeEventSub, FakeTwitch, type FakeSocket } from '@chatdom/twitch/testing';
import type { PresenceBinding } from '@chatdom/world';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeraldAuthority } from '../auth/authority';
import type { HeraldConfig } from '../config';
import { MemoryBindingStore, type BindingStore } from '../source/bindings';
import { presentKingdom } from '../source/kingdom';
import { PresenceSource } from '../source/source';
import { CLOCK_SKEW_MS } from './ingest';
import { provisionSource, recordConduitId } from './provision';
import { DeliveryRuntime } from './runtime';
import { HERALD_EVENT_TYPES } from './subscriptions';
import { TtlMap } from './ttl';
import { extractForgeWords, ForgeCommandHandoff, type ForgeCommandSink, type ForgeChatCommand, type ForgeCommandLease } from '../forge/commands';
import { StreamTracker } from '../observe/stream';

const CLIENT_ID = 'simulatedclient0000000000000001';
const SECRET = 'simulated-client-secret-value-0001';
const BROADCASTER = { id: '129634568', login: 'tobi4s_', displayName: 'tobi4s_' };
const READER = { id: '900000001', login: 'herald_reader', displayName: 'HeraldReader' };
const READER_SCOPES = ['user:read:chat', 'user:bot'];
const BROADCASTER_SCOPES = ['channel:bot', 'moderator:read:chatters'];
const FULL_GRANTS = { [READER.id]: READER_SCOPES, [BROADCASTER.id]: BROADCASTER_SCOPES };
const KINGDOM = KingdomIdSchema.parse(BROADCASTER.id);
const SLOTS = presentKingdom({ seed: 'tobi4s_', tier: 'hamlet', firstYear: 2026, year: 2026 }).slots;
/** Synthetic chat text: every test proves it never travels past the event schema. */
const BODY = 'SIMULATED chat body that must never leave ingest';
const PEOPLE = { juniper: { id: '777000001', name: 'Juniper' }, rook: { id: '777000002', name: 'Rook' }, wren: { id: '777000003', name: 'Wren' } };

function config(overrides: Partial<HeraldConfig> = {}): HeraldConfig {
  return {
    channelLogin: BROADCASTER.login, channelLoginDefaulted: false, readerLogin: READER.login, redirectUri: null,
    credentials: { clientId: CLIENT_ID, clientSecret: new Secret(SECRET) }, conduitId: null, problems: [],
    dataDir: '/simulated/data', kingdom: { seed: 'tobi4s_', tier: 'hamlet', firstYear: 2026, year: 2026 },
    port: 5194, secretsFile: '/simulated/atlas.env', settingsFile: '/simulated/herald.env', ...overrides,
  };
}

/** A store whose writes wait until the test opens the gate, to hold activity in the queue. */
class GatedStore implements BindingStore {
  readonly kind = 'memory' as const;
  readonly #inner = new MemoryBindingStore();
  gate: Promise<void> = Promise.resolve();
  load() {
    return this.#inner.load();
  }
  async save(bindings: readonly PresenceBinding[]) {
    await this.gate;
    return this.#inner.save(bindings);
  }
  erase() {
    return this.#inner.erase();
  }
  close() {
    return this.#inner.close();
  }
}

const iso = (at: number) => new Date(at).toISOString();

function chatEvent(person: { id: string; name: string }, messageId: string, extra: Record<string, unknown> = {}) {
  return {
    broadcaster_user_id: BROADCASTER.id, broadcaster_user_login: BROADCASTER.login, broadcaster_user_name: BROADCASTER.displayName,
    chatter_user_id: person.id, chatter_user_login: person.name.toLowerCase(), chatter_user_name: person.name,
    message_id: messageId, message: { text: BODY, fragments: [{ type: 'text', text: BODY, cheermote: null, emote: null, mention: null }] },
    color: '#00FF7F', badges: [{ set_id: 'subscriber', id: '12', info: '16' }], message_type: 'text', cheer: null, reply: null,
    channel_points_custom_reward_id: null, source_broadcaster_user_id: null, source_broadcaster_user_login: null,
    source_broadcaster_user_name: null, source_message_id: null, source_badges: null, ...extra,
  };
}
const broadcasterFields = { broadcaster_user_id: BROADCASTER.id, broadcaster_user_login: BROADCASTER.login, broadcaster_user_name: BROADCASTER.displayName };

async function rig(options: { grants?: Record<string, readonly string[]>; store?: BindingStore; conduit?: 'present' | 'missing'; forge?: ForgeCommandSink } = {}) {
  const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: SECRET, users: [BROADCASTER, READER], grants: options.grants ?? FULL_GRANTS });
  const eventsub = new FakeEventSub(fake, { keepaliveSeconds: 10 });
  const conduitId = options.conduit === 'missing' ? 'simulated-conduit-gone' : eventsub.addConduit(1);
  const tokens = new AppTokenSession({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), fetch: fake.fetch });
  const helix = new HelixReader({ tokens, fetch: fake.fetch });
  const authority = new HeraldAuthority({ config: config({ conduitId }), tokens, helix });
  await authority.start();
  const source = new PresenceSource({ kingdomId: KINGDOM, origin: 'live', slots: SLOTS, store: options.store ?? new MemoryBindingStore(), tickMs: 0 });
  await source.open();
  const frames: KingdomPresenceFrame[] = [];
  let unavailable = 0;
  source.subscribe({ frame: frame => frames.push(frame.frame), unavailable: () => void unavailable++ });
  const log: string[] = [];
  const forgeStream = options.forge ? new StreamTracker({kingdomId:KINGDOM, source}) : null;
  const runtime = new DeliveryRuntime({
    conduitId, clientId: CLIENT_ID, broadcasterId: BROADCASTER.id, readerId: READER.id,
    admin: new EventSubAdmin(helix.session), authority, source, socketFactory: eventsub.socketFactory, url: FAKE_EVENTSUB_URL,
    random: () => 0.5, settleMs: 20, log: line => log.push(line),
    ...(options.forge && forgeStream ? { forge: {run:options.forge, broadcast:forgeStream}, stream:observation=>forgeStream.push(observation) } : {}),
  });
  const stopAll = async () => {
    runtime.stop();
    authority.stop();
    tokens.close();
    await source.close();
  };
  cleanups.push(stopAll);
  const settle = async (ms = 50) => {
    await vi.advanceTimersByTimeAsync(ms);
  };
  const until = async (predicate: () => boolean, limitMs = 120_000) => {
    for (let waited = 0; waited <= limitMs; waited += 25) {
      if (predicate()) return;
      await vi.advanceTimersByTimeAsync(25);
    }
    throw new Error('condition not reached');
  };
  const socket = (): FakeSocket => eventsub.openSockets.at(-1)!;
  const live = (id = 'simulated-stream-1', type = 'live') => eventsub.deliver('stream.online', { id, ...broadcasterFields, type, started_at: iso(Date.now()) });
  const say = (person: { id: string; name: string }, messageId: string, extra: Record<string, unknown> = {}, meta: { timestamp?: string; messageId?: string } = {}) =>
    eventsub.deliver('channel.chat.message', chatEvent(person, messageId, extra), meta);
  const latest = () => frames.at(-1) ?? source.current?.frame ?? null;
  const present = () => (source.current?.frame.windows ?? []).filter(window => window.present);
  return { fake, eventsub, conduitId, tokens, helix, authority, source, runtime, frames, log, settle, until, socket, live, say, latest, present, stopAll, forgeStream, get unavailable() { return unavailable; } };
}

const cleanups: Array<() => Promise<void>> = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(Date.UTC(2026, 9, 30, 20, 0, 0));
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
});

async function started(options: Parameters<typeof rig>[0] = {}) {
  const r = await rig(options);
  await r.runtime.start();
  await r.until(() => r.runtime.covered);
  return r;
}

describe('private Forge command handoff', () => {
  it('waits for a durable native slot, dedupes the wish and withdraws it on cleanup or broadcast loss', async () => {
    const calls: Array<{command: ForgeChatCommand; lease: ForgeCommandLease}> = [];
    const store = new GatedStore();
    const r = await started({ store, forge: async (command, lease) => {
      calls.push({command, lease});
      await new Promise<void>(resolve => lease.signal.addEventListener('abort', () => resolve(), {once:true}));
    } });
    const wish = (text: string) => ({ message: { text } });
    r.live(); await r.settle();
    r.say(PEOPLE.juniper, 'ordinary'); await r.settle(); expect(calls).toHaveLength(0);
    const originalAt = Date.now();
    await r.settle(60_000); r.say(PEOPLE.juniper,'refresh'); await r.settle(31_000);
    const expired = vi.fn(async () => {});
    const admission = new ForgeCommandHandoff(r.source, {run:expired,broadcast:r.forgeStream!});
    admission.offer({personId:PEOPLE.juniper.id,messageId:'expired-wish',words:'a dragon',observedAt:originalAt},()=>true);
    await r.settle(); expect(Date.now()-originalAt).toBeGreaterThan(PRESENCE_LEASE_MS); expect(expired).not.toHaveBeenCalled(); admission.dispose();
    let release!: () => void;
    store.gate = new Promise<void>(resolve => { release = resolve; });
    r.say(PEOPLE.rook, 'old-broadcast', wish('!forge a dragon from the old broadcast'));
    await r.settle(); expect(calls).toHaveLength(0);
    r.eventsub.deliver('stream.offline',broadcasterFields); await r.settle();
    r.live('simulated-stream-2'); await r.settle();
    expect(r.source.current!.frame.streamLive).toBe(true); // Both transitions are still behind the binding write.
    release(); await r.settle();
    expect(calls).toHaveLength(0);
    r.say(PEOPLE.rook, 'dragon', wish('!forge a chimney shaped like a sleeping dragon')); await r.settle();
    expect(calls).toHaveLength(1);
    const first = calls[0]!;
    expect(first.command).toMatchObject({ kingdomId: KINGDOM, personId: PEOPLE.rook.id, messageId:'dragon', words:'a chimney shaped like a sleeping dragon' });
    expect(first.command.slot).toBe(r.present().find(w=>w.publicName===PEOPLE.rook.name)!.slot);
    expect(first.lease.current()).toBe(true);
    r.say(PEOPLE.rook, 'dragon', wish('!forge a different wish')); await r.settle(); expect(calls).toHaveLength(1);
    expect(JSON.stringify(r.frames)).not.toContain('sleeping dragon');
    expect(JSON.stringify(r.runtime.health())).not.toContain('sleeping dragon');
    r.eventsub.deliver('channel.chat.message_delete',{...broadcasterFields,target_user_id:PEOPLE.rook.id,message_id:'dragon'});
    await r.settle(); expect(first.lease.signal.aborted).toBe(true); expect(first.lease.current()).toBe(false);
    r.say(PEOPLE.rook,'owl',wish('!forge an owl weathervane')); await r.settle();
    r.eventsub.deliver('channel.chat.clear_user_messages',{...broadcasterFields,target_user_id:PEOPLE.rook.id}); await r.settle();
    expect(calls[1]!.lease.signal.aborted).toBe(true);
    r.say(PEOPLE.wren,'moon',wish('!forge a moon lantern')); await r.settle();
    r.eventsub.deliver('channel.chat.clear',broadcasterFields); await r.settle();
    expect(calls[2]!.lease.signal.aborted).toBe(true);
    r.say(PEOPLE.juniper,'fox',wish('!forge a sleeping fox')); await r.settle();
    store.gate = new Promise<void>(resolve => { release = resolve; });
    r.say({id:'777000004',name:'Sage'},'pending-writer'); await r.settle();
    r.eventsub.deliver('stream.offline',broadcasterFields); await r.settle();
    expect(r.source.current!.frame.streamLive).toBe(true); // The write still holds the old projection.
    expect(calls[3]!.lease.signal.aborted).toBe(true);
    release(); await r.settle();
    r.say(PEOPLE.wren,'offline',wish('!forge another moon lantern')); await r.settle(); expect(calls).toHaveLength(4);
    r.live('simulated-stream-3'); await r.settle();
    r.say(PEOPLE.wren,'after-live',wish('!forge a moon lantern')); await r.settle(); expect(calls).toHaveLength(5);
    r.socket().close(); await r.settle(); expect(calls[4]!.lease.signal.aborted).toBe(true);
    for (const text of ['hello !forge a dragon','!forge','!forge '+ 'x'.repeat(241)]) expect(extractForgeWords({message:{text}})).toBeNull();
  });
});

describe('subscription reconciliation', () => {
  it('creates exactly the eight planned subscriptions on the configured conduit, once', async () => {
    const r = await started();
    const ours = r.eventsub.subscriptions.filter(entry => entry.transport.method === 'conduit' && entry.transport.conduit_id === r.conduitId);
    expect(ours.map(entry => entry.type).sort()).toEqual([...HERALD_EVENT_TYPES].sort());
    expect(ours.every(entry => entry.version === '1')).toBe(true);
    expect(ours.find(entry => entry.type === 'channel.chat.message')!.condition).toEqual({ broadcaster_user_id: BROADCASTER.id, user_id: READER.id });
    expect(ours.find(entry => entry.type === 'user.authorization.revoke')!.condition).toEqual({ client_id: CLIENT_ID });
    await r.runtime.verify();
    await r.runtime.verify();
    expect(r.fake.count('POST', 'api.twitch.tv/helix/eventsub/subscriptions')).toBe(8);
    expect(r.runtime.health().coverage.every(entry => entry.state === 'enabled')).toBe(true);
    expect(r.source.available).toBe(true);
    // Only the conduit filter is ever used to list; the client's conduits are never enumerated.
    expect(r.fake.count('GET', 'api.twitch.tv/helix/eventsub/conduits')).toBe(0);
  });

  it('without chat grants creates only stream and revocation subscriptions, never asks Twitch for chat, and never publishes', async () => {
    const r = await rig({ grants: {} });
    await r.runtime.start();
    await r.until(() => r.runtime.health().verifiedAt !== null);
    const coverage = Object.fromEntries(r.runtime.health().coverage.map(entry => [entry.type, entry.state]));
    expect(coverage).toEqual({
      'channel.chat.message': 'unauthorized', 'channel.chat.notification': 'unauthorized', 'channel.chat.message_delete': 'unauthorized', 'channel.chat.clear': 'unauthorized',
      'channel.chat.clear_user_messages': 'unauthorized', 'stream.online': 'enabled', 'stream.offline': 'enabled', 'user.authorization.revoke': 'enabled',
    });
    expect(r.fake.calls.filter(call => call.status === 403)).toEqual([]);
    expect(r.source.available).toBe(false);
    expect(r.source.health()).toMatchObject({ condition: 'unauthorized', reason: 'unauthorized' });
  });

  it('accepts a 409 only when the matching subscription is on its own conduit', async () => {
    const r = await rig();
    r.eventsub.addForeignSubscription('user.authorization.revoke', { client_id: CLIENT_ID });
    await r.runtime.start();
    await r.until(() => r.runtime.health().verifiedAt !== null);
    const revoke = r.runtime.health().coverage.find(entry => entry.type === 'user.authorization.revoke')!;
    expect(revoke.state).toBe('conflict');
    // Required coverage is incomplete, so nothing is published, and the foreign subscription is untouched.
    expect(r.source.available).toBe(false);
    expect(r.eventsub.subscriptions.some(entry => entry.id.startsWith('simulated-foreign-'))).toBe(true);
    expect(r.fake.count('DELETE', 'api.twitch.tv/helix/eventsub/subscriptions')).toBe(0);
  });

  it('replaces only its own disabled copy of a planned subscription', async () => {
    const r = await started();
    const own = r.eventsub.subscriptions.find(entry => entry.type === 'stream.offline')!;
    own.status = 'version_removed';
    const foreign = r.eventsub.addForeignSubscription('stream.offline', { broadcaster_user_id: '42' });
    foreign.status = 'authorization_revoked';
    await r.runtime.verify();
    expect(r.eventsub.subscriptions.includes(own)).toBe(false);
    expect(r.eventsub.subscriptions.includes(foreign)).toBe(true);
    expect(r.eventsub.subscriptions.filter(entry => entry.type === 'stream.offline' && entry.status === 'enabled' && entry.transport.method === 'conduit')).toHaveLength(1);
  });
});

describe('chat into presence', () => {
  it('lights exactly one named window for a real-shaped message, and none of its text survives anywhere', async () => {
    const r = await started();
    r.live();
    r.say(PEOPLE.juniper, 'simulated-message-1');
    await r.settle();
    expect(r.present()).toHaveLength(1);
    expect(r.present()[0]).toMatchObject({ present: true, publicName: 'Juniper' });
    const published = JSON.stringify([r.frames, r.source.current, r.source.health(), r.runtime.health(), r.log]);
    expect(published).not.toContain(BODY);
    expect(published).not.toContain(PEOPLE.juniper.id);
    expect(published).not.toContain('#00FF7F');
    expect(r.runtime.health().ingest.counters).toMatchObject({ chatSubmitted: 1, streamChanges: 1 });
  });

  it('times each applied message from its Twitch stamp to the frame that shows it, as numbers only', async () => {
    const store = new GatedStore();
    const r = await started({ store });
    r.live();
    // Run past the ingest's start, so a message stamped two seconds ago is not from before it.
    await r.settle(5_000);
    let open!: () => void;
    store.gate = new Promise(resolve => (open = resolve));
    const stamped = Date.now() - 2_000;
    r.say(PEOPLE.juniper, 'simulated-message-1', {}, { timestamp: iso(stamped) });
    const received = Date.now();
    r.say(PEOPLE.rook, 'simulated-message-2');
    r.eventsub.deliver('channel.chat.message_delete', { ...broadcasterFields, target_user_id: PEOPLE.rook.id, target_user_name: 'Rook', target_user_login: 'rook', message_id: 'simulated-message-2' });
    await r.settle(300);
    open();
    await r.settle();
    const latency = r.runtime.health().ingest.latency;
    // The withdrawn message never applied, so it is not timed.
    expect(latency.samples).toBe(1);
    expect(latency.last).toMatchObject({ occurredAt: stamped, receivedAt: received });
    expect(latency.twitchMs).toEqual({ median: 2_000, max: 2_000 });
    expect(latency.heraldMs!.median).toBeGreaterThanOrEqual(300);
    const shown = r.frames.find(frame => frame.sequence === latency.last!.sequence)!;
    expect(shown.windows.filter(window => window.present).map(window => window.publicName)).toEqual(['Juniper']);
    expect(JSON.stringify(latency)).not.toMatch(/777000|simulated-message|Juniper/);
  });

  it('strips unsafe characters from names and leaves a nameless author unnamed', async () => {
    const r = await started();
    r.live();
    r.say({ id: '777000010', name: '‮evil⁦one' }, 'simulated-message-bidi');
    r.say({ id: '777000011', name: ' ‮ ' }, 'simulated-message-empty');
    await r.settle();
    expect(r.present().map(window => window.publicName).sort()).toEqual(['evilone', null]);
  });

  it('deduplicates delivery IDs and chat message IDs across a controlled reconnect', async () => {
    const r = await started();
    r.live();
    const [delivery] = r.say(PEOPLE.juniper, 'simulated-message-1');
    const old = r.socket();
    r.eventsub.reconnect(old);
    await r.until(() => old.closed && r.eventsub.openSockets.length === 1);
    expect(r.runtime.covered).toBe(true);
    r.eventsub.redeliver('channel.chat.message', chatEvent(PEOPLE.juniper, 'simulated-message-1'), delivery!);
    r.say(PEOPLE.juniper, 'simulated-message-1');
    await r.settle();
    expect(r.runtime.health().ingest.counters).toMatchObject({ chatSubmitted: 1, duplicateDeliveries: 1, duplicateMessages: 1 });
    expect(r.runtime.health().gaps.count).toBe(0);
    expect(r.fake.count('POST', 'api.twitch.tv/helix/eventsub/subscriptions')).toBe(8);
  });

  it('a message deleted before it arrives never lights', async () => {
    const r = await started();
    r.live();
    r.eventsub.deliver('channel.chat.message_delete', { ...broadcasterFields, target_user_id: PEOPLE.rook.id, target_user_name: 'Rook', target_user_login: 'rook', message_id: 'simulated-message-2' });
    r.say(PEOPLE.rook, 'simulated-message-2');
    await r.settle();
    expect(r.present()).toEqual([]);
    expect(r.runtime.health().ingest.counters.tombstoned).toBe(1);
  });

  it('a delete after the message applied leaves its author lit and named', async () => {
    const r = await started();
    r.live();
    r.say(PEOPLE.rook, 'simulated-message-2');
    await r.settle();
    r.eventsub.deliver('channel.chat.message_delete', { ...broadcasterFields, target_user_id: PEOPLE.rook.id, target_user_name: 'Rook', target_user_login: 'rook', message_id: 'simulated-message-2' });
    await r.settle();
    expect(r.present().map(window => window.publicName)).toEqual(['Rook']);
  });

  it('a delete while the message still waits behind its binding write cancels it', async () => {
    const store = new GatedStore();
    const r = await started({ store });
    r.live();
    let open!: () => void;
    store.gate = new Promise(resolve => {
      open = resolve;
    });
    r.say(PEOPLE.wren, 'simulated-message-3');
    await r.settle();
    expect(r.runtime.health().ingest.pending).toBe(1);
    r.eventsub.deliver('channel.chat.message_delete', { ...broadcasterFields, target_user_id: PEOPLE.wren.id, target_user_name: 'Wren', target_user_login: 'wren', message_id: 'simulated-message-3' });
    open();
    await r.settle();
    expect(r.present()).toEqual([]);
    expect(r.runtime.health().ingest).toMatchObject({ pending: 0, counters: { canceled: 1 } });
    expect(r.source.health().counters.canceled).toBe(1);
  });

  it('a user clear darkens that window at once and holds it dark for ten minutes', async () => {
    const r = await started();
    r.live();
    r.say(PEOPLE.juniper, 'simulated-message-1');
    r.say(PEOPLE.rook, 'simulated-message-2');
    await r.settle();
    expect(r.present()).toHaveLength(2);
    r.eventsub.deliver('channel.chat.clear_user_messages', { ...broadcasterFields, target_user_id: PEOPLE.juniper.id, target_user_name: 'Juniper', target_user_login: 'juniper' });
    await r.settle();
    expect(r.present().map(window => window.publicName)).toEqual(['Rook']);
    for (let minute = 1; minute <= 5; minute++) {
      await r.settle(60_000);
      r.live();
    }
    r.say(PEOPLE.juniper, 'simulated-message-4');
    await r.settle();
    expect(r.present().some(window => window.publicName === 'Juniper')).toBe(false);
    for (let minute = 1; minute <= 5; minute++) {
      await r.settle(60_000);
      r.live();
    }
    r.say(PEOPLE.juniper, 'simulated-message-5');
    await r.settle();
    expect(r.present().some(window => window.publicName === 'Juniper')).toBe(true);
  });

  it('a room clear withdraws waiting and earlier activity, but nobody\'s light goes out', async () => {
    const store = new GatedStore();
    const r = await started({ store });
    r.live();
    r.say(PEOPLE.juniper, 'simulated-message-1');
    await r.settle();
    let open!: () => void;
    store.gate = new Promise(resolve => {
      open = resolve;
    });
    r.say(PEOPLE.rook, 'simulated-message-2');
    await r.settle();
    const clearedAt = Date.now();
    r.eventsub.deliver('channel.chat.clear', { ...broadcasterFields });
    open();
    await r.settle();
    // Reordered delivery of a message sent before the clear is not brought back either.
    r.say(PEOPLE.wren, 'simulated-message-3', {}, { timestamp: iso(clearedAt - 20) });
    await r.settle();
    expect(r.present().map(window => window.publicName)).toEqual(['Juniper']);
    expect(r.runtime.health().ingest.counters).toMatchObject({ roomClears: 1, canceled: 1, tombstoned: 1 });
  });

  it('only a live broadcast wakes the beacon; offline rests it', async () => {
    const r = await started();
    r.live('simulated-rerun', 'rerun');
    await r.settle();
    expect(r.latest()).toMatchObject({ streamLive: false, connection: 'stale' });
    r.live();
    await r.settle();
    expect(r.latest()).toMatchObject({ streamLive: true, connection: 'fresh' });
    await r.settle(1_000);
    r.eventsub.deliver('stream.offline', { ...broadcasterFields });
    await r.settle();
    expect(r.latest()).toMatchObject({ streamLive: false, connection: 'offline' });
    expect(r.runtime.health().ingest.counters).toMatchObject({ notLive: 1, streamChanges: 2 });
  });

  it('future, pre-start, expired and shared-chat guest messages never light', async () => {
    const r = await started();
    r.live();
    const now = Date.now();
    r.say(PEOPLE.juniper, 'simulated-future', {}, { timestamp: iso(now + CLOCK_SKEW_MS + 60_000) });
    r.say(PEOPLE.rook, 'simulated-before-start', {}, { timestamp: iso(now - 3_600_000) });
    r.say(PEOPLE.wren, 'simulated-guest', { source_broadcaster_user_id: '555000555', source_message_id: 'x' });
    await r.settle();
    expect(r.present()).toEqual([]);
    expect(r.runtime.health().ingest.counters).toMatchObject({ future: 1, preStart: 1, sharedChatGuests: 1 });
    // Slight clock skew is accepted at our receipt time rather than dropped as future.
    r.say(PEOPLE.juniper, 'simulated-skewed', {}, { timestamp: iso(now + 2_000) });
    await r.settle();
    expect(r.present().map(window => window.publicName)).toEqual(['Juniper']);
  });

  it('malformed, foreign and unverified deliveries fail closed and are only counted', async () => {
    const r = await started();
    r.live();
    r.eventsub.sendRaw(r.socket(), '{not json');
    r.eventsub.sendRaw(r.socket(), JSON.stringify({ metadata: { message_id: 'x', message_type: 'notification', message_timestamp: 'yesterday' }, payload: {} }));
    const subscription = { id: 'simulated-elsewhere', status: 'enabled', type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: BROADCASTER.id, user_id: READER.id }, transport: { method: 'conduit', conduit_id: 'simulated-other-conduit' } };
    r.eventsub.sendFrame(r.socket(), 'notification', { subscription, event: chatEvent(PEOPLE.rook, 'simulated-foreign') }, { messageId: 'simulated-d1' });
    const wrongVersion = { ...subscription, version: '2', transport: { method: 'conduit', conduit_id: r.conduitId } };
    r.eventsub.sendFrame(r.socket(), 'notification', { subscription: wrongVersion, event: chatEvent(PEOPLE.rook, 'simulated-v2') }, { messageId: 'simulated-d2' });
    const ours = { ...subscription, transport: { method: 'conduit', conduit_id: r.conduitId } };
    const missingAuthor: Record<string, unknown> = chatEvent(PEOPLE.rook, 'simulated-no-author');
    delete missingAuthor.chatter_user_id;
    r.eventsub.sendFrame(r.socket(), 'notification', { subscription: ours, event: missingAuthor }, { messageId: 'simulated-d3' });
    r.eventsub.sendFrame(r.socket(), 'notification', { subscription: ours, event: chatEvent(PEOPLE.rook, 'simulated-other-channel', { broadcaster_user_id: '42' }) }, { messageId: 'simulated-d4' });
    await r.settle();
    expect(r.present()).toEqual([]);
    expect(r.runtime.health().shard.counters.malformedFrames).toBe(2);
    expect(r.runtime.health().ingest.counters).toMatchObject({ unverified: 2, malformed: 2 });
    expect(r.source.available).toBe(true);
  });
});

describe('delivery health', () => {
  it('an older verification cannot restore cleanup coverage after a subscription revocation', async () => {
    const r = await started();
    const list = EventSubAdmin.prototype.listConduitSubscriptions;
    let releaseOld!: () => void;
    let releaseFresh!: () => void;
    const oldGate = new Promise<void>(resolve => (releaseOld = resolve));
    const freshGate = new Promise<void>(resolve => (releaseFresh = resolve));
    let captured = false;
    let calls = 0;
    const listing = vi.spyOn(EventSubAdmin.prototype, 'listConduitSubscriptions').mockImplementation(async function (this: EventSubAdmin, ...args) {
      calls++;
      if (calls !== 1) await freshGate;
      const result = await list.apply(this, args);
      if (calls === 1) { captured = true; await oldGate; }
      return result;
    });
    try {
      const verifying = r.runtime.verify();
      await r.until(() => captured);
      const cleanup = r.eventsub.subscriptions.find(entry => entry.type === 'channel.chat.message_delete')!;
      cleanup.status = 'version_removed';
      r.eventsub.sendFrame(r.socket(), 'revocation', { subscription: cleanup });
      expect(r.source.available).toBe(false);
      const verifiedAt = r.runtime.health().verifiedAt;
      releaseOld();
      await verifying;
      expect(r.runtime.health().coverage.find(entry => entry.type === cleanup.type)).toMatchObject({ state: 'disabled', reason: 'version_removed' });
      expect(r.runtime.health().verifiedAt).toBe(verifiedAt);
      expect(r.source.available).toBe(false);
      releaseFresh();
      await r.until(() => r.source.available);
      expect(calls).toBeGreaterThan(1);
      expect(r.eventsub.subscriptions.includes(cleanup)).toBe(false);
    } finally {
      releaseOld();
      releaseFresh();
      listing.mockRestore();
    }
  });

  it('losing the shard closes the stream at once; repair restores it and records the gap', async () => {
    const r = await started();
    r.live();
    r.say(PEOPLE.juniper, 'simulated-message-1');
    await r.settle();
    const before = r.unavailable;
    r.eventsub.drop(r.socket());
    await vi.advanceTimersByTimeAsync(0);
    expect(r.source.available).toBe(false);
    expect(r.unavailable).toBe(before + 1);
    expect(r.source.current).toBeNull();
    await r.until(() => r.runtime.covered);
    expect(r.source.available).toBe(true);
    expect(r.runtime.health().gaps.count).toBe(1);
    expect(r.runtime.health().shard.counters.repairs).toBe(1);
    expect(r.eventsub.shard(r.conduitId)).toMatchObject({ status: 'enabled', sessionId: r.socket().sessionId });
    expect(r.fake.count('POST', 'api.twitch.tv/helix/eventsub/subscriptions')).toBe(8);
    expect(r.log.join('\n')).toMatch(/events in that gap are lost, not replayed/);
  });

  it('an old socket closing before the reconnect target welcomes is a gap: publication waits for attach and reconciliation', async () => {
    const r = await rig();
    const reads: string[] = [];
    let release: () => void = () => undefined;
    const reconcile = vi.fn(async (after: 'start' | 'gap') => {
      reads.push(after);
      if (after === 'gap') await new Promise<void>(resolve => (release = resolve));
    });
    const runtime = new DeliveryRuntime({
      conduitId: r.conduitId, clientId: CLIENT_ID, broadcasterId: BROADCASTER.id, readerId: READER.id,
      admin: new EventSubAdmin(r.helix.session), authority: r.authority, source: r.source, socketFactory: r.eventsub.socketFactory,
      url: FAKE_EVENTSUB_URL, random: () => 0.5, settleMs: 20, reconcile,
    });
    cleanups.push(async () => runtime.stop());
    await runtime.start();
    await r.until(() => r.source.available);
    r.live();
    r.say(PEOPLE.juniper, 'simulated-message-1');
    await r.settle();
    const before = r.unavailable;
    const old = r.socket();
    r.eventsub.autoWelcome = false;
    r.eventsub.reconnect(old);
    const next = r.socket();
    r.eventsub.drop(old, 4004);
    await vi.advanceTimersByTimeAsync(0);
    expect(r.source.available).toBe(false);
    expect(r.unavailable).toBe(before + 1);
    expect(runtime.health()).toMatchObject({ covered: false, gaps: { count: 0 }, shard: { lastDetachReason: 'handover_gap' } });
    expect(runtime.health().gaps.openSince).not.toBeNull();
    await r.settle(2_000);
    r.eventsub.welcome(next);
    await r.until(() => runtime.covered);
    expect(runtime.health().gaps.count).toBe(1);
    expect(runtime.health().gaps.last!.to - runtime.health().gaps.last!.from).toBeGreaterThanOrEqual(2_000);
    // Attached again, but the state the gap may have hidden is read before anything is published.
    expect(reads).toEqual(['start', 'gap']);
    expect(r.source.available).toBe(false);
    release();
    await r.until(() => r.source.available);
    expect(r.source.current?.frame.streamLive).toBe(true);
    expect(r.fake.count('POST', 'api.twitch.tv/helix/eventsub/subscriptions')).toBe(8);
  });

  it('a silent link is ordinary loss: the watchdog detaches and a fresh session is attached', async () => {
    const r = await started();
    const silent = r.socket();
    silent.silent = true;
    await r.settle(10_000 + 3_000 + 100);
    expect(r.source.available).toBe(false);
    expect(r.runtime.health().shard.lastDetachReason).toBe('keepalive_timeout');
    await r.until(() => r.runtime.covered);
    expect(silent.closed).toBe(true);
    expect(r.eventsub.openSockets).toHaveLength(1);
  });

  it('a shard Twitch reports disabled while we think it attached is repaired on the next check', async () => {
    const r = await started();
    r.eventsub.shard(r.conduitId)!.status = 'websocket_failed_ping_pong';
    await r.runtime.verify();
    expect(r.source.available).toBe(false);
    await r.until(() => r.runtime.covered);
    expect(r.eventsub.shard(r.conduitId)!.status).toBe('enabled');
  });

  it('reader revocation stops delivery until Twitch shows the grant gone and then a fresh one', async () => {
    const r = await started();
    r.live();
    r.say(PEOPLE.juniper, 'simulated-message-1');
    await r.settle();
    r.eventsub.revokeAuthorization(READER.id, READER.login);
    await r.settle();
    expect(r.source.available).toBe(false);
    expect(r.runtime.health().ingest.counters.authorizationRevokes).toBe(1);
    expect(r.runtime.health().coverage.find(entry => entry.type === 'channel.chat.message')!.state).not.toBe('enabled');
    await r.settle(1_000);
    expect(r.source.available).toBe(false);
    // A fresh grant: once Get Authorization By User shows it, the subscriptions are recreated.
    r.fake.consent(READER.id, READER_SCOPES, 'http://localhost:5195/herald/callback');
    await r.authority.refresh();
    await r.until(() => r.runtime.covered);
    expect(r.source.available).toBe(true);
  });

  it('a configured conduit that is gone stops cleanly: no sockets, no retries, nothing published', async () => {
    const r = await rig({ conduit: 'missing' });
    expect(await r.runtime.start()).toBe('missing');
    await r.settle(120_000);
    expect(r.eventsub.sockets).toHaveLength(0);
    expect(r.source.available).toBe(false);
    expect(r.fake.count('POST', 'api.twitch.tv/helix/eventsub/conduits')).toBe(0);
  });

  it('a conduit whose other shards are in use is not run as a single shard', async () => {
    const r = await rig();
    const shards = r.eventsub.conduits.get(r.conduitId)!;
    shards.push({ id: '1', status: 'enabled', sessionId: 'simulated-session-elsewhere' });
    expect(await r.runtime.start()).toBe('wrong_shape');
    expect(r.eventsub.sockets).toHaveLength(0);
    expect(r.source.available).toBe(false);
  });

  it('stop closes its socket, clears its timers and leaves the source unavailable', async () => {
    const r = await started();
    r.live();
    r.say(PEOPLE.juniper, 'simulated-message-1');
    await r.settle();
    r.runtime.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.eventsub.openSockets).toHaveLength(0);
    expect(r.source.available).toBe(true);
    // The runtime no longer drives availability once stopped; the live host closes the source next.
    await r.stopAll();
    expect(r.source.available).toBe(false);
    expect(r.runtime.health().ingest.pending).toBe(0);
  });
});

describe('provision:source', () => {
  function provisionRig(options: { grants?: Record<string, readonly string[]>; conduitLimit?: number } = {}) {
    const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: SECRET, users: [BROADCASTER, READER], grants: options.grants ?? FULL_GRANTS });
    const eventsub = new FakeEventSub(fake, options.conduitLimit === undefined ? {} : { conduitLimit: options.conduitLimit });
    const lines: string[] = [];
    const recorded: string[] = [];
    const run = (conduitId: string | null, create: boolean) => provisionSource({
      config: config({ conduitId }), createDevelopmentConduit: create, print: line => lines.push(line), fetch: fake.fetch,
      socketFactory: eventsub.socketFactory, eventSubUrl: FAKE_EVENTSUB_URL, attachTimeoutMs: 5_000,
      recordConduit: async (_file, id) => void recorded.push(id),
    });
    return { fake, eventsub, lines, recorded, run };
  }

  it('without a configured conduit or the explicit flag, creates nothing', async () => {
    const p = provisionRig();
    const outcome = await p.run(null, false);
    expect(outcome.status).toBe('no_conduit');
    expect(p.fake.count('POST', 'api.twitch.tv/helix/eventsub/conduits')).toBe(0);
    expect(p.lines.join('\n')).toMatch(/--create-development-conduit/);
  });

  it('creates one development conduit when asked, records it, attaches shard 0 and reconciles the eight', async () => {
    vi.useRealTimers();
    const p = provisionRig();
    const first = await p.run(null, true);
    expect(first).toMatchObject({ status: 'complete', created: true });
    expect(p.recorded).toEqual([first.conduitId]);
    expect(p.fake.count('POST', 'api.twitch.tv/helix/eventsub/conduits')).toBe(1);
    expect(p.eventsub.subscriptions).toHaveLength(8);
    expect(p.eventsub.openSockets).toHaveLength(0);
    // Running again reuses the configured conduit and changes nothing.
    const again = await p.run(first.conduitId, true);
    expect(again).toMatchObject({ status: 'complete', created: false, conduitId: first.conduitId });
    expect(p.fake.count('POST', 'api.twitch.tv/helix/eventsub/conduits')).toBe(1);
    expect(p.fake.count('POST', 'api.twitch.tv/helix/eventsub/subscriptions')).toBe(8);
    expect(p.fake.count('GET', 'api.twitch.tv/helix/eventsub/conduits')).toBe(0);
  });

  it('reports missing grants by name and leaves chat uncreated', async () => {
    vi.useRealTimers();
    const p = provisionRig({ grants: {} });
    const conduitId = p.eventsub.addConduit(3);
    const outcome = await p.run(conduitId, false);
    expect(outcome.status).toBe('incomplete');
    expect(p.eventsub.conduits.get(conduitId)).toHaveLength(1);
    expect(outcome.coverage.filter(entry => entry.state === 'enabled').map(entry => entry.type).sort()).toEqual(['stream.offline', 'stream.online', 'user.authorization.revoke']);
    expect(p.lines.join('\n')).toMatch(/channel\.chat\.message\s+not created: its grant is not verified \(run check:auth\)/);
  });

  it('a configured conduit that is gone is reported, never silently replaced', async () => {
    const p = provisionRig();
    const outcome = await p.run('simulated-conduit-gone', false);
    expect(outcome.status).toBe('conduit_missing');
    expect(p.fake.count('POST', 'api.twitch.tv/helix/eventsub/conduits')).toBe(0);
    expect(p.lines.join('\n')).toMatch(/72 hours/);
  });

  it('at the conduit limit nothing is created or changed', async () => {
    const p = provisionRig({ conduitLimit: 0 });
    const outcome = await p.run(null, true);
    expect(outcome.status).toBe('conduit_limit');
    expect(p.recorded).toEqual([]);
    expect(p.fake.count('POST', 'api.twitch.tv/helix/eventsub/conduits')).toBe(1);
  });

  it('records the conduit ID in the settings file, replacing an older one and keeping it owner-only', async () => {
    vi.useRealTimers();
    const dir = await mkdtemp(join(tmpdir(), 'herald-settings-'));
    try {
      const file = join(dir, 'herald.env');
      await writeFile(file, 'HERALD_CHANNEL_LOGIN=tobi4s_\nHERALD_CONDUIT_ID=simulated-old\nHERALD_DATA_DIR=/simulated\n');
      await recordConduitId(file, 'simulated-new');
      expect(await readFile(file, 'utf8')).toBe('HERALD_CHANNEL_LOGIN=tobi4s_\nHERALD_DATA_DIR=/simulated\nHERALD_CONDUIT_ID=simulated-new\n');
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('TtlMap', () => {
  it('expires by age and evicts the oldest at capacity, counting evictions', () => {
    const map = new TtlMap<string, number>(1_000, 2);
    map.set('a', 1, 0);
    map.set('b', 2, 100);
    map.set('c', 3, 200);
    expect(map.evicted).toBe(1);
    expect(map.has('a', 300)).toBe(false);
    expect(map.get('b', 300)).toBe(2);
    expect(map.has('b', 1_100)).toBe(false);
    expect(map.has('c', 1_100)).toBe(true);
    expect(map.size).toBe(1);
  });
});
