import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAND_PROBE_TIMEOUT_MS, probePublishedLand } from './land-availability';

const receipt = { kingdomId: '129634568', sceneHash: 'af'.repeat(32) };
const path = `/api/realm/land/129634568/${receipt.sceneHash}`;
const body = new TextEncoder().encode('{"version":1}');

afterEach(() => { vi.useRealTimers(); });

describe('published land probe', () => {
  it('hands an answered binding over unread by policy, from the receipt-bound path', async () => {
    const fetch = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await probePublishedLand({ kingdomId: '129634568', receipt, fetch });
    expect(fetch).toHaveBeenCalledWith(path, expect.objectContaining({ credentials: 'same-origin' }));
    expect(result).toEqual({ kind: 'published', binding: body });
  });

  it('keeps today\'s land when the realm has no binding for this receipt', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    expect(await probePublishedLand({ kingdomId: '129634568', receipt, fetch })).toEqual({ kind: 'absent', reason: 'unpublished' });
  });

  it('keeps today\'s land when the realm never answers (a realm without land routes)', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = probePublishedLand({ kingdomId: '129634568', receipt, fetch });
    await vi.advanceTimersByTimeAsync(LAND_PROBE_TIMEOUT_MS);
    expect(await pending).toEqual({ kind: 'absent', reason: 'unanswered' });
  });

  it('keeps today\'s land offline and on a server error', async () => {
    expect(await probePublishedLand({ kingdomId: '129634568', receipt, fetch: async () => { throw new TypeError('Failed to fetch'); } }))
      .toEqual({ kind: 'absent', reason: 'unreachable' });
    expect(await probePublishedLand({ kingdomId: '129634568', receipt, fetch: async () => new Response(null, { status: 503 }) }))
      .toEqual({ kind: 'absent', reason: 'unreachable' });
  });

  it('fails closed on an oversized binding instead of choosing a land', async () => {
    const fetch = async () => new Response(new Uint8Array(5000), { status: 200, headers: { 'content-type': 'application/json' } });
    await expect(probePublishedLand({ kingdomId: '129634568', receipt, fetch })).rejects.toThrow();
  });

  it('propagates the kingdom closing and rejects a mismatched identity', async () => {
    const closing = new AbortController(); closing.abort(new DOMException('closed', 'AbortError'));
    await expect(probePublishedLand({ kingdomId: '129634568', receipt, signal: closing.signal, fetch: async () => new Response(null) })).rejects.toThrow('closed');
    await expect(probePublishedLand({ kingdomId: '1', receipt, fetch: async () => new Response(null) })).rejects.toThrow('another kingdom');
    await expect(probePublishedLand({ kingdomId: '129634568', receipt: { ...receipt, sceneHash: '../x' }, fetch: async () => new Response(null) })).rejects.toThrow('Invalid');
  });
});
