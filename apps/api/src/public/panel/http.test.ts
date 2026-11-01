import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, type JWTPayload } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PANEL_ROUTES, type PanelReading } from './contracts';
import { createPanelHttp, type PanelHttpOptions } from './http';
import type { PanelAuthority } from './reading';
import { extensionKey, type PanelViewer } from './token';

const CLIENT_ID = 'abc123testclient';
const PANEL_ORIGIN = `https://${CLIENT_ID}.ext-twitch.tv`;
const RIG_ORIGIN = 'http://127.0.0.1:5199';
// Fixed test bytes in the console's base64 shape, never a real secret.
const SECRET = Buffer.alloc(32, 5).toString('base64');
const READING: PanelReading = {
  version: 1,
  kingdom: { name: 'Lanternmere', tier: 'hamlet', motto: 'One home lit by chat, of 12', walk: 'https://chatdom.io/?walk=1&kingdom=1001' },
  viewer: { kind: 'unshared' },
};

const mint = (claims: JWTPayload, secret = SECRET) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(extensionKey(secret));
const SHARED = { channel_id: '1001', opaque_user_id: 'UVvQ2HwX1M8', user_id: '2002', role: 'viewer' };

function authority(reading: PanelAuthority['reading'] = async () => READING) {
  return {
    reading: vi.fn(reading),
    cardSource: vi.fn<PanelAuthority['cardSource']>(async () => { throw new Error('no card in this test'); }),
  };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); })));
});

/** Mounts the panel backend the way the public server does, on an ephemeral loopback port. */
async function serve(options: Partial<PanelHttpOptions> & { authority: PanelAuthority }) {
  const report = vi.fn<(line: string) => void>();
  const handle = createPanelHttp({
    origin: 'simulated', extension: { clientId: CLIENT_ID, secret: SECRET }, extraOrigins: [RIG_ORIGIN], report, ...options,
  });
  const server = createServer((request, response) => {
    void handle(request, response, new URL(request.url ?? '/', 'http://panel.invalid').pathname);
  });
  servers.push(server);
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, report };
}

const post = (url: string, headers: Record<string, string>, body = '{}') =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

