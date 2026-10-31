/**
 * The Raid Gate over HTTP: one URL, web-standard `Request` in and `Response` out, so main mounts it behind any
 * router. `POST` carries one command as JSON; `GET` with `Accept: text/event-stream` is this viewer's live gate.
 *
 * Main supplies `authenticate`, which turns its session cookie into a principal. Nothing in the body can name a
 * person, a role or a kingdom: the strict command reader refuses unknown keys. Each stream push is recomputed with
 * that subscriber's own principal, so a walker never receives the monarch's grant state or another walker's choice.
 */
import { readGateCommand, type GateContext, type GatePrincipal, type GateReply } from './contracts';
import { token } from './guard';
import type { RaidGateApplication } from './application';
import type { GateNotifier } from './ports';
import type { KingdomId } from '../../../../packages/shared/src/identity';

/** Main's session adapter. Null for no session; it never reads the request body. */
export type GateAuthenticator = (request: Request, signal: AbortSignal) => Promise<GatePrincipal | null>;

export type GateChange = Parameters<GateNotifier['changed']>[0];

/**
 * In-process change fan-out. Pass it to the application as `notifier` and to `createRaidGateHttp` as `changes`.
 * A multi-process deployment forwards `changed` from its bus to every process's fan-out; the change carries no
 * private data, only which kingdom and request moved.
 */
export interface GateFanout extends GateNotifier {
  listen(kingdomId: KingdomId, listener: (change: GateChange) => void): () => void;
}

export function createGateFanout(): GateFanout {
  const byKingdom = new Map<KingdomId, Set<(change: GateChange) => void>>();
  return {
    changed(change) {
      for (const listener of [...byKingdom.get(change.kingdomId) ?? []]) listener(change);
    },
    listen(kingdomId, listener) {
      let listeners = byKingdom.get(kingdomId);
      if (!listeners) byKingdom.set(kingdomId, listeners = new Set());
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) byKingdom.delete(kingdomId);
      };
    },
  };
}

export type RaidGateHttpOptions = Readonly<{
  application: Pick<RaidGateApplication, 'handle'>;
  changes: GateFanout;
  authenticate: GateAuthenticator;
  /** The server clock; the browser's clock is never consulted. */
  clock: () => number;
  /** The web app's own origins. A request carrying any other `Origin` is refused before authentication. */
  origins: readonly string[];
  /** Comment line that keeps idle proxies from closing a stream. */
  heartbeatMs?: number;
}>;

export interface RaidGateHttp {
  handle(request: Request): Promise<Response>;
  /** Ends every open stream, for shutdown. */
  close(): void;
}

/** A command is a few short IDs; anything larger is not one. */
export const GATE_BODY_LIMIT = 4096;
const HEARTBEAT_MS = 25_000;
const RETRY_MS = 3000;

const STATUS: Readonly<Record<string, number>> = { unauthorized: 401, invalid: 400 };

function json(reply: GateReply, status = 200): Response {
  return new Response(JSON.stringify(reply), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function refuse(code: 'unauthorized' | 'invalid' | 'unavailable', status: number): Response {
  return json({ kind: 'denied', code }, status);
}

/** Reads at most `limit` bytes of the body, or undefined when it is longer. */
async function readBody(request: Request, limit: number): Promise<string | undefined> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return undefined;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return undefined; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function createRaidGateHttp(options: RaidGateHttpOptions): RaidGateHttp {
  const { application, changes, authenticate, clock } = options;
  const origins = new Set(options.origins);
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const streams = new Set<() => void>();

  const foreign = (request: Request) => {
    const origin = request.headers.get('origin');
    return origin !== null && !origins.has(origin);
  };

  async function principalOf(request: Request): Promise<GatePrincipal | null> {
    try {
      return await authenticate(request, request.signal);
    } catch {
      return null;
    }
  }

  async function command(request: Request): Promise<Response> {
    if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return refuse('invalid', 415);
    let body: string | undefined;
    try {
      body = await readBody(request, GATE_BODY_LIMIT);
    } catch {
      return refuse('invalid', 400);
    }
    if (body === undefined) return refuse('invalid', 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return refuse('invalid', 400);
    }
    const principal = await principalOf(request);
    if (!principal) return refuse('unauthorized', 401);
    let reply: GateReply;
    try {
      reply = await application.handle({ principal, now: clock(), signal: request.signal }, parsed);
    } catch {
      // Storage or policy failure: nothing private leaves, and the browser keeps what it last knew.
      return refuse('unavailable', 503);
    }
    return json(reply, reply.kind === 'denied' ? STATUS[reply.code] ?? 200 : 200);
  }

  async function stream(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const raw = url.searchParams.get('request');
    const requestId = raw === null ? null : token(raw);
    if (requestId === undefined || [...url.searchParams.keys()].some(key => key !== 'request')) return refuse('invalid', 400);
    const principal = await principalOf(request);
    if (!principal) return refuse('unauthorized', 401);
    // The one view this stream follows: the kingdom's gate, or one request's action.
    const view = readGateCommand(requestId === null ? { op: 'gate' } : { op: 'read-action', requestId });
    if (!view) return refuse('invalid', 400);

    const encoder = new TextEncoder();
    const life = new AbortController();
    request.signal.addEventListener('abort', () => life.abort(), { once: true });
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let running = false;
    let again = false;

    const write = (text: string) => {
      if (life.signal.aborted) return;
      try { controller.enqueue(encoder.encode(text)); } catch { life.abort(); }
    };
    /** One recomputation at a time; changes that land meanwhile fold into a single follow-up. */
    const push = async () => {
      if (running) { again = true; return; }
      running = true;
      try {
        do {
          again = false;
          const context: GateContext = { principal, now: clock(), signal: life.signal };
          const reply = await application.handle(context, view).catch(() => null);
          if (life.signal.aborted) return;
          if (reply) write(`data: ${JSON.stringify(reply)}\n\n`);
          // An ended session closes the stream; the browser asks again with whatever session it has then.
          if (reply?.kind === 'denied' && reply.code === 'unauthorized') { life.abort(); return; }
        } while (again);
      } finally {
        running = false;
      }
    };

    const body = new ReadableStream<Uint8Array>({
      start(each) {
        controller = each;
        const stop = changes.listen(principal.sourceKingdomId, change => {
          if (requestId === null || change.requestId === requestId) void push();
        });
        const heartbeat = setInterval(() => write(': still here\n\n'), heartbeatMs);
        const end = () => {
          stop(); clearInterval(heartbeat); streams.delete(close);
          try { controller.close(); } catch { /* already closed by the reader */ }
        };
        const close = () => life.abort();
        streams.add(close);
        if (life.signal.aborted) { end(); return; }
        life.signal.addEventListener('abort', end, { once: true });
        write(`retry: ${RETRY_MS}\n\n`);
        void push();
      },
      cancel() { life.abort(); },
    });
    return new Response(body, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
    });
  }

  return {
    async handle(request) {
      if (foreign(request)) return refuse('unauthorized', 403);
      // Every browser names its origin on a POST; a command without one did not come from our pages.
      if (request.method === 'POST') return request.headers.has('origin') ? command(request) : refuse('unauthorized', 403);
      if (request.method === 'GET' && /\btext\/event-stream\b/.test(request.headers.get('accept') ?? '')) return stream(request);
      return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
    },
    close() {
      for (const close of [...streams]) close();
    },
  };
}
