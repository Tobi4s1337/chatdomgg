import { expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type ItemDefinition, type ItemReply } from '@chatdom/shared';
import type { RealmChannelRoom, RealmChannelSender } from '../room-channels';
import { createItemRoomChannel } from './channel';
import { createItemCatalogue, createRealmItems } from './index';
import { createMemoryItemStore } from './memory';

const kingdomId = KingdomIdSchema.parse('200'), otherKingdom = KingdomIdSchema.parse('201');
const ownerId = PersonIdSchema.parse('100'), stranger = PersonIdSchema.parse('101');
const fish: ItemDefinition = { id: 'fish:perch', branch: 'gathered', title: 'Perch', lore: 'A fish.', stack: 10, keepsake: false, model: 'fish:perch', places: ['bag', 'away'] };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function setup() {
  const items = createRealmItems({ store: createMemoryItemStore(), catalogue: createItemCatalogue([fish]), clock: () => 1000 });
  const grant = (key: string, owner = ownerId, kingdom = kingdomId, origin: 'live' | 'simulated' = 'live') => items.grant({ key, ownerId: owner, kingdomId: kingdom, origin, defId: fish.id, count: 3,
    story: { by: null, kingdomId: kingdom, where: 'pier', at: 900, line: 'Caught here.' }, source: { kind: 'fishing', ref: key } });
  let handler!: Parameters<RealmChannelRoom['onMessage']>[0];
  const sent: { personId: typeof ownerId; message: ItemReply }[] = [];
  const room: RealmChannelRoom = { kingdomId, origin: 'live', onMessage(fn) { handler = fn; }, toPerson(personId, message) { sent.push({ personId, message: message as ItemReply }); },
    person: personId => ({ ...sender, principal: { ...sender.principal, personId } }),
    broadcast() { throw new Error('Private items must never broadcast'); }, world() { throw new Error('unused'); } };
  let current = true;
  const sender: RealmChannelSender = { principal: { personId: ownerId, kingdomId, origin: 'live', sessionId: 's', expiresAt: 9999, publicName: 'Juniper', look: 'look' }, walkerId: 's', pose: () => null, present: () => current, current: async () => current };
  const dispose = createItemRoomChannel(items, from => from.current()).attach(room);
  return { items, grant, sent, sender, dispose, request: (raw: unknown) => handler(sender, raw), expire: () => { current = false; } };
}

it('uses authenticated owner, kingdom and origin for listing, history and writes', async () => {
  const s = setup();
  const own = await s.grant('own'), foreignOwner = await s.grant('stranger', stranger), foreignKingdom = await s.grant('elsewhere', ownerId, otherKingdom), foreignOrigin = await s.grant('simulation', ownerId, kingdomId, 'simulated');
  await tick(); s.sent.length = 0;
  await s.request({ type: 'items.list', id: 'list' });
  expect(s.sent.at(-1)).toMatchObject({ personId: ownerId, message: { type: 'items.list', id: 'list', items: [own] } });
  for (const target of [foreignOwner, foreignKingdom, foreignOrigin]) {
    for (const request of [
      { type: 'items.history', id: 'history', itemId: target.id },
      { type: 'items.move', id: 'move', itemId: target.id, revision: 0, to: 'away', slot: null },
      { type: 'items.release', id: 'release', itemId: target.id, revision: 0, count: 1 },
    ]) {
      await s.request(request);
      expect(s.sent.at(-1)?.message).toMatchObject({ type: 'items.refused', id: request.id });
    }
    expect(await s.items.get(target.id)).toEqual(target);
    expect((await s.items.history(target.id)).map(e => e.kind)).toEqual(['granted']);
  }
  for (const request of [{ type: 'items.grant', id: 'hack', defId: fish.id }, { type: 'items.list', id: 'override', ownerId: stranger },
    { type: 'items.move', id: 'override-write', ownerId: stranger, itemId: foreignOwner.id, revision: 0, to: 'away', slot: null }]) {
    await s.request(request); expect(s.sent.at(-1)?.message).toMatchObject({ type: 'items.refused', id: request.id });
  }
  await s.request({ type: 'items.move', id: 'ok', itemId: own.id, revision: 0, to: 'away', slot: null });
  expect(s.sent.some(entry => entry.personId === ownerId && entry.message.type === 'items.changed' && entry.message.id === 'ok' && entry.message.items[0]?.revision === 1)).toBe(true);
  await s.request({ type: 'items.history', id: 'mine', itemId: own.id });
  expect(s.sent.at(-1)?.message).toMatchObject({ type: 'items.history', id: 'mine', events: [{ kind: 'granted' }, { kind: 'put-away' }] });
  s.dispose();
});

it('pushes changes only to the owner in the matching kingdom and origin, and stops on disposal', async () => {
  const s = setup();
  const own = await s.grant('own'); await tick();
  expect(s.sent).toEqual([{ personId: ownerId, message: { type: 'items.changed', items: [own] } }]);
  s.sent.length = 0;
  await s.grant('simulated', ownerId, kingdomId, 'simulated');
  await s.grant('elsewhere', ownerId, otherKingdom);
  await tick(); expect(s.sent).toEqual([]);
  const other = await s.grant('other', stranger); await tick();
  expect(s.sent).toEqual([{ personId: stranger, message: { type: 'items.changed', items: [other] } }]);
  s.sent.length = 0; s.dispose();
  await s.items.release(ownerId, own.id, 1, 0); await tick();
  expect(s.sent).toEqual([]);
});

it('freshly checks a locally present owner before a server push and coalesces overflow into a refresh', async () => {
  const s = setup();
  vi.spyOn(s.sender, 'current').mockResolvedValue(false);
  await s.grant('revoked'); await tick();
  expect(s.sender.present()).toBe(true); expect(s.sender.current).toHaveBeenCalled(); expect(s.sent).toEqual([]);
  s.dispose();
  const t = setup();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(t.sender, 'current').mockImplementation(async () => { await gate; return true; });
  for (let i = 0; i < 105; i++) await t.grant(`batch-${i}`);
  await tick(); expect(t.sent).toEqual([]);
  release(); await tick();
  expect(t.sent).toEqual([{ personId: ownerId, message: { type: 'items.invalidated' } }]);
  t.dispose();
});

it('suppresses stale or disposed replies and redacts infrastructure errors', async () => {
  const s = setup();
  vi.spyOn(s.items, 'listPage').mockRejectedValueOnce(new Error('private database password and host'));
  await s.request({ type: 'items.list', id: 'error' });
  expect(s.sent.at(-1)?.message).toEqual({ type: 'items.refused', id: 'error', message: 'The kingdom could not confirm that request. Open your bag again to check your things before trying again.' });
  s.sent.length = 0;
  let finish!: () => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  vi.spyOn(s.items, 'listPage').mockImplementationOnce(async () => { started(); await new Promise<void>(resolve => { finish = resolve; }); return { items: [], next: null }; });
  const pending = s.request({ type: 'items.list', id: 'late' }); await entered;
  s.expire(); finish(); await pending;
  expect(s.sent).toEqual([]);
  const t = setup();
  let release!: () => void, begin!: () => void;
  const ready = new Promise<void>(resolve => { begin = resolve; });
  vi.spyOn(t.items, 'listPage').mockImplementationOnce(async () => { begin(); await new Promise<void>(resolve => { release = resolve; }); return { items: [], next: null }; });
  const disposed = t.request({ type: 'items.list', id: 'late' }); await ready;
  t.dispose(); release(); await disposed;
  expect(t.sent).toEqual([]);
});
