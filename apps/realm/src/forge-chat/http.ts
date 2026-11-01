import type { IncomingHttpHeaders } from 'node:http';
import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { FORGE_CHAT_LIMITS, FORGE_CHAT_ROUTES, type ForgeChatError } from '@chatdom/shared';
import { dockMutationAllowed, dockPrincipal, type DockSessionPool } from '../../../api/src/dock/auth';
import { ForgeChatServiceError, type ForgeChatService } from './service';

export interface ForgeChatHttpOptions {
  readonly pool: DockSessionPool;
  readonly origin: 'live' | 'simulated';
  readonly publicOrigin: string;
  readonly secureCookies: boolean;
}
export interface ForgeChatHttpRequest { readonly method: string; readonly path: string; readonly query: string; readonly headers: IncomingHttpHeaders; readonly body?: unknown }
export interface ForgeChatHttpReply { readonly http: number; readonly body?: unknown; readonly redirect?: string }

/** Reuses the actual web session lookup and CSRF secret without broadening the sign-in grant. */
export function createForgeChatHttpHandler(service: ForgeChatService, options: ForgeChatHttpOptions) {
  const expected = new URL(options.publicOrigin);
  if (expected.origin !== options.publicOrigin || expected.username || expected.password
    || (expected.protocol !== 'https:' && !(expected.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname)))
    || options.secureCookies !== (expected.protocol === 'https:')) throw new Error('Forge chat requires the configured public origin and matching cookie security.');
  const authenticate = (cookie: string | undefined) => dockPrincipal(options.pool, options.origin, options.secureCookies, cookie);
  return async (request: ForgeChatHttpRequest): Promise<ForgeChatHttpReply> => {
    const callback = request.path === FORGE_CHAT_ROUTES.callback;
    try {
      const valid = Object.values(FORGE_CHAT_ROUTES).includes(request.path as typeof FORGE_CHAT_ROUTES[keyof typeof FORGE_CHAT_ROUTES]);
      if (!valid) throw new ForgeChatServiceError(400, 'invalid-request', 'This is not a forge chat route.');
      const read = request.path === FORGE_CHAT_ROUTES.status || callback;
      if (request.method !== (read ? 'GET' : 'POST')) throw new ForgeChatServiceError(400, 'invalid-request', 'This forge request used the wrong method.');
      const session = await authenticate(request.headers.cookie);
      if (!session && request.path !== FORGE_CHAT_ROUTES.status) {
        if (callback) return { http: 303, redirect: '/?forgeChat=expired' };
        throw new ForgeChatServiceError(401, 'unauthenticated', 'Sign in with Twitch before making your wish.');
      }
      const current = async () => {
        const latest = await authenticate(request.headers.cookie);
        return latest?.principal.personId === session?.principal.personId && latest?.principal.sessionId === session?.principal.sessionId;
      };
      if (!read && (!session || !dockMutationAllowed(request.headers, options.publicOrigin, session.handle))) {
        throw new ForgeChatServiceError(403, 'forbidden', 'Reload your Chatdom page before sending this request.');
      }
      const query = new URLSearchParams(request.query);
      if (request.path === FORGE_CHAT_ROUTES.status) {
        if ([...query.keys()].some(key => !['kingdomId', 'requestId'].includes(key))
          || [...new Set(query.keys())].some(key => query.getAll(key).length !== 1)) throw new ForgeChatServiceError(400, 'invalid-request', 'This forge status request could not be read.');
        return { http: 200, body: await service.status(session?.principal ?? null, { version: 1, kingdomId: query.get('kingdomId'),
          ...(query.has('requestId') ? { requestId: query.get('requestId') } : {}) }) };
      }
      if (callback) {
        if ([...new Set(query.keys())].some(key => query.getAll(key).length !== 1)) return { http: 303, redirect: '/?forgeChat=expired' };
        return { http: 303, redirect: await service.callback(session!.principal, query, current) };
      }
      if (request.path === FORGE_CHAT_ROUTES.authorize) return { http: 200, body: await service.authorize(session!.principal, request.body) };
      if (request.path === FORGE_CHAT_ROUTES.revoke) return { http: 200, body: await service.revoke(session!.principal, request.body) };
      return { http: 202, body: await service.wish(session!.principal, request.body, current) };
    } catch (error) {
      if (callback) return { http: 303, redirect: '/?forgeChat=expired' };
      const failure = error instanceof ForgeChatServiceError ? error : new ForgeChatServiceError(503, 'unavailable', 'The forge cannot reach chat just now. You can still type !forge in the channel.');
      const body: ForgeChatError = { version: 1, status: 'error', code: failure.code, message: failure.message };
      return { http: failure.http, body };
    }
  };
}

