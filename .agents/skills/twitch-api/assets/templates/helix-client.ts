/**
 * helix-client.ts — zero-dependency, typed Twitch Helix client for Node 22+ (native fetch).
 *
 * Copy into your project (e.g. server/twitch/helix-client.ts). Features:
 *  - Client-Id + Bearer headers on every call, JSON bodies, repeated query keys (id=1&id=2)
 *  - Token providers: AppTokenProvider (client credentials, auto-renew) and UserTokenProvider
 *    (refresh-token rotation with an onRefresh hook so you can persist the new pair)
 *  - On 401: asks the provider for a fresh token once, then retries
 *  - Rate-limit aware: tracks Ratelimit-Limit/Remaining/Reset, waits for the bucket reset when it is
 *    empty, retries 429s (bucket exhaustion) with jitter; endpoint-specific 429s (shoutout/raid
 *    cooldowns etc.) are thrown immediately because waiting for the bucket won't fix them
 *  - Retries a 503 once (as the Twitch docs recommend)
 *  - paginate(): async iterator over cursor-paginated endpoints
 *  - Typed helpers for the ~20 most-used endpoints; field names copied from the official reference
 *
 * Use a USER token client for anything acting on behalf of a broadcaster/moderator (polls, rewards,
 * raids, ...). Use an APP token client for public data (users, streams, games, clips, search) and
 * EventSub webhook/conduit management. Server-side only: never ship the client secret to a browser.
 *
 * Mock testing: new HelixClient({ ..., baseUrl: "http://localhost:8110/mock" }) and
 * AppTokenProvider({ ..., authBaseUrl: "http://localhost:8110/auth" }) — see references/testing.md.
 */

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

export interface TokenProvider {
  /** Return a currently valid access token (may fetch/refresh lazily). */
  getAccessToken(): Promise<string>;
  /** Called after a 401: force-refresh and return the new token (throw if impossible). */
  refresh(): Promise<string>;
}

export const TWITCH_AUTH_BASE = "https://id.twitch.tv/oauth2";

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string[];
  token_type: string;
}

