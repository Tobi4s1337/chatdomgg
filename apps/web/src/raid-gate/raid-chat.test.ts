import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, type RaidChatFrame } from '@chatdom/shared';
import { createRaidChatFeed } from '../kingdom/moments/raid-chat';

const kingdom = KingdomIdSchema.parse('123');
const now = 1_700_000_000_000;
const frame = (overrides: Record<string, unknown> = {}) => ({ version: 1, kingdomId: kingdom, origin: 'live', asOf: now, lights: [], cues: [], ...overrides });
const cue = { version: 1, id: `raid-chat.${'a'.repeat(64)}`, lightId: `raid-light.${'b'.repeat(64)}`,
  kingdomId: kingdom, origin: 'live', asOf: now, expiresAt: now + 10_000,
  raid: { raidId: `raid.${'c'.repeat(64)}`, fromKingdomId: '456', fromName: 'Guest' }, parts: [{ kind: 'text', text: 'Hello' }] };
const light = { lightId: cue.lightId, kingdomId: kingdom, origin: 'live', asOf: now, expiresAt: now + 90_000, raid: cue.raid };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

class Visibility extends EventTarget {
  hidden = false;
  change(hidden: boolean) { this.hidden = hidden; this.dispatchEvent(new Event('visibilitychange')); }
}
let visibility: Visibility;
beforeEach(() => {
  vi.useFakeTimers();
  visibility = new Visibility();
  vi.stubGlobal('document', visibility);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('public raid chat reader', () => {
  it('reads the encoded public route with no cache, and validates the destination and origin', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(frame({ lights: [light], cues: [cue] }))))
      .mockResolvedValueOnce(new Response(JSON.stringify(frame({ kingdomId: '999', lights: [{ ...light, kingdomId: '999' }], cues: [{ ...cue, kingdomId: '999' }] }))))
      .mockResolvedValueOnce(new Response(JSON.stringify(frame({ origin: 'simulated', lights: [{ ...light, origin: 'simulated' }], cues: [{ ...cue, origin: 'simulated' }] }))));
    vi.stubGlobal('fetch', fetcher);
    const receive = vi.fn<(value: RaidChatFrame) => void>();
    const stop = createRaidChatFeed(kingdom, 'live', () => now).subscribe(receive);
    await flush();
    expect(fetcher.mock.calls[0]![0]).toBe('/live-realm-data/realm/raid-chat/123');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
    expect(receive).toHaveBeenLastCalledWith(frame({ lights: [light], cues: [cue] }));
    await vi.advanceTimersByTimeAsync(750); await flush();
    expect(receive).toHaveBeenLastCalledWith(frame());
    await vi.advanceTimersByTimeAsync(750); await flush();
    expect(receive).toHaveBeenLastCalledWith(frame());
    expect(receive).toHaveBeenCalledTimes(3);
    stop();
  });

  it('cancels an oversized stream before parsing it', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(96 * 1024 + 1)); }, cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    const receive = vi.fn();
    const stop = createRaidChatFeed(kingdom, 'live', () => now).subscribe(receive);
    await flush();
    expect(cancel).toHaveBeenCalledOnce();
    expect(receive).toHaveBeenCalledWith(frame());
    stop();
  });

  it('ignores a response arriving after unsubscribe and aborts its request', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn().mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetcher);
    const receive = vi.fn();
    const stop = createRaidChatFeed(kingdom, 'live', () => now).subscribe(receive);
    const signal = fetcher.mock.calls[0]![1].signal as AbortSignal;
    stop(); expect(signal.aborted).toBe(true);
    resolve(new Response(JSON.stringify(frame()))); await flush();
    expect(receive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('aborts and clears while hidden, resumes once visible, and removes its listener on stop', async () => {
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetcher);
    const receive = vi.fn();
    const stop = createRaidChatFeed(kingdom, 'live', () => now).subscribe(receive);
    const signal = fetcher.mock.calls[0]![1].signal as AbortSignal;
    visibility.change(true);
    expect(signal.aborted).toBe(true); expect(receive).toHaveBeenLastCalledWith(frame());
    await vi.advanceTimersByTimeAsync(4000); expect(fetcher).toHaveBeenCalledOnce();
    visibility.change(false); expect(fetcher).toHaveBeenCalledTimes(2);
    stop(); visibility.change(true); visibility.change(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
