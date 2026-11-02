import { AppTokenSession, type FetchLike, HelixReader, Secret, VALIDATE_INTERVAL_MS } from '@chatdom/twitch';
import { FakeTwitch } from '@chatdom/twitch/testing';
import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { formatAuthorizeOutcome, formatAuthReport } from '../cli/report';
import { type HeraldConfig, loadConfig } from '../config';
import { type AuthorityEvent, HeraldAuthority, inspectAuthorization } from './authority';
import { runAuthorize } from './authorize';
import { assessCapabilities, type Account, scopesToRequest } from './grants';

const CLIENT_ID = 'simulatedclient0000000000000001';
const SECRET = 'simulated-client-secret-value-0001';
const BROADCASTER = { id: '129634568', login: 'tobi4s_', displayName: 'tobi4s_' };
const READER = { id: '900000001', login: 'herald_reader', displayName: 'HeraldReader' };
const STRANGER = { id: '900000002', login: 'someone_else', displayName: 'SomeoneElse' };
const REDIRECT = 'http://localhost:5195/herald/callback';
const FULL_GRANTS = { [READER.id]: ['user:read:chat', 'user:bot', 'user:write:chat'], [BROADCASTER.id]: ['channel:bot', 'moderator:read:chatters', 'bits:read', 'channel:read:hype_train',
  'moderator:read:followers', 'channel:manage:redemptions', 'channel:manage:polls', 'channel:manage:raids', 'moderator:read:shield_mode'] };

function config(overrides: Partial<HeraldConfig> = {}): HeraldConfig {
  return {
    channelLogin: 'tobi4s_', channelLoginDefaulted: true, readerLogin: READER.login, redirectUri: new URL(REDIRECT),
    credentials: { clientId: CLIENT_ID, clientSecret: new Secret(SECRET) }, conduitId: null, problems: [],
    dataDir: '/simulated/data', kingdom: { seed: 'tobi4s_', tier: 'hamlet', firstYear: 2026, year: 2026 },
    port: 5194, secretsFile: '/simulated/atlas.env', settingsFile: '/simulated/herald.env', ...overrides,
  };
}

function twitch(grants: Record<string, readonly string[]> = FULL_GRANTS) {
  const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: SECRET, users: [BROADCASTER, READER, STRANGER], grants });
  const tokens = new AppTokenSession({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), fetch: fake.fetch });
  const helix = new HelixReader({ tokens, fetch: fake.fetch });
  return { fake, tokens, helix };
}

/** Nothing a person could use to act on Twitch may appear in anything Herald prints. */
function expectNoSecrets(fake: FakeTwitch, ...outputs: unknown[]) {
  const text = outputs.map(output => typeof output === 'string' ? output : `${JSON.stringify(output)}${inspect(output, { depth: 8 })}`).join('\n');
  expect(text).not.toContain(SECRET);
  for (const value of fake.issuedValues) expect(text).not.toContain(value);
  expect(text).not.toContain('simulated-code-');
  expect(text).not.toContain('SIMULATED provider detail');
}

