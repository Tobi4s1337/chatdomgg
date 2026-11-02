import { createServer as createPortProbe } from 'node:net';
import type { createRealmServer } from '../server';

/**
 * Socket tests own their own loopback address: the lane ports are often all held on 127.0.0.1 by other lanes,
 * and the installed transport's listen drops its hostname (binding every address), so a free 127.0.0.1 probe
 * proves nothing. Each test binds through uWS's explicit host overload, as the capture harness does
 * (`apps/web/src/games/local-listener.mjs`), and restores the app method straight after.
 */
export const TEST_HOST = '127.0.0.10';
const PORTS = [5183, 5184, 5185, 5186, 5188, 5189, 5170, 5171, 5172, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5182];

async function freeTestPort(): Promise<number> {
  for (const port of PORTS) {
    const free = await new Promise<boolean>(resolve => {
      const probe = createPortProbe();
      probe.once('error', () => resolve(false));
      probe.listen(port, TEST_HOST, () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(`No approved free port on ${TEST_HOST}`);
}

/** Listen on the test host and return the realm's URL. */
export async function listenForTest(created: ReturnType<typeof createRealmServer>): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await freeTestPort();
    const app = (created.transport as unknown as { app: { listen: (...args: never[]) => unknown } }).app, native = app.listen;
    let bound = false;
    app.listen = ((_port: number, callback: (socket: unknown) => void) =>
      (native as (...args: unknown[]) => unknown).call(app, TEST_HOST, port, (socket: unknown) => { bound = !!socket; callback(socket); })) as typeof native;
    try { await created.server.listen(port, TEST_HOST); } finally { app.listen = native; }
    if (bound) return `http://${TEST_HOST}:${port}`;
  }
  throw new Error(`The test realm could not bind ${TEST_HOST}`);
}
