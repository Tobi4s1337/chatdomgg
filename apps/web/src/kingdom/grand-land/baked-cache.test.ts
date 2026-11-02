import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBakedCache } from './baked-cache';

function persistentCache() {
  const entries = new Map<string, Response>();
  const url = (input: RequestInfo | URL) => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const cache = {
    async keys() { return [...entries.keys()].map(key => new Request(key)); },
    async match(input: RequestInfo | URL) { return entries.get(url(input))?.clone(); },
    async delete(input: RequestInfo | URL) { return entries.delete(url(input)); },
    async put(input: RequestInfo | URL, response: Response) { entries.set(url(input), response.clone()); },
  } as unknown as Cache;
  const storage = { async open() { return cache; } } as unknown as CacheStorage;
  return { entries, storage };
}
const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64);
const signal = new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); });

describe('bounded optional persistent baked cache', () => {
  it('persists only compressed bytes, survives reopening, and evicts oldest entries to enforce its byte cap', async () => {
    const { storage, entries } = persistentCache(), cache = createBakedCache({ storage, byteBudget: 64 });
    await cache.put(a, new Uint8Array(24).fill(1), signal);
    await cache.put(b, new Uint8Array(24).fill(2), signal);
    await cache.put(c, new Uint8Array(24).fill(3), signal);
    expect(entries.size).toBe(2); expect(await cache.get(a, 24, signal)).toBeNull();
    const reopened = createBakedCache({ storage, byteBudget: 64 });
    expect(await reopened.get(b, 24, signal)).toEqual(new Uint8Array(24).fill(2));
    expect(await reopened.get(c, 24, signal)).toEqual(new Uint8Array(24).fill(3));
    await reopened.delete(b); expect(await cache.get(b, 24, signal)).toBeNull();
  });

  it('skips concurrent writes instead of retaining a queue, and never keeps an item larger than the whole budget', async () => {
    const { storage, entries } = persistentCache(), cache = createBakedCache({ storage, byteBudget: 64 });
    await Promise.all([cache.put(a, new Uint8Array(40), signal), cache.put(b, new Uint8Array(40), signal), cache.put(c, new Uint8Array(80), signal)]);
    expect(entries.size).toBe(1); expect(await cache.get(a, 40, signal)).toHaveLength(40);
    expect(await cache.get(b, 40, signal)).toBeNull(); expect(await cache.get(c, 80, signal)).toBeNull();
  });

  it('rejects malformed stored size and caps the actual stored body even when its header lies', async () => {
    const { storage, entries } = persistentCache(), cache = createBakedCache({ storage, byteBudget: 64 });
    await cache.put(a, new Uint8Array(24), signal);
    const key = [...entries.keys()][0]!;
    entries.set(key, new Response(new Uint8Array(24), { headers: { 'x-chatdom-compressed-bytes': 'invalid' } }));
    await expect(cache.get(a, 24, signal)).rejects.toThrow('cache size'); expect(entries.size).toBe(0);
    entries.set(key, new Response(new Uint8Array(50), { headers: { 'x-chatdom-compressed-bytes': '24' } }));
    await expect(cache.get(a, 24, signal)).rejects.toThrow('stream exceeded');
  });

  it('is optional when unavailable and honours abort before creating or reading storage', async () => {
    const cache = createBakedCache({ storage: null });
    await cache.put(a, new Uint8Array(4), signal); expect(await cache.get(a, 4, signal)).toBeNull(); await cache.delete(a);
    const abort = new AbortController(); abort.abort();
    await expect(cache.put(a, new Uint8Array(4), abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(cache.get(a, 4, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('skips writes and corruption deletion immediately while another tab holds the lock', async () => {
    const request = vi.fn(async (_name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
      expect(options).toEqual({ ifAvailable: true });
      return callback(null);
    });
    vi.stubGlobal('navigator', { locks: { request } });
    const { storage, entries } = persistentCache(), open = vi.spyOn(storage, 'open');
    const cache = createBakedCache({ storage, byteBudget: 64 });
    await cache.put(a, new Uint8Array(24), signal); await cache.delete(a, signal);
    expect(request).toHaveBeenCalledTimes(2); expect(open).not.toHaveBeenCalled(); expect(entries.size).toBe(0);
  });

  it('settles abort while a lock request is unresolved and prevents a late grant from mutating storage', async () => {
    let grant!: () => Promise<void>;
    const request = vi.fn((_name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
      expect(options).toEqual({ ifAvailable: true });
      return new Promise<void>((resolve, reject) => {
        grant = async () => { await callback({ name: 'cache', mode: 'exclusive' }).then(resolve, reject); };
      });
    });
    vi.stubGlobal('navigator', { locks: { request } });
    const { storage } = persistentCache(), open = vi.spyOn(storage, 'open'), abort = new AbortController();
    const cache = createBakedCache({ storage, byteBudget: 64 });
    const pending = cache.put(a, new Uint8Array(24), abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1)); abort.abort(); await rejected;
    await grant(); expect(open).not.toHaveBeenCalled();
  });

  it('aborts stalled storage reads and writes, and skips deletion behind an unfinished writer', async () => {
    const storage = { open: vi.fn(() => new Promise<Cache>(() => {})) } as unknown as CacheStorage;
    const cache = createBakedCache({ storage }), readAbort = new AbortController(), writeAbort = new AbortController();
    const read = cache.get(a, 24, readAbort.signal), write = cache.put(a, new Uint8Array(24), writeAbort.signal);
    const readRejected = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    const writeRejected = expect(write).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(storage.open).toHaveBeenCalledTimes(2));
    readAbort.abort(); writeAbort.abort(); await Promise.all([readRejected, writeRejected]);
    await expect(cache.delete(a, signal)).resolves.toBeUndefined();
    expect(storage.open).toHaveBeenCalledTimes(2);
  });
});
