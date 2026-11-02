import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORGE_QUEUE_LIMITS, FORGE_QUEUE_ROUTE, KingdomIdSchema, type ForgeQueueView } from '@chatdom/shared';
import { browserForgeQueueRead, forgeQueueCopy, forgeQueueMakers, forgeQueueMoreLine, parseForgeQueue, watchForgeQueue, type ForgeQueueRead } from './queue';

const K = KingdomIdSchema.parse('129634568');
const AT = 1_800_000_000_000;
const view = (patch: Partial<ForgeQueueView> = {}): ForgeQueueView =>
  ({ version: 1, kingdomId: K, total: 0, waiting: 0, forgingSince: null, at: AT, ...patch }) as ForgeQueueView;
const forging = (waiting: number, patch: Partial<ForgeQueueView> = {}) => view({ total: waiting + 1, waiting, forgingSince: AT - 4_000, ...patch });
const line = (v: ForgeQueueView | null, where?: 'panel' | 'anvil') => forgeQueueCopy(v, where)?.line;

describe('the anvil’s line in words', () => {
  it('says nothing before the realm has answered', () => {
    expect(forgeQueueCopy(null)).toBe(null);
  });

  it('rests when the line is empty', () => {
    expect(forgeQueueCopy(view())).toEqual({ tone: 'resting', yours: false, line: 'The anvil rests. The next wish goes straight to it.' });
    expect(line(view(), 'anvil')).toBe('No wish waits. Yours would go straight to the anvil.');
  });

  it('says the smith is at work, and how many wait their turn', () => {
    expect(forgeQueueCopy(forging(0))).toEqual({ tone: 'working', yours: false, line: 'The smith is at work. No other wish waits.' });
    expect(line(forging(1))).toBe('The smith is at work. One wish waits its turn.');
    expect(line(forging(2))).toBe('The smith is at work. Two wishes wait their turn.');
    expect(line(forging(14))).toBe('The smith is at work. 14 wishes wait their turn.');
    // Beside the fire line the work itself is already said; only the waiting is added.
    expect(line(forging(0), 'anvil')).toBe('No other wish waits its turn.');
    expect(line(forging(3), 'anvil')).toBe('Three wishes wait their turn.');
  });

  it('counts every wish as waiting while nothing is at the anvil', () => {
    expect(line(view({ total: 2, waiting: 1 }))).toBe('Two wishes wait their turn.');
  });

  it('lets the maker’s own place win', () => {
    expect(forgeQueueCopy(forging(2, { yours: { position: 0, state: 'forging' } }))).toEqual({ tone: 'working', yours: true, line: 'Yours is at the anvil now.' });
    expect(line(forging(2, { yours: { position: 1, state: 'waiting' } }))).toBe('Yours is next.');
    expect(line(forging(4, { yours: { position: 3, state: 'waiting' } }))).toBe('Three wishes are ahead of yours.');
    expect(line(forging(4, { yours: { position: 3, state: 'waiting' } }), 'anvil')).toBe('Three wishes are ahead of yours.');
    // A wish first in line while the anvil is between rituals is simply next.
    expect(line(view({ total: 1, waiting: 1, yours: { position: 0, state: 'waiting' } }))).toBe('Yours is next.');
  });

  it('says kindly when the ritual at the anvil is taking long, measured on the realm’s clock', () => {
    const slowSince = AT - FORGE_QUEUE_LIMITS.slowMs;
    expect(forgeQueueCopy(forging(0, { forgingSince: AT - FORGE_QUEUE_LIMITS.slowMs + 1 }))?.tone).toBe('working');
    expect(forgeQueueCopy(forging(0, { forgingSince: slowSince }))).toEqual({ tone: 'slow', yours: false, line: 'The smith is taking care with this one. A moment more.' });
    expect(line(forging(2, { forgingSince: slowSince }))).toBe('The smith is taking care with this one. A moment more. Two wishes wait their turn.');
    expect(line(forging(0, { forgingSince: slowSince }), 'anvil')).toBe('The smith is taking care with this one. A moment more.');
    expect(line(forging(1, { forgingSince: slowSince, yours: { position: 0, state: 'forging' } }))).toBe('Yours is at the anvil, and the smith is taking care with it. A moment more.');
    expect(line(forging(1, { forgingSince: slowSince, yours: { position: 1, state: 'waiting' } }))).toBe('Yours is next. The smith is taking care with the one before it.');
    expect(line(forging(3, { forgingSince: slowSince, yours: { position: 2, state: 'waiting' } }))).toBe('Two wishes are ahead of yours. The smith is taking care with the one at the anvil.');
  });

  it('gives the broadcaster names in order, and nobody else', () => {
    expect(forgeQueueMakers(forging(2))).toBe(null);
    expect(forgeQueueMakers(view({ makers: [] }))).toBe(null);
    const listed = forgeQueueMakers(forging(2, { makers: [
      { position: 2, name: 'Juniper', state: 'waiting' }, { position: 0, name: 'Wren', state: 'forging' }, { position: 1, name: 'Bram', state: 'waiting' },
    ] }));
    expect(listed).toEqual({ more: 0, rows: [
      { position: 0, name: 'Wren', state: 'forging', label: 'at the anvil' },
      { position: 1, name: 'Bram', state: 'waiting', label: 'waiting' },
      { position: 2, name: 'Juniper', state: 'waiting', label: 'waiting' },
    ] });
    // The realm caps the names it sends; the rest are counted, never invented.
    expect(forgeQueueMakers(forging(29, { makers: [{ position: 0, name: 'Wren', state: 'forging' }] }))?.more).toBe(29);
    expect(forgeQueueMoreLine(0)).toBe(null);
    expect(forgeQueueMoreLine(1)).toBe('One more waits after these.');
    expect(forgeQueueMoreLine(6)).toBe('Six more wait after these.');
  });
});