describe('the panel backend', () => {
  it('returns the authority\'s reading for the viewer the verified token names', async () => {
    const kingdom = authority();
    const { base } = await serve({ authority: kingdom });
    const response = await post(`${base}${PANEL_ROUTES.reading}`, { authorization: `Bearer ${await mint(SHARED)}`, origin: PANEL_ORIGIN });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe(PANEL_ORIGIN);
    expect(await response.json()).toEqual(READING);
    expect(kingdom.reading).toHaveBeenCalledTimes(1);
    const viewer: PanelViewer = { channelId: '1001', role: 'viewer', kind: 'shared', personId: '2002' };
    expect(kingdom.reading.mock.calls[0]?.[0]).toEqual(viewer);
  });

  it('takes the channel and the viewer from the token alone, never from the body or the query', async () => {
    const kingdom = authority();
    const { base } = await serve({ authority: kingdom });
    const token = await mint({ channel_id: '1001', opaque_user_id: 'ARQwPIYx2nM' });
    await post(`${base}${PANEL_ROUTES.reading}?channel_id=9999&user_id=3003`, { authorization: `Bearer ${token}` }, JSON.stringify({ channelId: '9999', personId: '3003' }));
    expect(kingdom.reading.mock.calls[0]?.[0]).toEqual({ channelId: '1001', role: 'viewer', kind: 'anonymous' });
  });

  it('allows CORS only for the extension\'s own origin and the listed extra origins', async () => {
    const { base } = await serve({ authority: authority() });
    const token = await mint(SHARED);
    for (const origin of [PANEL_ORIGIN, RIG_ORIGIN]) {
      const response = await post(`${base}${PANEL_ROUTES.reading}`, { authorization: `Bearer ${token}`, origin });
      expect(response.status, origin).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(response.headers.get('vary')).toBe('Origin');
    }
    for (const origin of ['https://evil.ext-twitch.tv', 'https://chatdom.io', `http://${CLIENT_ID}.ext-twitch.tv`, 'null']) {
      const response = await post(`${base}${PANEL_ROUTES.reading}`, { authorization: `Bearer ${token}`, origin });
      expect(response.status, origin).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(await response.json()).toMatchObject({ version: 1, status: 'refused' });
    }
  });

  it('answers a preflight from an allowed origin with 204, and refuses any other', async () => {
    const { base } = await serve({ authority: authority() });
    const allowed = await fetch(`${base}${PANEL_ROUTES.reading}`, {
      method: 'OPTIONS', headers: { origin: PANEL_ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(PANEL_ORIGIN);
    expect(allowed.headers.get('access-control-allow-methods')).toBe('POST');
    expect(allowed.headers.get('access-control-allow-headers')).toBe('authorization, content-type, accept');
    expect(allowed.headers.get('access-control-max-age')).toBe('600');

    const foreign = await fetch(`${base}${PANEL_ROUTES.reading}`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    expect((await fetch(`${base}${PANEL_ROUTES.reading}`, { method: 'OPTIONS' })).status).toBe(403);
  });

  it('takes POST only, on its own routes only', async () => {
    const { base } = await serve({ authority: authority() });
    const get = await fetch(`${base}${PANEL_ROUTES.reading}`, { headers: { origin: PANEL_ORIGIN } });
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect(get.headers.get('access-control-allow-origin')).toBe(PANEL_ORIGIN);
    expect((await fetch(`${base}${PANEL_ROUTES.reading}`, { method: 'PUT', body: '{}' })).status).toBe(405);
    const unknown = await post(`${base}/api/panel/v1/other`, { authorization: `Bearer ${await mint(SHARED)}` });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ version: 1, status: 'refused' });
  });

  it('refuses a body over 2 KB without asking the kingdom', async () => {
    const kingdom = authority();
    const { base } = await serve({ authority: kingdom });
    const token = await mint(SHARED);
    expect((await post(`${base}${PANEL_ROUTES.reading}`, { authorization: `Bearer ${token}` }, JSON.stringify({ pad: 'x'.repeat(2_000) }))).status).toBe(200);
    const large = await post(`${base}${PANEL_ROUTES.reading}`, { authorization: `Bearer ${token}` }, JSON.stringify({ pad: 'x'.repeat(2_100) }));
    expect(large.status).toBe(413);
    expect(await large.json()).toMatchObject({ version: 1, status: 'refused' });
    expect(kingdom.reading).toHaveBeenCalledTimes(1);
  });

  it('says it is unavailable when no extension is configured on this host', async () => {
    const kingdom = authority();
    const { base } = await serve({ authority: kingdom, extension: null });
    const response = await post(`${base}${PANEL_ROUTES.reading}`, { authorization: `Bearer ${await mint(SHARED)}`, origin: RIG_ORIGIN });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ version: 1, status: 'unavailable' });
    // Without an extension, its origin is not allowed either: only the listed extras remain.
    expect((await post(`${base}${PANEL_ROUTES.reading}`, { origin: PANEL_ORIGIN })).status).toBe(403);
    expect(kingdom.reading).not.toHaveBeenCalled();
  });

  it('answers 401 for a missing, forged or expired token, saying why', async () => {
    const kingdom = authority();
    const { base } = await serve({ authority: kingdom });
    const url = `${base}${PANEL_ROUTES.reading}`;
    const cases: [Record<string, string>, string][] = [
      [{}, 'No Twitch panel token'],
      [{ authorization: `Bearer ${await mint(SHARED, Buffer.alloc(32, 6).toString('base64'))}` }, 'The Twitch panel token did not verify'],
      [{ authorization: `Bearer ${await new SignJWT(SHARED).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(Math.floor(Date.now() / 1000) - 600).sign(extensionKey(SECRET))}` }, 'The Twitch panel token expired'],
      [{ authorization: `Bearer ${await mint({ opaque_user_id: 'U1' })}` }, 'The Twitch panel token names no channel or viewer'],
    ];
    for (const [headers, message] of cases) {
      const response = await post(url, { ...headers, origin: PANEL_ORIGIN });
      expect(response.status, message).toBe(401);
      expect(response.headers.get('access-control-allow-origin')).toBe(PANEL_ORIGIN);
      expect(await response.json()).toEqual({ version: 1, status: 'unauthenticated', message });
    }
    expect(kingdom.reading).not.toHaveBeenCalled();
  });

  it('answers 503 when the kingdom cannot be read, reporting the failure without its details', async () => {
    const { base, report } = await serve({ authority: authority(async () => { throw new TypeError('connection to db at 10.0.0.9 refused'); }) });
    const response = await post(`${base}${PANEL_ROUTES.reading}`, { authorization: `Bearer ${await mint(SHARED)}` });
    expect(response.status).toBe(503);
    const body = await response.json() as { status: string; message: string };
    expect(body.status).toBe('unavailable');
    expect(body.message).not.toContain('10.0.0.9');
    expect(report).toHaveBeenCalledWith('panel: reading failed (TypeError)');
  });

  it('opens no passport for a viewer who has not shared who they are', async () => {
    const kingdom = authority();
    const { base } = await serve({ authority: kingdom });
    const token = await mint({ channel_id: '1001', opaque_user_id: 'UVvQ2HwX1M8' });
    const response = await post(`${base}${PANEL_ROUTES.passport}`, { authorization: `Bearer ${token}`, origin: PANEL_ORIGIN }, JSON.stringify({ op: 'book' }));
    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBe(PANEL_ORIGIN);
    expect(await response.json()).toEqual({ kind: 'denied', code: 'unavailable' });
    expect(kingdom.cardSource).not.toHaveBeenCalled();
  });
});
