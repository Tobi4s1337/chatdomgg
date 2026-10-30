import { isTwitchFailure } from '../errors';
import type { CallOptions } from '../helix';
import { ShardAssignmentError, type ConduitShard, type EventSubAdmin } from './admin';
import { parseFrame, type EventSubFrame } from './frames';

export const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';

/** The few WebSocket members used. Node's global `WebSocket` fits; tests pass an owned local fake. */
export interface EventSubSocketLike {
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event: { readonly code: number }) => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  close(code?: number, reason?: string): void;
}
export type SocketFactory = (url: string) => EventSubSocketLike;

export const defaultSocketFactory: SocketFactory = url => new WebSocket(url) as unknown as EventSubSocketLike;

export type ShardState = 'idle' | 'connecting' | 'attaching' | 'attached' | 'backoff' | 'stopped' | 'failed';
export type AttachReason = 'fresh' | 'repair' | 'handover';
export type DeliveryFrame = Extract<EventSubFrame, { kind: 'notification' | 'revocation' }>;

export interface ShardListener {
  /** The shard points at an open, welcomed session and Twitch reports it enabled. */
  attached(reason: AttachReason, gap: { readonly from: number; readonly to: number } | null): void;
  /** Delivery stopped. Events from now until the next `attached` are lost; Twitch does not replay them. */
  detached(reason: string): void;
  frame(frame: DeliveryFrame): void;
  /** The configured conduit is gone or not this client's. Nothing is retried; an operator must provision. */
  fatal(reason: 'conduit_missing'): void;
}

export interface ShardConnectionOptions {
  readonly admin: Pick<EventSubAdmin, 'assignWebSocket'>;
  readonly conduitId: string;
  readonly shardId?: string;
  readonly listener: ShardListener;
  readonly socketFactory?: SocketFactory;
  readonly url?: string;
  readonly now?: () => number;
  readonly random?: () => number;
  /** Twitch closes a session not assigned to a shard within ten seconds of its welcome. */
  readonly attachDeadlineMs?: number;
  /** A new socket that sends no welcome within this is abandoned. */
  readonly welcomeTimeoutMs?: number;
  /** Added to the session's keepalive interval before the link counts as lost. */
  readonly keepaliveGraceMs?: number;
  readonly backoffMinMs?: number;
  readonly backoffMaxMs?: number;
}

export interface ShardHealth {
  readonly state: ShardState;
  readonly attached: boolean;
  readonly sockets: number;
  readonly attempt: number;
  readonly lastFrameAt: number | null;
  readonly lostSince: number | null;
  readonly lastDetachReason: string | null;
  readonly counters: Readonly<ShardCounters>;
}

export interface ShardCounters {
  sessions: number;
  attaches: number;
  handovers: number;
  repairs: number;
  losses: number;
  malformedFrames: number;
  ignoredFrames: number;
}

interface Connection {
  readonly socket: EventSubSocketLike;
  sessionId: string | null;
  welcomedAt: number;
  keepaliveMs: number;
  closed: boolean;
}

/**
 * One outgoing WebSocket shard of an app-token conduit. It connects, assigns the welcomed session to the
 * shard within the deadline, watches keepalives, follows Twitch's controlled reconnect (the old socket keeps
 * delivering until the new one is welcomed; at most two sockets at once; if the old one leaves first, the time
 * until the new one is attached is a reported gap) and repairs ordinary loss with a
 * fresh session after a bounded, jittered backoff (1–60 s). It never sends on the socket and never creates
 * subscriptions: conduit subscriptions outlive sessions.
 */
