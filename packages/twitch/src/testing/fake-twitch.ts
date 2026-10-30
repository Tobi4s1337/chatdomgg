import type { FetchLike } from '../transport';

/**
 * A SIMULATED Twitch identity and Helix service for tests: client-credentials and code grants, token
 * validation, Get Users and Get Authorization By User. It answers in Twitch's documented shapes and
 * nothing it holds is a real account, token or chat body.
 */
export interface FakeUser {
  readonly id: string;
  readonly login: string;
  readonly displayName: string;
}

export interface FakeTwitchOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly users: readonly FakeUser[];
  readonly grants?: Readonly<Record<string, readonly string[]>>;
  /** Fixed clock for `expires_in`, in epoch milliseconds. */
  readonly now?: () => number;
}

interface IssuedToken {
  readonly kind: 'app' | 'user';
  readonly clientId: string;
  readonly userId: string | null;
  readonly scopes: readonly string[];
  revoked: boolean;
}

interface ScriptedFailure {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  remaining: number;
  readonly headers: Readonly<Record<string, string>>;
}

export interface FakeCall {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

export class FakeTwitch {
  readonly clientId: string;
  readonly calls: FakeCall[] = [];
  readonly grants = new Map<string, Set<string>>();
  /** Every token value ever issued, so tests can prove none of them escaped into output. */
  readonly issuedValues: string[] = [];
  /** When set, `/oauth2/validate` reports this client instead of the real one. */
  validateClientOverride: string | null = null;
  /** When set, app tokens validate as if they belonged to this user. */
  validateUserOverride: { readonly userId: string; readonly login: string } | null = null;
  /** Extra Helix `data` fields to prove parsing strips them. */
  readonly extraUserFields: Record<string, unknown> = { profile_image_url: 'https://example.invalid/avatar.png', email: 'simulated@example.invalid' };
  readonly #secret: string;
  readonly #users: FakeUser[];
  readonly #tokens = new Map<string, IssuedToken>();
  readonly #codes = new Map<string, { readonly userId: string; readonly scopes: readonly string[]; readonly redirectUri: string }>();
  readonly #failures: ScriptedFailure[] = [];
  readonly #now: () => number;
  #serial = 0;

  constructor(options: FakeTwitchOptions) {
    this.clientId = options.clientId;
    this.#secret = options.clientSecret;
    this.#users = [...options.users];
    this.#now = options.now ?? Date.now;
    for (const [userId, scopes] of Object.entries(options.grants ?? {})) this.grants.set(userId, new Set(scopes));
  }

