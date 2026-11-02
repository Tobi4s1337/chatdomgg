import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { CHAT_COMMAND_MAX_AGE_MS, CHAT_COMMAND_ROUTE, ChatCommandEnvelopeSchema, ChatCommandNameSchema,
  type ChatCommand, type ChatCommandCleanup, type ChatCommandEnvelope } from '@chatdom/shared';
import { IngressGate, type IngressCredentials } from '../ingress/gate';

export type ChatCommandResult = 'accepted' | 'duplicate' | 'ignored';
export interface RealmChatCommandHandler {
  readonly id: string;
  readonly commands: readonly string[];
  /** Resolve after the feature commits; deduplicate messageId durably with the move in the same transaction. */
  command(input: ChatCommand): Promise<ChatCommandResult>;
  /** Persist identity/message/room tombstones by input.at; reject commands reordered behind their cleanup. */
  cleanup(input: ChatCommandCleanup): Promise<ChatCommandResult>;
}

/** Feature registration has no Twitch credentials and cannot send chat. One command has one owner. */
export class RealmChatCommandRegistry {
  readonly #handlers = new Map<string, RealmChatCommandHandler>();
  readonly #commands = new Map<string, RealmChatCommandHandler>();

  register(handler: RealmChatCommandHandler): () => void {
    if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(handler.id) || this.#handlers.has(handler.id) || !handler.commands.length) {
      throw new Error('Chat command handler needs a unique ID and at least one command.');
    }
    const names = new Set(handler.commands.map(name => ChatCommandNameSchema.parse(name)));
    if (names.size !== handler.commands.length || [...names].some(name => this.#commands.has(name))) {
      throw new Error('Chat commands must have one registered owner.');
    }
    // Capture the names so mutation of a caller's array cannot leave stale registrations on disposal.
    this.#handlers.set(handler.id, handler);
    for (const name of names) this.#commands.set(name, handler);
    return () => {
      if (this.#handlers.get(handler.id) !== handler) return;
      this.#handlers.delete(handler.id);
      for (const name of names) this.#commands.delete(name);
    };
  }

  async dispatch(input: ChatCommandEnvelope): Promise<ChatCommandResult> {
    if (input.kind === 'command') return this.#commands.get(input.command)?.command(input) ?? 'ignored';
    // Retry every feature after partial failure: each feature owns its durable inbox and cleanup state.
    const results = await Promise.allSettled([...this.#handlers.values()].map(handler => handler.cleanup(input)));
    if (results.some(result => result.status === 'rejected')) throw new Error('Chat cleanup has not committed in every handler.');
    const committed = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    return committed.includes('accepted') ? 'accepted' : committed.includes('duplicate') ? 'duplicate' : 'ignored';
  }
}

/** Production feature modules register here during realm wiring, before it begins listening. */
export const realmChatCommands = new RealmChatCommandRegistry();
export const CHAT_COMMAND_BODY_LIMIT = 4_096;
interface ChatCommandServiceOptions {
  readonly registry: RealmChatCommandRegistry;
  readonly origin: 'live' | 'simulated';
  readonly credentials: IngressCredentials;
  readonly clock: () => number;
}
const response = (status: number, result: string) => new Response(JSON.stringify({ version: 1, status: result }), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

/** Strict service ingress; browser/panel identities cannot manufacture witnessed chat commands. */
export function createChatCommandService(options: ChatCommandServiceOptions) {
  const gate = new IngressGate(options.credentials, options.origin);
  const work = new Set<Promise<Response>>();
  let closed = false;
  const accept = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname !== CHAT_COMMAND_ROUTE) return response(404, 'refused');
    if (request.method !== 'POST') return response(405, 'refused');
    if (gate.authenticate(request.headers.get('authorization') ?? undefined) !== 'herald') return response(401, 'refused');
    if (url.search) return response(400, 'refused');
    if (!/^application\/json\b/iu.test(request.headers.get('content-type') ?? '')) return response(415, 'refused');
    if (Number(request.headers.get('content-length') ?? 0) > CHAT_COMMAND_BODY_LIMIT) return response(413, 'refused');
    const reader = request.body?.getReader();
    if (!reader) return response(400, 'refused');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.length;
        if (size > CHAT_COMMAND_BODY_LIMIT) { await reader.cancel(); return response(413, 'refused'); }
        chunks.push(item.value);
      }
    } finally { reader.releaseLock(); }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return response(400, 'refused'); }
    const parsed = ChatCommandEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return response(400, 'refused');
    const input = parsed.data;
    if (input.origin !== options.origin) return response(403, 'refused');
    const now = options.clock();
    if (input.at > now + 5_000) return response(400, 'refused');
    if (input.kind === 'command' && now - input.at >= CHAT_COMMAND_MAX_AGE_MS) return response(202, 'ignored');
    return response(202, await options.registry.dispatch(input));
  };
  return {
    handle(request: Request): Promise<Response> {
      if (closed || work.size >= 64) return Promise.resolve(response(503, 'unavailable'));
      const pending = accept(request).catch(() => response(503, 'unavailable')).finally(() => { work.delete(pending); });
      work.add(pending);
      return pending;
    },
    async close() { closed = true; await Promise.allSettled([...work]); },
  };
}

export function mountChatCommandRoute(app: uWebSocketsTransport['app'], options: ChatCommandServiceOptions) {
  const service = createChatCommandService(options);
  app.post(CHAT_COMMAND_ROUTE, (res, req) => {
    const query = req.getQuery(), url = `http://realm.internal${req.getUrl()}${query ? `?${query}` : ''}`;
    const headers = new Headers();
    for (const name of ['authorization', 'content-type', 'content-length']) { const value = req.getHeader(name); if (value) headers.set(name, value); }
    let aborted = false, finished = false, size = 0;
    res.onAborted(() => { aborted = true; });
    const reply = async (answer: Response) => {
      const text = await answer.text();
      if (aborted) return;
      res.cork(() => {
        res.writeStatus(`${answer.status} ${STATUS[answer.status] ?? 'Error'}`);
        answer.headers.forEach((value, name) => res.writeHeader(name, value));
        res.end(text);
      });
    };
    if (Number(headers.get('content-length') ?? 0) > CHAT_COMMAND_BODY_LIMIT) { void reply(response(413, 'refused')); return; }
    const chunks: Buffer[] = [];
    res.onData((chunk, last) => {
      if (finished) return;
      size += chunk.byteLength;
      if (size > CHAT_COMMAND_BODY_LIMIT) { finished = true; void reply(response(413, 'refused')); return; }
      chunks.push(Buffer.from(chunk.slice(0)));
      if (!last) return;
      finished = true;
      void service.handle(new Request(url, { method: 'POST', headers, body: Buffer.concat(chunks).toString('utf8') })).then(reply);
    });
  });
  return service;
}
const STATUS: Readonly<Record<number, string>> = { 202: 'Accepted', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
  404: 'Not Found', 405: 'Method Not Allowed', 413: 'Payload Too Large', 415: 'Unsupported Media Type', 503: 'Service Unavailable' };
