import { z } from 'zod';
import { isTwitchFailure, TwitchRequestError } from '../errors';
import type { CallOptions, HelixSession } from '../helix';

/** Conduit and subscription IDs are Twitch UUID-like keys; anything else is treated as malformed. */
export const EventSubIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
/** Condition values are user/client IDs. They are kept as given and compared exactly. */
const ConditionSchema = z.record(z.string().max(64), z.string().max(128)).refine(record => Object.keys(record).length <= 8);
/** Short Twitch status/error codes; free-text messages are never kept. */
const CodeSchema = z.string().regex(/^[a-z_]{1,64}$/);

const SubscriptionWireSchema = z.object({
  id: EventSubIdSchema,
  status: z.string().max(64),
  type: z.string().max(128),
  version: z.string().max(16),
  condition: ConditionSchema,
  transport: z.object({ method: z.string().max(16), conduit_id: z.string().max(128).nullish() }),
  created_at: z.string().max(64).nullish(),
});
const SubscriptionPageSchema = z.object({
  data: z.array(SubscriptionWireSchema).max(1_000),
  pagination: z.object({ cursor: z.string().max(1_024).nullish() }).nullish(),
});
const ConduitsSchema = z.object({ data: z.array(z.object({ id: EventSubIdSchema, shard_count: z.number().int().min(0) })).max(10) });
const ShardWireSchema = z.object({
  id: z.string().regex(/^\d{1,5}$/),
  status: z.string().max(64),
  transport: z.object({ method: z.string().max(16), session_id: z.string().max(256).nullish() }).nullish(),
});
const ShardPageSchema = z.object({
  data: z.array(ShardWireSchema).max(1_000),
  pagination: z.object({ cursor: z.string().max(1_024).nullish() }).nullish(),
});
const ShardUpdateSchema = z.object({
  data: z.array(ShardWireSchema).max(100).nullish(),
  errors: z.array(z.object({ id: z.string().max(8), code: z.string().max(128).nullish() })).max(100).nullish(),
});

export interface EventSubSubscription {
  readonly id: string;
  /** `enabled`, or the reason Twitch disabled it (`authorization_revoked`, `user_removed`, …). */
  readonly status: string;
  readonly type: string;
  readonly version: string;
  readonly condition: Readonly<Record<string, string>>;
  /** The conduit it delivers to, or null for any other transport. */
  readonly conduitId: string | null;
}

export interface ConduitShard {
  readonly id: string;
  readonly status: string;
  /** The WebSocket session the shard points at, or null for none/another transport. */
  readonly sessionId: string | null;
}

export interface SubscriptionRequest {
  readonly type: string;
  readonly version: string;
  readonly condition: Readonly<Record<string, string>>;
}

/** Pages read from any one list before giving up as incomplete. Herald's own conduit holds seven. */
const MAX_PAGES = 10;

/**
 * App-token EventSub administration for one explicitly configured conduit. Every call names that conduit;
 * nothing here lists, changes or deletes another service's conduit or subscriptions. Twitch's error bodies
 * are never read, so a failure is a kind and an HTTP status only.
 */
export class EventSubAdmin {
  readonly #helix: HelixSession;

  constructor(helix: HelixSession) {
    this.#helix = helix;
  }

  /** Create Conduits. A 429 means the client's conduit limit is reached; nothing was created. */
  async createConduit(shardCount: number, options: CallOptions = {}): Promise<{ readonly id: string; readonly shardCount: number }> {
    const body = await this.#write({ operation: 'create conduit', method: 'POST', path: 'eventsub/conduits', json: { shard_count: shardCount } }, options);
    const parsed = ConduitsSchema.safeParse(body);
    const conduit = parsed.success ? parsed.data.data[0] : undefined;
    if (!conduit) throw new TwitchRequestError('invalid_response', 'create conduit');
    return { id: conduit.id, shardCount: conduit.shard_count };
  }

  /** Update Conduits: set the shard count of the configured conduit. */
  async setShardCount(conduitId: string, shardCount: number, options: CallOptions = {}): Promise<number> {
    EventSubIdSchema.parse(conduitId);
    const body = await this.#write({ operation: 'update conduit', method: 'PATCH', path: 'eventsub/conduits', json: { id: conduitId, shard_count: shardCount } }, options);
    const parsed = ConduitsSchema.safeParse(body);
    const conduit = parsed.success ? parsed.data.data.find(entry => entry.id === conduitId) : undefined;
    if (!conduit) throw new TwitchRequestError('invalid_response', 'update conduit');
    return conduit.shard_count;
  }

  /**
   * Get Conduit Shards for the configured conduit. A 404 (`not_found`) means it does not exist or belongs to
   * another client; callers must never fall back to some other conduit.
   */
  async getShards(conduitId: string, options: CallOptions = {}): Promise<ConduitShard[]> {
    EventSubIdSchema.parse(conduitId);
    const shards: ConduitShard[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params: Array<readonly [string, string]> = [['conduit_id', conduitId]];
      if (cursor) params.push(['after', cursor]);
      const { body } = await this.#helix.call({ operation: 'get conduit shards', path: 'eventsub/conduits/shards', params }, options);
      const parsed = ShardPageSchema.safeParse(body);
      if (!parsed.success) throw new TwitchRequestError('invalid_response', 'get conduit shards');
      shards.push(...parsed.data.data.map(toShard));
      const next = parsed.data.pagination?.cursor ?? null;
      if (!next || next === cursor) return shards;
      cursor = next;
    }
    throw new TwitchRequestError('invalid_response', 'get conduit shards');
  }