async function postToken(authBaseUrl: string, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${authBaseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params), // URL-encodes the refresh token, as Twitch requires
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Twitch token request failed (${res.status}): ${text}`);
  return JSON.parse(text) as TokenResponse;
}

/** App access token via the client-credentials grant. No user context, no scopes. */
export class AppTokenProvider implements TokenProvider {
  private token: string | undefined;
  private expiresAt = 0;
  private inflight: Promise<string> | undefined;
  private readonly opts: { clientId: string; clientSecret: string; authBaseUrl?: string };

  constructor(opts: { clientId: string; clientSecret: string; authBaseUrl?: string }) {
    this.opts = opts;
  }

  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - 60_000) return this.token;
    return this.refresh();
  }

  refresh(): Promise<string> {
    // De-duplicate concurrent refreshes.
    this.inflight ??= postToken(this.opts.authBaseUrl ?? TWITCH_AUTH_BASE, {
      client_id: this.opts.clientId,
      client_secret: this.opts.clientSecret,
      grant_type: "client_credentials",
    })
      .then((t) => {
        this.token = t.access_token;
        this.expiresAt = Date.now() + (t.expires_in ?? 3600) * 1000;
        return t.access_token;
      })
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }
}

/**
 * User access token + refresh token (authorization-code flow). Twitch may return a NEW refresh
 * token on every refresh — persist it in onRefresh or you'll lose access after a restart.
 */
export class UserTokenProvider implements TokenProvider {
  private accessToken: string;
  private refreshToken: string;
  private inflight: Promise<string> | undefined;
  private readonly opts: {
    clientId: string;
    clientSecret: string;
    authBaseUrl?: string;
    onRefresh?: (t: TokenResponse) => void | Promise<void>;
  };

  constructor(opts: {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    authBaseUrl?: string;
    onRefresh?: (t: TokenResponse) => void | Promise<void>;
  }) {
    this.opts = opts;
    this.accessToken = opts.accessToken;
    this.refreshToken = opts.refreshToken;
  }

  async getAccessToken(): Promise<string> {
    return this.accessToken;
  }

  refresh(): Promise<string> {
    this.inflight ??= postToken(this.opts.authBaseUrl ?? TWITCH_AUTH_BASE, {
      client_id: this.opts.clientId,
      client_secret: this.opts.clientSecret,
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
    })
      .then(async (t) => {
        this.accessToken = t.access_token;
        if (t.refresh_token) this.refreshToken = t.refresh_token;
        await this.opts.onRefresh?.(t);
        return t.access_token;
      })
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }
}

/** Static token (tests, short scripts). refresh() throws, so a 401 surfaces as HelixError. */
export function staticToken(token: string): TokenProvider {
  return {
    getAccessToken: async () => token,
    refresh: async () => {
      throw new Error("Static token rejected (401) and cannot be refreshed");
    },
  };
}

export interface ValidatedToken {
  client_id: string;
  login: string | null; // null for app access tokens
  user_id: string | null;
  scopes: string[] | null;
  expires_in: number;
}

/** GET /oauth2/validate — who does this token belong to, which scopes does it have. Twitch
 *  requires apps to validate user tokens on startup and hourly. Returns null if invalid. */
export async function validateToken(token: string, authBaseUrl = TWITCH_AUTH_BASE): Promise<ValidatedToken | null> {
  const res = await fetch(`${authBaseUrl}/validate`, { headers: { Authorization: `OAuth ${token}` } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`validate failed: ${res.status}`);
  return (await res.json()) as ValidatedToken;
}

// ---------------------------------------------------------------------------------------------
// Core client
// ---------------------------------------------------------------------------------------------

export type QueryValue = string | number | boolean | undefined | null | ReadonlyArray<string | number>;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Abort a long wait / request. */
  signal?: AbortSignal;
}

export interface RateLimitState {
  limit: number | undefined;
  remaining: number | undefined;
  /** Unix epoch seconds when the bucket is full again. */
  reset: number | undefined;
}

/** Error body shape: {"error":"Bad Request","status":400,"message":"..."} */
export class HelixError extends Error {
  readonly status: number;
  readonly error: string;
  readonly endpoint: string;
  readonly body: unknown;
  constructor(status: number, endpoint: string, body: unknown) {
    const b = (body ?? {}) as { error?: string; message?: string };
    super(`Helix ${endpoint} -> ${status} ${b.error ?? ""}: ${b.message ?? JSON.stringify(body)}`);
    this.name = "HelixError";
    this.status = status;
    this.error = b.error ?? "";
    this.endpoint = endpoint;
    this.body = body;
  }
}

export interface Paginated<T> {
  data: T[];
  pagination?: { cursor?: string } | string; // string only for Get Extension Live Channels
  total?: number;
}

export interface HelixClientOptions {
  clientId: string;
  token: TokenProvider;
  /** Default https://api.twitch.tv/helix. For the Twitch CLI mock: http://localhost:<port>/mock */
  baseUrl?: string;
  /** Max retries for 429/503 (default 3). */
  maxRetries?: number;
  /** Called on every response with the current rate-limit bucket (for logging/metrics). */
  onRateLimit?: (s: RateLimitState) => void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

export class HelixClient {
  readonly rateLimit: RateLimitState = { limit: undefined, remaining: undefined, reset: undefined };
  private readonly clientId: string;
  private readonly token: TokenProvider;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly onRateLimit: ((s: RateLimitState) => void) | undefined;

  constructor(opts: HelixClientOptions) {
    this.clientId = opts.clientId;
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? "https://api.twitch.tv/helix").replace(/\/$/, "");
    this.maxRetries = opts.maxRetries ?? 3;
    this.onRateLimit = opts.onRateLimit;
  }

  /** Build `path?k=v&k=v2` — arrays become repeated keys (Twitch does NOT accept comma lists). */
  url(path: string, query?: Query): string {
    const u = new URL(this.baseUrl + (path.startsWith("/") ? path : `/${path}`));
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) for (const item of v) u.searchParams.append(k, String(item));
      else u.searchParams.append(k, String(v));
    }
    return u.toString();
  }

  /** Low-level request. Returns parsed JSON, or undefined for 204 No Content. */
  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const endpoint = `${method} ${path}`;
    let refreshed = false;
    let served503 = false;
    for (let attempt = 0; ; attempt++) {
      await this.waitForBucket(opts.signal);
      const headers: Record<string, string> = {
        "Client-Id": this.clientId,
        Authorization: `Bearer ${await this.token.getAccessToken()}`,
      };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      const res = await fetch(this.url(path, opts.query), {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: opts.signal,
      });
      this.trackRateLimit(res.headers);

      if (res.status === 204) return undefined as T;
      const text = await res.text();
      let body: unknown = undefined;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = text;
      }
      if (res.ok) return body as T;

      // 401: token expired/revoked -> refresh once and retry.
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        try {
          await this.token.refresh();
          continue;
        } catch {
          /* fall through: throw the original 401 */
        }
      }
      // 429: retry only when the global bucket is exhausted (remaining == 0). Endpoint-specific
      // limits (Send a Shoutout, Start a raid, Check AutoMod Status...) return 429 with points left.
      if (res.status === 429 && attempt < this.maxRetries && (this.rateLimit.remaining ?? 0) <= 0) {
        const resetMs = this.rateLimit.reset ? this.rateLimit.reset * 1000 - Date.now() : 0;
        const backoff = Math.max(resetMs, 1000 * 2 ** attempt) + Math.random() * 500;
        await sleep(Math.min(backoff, 65_000), opts.signal);
        continue;
      }
      if (res.status === 503 && !served503) {
        served503 = true;
        await sleep(1000 + Math.random() * 500, opts.signal);
        continue;
      }
      throw new HelixError(res.status, endpoint, body);
    }
  }

  get<T>(path: string, query?: Query) {
    return this.request<T>("GET", path, { query });
  }

  /**
   * Async iterator over every item of a cursor-paginated GET endpoint.
   *   for await (const s of helix.paginate<Stream>("/streams", { game_id: "509658" }, { limit: 300 })) ...
   * pageSize -> `first` (check the endpoint's max: usually 100, Get Custom Reward Redemption 50, ...).
   */
  async *paginate<T>(
    path: string,
    query: Query = {},
    opts: { pageSize?: number; limit?: number; signal?: AbortSignal } = {},
  ): AsyncGenerator<T, void, undefined> {
    let after: string | undefined;
    let n = 0;
    do {
      const page = await this.request<Paginated<T>>("GET", path, {
        query: { ...query, first: opts.pageSize ?? query.first ?? 100, after },
        signal: opts.signal,
      });
      for (const item of page.data ?? []) {
        yield item;
        if (opts.limit !== undefined && ++n >= opts.limit) return;
      }
      const p = page.pagination;
      after = typeof p === "string" ? p || undefined : p?.cursor || undefined;
      if (!page.data?.length) after = undefined; // lists are dynamic; stop on empty page
    } while (after);
  }

  /** Collect paginate() into an array (mind `limit` for big lists). */
  async getAll<T>(path: string, query: Query = {}, opts: { pageSize?: number; limit?: number } = {}): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this.paginate<T>(path, query, opts)) out.push(item);
    return out;
  }

  private trackRateLimit(h: Headers) {
    const num = (k: string) => {
      const v = h.get(k);
      return v === null ? undefined : Number(v);
    };
    const limit = num("Ratelimit-Limit");
    if (limit === undefined) return; // e.g. the CLI mock API sends no rate-limit headers
    this.rateLimit.limit = limit;
    this.rateLimit.remaining = num("Ratelimit-Remaining");
    this.rateLimit.reset = num("Ratelimit-Reset");
    this.onRateLimit?.({ ...this.rateLimit });
  }

  private async waitForBucket(signal?: AbortSignal) {
    const { remaining, reset } = this.rateLimit;
    if (remaining !== undefined && remaining <= 0 && reset) {
      const ms = reset * 1000 - Date.now();
      if (ms > 0) await sleep(ms + Math.random() * 250, signal);
      this.rateLimit.remaining = undefined; // bucket refilled; learn the real value from the next response
    }
  }

  // -------------------------------------------------------------------------------------------
  // Typed helpers. Each notes token type + scope. "1st" = returns data[0].
  // -------------------------------------------------------------------------------------------

  /** Get Users — app or user token. Max 100 ids + 100 logins. No args + user token = token owner. */
  async getUsers(q: { id?: string[]; login?: string[] } = {}): Promise<User[]> {
    return (await this.get<{ data: User[] }>("/users", q)).data;
  }
  async getUserByLogin(login: string): Promise<User | undefined> {
    return (await this.getUsers({ login: [login.toLowerCase()] }))[0];
  }

  /** Get Streams — app or user. Only LIVE streams are returned; empty data = offline. */
  async getStreams(q: { user_id?: string[]; user_login?: string[]; game_id?: string[]; type?: "all" | "live"; language?: string[]; first?: number; after?: string } = {}) {
    return this.get<Paginated<Stream>>("/streams", q);
  }

  /** Get Channel Information — app or user. Up to 100 broadcaster_id. */
  async getChannels(broadcasterIds: string[]): Promise<Channel[]> {
    return (await this.get<{ data: Channel[] }>("/channels", { broadcaster_id: broadcasterIds })).data;
  }

  /** Modify Channel Information — user token of the broadcaster, channel:manage:broadcast. 204. */
  async updateChannel(broadcasterId: string, body: ModifyChannelBody): Promise<void> {
    await this.request("PATCH", "/channels", { query: { broadcaster_id: broadcasterId }, body });
  }

  /** Get Games — app or user. Exact names; use searchCategories() for fuzzy. */
  async getGames(q: { id?: string[]; name?: string[]; igdb_id?: string[] }): Promise<Game[]> {
    return (await this.get<{ data: Game[] }>("/games", q)).data;
  }

  /** Search Categories — app or user. */
  async searchCategories(query: string, first = 20) {
    return this.get<Paginated<Category>>("/search/categories", { query, first });
  }

  /** Get Custom Reward — user, channel:read:redemptions or channel:manage:redemptions. */
  async getCustomRewards(broadcasterId: string, q: { id?: string[]; only_manageable_rewards?: boolean } = {}) {
    return (await this.get<{ data: CustomReward[] }>("/channel_points/custom_rewards", { broadcaster_id: broadcasterId, ...q })).data;
  }

  /** Create Custom Rewards — user, channel:manage:redemptions. Affiliate/Partner only. 1st. */
  async createCustomReward(broadcasterId: string, body: CustomRewardInput): Promise<CustomReward> {
    const r = await this.request<{ data: CustomReward[] }>("POST", "/channel_points/custom_rewards", {
      query: { broadcaster_id: broadcasterId },
      body,
    });
    return r.data[0]!;
  }

  /** Update Custom Reward — only the client ID that created the reward may update it. 1st. */
  async updateCustomReward(broadcasterId: string, id: string, body: Partial<CustomRewardInput> & { is_paused?: boolean }) {
    const r = await this.request<{ data: CustomReward[] }>("PATCH", "/channel_points/custom_rewards", {
      query: { broadcaster_id: broadcasterId, id },
      body,
    });
    return r.data[0]!;
  }

  /** Delete Custom Reward — creating client ID only. 204. */
  async deleteCustomReward(broadcasterId: string, id: string): Promise<void> {
    await this.request("DELETE", "/channel_points/custom_rewards", { query: { broadcaster_id: broadcasterId, id } });
  }

  /** Get Custom Reward Redemption — page size max 50. status required unless id is given. */
  getRedemptions(broadcasterId: string, rewardId: string, status: RedemptionStatus = "UNFULFILLED") {
    return this.paginate<Redemption>(
      "/channel_points/custom_rewards/redemptions",
      { broadcaster_id: broadcasterId, reward_id: rewardId, status },
      { pageSize: 50 },
    );
  }

  /** Update Redemption Status — FULFILLED or CANCELED (CANCELED refunds the points). Max 50 ids. */
  async updateRedemptionStatus(broadcasterId: string, rewardId: string, ids: string[], status: "FULFILLED" | "CANCELED") {
    const r = await this.request<{ data: Redemption[] }>("PATCH", "/channel_points/custom_rewards/redemptions", {
      query: { broadcaster_id: broadcasterId, reward_id: rewardId, id: ids },
      body: { status },
    });
    return r.data;
  }

  /** Create Poll — user, channel:manage:polls. 2–5 choices (≤25 chars), title ≤60, 15–1800 s. 1st. */
  async createPoll(body: { broadcaster_id: string; title: string; choices: { title: string }[]; duration: number; channel_points_voting_enabled?: boolean; channel_points_per_vote?: number }) {
    return (await this.request<{ data: Poll[] }>("POST", "/polls", { body })).data[0]!;
  }

  /** End Poll — TERMINATED (stays visible) or ARCHIVED (hidden). 1st. */
  async endPoll(broadcasterId: string, id: string, status: "TERMINATED" | "ARCHIVED" = "TERMINATED") {
    return (await this.request<{ data: Poll[] }>("PATCH", "/polls", { body: { broadcaster_id: broadcasterId, id, status } })).data[0]!;
  }

  /** Create Prediction — user, channel:manage:predictions. 2–10 outcomes, title ≤45, window 30–1800 s. 1st. */
  async createPrediction(body: { broadcaster_id: string; title: string; outcomes: { title: string }[]; prediction_window: number }) {
    return (await this.request<{ data: Prediction[] }>("POST", "/predictions", { body })).data[0]!;
  }

  /** End Prediction — LOCKED, RESOLVED (needs winning_outcome_id) or CANCELED (refund). 1st. */
  async endPrediction(broadcasterId: string, id: string, status: "LOCKED" | "RESOLVED" | "CANCELED", winningOutcomeId?: string) {
    return (
      await this.request<{ data: Prediction[] }>("PATCH", "/predictions", {
        body: { broadcaster_id: broadcasterId, id, status, winning_outcome_id: winningOutcomeId },
      })
    ).data[0]!;
  }

  /** Create Clip — user, clips:edit. Async: returns 202 + id; poll getClips({id}) for up to ~60 s. */
  async createClip(broadcasterId: string, opts: { title?: string; duration?: number } = {}): Promise<CreatedClip> {
    const r = await this.request<{ data: CreatedClip[] }>("POST", "/clips", { query: { broadcaster_id: broadcasterId, ...opts } });
    return r.data[0]!;
  }

  /** Get Clips — app or user. Exactly one of broadcaster_id | game_id | id. */
  async getClips(q: { broadcaster_id?: string; game_id?: string; id?: string[]; started_at?: string; ended_at?: string; first?: number; after?: string; is_featured?: boolean }) {
    return this.get<Paginated<Clip>>("/clips", q);
  }

  /** Create Clip, then poll Get Clips until it exists (or give up after timeoutMs). */
  async createClipAndWait(broadcasterId: string, timeoutMs = 60_000): Promise<Clip | undefined> {
    const { id } = await this.createClip(broadcasterId);
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const clip = (await this.getClips({ id: [id] })).data[0];
      if (clip) return clip;
      await sleep(3000);
    }
    return undefined;
  }

  /** Start a raid — user (from_broadcaster), channel:manage:raids. 10 req / 10 min. 1st. */
  async startRaid(fromBroadcasterId: string, toBroadcasterId: string) {
    const r = await this.request<{ data: RaidResult[] }>("POST", "/raids", {
      query: { from_broadcaster_id: fromBroadcasterId, to_broadcaster_id: toBroadcasterId },
    });
    return r.data[0]!;
  }

  /** Cancel a raid — 204. */
  async cancelRaid(broadcasterId: string): Promise<void> {
    await this.request("DELETE", "/raids", { query: { broadcaster_id: broadcasterId } });
  }

  /** Send a Shoutout — moderator:manage:shoutouts; moderator_id must equal the token user. Live only.
   *  Limits: 1 per 2 min, same target 1 per 60 min (429 otherwise). 204. */
  async sendShoutout(fromBroadcasterId: string, toBroadcasterId: string, moderatorId: string): Promise<void> {
    await this.request("POST", "/chat/shoutouts", {
      query: { from_broadcaster_id: fromBroadcasterId, to_broadcaster_id: toBroadcasterId, moderator_id: moderatorId },
    });
  }

  /** Send Chat Announcement — moderator:manage:announcements. ≤500 chars, 1 per 2 s. 204. */
  async sendAnnouncement(broadcasterId: string, moderatorId: string, message: string, color?: "blue" | "green" | "orange" | "purple" | "primary"): Promise<void> {
    await this.request("POST", "/chat/announcements", {
      query: { broadcaster_id: broadcasterId, moderator_id: moderatorId },
      body: { message, color },
    });
  }

  /** Send Chat Message — user:write:chat (user token of sender_id), or app token with user:bot
   *  (+ channel:bot) for the chat-bot badge. Check is_sent / drop_reason — a 200 can still be dropped. */
  async sendChatMessage(body: { broadcaster_id: string; sender_id: string; message: string; reply_parent_message_id?: string; for_source_only?: boolean; pin?: boolean }) {
    return (await this.request<{ data: SendChatMessageResult[] }>("POST", "/chat/messages", { body })).data[0]!;
  }

  /** Get Channel Followers — user, moderator:read:followers, token user = broadcaster or a mod.
   *  Without that you only get `total`. Pass user_id to check one user. */
  async getChannelFollowers(broadcasterId: string, q: { user_id?: string; first?: number; after?: string } = {}) {
    return this.get<Paginated<Follower> & { total: number }>("/channels/followers", { broadcaster_id: broadcasterId, ...q });
  }

  /** Get Broadcaster Subscriptions — user (broadcaster), channel:read:subscriptions. */
  async getSubscriptions(broadcasterId: string, q: { user_id?: string[]; first?: number; after?: string } = {}) {
    return this.get<Paginated<Subscription> & { total: number; points: number }>("/subscriptions", { broadcaster_id: broadcasterId, ...q });
  }
}

// ---------------------------------------------------------------------------------------------
// Response types (field names exactly as in https://dev.twitch.tv/docs/api/reference)
// ---------------------------------------------------------------------------------------------

export interface User {
  id: string;
  login: string;
  display_name: string;
  type: "admin" | "global_mod" | "staff" | "";
  broadcaster_type: "affiliate" | "partner" | "";
  description: string;
  profile_image_url: string;
  offline_image_url: string;
  /** Deprecated — do not use. */
  view_count: number;
  /** Only with user:read:email, and only for the token's own user. */
  email?: string;
  created_at: string;
}

export interface Stream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: "live" | "";
  title: string;
  tags: string[];
  viewer_count: number;
  started_at: string;
  language: string;
  /** Replace {width}x{height}. */
  thumbnail_url: string;
  /** Deprecated (always []). */
  tag_ids: string[];
  /** Deprecated (always false). */
  is_mature: boolean;
}

export interface Channel {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  broadcaster_language: string;
  game_name: string;
  game_id: string;
  title: string;
  delay: number;
  tags: string[];
  content_classification_labels: string[];
  is_branded_content: boolean;
}

export interface ModifyChannelBody {
  game_id?: string; // "0" or "" unsets
  broadcaster_language?: string;
  title?: string; // may not be empty
  delay?: number; // partners only, max 900
  tags?: string[]; // max 10 tags, [] clears
  content_classification_labels?: { id: string; is_enabled: boolean }[];
  is_branded_content?: boolean;
}

export interface Game {
  id: string;
  name: string;
  /** Replace {width}x{height}. */
  box_art_url: string;
  igdb_id: string;
}

export interface Category {
  id: string;
  name: string;
  box_art_url: string;
}

export interface CustomRewardInput {
  title: string; // ≤45 chars, unique per channel
  cost: number; // ≥1
  prompt?: string; // ≤200 chars
  is_enabled?: boolean;
  background_color?: string; // "#9147FF"
  is_user_input_required?: boolean;
  is_max_per_stream_enabled?: boolean;
  max_per_stream?: number;
  is_max_per_user_per_stream_enabled?: boolean;
  max_per_user_per_stream?: number;
  is_global_cooldown_enabled?: boolean;
  global_cooldown_seconds?: number;
  should_redemptions_skip_request_queue?: boolean;
}

export interface RewardImage {
  url_1x: string;
  url_2x: string;
  url_4x: string;
}

export interface CustomReward {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  id: string;
  title: string;
  prompt: string;
  cost: number;
  image: RewardImage | null;
  default_image: RewardImage;
  background_color: string;
  is_enabled: boolean;
  is_user_input_required: boolean;
  max_per_stream_setting: { is_enabled: boolean; max_per_stream: number };
  max_per_user_per_stream_setting: { is_enabled: boolean; max_per_user_per_stream: number };
  global_cooldown_setting: { is_enabled: boolean; global_cooldown_seconds: number };
  is_paused: boolean;
  is_in_stock: boolean;
  should_redemptions_skip_request_queue: boolean;
  redemptions_redeemed_current_stream: number | null;
  cooldown_expires_at: string | null;
}

export type RedemptionStatus = "CANCELED" | "FULFILLED" | "UNFULFILLED";

export interface Redemption {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  user_input: string;
  status: RedemptionStatus;
  redeemed_at: string;
  reward: { id: string; title: string; prompt: string; cost: number };
}

export interface Poll {
  id: string;
  broadcaster_id: string;
  broadcaster_name: string;
  broadcaster_login: string;
  title: string;
  choices: { id: string; title: string; votes: number; channel_points_votes: number; bits_votes: number }[];
  bits_voting_enabled: boolean;
  bits_per_vote: number;
  channel_points_voting_enabled: boolean;
  channel_points_per_vote: number;
  status: "ACTIVE" | "COMPLETED" | "TERMINATED" | "ARCHIVED" | "MODERATED" | "INVALID";
  duration: number;
  started_at: string;
  ended_at: string | null;
}

export interface PredictionOutcome {
  id: string;
  title: string;
  users: number;
  channel_points: number;
  top_predictors:
    | { user_id: string; user_name: string; user_login: string; channel_points_used: number; channel_points_won: number }[]
    | null;
  color: "BLUE" | "PINK";
}

export interface Prediction {
  id: string;
  broadcaster_id: string;
  broadcaster_name: string;
  broadcaster_login: string;
  title: string;
  winning_outcome_id: string | null;
  outcomes: PredictionOutcome[];
  prediction_window: number;
  status: "ACTIVE" | "CANCELED" | "LOCKED" | "RESOLVED";
  created_at: string;
  ended_at: string | null;
  locked_at: string | null;
}

export interface CreatedClip {
  id: string;
  edit_url: string;
}

export interface Clip {
  id: string;
  url: string;
  embed_url: string;
  broadcaster_id: string;
  broadcaster_name: string;
  creator_id: string;
  creator_name: string;
  video_id: string;
  game_id: string;
  language: string;
  title: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  duration: number;
  vod_offset: number | null;
  is_featured: boolean;
}

export interface RaidResult {
  created_at: string;
  /** Deprecated (always false). */
  is_mature: boolean;
}

export interface SendChatMessageResult {
  message_id: string;
  is_sent: boolean;
  drop_reason?: { code: string; message: string } | null;
}

export interface Follower {
  followed_at: string;
  user_id: string;
  user_login: string;
  user_name: string;
}

export interface Subscription {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  gifter_id: string;
  gifter_login: string;
  gifter_name: string;
  is_gift: boolean;
  plan_name: string;
  tier: "1000" | "2000" | "3000";
  user_id: string;
  user_name: string;
  user_login: string;
}
