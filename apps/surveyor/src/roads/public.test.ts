import { cpSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { request, type ClientRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { AtlasRaid } from '@chatdom/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadDirectory } from '../directory/directory';
import type { TwitchChannelFacts, TwitchLookup } from '../directory/twitch-lookup';
import { runImport } from '../import';
import { iso, liveAt, liveSnapshot, type LiveChannelSpec } from '../live/fixtures.test-support';
import { runLive } from '../live/run';
import { WITHHELD_FILE } from '../policy/visibility';
import { createAtlasService, type AtlasService, type AtlasServiceOptions } from '../serve';
import { FixtureSource, RECENT, clock, configFor, fakeSurveyor, sweepAt, tempDataDir } from '../test/fixture-source';
import { allowRealImports } from '../test/timeouts';
import { finderOrder, type BusiestReply, type CaravanEvent, type ChannelRoadsReply, type FinderReply, type RoadEntry, type RoadStoryReply } from './public';

allowRealImports();

/**
 * One English continent large enough for several realms (one per family of games), the standard fixture channels,
 * and a live frame in which every fifth fixture channel is offline. Roads come from the import's own raid records
 * and pair aggregates (backfilled by the service) and from herald raids posted through the private ingest.
 */
const CAPITAL = '900000000000000001';
const TOWN = '900000000000000002';
const VILLAGE = '900000000000000003';
const SMALL = '900000000000000004';
const UNSEEN = '777777777777';
const OUTSIDER = '818181818181';
const GAMES: [string, string][] = [
  ['509658', 'Just Chatting'], ['32399', 'Counter-Strike'], ['21779', 'League of Legends'],
  ['18122', 'World of Warcraft'], ['27471', 'Minecraft'], ['491487', 'Dead by Daylight'],
];
const FIXTURES = 660;
const fx = (i: number) => `91${String(i).padStart(16, '0')}`;
/** Every fifth fixture channel is offline in the live frame. */
const offline = (i: number) => i % 5 === 0;
const NOW = liveAt(0) + 30_000;
const DAY = 86_400_000;

let base: { dataDir: string; preview: string };
beforeAll(async () => {
  const source = FixtureSource.standard();
  source.db.exec('BEGIN');
  for (let i = 0; i < FIXTURES; i++) {
    source.addChannel({ id: fx(i), login: `fx_en_${i}`, name: `Fx En ${i}`, firstSweep: 0, lastSweep: 4, live: true, liveMin: 15, viewerMin: 15 * (30 + i), game: GAMES[i % GAMES.length]! });
  }
  source.db.exec('COMMIT');
  const dataDir = tempDataDir();
  try {
    const outcome = await runImport(configFor(source, dataDir), { fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(sweepAt(10)) });
    if (!outcome.ok) throw new Error(outcome.error.message);
    const at = liveAt(0);
    const channels: LiveChannelSpec[] = [
      { id: CAPITAL, average: 6_000 }, { id: VILLAGE, average: 25, lang: 'de' },
      { id: SMALL, average: 8, startedAt: iso(at - 600_000) },
      ...Array.from({ length: FIXTURES }, (_, i) => i).filter((i) => !offline(i)).map((i) => ({ id: fx(i), average: 30 + i, gameId: GAMES[i % GAMES.length]![0] })),
    ];
    const run = await runLive(dataDir, null, new Map(), { now: () => at + 15_000, readSource: () => liveSnapshot(at, channels) });
    expect(run.targets.length).toBe(1);
    base = { dataDir, preview: outcome.preview.id };
  } finally {
    source.close();
  }
}, 120_000);
afterAll(() => rmSync(base.dataDir, { recursive: true, force: true }));

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

function copy(): string {
  const dataDir = tempDataDir();
  cpSync(base.dataDir, dataDir, { recursive: true });
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  return dataDir;
}

function withhold(dataDir: string, ids: string[]): void {
  mkdirSync(join(dataDir, 'moderation'), { recursive: true });
  const path = join(dataDir, WITHHELD_FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify({ version: 1, updatedAt: NOW, kingdomIds: ids }));
  renameSync(`${path}.tmp`, path);
}

/** A Twitch stand-in with a cache, so `cached()` answers like the real adapter's. */
function twitchStandIn(facts: TwitchChannelFacts[]) {
  const cache = new Map<string, TwitchChannelFacts[]>();
  const calls: string[] = [];
  const lookup: TwitchLookup = {
    cached: (query) => cache.has(query.trim().toLowerCase()),
    lookup: async (raw) => {
      const query = raw.trim().toLowerCase();
      calls.push(query);
      const hit = cache.get(query);
      if (hit) return hit.map((fact) => ({ ...fact }));
      const found = facts.filter((fact) => query === fact.login || query === `id:${fact.id}` || query === `login:${fact.login}`);
      for (const fact of found) for (const key of [`id:${fact.id}`, fact.login, `login:${fact.login}`]) cache.set(key, [fact]);
      cache.set(query, found);
      return found.map((fact) => ({ ...fact }));
    },
    close: () => {},
  };
  return { lookup, calls };
}

const OUTSIDER_FACTS: TwitchChannelFacts = {
  id: OUTSIDER, login: 'outsiderfixture', name: 'Outsider Fixture', avatarUrl: null, language: 'en', gameId: '509658',
  game: 'Just Chatting', title: 'A fixture stream', live: true, viewers: 5, startedAt: NOW - 600_000, fetchedAt: NOW,
};

async function start(dataDir: string, options: AtlasServiceOptions = {}): Promise<{ service: AtlasService; port: number; ingest: number }> {
  const service = createAtlasService(dataDir, () => {}, {
    now: () => NOW, twitchLookup: null, ingestToken: null, liveWatchMs: 50,
    ...options, roads: { feedUrl: null, surveyorBase: null, recorderPath: null, ...options.roads },
  });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => service.ingest.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => service.close());
  return { service, port: (service.server.address() as AddressInfo).port, ingest: (service.ingest.address() as AddressInfo).port };
}

function get(port: number, path: string, method = 'GET') {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string; json: <T>() => T }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: <T>() => JSON.parse(body) as T }));
    });
    req.on('error', reject);
    req.end();
  });
}

