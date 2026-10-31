import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchMaker } from '@colyseus/core';
import { Client, type Room } from '@colyseus/sdk';
import { expect, it, vi } from 'vitest';
import { createNativeForgeHost } from '@chatdom/forge';
import { KingdomIdSchema, PersonIdSchema, starterCitizenLook } from '@chatdom/shared';
import { KingdomRoomState, REALM_NO_HOME_SLOT, type RealmOwnedHome, type RealmPrincipal, type RealmWriterLease } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { createRealmState } from '@chatdom/world/realm';
import { createFoundedWorldLoader, FileFoundedStore } from './founded';
import { createDurableRealmServices, type DurableRepository } from './persistence';
import type { RealmOutboxStore } from './outbox';
import type { RealmOutboxRow } from './persistence/postgres-repository';
import { createRealmServer } from './server';

it('links a connected actual walker to its committed native home through a homeSlot-only schema patch, reconnect and replacement (SIMULATED)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-walker-home-'));
  const kingdomId = KingdomIdSchema.parse('900007209'), personId = PersonIdSchema.parse('900007210');
  const plan = generateSettlementPlan({ seed: 'SIMULATED-walker-home', tier: 'hamlet', firstYear: 2026, year: 2026 });
  const plot = plan.homes[0]!, home: RealmOwnedHome = { id: plot.id, ownerId: personId, slot: plot.slot, layoutRevision: plan.revision,
    allocationReceipt: 'PRIVATE-SIMULATED-deed', revision: 'SIMULATED-home-one', digest: 'a'.repeat(64), family: plot.style,
    blueprint: createNativeForgeHost(plot).blueprint, attachments: {},
    attribution: { makerName: 'SIMULATED', kingdomName: 'SIMULATED', approvalId: 'SIMULATED-approved' } };
  let committed = createRealmState(kingdomId, 'simulated');
  const rows: RealmOutboxRow[] = [];
  const lease: RealmWriterLease = { kingdomId, epoch: 'SIMULATED-walker-writer', expiresAt: Date.now() + 60_000 };
  const repository: DurableRepository = { leaseMs: 60_000, acquire: async () => lease, renew: async () => ({ ...lease, expiresAt: Date.now() + 60_000 }),
    load: async () => committed, committedState: () => committed,
    execute: async (_lease, id, _command, decide) => {
      const at = Date.now(), decision = decide(committed, at);
      if (decision.kind !== 'accepted') return { status: decision.kind, reason: decision.reason };
      committed = decision.state;
      for (const message of decision.public) rows.push({ id: rows.length + 1, sequence: committed.sequence, eventId: id, plotId: home.id, message });
      return { status: 'committed', sequence: committed.sequence, at };
    },
    lookup: async () => null, loadIngress: async () => null, executeIngress: async () => ({ status: 'unchanged', reason: 'unused' }),
    snapshot: async () => committed.sequence, release: async () => {} };
  const outbox: RealmOutboxStore = { open: async () => 0, prefix: async () => ({ homes: [], presence: null, sequence: 0, committed: 0 }),
    read: async (_id, after) => rows.filter(row => row.id > after), acknowledge: async () => {} };
  const tickets = new Map<string, RealmPrincipal>();
  const issue = (look = 'neutral') => {
    const ticket = randomUUID();
    tickets.set(ticket, { kingdomId, personId, sessionId: randomUUID(), expiresAt: Date.now() + 60_000, origin: 'simulated', publicName: 'SIMULATED Citizen', look });
    return { ticket, kingdomId, protocol: 1 as const };
  };
  const loader = createFoundedWorldLoader({ origin: 'simulated', currentLayout: async () => ({ revision: plan.revision, foundedAt: 1, adoptedAt: 1 }), layoutPlan: async () => plan }, new FileFoundedStore(directory));
  await loader.prepare(kingdomId);
  const services = createDurableRealmServices({ repository, outbox, kingdom: loader.options,
    auth: { authenticate: async join => { const p = tickets.get(join.ticket); if (!p) throw new Error('SIMULATED ticket used'); tickets.delete(join.ticket); return p; }, current: async () => true } });
  const hold = await services.retain(kingdomId), kingdom = hold.kingdom;
  const probe = createNetServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const { server } = createRealmServer(services), sockets: Room<KingdomRoomState>[] = [];
  const client = new Client(`http://127.0.0.1:${address.port}`);
  const observe = (socket: Room<KingdomRoomState>) => {
    sockets.push(socket); socket.reconnection.enabled = false;
    for (const kind of ['world', 'private', 'transient', 'revision']) socket.onMessage(kind, () => {});
    return socket;
  };
  await server.listen(address.port, '127.0.0.1');
  try {
    const first = observe(await client.joinOrCreate<KingdomRoomState>('kingdom', issue(), KingdomRoomState));
    await vi.waitFor(() => expect(first.state.walkers.size).toBe(1));
    const id = first.sessionId, look = starterCitizenLook(personId), walker = first.state.walkers.get(id)!;
    expect(walker).toMatchObject({ look, homeSlot: REALM_NO_HOME_SLOT });
    await vi.waitFor(() => expect(kingdom.currentWalkers().walkers[0]).toMatchObject({ id, look, homeSlot: REALM_NO_HOME_SLOT }));
    const world = kingdom.world;
    // Observe the real SDK schema patch decoder. A metadata-only allocation keeps pose and collision untouched.
    const changed: string[][] = [];
    type PatchSerializer = { patch(bytes: Uint8Array, it?: { offset: number }): void };
    const serializer = (first as unknown as { serializer: PatchSerializer }).serializer, decode = serializer.patch.bind(serializer);
    serializer.patch = (bytes, it) => {
      const before = walker.toJSON(); decode(bytes, it); const after = walker.toJSON();
      changed.push(Object.keys(after).filter(key => before[key as keyof typeof before] !== after[key as keyof typeof after]));
    };
    expect(await kingdom.execute('SIMULATED-settle', { type: 'home.installAllocated', home }, 'allocation')).toMatchObject({ status: 'committed' });
    await vi.waitFor(() => expect(walker.homeSlot).toBe(plot.slot));
    expect(changed.filter(fields => fields.length)).toEqual([['homeSlot']]);
    expect(walker.look).toBe(look); expect(kingdom.world).toBe(world);
    await vi.waitFor(() => expect(kingdom.currentWalkers().walkers[0]).toMatchObject({ id, homeSlot: plot.slot, look }));
    const publicText = JSON.stringify({ schema: first.state.toJSON(), poses: kingdom.currentWalkers(), checkpoint: kingdom.publicCheckpoint() });
    expect(publicText).not.toContain(personId); expect(publicText).not.toContain('PRIVATE-SIMULATED');
    const token = first.reconnectionToken;
    await first.leave(false);
    const resumed = observe(await client.reconnect<KingdomRoomState>(token, KingdomRoomState));
    await vi.waitFor(() => expect(resumed.state.walkers.get(id)?.homeSlot).toBe(plot.slot));
    expect(resumed.sessionId).toBe(id); expect(resumed.state.walkers.get(id)?.look).toBe(look);
    let synchronousReplacement: string[] | undefined;
    const offLifecycle = kingdom.onLifecycle((event, _principal, nextId) => {
      if (event === 'join' && nextId !== id) {
        const actual = matchMaker.getLocalRoomById(resumed.roomId) as unknown as { state: KingdomRoomState };
        synchronousReplacement = [...actual.state.walkers.keys()];
      }
    });
    const replacement = observe(await client.joinOrCreate<KingdomRoomState>('kingdom', issue('reference'), KingdomRoomState));
    await vi.waitFor(() => expect(replacement.state.walkers.size).toBe(1));
    offLifecycle();
    expect(replacement.sessionId).not.toBe(id);
    expect(synchronousReplacement).toEqual([replacement.sessionId]);
    expect(replacement.state.walkers.get(replacement.sessionId)).toMatchObject({ homeSlot: plot.slot, look });
    const actual = matchMaker.getLocalRoomById(replacement.roomId) as unknown as { state: KingdomRoomState };
    expect([...actual.state.walkers.keys()]).toEqual([replacement.sessionId]);
    await vi.waitFor(() => expect(kingdom.currentWalkers().walkers.map(walker => walker.id)).toEqual([replacement.sessionId]));
    await replacement.leave();
    await vi.waitFor(() => expect(kingdom.currentWalkers().walkers).toEqual([]));
  } finally {
    await Promise.all(sockets.map(socket => socket.leave().catch(() => {})));
    await server.gracefullyShutdown(false); await hold.release(); await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
