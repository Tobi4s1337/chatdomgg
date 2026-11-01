import type { IncomingHttpHeaders } from 'node:http';
import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { describe, expect, it, vi } from 'vitest';
import { FORGE_CHAT_ROUTES, KingdomIdSchema, type ForgeChatWish } from '@chatdom/shared';
import { csrfFor, sha256 } from '../../../api/src/realm-auth/secrets';
import type { DockSessionPool } from '../../../api/src/dock/auth';
import { createForgeChatHttpHandler, mountForgeChatRoutes, type ForgeChatHttpRequest } from './http';
import type { ForgeChatService } from './service';

const kingdomId = KingdomIdSchema.parse('100');
const sessionId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const publicOrigin = 'https://chatdom.test';
const validHeaders: IncomingHttpHeaders = { cookie: '__Host-chatdom_session=SIMULATED-session', origin: publicOrigin,
  'x-csrf-token': csrfFor('SIMULATED-session'), 'sec-fetch-site': 'same-origin' };
function fixture() {
  let active = true;
  const query = vi.fn<DockSessionPool['query']>(async () => ({ rows: active ? [{ person_id: '200', session_id: sessionId }] : [] }));
  const service: ForgeChatService = {
    status: vi.fn<ForgeChatService['status']>(async () => ({ version: 1 as const, status: 'ok' as const, kingdomId, grant: { status: 'ready' as const }, availability: { status: 'ready' as const }, wish: null })),
    authorize: vi.fn<ForgeChatService['authorize']>(async () => ({ version: 1 as const, status: 'authorize' as const, authorizationUrl: 'https://id.twitch.tv/oauth2/authorize' })),
    callback: vi.fn<ForgeChatService['callback']>(async (_principal, _query, current) => await current() ? `/kingdom/${kingdomId}?forgeChat=connected` : '/?forgeChat=expired'),
    revoke: vi.fn<ForgeChatService['revoke']>(async () => ({ version: 1 as const, status: 'revoked' as const })),
    wish: vi.fn<ForgeChatService['wish']>(async (_principal, _raw, current) => {
      const base = { requestId, kingdomId, updatedAt: 1_800_000_000_000 };
      const wish: ForgeChatWish = await current() ? { ...base, status: 'sending' }
        : { ...base, status: 'unknown', message: 'SIMULATED session expired before send.' };
      return { version: 1 as const, status: 'accepted' as const, wish };
    }),
    observe: vi.fn(async () => {}), start: vi.fn(async () => {}), stop: vi.fn(async () => {}),
  };
  const options = { pool: { query }, origin: 'simulated' as const, publicOrigin, secureCookies: true };
  const handle = createForgeChatHttpHandler(service, options);
  const call = (path: string, extra: Partial<ForgeChatHttpRequest> = {}) => handle({ method: path === FORGE_CHAT_ROUTES.status || path === FORGE_CHAT_ROUTES.callback ? 'GET' : 'POST',
    path, query: path === FORGE_CHAT_ROUTES.status ? `kingdomId=${kingdomId}` : '', headers: validHeaders,
    body: { version: 1, kingdomId, requestId, words: 'SIMULATED a moon above my door' }, ...extra });
  return { service, options, query, handle, call, endSession: () => { active = false; } };
}

describe('Forge HTTP session and mutation authority', () => {
  it('uses the actual origin-bound hash lookup and passes only its stored principal to the service', async () => {
    const { call, service, query } = fixture();
    expect((await call(FORGE_CHAT_ROUTES.wish)).http).toBe(202);
    expect(query.mock.calls[0]?.[0]).toContain('revoked_at is null and expires_at > now()');
    expect(query.mock.calls[0]?.[1]).toEqual([sha256('SIMULATED-session'), 'simulated']);
    expect(vi.mocked(service.wish).mock.calls[0]?.[0]).toEqual({ personId: '200', sessionId });
    expect(query.mock.calls.length).toBeGreaterThan(1);
  });

  it.each([
    ['missing Origin', { ...validHeaders, origin: undefined }],
    ['foreign Origin', { ...validHeaders, origin: 'https://foreign.test' }],
    ['missing CSRF', { ...validHeaders, 'x-csrf-token': undefined }],
    ['different session CSRF', { ...validHeaders, 'x-csrf-token': csrfFor('SIMULATED-other-session') }],
    ['cross-site fetch', { ...validHeaders, 'sec-fetch-site': 'cross-site' }],
  ])('refuses every mutation with %s', async (_label, headers) => {
    const { call, service } = fixture();
    for (const path of [FORGE_CHAT_ROUTES.authorize, FORGE_CHAT_ROUTES.wish, FORGE_CHAT_ROUTES.revoke]) {
      expect((await call(path, { headers })).http).toBe(403);
    }
    expect(service.authorize).not.toHaveBeenCalled(); expect(service.wish).not.toHaveBeenCalled(); expect(service.revoke).not.toHaveBeenCalled();
  });

  it('requires the secure deployment cookie and refuses expired or revoked sessions', async () => {
    const { call, service, endSession } = fixture();
    expect((await call(FORGE_CHAT_ROUTES.wish, { headers: { ...validHeaders, cookie: 'chatdom_session=SIMULATED-session' } })).http).toBe(401);
    endSession();
    expect((await call(FORGE_CHAT_ROUTES.wish)).http).toBe(401);
    expect(service.wish).not.toHaveBeenCalled();
  });

  it('permits anonymous status but never supplies an anonymous mutation principal', async () => {
    const { call, service } = fixture();
    expect((await call(FORGE_CHAT_ROUTES.status, { headers: {} })).http).toBe(200);
    expect(vi.mocked(service.status).mock.calls[0]?.[0]).toBeNull();
    expect((await call(FORGE_CHAT_ROUTES.authorize, { headers: {} })).http).toBe(401);
    expect(service.authorize).not.toHaveBeenCalled();
  });

  it('accepts the OAuth top-level callback without Origin or CSRF and strips invalid sessions to a fixed return', async () => {
    const { call, service, endSession } = fixture();
    const answer = await call(FORGE_CHAT_ROUTES.callback, { headers: { cookie: validHeaders.cookie }, query: 'state=SIMULATED-state&code=SIMULATED-code' });
    expect(answer).toEqual({ http: 303, redirect: `/kingdom/${kingdomId}?forgeChat=connected` });
    expect(service.callback).toHaveBeenCalledOnce();
    endSession();
    expect(await call(FORGE_CHAT_ROUTES.callback)).toEqual({ http: 303, redirect: '/?forgeChat=expired' });
    expect(service.callback).toHaveBeenCalledOnce();
  });

  it('rejects duplicate query values and unsupported status identity fields', async () => {
    const { call, service } = fixture();
    for (const query of ['kingdomId=100&kingdomId=999', 'kingdomId=100&personId=999', 'kingdomId=100&requestId=a&requestId=b']) {
      expect((await call(FORGE_CHAT_ROUTES.status, { query })).http).toBe(400);
    }
    expect(await call(FORGE_CHAT_ROUTES.callback, { query: 'state=first&state=second' })).toEqual({ http: 303, redirect: '/?forgeChat=expired' });
    expect(service.status).not.toHaveBeenCalled(); expect(service.callback).not.toHaveBeenCalled();
  });

  it('requires a valid configured public origin and corresponding cookie policy', () => {
    const { service, options } = fixture();
    expect(() => createForgeChatHttpHandler(service, { ...options, publicOrigin: 'https://chatdom.test/path' })).toThrow();
    expect(() => createForgeChatHttpHandler(service, { ...options, publicOrigin: 'http://chatdom.test', secureCookies: false })).toThrow();
    expect(() => createForgeChatHttpHandler(service, { ...options, secureCookies: false })).toThrow();
    expect(() => createForgeChatHttpHandler(service, { ...options, publicOrigin: 'http://127.0.0.1:5170', secureCookies: false })).not.toThrow();
  });
});

