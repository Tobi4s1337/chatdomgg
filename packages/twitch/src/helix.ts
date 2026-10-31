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

/**
 * Get Streams keeps only what tells us whether a broadcast is on: its ID, owner, type and start. Titles,
 * games, thumbnails and the viewer count are dropped at the door; a viewer count never stands for people.
 */
const StreamsSchema = z.object({
  data: z.array(z.object({
    id: z.string().regex(/^[0-9]{1,24}$/),
    user_id: TwitchIdSchema,
    type: z.string().max(32),
    started_at: z.string().max(64).nullish(),
  })).max(100),
});
/** Get Chatters keeps only the user IDs and the cursor. Logins and names of quiet people are never read. */
const ChattersSchema = z.object({
  data: z.array(z.object({ user_id: TwitchIdSchema })).max(1000),
  pagination: z.object({ cursor: z.string().min(1).max(4096).nullish() }).nullish(),
});

export interface HelixStream {
  readonly id: string;
  readonly userId: string;
  /** `live`, or an empty string when Twitch reports an error. Only `live` is a broadcast. */
  readonly type: string;
  readonly startedAt: number | null;
}

export interface HelixChattersPage {
  readonly userIds: readonly string[];
  /** The next page's cursor, or null on the last page. */
  readonly cursor: string | null;
}

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

export interface HelixCall {
  readonly operation: string;
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly params?: ReadonlyArray<readonly [string, string]>;
  readonly json?: unknown;
  /**
   * Whether a 429 may be waited out and retried once. Writes turn this off: Twitch also answers 429 when a
   * conduit or subscription limit is reached, and that is not something waiting fixes.
   */
  readonly retryRateLimit?: boolean;
}

/**
 * One client ID's authenticated Helix calls with the app token. A 401 renews the app token once
 * (single-flight across concurrent callers) and retries once; a second 401 is final. A 429 is retried once
 * only if its reset falls inside the deadline. Every call is admitted through the shared request budget.
 */
export class HelixSession {
  readonly tokens: AppTokenSession;
  readonly budget: RequestBudget;
  readonly now: () => number;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #helixUrl: string;

  constructor(options: HelixReaderOptions) {
    this.tokens = options.tokens;
    this.#fetch = options.fetch;
    this.now = options.now ?? Date.now;
    this.budget = options.budget ?? new RequestBudget({ now: this.now });
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#helixUrl = options.helixUrl ?? TWITCH_HELIX_URL;
  }

