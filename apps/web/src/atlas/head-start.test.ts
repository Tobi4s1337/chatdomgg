import { afterEach, describe, expect, it, vi } from 'vitest';
import { bakerCount, headStart } from './head-start';

const ID = 'pv-20261102T125607Z-8887bf7756d2';
const pointerBody = JSON.stringify({ version: 1, id: ID, world: { sha256: 'a'.repeat(64), bytes: 10 } });

/** A fetch that records each call and answers from a table; `hold` keeps a URL pending until released. */
function fakeFetch(table: Record<string, () => Response | Promise<Response>>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      const answer = table[url];
      if (!answer) return reject(new TypeError('network'));
      Promise.resolve(answer()).then(resolve, reject);
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the first frame’s head start', () => {
  it('reads the pointer at once and then the world it names, the same request the reader makes', async () => {
    const { fetcher, calls } = fakeFetch({
      '/map-data/v1/preview': () => new Response(pointerBody),
      [`/map-data/v1/preview/${ID}/world.json`]: () => new Response('{"world":1}'),
    });
    const head = headStart('/map-data', { fetch: fetcher, bakers: false });
    expect(calls.map(c => c.url)).toEqual(['/map-data/v1/preview']);
    expect(calls[0]!.init?.credentials).toBe('omit');
    await settle();
    expect(calls.map(c => c.url)).toEqual(['/map-data/v1/preview', `/map-data/v1/preview/${ID}/world.json`]);

    const pointer = head.take('/map-data/v1/preview');
    expect(await (await pointer!).text()).toBe(pointerBody);
    expect(head.take('/map-data/v1/preview')).toBeNull();
    expect(await (await head.take(`/map-data/v1/preview/${ID}/world.json`)!).text()).toBe('{"world":1}');
    // Nothing else is answered early, and nothing was asked twice.
    expect(head.take('/map-data/v1/roads/x/busiest')).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('asks again the ordinary way when the early read failed', async () => {
    let first = true;
    const { fetcher, calls } = fakeFetch({
      '/map-data/v1/preview': () => {
        if (first) {
          first = false;
          throw new TypeError('offline for a moment');
        }
        return new Response(pointerBody);
      },
    });
    const head = headStart('/map-data', { fetch: fetcher, bakers: false });
    const controller = new AbortController();
    const response = await head.take('/map-data/v1/preview', { signal: controller.signal, credentials: 'omit' })!;
    expect(await response.text()).toBe(pointerBody);
    expect(calls.map(c => c.url)).toEqual(['/map-data/v1/preview', '/map-data/v1/preview']);
    expect(calls[1]!.init?.signal).toBe(controller.signal);
  });

  it('binds a taken read to the reader’s signal, so its timeout or disposal aborts the early request', async () => {
    let release!: (response: Response) => void;
    const { fetcher, calls } = fakeFetch({ '/map-data/v1/preview': () => new Promise<Response>(resolve => { release = resolve; }) });
    const head = headStart('/map-data', { fetch: fetcher, bakers: false });
    const controller = new AbortController();
    const taken = head.take('/map-data/v1/preview', { signal: controller.signal })!;
    controller.abort();
    await expect(taken).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls[0]!.init?.signal?.aborted).toBe(true);
    // An aborted read is not asked again behind the reader's back.
    expect(calls).toHaveLength(1);
    release(new Response(pointerBody));
  });

  it('asks for no world when the pointer is not a pointer, and drops everything untaken when done', async () => {
    const { fetcher, calls } = fakeFetch({ '/map-data/v1/preview': () => new Response(JSON.stringify({ id: '../../etc/passwd' })) });
    const head = headStart('/map-data', { fetch: fetcher, bakers: false });
    await settle();
    expect(calls.map(c => c.url)).toEqual(['/map-data/v1/preview']);

    const held = fakeFetch({ '/x/v1/preview': () => new Promise<Response>(() => undefined) });
    const other = headStart('/x', { fetch: held.fetcher, bakers: false });
    other.done();
    expect(held.calls[0]!.init?.signal?.aborted).toBe(true);
    expect(other.take('/x/v1/preview')).toBeNull();
    head.done();
    head.done();
  });

  it('starts the still’s bakers on the stamp sheet, hands them over once and never hands over one that failed', () => {
    const made: FakeWorker[] = [];
    class FakeWorker {
      onerror: ((event: { preventDefault(): void }) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      posted: unknown[] = [];
      terminated = false;
      constructor(public url: URL, public options: WorkerOptions) { made.push(this); }
      postMessage(message: unknown) { this.posted.push(message); }
      terminate() { this.terminated = true; }
    }
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    const { fetcher } = fakeFetch({});
    const head = headStart('/map-data', { fetch: fetcher });
    expect(made).toHaveLength(bakerCount(8));
    for (const worker of made) {
      expect(worker.posted).toEqual([{ type: 'sheet', stampsUrl: expect.stringMatching(/stamps.*\.webp/) }]);
      expect(worker.options).toMatchObject({ type: 'module' });
    }
    made[1]!.onerror!({ preventDefault() {} });
    const handed = head.bakers();
    expect(handed).toHaveLength(made.length - 1);
    expect(made[1]!.terminated).toBe(true);
    expect(handed.every(worker => !(worker as unknown as FakeWorker).terminated)).toBe(true);
    expect(head.bakers()).toEqual([]);
    // Handed bakers are the still's: finishing the head start leaves them running.
    head.done();
    expect(handed.every(worker => !(worker as unknown as FakeWorker).terminated)).toBe(true);

    const untaken = headStart('/map-data', { fetch: fetcher });
    const mine = made.slice(-bakerCount(8));
    untaken.done();
    expect(mine.every(worker => worker.terminated)).toBe(true);
    expect(untaken.bakers()).toEqual([]);
  });

  it('makes as many bakers as the still would', () => {
    expect([undefined, 1, 2, 3, 8, 32].map(bakerCount)).toEqual([1, 1, 1, 2, 4, 4]);
  });
});
