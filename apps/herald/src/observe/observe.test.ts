import { KingdomIdSchema, PRESENCE_LEASE_MS, STREAM_LEASE_MS, type KingdomPresenceFrame } from '@chatdom/shared';
import { AppTokenSession, EventSubAdmin, HelixReader, Secret, TwitchRequestError, type HelixChattersPage } from '@chatdom/twitch';
import { FAKE_EVENTSUB_URL, FakeEventSub, FakeTwitch } from '@chatdom/twitch/testing';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeraldAuthority, inspectAuthorization } from '../auth/authority';
import type { Capability } from '../auth/grants';
import type { HeraldConfig } from '../config';
import { DeliveryRuntime } from '../ingest/runtime';
import { FileBindingStore, MemoryBindingStore, type BindingStore } from '../source/bindings';
import { presentKingdom } from '../source/kingdom';
import { PresenceSource } from '../source/source';
import { formatObserveProbe } from '../cli/report';
import { sweepChatters } from './chatters';
import { probeObservedState } from './probe';
import { Reconciler } from './reconcile';
import { HELIX_LAG_MS, StreamTracker } from './stream';

const CLIENT_ID = 'simulatedclient0000000000000001';
const SECRET = 'simulated-client-secret-value-0001';
const BROADCASTER = { id: '129634568', login: 'tobi4s_', displayName: 'tobi4s_' };
const READER = { id: '900000001', login: 'herald_reader', displayName: 'HeraldReader' };
const FULL_GRANTS = { [READER.id]: ['user:read:chat', 'user:bot'], [BROADCASTER.id]: ['channel:bot', 'moderator:read:chatters'] };
const KINGDOM = KingdomIdSchema.parse(BROADCASTER.id);
const SLOTS = presentKingdom({ seed: 'tobi4s_', tier: 'hamlet', firstYear: 2026, year: 2026 }).slots;
const T0 = Date.UTC(2026, 9, 30, 20, 0, 0);
/** SIMULATED quiet people: Chatters IDs only, never a name. */
const quiet = (count: number, base = 7_100_000_000) => Array.from({ length: count }, (_, index) => String(base + index));

const temporary: string[] = [];
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

function config(overrides: Partial<HeraldConfig> = {}): HeraldConfig {
  return {
    channelLogin: BROADCASTER.login, channelLoginDefaulted: false, readerLogin: READER.login, redirectUri: null,
    credentials: { clientId: CLIENT_ID, clientSecret: new Secret(SECRET) }, conduitId: null, problems: [],
    dataDir: '/simulated/data', kingdom: { seed: 'tobi4s_', tier: 'hamlet', firstYear: 2026, year: 2026 },
    port: 5194, secretsFile: '/simulated/atlas.env', settingsFile: '/simulated/herald.env', ...overrides,
  };
}

/** An authority whose capabilities the test sets directly. */
function fixedAuthority(capabilities: readonly Capability[] = ['stream', 'chatters']) {
  const granted = new Set(capabilities);
  let refreshes = 0;
  return {
    granted,
    available: (capability: Capability) => granted.has(capability),
    refresh: () => {
      refreshes++;
      return Promise.resolve();
    },
    get refreshes() {
      return refreshes;
    },
  };
}

