import { abortError, checkSignal, readBounded } from './baked-client-transport';

export interface BakedCompressedCache {
  get(gzipHash: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array | null>;
  put(gzipHash: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  delete(gzipHash: string, signal?: AbortSignal): Promise<void>;
}
export const BAKED_CACHE_BYTES = 64 * 1024 * 1024;
export const BAKED_CACHE_WAIT_MS = 250;
const CACHE_NAME = 'chatdom-baked-land-gzip-v1';
const SIZE_HEADER = 'x-chatdom-compressed-bytes';
const HASH = /^[a-f0-9]{64}$/;
interface CacheOptions { readonly storage?: CacheStorage | null; readonly byteBudget?: number; readonly origin?: string }

/** CacheStorage itself has no cancellation API. Bound the caller's wait and abort the continuation so
 * a late storage response cannot begin another operation. The losing promise always has a rejection
 * handler. A source disables its optional cache after a timeout, rather than paying this per blob. */
export async function boundedBakedCache<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal) checkSignal(signal);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    return await new Promise<T>((resolve, reject) => {
      abort = () => { controller.abort(); reject(abortError()); };
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        controller.abort(); reject(new DOMException('The optional landscape cache did not respond', 'TimeoutError'));
      }, BAKED_CACHE_WAIT_MS);
      void Promise.resolve().then(() => { checkSignal(controller.signal); return work(controller.signal); }).then(resolve, reject);
    });
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

/** Optional persistent compressed bytes only. The source verifies both digests on EVERY read.
 * Entries are evicted in insertion order. A busy writer or cross-tab lock skips optional mutations; no
 * queue retains compressed buffers while storage is stuck. Web Locks are requested with ifAvailable.
 * A second sweep restores the cap when Web Locks are unavailable. Caller waits are bounded and abortable. */
export function createBakedCache(options: CacheOptions = {}): BakedCompressedCache {
  let storage: CacheStorage | null | undefined;
  try { storage = options.storage === undefined ? globalThis.caches : options.storage; }
  catch { storage = null; }
  const budget = options.byteBudget ?? BAKED_CACHE_BYTES;
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > BAKED_CACHE_BYTES) throw new RangeError('Invalid baked cache budget');
  const origin = options.origin ?? globalThis.location?.origin ?? 'https://chatdom.gg';
  let writing = false;
  function key(hash: string): string {
    if (!HASH.test(hash)) throw new Error('Invalid baked cache key');
    return new URL(`/__chatdom/baked-land/gzip/v1/${hash}`, origin).href;
  }
  async function serial(work: (signal: AbortSignal) => Promise<void>, signal?: AbortSignal): Promise<void> {
    if (signal) checkSignal(signal);
    if (writing) return;
    writing = true;
    let started = false;
    try {
      await boundedBakedCache(async active => {
        started = true;
        try {
          const locks = globalThis.navigator?.locks;
          // Web Locks forbids combining signal with ifAvailable. The outer deadline/abort guards the
          // caller and the callback checks active before any storage operation, including a late grant.
          if (locks) await locks.request(CACHE_NAME, { ifAvailable: true }, async lock => {
            if (lock) { checkSignal(active); await work(active); }
          });
          else await work(active);
        } finally { writing = false; }
      }, signal);
    } finally { if (!started) writing = false; }
  }
  async function trim(cache: Cache, signal: AbortSignal, incoming = 0): Promise<void> {
    const entries: { request: Request; bytes: number }[] = [];
    let total = incoming;
    for (const request of await cache.keys()) {
      checkSignal(signal);
      const response = await cache.match(request), bytes = Number(response?.headers.get(SIZE_HEADER));
      checkSignal(signal);
      if (!response || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > budget) {
        await cache.delete(request); continue;
      }
      entries.push({ request, bytes }); total += bytes;
    }
    for (const entry of entries) {
      checkSignal(signal);
      if (total <= budget) break;
      await cache.delete(entry.request); total -= entry.bytes;
    }
  }
  return {
    async get(hash, maxBytes, signal) {
      checkSignal(signal);
      if (!storage || !budget) return null;
      return boundedBakedCache(async active => {
        const cache = await storage.open(CACHE_NAME);
        checkSignal(active);
        const response = await cache.match(key(hash));
        checkSignal(active);
        if (!response) return null;
        const declared = Number(response.headers.get(SIZE_HEADER));
        if (!Number.isSafeInteger(declared) || declared < 1 || declared > maxBytes) {
          await serial(async active => { checkSignal(active); await cache.delete(key(hash)); }, active);
          throw new Error('Corrupt baked cache size');
        }
        const bytes = await readBounded(response.body, maxBytes, active);
        if (bytes.byteLength !== declared) throw new Error('Corrupt baked cache size');
        return bytes;
      }, signal);
    },
    async put(hash, bytes, signal) {
      checkSignal(signal);
      if (!storage || !budget || bytes.byteLength > budget || !bytes.byteLength) return;
      await serial(async active => {
        checkSignal(active);
        const cache = await storage.open(CACHE_NAME), request = key(hash);
        checkSignal(active);
        await cache.delete(request); await trim(cache, active, bytes.byteLength);
        checkSignal(active);
        await cache.put(request, new Response(bytes.slice().buffer, { headers: {
          'content-type': 'application/gzip', [SIZE_HEADER]: String(bytes.byteLength),
        } }));
        checkSignal(active);
        await trim(cache, active);
        checkSignal(active);
      }, signal);
    },
    async delete(hash, signal) {
      if (signal) checkSignal(signal);
      if (!storage) return;
      await serial(async active => {
        const cache = await storage.open(CACHE_NAME); checkSignal(active); await cache.delete(key(hash));
      }, signal);
    },
  };
}
