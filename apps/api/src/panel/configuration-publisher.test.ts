import { randomBytes, randomUUID } from 'node:crypto';
import { jwtVerify } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, parsePanelSettings } from '../../../panel/src/settings/schema';
import { createPanelConfigurationPublisher } from './configuration-publisher';

const key = randomBytes(32), secret = key.toString('base64'), extensionId = 'testextension', bindingId = randomUUID();
const reading = { version: 1, status: 'settings', revision: '2', settings: parsePanelSettings(DEFAULT_SETTINGS)!, connected: true };
const content = JSON.stringify(reading);
const claim = { version: 1, status: 'claimed', kingdomId: '123', claimId: randomUUID(), reading };
const record = (body: unknown) => body as Record<string, unknown>;
const segment = (value: string | null, overrides: Record<string, unknown> = {}) => Response.json({ data: value === null ? [] : [{ broadcaster_id: '123', segment: 'broadcaster', version: '1', content: value, ...overrides }] });

function setup() {
  let remote: string | null = null;
  let jobs = 1;
  const realm = vi.fn(async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    if (path.endsWith('mirror-activate')) return { version: 1, status: 'activated', bindingId };
    if (path.endsWith('mirror-claim')) return jobs-- > 0 ? claim : { version: 1, status: 'idle' };
    if (path.endsWith('mirror-permit')) return { version: 1, status: 'permit', allowed: true, retryAfterMs: 0 };
    return { version: 1, status: 'finished', publication: record(body).content === content ? 'verified' : 'pending' };
  });
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'PUT') { remote = String(record(JSON.parse(String(init.body)) as unknown).content); return new Response(null, { status: 204 }); }
    return segment(remote);
  });
  const options = { extensionId, extensionSecret: secret, ownerId: '999', enabled: true, realm, fetch: fetcher, concurrency: 1 };
  const worker = createPanelConfigurationPublisher(options);
  return { worker, realm, fetcher, options, finish: () => realm.mock.calls.filter(([path]) => path.endsWith('mirror-finish')).map(([, body]) => record(body)),
    remote: (value: string | null) => { remote = value; }, retry: () => { jobs++; } };
}

