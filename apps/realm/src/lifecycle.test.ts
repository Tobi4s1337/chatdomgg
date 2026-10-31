import { createServer } from 'node:net';
import { expect, it, vi } from 'vitest';
import { ownRealmShutdown } from './lifecycle';
import { referenceServices } from './reference';
import { createRealmServer } from './server';

async function realm() {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const runtime = createRealmServer(referenceServices());
  runtime.transport.app.get('/lifecycle-test', response => { response.end('alive'); });
  await runtime.server.listen(address.port, '127.0.0.1');
  return { ...runtime, port: address.port };
}

it('exits unsuccessfully after an actual unexpected listener close, and preserves an explicit normal drain', async () => {
  const unexpected = await realm();
  const cleanup = vi.fn(async () => {}), exit = vi.fn();
  ownRealmShutdown(unexpected.server, unexpected.transport, cleanup, exit);
  try {
    expect(await (await fetch(`http://127.0.0.1:${unexpected.port}/lifecycle-test`)).text()).toBe('alive');
    unexpected.transport.shutdown();
    unexpected.transport.shutdown(); // Must not double-close the native socket while Colyseus drains.
    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(1));
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(new Promise<void>((resolve, reject) => {
      const connection = createServer();
      connection.once('error', reject);
      // A fresh bind proves that the listener really closed; HTTP keep-alive may outlive a listener.
      connection.listen(unexpected.port, '127.0.0.1', () => connection.close(() => resolve()));
    })).resolves.toBeUndefined();
  } finally { await unexpected.server.gracefullyShutdown(false); unexpected.diagnostics.stop(); }

  const normal = await realm();
  const normalCleanup = vi.fn(async () => {}), normalExit = vi.fn();
  ownRealmShutdown(normal.server, normal.transport, normalCleanup, normalExit);
  try {
    vi.useFakeTimers();
    await normal.server.gracefullyShutdown(false);
    expect(normalCleanup).toHaveBeenCalledOnce();
    expect(normalExit).not.toHaveBeenCalled();
    // Completion also cancels the bounded fallback; normal embedded/test drains keep their caller alive.
    await vi.advanceTimersByTimeAsync(5_001);
    expect(normalExit).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); normal.diagnostics.stop(); }
});

it('bounds shutdown when cleanup hangs after the native listener has closed', async () => {
  const runtime = await realm(), exit = vi.fn();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const cleanup = vi.fn(() => pending);
  ownRealmShutdown(runtime.server, runtime.transport, cleanup, exit);
  vi.useFakeTimers();
  try {
    // This is the same path used by Colyseus' signal/uncaughtException handler, without exiting this test worker.
    const drain = runtime.server.gracefullyShutdown(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    release();
    await drain;
  } finally { release(); vi.useRealTimers(); runtime.diagnostics.stop(); }
});
