import { describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, type KingdomId, type RaidPennantFeed, type RaidPennantFrame } from '@chatdom/shared';
import type { TwitchMomentFeed } from '../twitch-moments/contracts';
import { mountKingdomRaidPennants, type KingdomRaidPennantOptions } from '../kingdom/moments/raid-pennants';

const now = 1_800_000_000_000, kingdomId = KingdomIdSchema.parse('202'), neighbourId = KingdomIdSchema.parse('303');
const frame: RaidPennantFrame = { version: 1, origin: 'live', kingdomId, asOf: now,
  items: [{ raidId: `raid.${'a'.repeat(64)}`, from: { kingdomId: KingdomIdSchema.parse('101'), login: 'visitor', name: 'Visitor' },
    occurredAt: now - 90 * 24 * 60 * 60 * 1000 }] };
type View = KingdomRaidPennantOptions['view'];
type MountView = Pick<View, 'receiveRaidPennants' | 'setRaidPennantGround' | 'onDispose'>;

function fakeView(alreadyDisposed = false) {
  const listeners = new Set<() => void>();
  let disposed = alreadyDisposed, current: RaidPennantFrame | null = null;
  const unregister = vi.fn((listener: () => void) => { listeners.delete(listener); });
  const methods = {
    receiveRaidPennants: vi.fn<MountView['receiveRaidPennants']>(value => { current = value; }),
    setRaidPennantGround: vi.fn<MountView['setRaidPennantGround']>(),
    onDispose: vi.fn<MountView['onDispose']>(listener => {
      if (disposed) listener(); else listeners.add(listener);
      return () => { unregister(listener); };
    }),
  } satisfies MountView;
  return { methods, listeners, unregister, get current() { return current; }, dispose() {
    disposed = true;
    for (const listener of [...listeners]) listener();
  } };
}

function fakeSource(origin: RaidPennantFeed['origin'] = 'live') {
  let receive: Parameters<RaidPennantFeed['subscribe']>[0] | undefined;
  const unsubscribe = vi.fn();
  const source: RaidPennantFeed = { origin, subscribe: vi.fn<RaidPennantFeed['subscribe']>(callback => {
    receive = callback; return unsubscribe;
  }) };
  return { source, unsubscribe, emit(raw: unknown) {
    if (!receive) throw new Error('The injected source was not subscribed');
    // Exercise the mount's trust boundary even if a transport violates its TypeScript contract.
    receive(raw as RaidPennantFrame);
  } };
}

function mount(view: ReturnType<typeof fakeView>, source: RaidPennantFeed, signal: AbortSignal, destination: KingdomId = kingdomId) {
  const feed: TwitchMomentFeed = { origin: 'live', raidPennants: source, subscribe: vi.fn(() => () => {}) };
  // This fake implements exactly the three view methods consumed by this mount.
  return mountKingdomRaidPennants({ view: view.methods as unknown as View, feed, signal, kingdomId: destination, clock: () => now });
}

