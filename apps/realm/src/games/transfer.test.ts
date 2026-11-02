import { Client, type Room } from '@colyseus/sdk';
import { randomUUID } from 'node:crypto';
import { createServer as createPortProbe } from 'node:net';
import { TavernRoomState } from '@chatdom/shared';
import { KingdomRoomState } from '@chatdom/shared/realm';
import type { RealmJoin, RealmPrincipal } from '@chatdom/shared/realm';
import { expect, it } from 'vitest';
import { createRealmServer } from '../server';
import { REFERENCE_KINGDOM, referenceServices } from '../reference';

/** A join request as the client sends it; the realm checks the kingdom itself. */
type Ticket = { readonly ticket: string; readonly kingdomId: string; readonly protocol: 1 };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (predicate: () => boolean, what: string, timeout = 8_000) => {
  const until = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > until) throw new Error(`Timed out: ${what}`); await pause(25); }
};
/** Lane ports are often all held on 127.0.0.1 by other lanes; this test owns its own loopback address. */
const HOST = '127.0.0.10';
async function freeTestPort(): Promise<number> {
  for (const port of [5183, 5184, 5185, 5186, 5188, 5189, 5170, 5171, 5172, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5182]) {
    const free = await new Promise<boolean>(resolve => {
      const probe = createPortProbe();
      probe.once('error', () => resolve(false));
      probe.listen(port, HOST, () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('No approved free port for the tavern transfer test');
}
/**
 * The installed transport's listen drops its hostname, so bind through uWS's explicit host overload, as the lane's
 * capture harness does (`apps/web/src/games/local-listener.mjs`). The app method is restored straight after.
 */
async function listen(created: ReturnType<typeof createRealmServer>, port: number): Promise<void> {
  const app = (created.transport as unknown as { app: { listen: (...args: never[]) => unknown } }).app, native = app.listen;
  let bound = false;
  app.listen = ((_port: number, callback: (socket: unknown) => void) => (native as (...args: unknown[]) => unknown).call(app, HOST, port, (socket: unknown) => { bound = !!socket; callback(socket); })) as typeof native;
  try { await created.server.listen(port, HOST); } finally { app.listen = native; }
  if (!bound) throw new Error(`The test realm could not bind ${HOST}:${port}`);
}

/**
 * The realm's half of a door: the session travels and the ticket never does. Each room is joined with a fresh
 * single-use ticket for the same signed-in principal, the way play's transfer asks `entry.ticket()` every time.
 */
function sessionServices() {
  const base = referenceServices(), fresh = new Map<string, RealmPrincipal>();
  let revoked = false;
  return { ...base,
    first: () => base.issue(),
    again(principal: RealmPrincipal): Ticket { const ticket = randomUUID(); fresh.set(ticket, principal); return { ticket, kingdomId: REFERENCE_KINGDOM, protocol: 1 }; },
    revoke() { revoked = true; },
    auth: {
      async authenticate(join: RealmJoin) {
        const principal = fresh.get(join.ticket);
        if (principal) { fresh.delete(join.ticket); return principal; }
        return base.auth.authenticate(join);
      },
      async current(principal: RealmPrincipal, now: number) { return !revoked && base.auth.current(principal, now); },
    },
  };
}

it('carries one session through the tavern door and back: same name and look, a fresh ticket each way, never two bodies', async () => {
  const services = sessionServices(), port = await freeTestPort();
  let principal: RealmPrincipal | undefined;
  const authenticate = services.auth.authenticate;
  services.auth.authenticate = async join => { const p = await authenticate(join); principal ??= p; return p; };
  const created = createRealmServer(services), { server } = created;
  const rooms: Room[] = [];
  await listen(created, port);
  try {
    const client = new Client(`http://${HOST}:${port}`);
    const quiet = (room: Room) => { room.reconnection.enabled = false; room.onMessage('*', () => {}); rooms.push(room); return room; };
    const kingdom = async (join: Ticket) => quiet(await client.joinOrCreate<InstanceType<typeof KingdomRoomState>>('kingdom', join, KingdomRoomState)) as Room<InstanceType<typeof KingdomRoomState>>;
    const tavern = async (join: Ticket) => quiet(await client.joinOrCreate<InstanceType<typeof TavernRoomState>>('tavern', join, TavernRoomState)) as Room<InstanceType<typeof TavernRoomState>>;

    const firstTicket = services.first();
    const outside = await kingdom(firstTicket);
    const watcher = await kingdom(services.first());
    await waitFor(() => watcher.state.walkers.size === 2, 'two walkers on the square');
    const traveller = principal!;
    const keeper = await tavern(services.first());
    await waitFor(() => keeper.state.walkers.size === 1, 'a keeper inside');

    // Going in: the kingdom room is left first, and the square sees exactly one body go.
    await outside.leave();
    await waitFor(() => watcher.state.walkers.size === 1, 'the traveller left the square');
    // The ticket that opened the kingdom is spent; it never opens the tavern.
    await expect(client.joinOrCreate('tavern', firstTicket, TavernRoomState)).rejects.toThrow();
    const inside = await tavern(services.again(traveller));
    await waitFor(() => keeper.state.walkers.size === 2 && inside.state.walkers.has(inside.sessionId), 'the traveller inside');
    const body = keeper.state.walkers.get(inside.sessionId)!;
    expect([body.name, body.look]).toEqual([traveller.publicName, traveller.look]);
    expect(inside.roomId).toBe(`t:${REFERENCE_KINGDOM}`);
    expect([...watcher.state.walkers.values()].some(w => w.name === traveller.publicName)).toBe(false);

    // Coming out: the tavern lets go before the square sees them again, as the same person, once.
    await inside.leave();
    await waitFor(() => keeper.state.walkers.size === 1, 'the traveller left the tavern');
    const back = await kingdom(services.again(traveller));
    await waitFor(() => watcher.state.walkers.size === 2, 'the traveller back on the square');
    const named = [...watcher.state.walkers.values()].filter(w => w.name === traveller.publicName);
    expect(named).toHaveLength(1);
    expect(named[0]!.look).toBe(traveller.look);
    expect(watcher.state.walkers.has(back.sessionId)).toBe(true);
    expect(keeper.state.walkers.has(inside.sessionId)).toBe(false);
  } finally {
    await Promise.all(rooms.map(room => room.leave().catch(() => {})));
    await server.gracefullyShutdown(false);
  }
}, 40_000);

it('recovers a refused door: the tavern turns a spent session away and the square takes the walker back', async () => {
  const services = sessionServices(), port = await freeTestPort();
  let principal: RealmPrincipal | undefined;
  const authenticate = services.auth.authenticate;
  services.auth.authenticate = async join => { const p = await authenticate(join); principal ??= p; return p; };
  const created = createRealmServer(services), { server } = created;
  const rooms: Room[] = [];
  await listen(created, port);
  try {
    const client = new Client(`http://${HOST}:${port}`);
    const join = async <S>(name: 'kingdom' | 'tavern', ticket: Ticket, schema: new () => S) => {
      const room = await client.joinOrCreate<S>(name, ticket, schema); room.reconnection.enabled = false; room.onMessage('*', () => {}); rooms.push(room); return room;
    };
    const outside = await join('kingdom', services.first(), KingdomRoomState);
    const watcher = await join('kingdom', services.first(), KingdomRoomState);
    await waitFor(() => watcher.state.walkers.size === 2, 'two walkers on the square');
    const traveller = principal!;
    await outside.leave();
    await waitFor(() => watcher.state.walkers.size === 1, 'the traveller left the square');
    // An unknown ticket is refused, and nothing is left behind in the tavern.
    await expect(client.joinOrCreate('tavern', { ticket: randomUUID(), kingdomId: REFERENCE_KINGDOM, protocol: 1 }, TavernRoomState)).rejects.toThrow();
    // Back outside with a fresh ticket: one body, the same person.
    const back = await join('kingdom', services.again(traveller), KingdomRoomState);
    await waitFor(() => watcher.state.walkers.size === 2, 'the traveller back on the square');
    expect([...watcher.state.walkers.values()].filter(w => w.name === traveller.publicName)).toHaveLength(1);
    expect(watcher.state.walkers.has(back.sessionId)).toBe(true);
    // A session that has ended cannot walk into the tavern at all.
    services.revoke();
    await expect(client.joinOrCreate('tavern', services.again(traveller), TavernRoomState)).rejects.toThrow();
  } finally {
    await Promise.all(rooms.map(room => room.leave().catch(() => {})));
    await server.gracefullyShutdown(false);
  }
}, 40_000);
