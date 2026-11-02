import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type ForgeChatObservation, type ForgeChatWish } from '@chatdom/shared';
import type { ChatGrant, ChatGrantContext, ChatOAuthState, ForgeChatStore } from './store';
import { ForgeChatRequestConflict } from './store';
import { createForgeChatService, type ForgeChatServiceOptions } from './service';
import type { ForgeChatConfig } from './config';

const NOW = 1_800_000_000_000;
const kingdomId = KingdomIdSchema.parse('100');
const personId = PersonIdSchema.parse('200');
const principal = { personId, sessionId: '00000000-0000-4000-8000-000000000001' };
const requestId = '00000000-0000-4000-8000-000000000002';
const authoredWords = 'SIMULATED a copper moon above my doorway';
const body = { version: 1, kingdomId, requestId, words: authoredWords };
const config: ForgeChatConfig = { clientId: 'SIMULATED-client', clientSecret: 'SIMULATED-secret',
  redirectUri: 'https://chatdom.test/api/realm/forge/chat/callback', tokenKey: Buffer.alloc(32, 7) };
const grant = (): ChatGrant => ({ accessToken: 'SIMULATED-access', refreshToken: 'SIMULATED-refresh',
  expiresAt: NOW + 4 * 60 * 60_000, validatedAt: NOW });
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});
const validation = (extra: Record<string, unknown> = {}) => json({ client_id: config.clientId, user_id: personId,
  scopes: ['user:write:chat'], expires_in: 3600, ...extra });
const token = () => json({ access_token: 'SIMULATED-rotated-access', refresh_token: 'SIMULATED-rotated-refresh',
  expires_in: 3600, token_type: 'bearer' });
const sent = (messageId = 'SIMULATED-chat-message') => json({ data: [{ is_sent: true, message_id: messageId }] });
const terminal = new Set(['delivered', 'held', 'refused', 'cold', 'canceled', 'not-sent']);

