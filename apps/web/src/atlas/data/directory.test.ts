import { describe, expect, it } from 'vitest';
import {
  dabHashOf, DirectoryError, fetchCard, fetchRoad, fetchSearch, validateCard, validateRoad, validateSearch, type ChannelFace,
} from './directory';

const PREVIEW = 'pv-20261031T133817Z-9303798faebf';
const BASE = '/map-data';
const AT = Date.UTC(2026, 9, 31, 13, 38);

const mapped = (over: Partial<ChannelFace> = {}): ChannelFace => ({
  id: '641972806', login: 'kaicenat', name: 'KaiCenat', freshUntil: AT + 86_400_000, place: 'mapped', ordinal: 3, tier: 0, region: 1, realm: 4, ...over,
});
const unseen: ChannelFace = { id: '900000000000000099', login: null, name: null, freshUntil: null, place: 'unseen', ordinal: null, tier: null, region: null, realm: null };
const head = (kind: string) => ({ version: 1, preview: PREVIEW, revision: 'obs-20261031T133817Z-82eb04a53567', servedAt: AT, asOf: AT, kind });
const coverage = { raidWatch: { enabled: true, watching: 7474, liveCandidates: 9000 }, contentLabels: 'not-collected' };
const window = { from: AT - 46 * 3_600_000, to: AT };

const search = (results: unknown[]) => ({ ...head('chatdom-atlas-search'), key: 'kai', results, more: false });
const card = (over: Record<string, unknown> = {}) => ({
  ...head('chatdom-atlas-card'), channel: mapped(), average: 63_559, language: 'en', firstSeenAt: window.from, lastLiveAt: AT,
  stream: { live: false, game: 'Just Chatting', title: 'AMP HALLOWEEN PARTY', viewers: 59_945, startedAt: AT - 3_600_000 },
  roads: { window, total: 2, strongest: [{ other: unseen, sent: 1, received: 0, travellers: 12, lastAt: AT }] }, coverage, ...over,
});
const road = (over: Record<string, unknown> = {}) => ({
  ...head('chatdom-atlas-road'), a: mapped(), b: mapped({ id: '5', login: 'chrisnxtdoor', name: 'Chrisnxtdoor', ordinal: 9 }),
  aToB: { raids: 1, travellers: 36_108, lastAt: AT }, bToA: null, window, coverage, ...over,
});

function answering(status: number, body: unknown, headers: Record<string, string> = {}) {
  const urls: string[] = [];
  const source = {
    base: BASE,
    fetch: (async (url: RequestInfo | URL) => {
      urls.push(String(url));
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
    }) as typeof fetch,
  };
  return { source, urls };
}

