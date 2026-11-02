import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { Buffer } from 'node:buffer';
import { KingdomIdSchema, PIER_ALMANAC_ROUTE, PIER_WATCH_ROUTE, type PierAlmanac, type PierFeedEvent } from '@chatdom/shared';

type App = uWebSocketsTransport['app'];
const WATCH_LIMIT = 64, STALLED_WRITE_MS = 10_000, EVENT_LIMIT = 16 * 1024;
const frame = (event: PierFeedEvent) => `event: pier\ndata: ${JSON.stringify(event)}\n\n`;

export interface PierRoutesSource {
  almanac(kingdomId: string): Promise<PierAlmanac>;
  watch(kingdomId: string, listener: (event: PierFeedEvent) => void): (() => void) | null;
}

/** Public, read-only pier pages: the Almanac (JSON) and the pier's beats (server-sent events). No person ids. */
export function mountPierRoutes(app: App, source: PierRoutesSource): void {
  app.get(PIER_ALMANAC_ROUTE, (res, req) => {
    const parameter = req.getParameter(0) ?? '';
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    const reply = (status: string, body: unknown, cache: string) => {
      if (aborted) return;
      res.cork(() => res.writeStatus(status).writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', cache)
        .writeHeader('X-Content-Type-Options', 'nosniff').end(JSON.stringify(body)));
    };
    const id = KingdomIdSchema.safeParse(parameter);
    if (!id.success) { reply('400 Bad Request', { version: 1, status: 'refused', message: 'The kingdom identifier is invalid.' }, 'no-store'); return; }
    source.almanac(id.data).then(almanac => reply('200 OK', almanac, 'public, max-age=5'),
      () => reply('503 Service Unavailable', { version: 1, status: 'unavailable', message: 'The Almanac could not be read just now.' }, 'no-store'));
  });

  let watchers = 0;
  app.get(PIER_WATCH_ROUTE, (res, req) => {
    const parameter = req.getParameter(0) ?? '';
    let ended = false, blocked = false, started = false;
    let stop: (() => void) | null = null;
    let stalled: ReturnType<typeof setTimeout> | undefined, keepalive: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => {
      if (ended) return;
      ended = true;
      if (stalled) clearTimeout(stalled);
      if (keepalive) clearInterval(keepalive);
      stop?.(); stop = null;
      if (started) watchers--;
    };
    const write = (body: string) => {
      if (ended) return;
      if (blocked) { cleanup(); res.close(); return; }
      res.cork(() => { blocked = !res.write(body); });
      if (blocked) { stalled = setTimeout(() => { cleanup(); res.close(); }, STALLED_WRITE_MS); stalled.unref?.(); }
    };
    res.onAborted(cleanup);
    res.onWritable(() => { blocked = false; if (stalled) { clearTimeout(stalled); stalled = undefined; } return true; });
    const id = KingdomIdSchema.safeParse(parameter);
    const refuse = (status: string, message: string) => { ended = true;
      res.cork(() => res.writeStatus(status).writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store')
        .end(JSON.stringify({ version: 1, status: 'refused', message }))); };
    if (!id.success) { refuse('400 Bad Request', 'The kingdom identifier is invalid.'); return; }
    if (watchers >= WATCH_LIMIT) { refuse('503 Service Unavailable', 'The pier is being watched by many already. Reconnect shortly.'); return; }
    watchers++; started = true;
    res.cork(() => res.writeStatus('200 OK').writeHeader('Content-Type', 'text/event-stream; charset=utf-8')
      .writeHeader('Cache-Control', 'no-store').writeHeader('X-Accel-Buffering', 'no').writeHeader('X-Content-Type-Options', 'nosniff'));
    stop = source.watch(id.data, event => {
      const body = frame(event);
      if (Buffer.byteLength(body) <= EVENT_LIMIT) write(body);
    });
    if (!stop) { cleanup(); res.cork(() => res.end(': full\n\n')); return; }
    keepalive = setInterval(() => write(': keepalive\n\n'), 15_000);
    keepalive.unref?.();
  });
}
