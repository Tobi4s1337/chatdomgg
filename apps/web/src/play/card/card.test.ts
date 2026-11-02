// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema } from '@chatdom/shared';
import type { ForgedSource, ForgedThing, PlayContext } from '../slots';
import { CARD_WORDS, cardDate, cardView, citizenFactsOf, initialOf, loadCitizenFacts, loadForged } from './facts';
import { FIXTURE_KINGDOM, FIXTURE_PICTURE, cardFixtureFetcher, fixtureFacts } from './fixture';

/*
 * The card draws only what `cardView` and `loadForged` give it (CardPage.tsx renders exactly these fields), so the
 * page's rules are checked here: no since line without a date, no shelf without a source and real pieces.
 */

const self: PlayContext['self'] = { personId: '990300401', publicName: 'MarigoldWren', lookToken: 'tide' };
const ctx = { kingdomId: FIXTURE_KINGDOM, self } as unknown as PlayContext;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const none = (citizen?: unknown) => ({ version: 1, status: 'none', starter: 'tide', entitlements: null, granted: [], ...(citizen === undefined ? {} : { citizen }) });

describe('loading the card facts', () => {
  it("asks the realm for the person's own reply in this kingdom, with the cookie and never from a cache", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return json(200, none(fixtureFacts())); }) as typeof fetch;
    const result = await loadCitizenFacts(FIXTURE_KINGDOM, new AbortController().signal, fetcher);
    expect(result).toEqual({ kind: 'ready', facts: fixtureFacts() });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`/api/realm/looks/me?kingdom=${FIXTURE_KINGDOM}`);
    expect(calls[0]!.init).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reads anonymous, refusals, untrusted answers and missing facts honestly', async () => {
    const answer = (response: () => Response | Promise<Response>) => loadCitizenFacts(FIXTURE_KINGDOM, new AbortController().signal, (async () => response()) as typeof fetch);
    expect(await answer(() => json(200, { version: 1, status: 'anonymous' }))).toEqual({ kind: 'anonymous' });
    expect(await answer(() => json(401, { version: 1, status: 'refused' }))).toEqual({ kind: 'anonymous' });
    expect(await answer(() => json(503, { version: 1, status: 'unavailable', message: 'x' }))).toEqual({ kind: 'unavailable' });
    expect(await answer(() => new Response('<html>', { status: 200 }))).toEqual({ kind: 'unavailable' });
    expect(await answer(() => json(200, none()))).toEqual({ kind: 'unavailable' });
    expect(await answer(() => { throw new TypeError('offline'); })).toEqual({ kind: 'unavailable' });
    // A picture from anywhere but Twitch's CDN makes the whole answer untrusted.
    expect(await answer(() => json(200, none({ ...fixtureFacts(), picture: 'https://evil.example/me.png' })))).toEqual({ kind: 'unavailable' });
    expect(citizenFactsOf(none({ ...fixtureFacts(), invented: 3 }))).toEqual({ kind: 'unavailable' });
    expect(citizenFactsOf(none({ picture: null, since: null, homes: [] }))).toEqual({ kind: 'ready', facts: { picture: null, since: null, homes: [] } });
  });

  it('rejects when the page is closed, and gives the fixture states as the bench draws them', async () => {
    const closing = new AbortController();
    const pending = loadCitizenFacts(FIXTURE_KINGDOM, closing.signal, cardFixtureFetcher('loading'));
    closing.abort();
    await expect(pending).rejects.toBeDefined();
    const signal = new AbortController().signal;
    expect(await loadCitizenFacts(FIXTURE_KINGDOM, signal, cardFixtureFetcher('ready'))).toMatchObject({ kind: 'ready', facts: { picture: FIXTURE_PICTURE } });
    expect(await loadCitizenFacts(FIXTURE_KINGDOM, signal, cardFixtureFetcher('nopicture'))).toMatchObject({ kind: 'ready', facts: { picture: null } });
    expect(await loadCitizenFacts(FIXTURE_KINGDOM, signal, cardFixtureFetcher('anonymous'))).toEqual({ kind: 'anonymous' });
    expect(await loadCitizenFacts(FIXTURE_KINGDOM, signal, cardFixtureFetcher('unavailable'))).toEqual({ kind: 'unavailable' });
  });
});

