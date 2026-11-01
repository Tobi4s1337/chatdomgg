import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { createPanelHttp } from './http';
import { PanelPictures } from './pictures';
import { DEFAULT_SETTINGS } from '../../../panel/src/settings/schema';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const key = new Uint8Array(32).fill(42);
async function token(claims: Record<string, unknown> = {}, signing = key) {
  return new SignJWT({ channel_id: '1234', opaque_user_id: 'Uviewer', role: 'viewer', user_id: '5678', ...claims }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('5m').sign(signing);
}
async function start(extension: { clientId: string; secret: string } | null = { clientId: 'panel-lane', secret: Buffer.from(key).toString('base64') }) {
  const directory = await mkdtemp(join(tmpdir(), 'panel-pictures-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const handler = createPanelHttp({
    extension, origin: 'live',
    authority: { reading: async () => ({ version: 1, kingdom: null, viewer: { kind: 'anonymous' } }), cardSource: async () => { throw new Error(); } },
  }, {
    realmOrigin: 'http://realm.invalid', panelSecret: 'p'.repeat(40), painterSecret: 's'.repeat(40), pictures: new PanelPictures(directory),
    users: { person: async () => ({ login: 'wren', displayName: 'Wren', colour: null }) },
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ path, body });
      if (path.endsWith('/settings') || path.endsWith('/settings-save')) return Response.json({ version: 1, status: 'settings', revision: '1', settings: body.settings ?? DEFAULT_SETTINGS, connected: true });
      if (path.endsWith('/gift-status') || path.endsWith('/gift-resolve')) return new Response(JSON.stringify({ version: 1, status: 'pending' }));
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
  const health = () => fetch(`http://127.0.0.1:${address.port}/api/panel/v1/health`);
  return { call, requests, health };
}

describe('verified panel door', () => {
  it('mounts configuration with verified broadcaster ownership, never selected channel identities', async () => {
    const { call, requests } = await start();
    expect(await (await call('configuration', await token())).json()).toMatchObject({ status: 'settings', revision: '1', connected: true });
    expect(requests.at(-1)).toEqual({ path: '/internal/realm/panel/settings', body: { kingdomId: '1234' } });
    const settings = { ...DEFAULT_SETTINGS, hidden: true };
    expect((await call('configure', await token(), { expectedRevision: '0', settings })).status).toBe(403);
    expect((await call('configure', await token({ role: 'broadcaster' }), { expectedRevision: '0', settings })).status).toBe(403);
    const broadcaster = await token({ role: 'broadcaster', user_id: '1234' });
    expect(await (await call('configure', broadcaster, { expectedRevision: '0', settings })).json()).toMatchObject({ status: 'settings', settings: { hidden: true } });
    expect(requests.at(-1)).toEqual({ path: '/internal/realm/panel/settings-save', body: { kingdomId: '1234', personId: '1234', expectedRevision: '0', settings } });
    expect((await call('configure', broadcaster, { expectedRevision: '1', settings, kingdomId: '9999' })).status).toBe(400);
    expect(requests).toHaveLength(2);
  });
  it('names missing setup without credential values or startup exceptions', async () => {
    for (const extension of [null, { clientId: 'panel-lane', secret: 'invalid' }]) {
      const { health, call, requests } = await start(extension);
      const response = await health();
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toMatchObject({ status: 'unavailable', missing: expect.arrayContaining(['TWITCH_EXTENSION_SECRET']) });
      expect(JSON.stringify(body)).not.toContain('invalid');
      expect((await call('configure', await token(), {})).status).toBe(503);
      expect(requests).toHaveLength(0);
    }
  });
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
  it('mounts gift recovery using only JWT identity and refuses selected subjects', async () => {
    const { call, requests } = await start(), jwt = await token(), intentId = '11111111-1111-4111-8111-111111111111';
    expect(await (await call('gift-status', jwt, { intentId })).json()).toMatchObject({ status: 'pending' });
    expect(requests.at(-1)).toEqual({ path: '/internal/realm/panel/gift-status', body: { kingdomId: '1234', personId: '5678', intentId } });
    expect((await call('gift-status', jwt, { intentId, personId: '9999' })).status).toBe(400);
    const paymentRef = '22222222-2222-4222-8222-222222222222';
    expect(await (await call('gift-resolve', jwt, { paymentRef, intentId })).json()).toMatchObject({ status: 'pending' });
    expect(requests.at(-1)).toEqual({ path: '/internal/realm/panel/gift-resolve', body: { kingdomId: '1234', personId: '5678', paymentRef, intentId } });
    expect((await call('gift-resolve', await token({ user_id: undefined }), { paymentRef, intentId })).status).toBe(403);
    expect(requests).toHaveLength(2);
  });
  it('refuses unshared, logged-out, forged, expired and external tokens before any realm write', async () => {
    const { call, requests } = await start();
    for (const jwt of [await token({ user_id: undefined }), await token({ opaque_user_id: 'Aviewer', user_id: undefined }), await token({}, new Uint8Array(32).fill(9)), await token({ role: 'external' }), await new SignJWT({ channel_id: '1234', opaque_user_id: 'Uviewer', role: 'viewer', user_id: '5678' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(Math.floor(Date.now()/1000)-60).sign(key), await token({ opaque_user_id: 'Aviewer' })]) {
      expect([401, 403]).toContain((await call('light', jwt)).status);
    }
    expect(requests).toHaveLength(0);
  });
});
