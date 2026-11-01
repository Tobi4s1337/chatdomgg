import { KingdomIdSchema, PRESENCE_LEASE_MS, STREAM_LEASE_MS, type KingdomPresenceFrame, type PresenceInput } from '@chatdom/shared';
import type { PresenceBinding } from '@chatdom/world';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BindingStoreError, FileBindingStore, MemoryBindingStore, type BindingStore } from './bindings';
import { checkSource, openStream } from './check';
import { DEFAULT_FIRST_YEAR, kingdomFromSettings, presentKingdom } from './kingdom';
import { repositoryRoot, startLiveSource } from './live';
import { MODERATED_HOLD_MS, publicDisplayName, toPresenceInput, type Observation } from './observations';
import { HEALTH_PATH, startPresenceServer, STREAM_PATH, Subscriber } from './server';
import { scenarioStep, SCENARIOS, SIMULATED_KINGDOM, type ScenarioName } from './simulation';
import { FRESHNESS_REFRESH_MS, PresenceSource, type SourceFrame } from './source';

const KINGDOM = SIMULATED_KINGDOM;
const SLOTS = presentKingdom({ seed: 'test', tier: 'hamlet', firstYear: 2026, year: 2026 }).slots;
// Source capacity/backpressure checks need slots, not 27 years of road geometry.
const LARGE_SLOTS = Array.from({ length: 27 }, (_, quarter) => Array.from({ length: 48 }, (_, ordinal) => quarter * 1024 + ordinal)).flat();
const T0 = Date.UTC(2026, 9, 30, 20, 0, 0);
const temporary: string[] = [];

afterEach(async () => {
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function dataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'herald-test-'));
  temporary.push(dir);
  return dir;
}

function harness(options: { store?: BindingStore; slots?: readonly number[]; queueLimit?: number } = {}) {
  let clock = T0;
  const frames: KingdomPresenceFrame[] = [];
  let unavailable = 0;
  const source = new PresenceSource({
    kingdomId: KINGDOM, origin: 'simulated', slots: options.slots ?? SLOTS, store: options.store ?? new MemoryBindingStore(),
    now: () => clock, tickMs: 0, ...(options.queueLimit === undefined ? {} : { queueLimit: options.queueLimit }),
  });
  source.subscribe({ frame: (frame: SourceFrame) => frames.push(frame.frame), unavailable: () => void unavailable++ });
  const observe = (observation: Observation) => source.submit(toPresenceInput(observation, KINGDOM, 'simulated')!);
  return {
    source, frames, observe,
    get unavailable() {
      return unavailable;
    },
    advance(ms: number) {
      clock += ms;
      return clock;
    },
    get now() {
      return clock;
    },
    latest: () => frames.at(-1)!,
  };
}

const talker = (id: string, displayName: string, at: number, messageId = `m${id}.${at}`): Observation => ({ kind: 'chat', messageId, at, author: { id, displayName } });
const sweep = (ids: readonly string[], at: number, complete = true): Observation => ({ kind: 'chatters', sweepId: `s${at}`, at, complete, ids });
const live = (at: number): Observation => ({ kind: 'stream', at, live: true, streamId: 'night-1' });
const people = (count: number, base = 8_000_000_000_000) => Array.from({ length: count }, (_, index) => String(base + index));

describe('observations', () => {
  it('maps chat to one named activity and strips nothing but unsafe characters', () => {
    const input = toPresenceInput(talker('101', 'Juniper', T0), KINGDOM, 'simulated')!;
    expect(input).toMatchObject({ kind: 'observe', source: 'chat', coverage: 'activity', id: `chat:m101.${T0}`, people: [{ personId: '101', disclosure: 'named', displayName: 'Juniper' }] });
    expect(publicDisplayName('\u202eevil\u2066name\u0007')).toBe('evilname');
    expect(publicDisplayName('名前')).toBe('名前');
    expect(publicDisplayName('<b>x</b>')).toBe('<b>x</b>');
  });

  it('leaves an author unnamed when no safe display name remains', () => {
    const input = toPresenceInput(talker('101', ' \u202e ', T0), KINGDOM, 'live')!;
    expect(input.kind === 'observe' && input.people[0]).toEqual({ personId: '101', disclosure: 'anonymous' });
  });

  it('keeps delivery, message and stream keys in separate families', () => {
    const ids = [
      toPresenceInput(talker('101', 'a', T0, 'same'), KINGDOM, 'live')!.id,
      toPresenceInput({ kind: 'chatters', sweepId: 'same', at: T0, complete: true, ids: [] }, KINGDOM, 'live')!.id,
      toPresenceInput({ kind: 'stream', at: T0, live: true, streamId: 'same' }, KINGDOM, 'live')!.id,
      toPresenceInput({ kind: 'user_clear', eventId: 'same', at: T0, userId: '101' }, KINGDOM, 'live')!.id,
    ];
    expect(new Set(ids).size).toBe(4);
  });

  it('turns a user clear into the finite moderated hold, never a Twitch ban', () => {
    expect(toPresenceInput({ kind: 'user_clear', eventId: 'e1', at: T0, userId: '101' }, KINGDOM, 'live')).toMatchObject({ kind: 'remove', reason: 'moderated', until: T0 + MODERATED_HOLD_MS });
  });

  it('rejects provider keys that are not safe tokens and IDs that are not decimal', () => {
    expect(() => toPresenceInput(talker('101', 'a', T0, 'has space'), KINGDOM, 'live')).toThrow();
    expect(() => toPresenceInput(talker('01x', 'a', T0), KINGDOM, 'live')).toThrow();
  });

  it('deduplicates a sweep\'s repeated IDs before the reducer sees them', () => {
    const input = toPresenceInput(sweep(['5', '5', '6'], T0), KINGDOM, 'live')!;
    expect(input.kind === 'observe' && input.people.map(person => person.personId)).toEqual(['5', '6']);
  });
});

