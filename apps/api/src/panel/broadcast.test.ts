import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';
import { setTimeout as wait } from 'node:timers/promises';
import { createPanelBroadcaster } from './broadcast';

const secret = Buffer.alloc(32, 7).toString('base64');
const state = (cursor = 1) => ({ version: 1, status: 'kingdom', stream: 'live', lights: 3,
  publicEvent: { type: 'home', cursor, at: cursor * 100 }, revision: String(cursor), privateWords: 'never broadcast this' });
const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
// Wait for the actual native WebCrypto completion without advancing the tested rate-limit clock.
const sent = async (send: ReturnType<typeof vi.fn<typeof fetch>>, count: number) => {
  for (let i = 0; i < 200 && send.mock.calls.length < count; i++) await wait(5);
  await settle();
  expect(send).toHaveBeenCalledTimes(count);
};
const workers: ReturnType<typeof createPanelBroadcaster>[] = [];
function setup(extra: Partial<Parameters<typeof createPanelBroadcaster>[0]> = {}) {
  const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  const read = vi.fn(async () => state());
  const worker = createPanelBroadcaster({ extensionId: 'extension', extensionSecret: secret, ownerId: '999', read, fetch: send, ...extra });
  workers.push(worker);
  return { worker, send, read };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => { workers.splice(0).forEach(worker => worker.dispose()); vi.useRealTimers(); });

describe('panel broadcast invalidation', () => {
  it('does nothing without valid extension credentials and an explicit owner identity', async () => {
    for (const credentials of [{ extensionId: '' }, { extensionSecret: '' }, { extensionSecret: 'invalid' }, { ownerId: '' }, { ownerId: 'not-a-twitch-id' }]) {
      const { worker, read, send } = setup(credentials); worker.start(); worker.touch('123', state()); worker.observe('123', state(2));
      await vi.advanceTimersByTimeAsync(2_000); await worker.tick();
      expect(worker.size()).toBe(0); expect(read).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    }
    const read = vi.fn(async () => state()), send = vi.fn<typeof fetch>();
    const worker = createPanelBroadcaster({ extensionId: 'extension', extensionSecret: secret, read, fetch: send });
    workers.push(worker); worker.start(); worker.touch('123', state()); worker.observe('123', state(2));
    await vi.advanceTimersByTimeAsync(2_000); await worker.tick();
    expect(worker.size()).toBe(0); expect(read).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it('sets a baseline silently and sends only a channel-scoped signed invalidation', async () => {
    const { worker, send } = setup(); worker.observe('123', state()); await settle(); expect(send).not.toHaveBeenCalled();
    worker.observe('123', state(2)); await sent(send, 1);
    expect(send).toHaveBeenCalledOnce();
    const [url, init] = send.mock.calls[0]!;
    expect(url).toBe('https://api.twitch.tv/helix/extensions/pubsub');
    const headers = init!.headers as Record<string, string>;
    const { payload } = await jwtVerify(headers.authorization!.slice(7), Buffer.from(secret, 'base64'), { currentDate: new Date(Date.now()) });
    expect(payload).toEqual({ role: 'external', user_id: '999', channel_id: '123', pubsub_perms: { send: ['broadcast'] }, exp: 1060 });
    expect(headers['client-id']).toBe('extension');
    expect(JSON.parse(String(init!.body))).toEqual({ broadcaster_id: '123', target: ['broadcast'], message: '{"version":1,"type":"panel.refresh"}' });
    expect(String(init!.body)).not.toContain('never broadcast');
  });

  it('coalesces pending changes at one second and isolates channel cooldowns', async () => {
    let unblock!: (response: Response) => void;
    const send = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => { unblock = resolve; }))
      .mockImplementation(async () => new Response(null, { status: 204 }));
    const { worker } = setup({ fetch: send, read: async id => state(id === '123' ? 4 : 2) });
    worker.observe('123', state()); worker.observe('456', state()); worker.observe('123', state(2)); await sent(send, 1);
    worker.observe('123', state(3)); worker.observe('123', state(4)); worker.observe('456', state(2)); await sent(send, 2);
    expect(send).toHaveBeenCalledTimes(2);
    unblock(new Response(null, { status: 204 })); await settle();
    await vi.advanceTimersByTimeAsync(999); await worker.tick(); expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); await worker.tick(); expect(send).toHaveBeenCalledTimes(3);
    await worker.tick(); expect(send).toHaveBeenCalledTimes(3);
  });

  it('watches realm commits within 500ms without treating private changes as moments', async () => {
    let source = state();
    const { worker, send, read } = setup({ read: async () => source });
    worker.touch('123', source); worker.start();
    source = { ...source, revision: 'private-revision', privateWords: 'private refused words changed' };
    await vi.advanceTimersByTimeAsync(500); expect(send).not.toHaveBeenCalled();
    source = state(2); await vi.advanceTimersByTimeAsync(500); await sent(send, 1);
    expect(read).not.toHaveBeenCalled();
  });

  it('expires active channels, caps the registry and clears timer and pending writes on dispose', async () => {
    const { worker, send, read } = setup({ maxChannels: 2, ttlMs: 1_000 });
    worker.start(); worker.touch('123', state()); worker.touch('456', state()); worker.touch('789', state());
    expect(worker.size()).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000); expect(worker.size()).toBe(0);
    worker.touch('789', state()); worker.dispose();
    const count = read.mock.calls.length; await vi.advanceTimersByTimeAsync(10_000);
    worker.touch('123', state(2)); await worker.tick();
    expect(worker.size()).toBe(0); expect(read).toHaveBeenCalledTimes(count); expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts an in-flight send when disposed', async () => {
    const send = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const { worker } = setup({ fetch: send }); worker.observe('123', state()); worker.observe('123', state(2)); await sent(send, 1);
    const signal = send.mock.calls[0]![1]!.signal!;
    worker.dispose(); expect(signal.aborted).toBe(true); expect(worker.size()).toBe(0);
  });

  it('bounds retries for failed writes and retries a later real change', async () => {
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    const { worker } = setup({ fetch: send, read: async () => state(2) });
    worker.observe('123', state()); worker.observe('123', state(2)); await sent(send, 1);
    for (let i = 0; i < 20; i++) { await vi.advanceTimersByTimeAsync(500); await worker.tick(); }
    expect(send).toHaveBeenCalledTimes(3);
    worker.observe('123', state(3)); await sent(send, 4);
  });
});
