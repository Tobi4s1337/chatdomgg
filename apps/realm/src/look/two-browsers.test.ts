import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type Room } from '@colyseus/sdk';
import { expect, it, vi } from 'vitest';
import { NO_ENTITLEMENTS, starterLookRecipe, type CitizenLook } from '@chatdom/content/avatar-style';
import { KingdomIdSchema, PersonIdSchema, RealmLookMineReplySchema, RealmLookSaveReplySchema, type PersonId } from '@chatdom/shared';
import { KingdomRoomState, type RealmPrincipal, type RealmWriterLease } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { createRealmState } from '@chatdom/world/realm';
import { createCitizenLookLibrary } from '../../../web/src/citizens/look-library';
import { createFoundedWorldLoader, FileFoundedStore } from '../founded';
import { createDurableRealmServices, type DurableRepository } from '../persistence';
import type { RealmOutboxStore } from '../outbox';
import { createRealmServer } from '../server';
import { mountLookRoutes } from './http';
import { MemoryLookRepository } from './memory-repository';
import type { LookSessions } from './ports';
import { attachLookPresentation } from './presentation';
import { csrfFor, readCookie } from './session';
import { LookStore } from './store';

/**
 * One person, two browsers (two signed-in sessions, two cookies). They save a look in the first; in the second they
 * read it back and walk into the kingdom wearing it, a neighbour sees the same token on their walker, and the page's
 * look library (which the walker renderer and the portrait painter both draw from) resolves that token, over the
 * public route, to exactly the recipe that was saved. Real HTTP routes, real kingdom room, real SDK clients.
 */
