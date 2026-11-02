import { createServer as createNetServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ENTITLEMENTS } from '@chatdom/content/avatar-style';
import { KingdomIdSchema, PersonIdSchema, RealmCitizenFactsSchema, RealmLookMineReplySchema, type PersonId } from '@chatdom/shared';
import { referenceServices } from '../reference';
import { createRealmServer } from '../server';
import { MemoryCitizenFacts, UNNAMED_ELSEWHERE, citizenFactsFrom, createPostgresCitizenFacts, createTwitchPictures, twitchCredentialsFromEnv, type TwitchPictures } from './citizen';
import { UNNAMED_KINGDOM } from './entitlements';
import { mountLookRoutes } from './http';
import { MemoryLookRepository } from './memory-repository';
import type { LookSessions } from './ports';
import { csrfFor, readCookie } from './session';
import { LookStore } from './store';

const WREN = PersonIdSchema.parse('990300301'), OTTER = PersonIdSchema.parse('990300302');
const SALTMARSH = KingdomIdSchema.parse('990300011'), FENWICK = KingdomIdSchema.parse('990300012'), MOOR = KingdomIdSchema.parse('990300013');
const NAMES = new Map([[SALTMARSH, 'SIMULATED Saltmarsh'], [FENWICK, 'SIMULATED Fenwick']]);
const PICTURE = 'https://static-cdn.jtvnw.net/jtv_user_pictures/simulated-wren-profile_image-300x300.png';
const GRANTED = Date.UTC(2026, 10, 2, 18, 30), EARLIER = Date.UTC(2026, 7, 14, 20, 0);

describe('citizen facts', () => {
  it('puts the asked kingdom first, dates it from its deed, and keeps at most three homes', () => {
    const facts = citizenFactsFrom({ kingdomId: SALTMARSH, name: id => NAMES.get(id), picture: PICTURE, deeds: [
      { kingdomId: FENWICK, plotId: 'plot:fenwick:4', street: 'Reedbank Lane', allocatedMs: EARLIER },
      { kingdomId: SALTMARSH, plotId: 'plot:saltmarsh:12', street: 'Tidewater Lane', allocatedMs: GRANTED },
      { kingdomId: MOOR, plotId: 'plot:moor:1', street: 'Heather Lane', allocatedMs: EARLIER + 1 },
      { kingdomId: KingdomIdSchema.parse('990300014'), plotId: 'plot:x:1', street: 'Far Lane', allocatedMs: EARLIER + 2 },
    ] });
    expect(RealmCitizenFactsSchema.parse(facts)).toEqual({ picture: PICTURE, since: GRANTED, homes: [
      { kingdomId: SALTMARSH, kingdomName: 'SIMULATED Saltmarsh', street: 'Tidewater Lane', plotId: 'plot:saltmarsh:12', since: GRANTED, here: true },
      { kingdomId: FENWICK, kingdomName: 'SIMULATED Fenwick', street: 'Reedbank Lane', plotId: 'plot:fenwick:4', since: EARLIER, here: false },
      { kingdomId: MOOR, kingdomName: UNNAMED_ELSEWHERE, street: 'Heather Lane', plotId: 'plot:moor:1', since: EARLIER + 1, here: false },
    ] });
  });

  it('says this kingdom for an unnamed home here, and has no since without a home here', () => {
    const here = citizenFactsFrom({ kingdomId: MOOR, name: id => NAMES.get(id), picture: null,
      deeds: [{ kingdomId: MOOR, plotId: 'plot:moor:1', street: 'Heather Lane', allocatedMs: GRANTED }] });
    expect(here.homes[0]).toMatchObject({ kingdomName: UNNAMED_KINGDOM, here: true });
    expect(UNNAMED_KINGDOM).toBe('this kingdom');
    const elsewhere = citizenFactsFrom({ kingdomId: SALTMARSH, name: id => NAMES.get(id), picture: null,
      deeds: [{ kingdomId: FENWICK, plotId: 'plot:fenwick:4', street: 'Reedbank Lane', allocatedMs: EARLIER }] });
    expect(elsewhere).toMatchObject({ since: null, homes: [{ here: false, kingdomName: 'SIMULATED Fenwick' }] });
    expect(citizenFactsFrom({ kingdomId: SALTMARSH, name: () => undefined, picture: null, deeds: [] })).toEqual({ picture: null, since: null, homes: [] });
  });

  it('accepts only a picture on the Twitch static CDN', () => {
    for (const bad of ['http://static-cdn.jtvnw.net/a.png', 'https://static-cdn.jtvnw.net.example/a.png', 'https://evil.example/https://static-cdn.jtvnw.net/a.png',
      'https://user:pw@static-cdn.jtvnw.net/a.png', `https://static-cdn.jtvnw.net/${'a'.repeat(512)}.png`, 'javascript:alert(1)']) {
      expect(RealmCitizenFactsSchema.safeParse({ picture: bad, since: null, homes: [] }).success, bad).toBe(false);
      expect(citizenFactsFrom({ kingdomId: SALTMARSH, name: () => undefined, picture: bad, deeds: [] }).picture, bad).toBeNull();
    }
    expect(RealmCitizenFactsSchema.safeParse({ picture: PICTURE, since: null, homes: [] }).success).toBe(true);
  });

  it('reads deeds from Postgres rows, skipping placements it cannot read, and waits for the picture only so long', async () => {
    const asked: unknown[][] = [];
    const pool = { query: async (_sql: string, values: unknown[]) => { asked.push(values); return { rows: [
      { kingdom_id: SALTMARSH, plot_id: 'plot:saltmarsh:12', placement: JSON.stringify({ id: 'plot:saltmarsh:12', street: 'Tidewater Lane' }), allocated_ms: String(GRANTED) },
      { kingdom_id: FENWICK, plot_id: 'plot:fenwick:4', placement: '{not json', allocated_ms: String(EARLIER) },
      { kingdom_id: MOOR, plot_id: 'plot:moor:1', placement: JSON.stringify({ id: 'plot:moor:1' }), allocated_ms: String(EARLIER) },
    ] }; } } as never;
    const slow: TwitchPictures = { picture: () => new Promise(resolve => setTimeout(() => resolve(PICTURE), 200)) };
    const facts = createPostgresCitizenFacts({ pool, origin: 'simulated', name: id => NAMES.get(id), pictures: slow, pictureBudgetMs: 20 });
    expect(await facts.facts(WREN, SALTMARSH)).toEqual({ picture: null, since: GRANTED,
      homes: [{ kingdomId: SALTMARSH, kingdomName: 'SIMULATED Saltmarsh', street: 'Tidewater Lane', plotId: 'plot:saltmarsh:12', since: GRANTED, here: true }] });
    expect(asked).toEqual([[WREN, 'simulated']]);
    expect(await facts.facts(WREN, null)).toBeNull();
    const quick = createPostgresCitizenFacts({ pool, origin: 'simulated', name: id => NAMES.get(id), pictures: { picture: async () => PICTURE } });
    expect((await quick.facts(WREN, SALTMARSH))?.picture).toBe(PICTURE);
    const broken = createPostgresCitizenFacts({ pool, origin: 'simulated', name: () => undefined, pictures: { picture: async () => { throw new Error('SIMULATED'); } } });
    expect((await broken.facts(WREN, SALTMARSH))?.picture).toBeNull();
  });
});

