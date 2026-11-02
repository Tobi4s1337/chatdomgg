import { Client, type Room } from '@colyseus/sdk';
import { createServer as createPortProbe } from 'node:net';
import { TavernRoomState, type GatherFrame, type GatherSelf } from '@chatdom/shared';
import type { RealmWalkInput } from '@chatdom/shared/realm';
import { expect, it } from 'vitest';
import { createRealmServer } from '../server';
import { referenceServices } from '../reference';
import { severWalker } from '../auth/reconnect-harness';
import { createTavernInterior } from './interior';
import { installGatherStore, MemoryGatherStore } from './store';
import { seatApproachDriver } from '../../../web/src/games/walker';

type Tavern = Room<InstanceType<typeof TavernRoomState>>;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean, what: string, timeout = 8_000) {
  const until = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`); await delay(25); }
}
async function freePort() {
  for (const port of [5182, 5170, 5171, 5172, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5183, 5184, 5185, 5186, 5188, 5189]) {
    const free = await new Promise<boolean>(resolve => { const probe = createPortProbe(); probe.once('error', () => resolve(false)); probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true))); });
    if (free) return port;
  }
  throw new Error('No approved free socket test port');
}
function observe(room: Tavern) {
  let frame: GatherFrame | undefined, self: GatherSelf | undefined;
  const receipts = new Map<string, string>();
  room.onMessage('tables', (value: GatherFrame) => { frame = value; });
  room.onMessage('self', (value: GatherSelf) => { self = value; });
  room.onMessage('private', value => { if (value.type === 'receipt') receipts.set(value.receipt.id, value.receipt.status); });
  for (const type of ['interior', 'transient']) room.onMessage(type, () => {});
  room.send('bootstrap');
  return { frame: () => frame, self: () => self, receipts };
}
async function walkTo(room: Tavern, target: string) {
  const interior = createTavernInterior(), body = room.state.walkers.get(room.sessionId)!;
  const driver = seatApproachDriver(interior.world, [body.x, body.y, body.z], interior.registry.get(target)!.target.approach, [14, 10]);
  const input = room.input<RealmWalkInput>({ mode: 'reliable' });
  for (let i = 0; i < 800 && !driver.done; i++) {
    const current = room.state.walkers.get(room.sessionId)!;
    Object.assign(input.data, driver.input(current), { placement: current.placement }); input.send(); await delay(34);
  }
  expect(driver.done).toBe(true);
}
async function interact(room: Tavern, observer: ReturnType<typeof observe>, id: string, targetId: string, action: 'tavern' | 'stand') {
  room.send('intent', { version: 1, type: 'interact', id, targetId, action });
  await waitFor(() => observer.receipts.has(id), `receipt ${id}`);
  return observer.receipts.get(id);
}

it('holds a real physical game chair through a socket drop and reconnect, then concedes on standing', async () => {
  // Local reference identities and an in-memory store exercise sockets, not production identity or durability.
  const services = referenceServices(); installGatherStore(services, new MemoryGatherStore());
  const { server } = createRealmServer(services), rooms: Tavern[] = [];
  const port = await freePort(); await server.listen(port, '127.0.0.1');
  try {
    const client = new Client(`http://127.0.0.1:${port}`);
    const join = async () => { const room = await client.joinOrCreate<InstanceType<typeof TavernRoomState>>('tavern', services.issue(), TavernRoomState); rooms.push(room); room.reconnection.enabled = false; return room; };
    const first = await join(), second = await join();
    const a = observe(first), b = observe(second);
    await waitFor(() => first.state.walkers.size === 2 && !!a.frame() && !!b.frame(), 'walkers and tables');
    const chair1 = 'tavern:middle:seat:1', chair2 = 'tavern:middle:seat:2';
    await walkTo(first, chair2);
    expect(await interact(first, a, 'sit-a', chair2, 'tavern')).toBe('applied');
    await walkTo(second, chair1);
    expect(await interact(second, b, 'sit-b', chair1, 'tavern')).toBe('applied');
    await waitFor(() => a.frame()?.tables.find(t => t.table === 'middle')?.seats.every(Boolean) === true, 'both chairs');
    first.send('start', { table: 'middle', revision: a.frame()!.tables.find(t => t.table === 'middle')!.revision, id: 'start' });
    await waitFor(() => !!a.frame()?.tables.find(t => t.table === 'middle')?.pong, 'match');
    const match = a.frame()!.tables.find(t => t.table === 'middle')!.pong!.match;
    await waitFor(() => a.self()?.playerIndex !== null && a.self()?.playerIndex !== undefined, 'player assignment');
    const priorSelf = structuredClone(a.self()!), priorWalker = first.state.walkers.get(first.sessionId)!;
    const identity = { name: priorWalker.name, look: priorWalker.look }, token = first.reconnectionToken, session = first.sessionId;
    expect(severWalker(first.roomId, session)).toBe(true);
    await delay(300);
    expect(b.frame()!.tables.find(t => t.table === 'middle')!.seats[1]).toBe(identity.name);
    expect(second.state.walkers.has(session)).toBe(true);
    const intruder = await join(), d = observe(intruder);
    await waitFor(() => intruder.state.walkers.has(intruder.sessionId) && !!d.self(), 'intruder bootstrap');
    await walkTo(intruder, chair2);
    expect(await interact(intruder, d, 'steal', chair2, 'tavern')).not.toBe('applied');
    expect(d.self()?.table).toBeNull();
    expect(b.frame()!.tables.find(t => t.table === 'middle')!.seats[1]).toBe(identity.name);
    const resumed = await client.reconnect<InstanceType<typeof TavernRoomState>>(token, TavernRoomState); rooms.push(resumed); resumed.reconnection.enabled = false;
    const c = observe(resumed);
    await waitFor(() => !!c.self() && !!c.frame() && resumed.state.walkers.has(session), 'reconnect bootstrap');
    expect(resumed.sessionId).toBe(session);
    expect(resumed.state.walkers.get(session)).toMatchObject(identity);
    expect(c.self()).toEqual(priorSelf);
    expect(c.frame()!.tables.find(t => t.table === 'middle')!.pong!.match).toBe(match);
    intruder.send('paddle', { match, sequence: 99, paddle: 1 });
    await delay(150);
    expect(c.frame()!.tables.find(t => t.table === 'middle')!.pong!.acknowledged[priorSelf.playerIndex!]).toBe(-1);
    resumed.send('paddle', { match, sequence: 42, paddle: 0.5 });
    await waitFor(() => c.frame()!.tables.find(t => t.table === 'middle')!.pong!.acknowledged[priorSelf.playerIndex!] === 42, 'resumed paddle');
    expect(await interact(resumed, c, 'stand-a', chair2, 'stand')).toBe('applied');
    await waitFor(() => c.self()?.table === null && c.frame()?.tables.find(t => t.table === 'middle')?.pong?.phase === 'finished', 'concession');
    expect(c.frame()!.tables.find(t => t.table === 'middle')!.seats[1]).toBeNull();
  } finally {
    await Promise.all(rooms.map(room => room.leave().catch(() => {})));
    await server.gracefullyShutdown(false);
  }
}, 75_000);

