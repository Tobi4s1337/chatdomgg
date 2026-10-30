import { KingdomIdSchema, type KingdomPresenceFrame } from '@chatdom/shared';
import { Secret } from '@chatdom/twitch';
import { FAKE_EVENTSUB_URL, FakeEventSub, FakeTwitch, type FakeSocket } from '@chatdom/twitch/testing';
import { request } from 'node:http';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeraldConfig } from '../config';
import { openStream, type StreamReader } from '../source/check';
import { presentKingdom } from '../source/kingdom';
import { startLiveSource, type LiveSourceHandle } from '../source/live';
import { HEALTH_PATH, STREAM_PATH } from '../source/server';

/*
 * Acceptance for the whole `dev` composition: the same startLiveSource the real channel runs, with Twitch
 * replaced by SIMULATED local fakes (Helix over an in-process fetch, EventSub over in-process sockets) and
 * everything else real: the authority, conduit shard, subscriptions, ingest, reconciler, durable binding
 * table on disk, the loopback SSE server and an HTTP reader that sees exactly what a browser sees.
 */

const CLIENT_ID = 'simulatedclient0000000000000001';
const SECRET = 'simulated-client-secret-value-0001';
const BROADCASTER = { id: '129634568', login: 'tobi4s_', displayName: 'tobi4s_' };
const READER = { id: '900000001', login: 'herald_reader', displayName: 'HeraldReader' };
const READER_SCOPES = ['user:read:chat', 'user:bot'];
const BROADCASTER_SCOPES = ['channel:bot', 'moderator:read:chatters'];
const FULL_GRANTS = { [READER.id]: READER_SCOPES, [BROADCASTER.id]: BROADCASTER_SCOPES };
const KINGDOM = KingdomIdSchema.parse(BROADCASTER.id);
/** A grown town: 1,296 homes, so 50,000 connected people really do exhaust the layout. */
const LAYOUT = { seed: 'tobi4s_', tier: 'town', firstYear: 2000, year: 2026 } as const;
const SLOTS = presentKingdom(LAYOUT).slots;
/** Synthetic chat text: the suite proves it never leaves ingest, whatever path it takes. */
const BODY = 'SIMULATED chat body that must never leave ingest';
const TALKERS = {
  juniper: { id: '777000001', name: 'Juniper' },
  rook: { id: '777000002', name: 'Rook' },
  wren: { id: '777000003', name: 'Wren' },
  hostile: { id: '777000004', name: '‮<img src=x onerror=alert(1)>Mallow' },
};
/** 50,000 SIMULATED connected identities. The talkers are among them, as real chatters are. */
const CROWD = [...Object.values(TALKERS).map(talker => talker.id), ...Array.from({ length: 50_000 - 4 }, (_, index) => String(880_000_000 + index))];
const PRIVATE_IDS = new Set([...CROWD, READER.id]);

const broadcasterFields = { broadcaster_user_id: BROADCASTER.id, broadcaster_user_login: BROADCASTER.login, broadcaster_user_name: BROADCASTER.displayName };
const iso = (at: number) => new Date(at).toISOString();

function chatEvent(person: { id: string; name: string }, messageId: string) {
  return {
    ...broadcasterFields,
    chatter_user_id: person.id, chatter_user_login: `simulated_${person.id}`, chatter_user_name: person.name,
    message_id: messageId, message: { text: BODY, fragments: [{ type: 'text', text: BODY, cheermote: null, emote: null, mention: null }] },
    color: '#00FF7F', badges: [{ set_id: 'subscriber', id: '12', info: '16' }], message_type: 'text', cheer: null, reply: null,
    channel_points_custom_reward_id: null, source_broadcaster_user_id: null, source_broadcaster_user_login: null,
    source_broadcaster_user_name: null, source_message_id: null, source_badges: null,
  };
}

