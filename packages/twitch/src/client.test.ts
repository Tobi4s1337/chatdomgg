import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { AppTokenSession, type AppTokenEvent } from './app-token';
import { RequestBudget } from './budget';
import { isTwitchFailure, TwitchRequestError } from './errors';
import { HelixReader } from './helix';
import { buildAuthorizeUrl, confirmGrant } from './oauth';
import { Secret } from './secret';
import { FakeTwitch } from './testing/fake-twitch';
import type { FetchLike } from './transport';

const CLIENT_ID = 'simulatedclient0000000000000001';
const SECRET = 'simulated-client-secret-value-0001';
const BROADCASTER = { id: '129634568', login: 'tobi4s_', displayName: 'tobi4s_' };
const READER = { id: '900000001', login: 'herald_reader', displayName: 'HeraldReader' };
const REDIRECT = 'http://localhost:5195/herald/callback';

function setup(fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: SECRET, users: [BROADCASTER, READER] })) {
  const tokens = new AppTokenSession({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), fetch: fake.fetch });
  const helix = new HelixReader({ tokens, fetch: fake.fetch });
  return { fake, tokens, helix };
}

async function failureOf(promise: Promise<unknown>): Promise<TwitchRequestError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TwitchRequestError) return error;
    throw error;
  }
  throw new Error('expected a TwitchRequestError');
}

describe('Secret', () => {
  it('never prints itself', () => {
    const secret = new Secret('hunter2-SIMULATED');
    const rendered = [String(secret), `${secret}`, JSON.stringify({ secret }), inspect(secret), inspect({ nested: { secret } })].join(' ');
    expect(rendered).not.toContain('hunter2');
    expect(secret.reveal()).toBe('hunter2-SIMULATED');
    expect(secret.same(new Secret('hunter2-SIMULATED'))).toBe(true);
  });
});

describe('AppTokenSession', () => {
  it('acquires once for concurrent callers and validates the token before use', async () => {
    const { fake, tokens } = setup();
    const [a, b, c] = await Promise.all([tokens.current(), tokens.current(), tokens.current()]);
    expect(a.same(b) && b.same(c)).toBe(true);
    expect(fake.count('POST', 'id.twitch.tv/oauth2/token')).toBe(1);
    expect(fake.count('GET', 'id.twitch.tv/oauth2/validate')).toBe(1);
    expect(tokens.status.held).toBe(true);
  });

  it('refuses a token that validates for another client', async () => {
    const { fake, tokens } = setup();
    fake.validateClientOverride = 'someotherclient000000000000000';
    expect((await failureOf(tokens.current())).kind).toBe('wrong_client');
    expect(tokens.status.held).toBe(false);
  });

  it('refuses a token carrying a user identity', async () => {
    const { fake, tokens } = setup();
    fake.validateUserOverride = { userId: READER.id, login: READER.login };
    expect((await failureOf(tokens.current())).kind).toBe('not_app_token');
  });

  it('reports rejected credentials without the provider body', async () => {
    const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: 'a-different-secret', users: [] });
    const { tokens } = setup(fake);
    const failure = await failureOf(tokens.current());
    expect(failure.kind).toBe('credentials_rejected');
    expect(failure.message).not.toMatch(/SIMULATED provider|invalid client/);
  });

  it('renews a refused token exactly once however many callers saw the 401', async () => {
    const { fake, tokens } = setup();
    const first = await tokens.current();
    const events: AppTokenEvent[] = [];
    tokens.on(event => events.push(event));
    const renewed = await Promise.all([tokens.renew(first), tokens.renew(first), tokens.renew(first)]);
    expect(renewed.every(token => token.same(renewed[0] ?? null) && !token.same(first))).toBe(true);
    expect(fake.count('POST', 'id.twitch.tv/oauth2/token')).toBe(2);
    // A late caller still holding the old token gets the replacement, not a third grant.
    expect((await tokens.renew(first)).same(renewed[0] ?? null)).toBe(true);
    expect(fake.count('POST', 'id.twitch.tv/oauth2/token')).toBe(2);
    expect(events.map(event => event.type)).toEqual(['invalidated', 'acquired']);
    expect(events[1]).toMatchObject({ type: 'acquired', renewal: true });
  });

  it('hourly validation replaces a token Twitch stopped accepting', async () => {
    const { fake, tokens } = setup();
    await tokens.current();
    expect(await tokens.validate()).toBe('valid');
    fake.expireAppTokens();
    expect(await tokens.validate()).toBe('renewed');
    expect(fake.count('POST', 'id.twitch.tv/oauth2/token')).toBe(2);
  });

  it('hourly validation drops a token that changed client', async () => {
    const { fake, tokens } = setup();
    await tokens.current();
    fake.validateClientOverride = 'someotherclient000000000000000';
    expect((await failureOf(tokens.validate())).kind).toBe('wrong_client');
    expect(tokens.status.held).toBe(false);
  });

  it('stops after close', async () => {
    const { tokens } = setup();
    await tokens.current();
    tokens.close();
    expect(tokens.status.held).toBe(false);
    expect((await failureOf(tokens.current())).kind).toBe('closed');
  });
});

