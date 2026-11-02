import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORGE_CHAT_LIMITS, FORGE_CHAT_ROUTES, KingdomIdSchema } from '@chatdom/shared';
import { REALM_AUTH_ROUTES } from '@chatdom/shared/realm';
import { browserForgeTransport } from './transport';

const K = KingdomIdSchema.parse('129634568');
const ID = 'fd6d297c-8ac4-4397-86af-2bc772b41363';
const SESSION = { version: 1, status: 'authenticated', expiresAt: Date.now() + 3_600_000,
  resumeScope: 'SIMULATED-private-session-scope', csrfToken: 'SIMULATED-csrf-token-0123456789abcdef' };
const SENT = { status: 'sent', requestId: ID, kingdomId: K, updatedAt: 100,
  messageId: 'SIMULATED-message', receiptId: 'forge:simulated-receipt' };
const STATUS = { version: 1, status: 'ok', kingdomId: K, grant: { status: 'ready' }, availability: { status: 'ready' }, wish: SENT };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('Forge browser transport', () => {
  it('exposes only the opaque storage partition and sends exact requests with fresh session CSRF', async () => {
    const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === REALM_AUTH_ROUTES.session) return json(SESSION);
      expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      if (path.startsWith(FORGE_CHAT_ROUTES.status)) return json(STATUS);
      expect(init?.headers).toMatchObject({ 'X-CSRF-Token': SESSION.csrfToken });
      expect(JSON.parse(String(init?.body))).toEqual({ version: 1, kingdomId: K, requestId: ID, words: 'a lantern with blue glass' });
      return json({ version: 1, status: 'accepted', wish: SENT }, 202);
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await browserForgeTransport.session()).toEqual({ resumeScope: SESSION.resumeScope });
    expect(await browserForgeTransport.status(K, ID, undefined, SESSION.resumeScope)).toEqual(STATUS);
    expect(await browserForgeTransport.wish(K, ID, '  a lantern with blue glass  ', undefined, SESSION.resumeScope)).toEqual(SENT);
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      REALM_AUTH_ROUTES.session, REALM_AUTH_ROUTES.session,
      `${FORGE_CHAT_ROUTES.status}?kingdomId=${K}&requestId=${ID}`, REALM_AUTH_ROUTES.session, FORGE_CHAT_ROUTES.wish,
    ]);
  });

  it('never retries an ambiguous send and detaches its POST from the panel signal', async () => {
    const controller = new AbortController();
    let sends = 0;
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      if (path === REALM_AUTH_ROUTES.session) return json(SESSION);
      sends++;
      expect(init?.signal).toBeUndefined();
      controller.abort();
      throw new TypeError('SIMULATED-provider-secret');
    }));
    await expect(browserForgeTransport.wish(K, ID, 'a lantern', controller.signal)).rejects.toMatchObject({
      code: 'connection-lost', ambiguous: true,
      message: 'The reply was lost. Your wish may already be in Twitch chat. Checking its status will not send it again.',
    });
    expect(sends).toBe(1);
  });

  it('rejects a changed session scope before reading status or posting authorize/wish', async () => {
    const fetcher = vi.fn(async () => json({ ...SESSION, resumeScope: 'SIMULATED-another-session-scope' }));
    vi.stubGlobal('fetch', fetcher);
    await expect(browserForgeTransport.authorize(K, undefined, SESSION.resumeScope))
      .rejects.toMatchObject({ code: 'unauthenticated', ambiguous: false });
    await expect(browserForgeTransport.wish(K, ID, 'a lantern', undefined, SESSION.resumeScope))
      .rejects.toMatchObject({ code: 'unauthenticated', ambiguous: false });
    await expect(browserForgeTransport.status(K, ID, undefined, SESSION.resumeScope))
      .rejects.toMatchObject({ code: 'unauthenticated', ambiguous: false });
    expect(fetcher.mock.calls).toHaveLength(3);
    for (const call of fetcher.mock.calls) expect(call).toMatchObject([REALM_AUTH_ROUTES.session, { method: 'GET' }]);
  });

  it('allows anonymous status without restoring another session scope', async () => {
    const signedOut = { ...STATUS, grant: { status: 'signed-out' }, wish: null };
    const fetcher = vi.fn(async (path: string) => json(path === REALM_AUTH_ROUTES.session
      ? { version: 1, status: 'anonymous' } : signedOut));
    vi.stubGlobal('fetch', fetcher);
    expect(await browserForgeTransport.status(K)).toEqual(signedOut);
    fetcher.mockClear();
    await expect(browserForgeTransport.status(K, undefined, undefined, SESSION.resumeScope))
      .rejects.toMatchObject({ code: 'unauthenticated', ambiguous: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('fails cold on mismatched request/kingdom or malformed replies without exposing their contents', async () => {
    for (const body of [
      { ...STATUS, kingdomId: '129634569', wish: null },
      { ...STATUS, wish: { ...SENT, requestId: 'fd6d297c-8ac4-4397-86af-2bc772b41364' } },
      { ...STATUS, token: 'SIMULATED-provider-secret' },
    ]) {
      vi.stubGlobal('fetch', async (path: string) => json(path === REALM_AUTH_ROUTES.session ? SESSION : body));
      await expect(browserForgeTransport.status(K, ID)).rejects.toMatchObject({ code: 'invalid-response', ambiguous: false });
    }
    vi.stubGlobal('fetch', async (path: string) => path === REALM_AUTH_ROUTES.session ? json(SESSION)
      : new Response('SIMULATED-private-provider-response', { status: 502 }));
    await expect(browserForgeTransport.wish(K, ID, 'a lantern')).rejects.toMatchObject({ code: 'invalid-response', ambiguous: true });
  });

  it('validates Twitch navigation targets and keeps finite API failures', async () => {
    for (const authorizationUrl of ['https://other.example/oauth2/authorize', 'https://id.twitch.tv/other',
      'https://id.twitch.tv/oauth2/authorize#SIMULATED-fragment']) {
      vi.stubGlobal('fetch', async (path: string) => json(path === REALM_AUTH_ROUTES.session ? SESSION
        : { version: 1, status: 'authorize', authorizationUrl }));
      await expect(browserForgeTransport.authorize(K)).rejects.toMatchObject({ code: 'invalid-response' });
    }
    const target = 'https://id.twitch.tv/oauth2/authorize?client_id=SIMULATED-client';
    vi.stubGlobal('fetch', async (path: string) => json(path === REALM_AUTH_ROUTES.session ? SESSION
      : { version: 1, status: 'authorize', authorizationUrl: target }));
    expect(await browserForgeTransport.authorize(K, undefined, SESSION.resumeScope)).toBe(target);
    vi.stubGlobal('fetch', async (path: string) => path === REALM_AUTH_ROUTES.session ? json(SESSION)
      : json({ version: 1, status: 'error', code: 'rate-limited', message: 'Wait a little before trying again.', retryAt: 1000 }, 429));
    await expect(browserForgeTransport.wish(K, ID, 'a lantern')).rejects.toMatchObject({ code: 'rate-limited', retryAt: 1000, ambiguous: false });
  });

  it('refuses anonymous or expired sessions and invalid inputs before any POST', async () => {
    const fetcher = vi.fn(async () => json({ version: 1, status: 'anonymous' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await browserForgeTransport.session()).toBeNull();
    await expect(browserForgeTransport.wish(K, ID, 'a lantern')).rejects.toMatchObject({ code: 'unauthenticated', ambiguous: false });
    expect(fetcher.mock.calls).toHaveLength(2);
    fetcher.mockClear();
    for (const words of ['x'.repeat(FORGE_CHAT_LIMITS.words + 1), 'a lantern\nthen a door']) {
      await expect(browserForgeTransport.wish(K, ID, words)).rejects.toMatchObject({ code: 'invalid-request' });
    }
    await expect(browserForgeTransport.status(K, '')).rejects.toMatchObject({ code: 'invalid-request' });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockImplementation(async () => json({ ...SESSION, expiresAt: 1 }));
    await expect(browserForgeTransport.authorize(K)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
