import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RealmAuthConfig } from '../realm-auth/config';
import { csrfFor } from '../realm-auth/secrets';
import { atlasOwnerBackend, handleAtlasOwner, type AtlasOwnerBackend } from './index';

const live = { mode: 'live', secureCookies: false, publicOrigin: 'http://localhost:5170' } as RealmAuthConfig;
const simulated = { ...live, mode: 'simulated' } as RealmAuthConfig;
const SESSION = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
/** The session store: a signed-in Twitch user 129634568 (tobi4s_). Any other cookie is no session. */
const pool = {
  query: vi.fn(async (_sql: string, values: unknown[]) => ({ rows: values[1] === 'live' || values[1] === 'simulated' ? [{ person_id: '129634568', session_id: SESSION }] : [] })),
} as unknown as Pool;
const anonymousPool = { query: async () => ({ rows: [] }) } as unknown as Pool;

function request(method: string, path: string, overrides: Record<string, string | undefined> = {}) {
  const req = Readable.from([]) as IncomingMessage;
  req.method = method; req.url = path;
  req.headers = Object.fromEntries(Object.entries({ cookie: 'chatdom_session=secret', origin: live.publicOrigin, 'content-type': 'application/json', 'x-csrf-token': csrfFor('secret'), ...overrides }).filter(([, v]) => v !== undefined));
  let code = 0, output = '';
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn(),
    writeHead: vi.fn((status: number, h: Record<string, string>) => { code = status; Object.assign(headers, h); return res; }),
    end: vi.fn((value: string) => { output = value; return res; }),
  } as unknown as ServerResponse;
  return { req, res, result: () => ({ code, headers, body: JSON.parse(output) as Record<string, unknown> }) };
}

function backend(): AtlasOwnerBackend & { calls: string[] } {
  let hidden = false;
  const calls: string[] = [];
  return {
    calls,
    visibility: async (id, preview) => { calls.push(`visibility ${id} ${preview}`); return { kingdomId: id, hidden, onMap: !hidden, card: hidden ? { kind: 'chatdom-atlas-card' } : null, secret: 'never passed on' }; },
    act: async (id, act) => { calls.push(`${act} ${id}`); hidden = act === 'hide'; return { kind: hidden ? 'hidden' : 'shown', kingdomId: id, changed: true, hidden, onMap: !hidden }; },
  };
}

