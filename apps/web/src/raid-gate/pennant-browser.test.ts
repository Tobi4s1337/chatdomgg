import { afterEach, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, RAID_PENNANT_FRAME_MAX_BYTES, type RaidPennantArchivePage, type RaidPennantFrame } from '@chatdom/shared';
import { raidPennantTriggerTop, type RaidPennantBrowserState } from './pennant-browser';
import { createRaidPennantArchiveReader, createRaidPennantBrowser } from '../kingdom/moments/raid-pennant-browser';

const kingdomId = KingdomIdSchema.parse('1'), now = 100_000;
const item = (n: number) => ({ raidId: `raid.${n.toString(16).padStart(64, '0')}`, from: { kingdomId: KingdomIdSchema.parse('2'), login: 'visitor', name: 'Visitor' }, occurredAt: n });
const frame = (n: number): RaidPennantFrame => ({ version: 1, origin: 'live', kingdomId, asOf: now, items: [item(n)] });
const page = (n: number): RaidPennantArchivePage => ({ ...frame(n), next: n > 1 ? `pennants:1:live:1:100:${n - 1}` : null });
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('archive browser', () => {
  it('browses 80 pages with one visible page and restores the newest live frame', async () => {
    const read = vi.fn(async (cursor: string | null) => page(cursor ? Number(cursor.split(':').at(-1)) : 80));
    const present = vi.fn(), abort = new AbortController();
    const browser = createRaidPennantBrowser({ reader: { origin: 'live', read }, kingdomId, origin: 'live', clock: () => now, present, signal: abort.signal });
    const current: { state: RaidPennantBrowserState } = { state: { open: false, loading: false, page: null, error: null, canOpen: false } }; browser.subscribe(value => { current.state = value; });
    browser.receive(frame(99)); browser.open(); await tick();
    for (let n = 80; n >= 1; n--) {
      expect(current.state.page?.items).toEqual([item(n)]); expect(current.state.page?.items.length).toBeLessThanOrEqual(12);
      if (n === 40) { browser.receive(frame(100)); expect(present.mock.lastCall?.[0].items).toEqual([item(40)]); }
      if (n > 1) { browser.older(); await tick(); }
    }
    expect(read).toHaveBeenCalledTimes(80); browser.close(); expect(present.mock.lastCall?.[0]).toEqual(frame(100)); expect(current.state.page).toBeNull();
  });
  it('ignores older while busy, retains good page on bad responses, and retries', async () => {
    let resolve!: (p: RaidPennantArchivePage) => void;
    const read = vi.fn().mockResolvedValueOnce(page(4)).mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValueOnce(page(3));
    const present = vi.fn(), browser = createRaidPennantBrowser({ reader: { origin: 'live', read }, kingdomId, origin: 'live', clock: () => now, present, signal: new AbortController().signal });
    const current: { state: RaidPennantBrowserState } = { state: { open: false, loading: false, page: null, error: null, canOpen: false } }; browser.subscribe(s => { current.state = s; }); browser.receive(frame(9)); browser.open(); await tick(); browser.older(); browser.older();
    expect(read).toHaveBeenCalledTimes(2); resolve({ ...page(3), next: page(4).next }); await tick();
    expect(current.state.page).toEqual(page(4)); expect(current.state.error).toBeTruthy(); expect(present.mock.lastCall?.[0].items).toEqual([item(4)]);
    browser.retry(); await tick(); expect(current.state.page).toEqual(page(3)); expect(current.state.error).toBeNull();
  });
  it('times out an injected reader, retains its page, and ignores a late result after retry', async () => {
    vi.useFakeTimers();
    let resolveLate!: (value: RaidPennantArchivePage) => void;
    let stalledSignal!: AbortSignal;
    const read = vi.fn()
      .mockResolvedValueOnce(page(4))
      .mockImplementationOnce((_cursor: string | null, signal: AbortSignal) => {
        stalledSignal = signal;
        return new Promise<RaidPennantArchivePage>(resolve => { resolveLate = resolve; });
      })
      .mockResolvedValueOnce(page(3));
    const present = vi.fn();
    const browser = createRaidPennantBrowser({ reader: { origin: 'live', read }, kingdomId, origin: 'live', clock: () => now, present, signal: new AbortController().signal });
    const current: { state: RaidPennantBrowserState } = { state: { open: false, loading: false, page: null, error: null, canOpen: false } };
    browser.subscribe(state => { current.state = state; });
    browser.receive(frame(9)); browser.open(); await tick();
    expect(current.state.page).toEqual(page(4));
    browser.older(); expect(current.state.loading).toBe(true);
    await vi.advanceTimersByTimeAsync(2999); expect(stalledSignal.aborted).toBe(false); expect(current.state.loading).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(stalledSignal.aborted).toBe(true); expect(current.state.loading).toBe(false);
    expect(current.state.error).toBeTruthy(); expect(current.state.page).toEqual(page(4));
    browser.retry(); await tick();
    expect(read).toHaveBeenCalledTimes(3); expect(read.mock.calls[2]![0]).toBe(page(4).next);
    expect(current.state.page).toEqual(page(3)); expect(current.state.error).toBeNull();
    resolveLate(page(2)); await tick();
    expect(current.state.page).toEqual(page(3)); expect(present.mock.lastCall?.[0].items).toEqual([item(3)]);
  });
  it('rejects malformed pages without replacing the last good page', async () => {
    const bad = [
      { ...page(3), kingdomId: KingdomIdSchema.parse('3') },
      { ...page(3), origin: 'simulated' },
      { ...page(3), asOf: now + 5001 },
      { ...page(3), items: [item(4)] },
      { ...page(3), items: [{ ...item(3), occurredAt: now + 5001 }] },
      { ...page(3), next: page(4).next },
    ];
    const read = vi.fn().mockResolvedValueOnce(page(4)); for (const value of bad) read.mockResolvedValueOnce(value);
    const browser = createRaidPennantBrowser({ reader: { origin: 'live', read }, kingdomId, origin: 'live', clock: () => now, present: vi.fn(), signal: new AbortController().signal });
    const current: { state: RaidPennantBrowserState } = { state: { open: false, loading: false, page: null, error: null, canOpen: false } }; browser.subscribe(s => { current.state = s; }); browser.receive(frame(9)); browser.open(); await tick();
    for (let index = 0; index < bad.length; index++) { browser.older(); await tick(); expect(current.state.page).toEqual(page(4)); expect(current.state.error).toBeTruthy(); }
  });
  it('handles an already aborted owner and a synchronously throwing reader', async () => {
    const controller = new AbortController(); controller.abort(); const present = vi.fn();
    const reader = { origin: 'live' as const, read: vi.fn((): Promise<RaidPennantArchivePage> => { throw Error('closed'); }) };
    const stopped = createRaidPennantBrowser({ reader, kingdomId, origin: 'live', clock: () => now, present, signal: controller.signal });
    stopped.receive(frame(9)); stopped.open(); expect(reader.read).not.toHaveBeenCalled(); expect(present.mock.lastCall?.[0]).toBeNull();
    const browser = createRaidPennantBrowser({ reader, kingdomId, origin: 'live', clock: () => now, present, signal: new AbortController().signal });
    const current: { state: RaidPennantBrowserState } = { state: { open: false, loading: false, page: null, error: null, canOpen: false } }; browser.subscribe(s => { current.state = s; }); browser.receive(frame(9)); browser.open(); await tick(); expect(current.state.error).toBeTruthy(); expect(current.state.loading).toBe(false);
  });
  it('discards late answers on close or abort', async () => {
    let resolve!: (p: RaidPennantArchivePage) => void; let requestSignal!: AbortSignal;
    const present = vi.fn(), controller = new AbortController();
    const browser = createRaidPennantBrowser({ reader: { origin: 'live', read: (_c, signal) => { requestSignal = signal; return new Promise(r => { resolve = r; }); } }, kingdomId, origin: 'live', clock: () => now, present, signal: controller.signal });
    browser.receive(frame(9)); browser.open(); browser.close(); expect(requestSignal.aborted).toBe(true); resolve(page(8)); await tick(); expect(present.mock.lastCall?.[0]).toEqual(frame(9));
    controller.abort(); expect(present.mock.lastCall?.[0]).toBeNull(); browser.receive(frame(10)); expect(present.mock.lastCall?.[0]).toBeNull();
  });
});