describe('kingdom presentation', () => {
  it('defaults to a fixed founding year so slots keep naming the same homes', () => {
    const settings = (map: Record<string, string>) => (key: string) => map[key] ?? null;
    const now = kingdomFromSettings(settings({}), 'tobi4s_', 2026);
    const later = kingdomFromSettings(settings({}), 'tobi4s_', 2027);
    expect(now.config).toEqual({ seed: 'tobi4s_', tier: 'hamlet', firstYear: DEFAULT_FIRST_YEAR, year: 2026 });
    expect(presentKingdom(later.config).slots.slice(0, 12)).toEqual(presentKingdom(now.config).slots);
    expect(kingdomFromSettings(settings({ HERALD_KINGDOM_TIER: 'castle' }), 'x', 2026).problems).toEqual([{ key: 'HERALD_KINGDOM_TIER', issue: 'invalid' }]);
    expect(kingdomFromSettings(settings({ HERALD_KINGDOM_FIRST_YEAR: '1990' }), 'x', 2026).problems).toHaveLength(1);
  });
});

describe('PresenceSource', () => {
  it('names a talker, keeps quiet people unnamed and never publishes person IDs', async () => {
    const h = harness();
    await h.source.open();
    h.source.setAvailable(true);
    await h.observe(live(h.advance(1_000)));
    await h.observe(sweep(['201', '202', '101'], h.advance(1_000)));
    await h.observe(talker('101', 'Juniper', h.advance(1_000)));
    const frame = h.latest();
    expect(frame.windows.filter(window => window.present)).toHaveLength(3);
    expect(frame.windows.filter(window => window.publicName !== null).map(window => window.publicName)).toEqual(['Juniper']);
    const text = JSON.stringify(h.frames);
    for (const id of ['201', '202', '101']) expect(text).not.toMatch(new RegExp(`"${id}"`));
    expect(Object.keys(frame.windows[0]!).sort()).toEqual(['look', 'present', 'publicName', 'since', 'slot']);
  });

  it('publishes a new person only after their binding is durable', async () => {
    let release: () => void = () => undefined;
    const saved: (readonly PresenceBinding[])[] = [];
    const store: BindingStore = {
      kind: 'memory', load: async () => [], erase: async () => undefined, close: async () => undefined,
      save: bindings => new Promise(resolve => {
        release = () => {
          saved.push(bindings);
          resolve();
        };
      }),
    };
    const h = harness({ store });
    await h.source.open();
    h.source.setAvailable(true);
    await h.observe(live(h.advance(1_000)));
    const before = h.frames.length;
    const pending = h.observe(talker('101', 'Juniper', h.advance(1_000)));
    const queued = h.source.submit(toPresenceInput({ kind: 'stream', at: h.advance(1), live: false }, KINGDOM, 'simulated')!);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(h.frames.length).toBe(before);
    expect(saved).toEqual([]);
    release();
    expect(await pending).toBe('applied');
    expect(await queued).toBe('applied');
    expect(saved).toEqual([[{ personId: '101', slot: SLOTS[0] }]]);
    expect(h.frames.slice(before).map(frame => [frame.connection, frame.windows.map(window => window.publicName)])).toEqual([['fresh', ['Juniper']], ['offline', [null]]]);
  });

  it('binds newcomers already waiting in one write, with exactly the slots placing them one by one gives', async () => {
    const saves: (readonly PresenceBinding[])[] = [];
    let gate: () => void = () => undefined;
    const store: BindingStore = {
      kind: 'memory', load: async () => [], erase: async () => undefined, close: async () => undefined,
      save: bindings => {
        saves.push(bindings);
        // The first write is slow, so later arrivals queue behind it and share the next one.
        return saves.length > 1 ? Promise.resolve() : new Promise(resolve => {
          gate = resolve;
        });
      },
    };
    const slots = SLOTS.slice(0, 8);
    const grouped = harness({ store, slots });
    await grouped.source.open();
    grouped.source.setAvailable(true);
    const burst = people(12, 7_000_000_000_000);
    let withdrawn = false;
    const submit = (index: number) => index === 4
      ? grouped.source.submit(toPresenceInput(talker(burst[index]!, `P${index}`, grouped.advance(1)), KINGDOM, 'simulated')!, () => !withdrawn)
      : grouped.observe(talker(burst[index]!, `P${index}`, grouped.advance(1)));
    const results = [submit(0)];
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(saves).toHaveLength(1);
    // The rest of the burst arrives while that write is on disk; a moderator removes person 4's message.
    for (let index = 1; index < burst.length; index++) results.push(submit(index));
    withdrawn = true;
    gate();
    const outcome = await Promise.all(results);
    expect(outcome.filter(result => result === 'canceled')).toHaveLength(1);
    // One more write covers every waiting newcomer that still had a home to take; the withdrawn one is skipped.
    expect(saves).toHaveLength(2);
    expect(saves[1]!.map(binding => binding.personId)).toEqual(burst.filter((_, index) => index !== 4).slice(0, 8));

    // The same burst placed one input at a time, with person 4 withdrawn, gives the same slots and counts.
    const alone = harness({ slots });
    await alone.source.open();
    alone.source.setAvailable(true);
    for (const [index, id] of burst.entries()) {
      // The clock steps for the withdrawn message too, so both runs see the same observation times.
      const at = alone.advance(1);
      if (index !== 4) await alone.observe(talker(id, `P${index}`, at));
    }
    expect(grouped.latest().windows).toEqual(alone.latest().windows);
    expect(grouped.source.health().counters.capacityHits).toBe(alone.source.health().counters.capacityHits);
    expect(grouped.source.health().capacity).toEqual(alone.source.health().capacity);
  });

  it('fails closed when the store cannot keep a binding: no frame shows the person, subscribers are told', async () => {
    const store: BindingStore = {
      kind: 'file', load: async () => [{ personId: KingdomIdSchema.parse('7') as never, slot: SLOTS[0]! }],
      save: async () => {
        throw new BindingStoreError('unwritable');
      },
      erase: async () => undefined, close: async () => undefined,
    };
    const h = harness({ store });
    await h.source.open();
    h.source.setAvailable(true);
    await h.observe(live(h.advance(1_000)));
    expect(await h.observe(talker('101', 'Juniper', h.advance(1_000)))).toBe('unavailable');
    expect(h.unavailable).toBe(1);
    expect(h.source.current).toBeNull();
    expect(h.source.health()).toMatchObject({ condition: 'stopped', reason: 'storage', storage: { fault: 'unwritable' } });
    expect(JSON.stringify(h.frames)).not.toContain('Juniper');
    h.source.setAvailable(true);
    expect(h.source.available).toBe(false);
  });

  it('reports capacity exhaustion instead of merging people or inventing homes', async () => {
    const h = harness({ slots: [3, 4] });
    await h.source.open();
    h.source.setAvailable(true);
    await h.observe(live(h.advance(1_000)));
    await h.observe(sweep(['1', '2', '3', '4'], h.advance(1_000)));
    expect(h.latest().windows.map(window => window.slot)).toEqual([3, 4]);
    expect(h.source.health()).toMatchObject({ condition: 'partial', capacity: { slots: 2, bound: 2, free: 0, unplaced: 2 } });
  });

  it('ignores recovered history without binding anyone', async () => {
    const h = harness();
    await h.source.open();
    h.source.setAvailable(true);
    await h.observe(live(h.advance(1_000)));
    const input = { ...toPresenceInput(talker('101', 'Juniper', h.advance(1_000)), KINGDOM, 'simulated')!, origin: 'recovered' } as PresenceInput;
    expect(await h.source.submit(input)).toBe('applied');
    expect(h.latest().windows).toEqual([]);
  });

  it('rejects another kingdom\'s input and unknown fields such as message text', async () => {
    const h = harness();
    await h.source.open();
    const foreign = toPresenceInput(live(T0), KingdomIdSchema.parse('42'), 'simulated')!;
    expect(await h.source.submit(foreign)).toBe('rejected');
    const withText = { ...toPresenceInput(talker('101', 'Juniper', T0), KINGDOM, 'simulated')!, text: 'hello' } as unknown as PresenceInput;
    expect(await h.source.submit(withText)).toBe('rejected');
    expect(h.source.health().counters.rejected).toBe(2);
  });

  it('drops activity when the queue is full but never a removal or a stream change', async () => {
    const releases: (() => void)[] = [];
    const releaseNext = async () => {
      while (releases.length === 0) await new Promise(resolve => setTimeout(resolve, 1));
      releases.shift()!();
    };
    const store: BindingStore = {
      kind: 'memory', load: async () => [], erase: async () => undefined, close: async () => undefined,
      save: () => new Promise(resolve => {
        releases.push(resolve);
      }),
    };
    const h = harness({ store, queueLimit: 2 });
    await h.source.open();
    h.source.setAvailable(true);
    const blocked = h.observe(talker('101', 'Juniper', h.advance(1_000)));
    const second = h.observe(talker('102', 'Moss', h.advance(1_000)));
    expect(await h.observe(talker('103', 'Wren', h.advance(1_000)))).toBe('overflowed');
    const clear = h.source.submit(toPresenceInput({ kind: 'user_clear', eventId: 'c1', at: h.advance(1_000), userId: '101' }, KINGDOM, 'simulated')!);
    const offline = h.source.submit(toPresenceInput({ kind: 'stream', at: h.advance(1_000), live: false }, KINGDOM, 'simulated')!);
    await releaseNext();
    // One write bound both waiting newcomers (group commit), so the second needs no write of its own.
    await blocked;
    await second;
    expect(releases).toEqual([]);
    expect(await clear).toBe('applied');
    expect(await offline).toBe('applied');
    expect(h.source.health().counters).toMatchObject({ overflowed: 1, bindingsSaved: 1 });
  });

  it('expires evidence through the reducer: lights go out, then the stream goes stale', async () => {
    const h = harness();
    await h.source.open();
    h.source.setAvailable(true);
    await h.observe(live(h.advance(1_000)));
    await h.observe(talker('101', 'Juniper', h.advance(1_000)));
    expect(h.latest().windows[0]!.present).toBe(true);
    h.advance(PRESENCE_LEASE_MS);
    h.source.tick();
    expect(h.latest()).toMatchObject({ connection: 'fresh', windows: [{ present: false, publicName: null }] });
    h.advance(STREAM_LEASE_MS);
    h.source.tick();
    expect(h.latest()).toMatchObject({ connection: 'stale', streamLive: false });
    expect(h.source.health().condition).toBe('stale');
    const sequence = h.latest().sequence;
    h.source.tick();
    expect(h.latest().sequence).toBe(sequence);
  });

  it('keeps a steady frame current: unchanged for 30 s, it is projected again with a new sequence and asOf', async () => {
    const h = harness();
    await h.source.open();
    h.source.setAvailable(true);
    await h.observe(live(h.advance(1_000)));
    await h.observe(sweep(['201', '202'], h.advance(1_000)));
    const steady = h.latest();
    const published = h.frames.length;
    h.advance(FRESHNESS_REFRESH_MS - 1);
    h.source.tick();
    expect(h.frames.length).toBe(published);
    // The same people are still connected: a re-observation alone changes nothing public.
    await h.observe(sweep(['201', '202'], h.now));
    h.advance(1);
    h.source.tick();
    const refreshed = h.latest();
    expect(h.frames.length).toBe(published + 1);
    expect(refreshed.sequence).toBe(steady.sequence + 1);
    expect(refreshed.asOf).toBe(steady.asOf + FRESHNESS_REFRESH_MS);
    expect(refreshed.windows).toEqual(steady.windows);
    // Every lease-length silence a subscriber could see is covered several times over.
    expect(FRESHNESS_REFRESH_MS * 3).toBeLessThanOrEqual(PRESENCE_LEASE_MS);
    // An unavailable source refreshes nothing for its subscribers.
    h.source.setAvailable(false, 'chat_delivery_down');
    h.advance(FRESHNESS_REFRESH_MS);
    h.source.tick();
    expect(h.frames.length).toBe(published + 1);
  });

  // 50,000 identities through the real reducer: allow for a busy machine, not a slow design.
  it('holds 50,000 connected people in one bounded frame and one binding write', { timeout: 30_000 }, async () => {
    let saves = 0;
    const memory = new MemoryBindingStore();
    const store: BindingStore = { kind: 'memory', load: () => memory.load(), erase: () => memory.erase(), close: async () => undefined, save: async bindings => {
      saves++;
      await memory.save(bindings);
    } };
    const town = LARGE_SLOTS;
    const h = harness({ store, slots: town });
    await h.source.open();
    h.source.setAvailable(true);
    await h.observe(live(h.advance(1_000)));
    await h.observe(sweep(people(50_000), h.advance(1_000)));
    const frame = h.latest();
    expect(frame.windows).toHaveLength(town.length);
    expect(frame.windows.every(window => window.present && window.publicName === null)).toBe(true);
    expect(saves).toBe(1);
    expect(h.source.health().capacity).toMatchObject({ bound: town.length, unplaced: 50_000 - town.length });
  });

  it('erases the private bindings and current projection on broadcaster revocation', async () => {
    const store = new MemoryBindingStore();
    const h = harness({ store });
    await h.source.open();
    h.source.setAvailable(true);
    await h.observe(live(h.advance(1_000)));
    await h.observe(talker('101', 'Juniper', h.advance(1_000)));
    await h.source.erase();
    expect(await store.load()).toEqual([]);
    expect(h.latest()).toMatchObject({ connection: 'stale', windows: [] });
  });

  it('tells subscribers once when delivery is lost and resumes with the current snapshot', async () => {
    const h = harness();
    await h.source.open();
    h.source.setAvailable(true);
    await h.observe(live(h.advance(1_000)));
    h.source.setAvailable(false, 'chat_delivery_down');
    h.source.setAvailable(false, 'chat_delivery_down');
    expect(h.unavailable).toBe(1);
    expect(h.source.current).toBeNull();
    const count = h.frames.length;
    await h.observe(talker('101', 'Juniper', h.advance(1_000)));
    expect(h.frames.length).toBe(count);
    h.source.setAvailable(true);
    expect(h.frames.length).toBe(count + 1);
    expect(h.latest().windows[0]!.publicName).toBe('Juniper');
  });

  it('closes cleanly: timers stop, subscribers hear it, transient presence is dropped', async () => {
    const h = harness();
    await h.source.open();
    h.source.setAvailable(true);
    await h.source.close();
    expect(h.unavailable).toBe(1);
    expect(h.source.health()).toMatchObject({ condition: 'stopped', available: false, frame: null });
    expect(await h.observe(live(h.now))).toBe('unavailable');
  });
});

