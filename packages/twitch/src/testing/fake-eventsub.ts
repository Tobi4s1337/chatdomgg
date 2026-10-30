import type { EventSubSocketLike, SocketFactory } from '../eventsub/shard';
import type { FakeRequest, FakeTwitch } from './fake-twitch';

/**
 * A SIMULATED EventSub service for tests: conduits, shards, conduit subscriptions with Twitch's grant rules,
 * and an owned in-process WebSocket edge with welcome, keepalive, controlled reconnect, revocation and
 * drops. Nothing here talks to Twitch; every ID it mints says `simulated`. Chat bodies it sends are
 * synthetic and exist so tests can prove they never travel further.
 */
export const FAKE_EVENTSUB_URL = 'ws://127.0.0.1:1/ws';

const CHAT_TYPES = new Set(['channel.chat.message', 'channel.chat.message_delete', 'channel.chat.clear', 'channel.chat.clear_user_messages']);

export interface FakeSubscription {
  readonly id: string;
  status: string;
  readonly type: string;
  readonly version: string;
  readonly condition: Readonly<Record<string, string>>;
  readonly transport: { readonly method: 'conduit'; readonly conduit_id: string } | { readonly method: 'webhook'; readonly callback: string };
}

interface FakeShard {
  readonly id: string;
  status: string;
  sessionId: string | null;
}

type Listener = (event: never) => void;

/** One client-side socket as the code under test sees it. */
export class FakeSocket implements EventSubSocketLike {
  readonly url: string;
  sessionId: string | null = null;
  closed = false;
  closeCode: number | null = null;
  /** While true the edge sends no automatic keepalives (a silent, dead link). */
  silent = false;
  readonly #listeners = new Map<string, Listener[]>();
  readonly #hub: FakeEventSub;
  keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(url: string, hub: FakeEventSub) {
    this.url = url;
    this.#hub = hub;
  }

  addEventListener(type: string, listener: Listener): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  close(code = 1000): void {
    if (this.closed) return;
    this.#hub.closed(this, code);
  }

  emit(type: 'message' | 'close' | 'error', event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) (listener as (event: unknown) => void)(event);
  }
}

export interface FakeEventSubOptions {
  /** Seconds between automatic keepalives on each welcomed socket. */
  readonly keepaliveSeconds?: number;
  /** Welcome new sockets automatically (after a microtask). */
  readonly autoWelcome?: boolean;
  readonly conduitLimit?: number;
}

export class FakeEventSub {
  readonly twitch: FakeTwitch;
  readonly conduits = new Map<string, FakeShard[]>();
  readonly subscriptions: FakeSubscription[] = [];
  readonly sockets: FakeSocket[] = [];
  /** Deliveries Twitch dropped because no enabled shard was attached. */
  dropped = 0;
  keepaliveSeconds: number;
  autoWelcome: boolean;
  conduitLimit: number;
  #serial = 0;

  constructor(twitch: FakeTwitch, options: FakeEventSubOptions = {}) {
    this.twitch = twitch;
    this.keepaliveSeconds = options.keepaliveSeconds ?? 10;
    this.autoWelcome = options.autoWelcome ?? true;
    this.conduitLimit = options.conduitLimit ?? 5;
    twitch.extension = request => this.#route(request);
  }

  readonly socketFactory: SocketFactory = url => {
    const socket = new FakeSocket(url, this);
    this.sockets.push(socket);
    if (this.autoWelcome) queueMicrotask(() => this.welcome(socket));
    return socket;
  };

  get openSockets(): FakeSocket[] {
    return this.sockets.filter(socket => !socket.closed);
  }

  /** A conduit owned by this client, created outside the code under test (an existing configured one). */
  addConduit(shardCount = 1): string {
    const id = `simulated-conduit-${++this.#serial}`;
    this.conduits.set(id, Array.from({ length: shardCount }, (_, index) => ({ id: String(index), status: 'websocket_disconnected', sessionId: null })));
    return id;
  }

  /** A subscription belonging to some other service on this client (the Surveyor's webhook, say). */
  addForeignSubscription(type: string, condition: Record<string, string>): FakeSubscription {
    const subscription: FakeSubscription = { id: `simulated-foreign-${++this.#serial}`, status: 'enabled', type, version: '1', condition, transport: { method: 'webhook', callback: 'https://surveyor.simulated.invalid/eventsub' } };
    this.subscriptions.push(subscription);
    return subscription;
  }