describe('server-owned Extension Configuration publisher', () => {
  afterEach(() => vi.useRealTimers());

  it('signs current owner JWTs, writes the canonical reading, and acknowledges only a verified GET', async () => {
    const test = setup();
    await test.worker.tick();
    expect(test.fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'PUT', 'GET']);
    for (const [url, init] of test.fetcher.mock.calls) {
      expect(new URL(String(url)).origin).toBe('https://api.twitch.tv');
      const headers = new Headers(init?.headers);
      expect(headers.get('client-id')).toBe(extensionId);
      const jwt = await jwtVerify(headers.get('authorization')!.slice(7), key, { algorithms: ['HS256'] });
      expect(jwt.payload).toMatchObject({ role: 'external', user_id: '999' });
      expect(Number(jwt.payload.exp)).toBeGreaterThan(Date.now() / 1000);
      expect(jwt.payload).not.toHaveProperty('opaque_user_id');
    }
    const put = test.fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ extension_id: extensionId, broadcaster_id: '123', segment: 'broadcaster', version: '1', content });
    expect(test.finish()).toEqual([{ kingdomId: '123', claimId: claim.claimId, extensionId, bindingId, content }]);
    expect(test.realm.mock.calls.filter(([path]) => path.endsWith('mirror-permit'))).toHaveLength(3);
    test.worker.dispose();
  });

  it('recovers an uncertain PUT with a later GET, without writing an already matching segment again', async () => {
    const test = setup();
    test.fetcher.mockImplementationOnce(async () => segment(null));
    test.fetcher.mockImplementationOnce(async () => { test.remote(content); throw new Error('Lost PUT response after remote commit.'); });
    await test.worker.tick();
    expect(test.finish()[0]).not.toHaveProperty('content');
    test.retry();
    await createPanelConfigurationPublisher(test.options).tick();
    expect(test.fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'PUT', 'GET']);
    expect(test.finish()[1]).toHaveProperty('content', content);
  });

  it('repairs late abandoned writes on a later audit, including connected state', async () => {
    const test = setup(); test.remote(content);
    await test.worker.tick();
    test.remote(JSON.stringify({ ...reading, revision: '1', connected: false }));
    test.retry(); await test.worker.tick();
    expect(test.fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'GET', 'PUT', 'GET']);
    expect(test.finish()).toHaveLength(2);
    expect(test.finish().every(reply => reply.content === content)).toBe(true);
  });

  it('repairs a held old PUT that lands after a newer worker has published and acknowledged', async () => {
    vi.useFakeTimers();
    const test = setup();
    const latest = { ...reading, revision: '3', connected: false }, latestContent = JSON.stringify(latest);
    let wanted = reading, available = true, remote: string | null = null;
    let enter!: () => void, releaseOld!: () => void;
    const held = new Promise<void>(resolve => { enter = resolve; });
    test.realm.mockImplementation(async (path, body) => {
      if (path.endsWith('mirror-activate')) return { version: 1, status: 'activated', bindingId };
      if (path.endsWith('mirror-permit')) return { version: 1, status: 'permit', allowed: true, retryAfterMs: 0 };
      if (path.endsWith('mirror-claim')) {
        if (!available) return { version: 1, status: 'idle' };
        available = false; return { ...claim, claimId: randomUUID(), reading: wanted };
      }
      return { version: 1, status: 'finished', publication: record(body).content === JSON.stringify(wanted) ? 'verified' : 'pending' };
    });
    test.fetcher.mockImplementation(async (_url, init) => {
      if (init?.method !== 'PUT') return segment(remote);
      const value = String(record(JSON.parse(String(init.body)) as unknown).content);
      if (value === content) {
        enter();
        // Deliberately ignore cancellation: Twitch may have accepted a timed-out request already.
        return new Promise<Response>(resolve => { releaseOld = () => { remote = value; resolve(new Response(null, { status: 204 })); }; });
      }
      remote = value; return new Response(null, { status: 204 });
    });
    const interrupted = test.worker.tick(); await held;
    await vi.advanceTimersByTimeAsync(5001); await interrupted;
    expect(test.finish()[0]).not.toHaveProperty('content');
    wanted = latest; available = true;
    const replacement = createPanelConfigurationPublisher(test.options);
    await replacement.tick();
    expect(remote).toBe(latestContent);
    expect(test.finish()[1]).toHaveProperty('content', latestContent);
    releaseOld(); await Promise.resolve();
    expect(remote).toBe(content);
    available = true; await replacement.tick();
    expect(remote).toBe(latestContent);
    expect(test.finish()[2]).toHaveProperty('content', latestContent);
    test.worker.dispose(); replacement.dispose();
  });

  it('keeps failed or mismatched readback pending and closes unsupported versions and channel mismatches', async () => {
    for (const failure of [segment(content, { version: '2' }), segment(content, { broadcaster_id: '456' }),
      new Response('unavailable', { status: 503 }), new Response('x'.repeat(8193))]) {
      const test = setup(); test.fetcher.mockResolvedValueOnce(failure);
      await test.worker.tick();
      expect(test.fetcher).toHaveBeenCalledTimes(1);
      expect(test.finish()[0]).not.toHaveProperty('content');
    }
    const test = setup();
    test.fetcher.mockResolvedValueOnce(segment(null)).mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(segment(JSON.stringify({ ...reading, revision: '1' })));
    await test.worker.tick();
    expect(test.finish()[0]).not.toHaveProperty('content');
  });

  it('repairs unknown public fields from trusted authority instead of acknowledging their presence', async () => {
    const test = setup(); test.remote(JSON.stringify({ ...reading, privateExtra: true }));
    await test.worker.tick();
    expect(test.fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'PUT', 'GET']);
    expect(test.finish()[0]).toHaveProperty('content', content);
  });

  it('requires deliberate enablement and explicit extension owner metadata', async () => {
    const test = setup();
    for (const changed of [{ enabled: false }, { enabled: undefined }, { ownerId: '' }, { extensionSecret: '' }, { extensionId: '' }]) {
      const options = { ...test.options, ...changed };
      const worker = createPanelConfigurationPublisher({ ...options, enabled: options.enabled === true });
      worker.start(); await worker.tick(); worker.dispose();
    }
    expect(test.realm).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
  });

  it('never sends HTTP after a durable claim is fenced or runs overlapping ticks', async () => {
    const test = setup();
    test.realm.mockImplementation(async path => path.endsWith('mirror-activate') ? { version: 1, status: 'activated', bindingId } : path.endsWith('mirror-claim') ? claim
      : path.endsWith('mirror-permit') ? { version: 1, status: 'permit', allowed: false, retryAfterMs: 0 }
        : { version: 1, status: 'finished', publication: 'pending' });
    await Promise.all([test.worker.tick(), test.worker.tick(), test.worker.tick()]);
    expect(test.realm.mock.calls.filter(([path]) => path.endsWith('mirror-claim'))).toHaveLength(1);
    expect(test.fetcher).not.toHaveBeenCalled(); expect(test.finish()[0]).not.toHaveProperty('content');
  });

  it('activates once and never resurrects a publisher fenced by a newer deployment', async () => {
    const test = setup();
    test.realm.mockImplementation(async path => path.endsWith('mirror-activate')
      ? { version: 1, status: 'activated', bindingId } : { version: 1, status: 'fenced' });
    await test.worker.tick(); await test.worker.tick();
    expect(test.realm.mock.calls.map(([path]) => path.split('/').at(-1))).toEqual(['settings-mirror-activate', 'settings-mirror-claim']);
    expect(test.fetcher).not.toHaveBeenCalled();
  });

  it('bounds a provider that ignores AbortSignal and disposes without a fabricated acknowledgement', async () => {
    const test = setup();
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    test.fetcher.mockImplementation(async () => { entered(); return new Promise<Response>(() => {}); });
    const running = test.worker.tick(); await waiting;
    test.worker.dispose(); await running;
    expect(test.finish()).toEqual([]);
  });

  it('times out an ignored fetch and a hung response stream locally, leaving durable retry pending', async () => {
    vi.useFakeTimers();
    for (const kind of ['fetch', 'body']) {
      const test = setup();
      let entered!: () => void;
      const waiting = new Promise<void>(resolve => { entered = resolve; });
      test.fetcher.mockImplementation(async () => {
        entered();
        return kind === 'fetch' ? new Promise<Response>(() => {}) : new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) }));
      });
      const running = test.worker.tick(); await waiting;
      await vi.advanceTimersByTimeAsync(5001); await running;
      expect(test.finish()[0]).not.toHaveProperty('content');
      test.worker.dispose();
    }
  });
});