describe('FileBindingStore', () => {
  it('keeps the minimal table atomically, owner-only, and reloads the same slots', async () => {
    const dir = await dataDir();
    const store = new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM });
    expect(await store.load()).toEqual([]);
    const bindings = [{ personId: '101', slot: 0 }, { personId: '102', slot: 1 }] as unknown as PresenceBinding[];
    await store.save(bindings);
    const table = join(dir, 'presence', `${KINGDOM}.json`);
    expect(JSON.parse(await readFile(table, 'utf8'))).toEqual({ version: 1, kingdomId: KINGDOM, bindings: [['101', 0], ['102', 1]] });
    expect((await stat(table)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'presence'))).mode & 0o777).toBe(0o700);
    expect((await readdir(join(dir, 'presence'))).filter(name => name.endsWith('.tmp'))).toEqual([]);
    await store.close();
    const reopened = new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM });
    expect(await reopened.load()).toEqual(bindings);
    await reopened.erase();
    expect(await readdir(join(dir, 'presence'))).toEqual([`${KINGDOM}.json.lock`]);
    await reopened.close();
  });

  it('is the only writer while its holder lives, and takes over a dead holder\'s lock', async () => {
    const dir = await dataDir();
    await mkdir(join(dir, 'presence'), { mode: 0o700 });
    const lock = join(dir, 'presence', `${KINGDOM}.json.lock`);
    await writeFile(lock, '424242 777 0123456789abcdef01\n');
    const rival = new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM, processAlive: () => true, processStart: async () => '777' });
    await expect(rival.load()).rejects.toMatchObject({ fault: 'locked' });
    await expect(rival.save([])).rejects.toMatchObject({ fault: 'locked' });
    const successor = new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM, processAlive: () => false });
    expect(await successor.load()).toEqual([]);
    expect((await readFile(lock, 'utf8')).split(' ')[0]).toBe(String(process.pid));
    await successor.close();
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(join(dir, 'presence'))).filter(name => name.endsWith('.tmp') || name.endsWith('.stale'))).toEqual([]);
  });

  it('refuses a second store in the same process, so two writers never share a table', async () => {
    const dir = await dataDir();
    const first = new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM });
    const second = new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM });
    const [a, b] = await Promise.allSettled([first.load(), second.load()]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    const [owner, refused] = a.status === 'fulfilled' ? [first, second] : [second, first];
    await expect(refused.save([{ personId: '9', slot: 0 }] as unknown as PresenceBinding[])).rejects.toMatchObject({ fault: 'locked' });
    await owner.save([{ personId: '101', slot: 3 }] as unknown as PresenceBinding[]);
    // Closing the refused store must not release the owner's lock.
    await refused.close();
    const third = new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM });
    await expect(third.load()).rejects.toMatchObject({ fault: 'locked' });
    await owner.close();
    expect(await third.load()).toEqual([{ personId: '101', slot: 3 }]);
    await third.close();
  });

  it('treats a lock as stale when its PID now names another process or an earlier run of this one', async () => {
    const dir = await dataDir();
    await mkdir(join(dir, 'presence'), { mode: 0o700 });
    const lock = join(dir, 'presence', `${KINGDOM}.json.lock`);
    // A reused PID: alive, but started at a different time than the holder that wrote the lock.
    await writeFile(lock, '424242 777 0123456789abcdef01\n');
    const reused = new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM, processAlive: () => true, processStart: async pid => pid === 424242 ? '901' : '5' });
    expect(await reused.load()).toEqual([]);
    await reused.close();
    // This PID, left by an earlier process (a container restart reuses low PIDs), including the first lock format.
    for (const text of [`${process.pid}\n`, `${process.pid} 3 0123456789abcdef01\n`]) {
      await writeFile(lock, text);
      const restarted = new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM });
      expect(await restarted.load()).toEqual([]);
      await restarted.close();
    }
    // A lock this code cannot read is not provably abandoned.
    await writeFile(lock, 'garbage');
    await expect(new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM, processAlive: () => false }).load()).rejects.toMatchObject({ fault: 'locked' });
    expect(await readFile(lock, 'utf8')).toBe('garbage');
  });

  it('stops writing once its lock is no longer its own', async () => {
    const dir = await dataDir();
    const store = new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM });
    await store.load();
    await store.save([{ personId: '101', slot: 0 }] as unknown as PresenceBinding[]);
    const lock = join(dir, 'presence', `${KINGDOM}.json.lock`);
    await writeFile(lock, '424242 777 0123456789abcdef01\n');
    await expect(store.save([{ personId: '101', slot: 1 }] as unknown as PresenceBinding[])).rejects.toMatchObject({ fault: 'locked' });
    await expect(store.erase()).rejects.toMatchObject({ fault: 'locked' });
    await store.close();
    expect(await readFile(lock, 'utf8')).toBe('424242 777 0123456789abcdef01\n');
    expect(JSON.parse(await readFile(join(dir, 'presence', `${KINGDOM}.json`), 'utf8')).bindings).toEqual([['101', 0]]);
  });

  it('fails closed on a corrupt or foreign table and never rewrites it', async () => {
    const dir = await dataDir();
    await mkdir(join(dir, 'presence'), { mode: 0o700 });
    const table = join(dir, 'presence', `${KINGDOM}.json`);
    for (const text of ['{not json', JSON.stringify({ version: 1, kingdomId: '42', bindings: [] }), JSON.stringify({ version: 1, kingdomId: KINGDOM, bindings: [['1', 0], ['2', 0]] }), JSON.stringify({ version: 1, kingdomId: KINGDOM, bindings: [], names: ['x'] })]) {
      await writeFile(table, text, { mode: 0o600 });
      const store = new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM });
      await expect(store.load()).rejects.toMatchObject({ fault: 'corrupt' });
      await expect(store.save([])).rejects.toMatchObject({ fault: 'corrupt' });
      expect(await readFile(table, 'utf8')).toBe(text);
      await store.close();
      await rm(`${table}.lock`, { force: true });
    }
  });

  it('refuses a data directory inside the repository or readable by others', async () => {
    const root = await dataDir();
    await expect(new FileBindingStore({ dataDir: join(root, 'inner'), kingdomId: KINGDOM, repositoryRoot: root }).load()).rejects.toMatchObject({ fault: 'inside_repository' });
    await expect(new FileBindingStore({ dataDir: 'relative/dir', kingdomId: KINGDOM }).load()).rejects.toMatchObject({ fault: 'unwritable' });
    const open = await dataDir();
    await mkdir(join(open, 'presence'));
    await chmod(join(open, 'presence'), 0o755);
    await expect(new FileBindingStore({ dataDir: open, kingdomId: KINGDOM }).load()).rejects.toMatchObject({ fault: 'insecure' });
    expect(repositoryRoot()).not.toBeNull();
  });

  it('a source on a corrupt table stays stopped and publishes nothing', async () => {
    const dir = await dataDir();
    await mkdir(join(dir, 'presence'), { mode: 0o700 });
    await writeFile(join(dir, 'presence', `${KINGDOM}.json`), '[]', { mode: 0o600 });
    const h = harness({ store: new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM }) });
    await expect(h.source.open()).rejects.toBeInstanceOf(BindingStoreError);
    h.source.setAvailable(true);
    expect(h.source.current).toBeNull();
    expect(h.source.health()).toMatchObject({ condition: 'stopped', storage: { fault: 'corrupt' } });
    await h.source.close();
  });
});

