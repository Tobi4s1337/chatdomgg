import { Client, type Room } from '@colyseus/sdk';
import { randomUUID } from 'node:crypto';
import { ServerError } from '@colyseus/core';
import { KingdomIdSchema, PersonIdSchema, TavernRoomState, type GatherFrame, type KingdomId } from '@chatdom/shared';
import type { RealmPrincipal } from '@chatdom/shared/realm';
import { expect, it } from 'vitest';
import { createRealmServer } from '../server';
import { listenForTest } from './test-socket';
import { referenceServices } from '../reference';
import type { RealmRoomServices } from '../ports';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (predicate: () => boolean, timeout = 8_000) => {
  const until = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > until) throw new Error('Tavern state did not arrive'); await pause(25); }
};

/** One-use local tickets for two kingdoms; each principal belongs to exactly one. */
function twoKingdomServices(kingdoms: readonly KingdomId[]): RealmRoomServices & { issue(kingdom: KingdomId): { ticket: string; kingdomId: string; protocol: 1 } } {
  const base = referenceServices(), tickets = new Map<string, RealmPrincipal>(), sessions = new Map<string, RealmPrincipal>();
  let counter = 0;
  return { ...base,
    issue(kingdomId) {
      const n = ++counter, ticket = randomUUID();
      const principal: RealmPrincipal = { personId: PersonIdSchema.parse(String(990000100 + n)), kingdomId, sessionId: randomUUID(),
        expiresAt: Date.now() + 3_600_000, origin: 'simulated', publicName: `Visitor ${n}`, look: 'reference' };
      tickets.set(ticket, principal); sessions.set(principal.sessionId, principal);
      return { ticket, kingdomId, protocol: 1 };
    },
    auth: {
      async authenticate(join) {
        const principal = tickets.get(join.ticket);
        if (!principal || join.kingdomId !== principal.kingdomId || !kingdoms.includes(principal.kingdomId)) throw new ServerError(403, 'Entry expired');
        tickets.delete(join.ticket); return principal;
      },
      async current(principal, now) { const stored = sessions.get(principal.sessionId); return !!stored && stored.kingdomId === principal.kingdomId && stored.expiresAt > now; },
    },
  };
}

it('gives each kingdom its own tavern: separate walkers and tables, and no entry across', async () => {
  const north = KingdomIdSchema.parse('999000011'), south = KingdomIdSchema.parse('999000012');
  const services = twoKingdomServices([north, south]), created = createRealmServer(services), { server } = created;
  const sockets: Room<InstanceType<typeof TavernRoomState>>[] = [];
  const url = await listenForTest(created);
  try {
    const client = new Client(url);
    const join = async (kingdom: KingdomId) => {
      const room = await client.joinOrCreate<InstanceType<typeof TavernRoomState>>('tavern', services.issue(kingdom), TavernRoomState);
      room.reconnection.enabled = false; sockets.push(room);
      for (const type of ['interior', 'transient', 'private', 'self', 'receipt', 'exit']) room.onMessage(type, () => {});
      return room;
    };
    const a = await join(north), b = await join(south), c = await join(north);
    const frames = new Map<Room, GatherFrame>();
    for (const room of [a, b, c]) room.onMessage('tables', (frame: GatherFrame) => { frames.set(room, frame); });
    expect(a.roomId).toBe(`t:${north}`);
    expect(b.roomId).toBe(`t:${south}`);
    expect(c.roomId).toBe(a.roomId);
    await waitFor(() => a.state.walkers.size === 2 && b.state.walkers.size === 1 && c.state.walkers.size === 2);
    expect(b.state.kingdomId).toBe(south);
    expect([...b.state.walkers.values()].map(w => w.name)).toEqual(['Visitor 2']);
    // A north ticket cannot be spent on the south tavern, even by its room id.
    await expect(client.joinById(b.roomId, services.issue(north), TavernRoomState)).rejects.toThrow();
    await pause(200);
    expect(b.state.walkers.size).toBe(1);
    await waitFor(() => frames.has(a) && frames.has(b));
    expect(frames.get(b)!.tables.every(table => table.seats.every(seat => seat === null))).toBe(true);
  } finally {
    await Promise.all(sockets.map(room => room.leave().catch(() => {})));
    await server.gracefullyShutdown(false);
  }
}, 40_000);