/** Isolated SIMULATED persistence for application tests; production uses the PostgreSQL implementation. */
class SimulatedStore implements ForgeChatStore {
  readonly grants = new Map<string, ChatGrant>();
  readonly states = new Map<string, ChatOAuthState>();
  readonly requests = new Map<string, { personId: string; wish: ForgeChatWish; digest: string }>();
  readonly observations = new Map<string, ForgeChatObservation>();
  private readonly locks = new Map<string, Promise<unknown>>();
  now = NOW;
  sessionActive: boolean | undefined;
  async withGrantLock<T>(owner: string, action: (current: ChatGrant | null, save: (next: ChatGrant | null) => Promise<void>, context?: ChatGrantContext) => Promise<T>): Promise<T> {
    const previous = this.locks.get(owner) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(() => action(this.grants.get(owner) ?? null, async next => {
      if (next) this.grants.set(owner, next);
      else {
        this.grants.delete(owner);
        for (const [key, state] of this.states) if (state.personId === owner) this.states.delete(key);
      }
    }, { takeState: (hash, session, at) => this.takeState(hash, session, owner, at),
      ...(this.sessionActive === undefined ? {} : { sessionCurrent: async () => this.sessionActive === true }) }));
    this.locks.set(owner, operation);
    return operation;
  }
  async listGrantPeople() { return [...this.grants.keys()]; }
  async putState(state: ChatOAuthState) {
    for (const [key, existing] of this.states) if (existing.personId === state.personId) this.states.delete(key);
    this.states.set(state.hash, state);
  }
  async takeState(hash: string, sessionId: string, owner: string, at: number) {
    const state = this.states.get(hash);
    if (!state || state.sessionId !== sessionId || state.personId !== owner || state.expiresAt <= at) return null;
    this.states.delete(hash); return { kingdomId: state.kingdomId, scopes: state.scopes };
  }
  private key(owner: string, id: string) { return `${owner}:${id}`; }
  private observedKey(owner: string, kingdom: string, messageId: string) { return `${owner}:${kingdom}:${messageId}`; }
  async claimWish(owner: string, wish: ForgeChatWish, digest = '') {
    const key = this.key(owner, wish.requestId), existing = this.requests.get(key);
    if (existing) {
      if (existing.wish.kingdomId !== wish.kingdomId || existing.digest !== digest) throw new ForgeChatRequestConflict();
      return { created: false, wish: this.interrupted(existing.wish) };
    }
    this.requests.set(key, { personId: owner, wish, digest }); return { created: true, wish };
  }
  private interrupted(wish: ForgeChatWish): ForgeChatWish {
    return wish.status === 'sending' && wish.updatedAt + 30_000 <= this.now
      ? { ...wish, status: 'unknown', message: 'SIMULATED interrupted send; inspect chat before sending again.' } : wish;
  }
  async getWish(owner: string, kingdom: string, id?: string) {
    const existing = [...this.requests.values()].filter(row => row.personId === owner && row.wish.kingdomId === kingdom && (!id || row.wish.requestId === id));
    const wish = existing.at(-1)?.wish; return wish ? this.interrupted(wish) : null;
  }
  async setWish(owner: string, wish: ForgeChatWish) {
    const existing = this.requests.get(this.key(owner, wish.requestId));
    if (!existing) throw new Error('SIMULATED unclaimed request');
    if (terminal.has(existing.wish.status) || 'messageId' in existing.wish) return;
    existing.wish = wish;
  }
  private apply(wish: ForgeChatWish, observation: ForgeChatObservation): ForgeChatWish {
    if (!('messageId' in wish) || wish.status === 'delivered'
      || (terminal.has(wish.status) && observation.status !== 'delivered')) return wish;
    const base = { requestId: wish.requestId, kingdomId: wish.kingdomId, messageId: wish.messageId,
      receiptId: wish.receiptId, updatedAt: observation.at };
    if (observation.status === 'working') return { ...base, status: 'working' };
    if (observation.status === 'delivered') return { ...base, status: 'delivered', attachmentId: observation.attachmentId,
      committedAt: observation.committedAt, ...(observation.message ? { message: observation.message } : {}) };
    return { ...base, status: observation.status, message: observation.message };
  }
  async bindSent(owner: string, wish: Extract<ForgeChatWish, { status: 'sent' }>) {
    const existing = this.requests.get(this.key(owner, wish.requestId));
    if (!existing) throw new Error('SIMULATED unclaimed request');
    const key = this.observedKey(owner, wish.kingdomId, wish.messageId), observation = this.observations.get(key);
    const result = observation ? this.apply(wish, observation) : wish;
    this.observations.delete(key); existing.wish = result; return result;
  }
  async observe(observation: ForgeChatObservation) {
    const existing = [...this.requests.values()].find(row => row.personId === observation.personId
      && row.wish.kingdomId === observation.kingdomId && 'messageId' in row.wish && row.wish.messageId === observation.messageId);
    if (existing) { existing.wish = this.apply(existing.wish, observation); return; }
    const key = this.observedKey(observation.personId, observation.kingdomId, observation.messageId), previous = this.observations.get(key);
    if (!previous || previous.status === 'working') this.observations.set(key, observation);
  }
  async cleanup() {}
}

