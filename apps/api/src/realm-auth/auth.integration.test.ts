import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createRemoteJWKSet } from 'jose';
import {
  REALM_AUTH_ROUTES, RealmApiErrorSchema, RealmSessionReplySchema, RealmSignoutReplySchema, RealmTicketReplySchema,
  type RealmJoin, type RealmPrincipal,
} from '@chatdom/shared/realm';
import { KingdomIdSchema } from '@chatdom/shared';
import { migrateRealmSchema } from '../../../realm/src/persistence/migrate';
import { createRealmAuthenticator } from '../../../realm/src/auth/authenticator';
import { createRealmServer } from '../../../realm/src/server';
import { REFERENCE_KINGDOM, referenceServices } from '../../../realm/src/reference';
import { connectRealm, type RealmClient } from '../../../web/src/realm/client';
import { createRealmAuthHttp } from './http';
import { createRealmAuthService, type RealmAuthService } from './service';
import { createSimulatedOidcProvider } from './simulated-provider';
import { sha256 } from './secrets';

/**
 * R4/R5 against real Postgres, in a randomised schema that is dropped afterwards. Sign-in runs through the
 * SIMULATED provider, which signs real RS256 tokens that the production verifier checks over its JWKS endpoint.
 *   REALM_DATABASE_TESTS=1 node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run apps/api/src/realm-auth/auth.integration.test.ts
 */
const enabled = process.env.REALM_DATABASE_TESTS === '1';
const OTHER_KINGDOM = KingdomIdSchema.parse('424242');

const freePort = async () => {
  const probe = createNetServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No free test port');
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return address.port;
};
const waitFor = async (predicate: () => boolean, what: string) => {
  const end = Date.now() + 8_000;
  while (!predicate()) { if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 25)); }
};

/** One browser: a cookie jar plus same-origin fetch that never follows redirects on its own. */
class Browser {
  readonly cookies = new Map<string, { value: string; attributes: string }>();
  constructor(readonly origin: string) {}
  async request(path: string, init: { method?: string; body?: unknown; csrf?: string; origin?: string | null; form?: URLSearchParams } = {}) {
    const headers: Record<string, string> = {};
    const jar = [...this.cookies].map(([name, cookie]) => `${name}=${cookie.value}`).join('; ');
    if (jar) headers.cookie = jar;
    if (init.csrf) headers['x-csrf-token'] = init.csrf;
    if (init.origin !== null && (init.method ?? 'GET') !== 'GET') headers.origin = init.origin ?? this.origin;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.form) headers['content-type'] = 'application/x-www-form-urlencoded';
    const response = await fetch(new URL(path, this.origin), {
      method: init.method ?? 'GET', headers, redirect: 'manual',
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : init.form ? { body: init.form.toString() } : {}),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair = '', ...attributes] = line.split(';');
      const at = pair.indexOf('='), name = pair.slice(0, at).trim(), value = pair.slice(at + 1).trim();
      if (/Max-Age=0/i.test(line)) this.cookies.delete(name); else this.cookies.set(name, { value, attributes: attributes.join(';') });
    }
    return response;
  }
  /** The explicit Walk action for an anonymous viewer: start, choose a simulated person, return through the callback. */
  async signIn(personId: string, returnTo = '/-/realm'): Promise<{ callback: string; landed: string }> {
    const start = await this.request(`${REALM_AUTH_ROUTES.start}?returnTo=${encodeURIComponent(returnTo)}`);
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get('location')!);
    const chooser = await this.request(authorize.pathname + authorize.search);
    expect(await chooser.text()).toContain('SIMULATED');
    const form = new URLSearchParams(authorize.searchParams);
    form.set('person', personId); form.set('decision', 'allow');
    const approved = await this.request(`${authorize.pathname.replace(/authorize$/, 'approve')}`, { method: 'POST', form });
    const callback = new URL(approved.headers.get('location')!);
    const back = await this.request(callback.pathname + callback.search);
    expect(back.status).toBe(303);
    return { callback: callback.pathname + callback.search, landed: back.headers.get('location')! };
  }
  async session() {
    const response = await this.request(REALM_AUTH_ROUTES.session);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return RealmSessionReplySchema.parse(await response.json());
  }
  async csrf() {
    const session = await this.session();
    if (session.status !== 'authenticated') throw new Error('Not signed in');
    return session.csrfToken;
  }
  async ticket(kingdomId: string, extra: Record<string, unknown> = {}) {
    return this.request(REALM_AUTH_ROUTES.ticket, { method: 'POST', csrf: await this.csrf(), body: { version: 1, kingdomId, protocol: 1, ...extra } });
  }
  async join(kingdomId: string): Promise<RealmJoin> {
    const response = await this.ticket(kingdomId);
    expect(response.status).toBe(200);
    return RealmTicketReplySchema.parse(await response.json()).join;
  }
}