type App = uWebSocketsTransport['app'];
describe('bounded Forge uWS route adapter', () => {
  function mounted() {
    const { service, options } = fixture();
    type Callback = (res: unknown, req: unknown) => void;
    const callbacks = new Map<string, Callback>();
    const app = { get: (route: string, callback: Callback) => callbacks.set(`GET ${route}`, callback), post: (route: string, callback: Callback) => callbacks.set(`POST ${route}`, callback) };
    mountForgeChatRoutes(app as unknown as App, service, options);
    const call = async (method: string, path: string, chunks: string[], headers: Record<string, string> = {}) => {
      let onData: ((chunk: ArrayBuffer, last: boolean) => void) | undefined;
      let status = '', body = '';
      const returnedHeaders = new Map<string, string>();
      const response = {
        onAborted() { return this; },
        cork(callback: () => void) { callback(); return this; },
        writeStatus(value: string) { status = value; return this; },
        writeHeader(key: string, value: string) { returnedHeaders.set(key, value); return this; },
        end(value = '') { body = value; return this; },
        onData(callback: typeof onData) { onData = callback; return this; },
      };
      const sentHeaders: IncomingHttpHeaders = { ...validHeaders, 'content-type': 'application/json', ...headers };
      const request = { getQuery: () => `kingdomId=${kingdomId}`, getHeader: (key: string) => {
        const value = sentHeaders[key]; return typeof value === 'string' ? value : '';
      } };
      callbacks.get(`${method} ${path}`)!(response, request);
      chunks.forEach((chunk, index) => { const bytes = Uint8Array.from(Buffer.from(chunk)); onData?.(bytes.buffer, index === chunks.length - 1); });
      await vi.waitFor(() => expect(status).not.toBe(''));
      return { status, body, headers: returnedHeaders };
    };
    return { call, service, callbacks };
  }
  it('registers only the five frozen browser routes', () => {
    const { callbacks } = mounted();
    expect([...callbacks.keys()]).toEqual(expect.arrayContaining(Object.values(FORGE_CHAT_ROUTES).map(path => `${[FORGE_CHAT_ROUTES.status, FORGE_CHAT_ROUTES.callback].includes(path as never) ? 'GET' : 'POST'} ${path}`)));
    expect(callbacks.size).toBe(5);
  });
  it('rejects overlong streamed bytes, malformed JSON and non-JSON before application entry', async () => {
    const { call, service } = mounted();
    expect((await call('POST', FORGE_CHAT_ROUTES.wish, ['x'.repeat(4097)])).status).toBe('413 Payload Too Large');
    expect((await call('POST', FORGE_CHAT_ROUTES.wish, ['{broken'])).status).toBe('400 Bad Request');
    expect((await call('POST', FORGE_CHAT_ROUTES.wish, ['{}'], { 'content-type': 'text/plain' })).status).toBe('415 Unsupported Media Type');
    expect(service.wish).not.toHaveBeenCalled();
  });
  it('marks successful private JSON replies no-store and strips callback referrers', async () => {
    const { call } = mounted();
    const answer = await call('GET', FORGE_CHAT_ROUTES.status, []);
    expect(answer.status).toBe('200 OK');
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    expect(answer.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(answer.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(JSON.parse(answer.body)).toMatchObject({ status: 'ok' });
  });
});
