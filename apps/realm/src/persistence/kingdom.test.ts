import { performance } from 'node:perf_hooks';
import { expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { VOXEL_FIXTURE } from '@chatdom/shared/world-fixtures';
import type { RealmOwnedHome, RealmPrincipal, RealmPublicDelivery, RealmWriterLease } from '@chatdom/shared/realm';
import { createRealmState } from '@chatdom/world/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import type { RealmRoomEffects } from '../ports';
import { DurableKingdom, type DurableRepository } from './kingdom';
import type { RealmOutboxStore } from '../outbox';
import type { RealmOutboxRow } from './postgres-repository';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

it('keeps bootstrap at the delivered prefix and closes on the deadline despite a stalled renewal and outbox read', async () => {
  vi.useFakeTimers();
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  vi.setSystemTime(0);
  const kingdomId = KingdomIdSchema.parse('999000001'), personId = PersonIdSchema.parse('990000001');
  const lease: RealmWriterLease = { kingdomId, epoch: 'writer-one', expiresAt: 15_000 };
  const home: RealmOwnedHome = { id: 'plot:1', ownerId: personId, slot: 0, allocationReceipt: 'allocation:1', layoutRevision: 'court',
    revision: 'home:1', digest: 'a'.repeat(64), family: 'hearth', blueprint: VOXEL_FIXTURE,
    attribution: { makerName: 'Juniper', kingdomName: 'Emberwick', approvalId: 'names:1' }, attachments: {} };
  const initial = { ...createRealmState(kingdomId, 'simulated'), sequence: 1, homes: { [home.id]: home } };
  const privateAhead = { ...initial, sequence: 3, homes: { [home.id]: { ...home, revision: 'home:3' } } };
  const principal: RealmPrincipal = { personId, kingdomId, origin: 'simulated', sessionId: 'session:1', expiresAt: 99_000, publicName: 'Juniper', look: 'hearth' };
  const renewal = deferred<RealmWriterLease>(), firstRows = deferred<RealmOutboxRow[]>(), lateRows = deferred<RealmOutboxRow[]>();
  const firstRead = deferred<void>(), secondRead = deferred<void>();
  let reads = 0;
  const repository: DurableRepository = {
    leaseMs: 15_000, acquire: async () => lease, renew: vi.fn(() => renewal.promise), load: async () => initial,
    publishedPlots: async () => ({ plots: new Set([home.id]), cursor: 10 }), latestPresence: async () => null,
    committedState: () => privateAhead, execute: async () => ({ status: 'committed', sequence: 3, at: 0 }),
    lookup: async () => null, loadIngress: async () => null, executeIngress: async () => ({ status: 'unchanged', reason: 'unused' }),
    snapshot: async () => 3, release: async () => {},
  };
  const outbox: RealmOutboxStore = {
    open: async () => 10, acknowledge: async () => {},
    read: async () => { if (++reads <= 2) { firstRead.resolve(); return firstRows.promise; } secondRead.resolve(); return lateRows.promise; },
  };
  let kingdom: DurableKingdom | undefined;
  try {
    kingdom = await DurableKingdom.open(repository, outbox, kingdomId, { world: REFERENCE_WORLD, layoutRevision: 'court', spawn: () => [0, 0, 6] });
    const effects: RealmRoomEffects = { close: vi.fn(), readWalker: () => ({ x: 0, y: 0, z: 6, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: 1 }),
      placeWalker: vi.fn(() => true), allowWalking: vi.fn(), adoptWorld: vi.fn() };
    kingdom.bindRoom(effects); kingdom.lifecycle('join', principal, 'walker:1', 0);
    expect(kingdom.recoverWalker('walker:1', 2)).toBe(false);
    expect(kingdom.recoverWalker('walker:1', 1)).toBe(true);
    expect(effects.allowWalking).not.toHaveBeenCalled(); // Recovery preserves the room's existing walking lock.
    const deliveries: RealmPublicDelivery[] = [], checkpoints: ReturnType<DurableKingdom['bootstrap']>[] = [];
    kingdom.subscribe(delivery => { deliveries.push(delivery); checkpoints.push(kingdom!.bootstrap(principal)); });
    const command = kingdom.execute('command:1', { type: 'stream.observe', sessionId: null, startedAt: 0, liveUntil: 0 }, 'presence');
    await firstRead.promise;
    expect(kingdom.bootstrap(principal)).toMatchObject({ throughSequence: 1, throughCursor: 10, current: [{ type: 'home', revision: 'home:1' }] });
    firstRows.resolve([{ id: 11, sequence: 2, eventId: 'home:2', plotId: home.id,
      message: { type: 'home', plotId: home.id, revision: 'home:2', assetHash: home.digest, attachments: [] } }]);
    await secondRead.promise;
    expect(checkpoints).toMatchObject([{ throughSequence: 2, throughCursor: 11, current: [{ type: 'home', revision: 'home:2' }] }]);
    expect(deliveries[0]?.cursor).toBe(11);
    await vi.advanceTimersByTimeAsync(13_001);
    expect(effects.close).toHaveBeenCalledExactlyOnceWith('authority-lost');
    expect(kingdom.current).toBe(false);
    renewal.resolve({ ...lease, expiresAt: 30_000 });
    await Promise.resolve();
    expect(kingdom.current).toBe(false);
    lateRows.resolve([{ id: 12, sequence: 3, eventId: 'home:3', plotId: home.id,
      message: { type: 'home', plotId: home.id, revision: 'home:3', assetHash: home.digest, attachments: [] } }]);
    await command;
    expect(deliveries).toHaveLength(1);
    expect(kingdom.bootstrap(principal)).toMatchObject({ throughSequence: 2, throughCursor: 11, current: [{ type: 'home', revision: 'home:2' }] });
  } finally {
    firstRows.resolve([]); lateRows.resolve([]); renewal.resolve(lease);
    await kingdom?.dispose();
    clock.mockRestore(); vi.useRealTimers();
  }
});
