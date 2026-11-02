import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runImport } from '../import';
import { dabHash } from '../live/frame';
import { WITHHELD_FILE } from '../policy/visibility';
import { createAtlasService } from '../serve';
import { FixtureSource, RECENT, clock, configFor, fakeSurveyor, sweepAt, tempDataDir } from '../test/fixture-source';
import { allowRealImports } from '../test/timeouts';
import { loadLiveTarget } from '../live/target';
import { loadDirectory } from './directory';
import { matchRank, queryKey, searchKey } from './normalize';
import { CardReplySchema, RoadReplySchema, SearchReplySchema } from './schema';

allowRealImports();

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

const CAPITAL = '900000000000000001';
const TOWN = '900000000000000002';
const VILLAGE = '900000000000000003';
const SMALL = '900000000000000004';
const ACCENTED = '900000000000000011';
const WIDE = '900000000000000012';
const ARABIC = '900000000000000013';
const SLOTS = '900000000000000014';
const GONE = '900000000000000015';
const UNSEEN = '900000000000000099';
const DAY = 86_400_000;
const NOW = sweepAt(12);
const NONE: ReadonlySet<string> = new Set();

/** The standard fixture plus names in other scripts, a gambling and a gone channel, and raids touching each kind. */
async function imported(change?: (source: FixtureSource) => void) {
  const source = FixtureSource.standard();
  source.addChannel({ id: ACCENTED, login: 'eloise_cafe', name: 'Éloïse Café', lang: 'fr', firstSweep: 0, lastSweep: 4, live: true, liveMin: 15, viewerMin: 600 });
  source.addChannel({ id: WIDE, login: 'widechannel', name: 'ＷｉｄｅＣｈａｎｎｅｌ', firstSweep: 0, lastSweep: 4, live: false, liveMin: 15, viewerMin: 450 });
  source.addChannel({ id: ARABIC, login: 'marhaba_tv', name: 'مرحبا تي في', lang: 'ar', firstSweep: 0, lastSweep: 4, live: true, liveMin: 15, viewerMin: 900 });
  source.addChannel({ id: SLOTS, login: 'fixture_slots', name: 'Fixture Slots', firstSweep: 0, lastSweep: 4, live: true, liveMin: 15, viewerMin: 9_000, game: ['498566', 'Slots'] });
  source.addChannel({ id: GONE, login: 'fixture_gone', name: 'Fixture Gone', firstSweep: 0, lastSweep: 2, live: false, liveMin: 9, viewerMin: 900, goneAt: sweepAt(3) });
  source.addRaidPair(VILLAGE, CAPITAL, 1, 25, sweepAt(4));
  source.addRaidPair(CAPITAL, TOWN, 1, 300, sweepAt(2));
  source.addRaidPair(CAPITAL, SLOTS, 4, 4_000, sweepAt(4));
  source.addRaidPair(CAPITAL, GONE, 3, 900, sweepAt(1));
  source.addRaidPair(CAPITAL, UNSEEN, 1, 12, sweepAt(3));
  source.addRaidPair(SMALL, CAPITAL, 1, 6, sweepAt(4));
  change?.(source);
  const dataDir = tempDataDir();
  cleanup.push(() => source.close(), () => rmSync(dataDir, { recursive: true, force: true }));
  const outcome = await runImport(configFor(source, dataDir), { fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(sweepAt(10)) });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return { dataDir, preview: outcome.preview.id, revision: outcome.revision };
}

function withhold(dataDir: string, ids: string[]): void {
  mkdirSync(join(dataDir, 'moderation'), { recursive: true });
  const path = join(dataDir, WITHHELD_FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify({ version: 1, updatedAt: sweepAt(20), kingdomIds: ids }));
  renameSync(`${path}.tmp`, path);
}

function ok<T>(value: T | string): T {
  if (typeof value === 'string') throw new Error(`refused: ${value}`);
  return value;
}