/** A SIMULATED Twitch with a live channel, a fixed clock and a live-origin source fed by a reconciler. */
async function rig(options: { store?: BindingStore; capabilities?: readonly Capability[]; chatters?: readonly string[]; streaming?: boolean } = {}) {
  let clock = T0;
  const now = () => clock;
  const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: SECRET, users: [BROADCASTER, READER], grants: FULL_GRANTS, now });
  if (options.streaming ?? true) fake.streams.set(BROADCASTER.id, { id: '41000000001', type: 'live', startedAt: new Date(T0 - 3_600_000).toISOString() });
  fake.chatters.set(BROADCASTER.id, options.chatters ?? quiet(5));
  const tokens = new AppTokenSession({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), fetch: fake.fetch, now });
  const helix = new HelixReader({ tokens, fetch: fake.fetch, now });
  const source = new PresenceSource({ kingdomId: KINGDOM, origin: 'live', slots: SLOTS, store: options.store ?? new MemoryBindingStore(), now, tickMs: 0 });
  await source.open();
  source.setAvailable(true);
  const frames: KingdomPresenceFrame[] = [];
  const wire: string[] = [];
  source.subscribe({ frame: frame => { frames.push(frame.frame); wire.push(frame.data); }, unavailable: () => undefined });
  const authority = fixedAuthority(options.capabilities);
  const log: string[] = [];
  const reconciler = new Reconciler({ kingdomId: KINGDOM, helix, authority, source, now, everyMs: 0, log: line => log.push(line) });
  cleanups.push(async () => {
    reconciler.stop();
    tokens.close();
    await source.close();
  });
  return {
    fake, helix, source, frames, wire, authority, reconciler, log,
    advance(ms: number) {
      clock += ms;
      source.tick();
      return clock;
    },
    get now() {
      return clock;
    },
    frame: () => source.current!.frame,
    lit: () => source.current!.frame.windows.filter(window => window.present),
  };
}

