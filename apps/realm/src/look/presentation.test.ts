import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type Room } from '@colyseus/sdk';
import { expect, it, vi } from 'vitest';
import { NO_ENTITLEMENTS, starterLookRecipe } from '@chatdom/content/avatar-style';
import { createNativeForgeHost } from '@chatdom/forge';
import { KingdomIdSchema, PersonIdSchema, type PersonId } from '@chatdom/shared';
import { KingdomRoomState, REALM_NO_HOME_SLOT, type RealmOwnedHome, type RealmPrincipal, type RealmWriterLease } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { createRealmState } from '@chatdom/world/realm';
import { createFoundedWorldLoader, FileFoundedStore } from '../founded';
import { createDurableRealmServices, type DurableRepository } from '../persistence';
import type { RealmOutboxStore } from '../outbox';
import type { RealmOutboxRow } from '../persistence/postgres-repository';
import { createRealmServer } from '../server';
import { MemoryLookRepository } from './memory-repository';
import { attachLookPresentation } from './presentation';
import { LookStore } from './store';
import { canonicalLook } from './token';

/**
 * Walkers change look live, through the real room transport: a real `DurableKingdom` (over a SIMULATED in-memory
 * repository), the real kingdom room and SDK clients, with the hook attached exactly as main attaches it.
 */
it('re-presents a walker in their saved look for everyone in the room, and keeps it through home refreshes, reconnects and late saves (SIMULATED)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-look-live-'));
  const kingdomId = KingdomIdSchema.parse('900007301');
  const wren = PersonIdSchema.parse('900007302'), fern = PersonIdSchema.parse('900007303'), ash = PersonIdSchema.parse('900007304');
  const plan = generateSettlementPlan({ seed: 'SIMULATED-look-live', tier: 'hamlet', firstYear: 2026, year: 2026 });
  const plot = plan.homes[0]!, home: RealmOwnedHome = { id: plot.id, ownerId: wren, slot: plot.slot, layoutRevision: plan.revision,
    allocationReceipt: 'PRIVATE-SIMULATED-deed', revision: 'SIMULATED-home-look', digest: 'b'.repeat(64), family: plot.style,
    blueprint: createNativeForgeHost(plot).blueprint, attachments: {},
    attribution: { makerName: 'SIMULATED', kingdomName: 'SIMULATED', approvalId: 'SIMULATED-approved' } };
  let committed = createRealmState(kingdomId, 'simulated');
  const rows: RealmOutboxRow[] = [];
  const lease: RealmWriterLease = { kingdomId, epoch: 'SIMULATED-look-writer', expiresAt: Date.now() + 60_000 };
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
  /** The look the authenticator fixed at entry, as `principal.look`. */
  const issue = (personId: PersonId, look: string) => {
    const ticket = randomUUID();
    tickets.set(ticket, { kingdomId, personId, sessionId: randomUUID(), expiresAt: Date.now() + 60_000, origin: 'simulated', publicName: `SIMULATED ${personId}`, look });
    return { ticket, kingdomId, protocol: 1 as const };
  };
  const looks = new LookStore({ repository: new MemoryLookRepository(), origin: 'simulated',
    records: { entitlements: async () => ({ kind: 'records', entitlements: NO_ENTITLEMENTS({ id: kingdomId, name: 'SIMULATED', colours: ['#41677d', '#e5d8b7'] }, 'simulated') }) } });
  const loader = createFoundedWorldLoader({ origin: 'simulated', currentLayout: async () => ({ revision: plan.revision, foundedAt: 1, adoptedAt: 1 }), layoutPlan: async () => plan }, new FileFoundedStore(directory));
  await loader.prepare(kingdomId);
  let attached = 0;
  const services = createDurableRealmServices({ repository, outbox, kingdom: loader.options,
    attach: kingdom => { attached++; return attachLookPresentation(kingdom, looks); },
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
  const tide = canonicalLook(starterLookRecipe('tide')), dusk = canonicalLook({ ...starterLookRecipe('dusk')!, freckles: 'full' });
  await server.listen(address.port, '127.0.0.1');
  try {
    expect(attached).toBe(1);
    const wrenRoom = observe(await client.joinOrCreate<KingdomRoomState>('kingdom', issue(wren, 'hearth'), KingdomRoomState));
    const fernRoom = observe(await client.joinOrCreate<KingdomRoomState>('kingdom', issue(fern, 'grove'), KingdomRoomState));
    const wrenId = wrenRoom.sessionId;
    await vi.waitFor(() => expect(fernRoom.state.walkers.get(wrenId)).toMatchObject({ look: 'hearth', homeSlot: REALM_NO_HOME_SLOT }));

    // Wren saves: both screens see the new look on Wren's walker; Fern's own walker is untouched.
    expect(await looks.save(wren, { version: 1, look: tide.look })).toMatchObject({ status: 200, reply: { token: tide.token } });
    await vi.waitFor(() => expect(fernRoom.state.walkers.get(wrenId)?.look).toBe(tide.token));
    await vi.waitFor(() => expect(wrenRoom.state.walkers.get(wrenId)?.look).toBe(tide.token));
    expect(fernRoom.state.walkers.get(fernRoom.sessionId)?.look).toBe('grove');
    await vi.waitFor(() => expect(kingdom.currentWalkers().walkers.find(walker => walker.id === wrenId)?.look).toBe(tide.token));

    // A committed home re-presents every walker from the principal fixed at entry (`refreshPresentations`):
    // the home slot arrives and the saved look stays.
    expect(await kingdom.execute('SIMULATED-settle', { type: 'home.installAllocated', home }, 'allocation')).toMatchObject({ status: 'committed' });
    await vi.waitFor(() => expect(fernRoom.state.walkers.get(wrenId)).toMatchObject({ homeSlot: plot.slot, look: tide.token }));

    // A later save re-presents with the remembered home slot.
    expect(await looks.save(wren, { version: 1, look: dusk.look })).toMatchObject({ status: 200 });
    await vi.waitFor(() => expect(fernRoom.state.walkers.get(wrenId)).toMatchObject({ homeSlot: plot.slot, look: dusk.token }));

    // Reconnecting reuses the stale principal; the walker still wears the saved look.
    const token = wrenRoom.reconnectionToken;
    await wrenRoom.leave(false);
    const resumed = observe(await client.reconnect<KingdomRoomState>(token, KingdomRoomState));
    await vi.waitFor(() => expect(resumed.state.walkers.get(wrenId)).toMatchObject({ homeSlot: plot.slot, look: dusk.token }));
    expect(fernRoom.state.walkers.get(wrenId)?.look).toBe(dusk.token);

    // Ash saved after the entry ticket fixed a starter: the store's answer corrects the walker just after joining.
    const ashTicket = issue(ash, 'clay');
    await looks.save(ash, { version: 1, look: tide.look });
    const ashRoom = observe(await client.joinOrCreate<KingdomRoomState>('kingdom', ashTicket, KingdomRoomState));
    await vi.waitFor(() => expect(fernRoom.state.walkers.get(ashRoom.sessionId)?.look).toBe(tide.token));
    expect(fernRoom.state.walkers.get(ashRoom.sessionId)?.homeSlot).toBe(REALM_NO_HOME_SLOT);
  } finally {
    await Promise.all(sockets.map(socket => socket.leave().catch(() => {})));
    await server.gracefullyShutdown(false); await hold.release(); await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
