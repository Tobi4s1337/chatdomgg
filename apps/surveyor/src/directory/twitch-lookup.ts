import { DisplayNameSchema, TwitchIdSchema, TwitchLoginSchema } from '@chatdom/shared';
import { z } from 'zod';
import { AppTokenSession, VALIDATE_INTERVAL_MS } from '../../../../packages/twitch/src/app-token';
import { RequestBudget } from '../../../../packages/twitch/src/budget';
import { HelixSession } from '../../../../packages/twitch/src/helix';
import { Secret } from '../../../../packages/twitch/src/secret';
import { remainingFromHeaders, resetFromHeaders, type FetchLike } from '../../../../packages/twitch/src/transport';
import { AvatarUrlSchema } from '../export/schema';

export interface TwitchChannelFacts {
  id: string; login: string; name: string; avatarUrl: string | null;
  language: string; gameId: string | null; game: string | null; title: string | null;
  live: boolean; viewers: number | null; startedAt: number | null; fetchedAt: number;
}
export interface TwitchLookup {
  lookup(query: string): Promise<TwitchChannelFacts[]>;
  /** Whether this normalized query can be answered without spending an upstream request. */
  cached?(query: string): boolean;
  /**
   * Facts for up to a hundred channel IDs in two Helix calls (users, then channel information), without live state:
   * what settlement needs to place a raided channel the survey never saw. IDs Twitch does not return as users are
   * `absent` (deleted or suspended). Throws LookupUnavailable like `lookup`.
   */
  channels?(ids: readonly string[]): Promise<{ found: TwitchChannelFacts[]; absent: string[] }>;
  close(): void;
}
export class LookupUnavailable extends Error {
  constructor(readonly reason: 'disabled' | 'limited' | 'upstream', readonly retryAfter?: number) {
    super(`Channel lookup ${reason}`);
    this.name = 'LookupUnavailable';
  }
}

export interface TwitchLookupOptions {
  clientId?: string; clientSecret?: string; fetch?: FetchLike;
  now?: () => number; random?: () => number; timeoutMs?: number;
}
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;
const CACHE_ENTRIES = 1_000;
const Users = z.object({ data: z.array(z.object({
  id: TwitchIdSchema, login: TwitchLoginSchema, display_name: DisplayNameSchema,
  profile_image_url: z.string().max(2_048),
})).max(100) });
const Search = z.object({ data: z.array(z.object({ id: TwitchIdSchema })).max(100) });
const Channels = z.object({ data: z.array(z.object({
  broadcaster_id: TwitchIdSchema, broadcaster_language: z.string().max(16),
  game_id: z.string().max(32), game_name: z.string().max(256), title: z.string().max(512),
})).max(100) });
const Streams = z.object({ data: z.array(z.object({
  user_id: TwitchIdSchema, type: z.string().max(32), viewer_count: z.number().int().nonnegative(),
  started_at: z.string().max(64),
})).max(100) });
interface Cached { until: number; facts: TwitchChannelFacts[] }

