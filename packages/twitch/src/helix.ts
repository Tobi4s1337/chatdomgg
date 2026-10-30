import { TwitchIdSchema, TwitchLoginSchema } from '@chatdom/shared';
import { z } from 'zod';
import type { AppTokenSession } from './app-token';
import { RequestBudget } from './budget';
import { isTwitchFailure, TwitchRequestError } from './errors';
import type { Secret } from './secret';
import { DEFAULT_TIMEOUT_MS, send, type FetchLike } from './transport';

export const TWITCH_HELIX_URL = 'https://api.twitch.tv/helix/';

/** Only the identity fields we use survive parsing; avatars, descriptions and emails are dropped at the door. */
const UsersSchema = z.object({
  data: z.array(z.object({ id: TwitchIdSchema, login: TwitchLoginSchema, display_name: z.string().min(1).max(128) })).max(100),
});
const AuthorizationsSchema = z.object({
  data: z.array(z.object({
    user_id: TwitchIdSchema,
    user_login: z.string().max(64).nullish(),
    scopes: z.array(z.string().min(1).max(128)).max(512).nullish(),
    has_authorized: z.boolean(),
  })).max(10),
});

export interface HelixUser {
  readonly id: string;
  readonly login: string;
  readonly displayName: string;
}

export interface HelixAuthorization {
  readonly userId: string;
  readonly hasAuthorized: boolean;
  readonly scopes: readonly string[];
}

export interface HelixReaderOptions {
  readonly tokens: AppTokenSession;
  readonly fetch: FetchLike;
  readonly budget?: RequestBudget;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly helixUrl?: string;
}

export interface CallOptions {
  readonly signal?: AbortSignal | undefined;
  /** Absolute epoch-millisecond deadline, including any wait for rate-limit reset. */
  readonly deadline?: number;
}

/**
 * Narrow app-token Helix reads. A 401 renews the app token once (single-flight across concurrent callers)
 * and retries once; a second 401 is final. A 429 is retried once only if its reset falls inside the deadline.
 */
export class HelixReader {
  readonly #tokens: AppTokenSession;
  readonly #fetch: FetchLike;
  readonly #budget: RequestBudget;
  readonly #timeoutMs: number;
  readonly #now: () => number;
  readonly #helixUrl: string;

  constructor(options: HelixReaderOptions) {
    this.#tokens = options.tokens;
    this.#fetch = options.fetch;
    this.#now = options.now ?? Date.now;
    this.#budget = options.budget ?? new RequestBudget({ now: this.#now });
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#helixUrl = options.helixUrl ?? TWITCH_HELIX_URL;
  }

  /** Get Users by login and/or ID; at most 100 in total. Unknown logins are simply absent from the result. */
  async getUsers(query: { readonly logins?: readonly string[]; readonly ids?: readonly string[] }, options: CallOptions = {}): Promise<HelixUser[]> {
    const logins = [...new Set(query.logins ?? [])];
    const ids = [...new Set(query.ids ?? [])];
    if (logins.length + ids.length === 0) return [];
    if (logins.length + ids.length > 100) throw new RangeError('Get Users accepts at most 100 logins and IDs');
    for (const login of logins) TwitchLoginSchema.parse(login);
    for (const id of ids) TwitchIdSchema.parse(id);
    const params = [...logins.map(login => ['login', login] as const), ...ids.map(id => ['id', id] as const)];
    const body = await this.#get('get users', 'users', params, options);
    const parsed = UsersSchema.safeParse(body);
    if (!parsed.success) throw new TwitchRequestError('invalid_response', 'get users');
    return parsed.data.data.map(user => ({ id: user.id, login: user.login, displayName: user.display_name }));
  }

  /** Get Authorization By User: the scopes each user has granted this client. At most 10 IDs. */
  async getAuthorizationByUser(userIds: readonly string[], options: CallOptions = {}): Promise<HelixAuthorization[]> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];
    if (ids.length > 10) throw new RangeError('Get Authorization By User accepts at most 10 IDs');
    for (const id of ids) TwitchIdSchema.parse(id);
    const body = await this.#get('get authorization by user', 'authorization/users', ids.map(id => ['user_id', id] as const), options);
    const parsed = AuthorizationsSchema.safeParse(body);
    if (!parsed.success) throw new TwitchRequestError('invalid_response', 'get authorization by user');
    return parsed.data.data.map(entry => ({
      userId: entry.user_id,
      hasAuthorized: entry.has_authorized,
      scopes: entry.has_authorized ? [...new Set(entry.scopes ?? [])].sort() : [],
    }));
  }

  async #get(operation: string, path: string, params: ReadonlyArray<readonly [string, string]>, options: CallOptions): Promise<unknown> {
    const deadline = options.deadline ?? this.#now() + this.#timeoutMs * 3;
    const url = new URL(path, this.#helixUrl);
    for (const [key, value] of params) url.searchParams.append(key, value);

    let token = await this.#tokens.current();
    let renewed = false;
    let rateRetried = false;
    for (;;) {
      try {
        return await this.#once(operation, url, token, deadline, options.signal);
      } catch (error) {
        if (isTwitchFailure(error, 'unauthorized') && !renewed) {
          renewed = true;
          token = await this.#tokens.renew(token);
          continue;
        }
        if (isTwitchFailure(error, 'rate_limited') && !rateRetried && error.retryAt !== null && error.retryAt <= deadline) {
          rateRetried = true;
          continue;
        }
        throw error;
      }
    }
  }

  #once(operation: string, url: URL, token: Secret, deadline: number, signal: AbortSignal | undefined): Promise<unknown> {
    return this.#budget.run(operation, deadline, signal, async () => {
      const remaining = Math.max(1, Math.min(this.#timeoutMs, deadline - this.#now()));
      const result = await send(this.#fetch, {
        operation,
        method: 'GET',
        url,
        headers: { Authorization: `Bearer ${token.reveal()}`, 'Client-Id': this.#tokens.clientId },
        timeoutMs: remaining,
        signal,
        observe: (headers, status) => this.#budget.observe(headers, status),
      });
      return result.body;
    });
  }
}