describe('search keys', () => {
  it('match across case, accents, compatibility forms and separators, and never across scripts by accident', () => {
    expect(searchKey('Éloïse Café')).toBe('eloise cafe');
    expect(searchKey('ＷｉｄｅＣｈａｎｎｅｌ')).toBe('widechannel');
    expect(searchKey('fixture_capital')).toBe('fixture capital');
    expect(searchKey('Zero​Width‮Name')).toBe('zerowidthname');
    expect(searchKey('Straße')).toBe('straße');
    expect(searchKey('ДЕНИС')).toBe('денис');
    expect(searchKey('が')).toBe(searchKey('か'));
    expect(queryKey('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(queryKey('a'.repeat(51))).toEqual({ ok: false, reason: 'too-long' });
    expect(queryKey('𝓪'.repeat(50))).toMatchObject({ ok: true, length: 50 });
  });

  it('ranks the same name, a beginning, a word and a containing match, keeping one Latin letter from finding everyone', () => {
    expect(matchRank('eloise cafe', 'eloise cafe', 11)).toBe(0);
    expect(matchRank('eloise cafe', 'elo', 3)).toBe(1);
    expect(matchRank('eloise cafe', 'caf', 3)).toBe(2);
    expect(matchRank('eloise cafe', 'ois', 3)).toBe(3);
    expect(matchRank('eloise cafe', 'o', 1)).toBe(-1);
    expect(matchRank('フィクスチャ町', '町', 1)).toBe(3);
  });
});

describe('the register of a preview', () => {
  it('uses the avatar refresh clock for cards and search, never a later live/name confirmation', async () => {
    const avatarAt = sweepAt(1);
    const { dataDir, preview } = await imported(source => source.db.prepare('UPDATE channels SET facts_at = ? WHERE id = ?').run(avatarAt, CAPITAL));
    const register = await loadDirectory(dataDir, preview);
    const fresh = ok(register.card({ id: CAPITAL }, NONE, NOW));
    expect(fresh.portrait).toEqual({ url: expect.stringMatching(/^https:\/\/static-cdn\.jtvnw\.net\//), freshUntil: avatarAt + DAY });
    expect(fresh.channel.freshUntil).toBeGreaterThan(fresh.portrait!.freshUntil);
    expect(ok(register.search('fixture_capital', NONE, NOW)).results[0]!.portrait).toEqual(fresh.portrait);
    expect(ok(register.card({ id: SMALL }, NONE, NOW)).portrait).toBeNull();
    expect(ok(register.card({ id: CAPITAL }, NONE, avatarAt + DAY - 1)).portrait).not.toBeNull();
    expect(ok(register.card({ id: CAPITAL }, NONE, avatarAt + DAY)).portrait).toBeNull();
    expect(ok(register.search('fixture_capital', NONE, avatarAt + DAY)).results[0]!.portrait).toBeNull();
    expect(register.card({ id: CAPITAL }, new Set([CAPITAL]), NOW)).toBe('not-found');
    expect(ok(register.search('fixture_capital', new Set([CAPITAL]), NOW)).results).toEqual([]);
    expect(JSON.stringify(ok(register.road({ id: CAPITAL }, { id: TOWN }, NONE, NOW)))).not.toMatch(/portrait|jtvnw/);
  });

  it('finds names in every script with their original spelling, best match first, and only public channels', async () => {
    const { dataDir, preview, revision } = await imported();
    const register = await loadDirectory(dataDir, preview);
    expect(register.revision).toBe(revision);

    const accented = ok(register.search('eloise', NONE, NOW));
    expect(accented.results.map((r) => r.channel.name)).toEqual(['Éloïse Café']);
    expect(accented.results[0]!.channel).toMatchObject({ login: 'eloise_cafe', place: 'mapped', tier: 3 });

    expect(ok(register.search('Ｗｉｄｅ', NONE, NOW)).results.map((r) => r.channel.id)).toEqual([WIDE]);
    expect(ok(register.search('مرحبا', NONE, NOW)).results.map((r) => r.channel.name)).toEqual(['مرحبا تي في']);
    expect(ok(register.search('町', NONE, NOW)).results.map((r) => r.channel.id)).toEqual([TOWN]);

    // "fixture": the capital first (largest), the small stream waits without land; gambling and gone are never found.
    const fixture = ok(register.search('fixture', NONE, NOW));
    expect(fixture.results.map((r) => r.channel.id)).toEqual([CAPITAL, TOWN, VILLAGE, SMALL]);
    expect(fixture.results.at(-1)!.channel).toMatchObject({ place: 'waiting', ordinal: null, tier: null });
    expect(JSON.stringify(fixture)).not.toMatch(/slots|gone/i);
    expect(ok(register.search('fixture slots', NONE, NOW)).results).toEqual([]);

    // An exact login outranks a larger channel that merely begins with it.
    expect(ok(register.search('fixture_town', NONE, NOW)).results[0]!.channel.id).toBe(TOWN);
    expect(register.search('', NONE, NOW)).toBe('empty');
    expect(SearchReplySchema.parse(fixture).asOf).toBeGreaterThan(0);
  });

  it('always serves names between imports, withholds at once, and still expires stream titles', async () => {
    const { dataDir, preview } = await imported();
    const register = await loadDirectory(dataDir, preview);
    const withheld = new Set([VILLAGE]);
    expect(ok(register.search('fixture', withheld, NOW)).results.map((r) => r.channel.id)).not.toContain(VILLAGE);
    expect(register.card({ id: VILLAGE }, withheld, NOW)).toBe('not-found');
    expect(register.card({ login: 'fixture_village' }, withheld, NOW)).toBe('not-found');
    expect(ok(register.card({ id: CAPITAL }, withheld, NOW)).roads!.strongest.map((r) => r.other.id)).not.toContain(VILLAGE);

    const later = sweepAt(4) + DAY + 1;
    expect(ok(register.search('fixture', NONE, later)).results.length).toBeGreaterThan(0);
    expect(ok(register.card({ login: 'fixture_capital' }, NONE, later)).channel.name).toBe('Fixture Capital');
    expect(register.card({ id: VILLAGE }, withheld, later)).toBe('not-found');
    // Names remain public; stale stream titles still disappear.
    const bare = ok(register.card({ id: CAPITAL }, NONE, later));
    expect(bare.channel).toMatchObject({ name: 'Fixture Capital', login: 'fixture_capital', freshUntil: later + DAY, place: 'mapped' });
    expect(bare.stream).toBeNull();
    expect(JSON.stringify(bare)).not.toMatch(/A fixture stream/);
  });

  it('gives a card the last stream and its three strongest roads, leaving out what the gate hides', async () => {
    const { dataDir, preview } = await imported();
    const register = await loadDirectory(dataDir, preview);
    const card = CardReplySchema.parse(ok(register.card({ login: 'fixture_capital' }, NONE, NOW)));
    expect(card.channel).toMatchObject({ id: CAPITAL, name: 'Fixture Capital', place: 'mapped', tier: 0 });
    expect(card.stream).toMatchObject({ live: true, game: 'Just Chatting', title: 'A fixture stream', viewers: 30 });
    expect(card.coverage).toEqual({ raidWatch: { enabled: true, watching: 2, liveCandidates: expect.any(Number) }, contentLabels: 'not-collected' });
    // Gambling and gone counterparts are not roads at all; an unseen target is a road to an unnamed, unplaced channel.
    expect(card.roads!.total).toBe(4);
    expect(card.roads!.strongest.map((r) => [r.other.id, r.sent, r.received])).toEqual([[VILLAGE, 2, 1], [TOWN, 1, 0], [UNSEEN, 1, 0]]);
    expect(card.roads!.strongest[0]!.travellers).toBe(165);
    expect(JSON.stringify(card)).not.toMatch(new RegExp(`${SLOTS}|${GONE}`));
    expect(card.roads!.strongest[2]!.other).toEqual({ id: UNSEEN, login: null, name: null, freshUntil: null, place: 'unseen', ordinal: null, tier: null, region: null, realm: null });
    const small = ok(register.card({ id: SMALL }, NONE, NOW));
    expect(small.channel).toMatchObject({ place: 'waiting', name: 'Fixture Small', ordinal: null });
    expect(small.roads!.strongest.map((r) => [r.other.id, r.sent, r.received])).toEqual([[CAPITAL, 1, 0]]);

    // A dab is found by its live hash while named; a holding never is.
    expect(ok(register.card({ dab: dabHash(SMALL) }, NONE, NOW)).channel.login).toBe('fixture_small');
    expect(register.card({ dab: dabHash(CAPITAL) }, NONE, NOW)).toBe('not-found');
    expect(register.card({ id: SLOTS }, NONE, NOW)).toBe('not-found');
    expect(register.card({ id: GONE }, NONE, NOW)).toBe('not-found');
  });

  it('answers a road with what was seen each way, or that nothing was, never inventing a raid', async () => {
    const { dataDir, preview } = await imported();
    const register = await loadDirectory(dataDir, preview);
    const road = RoadReplySchema.parse(ok(register.road({ login: 'fixture_capital' }, { login: 'fixture_village' }, NONE, NOW)));
    expect(road.aToB).toEqual({ raids: 2, travellers: 140, lastAt: sweepAt(3) + 10_000 });
    expect(road.bToA).toEqual({ raids: 1, travellers: 25, lastAt: sweepAt(4) });
    const none = ok(register.road({ id: TOWN }, { id: VILLAGE }, NONE, NOW));
    expect([none.aToB, none.bToA]).toEqual([null, null]);
    expect(register.road({ id: CAPITAL }, { id: SLOTS }, NONE, NOW)).toBe('not-found');
    expect(register.road({ id: CAPITAL }, { id: CAPITAL }, NONE, NOW)).toBe('not-found');
    expect(register.road({ id: CAPITAL }, { id: VILLAGE }, new Set([VILLAGE]), NOW)).toBe('not-found');
  });

  it('refuses to build from an inventory that fails its pinned hash', async () => {
    const { dataDir, preview, revision } = await imported();
    const path = join(dataDir, 'revisions', revision, 'channels.ndjson');
    writeFileSync(path, '{"kingdomId":"1"}\n', { flag: 'a' });
    await expect(loadDirectory(dataDir, preview)).rejects.toThrow(/pinned hash/);
  });
});

function get(port: number, path: string): Promise<{ status: number; text: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (chunk: Buffer) => parts.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(parts).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('register routes', () => {
  it('serves search, cards and roads below /map-data, revalidated on every use, and nothing else', async () => {
    const { dataDir, preview } = await imported();
    const service = createAtlasService(dataDir, () => {}, { now: () => NOW });
    await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => service.close());
    const port = (service.server.address() as AddressInfo).port;
    const base = `/map-data/v1/preview/${preview}`;

    const search = await get(port, `${base}/search?q=${encodeURIComponent('Éloïse')}`);
    expect(search.status).toBe(200);
    expect(search.headers['cache-control']).toBe('no-cache');
    expect(SearchReplySchema.parse(JSON.parse(search.text)).results[0]!.channel.id).toBe(ACCENTED);
    expect(JSON.parse(search.text).results[0]).not.toHaveProperty('portrait');
    const picturedSearch = JSON.parse((await get(port, `${base}/search?q=fixture_capital&portraits=1`)).text);
    expect(picturedSearch.results[0].portrait).toMatchObject({ freshUntil: sweepAt(4) + DAY });
    const olderCard = JSON.parse((await get(port, `${base}/card/${CAPITAL}`)).text);
    expect(olderCard).not.toHaveProperty('portrait');
    const picturedCard = JSON.parse((await get(port, `${base}/card/${CAPITAL}?portraits=1`)).text);
    expect(picturedCard.portrait).toEqual(picturedSearch.results[0].portrait);

    expect(CardReplySchema.parse(JSON.parse((await get(port, `${base}/card/${CAPITAL}`)).text)).channel.id).toBe(CAPITAL);
    expect(CardReplySchema.parse(JSON.parse((await get(port, `${base}/card/login/fixture_town`)).text)).channel.id).toBe(TOWN);
    expect(CardReplySchema.parse(JSON.parse((await get(port, `${base}/card/dab/${dabHash(SMALL)}`)).text)).channel.id).toBe(SMALL);
    expect(RoadReplySchema.parse(JSON.parse((await get(port, `${base}/road/login/fixture_capital/fixture_village`)).text)).aToB?.raids).toBe(2);
    expect(RoadReplySchema.parse(JSON.parse((await get(port, `${base}/road/${CAPITAL}/${VILLAGE}`)).text)).bToA?.raids).toBe(1);

    expect(await get(port, `${base}/search?q=`)).toMatchObject({ status: 400, text: '{"error":"query-empty"}' });
    expect(await get(port, `${base}/card/${SLOTS}`)).toMatchObject({ status: 404, text: '{"error":"not-found"}' });
    expect(await get(port, `${base}/card/login/FIXTURE_TOWN`)).toMatchObject({ status: 404 });
    expect(await get(port, `${base}/card/../names`)).toMatchObject({ status: 404 });
    expect(await get(port, `/map-data/v1/preview/pv-20990101T000000Z-000000000000/search?q=x`)).toMatchObject({ status: 404 });
    expect((await get(port, `${base}/search?q=${'x'.repeat(300)}`)).status).toBe(414);

    // Withholding reaches the next request; an unreadable list answers nothing at all.
    withhold(dataDir, [TOWN]);
    expect(await get(port, `${base}/card/login/fixture_town`)).toMatchObject({ status: 404 });
    writeFileSync(join(dataDir, WITHHELD_FILE), '{"version":1,"kingdomIds":[');
    expect(await get(port, `${base}/search?q=fixture`)).toMatchObject({ status: 503, text: '{"error":"names-unavailable"}' });
  });
});

describe('register places and facts', () => {
  it('places holdings at their holding point and waiting channels at their pencil place, and gates faces', async () => {
    const { dataDir, preview } = await imported();
    const register = await loadDirectory(dataDir, preview);
    const target = await loadLiveTarget(dataDir, preview);
    const capital = target.ordinalOf.get(CAPITAL)!;
    const holding = target.holdingGeometry![capital]!;
    expect(register.position(CAPITAL)).toEqual({ x: holding.x, y: holding.y });
    expect(register.facts(CAPITAL)).toEqual({ average: 6_000, region: holding.region, realm: target.realmOf[capital], ordinal: capital, language: 'en' });
    // A waiting channel stands where search and its card already put it.
    const waiting = ok(register.search('fixture_small', NONE, NOW, false, true)).results[0]!;
    expect(register.position(SMALL)).toEqual(waiting.position);
    expect(register.facts(SMALL)).toMatchObject({ average: 8, ordinal: null, language: 'en' });
    expect(register.position(UNSEEN)).toBeNull();
    expect(register.facts(UNSEEN)).toEqual({ average: null, region: null, realm: null, ordinal: null, language: null });
    expect(register.face(UNSEEN, NONE, NOW)).toMatchObject({ id: UNSEEN, place: 'unseen', name: null });
    expect(register.face(CAPITAL, new Set([CAPITAL]), NOW)).toBeNull();
    expect(register.face(SLOTS, NONE, NOW)).toBeNull();
    expect(register.face(GONE, NONE, NOW)).toBeNull();
    expect(register.resolve({ login: 'fixture_town' })).toBe(TOWN);
    expect(register.stream(CAPITAL, NOW)).toMatchObject({ live: true, game: 'Just Chatting' });
    expect(register.stream(CAPITAL, NOW + 2 * DAY)).toBeNull();
    // The live frame's slots and dabs name only public channels.
    const slots = new Uint8Array(target.ids.length * 2);
    slots[capital * 2] = 1;
    const slotsOrdinal = target.ordinalOf.get(SLOTS);
    if (slotsOrdinal !== undefined) slots[slotsOrdinal * 2] = 2;
    expect([...register.liveIds({ slots, dabs: [{ channelHash: dabHash(SMALL) }, { channelHash: dabHash(UNSEEN) }] })].sort()).toEqual([CAPITAL, SMALL]);
  });
});