interface Rig {
  readonly fake: FakeTwitch;
  readonly eventsub: FakeEventSub;
  readonly conduitId: string;
  readonly dataDir: string;
  readonly log: string[];
  readonly readers: StreamReader[];
  handle: LiveSourceHandle | null;
}

const rigs: Rig[] = [];

async function rig(options: { grants?: Record<string, readonly string[]>; live?: boolean; chatters?: readonly string[] } = {}): Promise<Rig> {
  const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: SECRET, users: [BROADCASTER, READER], grants: options.grants ?? FULL_GRANTS });
  const eventsub = new FakeEventSub(fake, { keepaliveSeconds: 10 });
  const conduitId = eventsub.addConduit(1);
  if (options.live ?? true) fake.streams.set(BROADCASTER.id, { id: '310000000001', type: 'live', startedAt: iso(Date.now() - 3_600_000) });
  fake.chatters.set(BROADCASTER.id, options.chatters ?? []);
  const dataDir = await mkdtemp(join(tmpdir(), 'herald-acceptance-'));
  const r: Rig = { fake, eventsub, conduitId, dataDir, log: [], readers: [], handle: null };
  rigs.push(r);
  return r;
}

function config(r: Rig): HeraldConfig {
  return {
    channelLogin: BROADCASTER.login, channelLoginDefaulted: false, readerLogin: READER.login, redirectUri: null,
    credentials: { clientId: CLIENT_ID, clientSecret: new Secret(SECRET) }, conduitId: r.conduitId, problems: [],
    dataDir: r.dataDir, kingdom: LAYOUT, secretsFile: '/simulated/atlas.env', settingsFile: '/simulated/herald.env',
  };
}

/** Starts the real `dev` composition against the SIMULATED Twitch. */
async function boot(r: Rig): Promise<LiveSourceHandle> {
  r.handle = await startLiveSource({
    config: config(r), print: line => r.log.push(line), port: 0,
    twitch: { fetch: r.fake.fetch, socketFactory: r.eventsub.socketFactory, eventsubUrl: FAKE_EVENTSUB_URL, random: () => 0.5 },
  });
  return r.handle;
}

/** Captured before fake timers are installed: disk writes and loopback sockets need real time to finish. */
const realSetTimeout = globalThis.setTimeout;
const realPause = (ms: number) => new Promise(resolve => realSetTimeout(resolve, ms));

/**
 * Moves the fake clock in steps, giving real I/O (binding fsyncs, loopback sockets) a real moment at each
 * step, until the predicate holds.
 */
async function until(predicate: () => boolean | Promise<boolean>, limitMs = 180_000, stepMs = 50): Promise<void> {
  for (let waited = 0; waited <= limitMs; waited += stepMs) {
    if (await predicate()) return;
    await vi.advanceTimersByTimeAsync(stepMs);
    await realPause(1);
  }
  const r = rigs.at(-1);
  if (r?.handle) process.stderr.write(`UNTIL ${JSON.stringify((await health(r)).source.counters)} ${JSON.stringify((await health(r)).source.delivery?.ingest)} ${JSON.stringify((await health(r)).source.frame)} sockets=${r.eventsub.openSockets.length} server=${JSON.stringify((await health(r)).server)} raw=${r.readers.map(x => x.raw.length)}\n${r.log.slice(-8).join('\n')}\nframes=${r.readers.map(x => x.frames.length + ':' + JSON.stringify(x.frames.at(-1)?.windows.filter(w => w.publicName)))}\n`);
  throw new Error('condition not reached');
}

/** Real I/O turns without moving the fake clock, for bytes already in flight on loopback. */
async function flush(turns = 20): Promise<void> {
  for (let turn = 0; turn < turns; turn++) await new Promise(resolve => setImmediate(resolve));
}

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