describe('reading the line', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('ignores a body that breaks the contract or speaks of another kingdom', () => {
    expect(parseForgeQueue(view({ total: 1, waiting: 0, forgingSince: AT }), K)).toMatchObject({ total: 1 });
    expect(parseForgeQueue({ ...view(), words: 'a dragon chimney' }, K)).toBe(null);
    expect(parseForgeQueue({ ...view(), total: -1 }, K)).toBe(null);
    expect(parseForgeQueue(view({ kingdomId: KingdomIdSchema.parse('42') }), K)).toBe(null);
    expect(parseForgeQueue('<!doctype html>', K)).toBe(null);
  });

  it('polls only while open, and stops for good on dispose', async () => {
    let reads = 0;
    const read = vi.fn<ForgeQueueRead>(async () => { reads++; return forging(reads, { at: AT + reads }); });
    const watch = watchForgeQueue(K, { read });
    const seen: number[] = [];
    watch.subscribe(next => seen.push(next.waiting));
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[0]).toBe(K);
    await vi.advanceTimersByTimeAsync(FORGE_QUEUE_LIMITS.pollMs - 1);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([1, 2]);
    watch.dispose();
    await vi.advanceTimersByTimeAsync(FORGE_QUEUE_LIMITS.pollMs * 5);
    expect(read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a read in flight on dispose and never reports it', async () => {
    let signal: AbortSignal | undefined, answer: (body: unknown) => void = () => {};
    const watch = watchForgeQueue(K, { read: (_id, s) => { signal = s; return new Promise(resolve => { answer = resolve; }); } });
    const listener = vi.fn();
    watch.subscribe(listener);
    await vi.advanceTimersByTimeAsync(0);
    watch.dispose();
    expect(signal?.aborted).toBe(true);
    answer(forging(1));
    await vi.advanceTimersByTimeAsync(FORGE_QUEUE_LIMITS.pollMs * 2);
    expect(listener).not.toHaveBeenCalled();
    expect(watch.view()).toBe(null);
  });

  it('keeps the last view through a failed read or an unreadable body, and keeps polling', async () => {
    const replies: Array<() => unknown> = [
      () => forging(2),
      () => { throw new TypeError('network down'); },
      () => ({ version: 1, kingdomId: K, status: 'error' }),
      () => forging(1, { at: AT + 9_000 }),
    ];
    const read = vi.fn(async () => replies[read.mock.calls.length - 1]!());
    const watch = watchForgeQueue(K, { read });
    const listener = vi.fn();
    watch.subscribe(listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(watch.view()?.waiting).toBe(2);
    await vi.advanceTimersByTimeAsync(FORGE_QUEUE_LIMITS.pollMs * 2);
    expect(read).toHaveBeenCalledTimes(3);
    expect(watch.view()?.waiting).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FORGE_QUEUE_LIMITS.pollMs);
    expect(watch.view()?.waiting).toBe(1);
    // A late subscriber hears the current view at once.
    const late = vi.fn();
    watch.subscribe(late);
    expect(late).toHaveBeenCalledWith(watch.view());
    watch.dispose();
  });

  it('never rolls back to an older answer', async () => {
    const replies = [forging(3, { at: AT + 5_000 }), forging(0, { at: AT })];
    const read = vi.fn(async () => replies[read.mock.calls.length - 1]);
    const watch = watchForgeQueue(K, { read });
    await vi.advanceTimersByTimeAsync(FORGE_QUEUE_LIMITS.pollMs);
    expect(read).toHaveBeenCalledTimes(2);
    expect(watch.view()?.waiting).toBe(3);
    watch.dispose();
  });

  it('does not read at all for an unreadable kingdom id', async () => {
    const read = vi.fn(async () => view());
    const watch = watchForgeQueue('not a kingdom', { read });
    await vi.advanceTimersByTimeAsync(FORGE_QUEUE_LIMITS.pollMs * 2);
    expect(read).not.toHaveBeenCalled();
    watch.dispose();
  });

  it('reads the public route on the same origin and refuses anything that is not JSON', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(view()), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    expect(await browserForgeQueueRead(K, signal)).toEqual(view());
    expect(fetcher).toHaveBeenCalledWith(`${FORGE_QUEUE_ROUTE}?kingdomId=${K}`, expect.objectContaining({ method: 'GET', credentials: 'same-origin', cache: 'no-store', signal }));
    fetcher.mockResolvedValueOnce(new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await expect(browserForgeQueueRead(K, signal)).rejects.toThrow();
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }));
    await expect(browserForgeQueueRead(K, signal)).rejects.toThrow();
  });
});