describe('Twitch pictures', () => {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const credentials = { clientId: 'SIMULATED-client', clientSecret: 'SIMULATED-secret' };

  it('asks nothing without credentials, and reads them only when both are set', async () => {
    let calls = 0;
    const pictures = createTwitchPictures(null, (async () => { calls++; return reply(200, {}); }) as typeof fetch);
    expect(await pictures.picture(WREN)).toBeNull();
    expect(calls).toBe(0);
    expect(twitchCredentialsFromEnv({ TWITCH_CLIENT_ID: 'a' })).toBeNull();
    expect(twitchCredentialsFromEnv({ TWITCH_CLIENT_ID: 'a', TWITCH_CLIENT_SECRET: ' ' })).toBeNull();
    expect(twitchCredentialsFromEnv({ TWITCH_CLIENT_ID: 'a', TWITCH_CLIENT_SECRET: 'b' })).toEqual({ clientId: 'a', clientSecret: 'b' });
  });

  it('takes the profile picture with an app token, keeps it, and refuses one off the CDN', async () => {
    const urls: string[] = [];
    let image = PICTURE, failing = false;
    const fetcher = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input); urls.push(url);
      if (url.startsWith('https://id.twitch.tv/oauth2/token')) return reply(200, { access_token: 'SIMULATED-token', expires_in: 3600 });
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer SIMULATED-token');
      expect(new Headers(init?.headers).get('client-id')).toBe('SIMULATED-client');
      if (failing) return reply(503, {});
      const id = new URL(url).searchParams.get('id');
      return reply(200, { data: [{ id, login: 'simulated', profile_image_url: image }] });
    }) as typeof fetch;
    const pictures = createTwitchPictures(credentials, fetcher);
    expect(await pictures.picture(WREN)).toBe(PICTURE);
    expect(await pictures.picture(WREN)).toBe(PICTURE);
    expect(urls.filter(url => url.includes('/helix/users'))).toEqual([`https://api.twitch.tv/helix/users?id=${WREN}`]);
    image = 'https://evil.example/picture.png';
    expect(await pictures.picture(OTTER)).toBeNull();
    // A failed read is not remembered: the next ask goes to Twitch again.
    const fresh = createTwitchPictures(credentials, fetcher);
    failing = true;
    expect(await fresh.picture(WREN)).toBeNull();
    failing = false; image = PICTURE;
    expect(await fresh.picture(WREN)).toBe(PICTURE);
    const refused = createTwitchPictures(credentials, (async () => reply(400, {})) as typeof fetch);
    expect(await refused.picture(WREN)).toBeNull();
    const thrown = createTwitchPictures(credentials, (async () => { throw new TypeError('SIMULATED network'); }) as typeof fetch);
    expect(await thrown.picture(WREN)).toBeNull();
  });
});