interface Health {
  readonly source: {
    readonly available: boolean; readonly condition: string; readonly reason: string | null;
    readonly frame: null | { readonly epoch: string; readonly present: number; readonly named: number; readonly streamLive: boolean; readonly connection: string };
    readonly capacity: { readonly slots: number; readonly bound: number; readonly unplaced: number };
    readonly counters: { readonly overflowed: number; readonly canceled: number; readonly capacityHits: number; readonly bindingsSaved: number };
    readonly observed?: { readonly chatters: { readonly condition: string; readonly last: null | { readonly end: string; readonly people: number; readonly pages: number } } };
    readonly delivery?: {
      readonly covered: boolean;
      readonly ingest: { readonly counters: Record<string, number> };
    };
  };
  readonly server: { readonly stalledDisconnects: number; readonly refused: number };
}

async function health(r: Rig): Promise<Health> {
  const answer = await get(r.handle!.server.port, HEALTH_PATH);
  return JSON.parse(answer.body) as Health;
}

async function stream(r: Rig, options: { readonly paused?: boolean } = {}): Promise<StreamReader> {
  const reader = await openStream(r.handle!.server.port, options);
  r.readers.push(reader);
  return reader;
}

/** The newest frame a reader holds once it satisfies the predicate. */
async function frameWhere(reader: StreamReader, predicate: (frame: KingdomPresenceFrame) => boolean, limitMs = 30_000): Promise<KingdomPresenceFrame> {
  await until(() => {
    const latest = reader.frames.at(-1);
    return latest !== undefined && predicate(latest);
  }, limitMs);
  return reader.frames.at(-1)!;
}

const present = (frame: KingdomPresenceFrame) => frame.windows.filter(window => window.present);
const named = (frame: KingdomPresenceFrame) => frame.windows.filter(window => window.publicName !== null);
const slotOf = (frame: KingdomPresenceFrame, name: string) => frame.windows.find(window => window.publicName === name)?.slot ?? null;

function socket(r: Rig): FakeSocket {
  return r.eventsub.openSockets.at(-1)!;
}

function say(r: Rig, person: { id: string; name: string }, messageId: string, meta: { messageId?: string } = {}): string[] {
  return r.eventsub.deliver('channel.chat.message', chatEvent(person, messageId), meta);
}

async function publishing(r: Rig): Promise<void> {
  try {
    await until(async () => {
      const h = await health(r);
      return h.source.available && h.source.frame !== null && h.source.frame.connection === 'fresh';
    });
  } catch (error) {
    process.stderr.write(`CALLS ${JSON.stringify(r.fake.calls.slice(0, 30))}\n`);
    process.stderr.write(`DEBUG ${JSON.stringify(await health(r))}\n${r.log.join('\n')}\n`);
    throw error;
  }
}

/** Every file under a directory, as path and text. */
async function files(dir: string): Promise<Array<{ path: string; text: string; mode: number }>> {
  const found: Array<{ path: string; text: string; mode: number }> = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    try {
      found.push({ path, text: await readFile(path, 'utf8'), mode: (await stat(path)).mode & 0o777 });
    } catch (error) {
      // A temporary file renamed, or a table erased, between listing and reading: it is simply gone.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return found;
}

/** Secrets, tokens, session IDs and chat text: none may appear in any output Herald produces. */
function secretsOf(r: Rig): string[] {
  return [SECRET, BODY, ...r.fake.issuedValues, ...r.eventsub.sockets.map(s => s.sessionId).filter((id): id is string => id !== null)];
}

/** Digit runs that are private person IDs. The kingdom ID is the broadcaster's public channel ID by contract. */
function privateIdsIn(text: string): string[] {
  return [...new Set(text.match(/\d+/g) ?? [])].filter(run => PRIVATE_IDS.has(run));
}

/** Logs, health and every SSE byte are scanned; the data directory may hold IDs only in its binding table. */
async function expectNothingPrivateEscaped(r: Rig): Promise<void> {
  const published = [r.log.join('\n'), ...r.readers.map(reader => reader.raw), r.handle ? (await get(r.handle.server.port, HEALTH_PATH)).body : ''].join('\n');
  for (const value of secretsOf(r)) expect(published).not.toContain(value);
  expect(privateIdsIn(published)).toEqual([]);
  for (const talker of Object.values(TALKERS)) expect(r.log.join('\n')).not.toContain(talker.name);
  for (const file of await files(r.dataDir)) {
    for (const value of secretsOf(r)) expect(file.text).not.toContain(value);
    for (const talker of Object.values(TALKERS)) expect(file.text).not.toContain(talker.name);
    expect(file.mode & 0o077).toBe(0);
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], shouldAdvanceTime: true });
  vi.setSystemTime(Date.UTC(2026, 9, 30, 20, 0, 0));
});

