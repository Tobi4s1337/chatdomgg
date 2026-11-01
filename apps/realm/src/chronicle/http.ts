import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { FoundedReadError } from '../bootstrap/founded';
import type { createChronicleReader } from './read';

/** Public read only. The existing founded access policy authorizes and rechecks every response. */
export function mountChronicleRoutes(app: uWebSocketsTransport['app'], reader: ReturnType<typeof createChronicleReader>) {
  app.get('/api/realm/chronicle/:kingdomId', (res, req) => {
    const parameter = req.getParameter(0) ?? '', request = { authorization: req.getHeader('authorization'), cookie: req.getHeader('cookie'), origin: req.getHeader('origin') };
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    void reader.read(parameter, request).then(reply => {
      if (aborted) return;
      res.cork(() => res.writeStatus('200 OK').writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store')
        .writeHeader('X-Content-Type-Options', 'nosniff').end(JSON.stringify(reply)));
    }, error => {
      if (aborted) return;
      const failure = error instanceof FoundedReadError ? error : new FoundedReadError(503, 'The kingdom’s Chronicle is unavailable right now.');
      const statuses = { 400: '400 Bad Request', 403: '403 Forbidden', 404: '404 Not Found', 503: '503 Service Unavailable' } as const;
      res.cork(() => res.writeStatus(statuses[failure.status]).writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store')
        .end(JSON.stringify({ version: 1, status: 'unavailable', message: failure.message })));
    });
  });
}