describe('loadConfig', () => {
  const files = (map: Record<string, string>) => ({
    home: '/home/sim',
    readText: async (path: string) => {
      if (path in map) return map[path] as string;
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    fileMode: async (path: string) => {
      if (!(path in map)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return 0o100600;
    },
  });

  it('reads app keys only from the external file and keeps them out of the environment', async () => {
    const env: Record<string, string | undefined> = { HERALD_READER_LOGIN: 'Herald_Reader', TWITCH_CLIENT_SECRET: 'from-process-env-must-be-ignored' };
    const loaded = await loadConfig({ env, ...files({
      '/home/sim/.config/chatdom/atlas.env': `TWITCH_CLIENT_ID=${CLIENT_ID}\nTWITCH_CLIENT_SECRET=${SECRET}\n`,
      '/home/sim/.config/chatdom/herald.env': `HERALD_REDIRECT_URI=${REDIRECT}\nHERALD_READER_LOGIN=overridden_by_env\n`,
    }) });
    expect(loaded.credentials?.clientId).toBe(CLIENT_ID);
    expect(loaded.credentials?.clientSecret.reveal()).toBe(SECRET);
    expect(loaded.readerLogin).toBe('herald_reader');
    expect(loaded.redirectUri?.toString()).toBe(REDIRECT);
    expect(loaded.channelLogin).toBe('tobi4s_');
    expect(loaded.problems).toEqual([]);
    expect(Object.values(env)).not.toContain(SECRET);
    expect(JSON.stringify(loaded) + inspect(loaded)).not.toContain(SECRET);
  });

  it('names what is missing or unsafe without values', async () => {
    const loaded = await loadConfig({ env: { HERALD_REDIRECT_URI: 'http://example.com/callback' }, ...files({
      '/home/sim/.config/chatdom/atlas.env': `TWITCH_CLIENT_ID=${CLIENT_ID}\n`,
    }), fileMode: async () => 0o100644 });
    expect(loaded.credentials).toBeNull();
    expect(loaded.problems).toEqual(expect.arrayContaining([
      { key: 'HERALD_READER_LOGIN', issue: 'missing' },
      { key: 'HERALD_REDIRECT_URI', issue: 'invalid' },
      { key: 'HERALD_TWITCH_ENV_FILE', issue: 'readable_by_others' },
      { key: 'TWITCH_CLIENT_SECRET', issue: 'missing' },
    ]));
  });

  it('serves on 5194 unless HERALD_PORT names another unprivileged port, and refuses nonsense', async () => {
    expect((await loadConfig({ env: {}, ...files({}) })).port).toBe(5194);
    expect((await loadConfig({ env: { HERALD_PORT: '5196' }, ...files({}) })).port).toBe(5196);
    for (const raw of ['80', '5195', '70000', '51 96', 'next']) {
      const loaded = await loadConfig({ env: { HERALD_PORT: raw }, ...files({}) });
      expect(loaded.problems).toContainEqual({ key: 'HERALD_PORT', issue: 'invalid' });
    }
  });

  it('reports an absent secrets file', async () => {
    const loaded = await loadConfig({ env: {}, ...files({}) });
    expect(loaded.problems).toContainEqual({ key: 'HERALD_TWITCH_ENV_FILE', issue: 'missing' });
  });
});

describe('capabilities', () => {
  const account = (role: 'reader' | 'broadcaster', granted: readonly string[], extra: Partial<Account> = {}): Account => ({
    role, login: role === 'reader' ? READER.login : BROADCASTER.login, id: role === 'reader' ? READER.id : BROADCASTER.id,
    displayName: null, state: 'resolved', authorized: granted.length > 0, granted, ...extra,
  });
  const valid = { state: 'valid', expiresAt: 1 } as const;

  it('app credentials alone authorize only stream state and revocation', () => {
    const result = assessCapabilities(valid, { reader: account('reader', []), broadcaster: account('broadcaster', []) });
    expect(Object.fromEntries(result.map(status => [status.capability, status.available]))).toEqual({ chat: false, chatters: false, stream: true, revocation: true, bits: false, hype: false,
      follows: false, rewards: false, polls: false, raids: false, shield: false });
  });

  it('chat needs the reader pair and channel:bot; chatters needs only the broadcaster', () => {
    const result = assessCapabilities(valid, { reader: account('reader', ['user:read:chat']), broadcaster: account('broadcaster', ['moderator:read:chatters']) });
    const chat = result.find(status => status.capability === 'chat');
    expect(chat?.blockers).toEqual([
      { kind: 'missing_scopes', role: 'reader', login: READER.login, scopes: ['user:bot'] },
      { kind: 'missing_scopes', role: 'broadcaster', login: BROADCASTER.login, scopes: ['channel:bot'] },
    ]);
    expect(result.find(status => status.capability === 'chatters')?.available).toBe(true);
  });

  it('a bad app token blocks everything', () => {
    const result = assessCapabilities({ state: 'unavailable', reason: 'x' }, { reader: account('reader', FULL_GRANTS[READER.id] ?? []), broadcaster: account('broadcaster', FULL_GRANTS[BROADCASTER.id] ?? []) });
    expect(result.every(status => !status.available)).toBe(true);
  });

  it('re-consent preserves every existing scope and adds the crier permission', () => {
    expect(scopesToRequest('reader', ['channel:bot', 'moderator:read:chatters', 'user:write:chat', 'channel:manage:polls'])).toEqual(['channel:bot', 'channel:manage:polls', 'moderator:read:chatters', 'user:bot', 'user:read:chat', 'user:write:chat']);
    expect(scopesToRequest('broadcaster', ['user:write:chat', 'channel:manage:polls'])).toEqual(['bits:read', 'channel:bot', 'channel:manage:polls', 'channel:manage:raids', 'channel:manage:redemptions',
      'channel:read:hype_train', 'moderator:read:chatters', 'moderator:read:followers', 'moderator:read:shield_mode', 'user:write:chat']);
    expect(assessCapabilities({ state: 'valid', expiresAt: 999999 }, { reader: account('reader', ['user:bot', 'user:read:chat']), broadcaster: account('broadcaster', ['channel:bot']) }).find(status => status.capability === 'chat')?.available).toBe(true);
    expect(scopesToRequest('broadcaster', [])).toEqual(['bits:read', 'channel:bot', 'channel:manage:polls', 'channel:manage:raids', 'channel:manage:redemptions', 'channel:read:hype_train',
      'moderator:read:chatters', 'moderator:read:followers', 'moderator:read:shield_mode']);
  });
});

describe('check:auth', () => {
  it('passes only when every grant is recorded', async () => {
    const { fake, tokens, helix } = twitch();
    const report = await inspectAuthorization({ config: config(), tokens, helix });
    expect(report.ok).toBe(true);
    expect(report.accounts.broadcaster).toMatchObject({ id: BROADCASTER.id, authorized: true });
    const text = formatAuthReport(report).join('\n');
    expect(text).toContain('Every Herald capability is authorized.');
    expectNoSecrets(fake, text, report);
  });

  it('missing grants fail with the exact scopes and the consent command', async () => {
    const { fake, tokens, helix } = twitch({ [READER.id]: ['user:read:chat'] });
    const report = await inspectAuthorization({ config: config(), tokens, helix });
    expect(report.ok).toBe(false);
    const text = formatAuthReport(report).join('\n');
    expect(text).toContain('herald_reader (reader) is missing user:bot');
    expect(text).toContain('tobi4s_ (broadcaster) has not authorized this client: needs channel:bot');
    expect(text).toContain('authorize -- --role reader');
    expect(text).toContain('authorize -- --role broadcaster');
    expectNoSecrets(fake, text, report);
  });

  it('reports both missing action grants while retaining existing chat and observation', async () => {
    const old = FULL_GRANTS[BROADCASTER.id]!.filter(scope => scope !== 'channel:manage:raids' && scope !== 'moderator:read:shield_mode');
    const { tokens, helix } = twitch({ [READER.id]: FULL_GRANTS[READER.id]!, [BROADCASTER.id]: old });
    const report = await inspectAuthorization({ config: config(), tokens, helix });
    expect(report.ok).toBe(false);
    expect(report.capabilities.find(status => status.capability === 'chat')?.available).toBe(true);
    expect(report.capabilities.find(status => status.capability === 'stream')?.available).toBe(true);
    for (const [capability, scope] of [['raids', 'channel:manage:raids'], ['shield', 'moderator:read:shield_mode']] as const) {
      expect(report.capabilities.find(status => status.capability === capability)).toMatchObject({ available: false,
        blockers: [{ kind: 'missing_scopes', role: 'broadcaster', scopes: [scope] }] });
      expect(formatAuthReport(report).join('\n')).toContain(scope);
    }
    expect(scopesToRequest('broadcaster', [...old, 'user:write:chat'])).toEqual(expect.arrayContaining([...old, 'user:write:chat', 'channel:manage:raids', 'moderator:read:shield_mode']));
  });

  it('an undesignated reader is named as the dependency, not guessed', async () => {
    const { tokens, helix } = twitch();
    const report = await inspectAuthorization({ config: config({ readerLogin: null, problems: [{ key: 'HERALD_READER_LOGIN', issue: 'missing' }] }), tokens, helix });
    expect(report.capabilities.find(status => status.capability === 'chat')?.blockers).toContainEqual({ kind: 'not_designated', role: 'reader' });
    expect(formatAuthReport(report).join('\n')).toContain('set HERALD_READER_LOGIN');
  });

  it('a failed grant read is unknown, never missing', async () => {
    const { fake, tokens, helix } = twitch();
    fake.fail('GET', 'api.twitch.tv/helix/authorization/users', 500, 3);
    const report = await inspectAuthorization({ config: config(), tokens, helix });
    expect(report.ok).toBe(false);
    expect(report.accounts.reader.state).toBe('unchecked');
    expect(report.failures).toEqual(['get authorization by user: Twitch reported a server error (HTTP 500)']);
    expectNoSecrets(fake, formatAuthReport(report).join('\n'));
  });

  it('wrong client and missing credentials never look healthy', async () => {
    const { fake, tokens, helix } = twitch();
    fake.validateClientOverride = 'someotherclient000000000000000';
    const wrong = await inspectAuthorization({ config: config(), tokens, helix });
    expect(wrong.capabilities.every(status => !status.available)).toBe(true);
    expect(wrong.appToken).toEqual({ state: 'unavailable', reason: 'validate app token: token belongs to a different client' });
    const none = await inspectAuthorization({ config: config({ credentials: null, problems: [{ key: 'TWITCH_CLIENT_SECRET', issue: 'missing' }] }), tokens: null, helix: null });
    expect(none.ok).toBe(false);
    expect(formatAuthReport(none).join('\n')).toContain('Put TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET');
  });

  it('a wrong-client replacement during inspection disables every capability', async () => {
    const { fake, tokens, helix } = twitch();
    await tokens.current();
    fake.expireAppTokens();
    fake.validateClientOverride = 'someotherclient000000000000000';
    const result = await inspectAuthorization({ config: config(), tokens, helix });
    expect(result.appToken.state).toBe('unavailable');
    expect(result.capabilities.every(status => !status.available)).toBe(true);
    tokens.close();
  });

  it('a second Helix 401 cannot leave stream or revocation looking authorized', async () => {
    const { fake, tokens, helix } = twitch();
    fake.fail('GET', 'api.twitch.tv/helix/users', 401, 2);
    const result = await inspectAuthorization({ config: config(), tokens, helix });
    expect(result.capabilities.every(status => !status.available)).toBe(true);
    expect(fake.count('POST', 'id.twitch.tv/oauth2/token')).toBe(2);
    tokens.close();
  });
});

describe('HeraldAuthority', () => {
  it('rechecks grants after the app token is renewed', async () => {
    const { fake, tokens, helix } = twitch();
    const authority = new HeraldAuthority({ config: config(), tokens, helix });
    expect((await authority.start()).ok).toBe(true);
    fake.revokeGrant(BROADCASTER.id);
    fake.expireAppTokens();
    const reports: AuthorityEvent[] = [];
    const next = new Promise<void>(resolve => authority.on(event => {
      reports.push(event);
      if (event.type === 'report' && event.report.appToken.state === 'valid') resolve();
    }));
    await helix.getUsers({ logins: ['tobi4s_'] });
    await next;
    expect(authority.available('chatters')).toBe(false);
    expect(authority.available('stream')).toBe(true);
    authority.stop();
  });

  it('invalidates synchronously and rechecks grants on expiry replacement too', async () => {
    let now = 1_000_000;
    const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: SECRET, users: [BROADCASTER, READER], grants: FULL_GRANTS, now: () => now });
    const tokens = new AppTokenSession({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), fetch: fake.fetch, now: () => now });
    const helix = new HelixReader({ tokens, fetch: fake.fetch, now: () => now });
    const authority = new HeraldAuthority({ config: config(), tokens, helix, now: () => now });
    try {
      await authority.start();
      fake.revokeGrant(BROADCASTER.id);
      now = tokens.status.expiresAt! - 1;
      const replacement = tokens.current();
      expect(authority.available('chat')).toBe(false);
      expect(authority.available('stream')).toBe(false);
      await replacement;
      await authority.refresh();
      expect(authority.available('chat')).toBe(false);
      expect(authority.available('chatters')).toBe(false);
      expect(authority.available('stream')).toBe(true);
    } finally {
      authority.stop(); tokens.close();
    }
  });

  it('failed hourly validation stays blocked until validation and fresh grants succeed', async () => {
    vi.useFakeTimers();
    const { fake, tokens, helix } = twitch();
    const authority = new HeraldAuthority({ config: config(), tokens, helix });
    try {
      await authority.start();
      fake.fail('GET', 'id.twitch.tv/oauth2/validate', 500, 2);
      await vi.advanceTimersByTimeAsync(VALIDATE_INTERVAL_MS);
      expect(authority.report?.capabilities.every(status => !status.available)).toBe(true);
      expect((await authority.refresh()).appToken.state).toBe('unavailable');
      fake.revokeGrant(READER.id);
      await authority.refresh();
      expect(authority.available('chat')).toBe(false);
      expect(authority.available('stream')).toBe(true);
    } finally {
      authority.stop(); tokens.close(); vi.useRealTimers();
    }
  });

  it.each([false, true])('an obsolete grant read cannot restore capabilities after invalidation (renewal failure: %s)', async failRenewal => {
    const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: SECRET, users: [BROADCASTER, READER], grants: FULL_GRANTS });
    let holdNext = false;
    let release = () => undefined as void;
    let captured = () => undefined as void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const capture = new Promise<void>(resolve => { captured = resolve; });
    const fetch: FetchLike = async (url, init) => {
      const response = await fake.fetch(url, init);
      if (holdNext && url.includes('/helix/authorization/users')) {
        holdNext = false;
        captured();
        await gate;
      }
      return response;
    };
    const tokens = new AppTokenSession({ clientId: CLIENT_ID, clientSecret: new Secret(SECRET), fetch });
    const helix = new HelixReader({ tokens, fetch });
    const authority = new HeraldAuthority({ config: config(), tokens, helix });
    try {
      await authority.start();
      const refused = await tokens.current();
      holdNext = true;
      const checking = authority.refresh();
      await capture;
      const published: boolean[] = [];
      authority.on(event => { if (event.type === 'report') published.push(event.report.ok); });
      fake.revokeGrant(READER.id);
      if (failRenewal) fake.fail('POST', 'id.twitch.tv/oauth2/token', 403);
      const renewal = tokens.renew(refused);
      expect(authority.available('chat')).toBe(false);
      expect(authority.available('stream')).toBe(false);
      if (failRenewal) await expect(renewal).rejects.toMatchObject({ kind: 'credentials_rejected' });
      else await renewal;
      release();
      await checking;
      expect(published).not.toContain(true);
      expect(authority.available('chat')).toBe(false);
      expect(authority.available('stream')).toBe(!failRenewal);
    } finally {
      release(); authority.stop(); tokens.close();
    }
  });

  it('acts on revocation only for the configured accounts and holds it until a fresh grant', async () => {
    const { fake, tokens, helix } = twitch();
    const authority = new HeraldAuthority({ config: config(), tokens, helix });
    await authority.start();
    const events: AuthorityEvent[] = [];
    authority.on(event => events.push(event));

    expect(authority.revoked(STRANGER.id)).toEqual([]);
    expect(authority.available('chat')).toBe(true);

    expect(authority.revoked(READER.id)).toEqual(['reader']);
    expect(events[0]).toEqual({ type: 'revoked', role: 'reader' });
    expect(authority.available('chat')).toBe(false);
    expect(authority.available('chatters')).toBe(true);

    // Twitch has not caught up yet: still blocked.
    await authority.refresh();
    expect(authority.available('chat')).toBe(false);
    // Twitch shows the grant gone, then a new consent.
    fake.revokeGrant(READER.id);
    await authority.refresh();
    expect(authority.available('chat')).toBe(false);
    fake.consent(READER.id, ['user:read:chat', 'user:bot'], REDIRECT);
    await authority.refresh();
    expect(authority.available('chat')).toBe(true);
    authority.stop();
  });
});

