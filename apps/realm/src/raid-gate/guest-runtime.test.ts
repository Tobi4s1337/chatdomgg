import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, PresenceInputSchema, starterCitizenLook, type PresenceInput } from '@chatdom/shared';
import type { RealmPrincipal } from '@chatdom/shared/realm';
import { RaidGuestRoomReceiptSchema } from '../../../api/src/raid-gate/guest-contracts';
import type { DurableKingdom, RealmLifecycleListener } from '../persistence/kingdom';
import type { RaidGuestArrivalResult, RaidGuestAuthority } from './guests';
import { createRaidGuestRuntime } from './guest-runtime';

// SIMULATED authority replies and lifecycle emitter. The real runtime owns queuing, barriers and timers.
const at = 1_800_000_000_000, kingdomId = KingdomIdSchema.parse('42'), personId = PersonIdSchema.parse('501');
const entry1 = '11111111-1111-4111-8111-111111111111', entry2 = '22222222-2222-4222-8222-222222222222', entry3 = '33333333-3333-4333-8333-333333333333';
const raidId = `raid.${'a'.repeat(64)}`;
const from = { kingdomId: KingdomIdSchema.parse('101'), login: 'source_channel', name: 'Source Channel' };
const arrival: RaidGuestArrivalResult = { status: 'accepted', guest: { version: 1, origin: 'live', kingdomId, personId, entryId: entry1, raidId, from,
  to: { kingdomId, login: 'host_channel', name: 'Host Channel' }, arrivedAt: at, raidOccurredAt: at - 1_000 },
  stamp: { id: 'SIMULATED-visit-stamp', kind: 'visit', kingdomId, occurredAt: at, raidId: null,
    arrivedWith: { raidId, from, to: { kingdomId, login: 'host_channel', name: 'Host Channel' }, occurredAt: at - 1_000 },
    reward: { eligible: true, reason: 'eligible', day: Math.floor(at / 86_400_000) } } };
function principal(entryId = entry1, id = personId, origin: 'live' | 'simulated' = 'live'): RealmPrincipal {
  return { sessionId: entryId, personId: id, kingdomId, origin, publicName: 'SIMULATED Walker', look: starterCitizenLook(id), expiresAt: at + 86_400_000 };
}
function chat(id = personId): PresenceInput {
  return { version: 1, id: `SIMULATED-chat-${id}`, kind: 'observe', origin: 'live', kingdomId, observedAt: at,
    source: 'chat', coverage: 'activity', people: [{ personId: id, disclosure: 'named', displayName: 'SIMULATED Walker' }] };
}
const runtimes: ReturnType<typeof createRaidGuestRuntime>[] = [], releaseDeferred: (() => void)[] = [];
function deferred<T>(fallback: T) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  releaseDeferred.push(() => resolve(fallback));
  return { promise, resolve };
}
function setup() {
  const authority = {
    arrived: vi.fn<RaidGuestAuthority['arrived']>(async () => arrival),
    departed: vi.fn<RaidGuestAuthority['departed']>(async () => ({ status: 'accepted' })),
    present: vi.fn<RaidGuestAuthority['present']>(async () => ({ status: 'accepted' })),
    observePresence: vi.fn<RaidGuestAuthority['observePresence']>(async () => null),
    visitors: vi.fn<RaidGuestAuthority['visitors']>(async () => []),
  };
  const citizens = vi.fn<(input: PresenceInput) => Promise<void>>(async () => {}), log = vi.fn();
  const runtime = createRaidGuestRuntime({ origin: 'live', authority, citizens, log, clock: Date.now });
  runtimes.push(runtime);
  const listeners = new Set<RealmLifecycleListener>();
  const kingdom = { kingdomId, databaseNow: () => Date.now() + .75,
    onLifecycle(listener: RealmLifecycleListener) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const detach = runtime.attach(kingdom);
  const emit = (event: Parameters<RealmLifecycleListener>[0], who = principal(), time = Date.now()) => {
    for (const listener of listeners) listener(event, who, `SIMULATED-socket-${who.sessionId}`, time);
  };
  return { runtime, authority, citizens, log, emit, detach, listeners, kingdom };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at); });
afterEach(async () => {
  for (const release of releaseDeferred.splice(0)) release();
  const closing = runtimes.splice(0).map(runtime => runtime.close());
  await vi.advanceTimersByTimeAsync(5_001); await Promise.all(closing); vi.useRealTimers();
});

