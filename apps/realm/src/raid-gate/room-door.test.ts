import { describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { RealmAuthenticator, RealmPrincipal } from '@chatdom/shared/realm';
import { FoundedUnavailableError } from '../founded/load';
import type { RealmLifecycleListener } from '../persistence/kingdom';
import type { RealmTravelTransport, TravelTicketRef } from './ports';
import { createRealmRoomDoor, type RoomDoorRooms } from './room-door';

const SOURCE = KingdomIdSchema.parse('990100101'), TARGET = KingdomIdSchema.parse('990100201');
const WREN = PersonIdSchema.parse('990100001');
const ref: TravelTicketRef = { ticket: 't1', personId: WREN, sessionId: 's1', from: SOURCE, to: TARGET, generation: 1, kind: 'raid' };
const signal = new AbortController().signal;
const principal = (kingdomId = SOURCE) => ({ personId: WREN, kingdomId, origin: 'simulated', sessionId: 'entry' }) as unknown as RealmPrincipal;

function harness(input: { committedAt?: number; rooms?: Partial<RoomDoorRooms>; role?: 'visitor' | 'citizen' } = {}) {
  let clock = 1_000;
  const ledger = {
    origin: 'simulated',
    checkAdmission: vi.fn(async () => ({ kind: 'admitted' as const })),
    reserve: vi.fn(async () => ({ kind: 'acknowledged' as const, leaseUntil: 9_999 })),
    prepare: vi.fn(async () => ({ kind: 'acknowledged' as const })),
    commit: vi.fn(async () => ({ kind: 'acknowledged' as const, role: 'visitor' as const, committedAt: input.committedAt ?? 2_000 })),
    reconcile: vi.fn(async () => ({ kind: 'committed' as const, role: 'visitor' as const, committedAt: input.committedAt ?? 2_000 })),
    release: vi.fn(async () => ({ kind: 'acknowledged' as const })),
  } satisfies RealmTravelTransport;
  const release = vi.fn(async () => undefined);
  const world = {} as never;
  const rooms: RoomDoorRooms = {
    founded: async id => id !== KingdomIdSchema.parse('990100301'),
    retain: async () => ({ kingdom: { current: true, world } as never, release }),
    // An empty plan has no gate road: a visitor has no place at the gate yet.
    scene: () => ({ world, plan: { activeStreetIds: [], market: { nodeId: 'm' }, nodes: [], streets: [] } as never }),
    ...input.rooms,
  };
  const door = createRealmRoomDoor({ travel: { transport: ledger, roleAt: async () => input.role ?? 'citizen' }, rooms, clock: () => clock, seatWaitMs: 300, pollMs: 5 });
  const listeners: RealmLifecycleListener[] = [];
  const kingdom = (kingdomId: typeof SOURCE) => ({ kingdomId, onLifecycle: (listener: RealmLifecycleListener) => { listeners.push(listener); return () => undefined; } });
  door.attach(kingdom(SOURCE));
  const inner: RealmAuthenticator = { authenticate: async () => principal(), current: async () => true };
  return { door, ledger, release, listeners, fenced: door.fence(inner), tick: (ms: number) => { clock += ms; } };
}

describe('the realm room door', () => {
  it('refuses waiting land before the ledger holds anything', async () => {
    const { door, ledger } = harness();
    expect(await door.transport.checkAdmission(WREN, KingdomIdSchema.parse('990100301'), signal)).toEqual({ kind: 'denied' });
    expect(await door.transport.reserve({ ...ref, to: KingdomIdSchema.parse('990100301') }, signal)).toEqual({ kind: 'denied', code: 'refused' });
    expect(ledger.checkAdmission).not.toHaveBeenCalled(); expect(ledger.reserve).not.toHaveBeenCalled();
  });

  it('prepares only when the destination writer is current and a visitor has a place at the gate, always releasing the hold', async () => {
    const unfounded = harness({ rooms: { retain: async () => { throw new FoundedUnavailableError('unfounded', 'no layout'); } } });
    expect(await unfounded.door.transport.prepare(ref, signal)).toEqual({ kind: 'denied' });
    const loading = harness({ rooms: { retain: async () => ({ kingdom: { current: false, world: {} } as never, release: async () => undefined }) } });
    expect(await loading.door.transport.prepare(ref, signal)).toEqual({ kind: 'pending' });
    const visitor = harness({ role: 'visitor' });
    expect(await visitor.door.transport.prepare(ref, signal)).toEqual({ kind: 'pending' });
    expect(visitor.release).toHaveBeenCalledOnce(); expect(visitor.ledger.prepare).not.toHaveBeenCalled();
    const citizen = harness({ role: 'citizen' });
    expect(await citizen.door.transport.prepare(ref, signal)).toEqual({ kind: 'acknowledged' });
    expect(citizen.release).toHaveBeenCalledOnce(); expect(citizen.ledger.prepare).toHaveBeenCalledOnce();
  });

  it('fences the source seat taken before the commit and acknowledges only once the room lets it go', async () => {
    const { door, listeners, fenced } = harness({ committedAt: 2_000 });
    const seat = principal();
    for (const listener of listeners) listener('join', seat, 'walker-1', 1_500);
    expect(await fenced.current(seat, 1_600)).toBe(true);
    // The room keeps the seat past the wait: pending, and reconcile cannot say committed yet.
    expect(await door.transport.commit(ref, signal)).toEqual({ kind: 'pending' });
    expect(await fenced.current(seat, 2_100)).toBe(false);
    expect(await door.transport.reconcile(ref, signal)).toEqual({ kind: 'unknown' });
    // The room ends the seat (as it does within a second of the fenced check); now the commit is true.
    setTimeout(() => { for (const listener of listeners) listener('leave', seat, 'walker-1', 2_200); }, 20);
    expect(await door.transport.reconcile(ref, signal)).toEqual({ kind: 'committed', role: 'visitor', committedAt: 2_000 });
    expect(await door.transport.commit(ref, signal)).toEqual({ kind: 'acknowledged', role: 'visitor', committedAt: 2_000 });
  });

  it('never fences a seat taken after the commit, nor one in another kingdom', async () => {
    const { door, listeners, fenced } = harness({ committedAt: 2_000 });
    expect(await door.transport.commit(ref, signal)).toMatchObject({ kind: 'acknowledged' });
    const later = principal(), elsewhere = principal(TARGET);
    for (const listener of listeners) listener('join', later, 'walker-2', 2_500);
    expect(await fenced.current(later, 2_600)).toBe(true);
    expect(await fenced.current(elsewhere, 2_600)).toBe(true);
    expect(door.health()).toEqual({ rooms: 1, departures: 0 });
  });
});