  shard(conduitId: string, shardId = '0'): FakeShard | undefined {
    return this.conduits.get(conduitId)?.find(shard => shard.id === shardId);
  }

  welcome(socket: FakeSocket): void {
    if (socket.closed || socket.sessionId) return;
    socket.sessionId = `simulated-session-${++this.#serial}`;
    this.#send(socket, 'session_welcome', { session: { id: socket.sessionId, status: 'connected', connected_at: this.#time(), keepalive_timeout_seconds: this.keepaliveSeconds, reconnect_url: null } });
    socket.keepaliveTimer = setInterval(() => {
      if (!socket.silent && !socket.closed) this.#send(socket, 'session_keepalive', {});
    }, this.keepaliveSeconds * 1000);
  }

  /** Twitch's controlled reconnect: the edge asks the client to move to a new URL. */
  reconnect(socket: FakeSocket, url = `${FAKE_EVENTSUB_URL}?reconnect=${++this.#serial}`): void {
    this.#send(socket, 'session_reconnect', { session: { id: socket.sessionId, status: 'reconnecting', keepalive_timeout_seconds: null, reconnect_url: url, connected_at: this.#time() } });
  }

  /** The edge drops the connection (ordinary loss). */
  drop(socket: FakeSocket, code = 4006): void {
    this.closed(socket, code);
  }

  sendRaw(socket: FakeSocket, data: unknown): void {
    socket.emit('message', { data });
  }

  /** Sends one frame with chosen metadata/payload on a socket, bypassing routing. */
  sendFrame(socket: FakeSocket, messageType: string, payload: unknown, meta: { readonly messageId?: string; readonly timestamp?: string } = {}): string {
    return this.#send(socket, messageType, payload, meta);
  }

  /**
   * Twitch delivers one event to every enabled conduit subscription of that type for this broadcaster,
   * through the conduit's enabled shard. Returns the delivery IDs used.
   */
  deliver(type: string, event: Record<string, unknown>, meta: { readonly messageId?: string; readonly timestamp?: string } = {}): string[] {
    const ids: string[] = [];
    for (const subscription of this.subscriptions) {
      if (subscription.type !== type || subscription.status !== 'enabled' || subscription.transport.method !== 'conduit') continue;
      const broadcaster = subscription.condition.broadcaster_user_id;
      if (broadcaster && event.broadcaster_user_id !== broadcaster) continue;
      const socket = this.#shardSocket(subscription.transport.conduit_id);
      if (!socket) {
        this.dropped++;
        continue;
      }
      ids.push(this.#send(socket, 'notification', { subscription: this.#wire(subscription), event }, { ...meta, type }));
    }
    return ids;
  }

  /** Repeats an earlier delivery with the same delivery ID, as Twitch may after a reconnect. */
  redeliver(type: string, event: Record<string, unknown>, messageId: string): void {
    this.deliver(type, event, { messageId });
  }

  /**
   * The person withdraws this client's authorization: Twitch disables the subscriptions that relied on
   * them (sending revocations) and notifies `user.authorization.revoke` subscribers.
   */
  revokeAuthorization(userId: string, login = 'simulated_user'): void {
    this.twitch.revokeGrant(userId);
    for (const subscription of this.subscriptions) {
      if (subscription.status !== 'enabled' || !CHAT_TYPES.has(subscription.type)) continue;
      if (subscription.condition.broadcaster_user_id !== userId && subscription.condition.user_id !== userId) continue;
      subscription.status = 'authorization_revoked';
      const socket = subscription.transport.method === 'conduit' ? this.#shardSocket(subscription.transport.conduit_id) : null;
      if (socket) this.#send(socket, 'revocation', { subscription: this.#wire(subscription) }, { type: subscription.type });
    }
    this.deliver('user.authorization.revoke', { client_id: this.twitch.clientId, user_id: userId, user_login: login, user_name: login });
  }

  /** Called by a socket closing from either side. */
  closed(socket: FakeSocket, code: number): void {
    if (socket.closed) return;
    socket.closed = true;
    socket.closeCode = code;
    if (socket.keepaliveTimer) clearInterval(socket.keepaliveTimer);
    for (const shards of this.conduits.values()) {
      for (const shard of shards) if (shard.sessionId !== null && shard.sessionId === socket.sessionId) shard.status = 'websocket_disconnected';
    }
    queueMicrotask(() => socket.emit('close', { code }));
  }

  #shardSocket(conduitId: string): FakeSocket | null {
    const shard = this.shard(conduitId);
    if (!shard || shard.status !== 'enabled') return null;
    return this.openSockets.find(socket => socket.sessionId === shard.sessionId) ?? null;
  }