function post(port: number, raid: unknown) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/v1/roads/observe', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(raid));
  });
}

let serial = 0;
function herald(from: string, to: string, at: number, overrides: Partial<AtlasRaid> = {}): AtlasRaid {
  return {
    version: 1, id: `eventsub-${++serial}`, fromKingdomId: from as AtlasRaid['fromKingdomId'], toKingdomId: to as AtlasRaid['toKingdomId'],
    viewers: 40, observedAt: at + 200, occurredAt: at, evidence: { kind: 'observed', asOf: at + 200 },
    delivery: 'resumable', source: 'herald', ...overrides,
  };
}

async function until<T>(read: () => Promise<T>, check: (value: T) => boolean, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (check(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out: ${JSON.stringify(value).slice(0, 400)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

interface Stream { raids: () => CaravanEvent[]; req: ClientRequest }
function events(port: number, path: string): Promise<Stream> {
  return new Promise((resolve, reject) => {
    let text = '';
    const req = request({ host: '127.0.0.1', port, path, headers: { accept: 'text/event-stream' } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      const raids = () => text.split('\n\n').filter((block) => block.startsWith('event: raid\n'))
        .map((block) => JSON.parse(block.split('\n').find((line) => line.startsWith('data: '))!.slice(6)) as CaravanEvent);
      // The first live event arrives with the headers; the stream is registered once it is read.
      const ready = () => (text.includes('event: live') ? resolve({ raids, req }) : setTimeout(ready, 5));
      ready();
    });
    req.on('error', reject);
    req.end();
    cleanup.push(() => { req.destroy(); });
  });
}

/** Waits until the service's backfill of the import's raid records and pair aggregates has landed. */
async function backfilled(port: number, preview: string) {
  return until(() => get(port, `/map-data/v1/roads/${preview}/road/${CAPITAL}/${VILLAGE}`), (reply) => reply.status === 200 && reply.json<RoadStoryReply>().basis === 'at-least');
}

describe('the finder order', () => {
  it('reads only group, size and channel ID, whatever else an input carries and in whatever order it arrives', () => {
    const inputs = [
      { id: '30', size: 90, sponsored: true, bits: 10_000 }, { id: '4', size: 12, paid: true },
      { id: '200', size: 12 }, { id: '7', size: null }, { id: '5', size: 900, promoted: 1 }, { id: '11', size: 12, boost: 99 },
    ];
    const expected = ['4', '11', '200', '30', '5', '7'];
    expect(finderOrder(inputs).map((entry) => entry.id)).toEqual(expected);
    for (let round = 0; round < 25; round++) {
      const shuffled = [...inputs].sort(() => Math.random() - 0.5).map((entry) => ({ ...entry, sponsored: Math.random() > 0.5, bid: Math.random() }));
      expect(finderOrder(shuffled).map((entry) => entry.id)).toEqual(expected);
    }
  });
});

describe('public road reads', () => {
  it('lists a channel\'s roads with per-direction counts, at-least totals, old roads unchanged and gated ends left out', async () => {
    const dataDir = copy();
    const { port, ingest } = await start(dataDir);
    const preview = base.preview;
    const story = (await backfilled(port, preview)).json<RoadStoryReply>();
    // Aggregates thicken the road without inventing raids: only the import's two recorded raids are its events.
    expect(story).toMatchObject({ kind: 'chatdom-atlas-road-story', basis: 'at-least', firstAt: null, a: { id: CAPITAL, place: 'mapped' }, b: { id: VILLAGE } });
    expect(story.aToB!.raids).toBeGreaterThanOrEqual(2);
    expect(story.bToA).toEqual({ raids: 0, travellers: 0 });
    expect(story.recent).toHaveLength(2);
    expect(story.recent.every((raid: { from: string }) => raid.from === CAPITAL)).toBe(true);
    expect(story.recent[0]!.at).toBeGreaterThan(story.recent[1]!.at);

    const old = NOW - 200 * DAY;
    for (const raid of [herald(CAPITAL, fx(1), NOW - 5_000), herald(CAPITAL, fx(1), NOW - 4 * DAY), herald(fx(1), CAPITAL, NOW - 2 * DAY, { viewers: 7 }),
      herald(CAPITAL, fx(13), old), herald(CAPITAL, UNSEEN, NOW - DAY), herald(CAPITAL, fx(7), NOW - 3 * DAY)]) {
      expect((await post(ingest, raid)).status).toBe(200);
    }
    const listed = await get(port, `/map-data/v1/roads/${preview}/channel/${CAPITAL}`);
    expect(listed.status).toBe(200);
    expect(listed.headers['cache-control']).toBe('no-cache');
    const roads = listed.json<ChannelRoadsReply>();
    expect(roads).toMatchObject({ version: 1, kind: 'chatdom-atlas-roads', preview, servedAt: NOW, channel: { id: CAPITAL, place: 'mapped' }, position: { x: expect.any(Number), y: expect.any(Number) } });
    expect(roads.since).toBe(old);
    const byOther = new Map<string, RoadEntry>(roads.roads.map((road) => [road.other.id, road]));
    expect(byOther.get(fx(1))).toMatchObject({ sent: 2, received: 1, travellers: 87, basis: 'observations', firstAt: NOW - 4 * DAY, lastAt: NOW - 5_000 });
    // Unused for 200 days: served exactly like any other road. Fading is drawing, never deletion.
    expect(byOther.get(fx(13))).toMatchObject({ sent: 1, received: 0, lastAt: old, firstAt: old, basis: 'observations' });
    // An end the survey never saw is listed by ID alone, without a place (no Twitch lookup is spent on it).
    expect(byOther.get(UNSEEN)).toMatchObject({ other: { id: UNSEEN, place: 'unseen', login: null, name: null }, position: null });
    expect(byOther.get(VILLAGE)).toMatchObject({ basis: 'at-least', firstAt: null });
    expect(roads.total).toBe(roads.roads.length);
    const totals = roads.roads.map((road) => road.sent + road.received);
    expect(totals).toEqual([...totals].sort((a: number, b: number) => b - a));
    // The other direction reads from fx(1)'s side.
    const reverse = (await get(port, `/map-data/v1/roads/${preview}/road/${fx(1)}/${CAPITAL}`)).json<RoadStoryReply>();
    expect(reverse).toMatchObject({ aToB: { raids: 1, travellers: 7 }, bToA: { raids: 2, travellers: 80 }, basis: 'observations', firstAt: NOW - 4 * DAY, lastAt: NOW - 5_000 });
    expect(reverse.recent.map((raid) => raid.at)).toEqual([NOW - 5_000, NOW - 2 * DAY, NOW - 4 * DAY]);
    expect((await get(port, `/map-data/v1/roads/${preview}/road/login/fx_en_1/fixture_capital`)).json()).toMatchObject({ a: { id: fx(1) }, aToB: { raids: 1 } });
    // Two surveyed channels with no witnessed raid: not observed, never "no raids".
    expect((await get(port, `/map-data/v1/roads/${preview}/road/${fx(2)}/${fx(3)}`)).json()).toMatchObject({ aToB: null, bToA: null, basis: 'none', firstAt: null, lastAt: null, recent: [] });
    expect((await get(port, `/map-data/v1/roads/${preview}/road/${fx(2)}/${fx(2)}`)).status).toBe(404);
    expect((await get(port, `/map-data/v1/roads/${preview}/road/${UNSEEN}/${fx(2)}`)).status).toBe(404);
    expect((await get(port, `/map-data/v1/roads/${preview}/channel/${fx(2)}`)).json()).toMatchObject({ total: 0, roads: [] });
    expect((await get(port, `/map-data/v1/roads/${preview}/channel/123456`)).status).toBe(404);
    expect((await get(port, `/map-data/v1/roads/pv-20990101T000000Z-aaaaaaaaaaaa/channel/${CAPITAL}`)).status).toBe(404);
    expect(await get(port, `/map-data/v1/roads/${preview}/channel/${CAPITAL}`, 'HEAD')).toMatchObject({ status: 200, body: '' });
    expect((await get(port, `/map-data/v1/roads/${preview}/channel/${CAPITAL}`, 'POST')).status).toBe(405);

    const busiest = (await get(port, `/map-data/v1/roads/${preview}/busiest`)).json<BusiestReply>();
    expect(busiest).toMatchObject({ version: 1, kind: 'chatdom-atlas-busiest-roads', preview, since: old });
    expect(JSON.stringify(busiest)).not.toMatch(/fx_en|Fixture|login|name/);
    const pairs = busiest.roads.map((road) => [road.a, road.b].sort().join('~'));
    expect(pairs).toContain([CAPITAL, fx(1)].sort().join('~'));
    expect(pairs).toContain([CAPITAL, fx(13)].sort().join('~'));
    // An unplaced end cannot be drawn: left out of the busiest view.
    expect(pairs.some((pair: string) => pair.includes(UNSEEN))).toBe(false);
    expect(busiest.roads[0]).toMatchObject({ pa: { x: expect.any(Number), y: expect.any(Number) }, ra: 0, raids: expect.any(Number), travellers: expect.any(Number), lastAt: expect.any(Number) });
    const strength = busiest.roads.map((road) => road.raids);
    expect(strength).toEqual([...strength].sort((a: number, b: number) => b - a));

    // Withholding one end removes the whole road everywhere, never as an anonymous road.
    withhold(dataDir, [fx(1)]);
    const hidden = (await get(port, `/map-data/v1/roads/${preview}/channel/${CAPITAL}`)).json<ChannelRoadsReply>();
    expect(hidden.roads.map((road) => road.other.id)).not.toContain(fx(1));
    expect(hidden.total).toBe(roads.total - 1);
    expect(JSON.stringify(hidden)).not.toContain(fx(1));
    expect((await get(port, `/map-data/v1/roads/${preview}/road/${CAPITAL}/${fx(1)}`)).status).toBe(404);
    expect((await get(port, `/map-data/v1/roads/${preview}/channel/${fx(1)}`)).status).toBe(404);
    expect(JSON.stringify((await get(port, `/map-data/v1/roads/${preview}/busiest`)).json())).not.toContain(fx(1));
    writeFileSync(join(dataDir, WITHHELD_FILE), '{not json');
    expect((await get(port, `/map-data/v1/roads/${preview}/channel/${CAPITAL}`)).status).toBe(503);
  });
});

describe('the Raid Gate finder', () => {
  it('proposes live roads, then the realm, then the nearest realms, smaller first, each once, and searches every channel', async () => {
    const dataDir = copy();
    const twitch = twitchStandIn([OUTSIDER_FACTS]);
    const { port, ingest } = await start(dataDir, { twitchLookup: twitch.lookup });
    const preview = base.preview;
    await backfilled(port, preview);
    for (const raid of [herald(CAPITAL, fx(7), NOW - DAY), herald(fx(1), CAPITAL, NOW - DAY), herald(CAPITAL, fx(5), NOW - DAY),
      herald(fx(6), CAPITAL, NOW - DAY), herald(CAPITAL, OUTSIDER, NOW - DAY)]) expect((await post(ingest, raid)).status).toBe(200);
    const register = await loadDirectory(dataDir, preview);
    const realmOf = (id: string) => register.facts(id).realm;
    const sizeOf = (id: string) => register.facts(id).average!;

    const url = `/map-data/v1/gate/${preview}/finder?from=${CAPITAL}`;
    const reply = await get(port, url);
    expect(reply.status).toBe(200);
    expect(reply.headers['cache-control']).toBe('no-cache');
    const body = reply.json<FinderReply>();
    expect(body).toMatchObject({ version: 1, kind: 'chatdom-atlas-finder', preview, servedAt: NOW, liveAsOf: liveAt(0), from: { channel: { id: CAPITAL }, position: { x: expect.any(Number) } } });
    expect(body).not.toHaveProperty('unavailable');
    expect(body.groups.map((group) => group.kind)).toEqual(['roads', 'realm', 'neighbours']);
    const [roads = [], realm = [], neighbours = []] = body.groups.map((group): string[] => group.entries.map((entry) => entry.channel.id));
    // Roads: live counterparts only (fx(5) is offline, the outsider is not in the live frame), smaller first.
    expect(roads).toEqual([VILLAGE, fx(1), fx(6), fx(7)].sort((a, b) => sizeOf(a) - sizeOf(b)));
    const entry = body.groups[0]!.entries.find((candidate) => candidate.channel.id === fx(7));
    expect(entry).toMatchObject({ live: true, size: 37, game: 'Counter-Strike', language: 'en', viewers: 30, land: 'waiting', roads: { raids: 1, lastAt: NOW - DAY } });
    expect(entry).not.toHaveProperty('portrait');
    // Realm: the source's own realm, the small waiting channel (live as a dab) first; fx(6) already went with roads.
    const own = realmOf(CAPITAL);
    expect(realm[0]).toBe(SMALL);
    expect(realm).toHaveLength(12);
    expect(realm.every((id: string) => realmOf(id) === own)).toBe(true);
    const expectedRealm = [SMALL, ...Array.from({ length: FIXTURES }, (_, i) => i).filter((i) => !offline(i) && realmOf(fx(i)) === own && i !== 6).map(fx)]
      .sort((a, b) => sizeOf(a) - sizeOf(b) || a.localeCompare(b)).slice(0, 12);
    expect(realm).toEqual(expectedRealm);
    // Neighbours: the three realms of the region whose centres lie nearest the source realm's.
    const realms = register.realms();
    const centre = realms.find((candidate) => candidate.index === own)!;
    const nearest = realms.filter((candidate) => candidate.region === centre.region && candidate.index !== own)
      .sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y)).slice(0, 3).map((candidate) => candidate.index);
    expect(neighbours.length).toBeGreaterThan(0);
    expect(neighbours.every((id: string) => nearest.includes(realmOf(id)!))).toBe(true);
    const far = realms.filter((candidate) => candidate.region === centre.region && candidate.index !== own && !nearest.includes(candidate.index)).map((candidate) => candidate.index);
    expect(far.length).toBeGreaterThan(0);
    const sizes = neighbours.map(sizeOf);
    expect(sizes).toEqual([...sizes].sort((a: number, b: number) => a - b));
    // Every proposal is live, each channel appears once, and the source never appears.
    const all = [...roads, ...realm, ...neighbours];
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain(CAPITAL);
    expect(body.groups.flatMap((group) => group.entries).every((candidate) => candidate.live === true)).toBe(true);
    expect(all.some((id: string) => /^91/.test(id) && offline(Number(id.slice(2))))).toBe(false);
    // The same question gets the same answer.
    expect((await get(port, url)).json<FinderReply>().groups).toEqual(body.groups);

    // Search: relevance order, offline results included as not live, the source excluded.
    const search = (await get(port, `${url}&q=fx_en_1&portraits=1`)).json<FinderReply>();
    const found = search.groups.find((group) => group.kind === 'search')!.entries;
    expect(found[0]).toMatchObject({ channel: { id: fx(1), login: 'fx_en_1' }, live: true, portrait: expect.anything() });
    // Survey results answer from the live frame; every fifth fixture channel is offline and stays listed.
    for (const candidate of found) expect(candidate.live, candidate.channel.id).toBe(!offline(Number(candidate.channel.id.slice(2))));
    expect(found.some((candidate) => !candidate.live)).toBe(true);
    expect(search.groups[0]!.entries[0]).toHaveProperty('portrait');
    expect((await get(port, `${url}&q=fixture_capital`)).json<FinderReply>().groups.find((group) => group.kind === 'search')!.entries).toEqual([]);
    // A channel outside the survey, through the fallback: live from its fresh Twitch facts, placed like a searched channel.
    expect((await get(port, `/map-data/v1/roads/${preview}/channel/${CAPITAL}`)).json<ChannelRoadsReply>().roads.find((road) => road.other.id === OUTSIDER)).toMatchObject({ other: { place: 'unseen' }, position: null });
    const outside = (await get(port, `${url}&q=outsiderfixture`)).json<FinderReply>().groups.find((group) => group.kind === 'search')!.entries;
    expect(outside).toEqual([expect.objectContaining({ channel: expect.objectContaining({ id: OUTSIDER, place: 'waiting' }), live: true, size: 5, viewers: 5, game: 'Just Chatting', language: 'en', land: 'waiting', roads: { raids: 1, lastAt: NOW - DAY }, position: { x: expect.any(Number), y: expect.any(Number) } })]);
    // Once the fallback's cache knows its facts, its road ends at that same deterministic place (no new lookup).
    const calls = twitch.calls.length;
    const placed = (await get(port, `/map-data/v1/roads/${preview}/channel/${CAPITAL}`)).json<ChannelRoadsReply>().roads.find((road) => road.other.id === OUTSIDER);
    expect(placed!.position).toEqual(outside[0]!.position);
    expect(twitch.calls.slice(calls).every((query) => query === `id:${OUTSIDER}`)).toBe(true);

    expect((await get(port, `${url}&q=${'x'.repeat(60)}`)).status).toBe(400);
    expect((await get(port, `/map-data/v1/gate/${preview}/finder`)).status).toBe(400);
    expect((await get(port, `/map-data/v1/gate/${preview}/finder?from=abc`)).status).toBe(400);
    expect((await get(port, `/map-data/v1/gate/${preview}/finder?from=${CAPITAL}&unknown=1`)).status).toBe(200);
    expect((await get(port, `/map-data/v1/gate/${preview}/finder?from=123456`)).status).toBe(404);
    withhold(dataDir, [CAPITAL, fx(7)]);
    expect((await get(port, url)).status).toBe(404);
    withhold(dataDir, [fx(7)]);
    const gated = (await get(port, url)).json<FinderReply>();
    expect(JSON.stringify(gated)).not.toContain(fx(7));
  });
});

describe('caravans on the live stream', () => {
  it('ride a fresh herald raid once to the streams open now, and never a duplicate, a stale or gated raid, or a replay', async () => {
    const dataDir = copy();
    const { port, ingest } = await start(dataDir);
    const preview = base.preview;
    await backfilled(port, preview);
    const first = await events(port, `/map-data/v1/live/${preview}/events`);
    const fresh = herald(CAPITAL, fx(1), NOW - 2_000, { viewers: 77 });
    expect((await post(ingest, fresh)).body).toMatchObject({ kind: 'stored' });
    await until(async () => first.raids(), (raids) => raids.length === 1);
    expect(first.raids()[0]).toMatchObject({
      version: 1, id: fresh.id, from: CAPITAL, to: fx(1), viewers: 77, at: NOW - 2_000,
      a: { id: CAPITAL, login: 'fixture_capital' }, b: { id: fx(1) }, pa: { x: expect.any(Number) }, pb: { x: expect.any(Number) }, ra: 0, rb: 0,
    });
    // A stream opened after the raid never receives it.
    const later = await events(port, `/map-data/v1/live/${preview}/events`);
    expect((await post(ingest, fresh)).body).toMatchObject({ kind: 'duplicate' });
    expect((await post(ingest, herald(CAPITAL, fx(2), NOW - 120_000))).body).toMatchObject({ kind: 'stored' });
    withhold(dataDir, [fx(3)]);
    expect((await post(ingest, herald(fx(3), CAPITAL, NOW - 1_000))).body).toMatchObject({ kind: 'stored' });
    const marker = herald(fx(4), CAPITAL, NOW - 1_000);
    expect((await post(ingest, marker)).body).toMatchObject({ kind: 'stored' });
    await until(async () => later.raids(), (raids) => raids.length === 1);
    expect(later.raids().map((raid) => raid.id)).toEqual([marker.id]);
    expect(first.raids().map((raid) => raid.id)).toEqual([fresh.id, marker.id]);
  });

  it('ride fresh survey SSE raids, but not the first raid-show pull after a start (catch-up), only later fresh pulls', async () => {
    const dataDir = copy();
    const recorder = FixtureSource.standard();
    cleanup.push(() => recorder.close());
    const live = vi.fn();
    const sse: ReadableStreamDefaultController<Uint8Array>[] = [];
    let releaseFirst!: () => void;
    const firstPull = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let pulls = 0;
    const pullRaid = (id: string, at: number) => herald(VILLAGE, CAPITAL, at, { id });
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/raids')) {
        return new Response(new ReadableStream({ start(controller) { sse.push(controller); } }), { headers: { 'content-type': 'text/event-stream' } });
      }
      pulls++;
      if (pulls === 1) {
        await firstPull;
        return Response.json({ version: 1, items: [pullRaid('pull-catch-up', NOW - 3_000)], next: 'one' });
      }
      if (pulls === 2) return Response.json({ version: 1, items: [pullRaid('pull-fresh', NOW - 2_000)], next: 'two' });
      return Response.json({ version: 1, items: [], next: url.searchParams.get('after') });
    };
    const { port } = await start(dataDir, {
      roads: { feedUrl: 'https://raid-show.test/realm/raid-roads', surveyorBase: 'https://collector.test/', recorderPath: recorder.path, fetch: fetcher, now: () => NOW, pollMs: 20, recorderPollMs: 60_000, reconnectMs: 100, streamIdleMs: 5_000, onLiveRaid: live },
    });
    const preview = base.preview;
    await backfilled(port, preview);
    const stream = await events(port, `/map-data/v1/live/${preview}/events`);
    releaseFirst();
    await until(async () => stream.raids(), (raids) => raids.length > 0);
    await until(async () => pulls, (count) => count >= 3);
    expect(stream.raids().map((raid) => raid.id)).toEqual(['pull-fresh']);
    // SSE: announce once the stream has caught up; resend distinct receipts until the runtime says it is ready.
    let at = NOW - 1_000;
    await until(async () => {
      if (sse.length) sse.at(-1)!.enqueue(new TextEncoder().encode(`event: raid\ndata: ${JSON.stringify({ from: { id: TOWN, login: null, name: null }, to: { id: SMALL, login: null, name: null }, viewers: 9, at: at++ })}\n\n`));
      return live.mock.calls.length;
    }, (count) => count > 0);
    const announced = live.mock.calls[0]![0] as AtlasRaid;
    await until(async () => stream.raids(), (raids) => raids.some((raid) => raid.id === announced.id));
    expect(stream.raids().find((raid) => raid.id === announced.id)).toMatchObject({ from: TOWN, to: SMALL, viewers: 9, a: { id: TOWN }, b: { id: SMALL, place: 'waiting' } });
    expect(stream.raids().filter((raid) => raid.id === announced.id)).toHaveLength(1);
    expect(stream.raids().some((raid) => raid.id === 'pull-catch-up')).toBe(false);
  });
});
