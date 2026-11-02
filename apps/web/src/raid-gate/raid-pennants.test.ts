import { afterEach, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, type RaidPennantFrame } from '@chatdom/shared';
import { createRaidPennantFeed } from '../kingdom/moments/raid-pennants';

const now = 1_800_000_000_000;
const frame: RaidPennantFrame = { version: 1, origin: 'simulated', kingdomId: KingdomIdSchema.parse('202'), asOf: now,
  items: [{ raidId: `raid.${'a'.repeat(64)}`, from: { kingdomId: KingdomIdSchema.parse('101'), login: 'visitor', name: 'Visitor' }, occurredAt: now - 1000 }] };
const response = (v: unknown) => new Response(JSON.stringify(v));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('pennant history reader', () => {
  it('polls every three seconds and retains the last good frame across failures and wrong scope', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(response(frame)).mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(response({ ...frame, kingdomId: '303' })).mockResolvedValueOnce(response({ ...frame, origin: 'live' }));
    vi.stubGlobal('fetch', fetcher);
    const receive = vi.fn(), stop = createRaidPennantFeed(frame.kingdomId, 'simulated', () => now).subscribe(receive);
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(3000);
    expect(fetcher).toHaveBeenCalledTimes(4); expect(receive).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenCalledWith(frame); stop();
  });
  it('pauses while hidden and resumes immediately when visible', async () => {
    vi.useFakeTimers();
    class Visibility extends EventTarget { hidden = false; }
    const doc = new Visibility(), fetcher = vi.fn().mockImplementation(async () => response(frame));
    vi.stubGlobal('document', doc); vi.stubGlobal('fetch', fetcher);
    const stop = createRaidPennantFeed(frame.kingdomId, 'simulated', () => now).subscribe(vi.fn());
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(9000); expect(fetcher).toHaveBeenCalledTimes(1);
    doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); stop();
  });
  it('rejects an oversized streamed body and does not invent an empty frame', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(96 * 1024 + 1)); controller.close();
    } })));
    vi.stubGlobal('fetch', fetcher);
    const receive = vi.fn(), stop = createRaidPennantFeed(frame.kingdomId, 'simulated', () => now).subscribe(receive);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(receive).not.toHaveBeenCalled(); stop();
  });
  it('cancels a body rejected by its advertised size before reading it', async () => {
    const cancel = vi.fn(), body = new ReadableStream({ cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-length': String(96 * 1024 + 1) } })));
    const receive = vi.fn(), stop = createRaidPennantFeed(frame.kingdomId, 'simulated', () => now).subscribe(receive);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(receive).not.toHaveBeenCalled(); stop();
  });
  it('aborts a stalled request after three seconds and ignores late answers after unsubscribe', async () => {
    vi.useFakeTimers(); let resolve!: (r: Response) => void; let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_url, options) => { signal = options.signal; return new Promise<Response>(r => { resolve = r; }); }));
    const receive = vi.fn(), stop = createRaidPennantFeed(frame.kingdomId, 'simulated', () => now).subscribe(receive);
    await vi.advanceTimersByTimeAsync(3000); expect(signal.aborted).toBe(true);
    stop(); resolve(response(frame)); await vi.advanceTimersByTimeAsync(0);
    expect(receive).not.toHaveBeenCalled();
  });
});
