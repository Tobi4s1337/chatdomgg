import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import type { RealmIngress, IngressReply } from './service';

export const INGRESS_ROUTE = '/internal/realm/ingress';
/** One Chatters sweep of a large channel fits; anything larger is refused before it is buffered. */
export const INGRESS_BODY_LIMIT = 8 * 1024 * 1024;

type App = uWebSocketsTransport['app'];
const STATUS: Record<IngressReply['http'] | 413 | 415, string> = {
  202: '202 Accepted', 400: '400 Bad Request', 401: '401 Unauthorized', 403: '403 Forbidden', 409: '409 Conflict',
  413: '413 Payload Too Large', 415: '415 Unsupported Media Type', 503: '503 Service Unavailable',
};

/**
 * `POST /internal/realm/ingress` for trusted services, never for browsers: `Authorization: Bearer <service secret>`,
 * JSON `{ version: 1, observation: PresenceInput }`, `{ version: 1, support: RealmSupportObservation }`
 * or `{ version: 1, cue: CitizenChatCue }`. No CORS headers are sent.
 * `202 accepted|duplicate` means the observation is durable; resend on any other answer or a lost reply.
 */
export function mountIngressRoute(app: App, ingress: RealmIngress) {
  app.post(INGRESS_ROUTE, (res, req) => {
    const authorization = req.getHeader('authorization'), type = req.getHeader('content-type');
    const declared = Number(req.getHeader('content-length') || '0');
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    const reply = (status: keyof typeof STATUS, body: unknown) => {
      if (aborted) return;
      res.cork(() => {
        res.writeStatus(STATUS[status]).writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store').end(JSON.stringify(body));
      });
    };
    if (!/^application\/json\b/i.test(type)) { reply(415, { version: 1, status: 'refused', message: 'Send JSON.' }); return; }
    if (declared > INGRESS_BODY_LIMIT) { reply(413, { version: 1, status: 'refused', message: 'The observation is too large.' }); return; }
    const chunks: Buffer[] = [];
    let size = 0, refused = false;
    res.onData((chunk, last) => {
      if (refused) return;
      size += chunk.byteLength;
      if (size > INGRESS_BODY_LIMIT) { refused = true; reply(413, { version: 1, status: 'refused', message: 'The observation is too large.' }); return; }
      // uWS reuses the chunk's memory after this callback returns.
      chunks.push(Buffer.from(chunk.slice(0)));
      if (!last) return;
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { reply(400, { version: 1, status: 'refused', message: 'The body is not JSON.' }); return; }
      void ingress.accept(authorization, body).then(
        answer => reply(answer.http, answer.body),
        () => reply(503, { version: 1, status: 'unavailable', message: 'The realm could not take this observation. Send it again.' }));
    });
  });
}
