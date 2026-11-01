import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { KingdomIdSchema } from '@chatdom/shared';
import { REALM_DOCK_ROUTES, RealmDockStatusRequestSchema } from '@chatdom/shared/realm';
import type { DockHttpReply, DockPresentationConnection, RealmDockService } from './service';

type App = uWebSocketsTransport['app'];
type Response = Parameters<Parameters<App['post']>[1]>[0];
const STATUS = { 200: '200 OK', 400: '400 Bad Request', 401: '401 Unauthorized', 403: '403 Forbidden', 503: '503 Service Unavailable' } as const;
const LIMIT = 8_192;
const frame = (kind: string, value: unknown) => `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`;

/** Internal service routes: no CORS, browser identity assertions, or public presenter capabilities. */
export function mountRealmDockRoutes(app: App, dock: RealmDockService): void {
  for (const [route, accept] of [
    [REALM_DOCK_ROUTES.status, dock.status.bind(dock)],
    [REALM_DOCK_ROUTES.action, dock.action.bind(dock)],
    [REALM_DOCK_ROUTES.witness, dock.witness.bind(dock)],
  ] as const) app.post(route, (res, req) => {
    const authorization = req.getHeader('authorization');
    readJson(res, req.getHeader('content-type'), req.getHeader('content-length'),
      body => accept(authorization, body));
  });
  app.get(REALM_DOCK_ROUTES.presentations, (res, req) => {
    const kingdom = KingdomIdSchema.safeParse(req.getParameter(0));
    const authorization = req.getHeader('authorization');
    if (!kingdom.success) { send(res, 400, { status: 'refused', message: 'Invalid kingdom.' }); return; }
    stream(res, dock, authorization, { version: 1, origin: dock.origin, kingdomId: kingdom.data }, false);
  });
  app.post(REALM_DOCK_ROUTES.presentations, (res, req) => {
    const kingdom = req.getParameter(0), authorization = req.getHeader('authorization');
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    readJson(res, req.getHeader('content-type'), req.getHeader('content-length'), async body => {
      const parsed = RealmDockStatusRequestSchema.safeParse(body);
      if (!parsed.success || parsed.data.kingdomId !== kingdom) return { http: 400, body: { status: 'refused', message: 'Invalid presenter request.' } };
      if (!aborted) stream(res, dock, authorization, parsed.data, true);
      return null;
    });
  });
}

function stream(res: Response, dock: RealmDockService, authorization: string, raw: unknown, presenter: boolean) {
  let ended = false, started = false, connection: DockPresentationConnection | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  const prefix: string[] = [];
  const cleanup = () => {
    if (ended) return;
    ended = true; if (keepalive) clearInterval(keepalive); connection?.close(); prefix.length = 0;
  };
  const close = () => {
    if (ended) return;
    const wasStarted = started; cleanup();
    res.cork(() => { if (wasStarted) res.end(frame('closed', { reason: 'presenter-disconnected' }));
      else res.writeStatus('503 Service Unavailable').writeHeader('Cache-Control', 'no-store').end(); });
  };
  const write = (value: string): boolean => {
    if (ended) return false;
    let ready = true;
    res.cork(() => { ready = res.write(value); });
    if (!ready) { cleanup(); res.close(); }
    return ready;
  };
  res.onAborted(cleanup);
  if (!dock.authenticate(authorization)) { cleanup(); send(res, 401, { status: 'refused', message: 'Unknown stream service.' }); return; }
  const receive = (value: string) => {
    if (ended) return false;
    if (!started) { if (prefix.length >= 101) return false; prefix.push(value); return true; }
    return write(value);
  };
  void dock.connect(authorization, raw, event => receive(frame('presentation', event)), close, presenter,
    state => receive(frame('state', state))).then(value => {
    connection = value;
    if (ended) { connection.close(); return; }
    res.cork(() => res.writeStatus('200 OK').writeHeader('Content-Type', 'text/event-stream; charset=utf-8')
      .writeHeader('Cache-Control', 'no-store').writeHeader('X-Accel-Buffering', 'no').writeHeader('X-Content-Type-Options', 'nosniff'));
    started = true;
    if (connection.presenterToken && !write(frame('presenter', { presenterToken: connection.presenterToken }))) return;
    for (const event of prefix) if (!write(event)) return;
    prefix.length = 0;
    keepalive = setInterval(() => { write(': keepalive\n\n'); }, 10_000); keepalive.unref?.();
  }).catch(() => { if (!ended) { cleanup(); send(res, 403, { status: 'refused', message: 'This presenter is not authorized.' }); } });
}

function readJson(res: Response, contentType: string, length: string, accept: (body: unknown) => Promise<DockHttpReply | null>) {
  let aborted = false, finished = false, bytes = 0;
  const chunks: Buffer[] = [];
  res.onAborted(() => { aborted = true; });
  const reply = (value: DockHttpReply) => { if (!aborted && !finished) { finished = true; send(res, value.http, value.body); } };
  if (!/^application\/json\b/i.test(contentType) || Number(length || '0') > LIMIT) {
    reply({ http: 400, body: { status: 'refused', message: 'Send a bounded JSON request.' } }); return;
  }
  res.onData((chunk, last) => {
    if (aborted || finished) return;
    bytes += chunk.byteLength;
    if (bytes > LIMIT) { reply({ http: 400, body: { status: 'refused', message: 'The request is too large.' } }); return; }
    chunks.push(Buffer.from(chunk.slice(0)));
    if (!last) return;
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { reply({ http: 400, body: { status: 'refused', message: 'The request is not JSON.' } }); return; }
    void accept(body).then(value => { if (value) reply(value); }, () => reply({ http: 503, body: { status: 'unavailable', message: 'The dock is unavailable.' } }));
  });
}
function send(res: Response, status: keyof typeof STATUS, value: unknown) {
  res.cork(() => res.writeStatus(STATUS[status]).writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store')
    .writeHeader('X-Content-Type-Options', 'nosniff').end(JSON.stringify(value)));
}
