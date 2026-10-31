import type { Server } from '@colyseus/core';
import type { RealmTransport } from './server';

const SHUTDOWN_TIMEOUT_MS = 5_000;

/** The process composition owns these hooks; Colyseus owns signal/exception handling and the normal exit. */
export function ownRealmShutdown(
  server: Pick<Server, 'onBeforeShutdown' | 'onShutdown' | 'gracefullyShutdown'>,
  transport: RealmTransport,
  cleanup: () => Promise<void>,
  exit: (code: number) => void = code => process.exit(code),
) {
  let draining = false;
  let failed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const begin = () => {
    draining = true;
    timer ??= setTimeout(() => {
      console.error('Realm shutdown did not finish within 5000 ms; exiting for restart.');
      exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    // Keep the deadline alive even if a closed listener and stalled cleanup leave no other event-loop handles.
  };
  server.onBeforeShutdown(begin);
  server.onShutdown(async () => {
    try { await cleanup(); }
    finally { clearTimeout(timer); }
  });
  transport.onListenerClosed = () => {
    if (draining || failed) return;
    failed = true;
    console.error('Realm listener closed outside shutdown; exiting for restart.');
    begin();
    // The listener is already closed. The transport guard prevents a second native close while rooms drain.
    void server.gracefullyShutdown(false).then(() => exit(1), () => exit(1));
  };
}