describe('register replies', () => {
  it('accepts a named search result and refuses an unnamed or unseen one', () => {
    expect(validateSearch(search([{ channel: mapped(), average: 63_559, language: 'en' }]), PREVIEW).results).toHaveLength(1);
    expect(() => validateSearch(search([{ channel: mapped({ login: null, name: null, freshUntil: null }), average: 1, language: 'en' }]), PREVIEW)).toThrow(/named, observed/);
    expect(() => validateSearch(search([{ channel: unseen, average: 1, language: 'en' }]), PREVIEW)).toThrow();
  });

  it('refuses a face whose name, login and freshness do not travel together', () => {
    expect(() => validateCard(card({ channel: mapped({ freshUntil: null }) }), PREVIEW)).toThrow(/together/);
    expect(() => validateCard(card({ channel: mapped({ name: null }) }), PREVIEW)).toThrow(/together/);
  });

  it('refuses land facts on a channel without land and a realm on an unseen one', () => {
    expect(() => validateCard(card({ channel: mapped({ place: 'waiting' }) }), PREVIEW)).toThrow(/mapped land/);
    expect(() => validateCard(card({ channel: mapped({ ordinal: null }) }), PREVIEW)).toThrow(/mapped land/);
    const misplaced = { ...unseen, realm: 2, region: 1 };
    expect(() => validateCard(card({ roads: { window, total: 1, strongest: [{ other: misplaced, sent: 1, received: 0, travellers: 1, lastAt: AT }] } }), PREVIEW)).toThrow(/realm unless unseen/);
  });

  it('refuses a card for an unseen channel, another preview, extra fields and more than three roads', () => {
    expect(() => validateCard(card({ channel: unseen }), PREVIEW)).toThrow();
    expect(() => validateCard(card(), 'pv-20261030T052009Z-000000000000')).toThrow();
    expect(() => validateCard({ ...card(), privateNotes: 'never public' }, PREVIEW)).toThrow();
    const four = Array.from({ length: 4 }, () => ({ other: unseen, sent: 1, received: 0, travellers: 1, lastAt: AT }));
    expect(() => validateCard(card({ roads: { window, total: 4, strongest: four } }), PREVIEW)).toThrow();
  });

  it('accepts short-lived card and search pictures, preserves older replies and refuses an unbounded or foreign image', () => {
    const portrait = { url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/channel-70x70.png', freshUntil: AT + 86_400_000 };
    expect(validateCard(card({ portrait }), PREVIEW).portrait).toEqual(portrait);
    expect(validateSearch(search([{ channel: mapped(), portrait, average: 1, language: 'en' }]), PREVIEW).results[0]!.portrait).toEqual(portrait);
    expect(validateCard(card(), PREVIEW).portrait).toBeUndefined();
    expect(validateCard(card({ portrait: null }), PREVIEW).portrait).toBeNull();
    expect(() => validateCard(card({ portrait: { ...portrait, url: 'https://example.invalid/a.png' } }), PREVIEW)).toThrow();
    expect(() => validateCard(card({ portrait: { ...portrait, freshUntil: AT + 2 * 86_400_000 } }), PREVIEW)).toThrow(/source day/);
    expect(() => validateSearch(search([{ channel: mapped(), portrait: { ...portrait, freshUntil: AT + 2 * 86_400_000 }, average: 1, language: 'en' }]), PREVIEW)).toThrow(/source day/);
  });

  it('accepts a road with one way unseen and refuses a tally with no raid', () => {
    expect(validateRoad(road(), PREVIEW).bToA).toBeNull();
    expect(() => validateRoad(road({ bToA: { raids: 0, travellers: 0, lastAt: AT } }), PREVIEW)).toThrow();
  });

  it('hashes a channel ID as the shared dab hash', () => {
    expect(dabHashOf('641972806')).toMatch(/^[a-f0-9]{16}$/);
    expect(dabHashOf('641972806')).toBe(dabHashOf('641972806'));
    expect(dabHashOf('641972806')).not.toBe(dabHashOf('641972807'));
  });
});

describe('register reads', () => {
  it('asks the preview’s own search, card and road paths', async () => {
    const s = answering(200, search([]));
    await fetchSearch(s.source, PREVIEW, 'Éloïse café');
    expect(s.urls[0]).toBe(`${BASE}/v1/preview/${PREVIEW}/search?q=%C3%89lo%C3%AFse%20caf%C3%A9&portraits=1`);
    const c = answering(200, card());
    await fetchCard(c.source, PREVIEW, { login: 'kaicenat' });
    expect(c.urls[0]).toBe(`${BASE}/v1/preview/${PREVIEW}/card/login/kaicenat?portraits=1`);
    const r = answering(200, road());
    await fetchRoad(r.source, PREVIEW, { login: 'kaicenat' }, { login: 'chrisnxtdoor' });
    expect(r.urls[0]).toBe(`${BASE}/v1/preview/${PREVIEW}/road/login/kaicenat/chrisnxtdoor`);
  });

  it('refuses a card that answers for another channel', async () => {
    const { source } = answering(200, card());
    await expect(fetchCard(source, PREVIEW, { login: 'xqc' })).rejects.toMatchObject({ reason: 'invalid' });
    await expect(fetchCard(source, PREVIEW, { id: '1' })).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('turns lookups that cannot be a channel away before asking', async () => {
    const { source, urls } = answering(200, card());
    await expect(fetchCard(source, PREVIEW, { login: 'Not A Login' })).rejects.toMatchObject({ reason: 'not-found' });
    await expect(fetchCard(source, PREVIEW, { dab: 'xyz' })).rejects.toMatchObject({ reason: 'not-found' });
    await expect(fetchRoad(source, PREVIEW, { id: '1' }, { login: 'xqc' })).rejects.toMatchObject({ reason: 'not-found' });
    expect(urls).toHaveLength(0);
  });

  it('names each way the register can decline', async () => {
    const cases: [number, unknown, Record<string, string>, DirectoryError['reason']][] = [
      [404, { error: 'not-found' }, {}, 'not-found'],
      [400, { error: 'query-too-long' }, {}, 'bad-query'],
      [503, { error: 'warming' }, { 'retry-after': '7' }, 'warming'],
      [503, { error: 'names-unavailable' }, {}, 'refused'],
      [503, { error: 'register-unavailable' }, {}, 'unavailable'],
      [500, 'oops', {}, 'unavailable'],
      [200, '{not json', {}, 'invalid'],
    ];
    for (const [status, body, headers, reason] of cases) {
      const { source } = answering(status, body, headers);
      const error = await fetchSearch(source, PREVIEW, 'kai').catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(DirectoryError);
      expect((error as DirectoryError).reason).toBe(reason);
      if (reason === 'warming') expect((error as DirectoryError).retryAfter).toBe(7);
    }
  });

  it('says unavailable when the register cannot be reached', async () => {
    const source = { base: BASE, fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch };
    await expect(fetchSearch(source, PREVIEW, 'kai')).rejects.toMatchObject({ reason: 'unavailable' });
  });
});
