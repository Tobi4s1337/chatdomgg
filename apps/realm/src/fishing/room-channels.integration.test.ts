import { createServer as createProbe } from 'node:net';
import { expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { KingdomRoomState, type RealmPrincipal } from '@chatdom/shared/realm';
import type { ItemReply } from '@chatdom/shared';
import { referenceServices } from '../reference';
import { createRealmServer } from '../server';
import { createItemCatalogue, createRealmItems } from '../items';
import { createMemoryItemStore } from '../items/memory';
import { createItemRoomChannel } from '../items/channel';

async function reservePort() {
  for (let port = 5170; port <= 5186; port++) {
    const probe = createProbe();
    try {
      await new Promise<void>((ready, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', ready); });
      return { port, release: () => new Promise<void>(ready => probe.close(() => ready())) };
    } catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('No free lane test port in 5170–5186.');
}
async function until(predicate: () => boolean) {
  const end = Date.now() + 10_000;
  while (!predicate()) { if (Date.now() > end) throw new Error('The lane room check did not settle.'); await new Promise(resolve => setTimeout(resolve, 20)); }
}

it('serves private items over the existing real room socket and ends a revoked seat', async () => {
  const reserved = await reservePort(), base = referenceServices();
  const revoked = new Set<string>(), unavailable = new Set<string>(), principals: RealmPrincipal[] = [];
  const items = createRealmItems({ store: createMemoryItemStore(), clock: Date.now, catalogue: createItemCatalogue([
    { id: 'fish:perch', branch: 'gathered', title: 'Perch', lore: 'A copper flash in the shallows.', stack: 99, keepsake: false, model: 'fish:perch', places: ['bag', 'away'] },
  ]) });
  const channel = createItemRoomChannel(items, from => from.current());
  let detached = 0, leaveCode = 0;
  const { server } = createRealmServer({ ...base, auth: {
    async authenticate(join) { const principal = await base.auth.authenticate(join); principals.push(principal); return principal; },
    async current(principal, now) {
      if (unavailable.has(principal.sessionId)) throw new Error('Private auth store details');
      return !revoked.has(principal.sessionId) && base.auth.current(principal, now);
    },
  }, channels: [{ ...channel, attach(room) { const stop = channel.attach(room); return () => { detached++; stop(); }; } }] });
  const rooms: Room<KingdomRoomState>[] = [];
  try {
    await reserved.release(); await server.listen(reserved.port, '127.0.0.1');
    console.info(`Pier SDK check owns 127.0.0.1:${reserved.port} until shutdown.`);
    const client = new Client(`http://127.0.0.1:${reserved.port}`);
    const first = await client.joinOrCreate<KingdomRoomState>('kingdom', base.issue(), KingdomRoomState); rooms.push(first);
    const second = await client.joinOrCreate<KingdomRoomState>('kingdom', base.issue(), KingdomRoomState); rooms.push(second);
    const a: ItemReply[] = [], b: ItemReply[] = [];
    first.onMessage('items', (message: ItemReply) => a.push(message)); second.onMessage('items', (message: ItemReply) => b.push(message));
    first.onLeave(code => { leaveCode = code; }); first.reconnection.enabled = false;
    await until(() => first.state.walkers.size === 2 && second.state.walkers.size === 2);
    const owner = principals[0]!;
    const input = { key: 'one', ownerId: owner.personId, kingdomId: owner.kingdomId, origin: owner.origin, defId: 'fish:perch', count: 3,
      story: { by: { personId: owner.personId, name: owner.publicName }, kingdomId: owner.kingdomId, where: 'the pier', at: Date.now(), line: 'Caught at dusk' }, source: { kind: 'fishing' as const, ref: 'one' } };
    const fish = await items.grant(input);
    await until(() => a.some(message => message.type === 'items.changed' && message.items[0]?.id === fish.id));
    first.send('items', { type: 'items.list', id: 'my-bag' }); second.send('items', { type: 'items.list', id: 'other-bag' });
    await until(() => a.some(message => message.type === 'items.list' && message.id === 'my-bag') && b.some(message => message.type === 'items.list' && message.id === 'other-bag'));
    expect(a.find(message => message.type === 'items.list')).toMatchObject({ items: [fish] });
    expect(b).toEqual([{ type: 'items.list', id: 'other-bag', items: [], next: null }]);
    second.send('items', { type: 'items.move', id: 'not-mine', itemId: fish.id, revision: 0, to: 'away', slot: null });
    await until(() => b.some(message => message.type === 'items.refused' && message.id === 'not-mine'));
    expect(await items.get(fish.id)).toEqual(fish);
    first.send('items', { type: 'items.move', id: 'put-away', itemId: fish.id, revision: 0, to: 'away', slot: null });
    await until(() => a.some(message => message.type === 'items.changed' && message.id === 'put-away'));
    expect((await items.get(fish.id))?.revision).toBe(1);
    first.send('items', { type: 'items.history', id: 'my-story', itemId: fish.id });
    await until(() => a.some(message => message.type === 'items.history' && message.id === 'my-story'));
    expect(a.find(message => message.type === 'items.history')).toMatchObject({ events: [{ kind: 'granted' }, { kind: 'put-away' }] });
    first.send('items', { type: 'items.grant', id: 'cannot-grant', defId: 'fish:perch' });
    await until(() => a.some(message => message.type === 'items.refused' && message.id === 'cannot-grant'));
    const before = a.length;
    revoked.add(owner.sessionId);
    await items.grant({ ...input, key: 'earned-while-away', source: { kind: 'fishing', ref: 'earned-while-away' } });
    await until(() => leaveCode !== 0);
    expect(leaveCode).toBe(4401); expect(a).toHaveLength(before);
    expect(b.some(message => message.type === 'items.changed')).toBe(false);
    expect(await items.list(owner.personId, owner.kingdomId)).toHaveLength(2);
    const third = await client.joinOrCreate<KingdomRoomState>('kingdom', base.issue(), KingdomRoomState); rooms.push(third);
    const c: ItemReply[] = []; let unavailableCode = 0;
    third.onMessage('items', (message: ItemReply) => c.push(message)); third.onLeave(code => { unavailableCode = code; }); third.reconnection.enabled = false;
    unavailable.add(principals[2]!.sessionId); third.send('items', { type: 'items.list', id: 'unavailable' });
    await until(() => unavailableCode !== 0);
    expect(unavailableCode).toBe(4503); expect(c).toEqual([]);
  } finally {
    await reserved.release().catch(() => {});
    await Promise.all(rooms.map(room => room.leave().catch(() => {})));
    await server.gracefullyShutdown(false);
  }
  expect(detached).toBe(1);
}, 45_000);