type App = uWebSocketsTransport['app'];
const STATUS: Readonly<Record<number, string>> = { 200: '200 OK', 202: '202 Accepted', 303: '303 See Other',
  400: '400 Bad Request', 401: '401 Unauthorized', 403: '403 Forbidden', 409: '409 Conflict', 413: '413 Payload Too Large',
  415: '415 Unsupported Media Type', 429: '429 Too Many Requests', 503: '503 Service Unavailable' };

/** Copy uWS request data synchronously. Browser abort only stops the reply; a claimed send is never replayed. */
export function mountForgeChatRoutes(app: App, service: ForgeChatService, options: ForgeChatHttpOptions): void {
  const handle = createForgeChatHttpHandler(service, options);
  for (const route of Object.values(FORGE_CHAT_ROUTES)) {
    const method = route === FORGE_CHAT_ROUTES.status || route === FORGE_CHAT_ROUTES.callback ? 'get' : 'post';
    app[method](route, (response, request) => {
      let aborted = false, finished = false;
      response.onAborted(() => { aborted = true; });
      const send = (answer: ForgeChatHttpReply) => {
        if (aborted || finished) return;
        finished = true;
        response.cork(() => {
          response.writeStatus(STATUS[answer.http] ?? STATUS[503]!).writeHeader('Cache-Control', 'no-store')
            .writeHeader('Referrer-Policy', 'no-referrer').writeHeader('X-Content-Type-Options', 'nosniff');
          if (answer.redirect) response.writeHeader('Location', answer.redirect).end();
          else response.writeHeader('Content-Type', 'application/json').end(JSON.stringify(answer.body));
        });
      };
      const copied: ForgeChatHttpRequest = { method: method.toUpperCase(), path: route, query: request.getQuery(), headers: {
        cookie: request.getHeader('cookie'), origin: request.getHeader('origin'), 'x-csrf-token': request.getHeader('x-csrf-token'),
        'sec-fetch-site': request.getHeader('sec-fetch-site'),
      } };
      const run = (body?: unknown) => { void handle({ ...copied, ...(body === undefined ? {} : { body }) }).then(send,
        () => send({ http: 503, body: { version: 1, status: 'error', code: 'unavailable', message: 'The forge cannot reach chat just now.' } })); };
      if (method === 'get') { run(); return; }
      const contentType = request.getHeader('content-type'), declared = Number(request.getHeader('content-length') || '0');
      if (!/^application\/json\b/i.test(contentType)) { send({ http: 415, body: { version: 1, status: 'error', code: 'invalid-request', message: 'Send this forge request as JSON.' } }); return; }
      if (!Number.isFinite(declared) || declared > FORGE_CHAT_LIMITS.bodyBytes) { send({ http: 413, body: { version: 1, status: 'error', code: 'invalid-request', message: 'This forge request is too large.' } }); return; }
      let bytes = 0;
      const chunks: Buffer[] = [];
      response.onData((chunk, last) => {
        if (aborted || finished) return;
        bytes += chunk.byteLength;
        if (bytes > FORGE_CHAT_LIMITS.bodyBytes) { chunks.length = 0; send({ http: 413, body: { version: 1, status: 'error', code: 'invalid-request', message: 'This forge request is too large.' } }); return; }
        chunks.push(Buffer.from(chunk.slice(0)));
        if (!last) return;
        let body: unknown;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { chunks.length = 0; send({ http: 400, body: { version: 1, status: 'error', code: 'invalid-request', message: 'This forge request is not valid JSON.' } }); return; }
        chunks.length = 0;
        run(body);
      });
    });
  }
}
