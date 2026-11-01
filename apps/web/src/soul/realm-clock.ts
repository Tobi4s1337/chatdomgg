/** Realm process time estimated at the midpoint of an HTTP round trip.
 * Only presentation uses it: one-way network delays are unknown, and it grants no authority. */
export function createRealmSoulClock(options: {
  url?: string; now?: () => number; fetch?: typeof fetch;
} = {}) {
  const now = options.now ?? (() => performance.now()), fetcher = options.fetch ?? fetch;
  let anchor: { epoch: number; mono: number } | undefined;
  let last = -Infinity;
  let generation = 0;
  function read(): number | null {
    if (!anchor) return null;
    last = Math.max(last, anchor.epoch + Math.max(0, now() - anchor.mono));
    return last;
  }
  return {
    now: read,
    async sync(signal?: AbortSignal): Promise<boolean> {
      const id = ++generation, start = now();
      try {
        const timeout = AbortSignal.timeout(10_000);
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const response = await fetcher(options.url ?? '/api/realm/clock', { cache: 'no-store', signal: requestSignal });
        if (!response.ok) return false;
        const body: unknown = await response.json(), end = now();
        if (requestSignal.aborted || id !== generation || !Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 10_000
          || typeof body !== 'object' || body === null || !('version' in body) || body.version !== 1
          || !('serverTime' in body) || typeof body.serverTime !== 'number' || !Number.isFinite(body.serverTime)
          || body.serverTime < Date.UTC(1900, 0, 6) || body.serverTime >= Date.UTC(9999, 0, 1)) return false;
        const estimate = body.serverTime + (end - start) / 2;
        anchor = { epoch: Math.max(read() ?? -Infinity, estimate), mono: end };
        last = anchor.epoch;
        return true;
      } catch { return false; }
    },
  };
}