export class ConduitShardConnection {
  readonly conduitId: string;
  readonly shardId: string;
  readonly #admin: Pick<EventSubAdmin, 'assignWebSocket'>;
  readonly #listener: ShardListener;
  readonly #factory: SocketFactory;
  readonly #url: string;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #attachDeadlineMs: number;
  readonly #welcomeTimeoutMs: number;
  readonly #graceMs: number;
  readonly #backoffMin: number;
  readonly #backoffMax: number;
  readonly #counters: ShardCounters = { sessions: 0, attaches: 0, handovers: 0, repairs: 0, losses: 0, malformedFrames: 0, ignoredFrames: 0 };
  #current: Connection | null = null;
  #next: Connection | null = null;
  #state: ShardState = 'idle';
  #attached = false;
  #attempt = 0;
  #lostSince: number | null = null;
  #lastFrameAt: number | null = null;
  #lastDetach: string | null = null;
  #watchdog: ReturnType<typeof setTimeout> | null = null;
  #welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  #handoverTimer: ReturnType<typeof setTimeout> | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #attachAbort: AbortController | null = null;
  #stopped = false;

  constructor(options: ShardConnectionOptions) {
    this.conduitId = options.conduitId;
    this.shardId = options.shardId ?? '0';
    this.#admin = options.admin;
    this.#listener = options.listener;
    this.#factory = options.socketFactory ?? defaultSocketFactory;
    this.#url = options.url ?? EVENTSUB_WS_URL;
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? Math.random;
    this.#attachDeadlineMs = options.attachDeadlineMs ?? 10_000;
    this.#welcomeTimeoutMs = options.welcomeTimeoutMs ?? 15_000;
    this.#graceMs = options.keepaliveGraceMs ?? 3_000;
    this.#backoffMin = options.backoffMinMs ?? 1_000;
    this.#backoffMax = options.backoffMaxMs ?? 60_000;
  }

  get attached(): boolean {
    return this.#attached;
  }

  /** The session the shard should point at while attached; for verification against Get Conduit Shards. */
  get sessionId(): string | null {
    return this.#attached ? this.#current?.sessionId ?? null : null;
  }

