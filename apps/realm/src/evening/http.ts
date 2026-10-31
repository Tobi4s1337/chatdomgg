import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { REALM_HERALD_ROUTE } from '@chatdom/shared/realm';
import { INGRESS_BODY_LIMIT, INGRESS_ROUTE, type IngressReply } from '../ingress';
import type { RealmEveningBridge } from './bridge';

type App = uWebSocketsTransport['app'];
const STATUS = { 202: '202 Accepted', 400: '400 Bad Request', 401: '401 Unauthorized', 403: '403 Forbidden',
  409: '409 Conflict', 413: '413 Payload Too Large', 415: '415 Unsupported Media Type', 503: '503 Service Unavailable' } as const;
const PRIVATE_BODY_LIMIT = 16_384;

/** Both trusted service doors share the established bearer gate. No browser CORS or identity bypass. */
export function mountEveningRoutes(app: App, bridge: RealmEveningBridge): void {
  mount(app, INGRESS_ROUTE, INGRESS_BODY_LIMIT, (authorization, body) => bridge.observation(authorization, body));
  mount(app, REALM_HERALD_ROUTE, PRIVATE_BODY_LIMIT, (authorization, body) => bridge.accept(authorization, body));
}

function mount(app: App, route: string, limit: number, accept: (authorization: string, body: unknown) => Promise<IngressReply>): void {
  app.post(route, (response, request) => {
    const authorization = request.getHeader('authorization'), contentType = request.getHeader('content-type');
    const declared = Number(request.getHeader('content-length') || '0');
    let aborted = false, finished = false;
    response.onAborted(() => { aborted = true; });
    const reply = (status: keyof typeof STATUS, body: unknown) => {
      if (aborted || finished) return;
      finished = true;
      response.cork(() => response.writeStatus(STATUS[status]).writeHeader('Content-Type', 'application/json')
        .writeHeader('Cache-Control', 'no-store').end(JSON.stringify(body)));
    };
    if (!/^application\/json\b/i.test(contentType)) { reply(415, { version: 1, status: 'refused', message: 'Send JSON.' }); return; }
    if (declared > limit) { reply(413, { version: 1, status: 'refused', message: 'The Herald message is too large.' }); return; }
    const chunks: Buffer[] = [];
    let bytes = 0;
    response.onData((chunk, last) => {
      if (finished || aborted) return;
      bytes += chunk.byteLength;
      if (bytes > limit) { reply(413, { version: 1, status: 'refused', message: 'The Herald message is too large.' }); return; }
      chunks.push(Buffer.from(chunk.slice(0)));
      if (!last) return;
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { reply(400, { version: 1, status: 'refused', message: 'The body is not JSON.' }); return; }
      void accept(authorization, body).then(answer => reply(answer.http, answer.body),
        () => reply(503, { version: 1, status: 'unavailable', message: 'The realm could not take this Herald message.' }));
    });
  });
}
