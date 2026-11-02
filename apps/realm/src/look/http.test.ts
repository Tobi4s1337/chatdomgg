import { createServer as createNetServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ENTITLEMENTS, starterLookRecipe, wearPiece, type CitizenEntitlements, type CitizenLook } from '@chatdom/content/avatar-style';
import { KingdomIdSchema, PersonIdSchema, RealmLookMineReplySchema, RealmLookRecipeReplySchema, RealmLookSaveReplySchema, lookRecipeUrl, type PersonId } from '@chatdom/shared';
import { referenceServices } from '../reference';
import { createRealmServer } from '../server';
import { mountLookRoutes } from './http';
import { MemoryLookRepository } from './memory-repository';
import type { LookSessions } from './ports';
import { csrfFor, readCookie } from './session';
import { LookStore } from './store';
import { canonicalLook } from './token';

const WREN = PersonIdSchema.parse('990300201'), KINGDOM = KingdomIdSchema.parse('990300002');
const HOME = { id: KINGDOM, name: 'SIMULATED Saltmarsh', colours: ['#41677d', '#e5d8b7'] as const };
const look = (): CitizenLook => starterLookRecipe('tide')!;

/**
 * The routes on the realm's real uWS app, over real HTTP. Sessions come from a test port with the API's cookie and
 * CSRF rules (the Postgres session lookup itself is covered by postgres.integration.test.ts).
 */
describe('look routes', () => {
  const handles = new Map<string, PersonId>([['handle-wren-SIMULATED-0123456789', WREN]]);
  const sessions: LookSessions = { async resolve(cookie) {
    const handle = readCookie(cookie, 'chatdom_session'), personId = handle ? handles.get(handle) : undefined;
    return handle && personId ? { personId, csrfToken: csrfFor(handle) } : null;
  } };
  let records: CitizenEntitlements = NO_ENTITLEMENTS(HOME, 'simulated');
  const repository = new MemoryLookRepository();
  const store = new LookStore({ repository, origin: 'simulated', records: { entitlements: async () => ({ kind: 'records', entitlements: records }) } });
  const { server, transport } = createRealmServer(referenceServices());
  let origin = '';
  const handle = [...handles.keys()][0]!, cookie = `other=1; chatdom_session=${handle}`, csrf = csrfFor(handle);
  const put = (body: unknown, headers: Record<string, string> = {}) => fetch(`${origin}/api/realm/looks/me`, { method: 'PUT',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  beforeAll(async () => {
    mountLookRoutes(transport.app, { store, sessions });
    const probe = createNetServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address(); if (!address || typeof address === 'string') throw new Error('No test port');
    await new Promise<void>(resolve => probe.close(() => resolve()));
    await server.listen(address.port, '127.0.0.1');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { await server.gracefullyShutdown(false); });

  it('saves with a real session and its CSRF token, then reads it back as the signed-in person', async () => {
    expect(RealmLookMineReplySchema.parse(await (await fetch(`${origin}/api/realm/looks/me`, { headers: { cookie } })).json()))
      .toMatchObject({ status: 'none', entitlements: null, granted: [] });
    const response = await put({ version: 1, look: look() });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    const saved = RealmLookSaveReplySchema.parse(await response.json());
    expect(saved).toMatchObject({ ok: true, token: canonicalLook(look()).token });
    const mine = await fetch(`${origin}/api/realm/looks/me?kingdom=${KINGDOM}`, { headers: { cookie } });
    expect(mine.headers.get('cache-control')).toBe('no-store');
    expect(RealmLookMineReplySchema.parse(await mine.json())).toMatchObject({ status: 'saved', token: canonicalLook(look()).token, entitlements: records });
  });

  it('answers anonymous without a session and refuses a save without one, with a foreign one or without CSRF', async () => {
    expect(await (await fetch(`${origin}/api/realm/looks/me`)).json()).toEqual({ version: 1, status: 'anonymous' });
    for (const headers of [{ cookie: '' }, { cookie: 'chatdom_session=someone-elses-handle-SIMULATED' }, { cookie: `__Host-chatdom_session=${handle}` }]) {
      const refused = await put({ version: 1, look: look() }, headers);
      expect(refused.status).toBe(401);
      expect(RealmLookSaveReplySchema.parse(await refused.json())).toMatchObject({ ok: false, code: 'unauthenticated' });
    }
    for (const headers of [{ 'x-csrf-token': '' }, { 'x-csrf-token': csrfFor('another-handle') }, { 'x-csrf-token': `${csrf}x` }]) {
      const refused = await put({ version: 1, look: look() }, headers);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect((await fetch(`${origin}/api/realm/looks/me?kingdom=not-a-kingdom`, { headers: { cookie } })).status).toBe(400);
  });

  it('refuses a malformed body or look, an oversized body and an unearned piece', async () => {
    const before = repository.recipes.size;
    expect((await put('{not json')).status).toBe(400);
    expect((await put({ version: 1, look: look() }, { 'content-type': 'text/plain' })).status).toBe(400);
    const badLook = await put({ version: 1, look: { ...look(), skin: 'pink' } });
    expect(badLook.status).toBe(400);
    expect(await badLook.json()).toMatchObject({ ok: false, code: 'malformed' });
    expect((await put({ version: 1, look: look(), padding: 'x'.repeat(20_000) })).status).toBe(413);
    const hood = wearPiece(look(), { family: 'hood', value: { cloth: HOME.colours[0], trim: HOME.colours[1] } });
    const unearned = await put({ version: 1, look: hood, kingdomId: KINGDOM });
    expect(unearned.status).toBe(403);
    expect(await unearned.json()).toMatchObject({ ok: false, code: 'unearned' });
    expect(repository.recipes.size).toBe(before);
    records = { ...records, followedMonths: 13 };
    expect((await put({ version: 1, look: hood, kingdomId: KINGDOM })).status).toBe(200);
  });

  it('serves a recipe publicly, cacheable for ever, validated and with an ETag', async () => {
    const { token } = canonicalLook(look());
    const response = await fetch(`${origin}${lookRecipeUrl(token)}`, { headers: { origin: 'https://extension.twitch.example' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('etag')).toBe(`"${token}"`);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(RealmLookRecipeReplySchema.parse(await response.json())).toEqual({ version: 1, token, look: JSON.parse(canonicalLook(look()).canonical) });
    const again = await fetch(`${origin}${lookRecipeUrl(token)}`, { headers: { 'if-none-match': `"${token}"` } });
    expect(again.status).toBe(304);
    const starter = await fetch(`${origin}/api/realm/looks/grove`);
    expect(starter.status).toBe(200);
    expect(starter.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(await starter.json()).toEqual({ version: 1, token: 'grove', look: starterLookRecipe('grove') });
    const missing = await fetch(`${origin}/api/realm/looks/lk.${'0'.repeat(40)}`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    for (const bad of ['neutral', `lk.${'0'.repeat(39)}`, 'LK.0']) expect((await fetch(`${origin}/api/realm/looks/${bad}`)).status).toBe(400);
  });

  it('says the save is busy after twenty a minute', async () => {
    let status = 200;
    for (let n = 0; n < 25 && status !== 429; n++) status = (await put({ version: 1, look: look() })).status;
    expect(status).toBe(429);
    const busy = await put({ version: 1, look: look() });
    expect(busy.headers.get('retry-after')).toBe('60');
    expect(await busy.json()).toMatchObject({ ok: false, code: 'busy' });
  });
});