function setup(options: { enabled?: boolean; fetcher?: typeof fetch; ready?: boolean; store?: SimulatedStore; existingScopes?: readonly string[];
  recoverCommitted?: ForgeChatServiceOptions['recoverCommitted']; authorizationData?: unknown } = {}) {
  const store = options.store ?? new SimulatedStore();
  const fetcher = options.fetcher ?? vi.fn(async () => sent()) as typeof fetch;
  // Read-only app authorization discovery is separate from the user-token transport under assertion.
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/token') && new URLSearchParams(String(init?.body)).get('grant_type') === 'client_credentials') {
      return json({ access_token: 'SIMULATED-app-access', token_type: 'bearer', expires_in: 3600 });
    }
    if (url.includes('/helix/authorization/users?')) return json({ data: options.authorizationData ?? [{ user_id: personId,
      has_authorized: !!options.existingScopes?.length, scopes: options.existingScopes ?? [] }] });
    return fetcher(input, init);
  };
  const target = vi.fn(async () => ({ broadcasterId: kingdomId, availability: options.ready === false
    ? { status: 'cold' as const, reason: 'stream-offline' as const, message: 'The stream is offline.' }
    : { status: 'ready' as const } }));
  const service = createForgeChatService({ origin: 'simulated', store, config: options.enabled === false ? null : config,
    fetch: transport, now: () => store.now, resolveTarget: target,
    ...(options.recoverCommitted ? { recoverCommitted: options.recoverCommitted } : {}) });
  return { service, store, fetcher, target };
}
async function pending(service: ReturnType<typeof createForgeChatService>) {
  const reply = await service.authorize(principal, { version: 1, kingdomId });
  const url = new URL(reply.authorizationUrl), state = url.searchParams.get('state')!;
  return { reply, url, state, query: new URLSearchParams({ state, code: 'SIMULATED-code' }) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('separate Forge chat permission', () => {
  it('shows a warm unavailable state without using the Twitch transport when unconfigured', async () => {
    const { service, fetcher } = setup({ enabled: false });
    expect(await service.status(principal, { version: 1, kingdomId })).toMatchObject({ grant: { status: 'unavailable', reason: 'not-configured' }, wish: null });
    await expect(service.wish(principal, body, async () => true)).rejects.toMatchObject({ code: 'not-configured' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('asks only for chat permission and persists a hashed, session-bound state', async () => {
    const { service, store } = setup();
    const { url, state } = await pending(service);
    expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
    expect(url.searchParams.get('scope')).toBe('user:write:chat');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect([...store.states.values()]).toEqual([expect.objectContaining({ sessionId: principal.sessionId,
      personId, kingdomId, hash: createHash('sha256').update(state).digest('hex') })]);
    expect(JSON.stringify([...store.states.values()])).not.toContain(state);
  });

  it('preserves existing same-client grants while adding chat, and rejects a callback that narrowed them', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/token') ? token() : validation());
    const { service, store } = setup({ fetcher: fetcher as typeof fetch, existingScopes: ['openid', 'channel:bot'] });
    const { url, query } = await pending(service);
    expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual(['channel:bot', 'openid', 'user:write:chat']);
    expect(await service.callback(principal, query, async () => true)).toContain('forgeChat=wrong-account');
    expect(store.grants.has(personId)).toBe(false);
    expect(fetcher.mock.calls.some(([input]) => String(input).endsWith('/revoke'))).toBe(true);
  });

  it('fails cold when same-client grant discovery has no authoritative user row', async () => {
    const { service, store } = setup({ authorizationData: [] });
    await expect(service.authorize(principal, { version: 1, kingdomId })).rejects.toMatchObject({ code: 'unavailable' });
    expect(store.states.size).toBe(0);
  });

  it.each([
    ['account', { user_id: '999' }], ['client', { client_id: 'SIMULATED-another-client' }], ['scope', { scopes: ['openid'] }],
  ])('rejects an OAuth token with the wrong %s', async (_name, mismatch) => {
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/token') ? token() : validation(mismatch));
    const { service, store } = setup({ fetcher: fetcher as typeof fetch });
    const { query } = await pending(service);
    const result = await service.callback(principal, query, async () => true).catch(error => error);
    expect(typeof result === 'string' ? result : result.code).toMatch(/wrong-account|consent-required/u);
    expect(store.grants.size).toBe(0);
  });

  it('requires the exact current session and consumes authorization state once', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/token') ? token() : validation());
    const { service, store } = setup({ fetcher: fetcher as typeof fetch });
    const { query } = await pending(service);
    const wrong = await service.callback({ ...principal, sessionId: '00000000-0000-4000-8000-000000000099' }, query, async () => true).catch(error => error);
    expect(typeof wrong === 'string' ? wrong : wrong.code).toMatch(/expired|forbidden/u);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await service.callback(principal, query, async () => true)).toBe(`/?walk=1&kingdom=${kingdomId}&forgeChat=connected`);
    expect(store.grants.get(personId)?.accessToken).toBe('SIMULATED-rotated-access');
    const used = await service.callback(principal, query, async () => true).catch(error => error);
    expect(typeof used === 'string' ? used : used.code).toMatch(/expired|forbidden/u);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('expires a state and does not exchange a code from it', async () => {
    const { service, store, fetcher } = setup();
    const { query } = await pending(service); store.now += 10 * 60_000;
    const result = await service.callback(principal, query, async () => true).catch(error => error);
    expect(typeof result === 'string' ? result : result.code).toMatch(/expired|forbidden/u);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not save a grant if the app session expires during code exchange', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/token') ? token() : validation());
    const { service, store } = setup({ fetcher: fetcher as typeof fetch });
    const { query } = await pending(service);
    const result = await service.callback(principal, query, async () => false).catch(error => error);
    expect(typeof result === 'string' ? result : result.code).toMatch(/expired|unavailable|unauthenticated/u);
    expect(store.grants.size).toBe(0);
  });

  it('uses the lock-owned session check before saving a callback grant', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/token') ? token() : validation());
    const { service, store } = setup({ fetcher: fetcher as typeof fetch });
    const { query } = await pending(service); store.sessionActive = false;
    expect(await service.callback(principal, query, async () => true)).toContain('forgeChat=expired');
    expect(store.grants.size).toBe(0);
  });

  it('revocation invalidates pending authorization before it can restore the grant', async () => {
    const { service, store, fetcher } = setup(); store.grants.set(personId, grant());
    const { query } = await pending(service);
    expect(await service.revoke(principal, { version: 1 })).toEqual({ version: 1, status: 'revoked' });
    expect(store.grants.size).toBe(0);
    const result = await service.callback(principal, query, async () => true).catch(error => error);
    expect(typeof result === 'string' ? result : result.code).toMatch(/expired|forbidden/u);
    expect(vi.mocked(fetcher).mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(0);
  });
});

describe('a recorded wish has one irreversible send', () => {
  it('sends only the authenticated citizen and founded target, and reveals no words or tokens in replies', async () => {
    const { service, store, fetcher } = setup(); store.grants.set(personId, grant());
    const reply = await service.wish(principal, body, async () => true);
    expect(reply.wish.status).toBe('sent');
    const [, init] = vi.mocked(fetcher).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ broadcaster_id: kingdomId, sender_id: personId, message: `!forge ${authoredWords}` });
    const status = await service.status(principal, { version: 1, kingdomId, requestId });
    const publicBytes = JSON.stringify({ reply, status, requests: [...store.requests.values()] });
    expect(publicBytes).not.toContain(authoredWords);
    expect(publicBytes).not.toContain('SIMULATED-access');
    expect(publicBytes).not.toContain('SIMULATED-refresh');
    expect(JSON.stringify(status)).not.toContain('delivered');
  });

  it('rejects browser identity fields rather than letting them select the sender', async () => {
    const { service, store, fetcher } = setup(); store.grants.set(personId, grant());
    await expect(service.wish(principal, { ...body, personId: '999', senderId: '999' }, async () => true)).rejects.toMatchObject({ code: 'invalid-request' });
    expect(store.requests.size).toBe(0); expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns only this owner’s receipt and no receipt to a signed-out reader', async () => {
    const { service, store } = setup(); store.grants.set(personId, grant());
    await service.wish(principal, body, async () => true);
    expect((await service.status({ ...principal, personId: '999' }, { version: 1, kingdomId, requestId })).wish).toBeNull();
    expect(await service.status(null, { version: 1, kingdomId, requestId })).toMatchObject({ grant: { status: 'signed-out' }, wish: null });
  });

  it('deduplicates simultaneous clicks and later retry using the same request ID', async () => {
    const { service, store, fetcher } = setup(); store.grants.set(personId, grant());
    const [first, second] = await Promise.all([service.wish(principal, body, async () => true), service.wish(principal, body, async () => true)]);
    expect(first.wish.requestId).toBe(second.wish.requestId);
    await service.wish(principal, body, async () => true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('conflicts if an existing request ID is reused with changed words', async () => {
    const { service, store, fetcher } = setup(); store.grants.set(personId, grant());
    await service.wish(principal, body, async () => true);
    await expect(service.wish(principal, { ...body, words: 'SIMULATED another authored wish' }, async () => true)).rejects.toMatchObject({ code: 'request-conflict' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['disconnect', async () => { throw new Error('SIMULATED disconnected'); }],
    ['server failure', async () => json({ error: 'SIMULATED provider failure' }, 503)],
    ['malformed success', async () => json({ data: [] })],
  ])('keeps an ambiguous %s unknown and never automatically reposts it', async (_name, fetcher) => {
    const transport = vi.fn(fetcher), { service, store } = setup({ fetcher: transport as typeof fetch }); store.grants.set(personId, grant());
    expect((await service.wish(principal, body, async () => true)).wish.status).toBe('unknown');
    expect((await service.wish(principal, body, async () => true)).wish.status).toBe('unknown');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('keeps an interrupted durable claim unknown after process restart', async () => {
    const { service, store, fetcher } = setup(); store.grants.set(personId, grant());
    await service.wish(principal, body, async () => false);
    const entry = [...store.requests.values()][0]!;
    entry.wish = { requestId, kingdomId, status: 'sending', updatedAt: NOW };
    store.now += 31_000;
    const restarted = setup({ store });
    expect((await restarted.service.wish(principal, body, async () => true)).wish.status).toBe('unknown');
    expect(restarted.fetcher).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });

  it('treats HTTP 200 with is_sent false as dropped, without raw provider wording', async () => {
    const fetcher = vi.fn(async () => json({ data: [{ is_sent: false, message_id: '', drop_reason: {
      code: 'automod_held', message: 'SIMULATED private raw provider wording',
    } }] }));
    const { service, store } = setup({ fetcher: fetcher as typeof fetch }); store.grants.set(personId, grant());
    const reply = await service.wish(principal, body, async () => true);
    expect(reply.wish).toMatchObject({ status: 'not-sent', reason: 'chat-dropped' });
    expect(JSON.stringify(reply)).not.toContain('SIMULATED private raw provider wording');
    expect(JSON.stringify(reply)).not.toContain('receiptId');
  });

  it('returns the Twitch retry boundary for a rate-limited send', async () => {
    const retryAt = NOW + 45_000;
    const fetcher = vi.fn(async () => json({}, 429, { 'ratelimit-reset': String(retryAt / 1000) }));
    const { service, store } = setup({ fetcher: fetcher as typeof fetch }); store.grants.set(personId, grant());
    expect((await service.wish(principal, body, async () => true)).wish).toMatchObject({ status: 'not-sent', reason: 'rate-limited', retryAt });
    await service.wish(principal, body, async () => true); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refreshes a definitive first 401 once, validates the rotated identity and stores it before retry', async () => {
    let sends = 0;
    const store = new SimulatedStore(); store.grants.set(personId, grant());
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/token')) return token();
      if (url.endsWith('/validate')) return validation();
      sends++;
      if (sends === 1) return json({}, 401);
      expect(store.grants.get(personId)?.refreshToken).toBe('SIMULATED-rotated-refresh');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer SIMULATED-rotated-access');
      return sent();
    });
    const { service } = setup({ fetcher: fetcher as typeof fetch, store });
    expect((await service.wish(principal, body, async () => true)).wish.status).toBe('sent');
    expect(sends).toBe(2);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
  });

  it('disables chat permission after a second definitive 401', async () => {
    let sends = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/token')) return token();
      if (String(input).endsWith('/validate')) return validation();
      sends++; return json({}, 401);
    });
    const { service, store } = setup({ fetcher: fetcher as typeof fetch }); store.grants.set(personId, grant());
    expect((await service.wish(principal, body, async () => true)).wish).toMatchObject({ status: 'not-sent', reason: 'consent-required' });
    expect(sends).toBe(2); expect(store.grants.has(personId)).toBe(false);
  });

  it('does not send when revocation wins between rotated credential persistence and send claiming', async () => {
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const refreshing = new Promise<void>(resolve => { entered = resolve; });
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/token')) { entered(); await blocked; return token(); }
      if (String(input).endsWith('/validate')) return validation();
      if (String(input).endsWith('/revoke')) return new Response('', { status: 200 });
      return sent();
    });
    const { service, store } = setup({ fetcher: fetcher as typeof fetch });
    store.grants.set(personId, { ...grant(), expiresAt: NOW - 1 });
    const sending = service.wish(principal, body, async () => true);
    await refreshing;
    const revoking = service.revoke(principal, { version: 1 });
    release();
    await revoking;
    expect((await sending).wish).toMatchObject({ status: 'not-sent', reason: 'consent-required' });
    expect(store.grants.has(personId)).toBe(false);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/chat/messages'))).toHaveLength(0);
  });

  it('retains a rotated pair through validation outage and revalidates it before future use', async () => {
    let available = false;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/token')) return token();
      if (String(input).endsWith('/validate')) return available ? validation() : json({}, 503);
      return sent();
    });
    const { service, store } = setup({ fetcher: fetcher as typeof fetch });
    store.grants.set(personId, { ...grant(), expiresAt: NOW - 1 });
    expect((await service.wish(principal, body, async () => true)).wish).toMatchObject({ status: 'not-sent', reason: 'service-unavailable' });
    expect(store.grants.get(personId)).toMatchObject({ accessToken: 'SIMULATED-rotated-access', refreshToken: 'SIMULATED-rotated-refresh', validatedAt: 0 });
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/chat/messages'))).toHaveLength(0);
    available = true;
    expect((await service.status(principal, { version: 1, kingdomId })).grant.status).toBe('ready');
    expect(store.grants.get(personId)?.validatedAt).toBe(NOW);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/validate'))).toHaveLength(2);
  });

  it('uses the lock-owned session check at the actual send boundary', async () => {
    const { service, store, fetcher } = setup(); store.grants.set(personId, grant()); store.sessionActive = false;
    expect((await service.wish(principal, body, async () => true)).wish).toMatchObject({ status: 'not-sent', reason: 'consent-required' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not send offline or after the app session expires during preflight', async () => {
    const offline = setup({ ready: false }); offline.store.grants.set(personId, grant());
    expect((await offline.service.wish(principal, body, async () => true)).wish).toMatchObject({ status: 'not-sent', reason: 'stream-offline' });
    expect(offline.fetcher).not.toHaveBeenCalled();
    const expired = setup(); expired.store.grants.set(personId, grant());
    expect((await expired.service.wish(principal, body, async () => false)).wish.status).toBe('not-sent');
    expect(expired.fetcher).not.toHaveBeenCalled();
  });

  it('reconciles an exact observer result arriving before the successful send reply and rejects downgrade', async () => {
    const observation: ForgeChatObservation = { origin: 'simulated', personId, kingdomId, messageId: 'SIMULATED-fast-message',
      at: NOW, status: 'delivered', attachmentId: 'SIMULATED-piece', committedAt: NOW, message: 'The moon is home.' };
    const setupResult = setup({ fetcher: vi.fn(async () => { await setupResult.service.observe(observation); return sent(observation.messageId); }) as typeof fetch });
    const { service } = setupResult; setupResult.store.grants.set(personId, grant());
    expect((await service.wish(principal, body, async () => true)).wish).toMatchObject({ status: 'delivered', attachmentId: 'SIMULATED-piece' });
    await service.observe({ origin: 'simulated', personId, kingdomId, messageId: observation.messageId, at: NOW + 1, status: 'working' });
    expect((await service.status(principal, { version: 1, kingdomId, requestId })).wish).toMatchObject({ status: 'delivered', attachmentId: 'SIMULATED-piece' });
  });

  it('never matches another message ID or realm origin to the latest owner wish', async () => {
    const { service, store } = setup(); store.grants.set(personId, grant());
    await service.wish(principal, body, async () => true);
    await service.observe({ origin: 'simulated', personId, kingdomId, messageId: 'SIMULATED-unrelated-message', at: NOW, status: 'held', message: 'Private held result.' });
    await service.observe({ origin: 'live', personId, kingdomId, messageId: 'SIMULATED-chat-message', at: NOW, status: 'held', message: 'Other realm result.' });
    expect((await service.status(principal, { version: 1, kingdomId, requestId })).wish?.status).toBe('sent');
  });

  it('recovers a lost observer only through the exact owned committed lookup', async () => {
    const recoverCommitted = vi.fn(async () => ({ attachmentId: 'SIMULATED-recovered-piece', committedAt: NOW, message: 'The moon is home.' }));
    const { service, store } = setup({ recoverCommitted }); store.grants.set(personId, grant());
    await service.wish(principal, body, async () => true);
    expect((await service.status(principal, { version: 1, kingdomId, requestId })).wish).toMatchObject({ status: 'delivered', attachmentId: 'SIMULATED-recovered-piece' });
    expect(recoverCommitted).toHaveBeenCalledWith({ kingdomId, personId, messageId: 'SIMULATED-chat-message' });
    expect((await service.status({ ...principal, personId: '999' }, { version: 1, kingdomId, requestId })).wish).toBeNull();
    expect(recoverCommitted).toHaveBeenCalledTimes(1);
  });

  it('retains Twitch confirmation when the surrounding grant transaction loses its reply', async () => {
    class LostReplyStore extends SimulatedStore {
      override async withGrantLock<T>(owner: string, action: (current: ChatGrant | null, save: (next: ChatGrant | null) => Promise<void>, context?: ChatGrantContext) => Promise<T>): Promise<T> {
        const result = await super.withGrantLock(owner, action);
        if (result && typeof result === 'object' && 'kind' in result && result.kind === 'sent') {
          throw new Error('SIMULATED lost grant COMMIT reply');
        }
        return result;
      }
    }
    const store = new LostReplyStore(); store.grants.set(personId, grant());
    const fetcher = vi.fn(async () => sent());
    const recoverCommitted = vi.fn(async () => ({ attachmentId: 'SIMULATED-piece', committedAt: NOW }));
    const { service } = setup({ store, fetcher: fetcher as typeof fetch, recoverCommitted });
    expect((await service.wish(principal, body, async () => true)).wish).toMatchObject({ status: 'sent', messageId: 'SIMULATED-chat-message' });
    expect((await service.status(principal, { version: 1, kingdomId, requestId })).wish?.status).toBe('delivered');
    expect((await service.wish(principal, body, async () => true)).wish.status).toBe('delivered');
    expect(recoverCommitted).toHaveBeenCalledWith({ kingdomId, personId, messageId: 'SIMULATED-chat-message' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['held', 'refused', 'cold', 'canceled'] as const)('corrects a stale %s outcome only when the exact owned commit exists', async status => {
    let committed = false;
    const recoverCommitted = vi.fn(async () => committed
      ? { attachmentId: 'SIMULATED-recovered-piece', committedAt: NOW + 1, message: 'The moon is home.' } : null);
    const fetcher = vi.fn(async () => sent());
    const { service, store } = setup({ recoverCommitted, fetcher: fetcher as typeof fetch }); store.grants.set(personId, grant());
    await service.wish(principal, body, async () => true);
    await service.observe({ origin: 'simulated', personId, kingdomId, messageId: 'SIMULATED-chat-message',
      at: NOW, status, message: 'SIMULATED private result before commit recovery.' });
    expect((await service.status(principal, { version: 1, kingdomId, requestId })).wish?.status).toBe(status);
    committed = true;
    expect((await service.status(principal, { version: 1, kingdomId, requestId })).wish).toMatchObject({
      status: 'delivered', attachmentId: 'SIMULATED-recovered-piece', committedAt: NOW + 1,
    });
    expect(recoverCommitted).toHaveBeenLastCalledWith({ kingdomId, personId, messageId: 'SIMULATED-chat-message' });
    expect(recoverCommitted).toHaveBeenCalledTimes(2);
    expect((await service.status(principal, { version: 1, kingdomId, requestId })).wish?.status).toBe('delivered');
    expect(recoverCommitted).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('validates retained grants at startup and hourly even without an open panel', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => validation()), { service, store } = setup({ fetcher: fetcher as typeof fetch });
    store.grants.set(personId, grant());
    await service.start(); expect(fetcher).toHaveBeenCalledTimes(1);
    store.now += 60 * 60_000; await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await service.stop(); await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps a recently validated grant cold after startup validation fails until validation recovers', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({}, 503)), { service, store } = setup({ fetcher });
    store.grants.set(personId, grant());
    try {
      await service.start();
      expect(store.grants.get(personId)?.validatedAt).toBe(0);
      expect((await service.wish(principal, body, async () => true)).wish).toMatchObject({ status: 'not-sent', reason: 'service-unavailable' });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/chat/messages'))).toHaveLength(0);
    } finally { await service.stop(); }
  });

  it('coalesces startup validation and leaves no hourly work when stopped during startup', async () => {
    vi.useFakeTimers();
    let release!: (reply: Response) => void, entered!: () => void;
    const blocked = new Promise<Response>(resolve => { release = resolve; });
    const validating = new Promise<void>(resolve => { entered = resolve; });
    const fetcher = vi.fn<typeof fetch>(async () => { entered(); return blocked; });
    const { service, store } = setup({ fetcher }); store.grants.set(personId, grant());
    const first = service.start(), second = service.start();
    await validating;
    const stopping = service.stop();
    release(validation());
    await Promise.all([first, second, stopping]);
    store.now += 60 * 60_000; await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