/** Public reads only. No credentials, provider error bodies or OAuth response can escape this boundary. */
export function createTwitchLookup(options: TwitchLookupOptions = {}): TwitchLookup {
  if (!options.clientId || !options.clientSecret) return {
    lookup: async () => { throw new LookupUnavailable('disabled'); }, cached: () => false,
    channels: async () => { throw new LookupUnavailable('disabled'); }, close: () => {},
  };
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 1_500;
  const cache = new Map<string, Cached>();
  const pending = new Map<string, Promise<TwitchChannelFacts[]>>();
  const spent: number[] = [];
  const lifetime = new AbortController();
  let closed = false;
  let cooldown = 0;
  let reserveUntil = 0;
  let remaining: number | null = null;
  let resetAt = 0;
  let failures = 0;
  let validating: Promise<unknown> | null = null;
  const retry = (until: number) => Math.max(1, Math.ceil((until - now()) / 1_000));
  function unavailable(): LookupUnavailable | null {
    if (closed) return new LookupUnavailable('disabled');
    const at = now();
    if (cooldown > at) return new LookupUnavailable('upstream', retry(cooldown));
    if (reserveUntil > at) return new LookupUnavailable('limited', retry(reserveUntil));
    while (spent.length && spent[0]! <= at - MINUTE) spent.shift();
    if (spent.length >= 60) return new LookupUnavailable('limited', retry(spent[0]! + MINUTE));
    return null;
  }
  function backoff(): void {
    failures = Math.min(6, failures + 1);
    cooldown = now() + Math.ceil(Math.min(60_000, 1_000 * 2 ** failures) * (0.75 + random() * 0.5));
  }
  const guardedFetch: FetchLike = async (url, init) => {
    const helix = new URL(url).hostname === 'api.twitch.tv';
    // Validation spends no Helix points and must still happen while that bucket is reserved.
    const refused = helix ? unavailable() : closed ? new LookupUnavailable('disabled') : cooldown > now() ? new LookupUnavailable('upstream', retry(cooldown)) : null;
    if (refused) throw refused;
    // Count actual wire attempts, including the session's single 401 renewal retry.
    if (helix) spent.push(now());
    let response: Response;
    try { response = await fetchImpl(url, init); }
    catch { backoff(); throw new LookupUnavailable('upstream', retry(cooldown)); }
    if (helix) {
      const points = remainingFromHeaders(response.headers);
      const reset = resetFromHeaders(response.headers);
      if (points !== null) remaining = points;
      if (reset !== null) resetAt = reset;
      // Missing reset must never turn a low bucket into an immediate retry loop.
      if ((remaining !== null && remaining <= 200) || response.status === 429) reserveUntil = Math.max(now() + 1_000, resetAt > now() ? resetAt : now() + MINUTE);
    }
    if (response.status === 429 || response.status >= 500) backoff();
    else if (response.ok) failures = 0;
    return response;
  };
  const tokens = new AppTokenSession({ clientId: options.clientId, clientSecret: new Secret(options.clientSecret), fetch: guardedFetch, now, timeoutMs });
  const session = new HelixSession({ tokens, fetch: guardedFetch, now, timeoutMs, budget: new RequestBudget({ maxConcurrent: 1, maxQueued: 8, reservePoints: 200, now }) });
  const validationTimer = setInterval(() => {
    if (closed || !tokens.status.held || validating) return;
    validating = tokens.validate().catch(() => { backoff(); }).finally(() => { validating = null; });
  }, VALIDATE_INTERVAL_MS);
  validationTimer.unref();

  function put(key: string, facts: TwitchChannelFacts[], ttl: number): void {
    if (closed) return;
    cache.delete(key);
    cache.set(key, { until: now() + ttl, facts });
    while (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  }
  async function call<T>(path: string, params: ReadonlyArray<readonly [string, string]>, schema: z.ZodType<T>, deadline: number): Promise<T> {
    const refused = unavailable();
    if (refused) throw refused;
    try {
      const reply = await session.call({ operation: 'atlas channel lookup', path, params, retryRateLimit: false }, { deadline, signal: lifetime.signal });
      return schema.parse(reply.body);
    } catch {
      const refused = unavailable();
      if (refused) throw refused;
      backoff();
      throw new LookupUnavailable('upstream', retry(cooldown));
    }
  }
  async function resolve(query: string): Promise<TwitchChannelFacts[]> {
    const deadline = now() + 9_000;
    const id = query.startsWith('id:') ? query.slice(3) : null;
    const login = query.startsWith('login:') ? query.slice(6) : null;
    if (id !== null && !TwitchIdSchema.safeParse(id).success) return [];
    if (login !== null && !TwitchLoginSchema.safeParse(login).success) return [];
    const exact = id !== null || login !== null || TwitchLoginSchema.safeParse(query).success;
    let users: z.infer<typeof Users>['data'] = [];
    if (exact) users = (await call('users', [[id === null ? 'login' : 'id', id ?? login ?? query]], Users, deadline)).data;
    const exactFound = users.length > 0;
    if (users.length === 0 && id === null && login === null) {
      const found = await call('search/channels', [['query', query], ['first', '8'], ['live_only', 'false']], Search, deadline);
      const ids = [...new Set(found.data.map(row => row.id))].slice(0, 8);
      if (ids.length) {
        const hydrated = (await call('users', ids.map(value => ['id', value] as const), Users, deadline)).data;
        users = ids.flatMap(value => hydrated.filter(user => user.id === value));
      }
    }
    if (users.length === 0) { put(query, [], HOUR); return []; }
    const ids = users.map(user => user.id);
    const channels = (await call('channels', ids.map(value => ['broadcaster_id', value] as const), Channels, deadline)).data;
    const streams = (await call('streams', ids.map(value => ['user_id', value] as const), Streams, deadline)).data;
    // A partial/malformed channel-information reply is not proof that the identity has disappeared.
    if (ids.some(value => !channels.some(channel => channel.broadcaster_id === value))) {
      backoff();
      throw new LookupUnavailable('upstream', retry(cooldown));
    }
    const fetchedAt = now();
    const facts = users.flatMap(user => {
      const channel = channels.find(value => value.broadcaster_id === user.id);
      if (!channel) return [];
      const stream = streams.find(value => value.user_id === user.id && value.type === 'live');
      const startedAt = stream ? Date.parse(stream.started_at) : Number.NaN;
      const portrait = AvatarUrlSchema.safeParse(user.profile_image_url);
      return [{ id: user.id, login: user.login, name: user.display_name, avatarUrl: portrait.success ? portrait.data : null,
        language: channel.broadcaster_language || 'other', gameId: channel.game_id || null, game: channel.game_name || null,
        title: channel.title || null, live: !!stream, viewers: stream?.viewer_count ?? null,
        startedAt: Number.isFinite(startedAt) ? startedAt : null, fetchedAt }];
    });
    for (const fact of facts) { put(`id:${fact.id}`, [fact], DAY); put(`login:${fact.login}`, [fact], DAY); put(fact.login, [fact], DAY); }
    // An exact login which did not exist is checked again in an hour, even if partial search found neighbours.
    put(query, facts, exact && !exactFound ? HOUR : DAY);
    return facts;
  }
  async function channelsById(raw: readonly string[]): Promise<{ found: TwitchChannelFacts[]; absent: string[] }> {
    if (closed) throw new LookupUnavailable('disabled');
    const ids = [...new Set(raw)].filter(value => TwitchIdSchema.safeParse(value).success).slice(0, 100);
    if (!ids.length) return { found: [], absent: [] };
    const deadline = now() + 9_000;
    const users = (await call('users', ids.map(value => ['id', value] as const), Users, deadline)).data;
    const present = new Set(users.map(user => user.id));
    const absent = ids.filter(value => !present.has(value));
    if (!users.length) return { found: [], absent };
    const channels = (await call('channels', users.map(user => ['broadcaster_id', user.id] as const), Channels, deadline)).data;
    // As in a single lookup, a partial channel-information reply is not proof that anyone disappeared.
    if (users.some(user => !channels.some(channel => channel.broadcaster_id === user.id))) {
      backoff();
      throw new LookupUnavailable('upstream', retry(cooldown));
    }
    const fetchedAt = now();
    const found = users.map(user => {
      const channel = channels.find(value => value.broadcaster_id === user.id)!;
      const portrait = AvatarUrlSchema.safeParse(user.profile_image_url);
      return { id: user.id, login: user.login, name: user.display_name, avatarUrl: portrait.success ? portrait.data : null,
        language: channel.broadcaster_language || 'other', gameId: channel.game_id || null, game: channel.game_name || null,
        title: channel.title || null, live: false, viewers: null, startedAt: null, fetchedAt };
    });
    return { found, absent };
  }
  return {
    channels: channelsById,
    cached(raw) {
      if (closed) return false;
      const hit = cache.get(raw.trim().toLowerCase());
      return hit !== undefined && hit.until > now();
    },
    async lookup(raw) {
      if (closed) throw new LookupUnavailable('disabled');
      const query = raw.trim().toLowerCase();
      if (!query || [...query].length > 50) return [];
      const hit = cache.get(query);
      if (hit && hit.until > now()) return hit.facts.map(fact => ({ ...fact }));
      cache.delete(query);
      let work = pending.get(query);
      if (!work) {
        const refused = unavailable();
        if (refused) throw refused;
        if (pending.size >= 16) throw new LookupUnavailable('limited', 5);
        work = resolve(query).finally(() => { pending.delete(query); });
        pending.set(query, work);
      }
      const facts = await work;
      if (closed) throw new LookupUnavailable('disabled');
      return facts.map(fact => ({ ...fact }));
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(validationTimer);
      lifetime.abort(); tokens.close(); cache.clear();
    },
  };
}

/** Credentials remain optional: the survey register keeps working when fallback is unconfigured. */
export function twitchLookupFromEnv(env: NodeJS.ProcessEnv = process.env): TwitchLookup {
  return createTwitchLookup({ ...(env.TWITCH_CLIENT_ID ? { clientId: env.TWITCH_CLIENT_ID } : {}), ...(env.TWITCH_CLIENT_SECRET ? { clientSecret: env.TWITCH_CLIENT_SECRET } : {}) });
}