describe('presence server', () => {
  async function serve(stallMs = 200) {
    const h = harness({ slots: LARGE_SLOTS });
    await h.source.open();
    const server = await startPresenceServer({ host: () => h.source, port: 0, stallMs, keepaliveMs: 50, maxClients: 2 });
    return { h, server };
  }
  const get = (port: number, path: string, method = 'GET') => fetch(`http://127.0.0.1:${port}${path}`, { method });

  it('answers only its two paths, on loopback, with no person in health', async () => {
    const { h, server } = await serve();
    try {
      expect((await get(server.port, '/nope')).status).toBe(404);
      expect((await get(server.port, STREAM_PATH, 'POST')).status).toBe(405);
      expect((await get(server.port, STREAM_PATH)).status).toBe(503);
      h.source.setAvailable(true);
      await h.observe(live(h.advance(1_000)));
      await h.observe(talker('101', 'Juniper', h.advance(1_000)));
      const health = await (await get(server.port, HEALTH_PATH)).json() as { source: { condition: string; frame: { named: number } } };
      expect(health.source).toMatchObject({ condition: 'healthy', frame: { named: 1 } });
      expect(JSON.stringify(health)).not.toMatch(/Juniper|"101"/);
    } finally {
      await h.source.close();
      await server.close();
    }
  });

  it('sends keepalives and caps the number of subscribers', async () => {
    const { h, server } = await serve();
    try {
      h.source.setAvailable(true);
      const a = await openStream(server.port);
      const b = await openStream(server.port);
      expect((await get(server.port, STREAM_PATH)).status).toBe(503);
      await new Promise(resolve => setTimeout(resolve, 120));
      expect(a.raw).toContain(': keepalive');
      expect(a.raw.startsWith('retry: ')).toBe(true);
      a.close();
      b.close();
    } finally {
      await h.source.close();
      await server.close();
    }
  });

  it('coalesces frames for a backed-up subscriber while a healthy one keeps up', async () => {
    const { h, server } = await serve();
    try {
      h.source.setAvailable(true);
      await h.observe(live(h.advance(1_000)));
      const stalled = await openStream(server.port, { paused: true });
      const healthy = await openStream(server.port);
      // Big frames (every town slot bound) back the paused socket up at once.
      await h.observe(sweep(people(2_000), h.advance(1_000)));
      for (let index = 0; index < 40; index++) await h.observe(talker(people(1, 8_000_000_000_000 + index)[0]!, `Name${index}`, h.advance(1_000)));
      await healthy.waitFor(frame => frame.sequence === h.latest().sequence);
      expect(server.counters.coalescedFrames).toBeGreaterThan(30);
      expect(stalled.frames.length).toBeLessThan(5);
      stalled.close();
      healthy.close();
    } finally {
      await h.source.close();
      await server.close();
    }
  });

  it('holds one pending frame for a stalled socket and disconnects it after the stall limit', async () => {
    const written: string[] = [];
    let destroyed = false;
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writeHead: () => undefined,
      write: (chunk: string) => {
        written.push(chunk);
        return false;
      },
      end: () => undefined,
      destroy: () => {
        destroyed = true;
      },
    });
    const counters = { connected: 0, refused: 0, stalledDisconnects: 0, coalescedFrames: 0 };
    let ended = 0;
    const subscriber = new Subscriber(new EventEmitter(), response as never, { stallMs: 40, keepaliveMs: 10, counters, onEnd: () => void ended++ });
    const frame = (sequence: number): SourceFrame => ({ frame: { sequence, epoch: 'e1' } as KingdomPresenceFrame, data: `{"sequence":${sequence}}` });
    for (let sequence = 1; sequence <= 100; sequence++) subscriber.frame(frame(sequence));
    expect(written).toEqual(['retry: 2000\n\n', 'data: {"sequence":1}\n\n']);
    expect(counters.coalescedFrames).toBe(98);
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(written.some(chunk => chunk.startsWith(': keepalive'))).toBe(false);
    expect(destroyed).toBe(true);
    expect(counters.stalledDisconnects).toBe(1);
    expect(ended).toBe(1);
  });

  it('a draining subscriber gets the newest pending frame, never a backlog', () => {
    const written: string[] = [];
    let accept = false;
    const response = Object.assign(new EventEmitter(), {
      destroyed: false, writeHead: () => undefined, end: () => undefined, destroy: () => undefined,
      write: (chunk: string) => {
        written.push(chunk);
        return accept;
      },
    });
    const counters = { connected: 0, refused: 0, stalledDisconnects: 0, coalescedFrames: 0 };
    const subscriber = new Subscriber(new EventEmitter(), response as never, { stallMs: 10_000, keepaliveMs: 10_000, counters, onEnd: () => undefined });
    const frame = (sequence: number): SourceFrame => ({ frame: { sequence, epoch: 'e1' } as KingdomPresenceFrame, data: String(sequence) });
    subscriber.frame(frame(1));
    subscriber.frame(frame(2));
    subscriber.frame(frame(3));
    subscriber.frame(frame(2));
    accept = true;
    response.emit('drain');
    expect(written.slice(1)).toEqual(['data: 1\n\n', 'data: 3\n\n']);
    subscriber.end();
  });

  it('closes open streams when the source goes unavailable', async () => {
    const { h, server } = await serve();
    try {
      h.source.setAvailable(true);
      const reader = await openStream(server.port);
      await reader.waitFor(() => true);
      h.source.setAvailable(false, 'chat_delivery_down');
      await reader.closed;
      expect((await get(server.port, STREAM_PATH)).status).toBe(503);
    } finally {
      await h.source.close();
      await server.close();
    }
  });
});