describe('HelixReader', () => {
  it('reads users and keeps only identity fields', async () => {
    const { helix } = setup();
    const users = await helix.getUsers({ logins: ['tobi4s_', 'herald_reader', 'nobody_here'] });
    expect(users).toEqual([BROADCASTER, READER]);
    expect(JSON.stringify(users)).not.toMatch(/avatar|email/);
  });

  it('reads recorded grants with the app token', async () => {
    const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: SECRET, users: [BROADCASTER, READER], grants: { [READER.id]: ['user:read:chat', 'user:bot'] } });
    const { helix } = setup(fake);
    expect(await helix.getAuthorizationByUser([READER.id, BROADCASTER.id])).toEqual([
      { userId: READER.id, hasAuthorized: true, scopes: ['user:bot', 'user:read:chat'] },
      { userId: BROADCASTER.id, hasAuthorized: false, scopes: [] },
    ]);
  });

  it('a burst of 401s mints one new token and retries each request once', async () => {
    const { fake, tokens, helix } = setup();
    await tokens.current();
    fake.expireAppTokens();
    const results = await Promise.all([1, 2, 3, 4].map(() => helix.getUsers({ logins: ['tobi4s_'] })));
    expect(results.every(users => users[0]?.id === BROADCASTER.id)).toBe(true);
    expect(fake.count('POST', 'id.twitch.tv/oauth2/token')).toBe(2);
    expect(fake.calls.filter(call => call.path === 'api.twitch.tv/helix/users' && call.status === 401)).toHaveLength(4);
  });

  it('a second 401 is final and does not mint again', async () => {
    const { fake, helix } = setup();
    fake.fail('GET', 'api.twitch.tv/helix/users', 401, 2);
    const failure = await failureOf(helix.getUsers({ logins: ['tobi4s_'] }));
    expect(failure.kind).toBe('unauthorized');
    expect(fake.count('POST', 'id.twitch.tv/oauth2/token')).toBe(2);
    expect(fake.count('GET', 'api.twitch.tv/helix/users')).toBe(2);
  });

  it('403 stops without retry and never shows the provider message', async () => {
    const { fake, helix } = setup();
    fake.fail('GET', 'api.twitch.tv/helix/authorization/users', 403);
    const failure = await failureOf(helix.getAuthorizationByUser([READER.id]));
    expect(failure).toMatchObject({ kind: 'forbidden', status: 403 });
    expect(failure.message).toBe('get authorization by user: request was refused (HTTP 403)');
  });

  it('429 waits for the reset when it fits the deadline and retries once', async () => {
    let clock = 1_000_000;
    const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: SECRET, users: [BROADCASTER], now: () => clock });
    const slept: number[] = [];
    const budget = new RequestBudget({ now: () => clock, sleep: async ms => { slept.push(ms); clock += ms; } });
    const tokens = new AppTokenSession({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), fetch: fake.fetch, now: () => clock });
    const helix = new HelixReader({ tokens, fetch: fake.fetch, budget, now: () => clock });
    fake.fail('GET', 'api.twitch.tv/helix/users', 429, 1, { 'ratelimit-remaining': '0', 'ratelimit-reset': String(clock / 1000 + 5) });
    expect((await helix.getUsers({ logins: ['tobi4s_'] }, { deadline: clock + 30_000 }))[0]?.id).toBe(BROADCASTER.id);
    expect(slept).toEqual([5_000]);
  });

  it('429 whose reset falls past the deadline fails as rate limited with the retry time', async () => {
    const clock = 1_000_000;
    const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: SECRET, users: [BROADCASTER], now: () => clock });
    const tokens = new AppTokenSession({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), fetch: fake.fetch, now: () => clock });
    const helix = new HelixReader({ tokens, fetch: fake.fetch, now: () => clock });
    fake.fail('GET', 'api.twitch.tv/helix/users', 429, 1, { 'ratelimit-remaining': '0', 'ratelimit-reset': String(clock / 1000 + 90) });
    const failure = await failureOf(helix.getUsers({ logins: ['tobi4s_'] }, { deadline: clock + 10_000 }));
    expect(failure).toMatchObject({ kind: 'rate_limited', retryAt: clock + 90_000 });
  });

  it('times out a request that never answers', async () => {
    const { fake } = setup();
    const hanging: FetchLike = (url, init) => url.includes('/helix/') ? new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))) : fake.fetch(url, init);
    const tokens = new AppTokenSession({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), fetch: hanging });
    const helix = new HelixReader({ tokens, fetch: hanging, timeoutMs: 30 });
    expect((await failureOf(helix.getUsers({ logins: ['tobi4s_'] }))).kind).toBe('timeout');
  });

  it('rejects malformed responses instead of guessing', async () => {
    const { fake } = setup();
    const broken: FetchLike = async (url, init) => url.includes('/helix/users') ? new Response(JSON.stringify({ data: [{ id: 42, login: 'x' }] }), { status: 200 }) : fake.fetch(url, init);
    const tokens = new AppTokenSession({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), fetch: broken });
    expect((await failureOf(new HelixReader({ tokens, fetch: broken }).getUsers({ logins: ['tobi4s_'] }))).kind).toBe('invalid_response');
  });
});

