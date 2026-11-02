import { afterEach, expect, it, vi } from 'vitest';
import { createDockConnection } from './dock-connection';

afterEach(() => vi.unstubAllGlobals());
it('an observing view cannot accept a presenter grant or acknowledge a royal act', async () => {
  const listeners = new Map<string, (event: { data: string }) => void>(), close = vi.fn(), fetcher = vi.fn();
  vi.stubGlobal('EventSource', class {
    addEventListener(type: string, receive: (event: { data: string }) => void) { listeners.set(type, receive); }
    close = close;
  });
  vi.stubGlobal('fetch', fetcher);
  const connection = createDockConnection('129634568', { readOnly: true });
  const off = connection.subscribe(() => {});
  listeners.get('presenter')!({ data: JSON.stringify({ presenterToken: 'a'.repeat(48) }) });
  await expect(connection.witness({ kingdomId: '129634568', streamEventId: 'event' } as Parameters<typeof connection.witness>[0]))
    .rejects.toThrow('only observes');
  expect(fetcher).not.toHaveBeenCalled();
  off(); connection.dispose();
  expect(close).toHaveBeenCalledOnce();
});