describe('SIMULATED scenarios', () => {
  async function play(name: ScenarioName, seconds: number, options: { store?: BindingStore; arrival?: 'forward' | 'reverse' } = {}) {
    const h = harness(options.store ? { store: options.store } : {});
    await h.source.open();
    h.source.setAvailable(true);
    const start = h.now;
    for (let t = 0; t <= seconds; t++) {
      const step = scenarioStep(name, t, start, options.arrival ? { arrival: options.arrival } : {});
      if (t > 0) h.advance(1_000);
      for (const observation of step.observations) {
        expect(['applied']).toContain(await h.source.submit(toPresenceInput(observation, KINGDOM, 'simulated')!));
      }
      if (step.available === false) h.source.setAvailable(false, 'simulated_outage');
      h.source.tick();
    }
    return h;
  }

  it('a restart over the same table keeps every window and name on its slot, whatever order people arrive in', async () => {
    const dir = await dataDir();
    const seating = (frame: KingdomPresenceFrame) => frame.windows.filter(window => window.present).map(window => `${window.slot}:${window.publicName ?? '-'}`);
    const first = await play('evening', 20, { store: new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM }) });
    const before = seating(first.latest());
    await first.source.close();
    expect(before).toHaveLength(10);
    const again = await play('evening', 20, { store: new FileBindingStore({ dataDir: dir, kingdomId: KINGDOM }), arrival: 'reverse' });
    expect(seating(again.latest())).toEqual(before);
    await again.source.close();
    // Without the table the same reversed arrival seats people elsewhere, so the comparison above means something.
    const control = await play('evening', 20, { arrival: 'reverse' });
    expect(seating(control.latest())).not.toEqual(before);
  });

  it('is a pure function of time', () => {
    for (const name of SCENARIOS) expect(scenarioStep(name, 61, T0)).toEqual(scenarioStep(name, 61, T0));
  });

  it('evening lights named and unnamed windows and holds a cleared talker dark', async () => {
    const h = await play('evening', 200);
    const frame = h.latest();
    expect(frame).toMatchObject({ origin: 'simulated', connection: 'fresh', streamLive: true });
    const names = frame.windows.flatMap(window => window.publicName ?? []);
    expect(names).toEqual(expect.arrayContaining(['Juniper', 'MossLantern', 'quietbaker', 'Wrenfield']));
    expect(names).not.toContain('tallowmoth');
    expect(frame.windows.filter(window => window.present && window.publicName === null)).toHaveLength(5);
    expect(h.source.health().capacity.unplaced).toBe(0);
  });

  it('quiet, offline, stale and unavailable each say only what is true', async () => {
    const quiet = (await play('quiet', 5)).latest();
    expect(quiet.windows.every(window => window.present && window.publicName === null)).toBe(true);
    const offline = (await play('offline', 70)).latest();
    expect(offline).toMatchObject({ connection: 'offline', streamLive: false });
    expect(offline.windows.every(window => !window.present)).toBe(true);
    const stale = (await play('stale', 10)).latest();
    expect(stale).toMatchObject({ connection: 'stale', streamLive: false });
    const down = await play('unavailable', 6);
    expect(down.source.current).toBeNull();
    expect(down.unavailable).toBe(1);
  });
});