describe('Get Streams and Get Chatters reads', () => {
  it('keep only the broadcast and the user IDs: no title, viewer count, login or name', async () => {
    const r = await rig({ chatters: ['7100000001', '7100000002'] });
    const streams = await r.helix.getStreams([BROADCASTER.id]);
    expect(streams).toEqual([{ id: '41000000001', userId: BROADCASTER.id, type: 'live', startedAt: T0 - 3_600_000 }]);
    const page = await r.helix.getChattersPage({ broadcasterId: BROADCASTER.id, moderatorId: BROADCASTER.id });
    expect(page).toEqual({ userIds: ['7100000001', '7100000002'], cursor: null });
    expect(JSON.stringify([streams, page])).not.toMatch(/SIMULATED title|viewer|4321|simulated_|Simulated71/);
  });

  it('Chatters with an app token needs the broadcaster\'s recorded grant', async () => {
    const r = await rig();
    r.fake.revokeGrant(BROADCASTER.id);
    await expect(r.helix.getChattersPage({ broadcasterId: BROADCASTER.id, moderatorId: BROADCASTER.id })).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});

describe('Chatters sweep', () => {
  it('follows cursors to the last page and deduplicates people the list shifted between pages', async () => {
    const pages: HelixChattersPage[] = [
      { userIds: ['1', '2', '3'], cursor: 'a' }, { userIds: ['3', '4'], cursor: 'b' }, { userIds: ['4', '5'], cursor: null },
    ];
    let calls = 0;
    const result = await sweepChatters({ helix: { getChattersPage: () => Promise.resolve(pages[calls++]!) }, broadcasterId: BROADCASTER.id, now: () => T0 });
    expect(result).toMatchObject({ end: 'complete', pages: 3, ids: ['1', '2', '3', '4', '5'], duplicates: 2, startedAt: T0, failure: null });
  });

  it('a cursor seen before, a failed page, the page cap and the deadline all end partial', async () => {
    const r = await rig({ chatters: quiet(25) });
    r.fake.chattersRepeatCursorAt = 1;
    const repeated = await sweepChatters({ helix: r.helix, broadcasterId: BROADCASTER.id, pageSize: 10, now: () => r.now });
    expect(repeated).toMatchObject({ end: 'repeated_cursor', pages: 2, ids: quiet(20) });
    r.fake.chattersRepeatCursorAt = null;

    let calls = 0;
    const failing = await sweepChatters({
      helix: { getChattersPage: (query, callOptions) => (calls++ === 0 ? r.helix.getChattersPage(query, callOptions) : Promise.reject(new TwitchRequestError('provider', 'get chatters', 500))) },
      broadcasterId: BROADCASTER.id, pageSize: 10, now: () => r.now,
    });
    expect(failing).toMatchObject({ end: 'page_failed', failure: 'provider', pages: 1, ids: quiet(10) });

    const capped = await sweepChatters({ helix: r.helix, broadcasterId: BROADCASTER.id, pageSize: 5, pageLimit: 3, now: () => r.now });
    expect(capped).toMatchObject({ end: 'page_limit', pages: 3, ids: quiet(15) });

    let clock = T0;
    const slow = await sweepChatters({
      helix: { getChattersPage: () => { clock += 20_000; return Promise.resolve({ userIds: ['1'], cursor: `c${clock}` }); } },
      broadcasterId: BROADCASTER.id, now: () => clock,
    });
    expect(slow).toMatchObject({ end: 'deadline', pages: 3 });
  });

  // 50,000 identities through the real reducer: allow for a busy machine, not a slow design.
  it('50,000 connected identities complete in 50 pages and leave the frame within its cap, all unnamed', { timeout: 30_000 }, async () => {
    const everyone = quiet(50_000);
    const r = await rig({ chatters: everyone });
    await r.reconciler.start();
    const health = r.reconciler.health();
    expect(health.chatters).toMatchObject({ condition: 'complete', last: { pages: 50, people: 50_000, end: 'complete', applied: 'applied' } });
    const frame = r.frame();
    expect(frame.windows.length).toBe(SLOTS.length);
    expect(frame.windows.every(window => window.present && window.publicName === null)).toBe(true);
    expect(r.source.health().capacity).toMatchObject({ bound: SLOTS.length, free: 0, unplaced: 50_000 - SLOTS.length });
    expect(r.wire.at(-1)!.length).toBeLessThan(4_096);
    expect(r.wire.join('')).not.toMatch(/71000\d{5}/);
  });
});

describe('stream state', () => {
  function tracker() {
    let clock = T0;
    const submitted: unknown[] = [];
    const source = { origin: 'live' as const, submit: (input: unknown) => (submitted.push(input), Promise.resolve('applied' as const)) } as unknown as PresenceSource;
    const t = new StreamTracker({ kingdomId: KINGDOM, source, now: () => clock });
    return { t, submitted, at: (ms: number) => (clock = T0 + ms) };
  }
  const listed = (id: string, type = 'live') => [{ id, userId: BROADCASTER.id, type, startedAt: T0 }];

  it('startup: live, an empty answer and a failure are live, offline and unknown, never confused', () => {
    const live = tracker();
    expect(live.t.polled(listed('1'), T0, 'startup')?.outcome).toBe('live');
    expect(live.t.health()).toMatchObject({ condition: 'live', via: 'helix', fresh: true });
    const offline = tracker();
    expect(offline.t.polled([], T0, 'startup')?.outcome).toBe('offline');
    expect(offline.t.health()).toMatchObject({ condition: 'offline', fresh: true });
    const unknown = tracker();
    expect(unknown.t.polled(null, T0, 'startup')?.outcome).toBe('unknown');
    expect(unknown.t.health()).toMatchObject({ condition: 'unknown', observedAt: null, fresh: false, consecutiveFailures: 1 });
    expect(unknown.submitted).toEqual([]);
  });

  it('a non-live entry (rerun, error) wakes nothing', () => {
    const s = tracker();
    expect(s.t.polled(listed('1', ''), T0, 'minute')?.outcome).toBe('unknown');
    expect(s.submitted).toEqual([]);
    expect(s.t.health().counters.notLive).toBe(1);
  });

  it('a failed request keeps the last observation and its time; it ages out instead of guessing', () => {
    const s = tracker();
    s.t.polled(listed('1'), T0, 'startup');
    s.at(60_000);
    s.t.polled(null, T0 + 60_000, 'minute');
    expect(s.t.health()).toMatchObject({ condition: 'live', observedAt: T0, fresh: true });
    s.at(STREAM_LEASE_MS);
    expect(s.t.live).toBe(false);
    expect(s.t.health().fresh).toBe(false);
  });

  it('a cached answer cannot undo a newer pushed change', () => {
    const s = tracker();
    s.t.push({ kind: 'stream', at: T0, live: true, streamId: '2' });
    s.at(30_000);
    expect(s.t.polled([], T0 + 30_000, 'minute')?.outcome).toBe('lagging');
    s.t.push({ kind: 'stream', at: T0 + 40_000, live: false });
    s.at(70_000);
    expect(s.t.polled(listed('2'), T0 + 70_000, 'minute')?.outcome).toBe('lagging');
    s.at(40_000 + HELIX_LAG_MS + 1);
    // The ended broadcast stays ended even once the lag window has passed.
    expect(s.t.polled(listed('2'), T0 + 40_000 + HELIX_LAG_MS + 1, 'minute')?.outcome).toBe('lagging');
    expect(s.t.polled(listed('3'), T0 + 40_000 + HELIX_LAG_MS + 1, 'minute')?.outcome).toBe('live');
    expect(s.t.health()).toMatchObject({ condition: 'live', counters: { lagging: 3, pushed: 2 } });
  });

  it('an empty answer well after a pushed online means the offline notice was missed', () => {
    const s = tracker();
    s.t.push({ kind: 'stream', at: T0, live: true, streamId: '2' });
    s.at(HELIX_LAG_MS + 1);
    expect(s.t.polled([], T0 + HELIX_LAG_MS + 1, 'minute')?.outcome).toBe('offline');
  });

  it('a late answer older than the state held is not adopted', () => {
    const s = tracker();
    s.t.push({ kind: 'stream', at: T0 + 10_000, live: false });
    s.at(HELIX_LAG_MS + 20_000);
    s.t.polled(listed('9'), T0 + 5_000, 'minute');
    expect(s.t.health()).toMatchObject({ condition: 'offline', observedAt: T0 + 10_000 });
  });
});

describe('reconciler with the source', () => {
  it('startup reads stream state, then lights quiet people unnamed with no identity on the wire', async () => {
    const r = await rig({ chatters: quiet(3) });
    await r.reconciler.start();
    expect(r.frame()).toMatchObject({ streamLive: true, connection: 'fresh', origin: 'live' });
    expect(r.lit().map(window => window.publicName)).toEqual([null, null, null]);
    expect(r.wire.join('')).not.toMatch(/7100000000|7100000001|7100000002|41000000001/);
    expect(r.log.join('\n')).toMatch(/stream live \(startup\)/);
    expect(r.log.join('\n')).toMatch(/chatters sweep complete, 3 connected in 1 page/);
    expect(r.log.join('\n')).not.toMatch(/71000000|41000000001/);
  });

  it('offline: the beacon rests, nobody is swept, and minute polls keep the rest fresh rather than stale', async () => {
    const r = await rig({ streaming: false });
    await r.reconciler.start();
    expect(r.frame()).toMatchObject({ streamLive: false, connection: 'offline' });
    expect(r.fake.count('GET', 'api.twitch.tv/helix/chat/chatters')).toBe(0);
    expect(r.reconciler.health().chatters.condition).toBe('waiting_for_live');
    for (let minute = 0; minute < 5; minute++) {
      r.advance(60_000);
      await r.reconciler.minute();
    }
    expect(r.frame()).toMatchObject({ connection: 'offline' });
  });

  it('when Get Streams keeps failing, the kingdom goes stale instead of guessing live or offline', async () => {
    const r = await rig({ chatters: quiet(2) });
    await r.reconciler.start();
    r.fake.fail('GET', 'api.twitch.tv/helix/streams', 503, 10);
    for (let minute = 0; minute < 3; minute++) {
      r.advance(60_000);
      await r.reconciler.minute();
    }
    expect(r.frame()).toMatchObject({ streamLive: false, connection: 'stale' });
    expect(r.lit()).toEqual([]);
    expect(r.reconciler.health().stream).toMatchObject({ condition: 'live', observedAt: T0, fresh: false, consecutiveFailures: 3 });
    expect(r.reconciler.health().chatters.condition).toBe('waiting_for_live');
  });

  it('a partial sweep keeps earlier lights; only a complete one records departures', async () => {
    const r = await rig({ chatters: quiet(6) });
    await r.reconciler.start();
    expect(r.lit()).toHaveLength(6);
    // The list now holds only the first two, but the second page fails (and a 429 past the deadline fails too).
    r.fake.chatters.set(BROADCASTER.id, quiet(2));
    const pageSize = { pageSize: 1 };
    const partial = new Reconciler({ kingdomId: KINGDOM, helix: r.helix, authority: r.authority, source: r.source, now: () => r.now, everyMs: 0, sweep: pageSize });
    cleanups.push(() => partial.stop());
    r.advance(60_000);
    // Twitch asks us to wait past the sweep's deadline: the sweep ends rather than outwait it.
    r.fake.fail('GET', 'api.twitch.tv/helix/chat/chatters', 429, 1, { 'ratelimit-reset': String(Math.floor(r.now / 1000) + 50) });
    await partial.start();
    expect(partial.health().chatters).toMatchObject({ condition: 'failed', last: { end: 'page_failed', failure: 'rate_limited', applied: 'not_submitted' } });
    expect(r.lit()).toHaveLength(6);
    r.advance(1_000);
    let calls = 0;
    const halfway = new Reconciler({
      kingdomId: KINGDOM, authority: r.authority, source: r.source, now: () => r.now, everyMs: 0, sweep: pageSize,
      helix: { getStreams: (...args) => r.helix.getStreams(...args), getChattersPage: (query, callOptions) => (calls++ === 0 ? r.helix.getChattersPage(query, callOptions) : Promise.reject(new TwitchRequestError('provider', 'get chatters', 502))) },
    });
    cleanups.push(() => halfway.stop());
    await halfway.start();
    expect(halfway.health().chatters).toMatchObject({ condition: 'partial', last: { people: 1, applied: 'applied' } });
    expect(r.lit()).toHaveLength(6);
    r.advance(1_000);
    await r.reconciler.minute();
    expect(r.reconciler.health().chatters.condition).toBe('complete');
    expect(r.lit()).toHaveLength(2);
  });

  it('evidence expires through the reducer when sweeps stop', async () => {
    const r = await rig({ chatters: quiet(3) });
    await r.reconciler.start();
    r.fake.fail('GET', 'api.twitch.tv/helix/chat/chatters', 500, 10);
    r.advance(60_000);
    await r.reconciler.minute();
    expect(r.lit()).toHaveLength(3);
    r.advance(PRESENCE_LEASE_MS - 60_000);
    expect(r.lit()).toHaveLength(0);
    expect(r.frame().connection).toBe('fresh');
  });

  it('without the broadcaster\'s Chatters grant nothing is swept and Twitch is never asked', async () => {
    const r = await rig({ capabilities: ['stream'] });
    await r.reconciler.start();
    expect(r.frame()).toMatchObject({ streamLive: true });
    expect(r.lit()).toEqual([]);
    expect(r.fake.count('GET', 'api.twitch.tv/helix/chat/chatters')).toBe(0);
    expect(r.reconciler.health().chatters.condition).toBe('unauthorized');
  });

  it('a refused sweep asks the authority to recheck the grant', async () => {
    const r = await rig();
    r.fake.revokeGrant(BROADCASTER.id);
    await r.reconciler.start();
    expect(r.reconciler.health().chatters.last).toMatchObject({ end: 'page_failed', failure: 'unauthorized' });
    expect(r.authority.refreshes).toBeGreaterThan(0);
  });

  it('a minute arriving while a sweep still runs is skipped, never queued', async () => {
    const r = await rig();
    let release: () => void = () => undefined;
    const held = new Promise<void>(resolve => (release = resolve));
    let entered = 0;
    const slow = new Reconciler({
      kingdomId: KINGDOM, authority: r.authority, source: r.source, now: () => r.now, everyMs: 0,
      helix: {
        getStreams: (...args) => r.helix.getStreams(...args),
        getChattersPage: async (...args) => {
          entered++;
          await held;
          return r.helix.getChattersPage(...args);
        },
      },
    });
    cleanups.push(() => slow.stop());
    const first = slow.start();
    await vi.waitFor(() => expect(entered).toBe(1));
    const skipped = [slow.minute(), slow.minute()];
    release();
    await Promise.all([first, ...skipped]);
    expect(slow.health().chatters.counters).toMatchObject({ sweeps: 1, overlapSkipped: 2 });
    expect(r.fake.count('GET', 'api.twitch.tv/helix/streams')).toBe(1);
  });

  it('quiet people keep their windows across a restart, whatever order Twitch lists them in', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'herald-observe-'));
    temporary.push(dir);
    const store = () => new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM, repositoryRoot: null });
    const first = await rig({ store: store(), chatters: quiet(4) });
    await first.reconciler.start();
    const before = first.lit().map(window => window.slot);
    await cleanups.shift()!();
    const second = await rig({ store: store(), chatters: [...quiet(4)].reverse() });
    await second.reconciler.start();
    expect(second.lit().map(window => window.slot)).toEqual(before);
    const table = await readFile(join(dir, 'presence', `${KINGDOM}.json`), 'utf8');
    expect(table).not.toMatch(/simulated_|Simulated71/);
  });
});