  /**
   * Update Conduit Shards: point one shard at a WebSocket session. Twitch answers 202 with per-shard
   * successes and failures; a failure is surfaced by its short code only.
   */
  async assignWebSocket(conduitId: string, shardId: string, sessionId: string, options: CallOptions = {}): Promise<ConduitShard> {
    EventSubIdSchema.parse(conduitId);
    const body = await this.#write({
      operation: 'update conduit shards', method: 'PATCH', path: 'eventsub/conduits/shards',
      json: { conduit_id: conduitId, shards: [{ id: shardId, transport: { method: 'websocket', session_id: sessionId } }] },
    }, options);
    const parsed = ShardUpdateSchema.safeParse(body);
    if (!parsed.success) throw new TwitchRequestError('invalid_response', 'update conduit shards');
    const failure = parsed.data.errors?.find(entry => entry.id === shardId);
    if (failure) throw new ShardAssignmentError(CodeSchema.safeParse(failure.code).success ? failure.code! : 'unknown');
    const shard = parsed.data.data?.find(entry => entry.id === shardId);
    if (!shard) throw new TwitchRequestError('invalid_response', 'update conduit shards');
    return toShard(shard);
  }

  /** Get EventSub Subscriptions filtered to the configured conduit; never the client's whole list. */
  async listConduitSubscriptions(conduitId: string, options: CallOptions = {}): Promise<EventSubSubscription[]> {
    EventSubIdSchema.parse(conduitId);
    const subscriptions: EventSubSubscription[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params: Array<readonly [string, string]> = [['conduit_id', conduitId]];
      if (cursor) params.push(['after', cursor]);
      const { body } = await this.#helix.call({ operation: 'get eventsub subscriptions', path: 'eventsub/subscriptions', params }, options);
      const parsed = SubscriptionPageSchema.safeParse(body);
      if (!parsed.success) throw new TwitchRequestError('invalid_response', 'get eventsub subscriptions');
      // The filter is Twitch's; checking the transport again keeps a misbehaving answer from widening scope.
      subscriptions.push(...parsed.data.data.map(toSubscription).filter(entry => entry.conduitId === conduitId));
      const next = parsed.data.pagination?.cursor ?? null;
      if (!next || next === cursor) return subscriptions;
      cursor = next;
    }
    throw new TwitchRequestError('invalid_response', 'get eventsub subscriptions');
  }

  /**
   * Create EventSub Subscription on the configured conduit. 409 (`conflict`) means an identical one exists
   * somewhere for this client: the caller must confirm it is on this conduit before accepting it. 403
   * (`forbidden`) means a required grant is missing; 429 (`limit_reached`) a subscription limit.
   */
  async createSubscription(conduitId: string, request: SubscriptionRequest, options: CallOptions = {}): Promise<EventSubSubscription> {
    EventSubIdSchema.parse(conduitId);
    const body = await this.#write({
      operation: `create ${request.type} subscription`, method: 'POST', path: 'eventsub/subscriptions',
      json: { type: request.type, version: request.version, condition: request.condition, transport: { method: 'conduit', conduit_id: conduitId } },
    }, options);
    const parsed = z.object({ data: z.array(SubscriptionWireSchema).min(1).max(1) }).safeParse(body);
    if (!parsed.success) throw new TwitchRequestError('invalid_response', `create ${request.type} subscription`);
    return toSubscription(parsed.data.data[0]!);
  }

  /** Delete EventSub Subscription. Callers pass only IDs they listed on their own conduit. */
  async deleteSubscription(subscriptionId: string, options: CallOptions = {}): Promise<void> {
    EventSubIdSchema.parse(subscriptionId);
    await this.#write({ operation: 'delete eventsub subscription', method: 'DELETE', path: 'eventsub/subscriptions', params: [['id', subscriptionId]] }, options);
  }

  async #write(call: Parameters<HelixSession['call']>[0], options: CallOptions): Promise<unknown> {
    try {
      return (await this.#helix.call({ ...call, retryRateLimit: false }, options)).body;
    } catch (error) {
      // On these writes Twitch's 429 reports a conduit or subscription limit, not request pacing.
      if (isTwitchFailure(error, 'rate_limited')) throw new TwitchRequestError('limit_reached', call.operation, 429);
      throw error;
    }
  }
}

/** A shard Twitch refused to update, by its short code (`websocket_session_not_connected`, …). */
export class ShardAssignmentError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`update conduit shards: the shard was not updated (${code})`);
    this.name = 'ShardAssignmentError';
    this.code = code;
  }
}

function toSubscription(wire: z.infer<typeof SubscriptionWireSchema>): EventSubSubscription {
  return {
    id: wire.id, status: wire.status, type: wire.type, version: wire.version, condition: { ...wire.condition },
    conduitId: wire.transport.method === 'conduit' ? wire.transport.conduit_id ?? null : null,
  };
}

function toShard(wire: z.infer<typeof ShardWireSchema>): ConduitShard {
  return { id: wire.id, status: wire.status, sessionId: wire.transport?.method === 'websocket' ? wire.transport.session_id ?? null : null };
}

/** Whether a listed subscription is exactly the requested one: same type, version and condition. */
export function matchesRequest(subscription: EventSubSubscription, request: SubscriptionRequest): boolean {
  if (subscription.type !== request.type || subscription.version !== request.version) return false;
  const want = Object.entries(request.condition);
  const have = Object.entries(subscription.condition).filter(([, value]) => value !== '');
  return want.length === have.length && want.every(([key, value]) => subscription.condition[key] === value);
}