  readonly fetch: FetchLike = async (input, init) => {
    await Promise.resolve();
    const url = new URL(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const route = `${url.host}${url.pathname}`;
    const scripted = this.#failures.find(failure => failure.method === method && failure.path === route && failure.remaining > 0);
    if (scripted) {
      scripted.remaining -= 1;
      return this.#reply(method, route, scripted.status, { status: scripted.status, message: 'SIMULATED provider detail that must not be shown' }, scripted.headers);
    }
    const headers = new Headers(init.headers);
    const form = typeof init.body === 'string' ? new URLSearchParams(init.body) : new URLSearchParams();
    switch (`${method} ${route}`) {
      case 'POST id.twitch.tv/oauth2/token': return this.#token(method, route, form);
      case 'GET id.twitch.tv/oauth2/validate': return this.#validate(method, route, headers);
      case 'GET api.twitch.tv/helix/users': return this.#getUsers(method, route, headers, url.searchParams);
      case 'GET api.twitch.tv/helix/authorization/users': return this.#getAuthorization(method, route, headers, url.searchParams);
      default: return this.#reply(method, route, 404, { status: 404, message: 'Not Found' });
    }
  };

  /** Make the next `times` requests to `host+path` fail with `status`. */
  fail(method: string, path: string, status: number, times = 1, headers: Readonly<Record<string, string>> = {}): void {
    this.#failures.push({ method, path, status, remaining: times, headers });
  }

  /** Twitch stops accepting every app token issued so far (rotation, revocation or expiry). */
  expireAppTokens(): void {
    for (const token of this.#tokens.values()) if (token.kind === 'app') token.revoked = true;
  }

  /**
   * The person completes the consent screen as `userId`. Twitch records the grant and hands back a code
   * bound to the redirect URI.
   */
  consent(userId: string, scopes: readonly string[], redirectUri: string): string {
    const recorded = this.grants.get(userId) ?? new Set<string>();
    for (const scope of scopes) recorded.add(scope);
    this.grants.set(userId, recorded);
    const code = `simulated-code-${++this.#serial}`;
    this.#codes.set(code, { userId, scopes: [...recorded], redirectUri });
    return code;
  }

  revokeGrant(userId: string): void {
    this.grants.delete(userId);
    for (const token of this.#tokens.values()) if (token.userId === userId) token.revoked = true;
  }

  count(method: string, path: string): number {
    return this.calls.filter(call => call.method === method && call.path === path).length;
  }

  #issue(token: Omit<IssuedToken, 'revoked'>): string {
    const value = `${token.kind}-token-${++this.#serial}-SIMULATED`;
    this.#tokens.set(value, { ...token, revoked: false });
    this.issuedValues.push(value);
    return value;
  }

  #token(method: string, route: string, form: URLSearchParams): Response {
    if (form.get('client_id') !== this.clientId) return this.#reply(method, route, 400, { status: 400, message: 'invalid client' });
    if (form.get('client_secret') !== this.#secret) return this.#reply(method, route, 403, { status: 403, message: 'invalid client secret' });
    if (form.get('grant_type') === 'client_credentials') {
      const access = this.#issue({ kind: 'app', clientId: this.clientId, userId: null, scopes: [] });
      return this.#reply(method, route, 200, { access_token: access, expires_in: 5_011_271, token_type: 'bearer' });
    }
    if (form.get('grant_type') === 'authorization_code') {
      const code = form.get('code') ?? '';
      const pending = this.#codes.get(code);
      this.#codes.delete(code);
      if (!pending || pending.redirectUri !== form.get('redirect_uri')) return this.#reply(method, route, 400, { status: 400, message: 'Invalid authorization code' });
      const access = this.#issue({ kind: 'user', clientId: this.clientId, userId: pending.userId, scopes: pending.scopes });
      const refresh = `refresh-${access}`;
      this.issuedValues.push(refresh);
      return this.#reply(method, route, 200, { access_token: access, refresh_token: refresh, expires_in: 14_400, scope: pending.scopes, token_type: 'bearer' });
    }
    return this.#reply(method, route, 400, { status: 400, message: 'unsupported grant type' });
  }

  #validate(method: string, route: string, headers: Headers): Response {
    const token = this.#bearer(headers, 'OAuth');
    if (!token) return this.#reply(method, route, 401, { status: 401, message: 'invalid access token' });
    const user = token.userId === null ? this.validateUserOverride : { userId: token.userId, login: this.#users.find(u => u.id === token.userId)?.login ?? '' };
    return this.#reply(method, route, 200, {
      client_id: this.validateClientOverride ?? token.clientId,
      ...(user ? { login: user.login, user_id: user.userId } : {}),
      scopes: token.kind === 'app' ? [] : token.scopes,
      expires_in: token.kind === 'app' ? 5_011_000 : 14_000,
    });
  }

  #getUsers(method: string, route: string, headers: Headers, query: URLSearchParams): Response {
    if (!this.#helixAuthorized(headers)) return this.#reply(method, route, 401, { status: 401, message: 'Invalid OAuth token' });
    const logins = new Set(query.getAll('login'));
    const ids = new Set(query.getAll('id'));
    const data = this.#users
      .filter(user => logins.has(user.login) || ids.has(user.id))
      .map(user => ({ id: user.id, login: user.login, display_name: user.displayName, type: '', broadcaster_type: '', ...this.extraUserFields }));
    return this.#reply(method, route, 200, { data });
  }

  #getAuthorization(method: string, route: string, headers: Headers, query: URLSearchParams): Response {
    const token = this.#bearer(headers, 'Bearer');
    if (!token || token.kind !== 'app') return this.#reply(method, route, 401, { status: 401, message: 'app access token required' });
    if (headers.get('client-id') !== token.clientId) return this.#reply(method, route, 403, { status: 403, message: 'client id mismatch' });
    const data = query.getAll('user_id').map(userId => {
      const user = this.#users.find(u => u.id === userId);
      const scopes = this.grants.get(userId);
      return { user_id: userId, user_name: user?.displayName ?? '', user_login: user?.login ?? '', scopes: scopes ? [...scopes] : [], has_authorized: scopes !== undefined && scopes.size > 0 };
    });
    return this.#reply(method, route, 200, { data });
  }

  #helixAuthorized(headers: Headers): boolean {
    const token = this.#bearer(headers, 'Bearer');
    return token !== null && headers.get('client-id') === token.clientId;
  }

  #bearer(headers: Headers, scheme: 'Bearer' | 'OAuth'): IssuedToken | null {
    const value = headers.get('authorization') ?? '';
    const [given, raw] = value.split(' ');
    if (given?.toLowerCase() !== scheme.toLowerCase() && !(scheme === 'OAuth' && given === 'Bearer')) return null;
    const token = raw ? this.#tokens.get(raw) : undefined;
    return token && !token.revoked ? token : null;
  }

  #reply(method: string, route: string, status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): Response {
    this.calls.push({ method, path: route, status });
    const reset = String(Math.floor(this.#now() / 1000) + 60);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'ratelimit-limit': '800', 'ratelimit-remaining': '799', 'ratelimit-reset': reset, ...headers },
    });
  }
}