  #send(socket: FakeSocket, messageType: string, payload: unknown, meta: { readonly messageId?: string; readonly timestamp?: string; readonly type?: string } = {}): string {
    const messageId = meta.messageId ?? `simulated-delivery-${++this.#serial}`;
    if (socket.closed) return messageId;
    const metadata: Record<string, string> = { message_id: messageId, message_type: messageType, message_timestamp: meta.timestamp ?? this.#time() };
    if (meta.type) Object.assign(metadata, { subscription_type: meta.type, subscription_version: '1' });
    socket.emit('message', { data: JSON.stringify({ metadata, payload }) });
    return messageId;
  }

  #time(): string {
    return new Date(Date.now()).toISOString().replace('Z', '123456Z');
  }

  #wire(subscription: FakeSubscription): Record<string, unknown> {
    return { id: subscription.id, status: subscription.status, type: subscription.type, version: subscription.version, condition: subscription.condition, transport: subscription.transport, created_at: this.#time(), cost: 0 };
  }

  #route(request: FakeRequest): Response | null {
    const { method, route } = request;
    const key = `${method} ${route}`;
    const known = [
      'POST api.twitch.tv/helix/eventsub/conduits', 'PATCH api.twitch.tv/helix/eventsub/conduits', 'GET api.twitch.tv/helix/eventsub/conduits',
      'GET api.twitch.tv/helix/eventsub/conduits/shards', 'PATCH api.twitch.tv/helix/eventsub/conduits/shards',
      'GET api.twitch.tv/helix/eventsub/subscriptions', 'POST api.twitch.tv/helix/eventsub/subscriptions', 'DELETE api.twitch.tv/helix/eventsub/subscriptions',
    ];
    if (!known.includes(key)) return null;
    if (!this.twitch.isAppRequest(request.headers)) return this.twitch.respond(method, route, 401, { status: 401, message: 'app access token required' });
    const body = request.body ? JSON.parse(request.body) as Record<string, unknown> : {};
    const query = request.url.searchParams;
    switch (key) {
      case 'GET api.twitch.tv/helix/eventsub/conduits':
        return this.twitch.respond(method, route, 200, { data: [...this.conduits].map(([id, shards]) => ({ id, shard_count: shards.length })) });
      case 'POST api.twitch.tv/helix/eventsub/conduits': {
        if (this.conduits.size >= this.conduitLimit) return this.twitch.respond(method, route, 429, { status: 429, message: 'conduit limit reached' }, { 'ratelimit-remaining': '700' });
        const id = this.addConduit(Number(body.shard_count));
        return this.twitch.respond(method, route, 200, { data: [{ id, shard_count: Number(body.shard_count) }] });
      }
      case 'PATCH api.twitch.tv/helix/eventsub/conduits': {
        const shards = this.conduits.get(String(body.id));
        if (!shards) return this.twitch.respond(method, route, 404, { status: 404, message: 'conduit not found' });
        const count = Number(body.shard_count);
        while (shards.length > count) shards.pop();
        while (shards.length < count) shards.push({ id: String(shards.length), status: 'websocket_disconnected', sessionId: null });
        return this.twitch.respond(method, route, 200, { data: [{ id: body.id, shard_count: count }] });
      }
      case 'GET api.twitch.tv/helix/eventsub/conduits/shards': {
        const shards = this.conduits.get(query.get('conduit_id') ?? '');
        if (!shards) return this.twitch.respond(method, route, 404, { status: 404, message: 'conduit not found' });
        // Like Twitch, only shards that have ever had a transport are listed.
        return this.twitch.respond(method, route, 200, { data: shards.filter(shard => shard.sessionId !== null).map(shard => this.#shardWire(shard)), pagination: {} });
      }
      case 'PATCH api.twitch.tv/helix/eventsub/conduits/shards': {
        const shards = this.conduits.get(String(body.conduit_id));
        if (!shards) return this.twitch.respond(method, route, 404, { status: 404, message: 'conduit not found' });
        const data: unknown[] = [];
        const errors: unknown[] = [];
        for (const update of body.shards as Array<{ id: string; transport: { session_id: string } }>) {
          const shard = shards.find(entry => entry.id === update.id);
          const socket = this.openSockets.find(entry => entry.sessionId === update.transport.session_id);
          if (!shard) errors.push({ id: update.id, message: "The shard id is outside the conduit's range", code: 'invalid_parameter' });
          else if (!socket) errors.push({ id: update.id, message: 'The websocket session is not connected', code: 'websocket_session_not_connected' });
          else {
            shard.sessionId = update.transport.session_id;
            shard.status = 'enabled';
            data.push(this.#shardWire(shard));
          }
        }
        return this.twitch.respond(method, route, 202, { data, errors });
      }
      case 'GET api.twitch.tv/helix/eventsub/subscriptions': {
        const filters = ['status', 'type', 'user_id', 'subscription_id', 'conduit_id'].filter(name => query.has(name));
        if (filters.length > 1) return this.twitch.respond(method, route, 400, { status: 400, message: 'only one filter' });
        const conduitId = query.get('conduit_id');
        const data = this.subscriptions
          .filter(subscription => conduitId === null || (subscription.transport.method === 'conduit' && subscription.transport.conduit_id === conduitId))
          .map(subscription => this.#wire(subscription));
        return this.twitch.respond(method, route, 200, { data, total: data.length, total_cost: 0, max_total_cost: 10_000, pagination: {} });
      }
      case 'POST api.twitch.tv/helix/eventsub/subscriptions': {
        const transport = body.transport as { method: string; conduit_id: string };
        const condition = body.condition as Record<string, string>;
        if (transport.method !== 'conduit' || !this.conduits.has(transport.conduit_id)) return this.twitch.respond(method, route, 400, { status: 400, message: 'bad transport' });
        if (!this.#authorized(String(body.type), condition)) return this.twitch.respond(method, route, 403, { status: 403, message: 'subscription missing proper authorization' });
        const same = this.subscriptions.find(entry => entry.status === 'enabled' && entry.type === body.type && entry.version === body.version && JSON.stringify(entry.condition) === JSON.stringify(condition));
        if (same) return this.twitch.respond(method, route, 409, { status: 409, message: 'subscription already exists', id: same.id });
        const subscription: FakeSubscription = { id: `simulated-subscription-${++this.#serial}`, status: 'enabled', type: String(body.type), version: String(body.version), condition, transport: { method: 'conduit', conduit_id: transport.conduit_id } };
        this.subscriptions.push(subscription);
        return this.twitch.respond(method, route, 202, { data: [this.#wire(subscription)], total: this.subscriptions.length, total_cost: 0, max_total_cost: 10_000 });
      }
      case 'DELETE api.twitch.tv/helix/eventsub/subscriptions': {
        const index = this.subscriptions.findIndex(entry => entry.id === query.get('id'));
        if (index < 0) return this.twitch.respond(method, route, 404, { status: 404, message: 'not found' });
        this.subscriptions.splice(index, 1);
        return this.twitch.respond(method, route, 204, null);
      }
    }
    return null;
  }

  #authorized(type: string, condition: Readonly<Record<string, string>>): boolean {
    const has = (userId: string | undefined, scopes: readonly string[]) => userId !== undefined && scopes.every(scope => this.twitch.grants.get(userId)?.has(scope));
    if (CHAT_TYPES.has(type)) return has(condition.user_id, ['user:read:chat', 'user:bot']) && has(condition.broadcaster_user_id, ['channel:bot']);
    if (type === 'user.authorization.revoke') return condition.client_id === this.twitch.clientId;
    return true;
  }

  #shardWire(shard: FakeShard): Record<string, unknown> {
    return { id: shard.id, status: shard.status, transport: { method: 'websocket', ...(shard.sessionId ? { session_id: shard.sessionId, connected_at: this.#time() } : {}) } };
  }
}
