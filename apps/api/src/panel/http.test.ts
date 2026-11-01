import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { createPanelHttp } from './http';
import { PanelPictures } from './pictures';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const key = new Uint8Array(32).fill(42);
async function token(claims: Record<string, unknown> = {}, signing = key) {
  return new SignJWT({ channel_id: '1234', opaque_user_id: 'Uviewer', role: 'viewer', user_id: '5678', ...claims }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m').sign(signing);
}
async function start() {
  const directory = await mkdtemp(join(tmpdir(), 'panel-pictures-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const handler = createPanelHttp({
    extension: { clientId: 'panel-lane', secret: Buffer.from(key).toString('base64') }, origin: 'live',
    authority: { reading: async () => ({ version: 1, kingdom: null, viewer: { kind: 'anonymous' } }), cardSource: async () => { throw new Error(); } },
  }, {
    realmOrigin: 'http://realm.invalid', panelSecret: 'p'.repeat(40), painterSecret: 's'.repeat(40), pictures: new PanelPictures(directory),
    users: { person: async () => ({ login: 'wren', displayName: 'Wren', colour: null }) },
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ path, body });
      if (path.endsWith('/forget')) return new Response(JSON.stringify({ version: 1, status: 'unavailable' }), { status: 503 });
      if (path.endsWith('/privacy') || path.endsWith('/quiet')) return new Response(JSON.stringify({ version: 1, status: path.slice(path.lastIndexOf('/') + 1), quiet: body.quiet ?? false, projection: 'pending', forgetAvailable: false }));
      const answer = path.endsWith('/claim') ? { version: 1, status: 'deed' } : path.endsWith('/presence') ? { version: 1, status: 'presence', lit: true, stream: 'live', held: false }
        : path.endsWith('/ingress') ? { version: 1, status: 'accepted' } : { version: 1, status: 'kingdom', stream: 'live', lights: 1, moment: null };
      return new Response(JSON.stringify(answer), { status: path.endsWith('/ingress') ? 202 : 200 });
    },
  });
  const server = createServer((req, res) => { void handler(req, res, new URL(req.url!, 'http://test').pathname); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address() as { port: number };
  const call = async (name: string, jwt: string, body: unknown = {}) => fetch(`http://127.0.0.1:${address.port}/api/panel/v1/${name}`, {
    method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { call, requests };
}

describe('verified panel door', () => {
  it('uses only JWT identity, approved names and the real ingress envelope; confirms only after realm evidence', async () => {
    const { call, requests } = await start();
    const answer = await call('light', await token());
    expect(await answer.json()).toMatchObject({ status: 'deed', lit: true });
    expect(requests.find(r => r.path.endsWith('/claim'))?.body).toEqual({ kingdomId: '1234', personId: '5678', name: 'Wren' });
    expect(requests.find(r => r.path.endsWith('/ingress'))?.body).toMatchObject({ version: 1, observation: { kingdomId: '1234', source: 'panel', people: [{ personId: '5678', disclosure: 'named', displayName: 'Wren' }] } });
    expect((await call('light', await token(), { channelId: '9999', personId: '9999' })).status).toBe(400);
  });
  it('uses the verified subject for privacy and quiet, and refuses unconfirmed or unavailable erasure', async () => {
    const { call, requests } = await start(), jwt = await token();
    expect(await (await call('privacy', jwt)).json()).toMatchObject({ status: 'privacy', quiet: false, projection: 'pending', forgetAvailable: false });
    expect(requests.at(-1)).toEqual({ path: '/internal/realm/panel/privacy', body: { kingdomId: '1234', personId: '5678' } });
    expect(await (await call('quiet', jwt, { quiet: true })).json()).toMatchObject({ status: 'quiet', quiet: true });
    expect(requests.at(-1)?.body).toEqual({ quiet: true, kingdomId: '1234', personId: '5678' });
    for (const [route, body] of [['privacy', { personId: '9999' }], ['quiet', { quiet: true, personId: '9999' }], ['quiet', { quiet: 'true' }], ['forget', {}], ['forget', { confirm: false }], ['forget', { confirm: true, personId: '9999' }]] as const) {
      expect((await call(route, jwt, body)).status).toBe(400);
    }
    expect(requests).toHaveLength(2);
    expect((await call('forget', jwt, { confirm: true })).status).toBe(503);
    expect(requests.at(-1)).toEqual({ path: '/internal/realm/panel/forget', body: { confirm: true, kingdomId: '1234', personId: '5678' } });
    for (const [route, body] of [['privacy', {}], ['quiet', { quiet: true }], ['forget', { confirm: true }]] as const) {
      expect((await call(route, await token({ user_id: undefined }), body)).status).toBe(403);
    }
    expect(requests).toHaveLength(3);
  });
  it('refuses unshared, logged-out, forged, expired and external tokens before any realm write', async () => {
    const { call, requests } = await start();
    for (const jwt of [await token({ user_id: undefined }), await token({ opaque_user_id: 'Aviewer', user_id: undefined }), await token({}, new Uint8Array(32).fill(9)), await token({ role: 'external' }), await new SignJWT({ channel_id: '1234', opaque_user_id: 'Uviewer', role: 'viewer', user_id: '5678' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(Math.floor(Date.now()/1000)-60).sign(key), await token({ opaque_user_id: 'Aviewer' })]) {
      expect([401, 403]).toContain((await call('light', jwt)).status);
    }
    expect(requests).toHaveLength(0);
  });
});
