import { createHash, timingSafeEqual } from 'node:crypto';
import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { GATHER_CHAT_ROUTE, GatherChatEnvelopeSchema, type GatherChatEnvelope } from '@chatdom/shared';

type App = uWebSocketsTransport['app'];
const LIMIT = 4_096;
const hash = (text: string) => createHash('sha256').update(text).digest();

/**
 * `POST /internal/realm/gather/chat` (SEAMS §3): the herald hands over chat lines that are gathering commands, with
 * the same internal bearer as the realm's other service routes. No CORS, no browser identity, no reply in chat.
 * Without `REALM_INTERNAL_SECRET` the route refuses everything.
 */
export function mountGatherChatRoute(app: App, secret: string | undefined, deliver: (envelope: GatherChatEnvelope) => Promise<unknown>): void {
  if (secret !== undefined && secret.length < 32) throw new Error('REALM_INTERNAL_SECRET must contain at least 32 characters.');
  const expected = secret ? hash(secret) : null;
  app.post(GATHER_CHAT_ROUTE, (res, req) => {
    const authorization = req.getHeader('authorization'), type = req.getHeader('content-type'), length = Number(req.getHeader('content-length') || '0');
    let aborted = false, done = false, bytes = 0;
    const chunks: Buffer[] = [];
    res.onAborted(() => { aborted = true; });
    const reply = (status: '200 OK' | '400 Bad Request' | '401 Unauthorized' | '503 Service Unavailable', body: unknown) => {
      if (aborted || done) return;
      done = true;
      res.cork(() => res.writeStatus(status).writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store').end(JSON.stringify(body)));
    };
    const bearer = /^Bearer (.+)$/.exec(authorization);
    if (!expected || !bearer || !timingSafeEqual(expected, hash(bearer[1]!))) { reply('401 Unauthorized', { status: 'refused' }); return; }
    if (!/^application\/json\b/i.test(type) || length > LIMIT) { reply('400 Bad Request', { status: 'refused' }); return; }
    res.onData((chunk, last) => {
      if (aborted || done) return;
      bytes += chunk.byteLength;
      if (bytes > LIMIT) { reply('400 Bad Request', { status: 'refused' }); return; }
      chunks.push(Buffer.from(chunk.slice(0)));
      if (!last) return;
      let envelope: GatherChatEnvelope;
      try {
        const parsed = GatherChatEnvelopeSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        if (!parsed.success) { reply('400 Bad Request', { status: 'refused' }); return; }
        envelope = parsed.data;
      } catch { reply('400 Bad Request', { status: 'refused' }); return; }
      void deliver(envelope).then(() => reply('200 OK', { status: 'received' }), () => reply('503 Service Unavailable', { status: 'unavailable' }));
    });
  });
}