describe('what the card shows', () => {
  it('says citizen since only when the realm gives a date, in the kingdom’s words', () => {
    const ready = cardView(self, { kind: 'ready', facts: fixtureFacts() });
    expect(ready).toMatchObject({ name: 'MarigoldWren', initial: 'M', picture: FIXTURE_PICTURE, state: 'ready', note: null,
      since: 'Citizen of Lanternmere since 2 November 2026' });
    expect(ready.homes.map(home => [home.street, home.kingdom, home.here])).toEqual([['Tidewater Lane', 'This kingdom', true], ['Copper Kettle Lane', 'Brackenford', false]]);
    const elsewhere = cardView(self, { kind: 'ready', facts: { ...fixtureFacts(), since: null, homes: fixtureFacts().homes.filter(home => !home.here) } });
    expect(elsewhere.since).toBeNull();
    expect(elsewhere.homes).toHaveLength(1);
    const homeless = cardView(self, { kind: 'ready', facts: { picture: null, since: null, homes: [] } });
    expect(homeless).toMatchObject({ since: null, homes: [], picture: null, note: CARD_WORDS.homeless });
    const unnamed = cardView(self, { kind: 'ready', facts: { picture: null, since: Date.UTC(2026, 10, 2, 12), homes: [{ ...fixtureFacts().homes[0]!, kingdomName: 'this kingdom' }] } });
    expect(unnamed.since).toBe('Citizen of this kingdom since 2 November 2026');
  });

  it('draws one quiet line while loading, one honest line when the realm cannot answer, and asks a visitor to sign in', () => {
    expect(cardView(self, null)).toMatchObject({ state: 'loading', name: 'MarigoldWren', since: null, homes: [], note: CARD_WORDS.loading });
    expect(cardView(self, { kind: 'unavailable' })).toMatchObject({ state: 'unavailable', since: null, homes: [], picture: null, note: 'Your card cannot be read just now.' });
    expect(cardView(self, { kind: 'anonymous' })).toMatchObject({ state: 'anonymous', name: null, initial: '', note: 'Sign in to keep a card here.' });
    expect(cardView(null, { kind: 'ready', facts: fixtureFacts() })).toMatchObject({ name: null, initial: '' });
  });

  it('writes dates the British way and takes a whole first letter', () => {
    expect(cardDate(Date.UTC(2026, 10, 2, 12))).toBe('2 November 2026');
    expect(initialOf('marigoldwren')).toBe('M');
    expect(initialOf('_ohne_')).toBe('O');
    expect(initialOf('élan')).toBe('É');
    expect(initialOf('   ')).toBe('');
  });
});

describe('the forged shelf', () => {
  const thing = (id: string, forgedAt: number, extra: Partial<ForgedThing> = {}): ForgedThing => ({ id, title: `Piece ${id}`, plaque: 'Forged at the anvil.', forgedAt, ...extra });
  const source = (things: unknown): ForgedSource => ({ id: 'test', mine: async () => things as readonly ForgedThing[] });
  const signal = () => new AbortController().signal;

  it('has no shelf without a source, without pieces, or when the source fails', async () => {
    expect(await loadForged(null, ctx, signal())).toBeNull();
    expect(await loadForged(source([]), ctx, signal())).toBeNull();
    expect(await loadForged({ id: 'broken', mine: async () => { throw new Error('down'); } }, ctx, signal())).toBeNull();
    expect(await loadForged(source([{ id: '', title: 'x', plaque: '', forgedAt: 1 }, { id: 'a', title: ' ', plaque: '', forgedAt: 1 }]), ctx, signal())).toBeNull();
    const closing = new AbortController(); closing.abort();
    expect(await loadForged(source([thing('a', 1)]), ctx, closing.signal)).toBeNull();
  });

  it('shows the real pieces, newest first, once each', async () => {
    const paint = () => {};
    const shelf = await loadForged(source([thing('old', 10), thing('new', 30, { paint }), thing('mid', 20), thing('new', 5)]), ctx, signal());
    expect(shelf?.map(piece => piece.id)).toEqual(['new', 'mid', 'old']);
    expect(shelf?.[0]?.paint).toBe(paint);
  });

  it('is asked with the page context and the page signal', async () => {
    let seen: { ctx: PlayContext; signal: AbortSignal } | null = null;
    const pageSignal = signal();
    await loadForged({ id: 'spy', mine: async (c, s) => { seen = { ctx: c, signal: s }; return [thing('a', 1)]; } }, ctx, pageSignal);
    expect(seen).toEqual({ ctx, signal: pageSignal });
    expect(KingdomIdSchema.safeParse(ctx.kingdomId).success).toBe(true);
  });
});
