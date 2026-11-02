import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { LandArtifactStore } from './store';
import { readLandRoute } from './routes';

/** Explicit configuration only. Reads complete artifacts; this host never bakes on a request. */
export function mountLandRoutes(app: uWebSocketsTransport['app'], directory: string) {
  if (!directory.trim()) throw new Error('The land artifact directory must be explicit');
  const store = new LandArtifactStore(directory);
  app.any('/api/realm/land/*', (res, req) => {
    // Request objects expire when this synchronous callback returns.
    const path = req.getUrl(), method = req.getMethod().toUpperCase(), etag = req.getHeader('if-none-match');
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    void readLandRoute(store, path, method, etag).then(response => {
      if (aborted) return;
      const reply = response ?? { status: 404, headers: { 'cache-control': 'no-store' }, body: new Uint8Array() };
      const statuses: Record<number, string> = { 200: '200 OK', 304: '304 Not Modified', 404: '404 Not Found',
        405: '405 Method Not Allowed', 503: '503 Service Unavailable' };
      res.cork(() => {
        res.writeStatus(statuses[reply.status] ?? '503 Service Unavailable');
        for (const [key, value] of Object.entries(reply.headers)) res.writeHeader(key, value);
        res.end(reply.body);
      });
    }, () => { if (!aborted) res.cork(() => res.writeStatus('503 Service Unavailable').writeHeader('Cache-Control', 'no-store').end()); });
  });
}