describe('the actual raid guest lifecycle runtime', () => {
  it('takes receipts only from this origin’s joins and leaves, using the private entry key rather than the socket', async () => {
    const t = setup();
    t.emit('drop'); t.emit('reconnect'); t.emit('join', principal(entry2, personId, 'simulated'));
    await t.runtime.flush(); expect(t.authority.arrived).not.toHaveBeenCalled();
    t.emit('join', principal(), at + 7); await t.runtime.flush();
    expect(t.authority.arrived).toHaveBeenCalledExactlyOnceWith({ version: 1, origin: 'live', kingdomId, personId, entryId: entry1, at: at + 7 });
    t.emit('leave', principal(), at + 9); await t.runtime.flush();
    expect(t.authority.departed).toHaveBeenCalledExactlyOnceWith({ version: 1, origin: 'live', kingdomId, personId, entryId: entry1, at: at + 9 });
  });

  it('retries a failed actual receipt with its original time and keeps flush pending until commit', async () => {
    const t = setup(); t.authority.arrived.mockRejectedValueOnce(new Error('SIMULATED lost commit answer'));
    t.emit('join', principal(), at + 7); await vi.advanceTimersByTimeAsync(0);
    let flushed = false; const flushing = t.runtime.flush().then(() => { flushed = true; });
    expect(t.runtime.health()).toMatchObject({ pending: 1, failures: 1 }); expect(flushed).toBe(false);
    await vi.advanceTimersByTimeAsync(499); expect(t.authority.arrived).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await flushing;
    expect(t.authority.arrived).toHaveBeenCalledTimes(2);
    expect(t.authority.arrived.mock.calls.map(([receipt]) => RaidGuestRoomReceiptSchema.parse(receipt).at)).toEqual([at + 7, at + 7]);
    expect(t.runtime.health()).toMatchObject({ pending: 0, failures: 1 }); expect(flushed).toBe(true);
  });

  it('holds matching chat qualification and settlement behind the actual join commit', async () => {
    const t = setup(), held = deferred(arrival), order: string[] = [];
    t.authority.arrived.mockImplementationOnce(async () => { const result = await held.promise; order.push('arrival'); return result; });
    t.authority.observePresence.mockImplementation(async () => { order.push('proof'); return null; });
    t.authority.visitors.mockImplementation(async () => { order.push('visitors'); return []; });
    t.citizens.mockImplementation(async () => { order.push('settlement'); });
    t.emit('join'); const observing = t.runtime.observe(chat()); await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([]); expect(t.authority.observePresence).not.toHaveBeenCalled();
    held.resolve(arrival); await observing;
    expect(order).toEqual(['arrival', 'proof', 'visitors', 'settlement']);
  });

  it('fails the chat barrier honestly if arrival has not committed and grants no allocation', async () => {
    const t = setup(), held = deferred(arrival);
    t.authority.arrived.mockImplementationOnce(() => held.promise); t.emit('join');
    const failed = expect(t.runtime.observe(chat())).rejects.toThrow('not committed');
    await vi.advanceTimersByTimeAsync(5_000); await failed;
    expect(t.authority.observePresence).not.toHaveBeenCalled(); expect(t.citizens).not.toHaveBeenCalled();
    held.resolve(arrival); await t.runtime.flush();
  });

  it('qualifies original chat evidence, excludes its visitor from allocation, and never mutates the observation', async () => {
    const t = setup(), input = chat();
    if (input.kind !== 'observe') throw new Error('Expected chat');
    Object.freeze(input.people[0]); Object.freeze(input.people); Object.freeze(input);
    t.authority.visitors.mockResolvedValue([personId]);
    await t.runtime.observe(input);
    expect(t.authority.observePresence.mock.calls[0]?.[0]).toBe(input);
    expect(t.authority.visitors).toHaveBeenCalledWith(kingdomId, [personId], at);
    expect(t.citizens).not.toHaveBeenCalled(); expect(input.people).toHaveLength(1);
    const outsider = chat(PersonIdSchema.parse('502')); Object.freeze(outsider);
    await t.runtime.observe(outsider);
    expect(t.citizens.mock.calls[0]?.[0]).toBe(outsider);
  });

  it('leaves ordinary non-chat presence unchanged and fails closed when qualification storage fails', async () => {
    const t = setup();
    const stream: PresenceInput = { version: 1, id: 'SIMULATED-stream', kind: 'stream', origin: 'live', kingdomId, observedAt: at, live: true, sessionId: 'SIMULATED-stream-session' };
    await t.runtime.observe(stream);
    expect(t.citizens.mock.calls[0]?.[0]).toBe(stream); expect(t.authority.visitors).not.toHaveBeenCalled();
    t.citizens.mockClear(); t.authority.observePresence.mockRejectedValueOnce(new Error('SIMULATED evidence store unavailable'));
    await expect(t.runtime.observe(chat())).rejects.toThrow('evidence store unavailable');
    expect(t.citizens).not.toHaveBeenCalled();
  });

  it('qualifies visitors at the exact verified provider time while preserving the clamped presence time', async () => {
    const t = setup(), providerAt = at + 4_000;
    const input = PresenceInputSchema.parse({ ...chat(), providerAt });
    await t.runtime.observe(input);
    expect(t.authority.observePresence.mock.calls[0]?.[0]).toBe(input);
    expect(t.authority.visitors).toHaveBeenCalledExactlyOnceWith(kingdomId, [personId], providerAt);
    expect(t.citizens.mock.calls[0]?.[0]).toBe(input);
    expect(input.observedAt).toBe(at);
  });

  it('guards follow/sub/reward settlement behind the same join and visitor check while delegating ordinary people', async () => {
    const t = setup(), held = deferred(arrival), settled = vi.fn(async () => ({ fresh: true }));
    const guard = t.runtime.guardSettler({ settle: settled });
    t.authority.arrived.mockImplementationOnce(() => held.promise); t.authority.visitors.mockResolvedValue([personId]);
    const kingdom = t.kingdom as unknown as DurableKingdom, person = { personId, name: 'SIMULATED Walker' }, tenure = { months: 3 };
    t.emit('join'); const pending = guard.settle(kingdom, person, tenure); await vi.advanceTimersByTimeAsync(0);
    expect(t.authority.visitors).not.toHaveBeenCalled(); expect(settled).not.toHaveBeenCalled();
    // An unrelated person is not held by this guest’s unfinished join.
    const ordinary = { personId: PersonIdSchema.parse('502'), name: 'SIMULATED Ordinary' };
    expect(await guard.settle(kingdom, ordinary, tenure)).toEqual({ fresh: true });
    expect(settled).toHaveBeenCalledExactlyOnceWith(kingdom, ordinary, tenure);
    held.resolve(arrival); expect(await pending).toBeNull();
    expect(t.authority.visitors).toHaveBeenLastCalledWith(kingdomId, [personId], at);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('heartbeats only confirmed actual guest seats and stops renewing on leave', async () => {
    const t = setup(), held = deferred<RaidGuestArrivalResult>(arrival);
    t.authority.arrived.mockImplementation(async raw => {
      const receipt = RaidGuestRoomReceiptSchema.parse(raw);
      return receipt.entryId === entry2 ? held.promise : receipt.entryId === entry3 ? { status: 'refused', reason: 'no_intent' } : arrival;
    });
    t.emit('join'); t.emit('join', principal(entry2, PersonIdSchema.parse('502'))); t.emit('join', principal(entry3, PersonIdSchema.parse('503')));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(t.authority.present).toHaveBeenCalledExactlyOnceWith({ version: 1, origin: 'live', kingdomId, personId, entryId: entry1, at: at + 15_000 });
    t.emit('leave'); held.resolve({ status: 'refused', reason: 'session' }); await t.runtime.flush();
    await vi.advanceTimersByTimeAsync(30_000); expect(t.authority.present).toHaveBeenCalledTimes(1);
  });

  it('keeps a heartbeat retry’s original time and retires a refused lease', async () => {
    const t = setup();
    t.authority.present.mockRejectedValueOnce(new Error('SIMULATED heartbeat outage')).mockResolvedValueOnce({ status: 'refused', reason: 'entry' });
    t.emit('join'); await t.runtime.flush(); await vi.advanceTimersByTimeAsync(15_000);
    expect(t.authority.present).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500); await t.runtime.flush();
    expect(t.authority.present.mock.calls.map(([receipt]) => RaidGuestRoomReceiptSchema.parse(receipt).at)).toEqual([at + 15_000, at + 15_000]);
    await vi.advanceTimersByTimeAsync(30_000); expect(t.authority.present).toHaveBeenCalledTimes(2);
  });

  it('stops a retired room registration’s heartbeat when detached', async () => {
    const t = setup(); t.emit('join'); await t.runtime.flush();
    t.detach(); expect(t.listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.authority.present).not.toHaveBeenCalled();
    t.emit('join'); expect(t.authority.arrived).toHaveBeenCalledTimes(1);
  });

  it('bounds receipt work to four concurrent commits and drains the remaining actual join', async () => {
    const t = setup(), held = deferred(arrival);
    t.authority.arrived.mockImplementation(() => held.promise);
    for (let i = 1; i <= 5; i++) t.emit('join', principal(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, PersonIdSchema.parse(String(500 + i))));
    await vi.advanceTimersByTimeAsync(0); expect(t.authority.arrived).toHaveBeenCalledTimes(4);
    held.resolve(arrival); await t.runtime.flush();
    expect(t.authority.arrived).toHaveBeenCalledTimes(5); expect(t.runtime.health()).toMatchObject({ pending: 0, overflow: 0 });
  });

  it('detaches on shutdown, clears heartbeats, and refuses new evidence or settlement afterward', async () => {
    const t = setup(); t.emit('join'); await t.runtime.flush(); await t.runtime.close();
    expect(t.listeners.size).toBe(0); expect(t.runtime.health().closed).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000); expect(t.authority.present).not.toHaveBeenCalled();
    await expect(t.runtime.observe(chat())).rejects.toThrow('closed');
    expect(() => t.runtime.attach(t.kingdom)).toThrow('closed');
    await expect(t.runtime.guardSettler({ settle: async () => null }).settle(t.kingdom as unknown as DurableKingdom,
      { personId, name: 'SIMULATED Walker' }, {})).rejects.toThrow('closed');
  });
});