afterEach(async () => {
  for (const r of rigs.splice(0)) {
    for (const reader of r.readers) reader.close();
    await r.handle?.stop();
    await rm(r.dataDir, { recursive: true, force: true });
  }
  vi.useRealTimers();
});

describe('the dev composition under SIMULATED Twitch', { timeout: 60_000 }, () => {
  it('without the chat grants it observes the broadcast but never publishes or asks Twitch for chat', async () => {
    const r = await rig({ grants: {} });
    await boot(r);
    await until(async () => (await health(r)).source.frame?.streamLive === true);
    const h = await health(r);
    expect(h.source).toMatchObject({ available: false, reason: 'unauthorized' });
    expect((await get(r.handle!.server.port, STREAM_PATH)).status).toBe(503);
    const requested = r.eventsub.subscriptions.map(subscription => subscription.type).sort();
    expect(requested).toEqual(['stream.offline', 'stream.online', 'user.authorization.revoke']);
    expect(r.fake.count('GET', 'api.twitch.tv/helix/chat/chatters')).toBe(0);
    await expectNothingPrivateEscaped(r);
  });

  it('a live evening: one named talker among 50,000 quiet people, one bounded frame, nothing private on the wire', async () => {
    const r = await rig({ chatters: CROWD });
    await boot(r);
    await publishing(r);
    const reader = await stream(r);
    // The startup sweep fills every home in the layout with an unnamed light and reports the rest.
    const swept = await frameWhere(reader, frame => frame.streamLive && present(frame).length === SLOTS.length);
    expect(named(swept)).toEqual([]);
    let h = await health(r);
    expect(h.source.observed?.chatters).toMatchObject({ condition: 'complete', last: { end: 'complete', people: 50_000, pages: 50 } });
    expect(h.source.capacity).toMatchObject({ slots: SLOTS.length, bound: SLOTS.length, unplaced: 50_000 - SLOTS.length });
    expect(h.source.counters.capacityHits).toBeGreaterThan(0);

    // A real-shaped message from someone the sweep already placed names exactly that window.
    say(r, TALKERS.juniper, 'simulated-message-1');
    const spoken = await frameWhere(reader, frame => named(frame).length === 1);
    expect(named(spoken).map(window => window.publicName)).toEqual(['Juniper']);
    // Hostile names lose their bidi override but keep the visible characters, as plain data.
    say(r, TALKERS.hostile, 'simulated-message-2');
    const both = await frameWhere(reader, frame => named(frame).length === 2);
    expect(both.windows.find(window => window.publicName?.endsWith('Mallow'))?.publicName).toBe('<img src=x onerror=alert(1)>Mallow');

    // Every event is one frame of the layout's size: no per-person payload beyond the frozen cap.
    for (const frame of reader.frames) expect(frame.windows.length).toBeLessThanOrEqual(SLOTS.length);
    const largest = Math.max(...reader.raw.split('\n\n').map(event => event.length));
    expect(largest).toBeLessThan(SLOTS.length * 96);
    for (const frame of reader.frames) {
      expect(Object.keys(frame).sort()).toEqual(['asOf', 'connection', 'epoch', 'kingdomId', 'origin', 'sequence', 'streamLive', 'version', 'windows']);
      expect(frame).toMatchObject({ kingdomId: KINGDOM, origin: 'live' });
    }
    h = await health(r);
    expect(h.source.frame).toMatchObject({ named: 2, present: SLOTS.length });

    // The private table holds pairs only, owner-only, outside the repository.
    const table = (await files(r.dataDir)).find(file => file.path.endsWith(`${KINGDOM}.json`));
    expect(table).toBeDefined();
    expect(table!.mode).toBe(0o600);
    expect(table!.text).not.toMatch(/Juniper|Mallow|simulated_/);
    await expectNothingPrivateEscaped(r);
  });

  it('overload: a burst past the queues is dropped and counted, newcomers share one binding write, and a user clear still lands', async () => {
    const r = await rig({ chatters: [] });
    await boot(r);
    await publishing(r);
    const reader = await stream(r);
    say(r, TALKERS.rook, 'simulated-message-rook');
    await frameWhere(reader, frame => slotOf(frame, 'Rook') !== null);
    const savedBefore = (await health(r)).source.counters.bindingsSaved;
    // 3,000 first-time chatters in one instant (a raid arriving): more than the 2,048-entry queues hold.
    for (let index = 0; index < 3_000; index++) say(r, { id: String(880_000_000 + index), name: `Guest${index}` }, `simulated-flood-${index}`);
    // A moderator clears Rook in the same instant; removals are never dropped.
    r.eventsub.deliver('channel.chat.clear_user_messages', { ...broadcasterFields, target_user_id: TALKERS.rook.id, target_user_login: 'rook', target_user_name: 'Rook' });
    const dropped = (h: Health) => (h.source.delivery?.ingest.counters.pendingOverflow ?? 0) + h.source.counters.overflowed;
    // Rook goes dark within a few seconds of fake time: the clear is not stuck behind 2,000 disk writes.
    await until(async () => {
      const latest = reader.frames.at(-1);
      return latest !== undefined && slotOf(latest, 'Rook') === null && dropped(await health(r)) > 0;
    }, 5_000);
    const h = await health(r);
    expect(dropped(h)).toBe(3_000 - 2_048);
    expect(h.source.available).toBe(true);
    expect(h.source.frame?.connection).toBe('fresh');
    // Every accepted newcomer has a durable slot, written in a handful of group commits rather than 1,296.
    expect(h.source.capacity.bound).toBe(SLOTS.length);
    expect(h.source.counters.bindingsSaved - savedBefore).toBeLessThanOrEqual(3);
    const latest = reader.frames.at(-1)!;
    expect(latest.windows.length).toBeLessThanOrEqual(SLOTS.length);
    // The flood names at most one person per home; nobody is merged or invented.
    const names = named(latest).map(window => window.publicName);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain('Rook');
    await expectNothingPrivateEscaped(r);
  });

  it('a Chatters cursor that never advances ends partial and keeps the lights it had', async () => {
    const r = await rig({ chatters: CROWD.slice(0, 3_000) });
    await boot(r);
    await publishing(r);
    const reader = await stream(r);
    await frameWhere(reader, frame => present(frame).length === 3_000 || present(frame).length === SLOTS.length);
    const before = present(reader.frames.at(-1)!).length;
    r.fake.chattersRepeatCursorAt = 1;
    await until(async () => (await health(r)).source.observed?.chatters.last?.end === 'repeated_cursor', 90_000, 250);
    const h = await health(r);
    expect(h.source.observed?.chatters.condition).toBe('partial');
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(present(reader.frames.at(-1)!).length).toBe(before);
    await expectNothingPrivateEscaped(r);
  });

  it('a controlled reconnect overlaps two sockets and one message delivered on both lights once', async () => {
    const r = await rig();
    await boot(r);
    await publishing(r);
    const reader = await stream(r);
    const old = socket(r);
    r.eventsub.autoWelcome = false;
    r.eventsub.reconnect(old);
    await until(() => r.eventsub.openSockets.length === 2);
    const fresh = r.eventsub.openSockets.at(-1)!;
    // While the new session is not yet welcomed, the old one still delivers.
    const [delivery] = say(r, TALKERS.wren, 'simulated-message-overlap');
    r.eventsub.welcome(fresh);
    await until(() => old.closed && r.eventsub.shard(r.conduitId)?.sessionId === fresh.sessionId && r.eventsub.shard(r.conduitId)?.status === 'enabled');
    expect(r.eventsub.openSockets).toEqual([fresh]);
    // Twitch repeats that delivery on the new session, and the same chat message again under a new delivery ID.
    r.eventsub.redeliver('channel.chat.message', chatEvent(TALKERS.wren, 'simulated-message-overlap'), delivery!);
    say(r, TALKERS.wren, 'simulated-message-overlap');
    await frameWhere(reader, frame => slotOf(frame, 'Wren') !== null);
    await until(async () => ((await health(r)).source.delivery?.ingest.counters.deliveries ?? 0) >= 3);
    const h = await health(r);
    expect(h.source.available).toBe(true);
    expect(h.source.delivery?.ingest.counters).toMatchObject({ chatSubmitted: 1, duplicateDeliveries: 1, duplicateMessages: 1 });
    expect(named(reader.frames.at(-1)!).map(window => window.publicName)).toEqual(['Wren']);
    expect(r.fake.count('POST', 'api.twitch.tv/helix/eventsub/subscriptions')).toBe(7);
    expect(r.eventsub.sockets.length).toBe(2);
    await expectNothingPrivateEscaped(r);
  });

  it('a reader that stops reading is cut after the stall limit while a healthy one stays current', async () => {
    const r = await rig({ chatters: CROWD.slice(0, SLOTS.length) });
    await boot(r);
    await publishing(r);
    const healthy = await stream(r);
    const stalled = await stream(r, { paused: true });
    await frameWhere(healthy, frame => present(frame).length === SLOTS.length);
    // Each broadcast change is a full frame of every home: a few hundred fill any loopback buffer.
    for (let round = 0; round < 300; round++) {
      vi.advanceTimersByTime(5);
      if (round % 2 === 0) r.eventsub.deliver('stream.offline', broadcasterFields);
      else r.eventsub.deliver('stream.online', { id: String(310000000100 + round), ...broadcasterFields, type: 'live', started_at: iso(Date.now()) });
      await flush(2);
    }
    // The server cuts the stalled socket after 10 s backed up; a paused client only learns once it reads again.
    await until(async () => (await health(r)).server.stalledDisconnects === 1, 30_000, 250);
    const h = await health(r);
    expect(h.server).toMatchObject({ stalledDisconnects: 1 });
    expect((h as unknown as { subscribers: number }).subscribers).toBe(1);
    expect(stalled.frames.length).toBe(0);
    stalled.close();
    // The healthy reader ends on the source's current frame, not a backlog.
    await until(() => healthy.frames.at(-1)?.sequence === r.handle!.source!.current?.frame.sequence);
    expect(healthy.frames.at(-1)!.streamLive).toBe(r.handle!.source!.current!.frame.streamLive);
    // The cut reader reconnects to one fresh snapshot.
    const rejoined = await stream(r);
    const first = await frameWhere(rejoined, () => true);
    expect(first.sequence).toBe(r.handle!.source!.current!.frame.sequence);
    await expectNothingPrivateEscaped(r);
  });

  it('a message deleted before it is delivered never lights, and a late redelivery cannot restore it', async () => {
    const r = await rig();
    await boot(r);
    await publishing(r);
    const reader = await stream(r);
    r.eventsub.deliver('channel.chat.message_delete', { ...broadcasterFields, target_user_id: TALKERS.rook.id, target_user_login: 'rook', target_user_name: 'Rook', message_id: 'simulated-message-gone' });
    const [delivery] = say(r, TALKERS.rook, 'simulated-message-gone');
    r.eventsub.redeliver('channel.chat.message', chatEvent(TALKERS.rook, 'simulated-message-gone'), delivery!);
    say(r, TALKERS.rook, 'simulated-message-gone');
    // Juniper speaks after, so the frame has visibly moved on past Rook's message.
    say(r, TALKERS.juniper, 'simulated-message-after');
    const after = await frameWhere(reader, frame => slotOf(frame, 'Juniper') !== null);
    expect(slotOf(after, 'Rook')).toBeNull();
    expect(present(after).length).toBe(1);
    expect((await health(r)).source.delivery?.ingest.counters.tombstoned).toBeGreaterThanOrEqual(1);
    await expectNothingPrivateEscaped(r);
  });

  it('a restart keeps every slot, starts a fresh epoch and names nobody until they speak again', async () => {
    const r = await rig({ chatters: CROWD.slice(0, 40) });
    await boot(r);
    await publishing(r);
    let reader = await stream(r);
    say(r, TALKERS.juniper, 'simulated-message-before');
    const before = await frameWhere(reader, frame => slotOf(frame, 'Juniper') !== null && present(frame).length === 40);
    const slotsBefore = present(before).map(window => window.slot).sort((a, b) => a - b);
    const juniperSlot = slotOf(before, 'Juniper');
    reader.close();
    await r.handle!.stop();
    r.readers.length = 0;
    // Twitch lists the same people in another order after the restart.
    r.fake.chatters.set(BROADCASTER.id, [...CROWD.slice(0, 40)].reverse());
    await boot(r);
    await publishing(r);
    reader = await stream(r);
    const after = await frameWhere(reader, frame => present(frame).length === 40);
    expect(after.epoch).not.toBe(before.epoch);
    expect(present(after).map(window => window.slot).sort((a, b) => a - b)).toEqual(slotsBefore);
    expect(named(after)).toEqual([]);
    say(r, TALKERS.juniper, 'simulated-message-after');
    const spoken = await frameWhere(reader, frame => slotOf(frame, 'Juniper') !== null);
    expect(slotOf(spoken, 'Juniper')).toBe(juniperSlot);
    await expectNothingPrivateEscaped(r);
  });

  it('the reader withdrawing stops delivery until a fresh grant; the broadcaster withdrawing erases the private table', async () => {
    const r = await rig({ chatters: CROWD.slice(0, 20) });
    await boot(r);
    await publishing(r);
    let reader = await stream(r);
    say(r, TALKERS.juniper, 'simulated-message-1');
    await frameWhere(reader, frame => slotOf(frame, 'Juniper') !== null);

    r.eventsub.revokeAuthorization(READER.id, READER.login);
    await until(async () => !(await health(r)).source.available);
    await reader.closed;
    expect((await get(r.handle!.server.port, STREAM_PATH)).status).toBe(503);
    // Chat after the withdrawal reaches nobody: Twitch has disabled the subscription.
    say(r, TALKERS.rook, 'simulated-message-2');
    r.fake.grants.set(READER.id, new Set(READER_SCOPES));
    await publishing(r);
    reader = await stream(r);
    const resumed = await frameWhere(reader, () => true);
    expect(slotOf(resumed, 'Rook')).toBeNull();

    const table = join(r.dataDir, 'presence', `${KINGDOM}.json`);
    expect(privateIdsIn(await readFile(table, 'utf8')).length).toBeGreaterThan(0);
    r.eventsub.revokeAuthorization(BROADCASTER.id, BROADCASTER.login);
    await until(async () => !(await health(r)).source.available);
    await reader.closed;
    await until(async () => (await files(r.dataDir)).every(file => privateIdsIn(file.text).length === 0));
    expect((await get(r.handle!.server.port, STREAM_PATH)).status).toBe(503);
    const h = await health(r);
    expect(h.source.capacity.bound).toBe(0);
    await expectNothingPrivateEscaped(r);
  });
});