  health(): ShardHealth {
    return {
      state: this.#state, attached: this.#attached, sockets: [this.#current, this.#next].filter(Boolean).length,
      attempt: this.#attempt, lastFrameAt: this.#lastFrameAt, lostSince: this.#lostSince, lastDetachReason: this.#lastDetach,
      counters: { ...this.#counters },
    };
  }

  start(): void {
    if (this.#stopped || this.#state !== 'idle') return;
    this.#connectFresh();
  }

  /**
   * Called when an outside check (Get Conduit Shards) finds the shard disabled or pointing elsewhere while
   * this side believes it is attached. Treated as ordinary loss: a fresh session is attached.
   */
  repair(reason: string): void {
    if (this.#stopped || !this.#attached) return;
    this.#lose(reason);
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#attached = false;
    this.#teardown();
    this.#state = 'stopped';
  }

  #connectFresh(): void {
    if (this.#stopped) return;
    this.#state = 'connecting';
    const connection = this.#open(this.#url);
    if (!connection) return;
    this.#current = connection;
    this.#welcomeTimer = setTimeout(() => {
      this.#welcomeTimer = null;
      if (this.#current === connection && connection.sessionId === null) this.#lose('welcome_timeout');
    }, this.#welcomeTimeoutMs);
  }

  #open(url: string): Connection | null {
    let socket: EventSubSocketLike;
    try {
      socket = this.#factory(url);
    } catch {
      this.#lose('connect_failed');
      return null;
    }
    const connection: Connection = { socket, sessionId: null, welcomedAt: 0, keepaliveMs: 10_000, closed: false };
    this.#counters.sessions++;
    socket.addEventListener('message', event => this.#onMessage(connection, event.data));
    socket.addEventListener('close', event => this.#onClose(connection, event.code));
    socket.addEventListener('error', () => this.#close(connection));
    return connection;
  }

  #onMessage(connection: Connection, data: unknown): void {
    if (this.#stopped || connection.closed || (connection !== this.#current && connection !== this.#next)) return;
    const frame = typeof data === 'string' ? parseFrame(data) : null;
    if (!frame) {
      this.#counters.malformedFrames++;
      return;
    }
    this.#lastFrameAt = this.#now();
    if (connection === this.#current && connection.sessionId !== null) this.#armWatchdog(connection);
    switch (frame.kind) {
      case 'welcome':
        this.#onWelcome(connection, frame.sessionId, frame.keepaliveSeconds);
        return;
      case 'keepalive':
        return;
      case 'reconnect':
        this.#onReconnect(connection, frame.reconnectUrl);
        return;
      case 'notification':
      case 'revocation':
        if (connection.sessionId === null) {
          this.#counters.ignoredFrames++;
          return;
        }
        this.#listener.frame(frame);
    }
  }

  #onWelcome(connection: Connection, sessionId: string, keepaliveSeconds: number): void {
    if (connection.sessionId !== null) {
      this.#counters.ignoredFrames++;
      return;
    }
    connection.sessionId = sessionId;
    connection.welcomedAt = this.#now();
    connection.keepaliveMs = keepaliveSeconds * 1000;
    if (connection === this.#next) {
      // Controlled handover: the new session is welcomed, so the old one may go.
      if (this.#handoverTimer) clearTimeout(this.#handoverTimer);
      this.#handoverTimer = null;
      const previous = this.#current;
      this.#current = connection;
      this.#next = null;
      if (previous) this.#close(previous);
      this.#counters.handovers++;
      this.#armWatchdog(connection);
      void this.#attach(connection, 'handover');
      return;
    }
    if (this.#welcomeTimer) clearTimeout(this.#welcomeTimer);
    this.#welcomeTimer = null;
    this.#armWatchdog(connection);
    void this.#attach(connection, this.#lostSince === null ? 'fresh' : 'repair');
  }

  #onReconnect(connection: Connection, reconnectUrl: string): void {
    if (connection !== this.#current || this.#next || !this.#trustedReconnect(reconnectUrl)) {
      this.#counters.ignoredFrames++;
      return;
    }
    const next = this.#open(reconnectUrl);
    if (!next) return;
    this.#next = next;
    this.#handoverTimer = setTimeout(() => {
      this.#handoverTimer = null;
      if (this.#next !== next) return;
      // The new edge never welcomed us. Drop it; if the old one also goes, that is ordinary loss.
      this.#next = null;
      this.#close(next);
      if (!this.#current) this.#lose('handover_failed');
    }, this.#welcomeTimeoutMs);
  }

  /** Reconnect URLs come from Twitch; only the same scheme and host as the configured endpoint are followed. */
  #trustedReconnect(raw: string): boolean {
    try {
      const url = new URL(raw);
      const base = new URL(this.#url);
      return url.protocol === base.protocol && url.hostname === base.hostname && (url.protocol === 'wss:' || url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    } catch {
      return false;
    }
  }

  async #attach(connection: Connection, reason: AttachReason): Promise<void> {
    if (this.#stopped || connection.sessionId === null) return;
    if (!this.#attached) this.#state = 'attaching';
    this.#attachAbort?.abort();
    const abort = new AbortController();
    this.#attachAbort = abort;
    const options: CallOptions = { deadline: connection.welcomedAt + this.#attachDeadlineMs, signal: abort.signal };
    let shard: ConduitShard;
    try {
      shard = await this.#admin.assignWebSocket(this.conduitId, this.shardId, connection.sessionId, options);
    } catch (error) {
      if (this.#stopped || connection !== this.#current || abort.signal.aborted) return;
      if (isTwitchFailure(error, 'not_found')) return this.#fail('conduit_missing');
      this.#lose(error instanceof ShardAssignmentError ? `shard_refused:${error.code}` : isTwitchFailure(error) ? `attach_${error.kind}` : 'attach_failed');
      return;
    } finally {
      if (this.#attachAbort === abort) this.#attachAbort = null;
    }
    if (this.#stopped || connection !== this.#current) return;
    if (shard.status !== 'enabled' || shard.sessionId !== connection.sessionId) {
      this.#lose(`shard_${shard.status === 'enabled' ? 'elsewhere' : 'disabled'}`);
      return;
    }
    const wasAttached = this.#attached;
    const lostSince = this.#lostSince;
    this.#attached = true;
    this.#attempt = 0;
    this.#lostSince = null;
    this.#state = 'attached';
    this.#counters.attaches++;
    if (reason === 'repair') this.#counters.repairs++;
    if (reason === 'handover' && wasAttached) return this.#listener.attached('handover', null);
    this.#listener.attached(reason, lostSince === null ? null : { from: lostSince, to: this.#now() });
  }

  #armWatchdog(connection: Connection): void {
    if (this.#watchdog) clearTimeout(this.#watchdog);
    this.#watchdog = setTimeout(() => {
      this.#watchdog = null;
      if (this.#current === connection) this.#lose('keepalive_timeout');
    }, connection.keepaliveMs + this.#graceMs);
  }

  #onClose(connection: Connection, code: number): void {
    connection.closed = true;
    if (this.#stopped) return;
    if (connection === this.#next) {
      if (this.#handoverTimer) clearTimeout(this.#handoverTimer);
      this.#handoverTimer = null;
      this.#next = null;
      if (!this.#current) this.#lose('handover_failed');
      return;
    }
    if (connection !== this.#current) return;
    if (this.#next) {
      // The old edge left before the new one welcomed us. The new one may still take over, but nothing is
      // delivered until it is welcomed and attached: that is a gap, and the listener must stop publishing.
      if (this.#watchdog) clearTimeout(this.#watchdog);
      this.#watchdog = null;
      this.#current = null;
      if (this.#attached) {
        this.#attached = false;
        this.#lostSince ??= this.#now();
        this.#lastDetach = 'handover_gap';
        this.#counters.losses++;
        this.#state = 'connecting';
        this.#listener.detached('handover_gap');
      }
      return;
    }
    this.#lose(`closed_${code}`);
  }

  #lose(reason: string): void {
    if (this.#stopped) return;
    const wasAttached = this.#attached;
    this.#attached = false;
    // A gap is delivery we had and lost; failing to attach the first time loses nothing.
    if (wasAttached) this.#lostSince ??= this.#now();
    this.#lastDetach = reason;
    this.#counters.losses++;
    this.#teardown();
    this.#state = 'backoff';
    this.#listener.detached(reason);
    const delay = this.#backoff();
    this.#attempt++;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#connectFresh();
    }, delay);
  }

  #fail(reason: 'conduit_missing'): void {
    this.#attached = false;
    this.#lastDetach = reason;
    this.#teardown();
    this.#state = 'failed';
    this.#listener.fatal(reason);
  }

  /** Full jitter in the upper half of an exponential step, bounded to [min, max]. */
  #backoff(): number {
    const base = Math.min(this.#backoffMax, this.#backoffMin * 2 ** Math.min(this.#attempt, 16));
    const jittered = base / 2 + this.#random() * (base / 2);
    return Math.round(Math.min(this.#backoffMax, Math.max(this.#backoffMin, jittered)));
  }

  #teardown(): void {
    for (const timer of [this.#watchdog, this.#welcomeTimer, this.#handoverTimer, this.#retryTimer]) if (timer) clearTimeout(timer);
    this.#watchdog = this.#welcomeTimer = this.#handoverTimer = this.#retryTimer = null;
    this.#attachAbort?.abort();
    this.#attachAbort = null;
    if (this.#current) this.#close(this.#current);
    if (this.#next) this.#close(this.#next);
    this.#current = null;
    this.#next = null;
  }

  #close(connection: Connection): void {
    if (connection.closed) return;
    connection.closed = true;
    try {
      connection.socket.close(1000);
    } catch {
      // Already closing; nothing else to release.
    }
  }
}