describe.skipIf(!enabled)('realm sign-in and entry tickets (Postgres)', () => {
  const schema = `realm_test_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pool: pg.Pool, api: Server, origin: string, service: RealmAuthService;
  let realmShutdown: (() => Promise<void>) | undefined;
  const adapters: RealmClient[] = [];
  const simulatedAuth = () => createRealmAuthenticator({ pool, origin: 'simulated' });
  const rejects = async (join: RealmJoin, auth = simulatedAuth()) => {
    await expect(auth.authenticate(join)).rejects.toMatchObject({ code: expect.any(Number) });
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 needs DATABASE_URL; load it with --env-file-if-exists=.env');
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    expect(await migrateRealmSchema(admin, schema)).toContain('0001_realm_auth');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 6, options: `-c search_path="${schema}"` });
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    const simulated = await createSimulatedOidcProvider({ publicOrigin: origin, internalOrigin: origin, redirectUri: `${origin}${REALM_AUTH_ROUTES.callback}` });
    service = createRealmAuthService({ pool, provider: simulated.provider, keys: createRemoteJWKSet(new URL(simulated.provider.jwksUri)), redirectUri: `${origin}${REALM_AUTH_ROUTES.callback}` });
    await service.ready();
    const routes = createRealmAuthHttp({ service, publicOrigin: origin, secureCookies: false, extra: simulated.handle });
    api = createServer((request, response) => { void routes(request, response).then(handled => { if (!handled) response.writeHead(404).end(); }); });
    await new Promise<void>(resolve => api.listen(port, '127.0.0.1', resolve));
  });
  afterAll(async () => {
    for (const adapter of adapters) adapter.dispose();
    await realmShutdown?.();
    await new Promise<void>(resolve => api ? api.close(() => resolve()) : resolve());
    await pool?.end();
    if (admin) { await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); }
  });

  it('R4: verified OIDC sign-in claims one person and issues a hashed, expiring, revocable session', async () => {
    const wren = new Browser(origin);
    expect(await wren.session()).toEqual({ version: 1, status: 'anonymous' });
    for (const outside of ['https://evil.example/', '//evil.example', '/\\evil.example', '/-/realm?next=https://evil.example']) {
      const refused = await wren.request(`${REALM_AUTH_ROUTES.start}?returnTo=${encodeURIComponent(outside)}`);
      expect(refused.status).toBe(400);
      expect(RealmApiErrorSchema.parse(await refused.json()).status).toBe('refused');
    }
    const start = await wren.request(`${REALM_AUTH_ROUTES.start}?returnTo=%2Fwren_kingdom`);
    const authorize = new URL(start.headers.get('location')!);
    expect(authorize.searchParams.get('scope')).toBe('openid');
    expect(authorize.searchParams.get('nonce')!.length).toBeGreaterThanOrEqual(43);
    expect(wren.cookies.get('chatdom_signin')!.attributes).toMatch(/HttpOnly.*SameSite=Lax/);
    expect(wren.cookies.get('chatdom_signin')!.attributes).not.toMatch(/Secure/);

    // A callback carried to another browser signs nobody in there. Without a binding cookie it cannot even touch the
    // attempt; with that browser's own binding it burns the attempt, so the stolen code is dead everywhere.
    const form = new URLSearchParams(authorize.searchParams); form.set('person', '990100001'); form.set('decision', 'allow');
    const stolen = new URL((await wren.request(authorize.pathname.replace(/authorize$/, 'approve'), { method: 'POST', form })).headers.get('location')!);
    const attacker = new Browser(origin);
    expect((await attacker.request(stolen.pathname + stolen.search)).headers.get('location')).toBe('/?signin=expired');
    await attacker.request(`${REALM_AUTH_ROUTES.start}?returnTo=%2F`);
    expect((await attacker.request(stolen.pathname + stolen.search)).headers.get('location')).toBe('/?signin=expired');
    expect((await wren.request(stolen.pathname + stolen.search)).headers.get('location')).toBe('/?signin=expired');
    expect(attacker.cookies.has('chatdom_session') || wren.cookies.has('chatdom_session')).toBe(false);

    // Identity parameters added to the callback choose nothing; the verified subject does.
    const { callback, landed } = await wren.signIn('990100001', '/wren_kingdom/throne');
    expect(landed).toBe('/wren_kingdom/throne');
    const session = wren.cookies.get('chatdom_session')!;
    expect(session.attributes).toMatch(/HttpOnly/); expect(session.attributes).toMatch(/SameSite=Lax/);
    const replay = await new Browser(origin).request(`${callback}&sub=990100009&person_id=990100009`);
    expect(replay.headers.get('location')).toBe('/?signin=expired');
    const reply = await wren.session();
    if (reply.status !== 'authenticated') throw new Error('Expected a session');
    expect(reply.resumeScope).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(reply.expiresAt).toBeGreaterThan(Date.now() + 13 * 24 * 3_600_000);
    const person = await pool.query('select origin, public_name, name_approval from realm_persons');
    expect(person.rows).toEqual([{ origin: 'simulated', public_name: 'Wren', name_approval: 'provider-display-name-v1' }]);
    const stored = await pool.query('select handle_hash from realm_sessions where revoked_at is null');
    expect(stored.rows).toEqual([{ handle_hash: sha256(session.value) }]);

    // Wrong issuer and a nonce from another sign-in both stop at the production verifier.
    const strict = createRealmAuthService({ ...serviceOptions(), provider: { ...service.provider, issuer: 'https://id.twitch.tv/oauth2' } });
    const routes = createRealmAuthHttp({ service: strict, publicOrigin: origin, secureCookies: false });
    const strictServer = createServer((request, response) => { void routes(request, response).then(handled => { if (!handled) response.writeHead(404).end(); }); });
    const strictPort = await freePort();
    await new Promise<void>(resolve => strictServer.listen(strictPort, '127.0.0.1', resolve));
    try {
      const other = new Browser(`http://127.0.0.1:${strictPort}`);
      const begun = new URL((await other.request(`${REALM_AUTH_ROUTES.start}?returnTo=%2F-%2Frealm`)).headers.get('location')!);
      const code = new URL((await new Browser(origin).request(begun.pathname.replace(/authorize$/, 'approve'), { method: 'POST', form: new URLSearchParams({ ...Object.fromEntries(begun.searchParams), person: '990100002', decision: 'allow' }) })).headers.get('location')!);
      expect((await other.request(code.pathname + code.search)).headers.get('location')).toBe('/-/realm?signin=refused');
    } finally { await new Promise<void>(resolve => strictServer.close(() => resolve())); }
    const nonceBrowser = new Browser(origin);
    const begun = new URL((await nonceBrowser.request(`${REALM_AUTH_ROUTES.start}?returnTo=%2F-%2Frealm`)).headers.get('location')!);
    await pool.query('update realm_sign_in_attempts set nonce_hash = $1 where consumed_at is null', [sha256('another sign-in')]);
    const code = new URL((await nonceBrowser.request(begun.pathname.replace(/authorize$/, 'approve'), { method: 'POST', form: new URLSearchParams({ ...Object.fromEntries(begun.searchParams), person: '990100002', decision: 'allow' }) })).headers.get('location')!);
    expect((await nonceBrowser.request(code.pathname + code.search)).headers.get('location')).toBe('/-/realm?signin=refused');
    expect(nonceBrowser.cookies.has('chatdom_session')).toBe(false);
    expect((await pool.query("select 1 from realm_persons where person_id = '990100002'")).rowCount).toBe(0);

    // Signing in again replaces the session and rotates the resume scope; the old handle is dead.
    const old = session.value;
    await wren.signIn('990100001');
    const rotated = await wren.session();
    expect(rotated.status === 'authenticated' && rotated.resumeScope).not.toBe(reply.resumeScope);
    const stale = new Browser(origin); stale.cookies.set('chatdom_session', { value: old, attributes: '' });
    expect(await stale.session()).toEqual({ version: 1, status: 'anonymous' });
    expect(stale.cookies.has('chatdom_session')).toBe(false);

    // Expiry is enforced by the database clock, not by the cookie.
    await pool.query("update realm_sessions set expires_at = now() - interval '1 second' where handle_hash = $1", [sha256(wren.cookies.get('chatdom_session')!.value)]);
    expect(await wren.session()).toEqual({ version: 1, status: 'anonymous' });
    expect((await wren.request(REALM_AUTH_ROUTES.ticket, { method: 'POST', body: { version: 1, kingdomId: REFERENCE_KINGDOM, protocol: 1 } })).status).toBe(401);
  });

  it('R5: one-use tickets bound to session, kingdom, protocol and origin let the signed-in person walk, and only them', async () => {
    const wren = new Browser(origin), tamsin = new Browser(origin);
    await wren.signIn('990100001'); await tamsin.signIn('990100002');
    const auth = simulatedAuth();

    // The ticket endpoint wants the session cookie, its CSRF token, the page's own origin and the frozen request.
    expect((await new Browser(origin).request(REALM_AUTH_ROUTES.ticket, { method: 'POST', body: { version: 1, kingdomId: REFERENCE_KINGDOM, protocol: 1 } })).status).toBe(401);
    expect((await wren.request(REALM_AUTH_ROUTES.ticket, { method: 'POST', body: { version: 1, kingdomId: REFERENCE_KINGDOM, protocol: 1 } })).status).toBe(403);
    expect((await wren.request(REALM_AUTH_ROUTES.ticket, { method: 'POST', csrf: await tamsin.csrf(), body: { version: 1, kingdomId: REFERENCE_KINGDOM, protocol: 1 } })).status).toBe(403);
    expect((await wren.request(REALM_AUTH_ROUTES.ticket, { method: 'POST', csrf: await wren.csrf(), origin: 'https://evil.example', body: { version: 1, kingdomId: REFERENCE_KINGDOM, protocol: 1 } })).status).toBe(403);
    expect((await wren.request(REALM_AUTH_ROUTES.ticket, { method: 'POST', csrf: await wren.csrf(), origin: null, body: { version: 1, kingdomId: REFERENCE_KINGDOM, protocol: 1 } })).status).toBe(403);
    const chosen = await wren.ticket(REFERENCE_KINGDOM, { personId: '990100002' });
    expect(chosen.status).toBe(400);
    expect(RealmApiErrorSchema.parse(await chosen.json()).status).toBe('refused');
    expect((await wren.ticket(REFERENCE_KINGDOM, { protocol: 2 })).status).toBe(400);
    const issued = await wren.ticket(REFERENCE_KINGDOM);
    expect(issued.headers.get('cache-control')).toBe('no-store');
    const reply = RealmTicketReplySchema.parse(await issued.json());
    expect(reply.expiresAt - Date.now()).toBeLessThanOrEqual(61_000);
    expect((await pool.query('select 1 from realm_tickets where ticket_hash = $1', [sha256(reply.join.ticket)])).rowCount).toBe(1);

    const principal = await auth.authenticate(reply.join);
    expect(principal).toMatchObject({ personId: '990100001', kingdomId: REFERENCE_KINGDOM, origin: 'simulated', publicName: 'Wren', look: 'neutral' });
    expect(await auth.current(principal, Date.now())).toBe(true);
    await rejects(reply.join); // replay

    // A ticket shown to the wrong kingdom is burned, so it cannot be retried at the right one.
    const elsewhere = await wren.join(REFERENCE_KINGDOM);
    await rejects({ ...elsewhere, kingdomId: OTHER_KINGDOM });
    await rejects(elsewhere);
    const late = await wren.join(REFERENCE_KINGDOM);
    await pool.query("update realm_tickets set issued_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute' where ticket_hash = $1", [sha256(late.ticket)]);
    await rejects(late);
    // Live realms refuse simulated entries and principals outright.
    const live = createRealmAuthenticator({ pool, origin: 'live' });
    await rejects(await wren.join(REFERENCE_KINGDOM), live);
    expect(await live.current(principal, Date.now())).toBe(false);
    // A principal the client edits is not current: another person, an invented session, a non-session string.
    for (const forged of [{ ...principal, personId: '990100002' }, { ...principal, sessionId: crypto.randomUUID() }, { ...principal, sessionId: 'not-a-session' }] as RealmPrincipal[]) {
      expect(await auth.current(forged, Date.now())).toBe(false);
    }
    // Session storage failure holds entry; it never grants it.
    const broken = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: '-c search_path=realm_missing_schema' });
    try {
      await expect(createRealmAuthenticator({ pool: broken, origin: 'simulated' }).authenticate(await wren.join(REFERENCE_KINGDOM))).rejects.toMatchObject({ code: 503 });
      await expect(createRealmAuthenticator({ pool: broken, origin: 'simulated' }).current(principal, Date.now())).rejects.toThrow();
    } finally { await broken.end(); }

    // The Walk action end to end: the browser's own realm adapter asks the API for a ticket and joins the room.
    const port = await freePort(), endpoint = `http://127.0.0.1:${port}`;
    const { server } = createRealmServer({ auth, open: referenceServices().open });
    // The reference court's terrain, read from a separate reference instance (the API has no world dependency).
    const probe = await referenceServices().open(REFERENCE_KINGDOM), world = probe.world;
    await probe.dispose();
    realmShutdown = () => server.gracefullyShutdown(false);
    await server.listen(port, '127.0.0.1');
    const walk = async (browser: Browser) => {
      const session = await browser.session();
      if (session.status !== 'authenticated') throw new Error('Not signed in');
      const client = await connectRealm(endpoint, { kingdomId: REFERENCE_KINGDOM, resumeScope: session.resumeScope, ticket: () => browser.join(REFERENCE_KINGDOM) }, world);
      adapters.push(client);
      return client;
    };
    const wrenWalks = await walk(wren), tamsinWalks = await walk(tamsin);
    await waitFor(() => tamsinWalks.room.state.walkers.size === 2, 'both walkers');
    expect([...tamsinWalks.room.state.walkers.values()].map(w => w.name).sort()).toEqual(['Tamsin', 'Wren']);

    // Signout revokes the session and its unused tickets; the room drops Wren on its next session check.
    const unused = await wren.join(REFERENCE_KINGDOM);
    expect((await wren.request(REALM_AUTH_ROUTES.signout, { method: 'POST', body: {} })).status).toBe(403);
    const out = await wren.request(REALM_AUTH_ROUTES.signout, { method: 'POST', csrf: await wren.csrf(), body: {} });
    expect(RealmSignoutReplySchema.parse(await out.json())).toEqual({ version: 1, status: 'signed-out' });
    expect(wren.cookies.has('chatdom_session')).toBe(false);
    expect(await wren.session()).toEqual({ version: 1, status: 'anonymous' });
    await rejects(unused);
    // The room's periodic session check closes the signed-out connection. (Ending its seat without the reconnect
    // grace is the lifecycle adapter's job; reconnecting with the dead session is refused by `current`.)
    let wrenClosed: number | null = null;
    wrenWalks.room.onLeave(code => { wrenClosed = code; });
    await waitFor(() => wrenClosed !== null || !wrenWalks.room.connection.isOpen, 'the room to close the signed-out connection');
    expect(tamsinWalks.room.connection.isOpen).toBe(true);

    // Internal revocation (moderation) reaches every session of the person at once.
    const tamsinPrincipal = await auth.authenticate(await tamsin.join(REFERENCE_KINGDOM));
    expect(await service.revoke({ personId: '990100002' }, 'moderated')).toBe(1);
    expect(await auth.current(tamsinPrincipal, Date.now())).toBe(false);
    await waitFor(() => !tamsinWalks.room.connection.isOpen, 'the room to close the revoked connection');

    // Nothing secret is stored in the clear: no cookie, ticket, CSRF token or resume scope collides with a stored hash input.
    const dump = JSON.stringify((await pool.query(`select row_to_json(t)::text as row from (
      select * from realm_sessions) t union all select row_to_json(t)::text from (select * from realm_tickets) t`)).rows);
    expect(dump).not.toContain(reply.join.ticket);
    expect(dump).not.toContain(unused.ticket);
  }, 30_000);

  function serviceOptions() {
    return { pool, keys: createRemoteJWKSet(new URL(service.provider.jwksUri)), redirectUri: `${origin}${REALM_AUTH_ROUTES.callback}` };
  }
});

it.runIf(!enabled)('realm sign-in Postgres suite is opt-in (REALM_DATABASE_TESTS=1)', () => {
  expect(enabled).toBe(false);
});