describe('the Atlas owner routes', () => {
  it('answers anonymous without a session, and refuses changes', async () => {
    const read = request('GET', '/api/atlas/me', { cookie: undefined });
    expect(await handleAtlasOwner(read.req, read.res, { pool: anonymousPool, config: live, backend: backend() })).toBe(true);
    expect(read.result()).toMatchObject({ code: 200, body: { version: 1, status: 'anonymous' } });
    expect(read.result().headers).toMatchObject({ 'Cache-Control': 'no-store', Vary: 'Cookie' });
    const hide = request('POST', '/api/atlas/me/hide');
    await handleAtlasOwner(hide.req, hide.res, { pool: anonymousPool, config: live, backend: backend() });
    expect(hide.result()).toMatchObject({ code: 401, body: { status: 'anonymous' } });
  });

  it('hides and shows only the session’s own channel, whatever the address says', async () => {
    const atlas = backend();
    const before = request('GET', '/api/atlas/me?preview=pv-20261102T000000Z-0123456789ab');
    await handleAtlasOwner(before.req, before.res, { pool, config: live, backend: atlas });
    expect(before.result().body).toEqual({ version: 1, status: 'broadcaster', channelId: '129634568', hidden: false, onMap: true, card: null, csrfToken: csrfFor('secret') });
    const hide = request('POST', '/api/atlas/me/hide');
    await handleAtlasOwner(hide.req, hide.res, { pool, config: live, backend: atlas });
    expect(hide.result()).toMatchObject({ code: 200, body: { status: 'broadcaster', channelId: '129634568', hidden: true, onMap: false } });
    const after = request('GET', '/api/atlas/me');
    await handleAtlasOwner(after.req, after.res, { pool, config: live, backend: atlas });
    expect(after.result().body).toMatchObject({ hidden: true, card: { kind: 'chatdom-atlas-card' } });
    expect(after.result().body).not.toHaveProperty('secret');
    const show = request('POST', '/api/atlas/me/show');
    await handleAtlasOwner(show.req, show.res, { pool, config: live, backend: atlas });
    expect(show.result().body).toMatchObject({ hidden: false, onMap: true });
    expect(atlas.calls).toEqual(['visibility 129634568 pv-20261102T000000Z-0123456789ab', 'hide 129634568', 'visibility 129634568 null', 'unhide 129634568']);
    // Nothing in the request can name another channel: extra query is refused, never forwarded.
    const other = request('POST', '/api/atlas/me/hide?channel=1');
    await handleAtlasOwner(other.req, other.res, { pool, config: live, backend: atlas });
    expect(other.result().code).toBe(400);
    expect(atlas.calls).toHaveLength(4);
  });

  it('needs the page’s own origin and the session’s CSRF token to change anything', async () => {
    const atlas = backend();
    for (const overrides of [{ 'x-csrf-token': 'forged' }, { 'x-csrf-token': undefined }, { origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }]) {
      const f = request('POST', '/api/atlas/me/hide', overrides);
      await handleAtlasOwner(f.req, f.res, { pool, config: live, backend: atlas });
      expect(f.result().code).toBe(403);
    }
    const get = request('GET', '/api/atlas/me/hide');
    await handleAtlasOwner(get.req, get.res, { pool, config: live, backend: atlas });
    expect(get.result().code).toBe(405);
    expect(atlas.calls).toEqual([]);
  });

  it('never lets a SIMULATED sign-in reach the real Atlas, and says unavailable without one configured', async () => {
    const atlas = backend();
    const sim = request('POST', '/api/atlas/me/hide');
    await handleAtlasOwner(sim.req, sim.res, { pool, config: simulated, backend: atlas });
    expect(sim.result()).toMatchObject({ code: 503, body: { status: 'unavailable' } });
    expect(atlas.calls).toEqual([]);
    const unset = request('GET', '/api/atlas/me');
    await handleAtlasOwner(unset.req, unset.res, { pool, config: live, env: {} });
    expect(unset.result()).toMatchObject({ code: 200, body: { status: 'unavailable', channelId: '129634568' } });
    expect(unset.result().body).not.toHaveProperty('csrfToken');
  });

  it('leaves other routes alone and turns a broken Atlas reply into unavailable', async () => {
    const other = request('GET', '/api/atlas/them');
    expect(await handleAtlasOwner(other.req, other.res, { pool, config: live, backend: backend() })).toBe(false);
    const wrong = request('GET', '/api/atlas/me');
    await handleAtlasOwner(wrong.req, wrong.res, { pool, config: live, backend: { visibility: async () => ({ kingdomId: '1', hidden: true, onMap: false }), act: async () => null } });
    expect(wrong.result().body).toMatchObject({ status: 'unavailable' });
    const failing = request('POST', '/api/atlas/me/hide');
    await handleAtlasOwner(failing.req, failing.res, { pool, config: live, backend: { visibility: async () => null, act: async () => { throw new Error('down'); } } });
    expect(failing.result()).toMatchObject({ code: 503, body: { status: 'unavailable' } });
  });
});

describe('the Atlas private listener client', () => {
  const servers: { close(): void }[] = [];
  afterEach(() => { while (servers.length) servers.pop()!.close(); });

  it('sends the bearer token and the act time to the private routes', async () => {
    const seen: { method: string | undefined; url: string | undefined; auth: string | undefined; body: string }[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ kingdomId: '7', hidden: true, onMap: false }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const client = atlasOwnerBackend({ ATLAS_PRIVATE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, ATLAS_INGEST_TOKEN: 'token-of-the-session-authority' })!;
    await client.act('7', 'hide');
    await client.visibility('7', 'pv-20261102T000000Z-0123456789ab');
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/v1/channels/7/hide', auth: 'Bearer token-of-the-session-authority' });
    expect(JSON.parse(seen[0]!.body)).toEqual({ version: 1, at: expect.any(Number) });
    expect(seen[1]).toMatchObject({ method: 'GET', url: '/v1/channels/7/visibility?preview=pv-20261102T000000Z-0123456789ab' });
    expect(atlasOwnerBackend({ ATLAS_PRIVATE_URL: 'http://127.0.0.1:1' })).toBeNull();
    expect(atlasOwnerBackend({ ATLAS_PRIVATE_URL: 'file:///etc', ATLAS_INGEST_TOKEN: 'x' })).toBeNull();
  });
});