it('saves in one browser and enters in another wearing the same look, on the walker and in the portrait', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-look-two-'));
  const kingdomId = KingdomIdSchema.parse('900007401');
  const wren = PersonIdSchema.parse('900007402'), fern = PersonIdSchema.parse('900007403');
  const plan = generateSettlementPlan({ seed: 'look-two-browsers', tier: 'hamlet', firstYear: 2026, year: 2026 });
  let committed = createRealmState(kingdomId, 'simulated');
  const lease: RealmWriterLease = { kingdomId, epoch: 'look-two-writer', expiresAt: Date.now() + 60_000 };
  const repository: DurableRepository = { leaseMs: 60_000, acquire: async () => lease, renew: async () => ({ ...lease, expiresAt: Date.now() + 60_000 }),
    load: async () => committed, committedState: () => committed,
    execute: async (_lease, _id, _command, decide) => {
      const at = Date.now(), decision = decide(committed, at);
      if (decision.kind !== 'accepted') return { status: decision.kind, reason: decision.reason };
      committed = decision.state;
      return { status: 'committed', sequence: committed.sequence, at };
    },
    lookup: async () => null, loadIngress: async () => null, executeIngress: async () => ({ status: 'unchanged', reason: 'unused' }),
    snapshot: async () => committed.sequence, release: async () => {} };
  const outbox: RealmOutboxStore = { open: async () => 0, prefix: async () => ({ homes: [], presence: null, sequence: 0, committed: 0 }),
    read: async () => [], acknowledge: async () => {} };

  // Two browsers of the same person: two session handles, two cookies, two CSRF tokens.
  const handles = new Map<string, PersonId>([['handle-wren-first-browser-0123456789', wren], ['handle-wren-second-browser-987654321', wren]]);
  const [first, second] = [...handles.keys()] as [string, string];
  const sessions: LookSessions = { async resolve(cookie) {
    const handle = readCookie(cookie, 'chatdom_session'), personId = handle ? handles.get(handle) : undefined;
    return handle && personId ? { personId, csrfToken: csrfFor(handle) } : null;
  } };
  const looks = new LookStore({ repository: new MemoryLookRepository(), origin: 'simulated',
    records: { entitlements: async () => ({ kind: 'records', entitlements: NO_ENTITLEMENTS({ id: kingdomId, name: 'Saltmarsh', colours: ['#41677d', '#e5d8b7'] }, 'simulated') }) } });

  // Entry: the realm's authenticator fixes the person's saved token at entry (authenticator.ts); a starter otherwise.
  const tickets = new Map<string, RealmPrincipal>();
  const enter = async (personId: PersonId) => {
    const ticket = randomUUID(), saved = await looks.current(personId);
    tickets.set(ticket, { kingdomId, personId, sessionId: randomUUID(), expiresAt: Date.now() + 60_000, origin: 'simulated',
      publicName: `walker ${personId}`, look: saved?.token ?? 'hearth' });
    return { ticket, kingdomId, protocol: 1 as const };
  };
  const loader = createFoundedWorldLoader({ origin: 'simulated', currentLayout: async () => ({ revision: plan.revision, foundedAt: 1, adoptedAt: 1 }), layoutPlan: async () => plan }, new FileFoundedStore(directory));
  await loader.prepare(kingdomId);
  const services = createDurableRealmServices({ repository, outbox, kingdom: loader.options,
    attach: kingdom => attachLookPresentation(kingdom, looks),
    auth: { authenticate: async join => { const p = tickets.get(join.ticket); if (!p) throw new Error('ticket used'); tickets.delete(join.ticket); return p; }, current: async () => true } });
  const hold = await services.retain(kingdomId);
  const probe = createNetServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const { server, transport } = createRealmServer(services), sockets: Room<KingdomRoomState>[] = [];
  mountLookRoutes(transport.app, { store: looks, sessions });
  const origin = `http://127.0.0.1:${address.port}`, client = new Client(origin);
  const observe = (socket: Room<KingdomRoomState>) => {
    sockets.push(socket); socket.reconnection.enabled = false;
    for (const kind of ['world', 'private', 'transient', 'revision']) socket.onMessage(kind, () => {});
    return socket;
  };
  const look: CitizenLook = { ...starterLookRecipe('dusk')!, freckles: 'full' };
  await server.listen(address.port, '127.0.0.1');
  try {
    // The first browser saves.
    const saved = RealmLookSaveReplySchema.parse(await (await fetch(`${origin}/api/realm/looks/me`, { method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: `chatdom_session=${first}`, 'x-csrf-token': csrfFor(first) },
      body: JSON.stringify({ version: 1, look }) })).json());
    if (!saved.ok) throw new Error(`save refused: ${saved.reason}`);

    // The second browser reads the same look back as the signed-in person.
    const mine = RealmLookMineReplySchema.parse(await (await fetch(`${origin}/api/realm/looks/me`, { headers: { cookie: `chatdom_session=${second}` } })).json());
    expect(mine).toMatchObject({ status: 'saved', token: saved.token });

    // It enters the kingdom: its walker wears the token, and a neighbour's screen shows the same.
    const fernRoom = observe(await client.joinOrCreate<KingdomRoomState>('kingdom', await enter(fern), KingdomRoomState));
    const wrenRoom = observe(await client.joinOrCreate<KingdomRoomState>('kingdom', await enter(wren), KingdomRoomState));
    await vi.waitFor(() => expect(wrenRoom.state.walkers.get(wrenRoom.sessionId)?.look).toBe(saved.token));
    await vi.waitFor(() => expect(fernRoom.state.walkers.get(wrenRoom.sessionId)?.look).toBe(saved.token));

    // The second browser's page resolves the token over the public route: one recipe for the walker and the portrait.
    const library = createCitizenLookLibrary({ base: origin });
    const drawn = await library.load(wrenRoom.state.walkers.get(wrenRoom.sessionId)!.look);
    expect(drawn).toEqual(saved.look);
    expect(library.recipe(saved.token)).toEqual(look);
    expect(library.has(saved.token)).toBe(true);
  } finally {
    await Promise.all(sockets.map(socket => socket.leave().catch(() => {})));
    await server.gracefullyShutdown(false); await hold.release(); await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