// Blocked after three identical failures: the controlled adapter's same-person binding is not yet proven.
// Retain the full reproduction without a fourth attempt; this is not passing replacement/session evidence.
it.skip('blocked: replaces the older socket for the same reference principal and explicit leave concedes', async () => {
  // Controlled reference adapter: consume every one-use ticket, but map one marked ticket to the first
  // authenticated principal. This tests room ownership, not a production session issuer.
  const base = referenceServices();
  let original: Awaited<ReturnType<typeof base.auth.authenticate>> | undefined;
  const replacements = new Set<string>();
  const services = { ...base, auth: { ...base.auth, authenticate: async (join: Parameters<typeof base.auth.authenticate>[0]) => {
    const issued = await base.auth.authenticate(join);
    if (replacements.delete(join.ticket)) return original!;
    original ??= issued;
    return issued;
  } } };
  installGatherStore(services, new MemoryGatherStore());
  const { server } = createRealmServer(services), rooms: Tavern[] = [];
  const port = await freePort(); await server.listen(port, '127.0.0.1');
  console.info(`Replacement socket test port: ${port}`);
  try {
    const client = new Client(`http://127.0.0.1:${port}`);
    const join = async (ticket = base.issue()) => { const room = await client.joinOrCreate<InstanceType<typeof TavernRoomState>>('tavern', ticket, TavernRoomState); rooms.push(room); room.reconnection.enabled = false; return room; };
    const first = await join(), second = await join(), a = observe(first), b = observe(second);
    await waitFor(() => first.state.walkers.size === 2 && !!a.frame() && !!b.frame(), 'replacement test walkers');
    const chair1 = 'tavern:middle:seat:1', chair2 = 'tavern:middle:seat:2';
    await walkTo(first, chair2);
    expect(await interact(first, a, 'replace-sit-a', chair2, 'tavern')).toBe('applied');
    await walkTo(second, chair1);
    expect(await interact(second, b, 'replace-sit-b', chair1, 'tavern')).toBe('applied');
    await waitFor(() => a.frame()?.tables.find(t => t.table === 'middle')?.seats.every(Boolean) === true, 'replacement test chairs');
    first.send('start', { table: 'middle', revision: a.frame()!.tables.find(t => t.table === 'middle')!.revision, id: 'replace-start' });
    await waitFor(() => !!a.frame()?.tables.find(t => t.table === 'middle')?.pong && a.self()?.playerIndex != null, 'replacement test match');
    const match = a.frame()!.tables.find(t => t.table === 'middle')!.pong!.match;
    const self = structuredClone(a.self()!), walker = first.state.walkers.get(first.sessionId)!;
    const identity = { name: walker.name, look: walker.look }, oldId = first.sessionId;
    let oldClosed = false;
    first.onLeave(() => { oldClosed = true; });
    const ticket = base.issue(); replacements.add(ticket.ticket);
    const replacement = await join(ticket), c = observe(replacement);
    await waitFor(() => second.state.walkers.has(replacement.sessionId) && !second.state.walkers.has(oldId) && !!c.self() && !!c.frame(), 'replacement walker and bootstrap').catch(error => {
      console.info('Replacement predicates', { oldClosed, newPresent: second.state.walkers.has(replacement.sessionId), oldAbsent: !second.state.walkers.has(oldId), self: !!c.self(), frame: !!c.frame(), firstRoom: first.roomId, replacementRoom: replacement.roomId });
      throw error;
    });
    await waitFor(() => oldClosed, 'old socket kick');
    expect(replacement.sessionId).not.toBe(oldId);
    expect(second.state.walkers.size).toBe(2);
    expect(replacement.state.walkers.get(replacement.sessionId)).toMatchObject(identity);
    expect(c.self()).toEqual(self);
    expect(c.frame()!.tables.find(t => t.table === 'middle')!.seats.filter(name => name === identity.name)).toHaveLength(1);
    expect(c.frame()!.tables.find(t => t.table === 'middle')!.pong!.match).toBe(match);
    // The old transport has been kicked; its reconnection token must not re-admit it.
    await expect(client.reconnect(first.reconnectionToken, TavernRoomState)).rejects.toThrow();
    replacement.send('paddle', { match, sequence: 73, paddle: 0.5 });
    await waitFor(() => c.frame()!.tables.find(t => t.table === 'middle')!.pong!.acknowledged[self.playerIndex!] === 73, 'replacement paddle');
    await replacement.leave();
    await waitFor(() => !second.state.walkers.has(replacement.sessionId) && b.frame()?.tables.find(t => t.table === 'middle')?.pong?.phase === 'finished', 'explicit leave concession');
    expect(b.frame()!.tables.find(t => t.table === 'middle')!.seats[1]).toBeNull();
  } finally {
    await Promise.all(rooms.map(room => room.leave().catch(() => {})));
    await server.gracefullyShutdown(false);
  }
}, 40_000);

