/**
 * The passport read over HTTP: one URL, web-standard `Request` in and `Response` out, so main mounts it beside the
 * public card page behind any router. `POST` carries one read as JSON (`{ op: 'book' }` or `{ op: 'page', … }`).
 *
 * The subject comes from main's `subject` resolver (the public card's own path), never from the body; the strict
 * request reader refuses any person, kingdom or actor field. Every response is `no-store`: a passport is read
 * through the card's disclosure on every request, and no cache may answer for it after the travels are hidden.
 */
import type { CitizenKey } from '../citizen-card/contracts';
import type { PassportReply } from './contracts';
import type { PassportReader } from './read';

/** Main's resolver from a request (its URL) to the card's subject. Null when the path names no citizen card. */
export type PassportSubject = (request: Request, signal: AbortSignal) => Promise<CitizenKey | null>;

export type PassportHttpOptions = Readonly<{
  reader: PassportReader;
  subject: PassportSubject;
  /** The server clock; the browser's clock is never consulted. */
  clock: () => number;
  /** The web app's own origins. A request carrying any other `Origin` is refused. */
  origins: readonly string[];
}>;

/** A read body is a few hundred bytes; anything larger is not a passport read. */
const MAX_BODY = 2048;
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const;
const reply = (body: PassportReply, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export function createPassportHttp(options: PassportHttpOptions): { handle(request: Request): Promise<Response> } {
  return {
    async handle(request) {
      if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } });
      const origin = request.headers.get('origin');
      if (origin !== null && !options.origins.includes(origin)) return reply({ kind: 'denied', code: 'invalid' }, 403);
      if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return reply({ kind: 'denied', code: 'invalid' }, 415);
      const text = await request.text();
      if (text.length > MAX_BODY) return reply({ kind: 'denied', code: 'invalid' }, 413);
      let body: unknown;
      try { body = JSON.parse(text); } catch { return reply({ kind: 'denied', code: 'invalid' }, 400); }
      const key = await options.subject(request, request.signal);
      if (!key) return reply({ kind: 'denied', code: 'unavailable' }, 404);
      const answer = await options.reader.handle({ key, now: options.clock(), signal: request.signal }, body);
      return reply(answer, answer.kind === 'denied' && answer.code === 'invalid' ? 400 : 200);
    },
  };
}