describe('check:source', () => {
  it('passes against the real endpoint, reducer and durable table', async () => {
    const result = await checkSource();
    expect(result.lines.filter(line => line.includes('✗'))).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('dev without credentials', () => {
  it('serves health that says why it is not publishing, and refuses subscribers', async () => {
    const handle = await startLiveSource({
      port: 0, print: () => undefined,
      config: {
        channelLogin: 'tobi4s_', channelLoginDefaulted: true, readerLogin: null, redirectUri: null, credentials: null, conduitId: null,
        dataDir: '/nonexistent', kingdom: { seed: 'tobi4s_', tier: 'hamlet', firstYear: 2026, year: 2026 }, problems: [],
        port: 5194, secretsFile: '/simulated/atlas.env', settingsFile: '/simulated/herald.env',
      },
    });
    try {
      expect((await fetch(`http://127.0.0.1:${handle.server.port}${STREAM_PATH}`)).status).toBe(503);
      const health = await (await fetch(`http://127.0.0.1:${handle.server.port}${HEALTH_PATH}`)).json() as { source: unknown };
      expect(health.source).toEqual({ origin: 'live', condition: 'unauthorized', available: false, reason: 'app_credentials_missing', missing: ['app credentials'] });
    } finally {
      await handle.stop();
    }
  });
});