describe('archive HTTP reader', () => {
  it('scopes cursor and uses same-origin no-store requests', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(page(4)))); vi.stubGlobal('fetch', fetcher);
    const reader = createRaidPennantArchiveReader(kingdomId, 'live', () => now);
    await expect(reader.read('pennants:1:simulated:1:100:4', new AbortController().signal)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    await expect(reader.read(null, new AbortController().signal)).resolves.toEqual(page(4));
    expect(fetcher.mock.calls[0]![0]).toContain('archive=1&limit=12'); expect(fetcher.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', mode: 'same-origin', redirect: 'error' });
  });
  it('aborts a stalled stream at the three second deadline', async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start() {}, cancel }))));
    const reader = createRaidPennantArchiveReader(kingdomId, 'live', () => now);
    const result = reader.read(null, new AbortController().signal); const rejected = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3000); await rejected; expect(cancel).toHaveBeenCalled();
  });
  it('cancels oversized advertised and streamed bodies', async () => {
    const cancel = vi.fn(); const body = () => new ReadableStream({ start(c) { c.enqueue(new Uint8Array(RAID_PENNANT_FRAME_MAX_BYTES + 1)); }, cancel });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(body(), { headers: { 'content-length': String(RAID_PENNANT_FRAME_MAX_BYTES + 1) } })).mockResolvedValueOnce(new Response(body())); vi.stubGlobal('fetch', fetcher);
    const reader = createRaidPennantArchiveReader(kingdomId, 'live', () => now);
    await expect(reader.read(null, new AbortController().signal)).rejects.toThrow(); await expect(reader.read(null, new AbortController().signal)).rejects.toThrow(); expect(cancel).toHaveBeenCalledTimes(2);
  });
});

describe('the trigger beside the page controls', () => {
  // A Chronicle button at the top right of a 1440 by 900 page.
  const chronicle = { left: 1300, right: 1420, top: 96, bottom: 134 };
  const coverAt = (x: number, y: number) => x >= chronicle.left && x <= chronicle.right && y >= chronicle.top && y <= chronicle.bottom ? chronicle : null;
  it('steps below a control it would cover, and stays where it is when nothing is there', () => {
    expect(raidPennantTriggerTop({ left: 1176, top: 66, width: 154, height: 42 }, 900, coverAt)).toBe(chronicle.bottom + 8);
    expect(raidPennantTriggerTop({ left: 600, top: 66, width: 154, height: 42 }, 900, coverAt)).toBe(66);
  });
  it('keeps its place rather than leave the canvas, and ignores a trigger not laid out yet', () => {
    expect(raidPennantTriggerTop({ left: 1176, top: 66, width: 154, height: 42 }, 160, coverAt)).toBe(66);
    expect(raidPennantTriggerTop({ left: 1176, top: 66, width: 0, height: 0 }, 900, coverAt)).toBe(66);
  });
});
