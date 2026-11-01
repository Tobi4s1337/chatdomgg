import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';

/** Public, uncached realm process time for presentation clock synchronization. */
export function mountSoulClockRoute(app: uWebSocketsTransport['app'], clock: () => number = Date.now) {
  app.get('/api/realm/clock', res => {
    res.cork(() => res.writeStatus('200 OK').writeHeader('Content-Type', 'application/json')
      .writeHeader('Cache-Control', 'no-store').writeHeader('X-Content-Type-Options', 'nosniff')
      .end(JSON.stringify({ version: 1, serverTime: clock() })));
  });
}
