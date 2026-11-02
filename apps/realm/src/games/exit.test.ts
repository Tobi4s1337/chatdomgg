import { Client, type Room } from '@colyseus/sdk';
import { createServer as createPortProbe } from 'node:net';
import { GatherInteriorSchema, TavernRoomState, type GatherInterior } from '@chatdom/shared';
import type { RealmWalkInput } from '@chatdom/shared/realm';
import { expect, it } from 'vitest';
import { createRealmServer } from '../server';
import { referenceServices } from '../reference';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (predicate: () => boolean, timeout = 8_000) => {
  const until = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > until) throw new Error('Tavern state did not arrive'); await pause(25); }
};
async function freeTestPort(): Promise<number> {
  for (const port of [5183, 5184, 5185, 5186, 5188, 5189, 5170, 5171, 5172, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5182]) {
    const free = await new Promise<boolean>(resolve => {
      const probe = createPortProbe();
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('No approved free port for the tavern exit test');
}

it('tells only the walker who crosses the interior doorway, once per crossing, and never on arrival', async () => {
  // Reference services issue one-use local tickets: transport evidence for the room's own doorway watch.
  const base = referenceServices(), { server } = createRealmServer(base), port = await freeTestPort();
  const sockets: Room<InstanceType<typeof TavernRoomState>>[] = [];
  await server.listen(port, '127.0.0.1');
  try {
    const client = new Client(`http://127.0.0.1:${port}`);
    const walker = await client.joinOrCreate<InstanceType<typeof TavernRoomState>>('tavern', base.issue(), TavernRoomState);
    const watcher = await client.joinOrCreate<InstanceType<typeof TavernRoomState>>('tavern', base.issue(), TavernRoomState);
    sockets.push(walker, watcher);
    let interior: GatherInterior | undefined, exits = 0, watcherExits = 0;
    walker.onMessage('interior', raw => { interior = GatherInteriorSchema.parse(raw); });
    walker.onMessage('exit', () => { exits++; });
    watcher.onMessage('exit', () => { watcherExits++; });
    for (const room of sockets) {
      room.reconnection.enabled = false;
      for (const type of ['transient', 'private', 'tables', 'self', 'receipt']) room.onMessage(type, () => {});
    }
    watcher.onMessage('interior', () => {});
    walker.send('bootstrap');
    await waitFor(() => !!interior && sockets.every(room => room.state.walkers.size === 2));
    expect(interior!.exit).toBeDefined();
    const z = () => walker.state.walkers.get(walker.sessionId)!.z;
    const input = walker.input<RealmWalkInput>({ mode: 'reliable' });
    const walk = async (moveZ: number, until: () => boolean) => {
      for (let i = 0; i < 90 && !until(); i++) {
        Object.assign(input.data, { moveX: 0, moveZ, buttons: 0, yaw: moveZ > 0 ? 0 : 128, collisionRevision: interior!.revision, placement: 0 });
        input.send(); await pause(34);
      }
      Object.assign(input.data, { moveX: 0, moveZ: 0 }); input.send();
    };
    await pause(300);
    expect(exits).toBe(0);
    // Out through the doorway: the outer wall stops the body on the threshold, and the room says so once.
    await walk(127, () => exits > 0);
    expect(exits).toBe(1);
    // The private notice can precede the next state patch; the body itself is on the threshold.
    await waitFor(() => z() > interior!.exit!.min[2]);
    await walk(127, () => false);
    expect(exits).toBe(1);
    // Back into the room and out again is a second crossing.
    await walk(-127, () => z() < interior!.exit!.min[2] - .4);
    expect(exits).toBe(1);
    await walk(127, () => exits > 1);
    expect(exits).toBe(2);
    expect(watcherExits).toBe(0);
  } finally {
    await Promise.all(sockets.map(room => room.leave().catch(() => {})));
    await server.gracefullyShutdown(false);
  }
}, 40_000);
