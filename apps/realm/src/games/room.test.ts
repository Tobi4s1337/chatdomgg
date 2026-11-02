import { Client, type Room } from '@colyseus/sdk';
import { createServer as createPortProbe } from 'node:net';
import { KingdomIdSchema, TavernRoomState, type GatherFrame, type GatherSelf } from '@chatdom/shared';
import type { RealmWalkInput } from '@chatdom/shared/realm';
import { expect, it } from 'vitest';
import { createRealmServer } from '../server';
import { REFERENCE_KINGDOM, referenceServices } from '../reference';
import { createTavernInterior, TAVERN_COLLISION_REVISION } from './interior';
import { seatApproachDriver } from '../../../web/src/games/walker';

const waitFor = async (predicate: () => boolean, timeout = 8_000) => {
  const until = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('Tavern state did not arrive');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};

async function freeTestPort(): Promise<number> {
  for (const port of [5182, 5170, 5171, 5172, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5183, 5184, 5185, 5186, 5188, 5189]) {
    const free = await new Promise<boolean>(resolve => {
      const probe = createPortProbe();
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('No approved free port for the tavern socket test');
}

it('accepts separate authenticated walkers in the same tavern and refuses wrong-kingdom and remote chair claims', async () => {
  // Reference services issue one-use local test tickets; this is transport evidence, not database-session evidence.
  const base = referenceServices();
  const otherKingdom = KingdomIdSchema.parse('999000002');
  let misdirect = false;
  const services = { ...base, auth: { ...base.auth, authenticate: async (join: Parameters<typeof base.auth.authenticate>[0]) => {
    const principal = await base.auth.authenticate(join);
    return misdirect ? { ...principal, kingdomId: otherKingdom } : principal;
  } } };
  const { server } = createRealmServer(services);
  const sockets: Room<InstanceType<typeof TavernRoomState>>[] = [];
  const port = await freeTestPort();
  await server.listen(port, '127.0.0.1');
  try {
    const client = new Client(`http://127.0.0.1:${port}`);
    const first = await client.joinOrCreate<InstanceType<typeof TavernRoomState>>('tavern', base.issue(), TavernRoomState);
    sockets.push(first);
    for (const type of ['interior', 'transient']) first.onMessage(type, () => {});
    const second = await client.joinOrCreate<InstanceType<typeof TavernRoomState>>('tavern', base.issue(), TavernRoomState);
    sockets.push(second);
    for (const type of ['interior', 'transient', 'private', 'tables', 'self']) second.onMessage(type, () => {});
    for (const room of sockets) room.reconnection.enabled = false;
    await waitFor(() => sockets.every(room => room.state.walkers.size === 2));
    expect(first.roomId).toBe(second.roomId);
    expect(first.state.kingdomId).toBe(REFERENCE_KINGDOM);
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(first.state.walkers.get(first.sessionId)?.name).toBe('Visitor 1');
    expect(second.state.walkers.get(second.sessionId)?.name).toBe('Visitor 2');
    misdirect = true;
    await expect(client.joinById(first.roomId, base.issue(), TavernRoomState)).rejects.toThrow();
    misdirect = false;

    let frame: GatherFrame | undefined, own: GatherSelf | undefined;
    let receipt: { id: string; status: string } | undefined;
    first.onMessage('tables', (value: GatherFrame) => { frame = value; });
    first.onMessage('self', (value: GatherSelf) => { own = value; });
    first.onMessage('private', value => { if (value.type === 'receipt') receipt = value.receipt; });
    await waitFor(() => !!frame && !!own);
    expect(own).toEqual({ table: null, seat: null, seatIndex: null, playerIndex: null });
    first.send('intent', { version: 1, type: 'interact', id: 'distant-chair', targetId: 'tavern:west:seat:1', action: 'tavern' });
    await waitFor(() => receipt?.id === 'distant-chair');
    expect(receipt?.status).not.toBe('applied');
    expect(frame!.tables.every(table => table.pong === null)).toBe(true);

    const initialX = first.state.walkers.get(first.sessionId)!.x;
    const input = first.input<RealmWalkInput>({ mode: 'reliable' });
    for (let i = 0; i < 12; i++) {
      Object.assign(input.data, { moveX: 127, moveZ: 0, buttons: 0, yaw: 64, collisionRevision: TAVERN_COLLISION_REVISION, placement: 0 });
      input.send(); await new Promise(resolve => setTimeout(resolve, 34));
    }
    await waitFor(() => (second.state.walkers.get(first.sessionId)?.x ?? initialX) > initialX + .5);
    expect(second.state.walkers.get(first.sessionId)?.x).toBeGreaterThan(initialX + .5);
    for (let i = 0; i < 8; i++) {
      Object.assign(input.data, { moveX: 0, moveZ: -127, buttons: 0, yaw: 128, collisionRevision: TAVERN_COLLISION_REVISION, placement: 0 });
      input.send(); await new Promise(resolve => setTimeout(resolve, 34));
    }
    await waitFor(() => (first.state.walkers.get(first.sessionId)?.z ?? 10) < 7.9);
    first.send('intent', { version: 1, type: 'interact', id: 'near-chair', targetId: 'tavern:middle:seat:2', action: 'tavern' });
    await waitFor(() => receipt?.id === 'near-chair');
    expect(receipt?.status).toBe('applied');
    await waitFor(() => own?.table === 'middle' && own.seat === 1);
    await waitFor(() => frame!.tables.find(t => t.table === 'middle')?.seats[1] === 'Visitor 1');
    let secondReceipt: { id: string; status: string } | undefined;
    second.onMessage('private', value => { if (value.type === 'receipt') secondReceipt = value.receipt; });
    const secondInput = second.input<RealmWalkInput>({ mode: 'reliable' });
    const interior = createTavernInterior(), approach = interior.registry.get('tavern:middle:seat:1')!.target.approach;
    const body = second.state.walkers.get(second.sessionId)!;
    const driver = seatApproachDriver(interior.world, [body.x, body.y, body.z], approach, [14, 10]);
    for (let i = 0; i < 800 && !driver.done; i++) {
      const current = second.state.walkers.get(second.sessionId)!;
      Object.assign(secondInput.data, driver.input(current), { placement: current.placement });
      secondInput.send(); await new Promise(resolve => setTimeout(resolve, 34));
    }
    expect(driver.done).toBe(true);
    second.send('intent', { version: 1, type: 'interact', id: 'opposite-chair', targetId: 'tavern:middle:seat:1', action: 'tavern' });
    await waitFor(() => secondReceipt?.id === 'opposite-chair');
    expect(secondReceipt?.status).toBe('applied');
    await waitFor(() => frame!.tables.find(t => t.table === 'middle')?.seats[0] === 'Visitor 2');
    const table = frame!.tables.find(t => t.table === 'middle')!;
    first.send('start', { table: 'middle', revision: table.revision, id: 'begin' });
    await waitFor(() => !!frame!.tables.find(t => t.table === 'middle')?.pong);
    const match = frame!.tables.find(t => t.table === 'middle')!.pong!.match;
    const third = await client.joinOrCreate<InstanceType<typeof TavernRoomState>>('tavern', base.issue(), TavernRoomState);
    sockets.push(third); third.reconnection.enabled = false;
    for (const type of ['interior', 'transient', 'private', 'tables', 'self']) third.onMessage(type, () => {});
    third.send('paddle', { match, sequence: 99, paddle: 1 });
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(frame!.tables.find(t => t.table === 'middle')!.pong!.acknowledged).toEqual([-1, -1]);
  } finally {
    await Promise.all(sockets.map(room => room.leave().catch(() => {})));
    await server.gracefullyShutdown(false);
  }
}, 40_000);