describe('injected pennant history mount', () => {
  it.each([false, true])('releases a typed reading host even when its disposer throws: %s', throws => {
    const view = fakeView(), source = fakeSource(), controller = new AbortController();
    const sites = vi.fn(() => []), release = vi.fn(() => { if (throws) throw new Error('retired host'); });
    let canOpen = false;
    const stop = mountKingdomRaidPennants({ view: { ...view.methods, raidPennantSites: sites } as unknown as View,
      feed: { origin: 'live', raidPennants: source.source, subscribe: vi.fn(() => () => {}) }, kingdomId,
      clock: () => now, signal: controller.signal, reading(port) {
        expect(port.sites()).toEqual([]);
        const off = port.subscribe(state => { canOpen = state.canOpen; });
        return () => { off(); release(); };
      } });
    source.emit(frame); expect(canOpen).toBe(true); expect(sites).toHaveBeenCalledTimes(1);
    controller.abort(); stop();
    expect(release).toHaveBeenCalledTimes(1); expect(source.unsubscribe).toHaveBeenCalledTimes(1);
    expect(view.current).toBeNull(); expect(view.listeners.size).toBe(0);
  });

  it('releases a reading adapter returned after synchronous abort without starting its feed', () => {
    const view = fakeView(), source = fakeSource(), controller = new AbortController(), release = vi.fn();
    const stop = mountKingdomRaidPennants({ view: view.methods as unknown as View,
      feed: { origin: 'live', raidPennants: source.source, subscribe: vi.fn(() => () => {}) }, kingdomId,
      clock: () => now, signal: controller.signal, reading() { controller.abort(); return release; } });
    stop(); expect(release).toHaveBeenCalledTimes(1); expect(source.source.subscribe).not.toHaveBeenCalled();
    expect(view.methods.receiveRaidPennants).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('retains verified history through invalid scope, malformed frames, future time and asOf regressions', () => {
    const view = fakeView(), source = fakeSource(), stop = mount(view, source.source, new AbortController().signal);
    source.emit(frame);
    expect(view.current).toEqual(frame);
    const rejected: unknown[] = [
      { ...frame, origin: 'simulated' }, { ...frame, kingdomId: neighbourId },
      { ...frame, unexpected: true }, { ...frame, items: [{ ...frame.items[0], raidId: 'invalid' }] },
      { ...frame, asOf: now + 5001 }, { ...frame, asOf: now - 1, items: [] }, null,
    ];
    for (const raw of rejected) {
      source.emit(raw);
      expect(view.current).toEqual(frame);
      expect(view.methods.receiveRaidPennants).toHaveBeenCalledTimes(1);
    }
    const newer = { ...frame, asOf: now + 1, items: [] };
    source.emit(newer);
    expect(view.current).toEqual(newer);
    expect(view.methods.receiveRaidPennants).toHaveBeenCalledTimes(2);
    stop();
  });

  it('keeps concurrent kingdom subscriptions and their lastAsOf values isolated', () => {
    const firstView = fakeView(), secondView = fakeView(), first = fakeSource(), second = fakeSource();
    const stopFirst = mount(firstView, first.source, new AbortController().signal);
    const stopSecond = mount(secondView, second.source, new AbortController().signal, neighbourId);
    const other = { ...frame, kingdomId: neighbourId, asOf: now - 1000 };
    first.emit(frame); second.emit(other); first.emit(other); second.emit(frame);
    expect(firstView.current).toEqual(frame); expect(secondView.current).toEqual(other);
    expect(firstView.methods.receiveRaidPennants).toHaveBeenCalledTimes(1);
    expect(secondView.methods.receiveRaidPennants).toHaveBeenCalledTimes(1);
    stopFirst();
    expect(firstView.current).toBeNull(); expect(secondView.current).toEqual(other);
    expect(second.unsubscribe).not.toHaveBeenCalled();
    stopSecond();
  });

  it('clears and refuses an injected source whose origin does not match the moment feed', () => {
    const view = fakeView(), source = fakeSource('simulated');
    const stop = mount(view, source.source, new AbortController().signal);
    expect(source.source.subscribe).not.toHaveBeenCalled();
    expect(view.methods.receiveRaidPennants).toHaveBeenCalledExactlyOnceWith(null);
    expect(view.methods.setRaidPennantGround).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(view.listeners.size).toBe(0);
    stop(); expect(view.methods.receiveRaidPennants).toHaveBeenCalledTimes(1);
  });

  it.each(['abort', 'view disposal', 'returned disposer'] as const)('releases the subscription and ignores late data after %s', trigger => {
    const view = fakeView(), source = fakeSource(), controller = new AbortController();
    const removeAbort = vi.spyOn(controller.signal, 'removeEventListener');
    const stop = mount(view, source.source, controller.signal);
    source.emit(frame);
    view.methods.receiveRaidPennants.mockClear(); view.methods.setRaidPennantGround.mockClear();
    if (trigger === 'abort') controller.abort();
    else if (trigger === 'view disposal') view.dispose();
    else stop();
    expect(source.unsubscribe).toHaveBeenCalledTimes(1);
    expect(view.methods.receiveRaidPennants).toHaveBeenCalledExactlyOnceWith(null);
    expect(view.methods.setRaidPennantGround).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(view.unregister).toHaveBeenCalledTimes(1); expect(view.listeners.size).toBe(0);
    expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function));
    source.emit({ ...frame, asOf: now + 1 }); stop(); controller.abort(); view.dispose();
    expect(view.current).toBeNull(); expect(source.unsubscribe).toHaveBeenCalledTimes(1);
    expect(view.methods.receiveRaidPennants).toHaveBeenCalledTimes(1);
  });

  it('releases a subscription returned after a synchronous abort inside subscribe', () => {
    const view = fakeView(), controller = new AbortController(), unsubscribe = vi.fn();
    let late: Parameters<RaidPennantFeed['subscribe']>[0] | undefined;
    const source: RaidPennantFeed = { origin: 'live', subscribe(receive) {
      late = receive; receive(frame); controller.abort(); receive({ ...frame, asOf: now + 1 }); return unsubscribe;
    } };
    const stop = mount(view, source, controller.signal);
    expect(view.methods.receiveRaidPennants.mock.calls.map(([value]) => value)).toEqual([frame, null]);
    expect(unsubscribe).toHaveBeenCalledTimes(1); expect(view.listeners.size).toBe(0);
    expect(view.methods.setRaidPennantGround).toHaveBeenLastCalledWith(undefined);
    late?.({ ...frame, asOf: now + 2 }); stop();
    expect(view.current).toBeNull(); expect(view.methods.receiveRaidPennants).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it.each(['aborted signal', 'disposed view'] as const)('never subscribes an already ended lifetime: %s', ended => {
    const view = fakeView(ended === 'disposed view'), source = fakeSource(), controller = new AbortController();
    if (ended === 'aborted signal') controller.abort();
    const stop = mount(view, source.source, controller.signal);
    expect(source.source.subscribe).not.toHaveBeenCalled(); expect(view.listeners.size).toBe(0);
    expect(view.methods.receiveRaidPennants).toHaveBeenCalledExactlyOnceWith(null);
    expect(view.methods.setRaidPennantGround).toHaveBeenCalledExactlyOnceWith(undefined);
    if (ended === 'disposed view') expect(view.unregister).toHaveBeenCalledTimes(1);
    else expect(view.methods.onDispose).not.toHaveBeenCalled();
    stop(); expect(view.methods.receiveRaidPennants).toHaveBeenCalledTimes(1);
  });
});