describe('authorize', () => {
  type Browser = (port: number, consentUrl: string) => Promise<void>;

  async function authorizeWith(fake: FakeTwitch, browser: Browser, overrides: Partial<HeraldConfig> = {}, role: 'reader' | 'broadcaster' = 'reader') {
    const lines: string[] = [];
    let browsing: Promise<void> = Promise.resolve();
    const outcome = await runAuthorize({
      config: config(overrides), role, fetch: fake.fetch, print: line => lines.push(line), listenPort: 0, deadlineMs: 5_000, lingerMs: 200,
      onListening: port => {
        const consentUrl = lines.find(line => line.includes('/oauth2/authorize'))?.trim() ?? '';
        browsing = browser(port, consentUrl);
      },
    });
    await browsing;
    return { outcome, lines };
  }

  /** Simulates the browser coming back from Twitch's consent screen. */
  async function callback(port: number, query: Record<string, string>) {
    const response = await fetch(`http://127.0.0.1:${port}/herald/callback?${new URLSearchParams(query)}`, { redirect: 'manual' });
    const result = response.status === 303 ? await fetch(`http://127.0.0.1:${port}${response.headers.get('location')}`) : null;
    return { status: response.status, page: result ? await result.text() : await response.text(), headers: response.headers };
  }

  it('records the grant after CSRF, account, client and scope checks, then discards the tokens', async () => {
    const { fake } = twitch({ [READER.id]: ['channel:manage:polls'] });
    let page = '';
    let foreign = 0;
    let reused = 0;
    const { outcome, lines } = await authorizeWith(fake, async (port, consentUrl) => {
      const consent = new URL(consentUrl);
      expect(consent.searchParams.get('scope')).toBe('channel:manage:polls user:bot user:read:chat user:write:chat');
      expect(consent.searchParams.get('redirect_uri')).toBe(REDIRECT);
      foreign = (await callback(port, { code: 'forged', state: 'not-the-state' })).status;
      const code = fake.consent(READER.id, ['channel:manage:polls', 'user:bot', 'user:read:chat', 'user:write:chat'], REDIRECT);
      const done = await callback(port, { code, state: consent.searchParams.get('state') ?? '' });
      expect(done.status).toBe(303);
      expect(done.headers.get('location')).not.toContain(code);
      page = done.page;
      reused = (await fetch(`http://127.0.0.1:${port}/herald/callback?state=${consent.searchParams.get('state')}&code=${code}`).catch(() => ({ status: 0 }))).status;
    });
    expect(foreign).toBe(400);
    expect([0, 410]).toContain(reused);
    expect(outcome).toEqual({ status: 'recorded', login: READER.login, scopes: ['channel:manage:polls', 'user:bot', 'user:read:chat', 'user:write:chat'] });
    expect(page).toContain('Herald can listen now');
    expect(fake.calls.some(call => call.path.includes('revoke'))).toBe(false);
    const printed = [...lines, ...formatAuthorizeOutcome(outcome)].join('\n');
    expect(printed).toContain('Requests only: channel:manage:polls user:bot user:read:chat user:write:chat');
    expectNoSecrets(fake, printed, outcome, page);
  });

  it('a different account signing in is refused', async () => {
    const { fake } = twitch({});
    const { outcome } = await authorizeWith(fake, async (port, consentUrl) => {
      const state = new URL(consentUrl).searchParams.get('state') ?? '';
      await callback(port, { code: fake.consent(STRANGER.id, ['user:bot', 'user:read:chat'], REDIRECT), state });
    });
    expect(outcome).toEqual({ status: 'wrong_account', expected: READER.login });
  });

  it('declined consent grants nothing', async () => {
    const { fake } = twitch({});
    const { outcome } = await authorizeWith(fake, async (port, consentUrl) => {
      const state = new URL(consentUrl).searchParams.get('state') ?? '';
      const result = await callback(port, { error: 'access_denied', error_description: 'The user denied you access', state });
      expect(result.page).toContain('Not approved');
      expect(result.page).not.toContain('denied you access');
    });
    expect(outcome).toEqual({ status: 'denied' });
  });

  it('a token for another client is refused', async () => {
    const { fake } = twitch({});
    const { outcome } = await authorizeWith(fake, async (port, consentUrl) => {
      const state = new URL(consentUrl).searchParams.get('state') ?? '';
      const code = fake.consent(BROADCASTER.id, ['channel:bot', 'moderator:read:chatters'], REDIRECT);
      fake.validateClientOverride = 'someotherclient000000000000000';
      await callback(port, { code, state });
    }, {}, 'broadcaster');
    expect(outcome).toEqual({ status: 'wrong_client' });
  });

  it('fewer scopes than requested is refused', async () => {
    const { fake } = twitch({});
    const { outcome } = await authorizeWith(fake, async (port, consentUrl) => {
      const state = new URL(consentUrl).searchParams.get('state') ?? '';
      await callback(port, { code: fake.consent(BROADCASTER.id, ['channel:bot'], REDIRECT), state });
    }, {}, 'broadcaster');
    expect(outcome).toEqual({ status: 'missing_scopes', scopes: ['moderator:read:chatters', 'bits:read', 'channel:read:hype_train',
      'moderator:read:followers', 'channel:manage:redemptions', 'channel:manage:polls', 'channel:manage:raids', 'moderator:read:shield_mode'] });
  });

  it('expires when nobody comes back', async () => {
    const { fake } = twitch({});
    const result = await runAuthorize({ config: config(), role: 'reader', fetch: fake.fetch, print: () => undefined, listenPort: 0, deadlineMs: 50 });
    expect(result).toEqual({ status: 'expired' });
  });

  it('names exactly the missing dependency before asking anyone for consent', async () => {
    const { fake } = twitch({});
    const unregistered = await runAuthorize({ config: config({ redirectUri: null, readerLogin: null }), role: 'reader', fetch: fake.fetch, print: () => undefined });
    expect(unregistered).toEqual({ status: 'not_ready', reasons: [
      'HERALD_READER_LOGIN is not set: the Herald reader account has not been designated',
      'HERALD_REDIRECT_URI is not set: give the callback already registered for this app, http://localhost:5195/<path>',
    ] });
    const remote = await runAuthorize({ config: config({ redirectUri: new URL('https://chatdom.example/callback') }), role: 'broadcaster', fetch: fake.fetch, print: () => undefined });
    expect(remote.status).toBe('not_ready');
    expect(fake.calls).toHaveLength(0);
  });
});