describe('delivery resumes only after reconciling', () => {
  it('after a gap Get Streams is read again before the source publishes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(T0);
    const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: SECRET, users: [BROADCASTER, READER], grants: FULL_GRANTS });
    fake.streams.set(BROADCASTER.id, { id: '41000000001', type: 'live', startedAt: new Date(T0 - 60_000).toISOString() });
    fake.chatters.set(BROADCASTER.id, quiet(2));
    const eventsub = new FakeEventSub(fake, { keepaliveSeconds: 10 });
    const conduitId = eventsub.addConduit(1);
    const tokens = new AppTokenSession({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), fetch: fake.fetch });
    const helix = new HelixReader({ tokens, fetch: fake.fetch });
    const authority = new HeraldAuthority({ config: config({ conduitId }), tokens, helix });
    await authority.start();
    const source = new PresenceSource({ kingdomId: KINGDOM, origin: 'live', slots: SLOTS, store: new MemoryBindingStore(), tickMs: 0 });
    await source.open();
    const reconciler = new Reconciler({ kingdomId: KINGDOM, helix, authority, source, everyMs: 0 });
    const startup = reconciler.start();
    const log: string[] = [];
    const runtime = new DeliveryRuntime({
      conduitId, clientId: CLIENT_ID, broadcasterId: BROADCASTER.id, readerId: READER.id,
      admin: new EventSubAdmin(helix.session), authority, source, socketFactory: eventsub.socketFactory, url: FAKE_EVENTSUB_URL,
      random: () => 0.5, settleMs: 20, log: line => log.push(line),
      stream: observation => reconciler.tracker.push(observation), reconcile: after => (after === 'start' ? startup : reconciler.afterGap()),
    });
    cleanups.push(async () => {
      runtime.stop();
      reconciler.stop();
      authority.stop();
      tokens.close();
      await source.close();
    });
    await runtime.start();
    await vi.waitFor(() => expect(source.available).toBe(true), { timeout: 5_000, interval: 25 });
    expect(source.current!.frame).toMatchObject({ streamLive: true, connection: 'fresh' });
    expect(source.current!.frame.windows.filter(window => window.present)).toHaveLength(2);

    // The broadcast ends while delivery is down: no stream.offline reaches us.
    eventsub.drop(eventsub.openSockets.at(-1)!);
    await vi.advanceTimersByTimeAsync(0);
    expect(source.available).toBe(false);
    fake.streams.delete(BROADCASTER.id);
    const polls = fake.count('GET', 'api.twitch.tv/helix/streams');
    await vi.advanceTimersByTimeAsync(HELIX_LAG_MS);
    await vi.waitFor(() => expect(source.available).toBe(true), { timeout: 5_000, interval: 25 });
    expect(fake.count('GET', 'api.twitch.tv/helix/streams')).toBe(polls + 1);
    // The first frame after the gap already says offline: the source never republished the old LIVE state.
    expect(source.current!.frame).toMatchObject({ streamLive: false, connection: 'offline' });
    expect(reconciler.health().stream).toMatchObject({ condition: 'offline', recovered: true });
    expect(log.join('\n')).toMatch(/reconciling stream state before publishing/);
  });
});

