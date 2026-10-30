import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SourceFrame, SourceHealth, SourceListener } from './source';

/** Herald's reserved local port (Spec 03 R1). */
export const HERALD_PORT = 5194;
export const STREAM_PATH = '/presence-data/stream';
/** Local operator health. Deliberately outside `/presence-data`, which main's preview proxy forwards. */
export const HEALTH_PATH = '/health';

/** What the server needs from a source: the live `PresenceSource` or a source that is not running yet. */
export interface SourceHost {
  readonly current: SourceFrame | null;
  subscribe(listener: SourceListener): () => void;
  /** A running live source adds observed stream/Chatters state and delivery health (shard, coverage, redacted counters). */
  health(): SourceHealth | UnstartedHealth | (SourceHealth & { readonly observed?: unknown; readonly delivery?: unknown });
}

/** Health of a source that could not start (no kingdom resolved, no authority): reasons, never details. */
export interface UnstartedHealth {
  readonly origin: 'live' | 'simulated';
  readonly condition: 'configured' | 'unauthorized' | 'stopped';
  readonly available: false;
  readonly reason: string;
  readonly missing: readonly string[];
}

export interface PresenceServerOptions {
  readonly host: () => SourceHost;
  readonly port?: number;
  readonly maxClients?: number;
  /** A subscriber whose socket stays backed up this long is disconnected; it reconnects to a fresh snapshot. */
  readonly stallMs?: number;
  readonly keepaliveMs?: number;
}

export interface PresenceServer {
  readonly port: number;
  readonly clients: number;
  readonly counters: Readonly<ServerCounters>;
  close(): Promise<void>;
}

export interface ServerCounters {
  connected: number;
  refused: number;
  stalledDisconnects: number;
  coalescedFrames: number;
}

const DEFAULT_MAX_CLIENTS = 32;
const DEFAULT_STALL_MS = 10_000;
const DEFAULT_KEEPALIVE_MS = 15_000;
const RETRY_MS = 2_000;

/**
 * The single public presence endpoint, bound to loopback only. Each event is exactly one validated
 * `KingdomPresenceFrame`. A subscriber holds at most one unsent frame: while its socket is backed up, newer
 * frames replace the pending one, so a slow client can never queue history or delay another client.
 */
export async function startPresenceServer(options: PresenceServerOptions): Promise<PresenceServer> {
  const maxClients = options.maxClients ?? DEFAULT_MAX_CLIENTS;
  const stallMs = options.stallMs ?? DEFAULT_STALL_MS;
  const keepaliveMs = options.keepaliveMs ?? DEFAULT_KEEPALIVE_MS;
  const counters: ServerCounters = { connected: 0, refused: 0, stalledDisconnects: 0, coalescedFrames: 0 };
  const clients = new Set<Subscriber>();

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(response, 405, { error: 'method_not_allowed' });
    if (url.pathname === HEALTH_PATH) {
      return plain(response, 200, { service: 'herald', subscribers: clients.size, server: counters, source: options.host().health() });
    }
    if (url.pathname !== STREAM_PATH) return plain(response, 404, { error: 'not_found' });
    if (request.method !== 'GET') return plain(response, 405, { error: 'method_not_allowed' });
    const host = options.host();
    const current = host.current;
    if (!current) {
      counters.refused++;
      return plain(response, 503, { available: false });
    }
    if (clients.size >= maxClients) {
      counters.refused++;
      return plain(response, 503, { available: true, error: 'busy' });
    }
    const subscriber = new Subscriber(request, response, { stallMs, keepaliveMs, counters, onEnd: () => clients.delete(subscriber) });
    clients.add(subscriber);
    counters.connected++;
    subscriber.unsubscribe = host.subscribe(subscriber);
    subscriber.frame(current);
  });
  server.on('clientError', (_error, socket) => socket.destroy());

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? HERALD_PORT, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    port: (server.address() as AddressInfo).port,
    get clients() {
      return clients.size;
    },
    counters,
    close: () => new Promise<void>(resolve => {
      for (const client of [...clients]) client.end();
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

export interface SubscriberOptions {
  readonly stallMs: number;
  readonly keepaliveMs: number;
  readonly counters: ServerCounters;
  readonly onEnd: () => void;
}

/** One SSE subscriber: at most one unsent frame, disconnected if its socket stays backed up. Exported for tests. */
export class Subscriber implements SourceListener {
  unsubscribe: (() => void) | null = null;
  readonly #response: ServerResponse;
  readonly #options: SubscriberOptions;
  #pending: SourceFrame | null = null;
  #lastSent = -1;
  #lastEpoch = '';
  #blocked = false;
  #stallTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #keepalive: ReturnType<typeof setInterval>;
  #ended = false;

  constructor(request: { on(event: 'error', listener: () => void): unknown }, response: ServerResponse, options: SubscriberOptions) {
    this.#response = response;
    this.#options = options;
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
      'x-content-type-options': 'nosniff',
    });
    response.write(`retry: ${RETRY_MS}\n\n`);
    response.on('drain', () => this.#drained());
    response.on('close', () => this.end());
    request.on('error', () => this.end());
    this.#keepalive = setInterval(() => {
      if (!this.#blocked) this.#write(': keepalive\n\n');
    }, options.keepaliveMs);
    this.#keepalive.unref?.();
  }

  frame(frame: SourceFrame): void {
    if (this.#ended) return;
    const { epoch, sequence } = frame.frame;
    if (epoch === this.#lastEpoch && sequence <= this.#lastSent) return;
    const pending = this.#pending?.frame;
    if (pending && pending.epoch === epoch && sequence <= pending.sequence) return;
    if (this.#blocked) {
      if (this.#pending) this.#options.counters.coalescedFrames++;
      this.#pending = frame;
      return;
    }
    this.#send(frame);
  }

  unavailable(): void {
    this.end();
  }

  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    clearInterval(this.#keepalive);
    if (this.#stallTimer) clearTimeout(this.#stallTimer);
    this.#pending = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.#options.onEnd();
    if (!this.#response.destroyed) this.#response.end();
  }

  #send(frame: SourceFrame): void {
    this.#lastEpoch = frame.frame.epoch;
    this.#lastSent = frame.frame.sequence;
    this.#write(`data: ${frame.data}\n\n`);
  }

  #write(chunk: string): void {
    if (this.#ended || this.#response.destroyed) return;
    if (this.#response.write(chunk)) return;
    this.#blocked = true;
    this.#stallTimer ??= setTimeout(() => {
      this.#options.counters.stalledDisconnects++;
      this.#response.destroy();
      this.end();
    }, this.#options.stallMs);
  }

  #drained(): void {
    this.#blocked = false;
    if (this.#stallTimer) clearTimeout(this.#stallTimer);
    this.#stallTimer = null;
    const pending = this.#pending;
    this.#pending = null;
    if (pending) this.#send(pending);
  }
}

function plain(response: ServerResponse, status: number, body: unknown): void {
  const text = `${JSON.stringify(body)}\n`;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  response.end(text);
}