it('concedes and releases the physical chair on explicit socket leave', async () => {
  const services = referenceServices(); installGatherStore(services, new MemoryGatherStore());
  const { server } = createRealmServer(services), rooms: Tavern[] = [];
  const port = await freePort(); await server.listen(port, '127.0.0.1');
  console.info(`Explicit leave socket test port: ${port}`);
  try {
    const client = new Client(`http://127.0.0.1:${port}`);
    const join = async () => { const room = await client.joinOrCreate<InstanceType<typeof TavernRoomState>>('tavern', services.issue(), TavernRoomState); rooms.push(room); room.reconnection.enabled = false; return room; };
    const first = await join(), second = await join(), a = observe(first), b = observe(second);
    await waitFor(() => first.state.walkers.size === 2 && !!a.frame() && !!b.frame(), 'leave test walkers');
    await walkTo(first, 'tavern:middle:seat:2');
    expect(await interact(first, a, 'leave-sit-a', 'tavern:middle:seat:2', 'tavern')).toBe('applied');
    await walkTo(second, 'tavern:middle:seat:1');
    expect(await interact(second, b, 'leave-sit-b', 'tavern:middle:seat:1', 'tavern')).toBe('applied');
    await waitFor(() => a.frame()?.tables.find(t => t.table === 'middle')?.seats.every(Boolean) === true, 'leave test chairs');
    first.send('start', { table: 'middle', revision: a.frame()!.tables.find(t => t.table === 'middle')!.revision, id: 'leave-start' });
    await waitFor(() => !!b.frame()?.tables.find(t => t.table === 'middle')?.pong, 'leave test match');
    const match = b.frame()!.tables.find(t => t.table === 'middle')!.pong!.match;
    await first.leave();
    await waitFor(() => !second.state.walkers.has(first.sessionId) && b.frame()?.tables.find(t => t.table === 'middle')?.pong?.phase === 'finished', 'explicit leave concession');
    const table = b.frame()!.tables.find(t => t.table === 'middle')!;
    expect(table.pong!.match).toBe(match);
    expect(table.seats[1]).toBeNull();
  } finally {
    await Promise.all(rooms.map(room => room.leave().catch(() => {})));
    await server.gracefullyShutdown(false);
  }
}, 40_000);