describe('check:auth --observe', () => {
  async function probe(options: { grants?: Record<string, readonly string[]>; streaming?: 'live' | 'rerun' | null; chatters?: readonly string[] } = {}) {
    const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: SECRET, users: [BROADCASTER, READER], grants: options.grants ?? FULL_GRANTS });
    if (options.streaming) fake.streams.set(BROADCASTER.id, { id: '41000000001', type: options.streaming, startedAt: new Date(T0 - 60_000).toISOString() });
    fake.chatters.set(BROADCASTER.id, options.chatters ?? quiet(2_345));
    const tokens = new AppTokenSession({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), fetch: fake.fetch });
    cleanups.push(() => tokens.close());
    const helix = new HelixReader({ tokens, fetch: fake.fetch });
    const report = await inspectAuthorization({ config: config(), tokens, helix });
    return { fake, result: await probeObservedState({ report, helix }) };
  }

  it('reads the stream once and sweeps Chatters completely, reporting counts and never an ID', async () => {
    const { fake, result } = await probe({ streaming: 'live' });
    expect(result!.stream).toEqual({ state: 'live', startedAt: T0 - 60_000 });
    expect(result!.chatters).toMatchObject({ state: 'swept', end: 'complete', pages: 3, connected: 2_345, duplicates: 0, failure: null });
    expect(fake.count('GET', 'api.twitch.tv/helix/chat/chatters')).toBe(3);
    const text = [JSON.stringify(result), ...formatObserveProbe(result)].join('\n');
    expect(text).not.toMatch(/7100000\d{3}/);
    expect(formatObserveProbe(result).join('\n')).toMatch(/chatters {2}complete · 3 pages · 2345 connected/);
  });

  it('sweeps while offline too (it publishes nothing), and never calls a rerun live', async () => {
    const offline = await probe({ streaming: null, chatters: quiet(1) });
    expect(offline.result!.stream).toEqual({ state: 'offline', startedAt: null });
    expect(offline.result!.chatters).toMatchObject({ end: 'complete', pages: 1, connected: 1 });
    const rerun = await probe({ streaming: 'rerun' });
    expect(rerun.result!.stream.state).toBe('not_live');
    expect(formatObserveProbe(rerun.result).join('\n')).toMatch(/listed but not live/);
  });

  it('without the broadcaster grant it never asks Twitch for Chatters', async () => {
    const { fake, result } = await probe({ grants: { [READER.id]: FULL_GRANTS[READER.id]! } });
    expect(result!.chatters).toEqual({ state: 'skipped', reason: 'capability_unavailable' });
    expect(result!.stream.state).toBe('offline');
    expect(fake.count('GET', 'api.twitch.tv/helix/chat/chatters')).toBe(0);
  });
});