/** `GET /looks/me` on the realm's real uWS app, over real HTTP, with memory facts. */
describe('the card facts on GET /looks/me', () => {
  const handles = new Map<string, PersonId>([['handle-wren-SIMULATED-0123456789', WREN], ['handle-otter-SIMULATED-0123456789', OTTER]]);
  const sessions: LookSessions = { async resolve(cookie) {
    const handle = readCookie(cookie, 'chatdom_session'), personId = handle ? handles.get(handle) : undefined;
    return handle && personId ? { personId, csrfToken: csrfFor(handle) } : null;
  } };
  const kingdom = { id: SALTMARSH, name: 'SIMULATED Saltmarsh', colours: ['#41677d', '#e5d8b7'] as const };
  const store = new LookStore({ repository: new MemoryLookRepository(), origin: 'simulated',
    records: { entitlements: async () => ({ kind: 'records', entitlements: NO_ENTITLEMENTS(kingdom, 'simulated') }) } });
  const facts = new MemoryCitizenFacts(id => NAMES.get(id))
    .settle(WREN, { kingdomId: SALTMARSH, plotId: 'plot:saltmarsh:12', street: 'Tidewater Lane', allocatedMs: GRANTED })
    .settle(WREN, { kingdomId: FENWICK, plotId: 'plot:fenwick:4', street: 'Reedbank Lane', allocatedMs: EARLIER })
    .picture(WREN, PICTURE)
    .settle(OTTER, { kingdomId: MOOR, plotId: 'plot:moor:2', street: 'Heather Lane', allocatedMs: EARLIER });
  const { server, transport } = createRealmServer(referenceServices());
  const logged: string[] = [];
  let origin = '';
  const as = (person: 'wren' | 'otter') => ({ cookie: `chatdom_session=handle-${person}-SIMULATED-0123456789` });
  const mine = async (query: string, headers: Record<string, string> = {}) => {
    const response = await fetch(`${origin}/api/realm/looks/me${query}`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return RealmLookMineReplySchema.parse(await response.json());
  };

  beforeAll(async () => {
    mountLookRoutes(transport.app, { store, sessions, citizen: facts, log: line => logged.push(line) });
    const probe = createNetServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address(); if (!address || typeof address === 'string') throw new Error('No test port');
    await new Promise<void>(resolve => probe.close(() => resolve()));
    await server.listen(address.port, '127.0.0.1');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { await server.gracefullyShutdown(false); });

  it("gives the session's own person their facts in the asked kingdom", async () => {
    const reply = await mine(`?kingdom=${SALTMARSH}`, as('wren'));
    expect(reply).toMatchObject({ status: 'none', citizen: { picture: PICTURE, since: GRANTED, homes: [
      { kingdomId: SALTMARSH, street: 'Tidewater Lane', here: true }, { kingdomId: FENWICK, kingdomName: 'SIMULATED Fenwick', here: false }] } });
  });

  it('gives another session only its own facts, with the unnamed kingdom worded as this kingdom', async () => {
    const reply = await mine(`?kingdom=${MOOR}`, as('otter'));
    expect(reply.status).toBe('none');
    if (reply.status === 'anonymous') return;
    expect(reply.citizen).toEqual({ picture: null, since: EARLIER,
      homes: [{ kingdomId: MOOR, kingdomName: 'this kingdom', street: 'Heather Lane', plotId: 'plot:moor:2', since: EARLIER, here: true }] });
    expect(JSON.stringify(reply)).not.toContain('Tidewater');
    const elsewhere = await mine(`?kingdom=${SALTMARSH}`, as('otter'));
    expect(elsewhere).toMatchObject({ citizen: { since: null, homes: [{ kingdomName: UNNAMED_ELSEWHERE, here: false }] } });
  });

  it('gives none to anonymous visitors or without a kingdom', async () => {
    expect(await mine(`?kingdom=${SALTMARSH}`)).toEqual({ version: 1, status: 'anonymous' });
    expect(await mine(`?kingdom=${SALTMARSH}`, { cookie: 'chatdom_session=someone-elses-handle-SIMULATED' })).toEqual({ version: 1, status: 'anonymous' });
    expect(await mine('', as('wren'))).not.toHaveProperty('citizen');
  });

  it('leaves the facts out when they cannot be read, and still answers', async () => {
    facts.failing = true;
    try {
      const reply = await mine(`?kingdom=${SALTMARSH}`, as('wren'));
      expect(reply.status).toBe('none');
      expect(reply).not.toHaveProperty('citizen');
      expect(logged.at(-1)).toBe('citizen facts unavailable: Error');
    } finally { facts.failing = false; }
  });
});