  async call(call: HelixCall, options: CallOptions = {}): Promise<{ readonly status: number; readonly body: unknown }> {
    const deadline = options.deadline ?? this.now() + this.#timeoutMs * 3;
    const url = new URL(call.path, this.#helixUrl);
    for (const [key, value] of call.params ?? []) url.searchParams.append(key, value);

    let token = await this.tokens.current();
    let renewed = false;
    let rateRetried = call.retryRateLimit === false;
    for (;;) {
      try {
        return await this.#once(call, url, token, deadline, options.signal);
      } catch (error) {
        if (isTwitchFailure(error, 'unauthorized') && !renewed) {
          renewed = true;
          token = await this.tokens.renew(token);
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

  #once(call: HelixCall, url: URL, token: Secret, deadline: number, signal: AbortSignal | undefined): Promise<{ readonly status: number; readonly body: unknown }> {
    return this.budget.run(call.operation, deadline, signal, async () => {
      const remaining = Math.max(1, Math.min(this.#timeoutMs, deadline - this.now()));
      const result = await send(this.#fetch, {
        operation: call.operation,
        method: call.method ?? 'GET',
        url,
        headers: { Authorization: `Bearer ${token.reveal()}`, 'Client-Id': this.tokens.clientId },
        ...(call.json === undefined ? {} : { json: call.json }),
        timeoutMs: remaining,
        signal,
        observe: (headers, status) => this.budget.observe(headers, status),
      });
      return { status: result.status, body: result.body };
    });
  }
}

/** Narrow app-token Helix reads: identity, recorded grants, stream state and connected chat users. */
export class HelixReader {
  readonly session: HelixSession;

  constructor(options: HelixReaderOptions | HelixSession) {
    this.session = options instanceof HelixSession ? options : new HelixSession(options);
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
    const body = (await this.session.call({ operation: 'get users', path: 'users', params }, options)).body;
    const parsed = UsersSchema.safeParse(body);
    if (!parsed.success) throw new TwitchRequestError('invalid_response', 'get users');
    return parsed.data.data.map(user => ({ id: user.id, login: user.login, displayName: user.display_name }));
  }

  /**
   * Get Streams for up to 100 user IDs. A user absent from the result is not streaming right now; a failed
   * request throws and means nothing about whether they are.
   */
  async getStreams(userIds: readonly string[], options: CallOptions = {}): Promise<HelixStream[]> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];
    if (ids.length > 100) throw new RangeError('Get Streams accepts at most 100 user IDs');
    for (const id of ids) TwitchIdSchema.parse(id);
    const params = [...ids.map(id => ['user_id', id] as const), ['first', String(ids.length)] as const];
    const body = (await this.session.call({ operation: 'get streams', path: 'streams', params }, options)).body;
    const parsed = StreamsSchema.safeParse(body);
    if (!parsed.success) throw new TwitchRequestError('invalid_response', 'get streams');
    const wanted = new Set(ids);
    return parsed.data.data.filter(stream => wanted.has(stream.user_id)).map(stream => {
      const startedAt = stream.started_at ? Date.parse(stream.started_at) : Number.NaN;
      return { id: stream.id, userId: stream.user_id, type: stream.type, startedAt: Number.isFinite(startedAt) ? startedAt : null };
    });
  }

  /**
   * One page of Get Chatters with the app token. `moderatorId` must have granted this client
   * `moderator:read:chatters`; the broadcaster qualifies without a moderator appointment.
   */
  async getChattersPage(
    query: { readonly broadcasterId: string; readonly moderatorId: string; readonly first?: number; readonly after?: string | null },
    options: CallOptions = {},
  ): Promise<HelixChattersPage> {
    TwitchIdSchema.parse(query.broadcasterId);
    TwitchIdSchema.parse(query.moderatorId);
    const first = query.first ?? 1000;
    if (!Number.isInteger(first) || first < 1 || first > 1000) throw new RangeError('Get Chatters pages hold 1 to 1000 users');
    const params: Array<readonly [string, string]> = [['broadcaster_id', query.broadcasterId], ['moderator_id', query.moderatorId], ['first', String(first)]];
    if (query.after) params.push(['after', query.after]);
    const body = (await this.session.call({ operation: 'get chatters', path: 'chat/chatters', params }, options)).body;
    const parsed = ChattersSchema.safeParse(body);
    if (!parsed.success) throw new TwitchRequestError('invalid_response', 'get chatters');
    return { userIds: parsed.data.data.map(entry => entry.user_id), cursor: parsed.data.pagination?.cursor ?? null };
  }

  /** Get Authorization By User: the scopes each user has granted this client. At most 10 IDs. */
  async getAuthorizationByUser(userIds: readonly string[], options: CallOptions = {}): Promise<HelixAuthorization[]> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];
    if (ids.length > 10) throw new RangeError('Get Authorization By User accepts at most 10 IDs');
    for (const id of ids) TwitchIdSchema.parse(id);
    const body = (await this.session.call({ operation: 'get authorization by user', path: 'authorization/users', params: ids.map(id => ['user_id', id] as const) }, options)).body;
    const parsed = AuthorizationsSchema.safeParse(body);
    if (!parsed.success) throw new TwitchRequestError('invalid_response', 'get authorization by user');
    return parsed.data.data.map(entry => ({
      userId: entry.user_id,
      hasAuthorized: entry.has_authorized,
      scopes: entry.has_authorized ? [...new Set(entry.scopes ?? [])].sort() : [],
    }));
  }
}