describe('RequestBudget', () => {
  it('bounds concurrency and fails fast past the queue cap', async () => {
    const budget = new RequestBudget({ maxConcurrent: 2, maxQueued: 1 });
    const release: Array<() => void> = [];
    const task = () => new Promise<void>(resolve => release.push(resolve));
    const running = [budget.run('op', Date.now() + 10_000, undefined, task), budget.run('op', Date.now() + 10_000, undefined, task)];
    const queued = budget.run('op', Date.now() + 10_000, undefined, task);
    const overflow = await failureOf(budget.run('op', Date.now() + 10_000, undefined, task));
    expect(overflow.kind).toBe('overloaded');
    expect(budget.snapshot).toMatchObject({ active: 2, queued: 1 });
    release.splice(0).forEach(done => done());
    await Promise.all(running);
    await Promise.resolve();
    release.splice(0).forEach(done => done());
    await queued;
    expect(budget.snapshot).toMatchObject({ active: 0, queued: 0 });
  });

  it('keeps a reserve for the other services on this client', async () => {
    let clock = 0;
    const slept: number[] = [];
    const budget = new RequestBudget({ reservePoints: 100, now: () => clock, sleep: async ms => { slept.push(ms); clock += ms; } });
    budget.observe(new Headers({ 'ratelimit-remaining': '100', 'ratelimit-reset': '12' }), 200);
    await budget.run('op', 60_000, undefined, async () => undefined);
    expect(slept).toEqual([12_000]);
  });

  it('an aborted waiter leaves the queue', async () => {
    const budget = new RequestBudget({ maxConcurrent: 1 });
    let release = () => undefined as void;
    const first = budget.run('op', Date.now() + 10_000, undefined, () => new Promise<void>(resolve => { release = resolve; }));
    const controller = new AbortController();
    const waiting = failureOf(budget.run('op', Date.now() + 10_000, controller.signal, async () => undefined));
    controller.abort();
    expect((await waiting).kind).toBe('aborted');
    expect(budget.snapshot.queued).toBe(0);
    release();
    await first;
  });
});

describe('OAuth code grant', () => {
  it('asks for exactly the given scopes with a forced consent screen', () => {
    const url = new URL(buildAuthorizeUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT, scopes: ['user:bot', 'user:read:chat'], state: 'abc' }));
    expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT, scope: 'user:bot user:read:chat', state: 'abc', force_verify: 'true' });
  });

  it('returns who granted what and nothing that could act as them', async () => {
    const { fake } = setup();
    const code = fake.consent(READER.id, ['user:read:chat', 'user:bot'], REDIRECT);
    const identity = await confirmGrant({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), code: new Secret(code), redirectUri: REDIRECT, fetch: fake.fetch });
    expect(identity).toEqual({ clientId: CLIENT_ID, userId: READER.id, login: READER.login, scopes: ['user:bot', 'user:read:chat'] });
    const serialized = JSON.stringify(identity) + inspect(identity);
    for (const value of fake.issuedValues) expect(serialized).not.toContain(value);
    expect(fake.calls.some(call => call.path.includes('revoke'))).toBe(false);
  });

  it('a reused or foreign code is a bad request', async () => {
    const { fake } = setup();
    const code = fake.consent(READER.id, ['user:read:chat', 'user:bot'], REDIRECT);
    const confirm = () => confirmGrant({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), code: new Secret(code), redirectUri: REDIRECT, fetch: fake.fetch });
    await confirm();
    const failure = await failureOf(confirm());
    expect(isTwitchFailure(failure, 'bad_request')).toBe(true);
    expect(failure.message).not.toContain(code);
  });
});
