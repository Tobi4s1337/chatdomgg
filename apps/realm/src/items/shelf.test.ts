import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type ItemDefinition, type ItemRecord, type ShelfReply, type Vec3 } from '@chatdom/shared';
import type { RealmChannelRoom, RealmChannelSender } from '../room-channels';
import { createItemCatalogue, createRealmItems, type RealmItems } from './index';
import { createMemoryItemStore } from './memory';
import { createShelfRoomChannel, shelfHomes, type ShelfHome } from './shelf';

const kingdomId = KingdomIdSchema.parse('300');
const juniper = PersonIdSchema.parse('1001'), wren = PersonIdSchema.parse('1002'), stranger = PersonIdSchema.parse('1003');
const mount: ItemDefinition = { id: 'keepsake:mount.copper-perch', branch: 'kept', title: 'Copper Perch, mounted', lore: 'A perch.',
  stack: null, keepsake: true, model: 'keepsake:mount.copper-perch', places: ['shelf', 'bag', 'away'] };
const ribbon: ItemDefinition = { id: 'game:pong.ribbon', branch: 'kept', title: 'Pong ribbon', lore: 'Won at the tavern.',
  stack: null, keepsake: true, model: 'game:pong.ribbon', places: ['shelf', 'bag', 'away'] };
const rod: ItemDefinition = { id: 'tool:rod.willow', branch: 'held', title: 'Willow Rod', lore: 'A rod.',
  stack: null, keepsake: false, model: 'tool:rod.willow', places: ['hand', 'hotbar', 'bag', 'away'] };
const lantern: ItemDefinition = { id: 'tool:lantern.tin', branch: 'held', title: 'Tin Lantern', lore: 'A lantern.',
  stack: null, keepsake: false, model: 'tool:lantern.tin', places: ['hand', 'hotbar', 'bag', 'away'] };

function setup() {
  let time = 10_000;
  const items = createRealmItems({ store: createMemoryItemStore(), catalogue: createItemCatalogue([mount, ribbon, rod, lantern]), clock: () => ++time });
  let n = 0;
  const give = (owner = juniper, def: ItemDefinition = mount, place?: 'shelf' | 'bag' | 'hotbar') => items.grant({ key: `k${++n}`, ownerId: owner, kingdomId,
    origin: 'live', defId: def.id, ...(place ? { place } : {}),
    story: { by: { personId: owner, name: owner === juniper ? 'Juniper' : 'Wren' }, kingdomId, where: 'Willowmere pier', at: 9_000 + n, line: 'Caught at dusk.' },
    source: { kind: def.id.startsWith('game:') ? 'game' : 'fishing', ref: `ref-${n}` } });
  return { items, give };
}
const slots = (records: readonly ItemRecord[]) => records.filter(item => item.place === 'shelf').map(item => item.slot).sort((a, b) => a! - b!);

describe('arranging the shelf', () => {
  it('only the owner arranges, and only at the current revision', async () => {
    const { items, give } = setup();
    const a = await give();
    expect(a).toMatchObject({ place: 'shelf', slot: 0, revision: 0 });
    expect(await items.arrange(stranger, a.id, { place: 'shelf', slot: 4 }, 0)).toEqual({ ok: false, message: 'This thing is not yours here.' });
    expect(await items.arrange(juniper, a.id, { place: 'shelf', slot: 4 }, 3)).toMatchObject({ ok: false });
    const moved = await items.arrange(juniper, a.id, { place: 'shelf', slot: 4 }, 0);
    expect(moved).toMatchObject({ ok: true, items: [{ id: a.id, slot: 4, revision: 1 }] });
    // The same request again is stale now: nothing moves twice.
    expect(await items.arrange(juniper, a.id, { place: 'shelf', slot: 5 }, 0)).toMatchObject({ ok: false });
    expect((await items.history(a.id)).map(event => event.kind)).toEqual(['granted', 'moved']);
  });

  it('a taken slot swaps the two keepsakes; nothing is lost and no slot holds two', async () => {
    const { items, give } = setup();
    const a = await give(), b = await give(), c = await give();
    expect([a.slot, b.slot, c.slot]).toEqual([0, 1, 2]);
    const swap = await items.arrange(juniper, a.id, { place: 'shelf', slot: 2 }, 0);
    expect(swap.ok).toBe(true);
    const after = await items.list(juniper, kingdomId);
    expect(after.find(item => item.id === a.id)).toMatchObject({ slot: 2, revision: 1 });
    expect(after.find(item => item.id === c.id)).toMatchObject({ slot: 0, place: 'shelf', revision: 1 });
    expect(slots(after)).toEqual([0, 1, 2]);
    expect((await items.history(c.id)).at(-1)).toMatchObject({ kind: 'moved', from: 'shelf', to: 'shelf', actor: 'owner' });
  });

  it('a keepsake from the bag into a taken slot moves the one standing there to the first free slot', async () => {
    const { items, give } = setup();
    const a = await give(), b = await give(), bagged = await give(juniper, mount, 'bag');
    const result = await items.arrange(juniper, bagged.id, { place: 'shelf', slot: 0 }, 0);
    expect(result.ok && result.items.map(item => [item.id, item.place, item.slot])).toEqual([[bagged.id, 'shelf', 0], [a.id, 'shelf', 2]]);
    expect(slots(await items.list(juniper, kingdomId))).toEqual([0, 1, 2]);
    void b;
  });

  it('a full shelf sends the displaced keepsake to the bag, never away from its owner', async () => {
    const { items, give } = setup();
    const shelf: ItemRecord[] = [];
    for (let i = 0; i < 64; i++) shelf.push(await give());
    const late = await give(juniper, mount, 'bag');
    const result = await items.arrange(juniper, late.id, { place: 'shelf', slot: 7 }, late.revision);
    expect(result.ok && result.items.map(item => [item.place, item.slot])).toEqual([['shelf', 7], ['bag', null]]);
    const all = await items.list(juniper, kingdomId);
    expect(all).toHaveLength(65);
    expect(new Set(slots(all)).size).toBe(64);
    expect(slots(all)).toHaveLength(64);
  });

  it('refuses things that do not belong on the shelf, and keeps the belt for tools', async () => {
    const { items, give } = setup();
    const r = await give(juniper, rod, 'hotbar'), k = await give();
    expect(await items.arrange(juniper, r.id, { place: 'shelf', slot: 3 }, 0)).toEqual({ ok: false, message: 'Only keepsakes stand on the shelf.' });
    expect(await items.arrange(juniper, k.id, { place: 'hotbar', slot: 3 }, 0)).toEqual({ ok: false, message: 'Only tools go on your belt.' });
  });

  it('reorders the belt by swapping two tools', async () => {
    const { items, give } = setup();
    const r = await give(juniper, rod, 'hotbar'), l = await give(juniper, lantern, 'hotbar');
    expect([r.slot, l.slot]).toEqual([0, 1]);
    const swapped = await items.arrange(juniper, l.id, { place: 'hotbar', slot: 0 }, 0);
    expect(swapped.ok && swapped.items.map(item => [item.id, item.slot])).toEqual([[l.id, 0], [r.id, 1]]);
    const moved = await items.arrange(juniper, r.id, { place: 'hotbar', slot: 5 }, 1);
    expect(moved.ok && moved.items.map(item => item.slot)).toEqual([5]);
  });
});

describe('showing the shelf to visitors', () => {
  it('is hidden until its owner chooses, revision-checked, and shows no person ids', async () => {
    const { items, give } = setup();
    await give(wren); await give(wren);
    expect(await items.shelf(wren, kingdomId, 'live')).toEqual({ shown: false, revision: 0 });
    expect(await items.visitShelf(wren, kingdomId, 'live')).toBeNull();
    expect(await items.shownShelves(kingdomId, 'live')).toEqual([]);
    expect(await items.showShelf(wren, kingdomId, 'live', true, 4, 'Wren')).toMatchObject({ ok: false });
    expect(await items.showShelf(wren, kingdomId, 'live', true, 0, 'Wren')).toEqual({ ok: true, settings: { shown: true, revision: 1 } });
    const pieces = await items.visitShelf(wren, kingdomId, 'live');
    expect(pieces).toHaveLength(2);
    expect(pieces![0]).toMatchObject({ slot: 0, story: { name: 'Wren', where: 'Willowmere pier' } });
    expect(JSON.stringify(pieces)).not.toContain(wren);
    expect(await items.shownShelves(kingdomId, 'live')).toEqual([{ ownerId: wren, name: 'Wren' }]);
    expect(await items.showShelf(wren, kingdomId, 'live', false, 1, 'Wren')).toEqual({ ok: true, settings: { shown: false, revision: 2 } });
    expect(await items.visitShelf(wren, kingdomId, 'live')).toBeNull();
    expect(await items.shownShelves(kingdomId, 'live')).toEqual([]);
  });

  it('hides a forgotten name but keeps the shelf its owner showed', async () => {
    const { items, give } = setup();
    await give(wren);
    await items.showShelf(wren, kingdomId, 'live', true, 0, 'Wren');
    await items.forgetName(wren);
    expect(await items.shownShelves(kingdomId, 'live')).toEqual([{ ownerId: wren, name: null }]);
  });
});

describe('the shelf room channel', () => {
  const door: Vec3 = [10, 2, 10], wrensDoor: Vec3 = [40, 2, 40];
  function room(items: RealmItems) {
    const homes: ShelfHome[] = [{ plotId: 'plot-1', ownerId: juniper, at: door }, { plotId: 'plot-2', ownerId: wren, at: wrensDoor },
      { plotId: 'plot-3', ownerId: null, at: [70, 2, 70] }];
    let handler!: Parameters<RealmChannelRoom['onMessage']>[0];
    const sent: { personId: string; message: ShelfReply }[] = [];
    const channelRoom: RealmChannelRoom = { kingdomId, origin: 'live', onMessage(fn) { handler = fn; },
      toPerson(personId, message) { sent.push({ personId, message: message as ShelfReply }); },
      person: () => null, broadcast() { throw new Error('A shelf never broadcasts.'); }, world() { throw new Error('unused'); } };
    let at: Vec3 = [11, 2, 10];
    const sender = (personId: typeof juniper, name: string): RealmChannelSender => ({ principal: { personId, kingdomId, origin: 'live', sessionId: `s${personId}`,
      expiresAt: 9e12, publicName: name, look: 'look' }, walkerId: `w${personId}`, present: () => true, current: async () => true,
      pose: () => ({ position: at, yaw: 0, grounded: true, collisionRevision: 1 }) });
    const dispose = createShelfRoomChannel({ items, admit: async () => true, homes: () => homes }).attach(channelRoom);
    const ask = async (who: RealmChannelSender, raw: unknown) => { await handler(who, raw); return sent.at(-1)!.message; };
    return { ask, juniper: sender(juniper, 'Juniper'), wren: sender(wren, 'Wren'), stand: (to: Vec3) => { at = to; }, dispose };
  }

  it('reads your door and settings, and lists only shelves their owners show', async () => {
    const { items, give } = setup();
    await give(wren);
    const s = room(items);
    expect(await s.ask(s.juniper, { type: 'shelf.read', id: 'r' })).toEqual({ type: 'shelf.state', id: 'r', settings: { shown: false, revision: 0 },
      door: { plotId: 'plot-1', at: door, name: null, mine: true, shown: false } });
    expect(await s.ask(s.juniper, { type: 'shelf.doors', id: 'd' })).toEqual({ type: 'shelf.doors', id: 'd',
      doors: [{ plotId: 'plot-1', at: door, name: null, mine: true, shown: false }] });
    expect(await s.ask(s.wren, { type: 'shelf.show', id: 's', shown: true, revision: 0 })).toMatchObject({ type: 'shelf.state', settings: { shown: true, revision: 1 } });
    const doors = await s.ask(s.juniper, { type: 'shelf.doors', id: 'd2' });
    expect(doors).toMatchObject({ doors: [{ plotId: 'plot-1', mine: true }, { plotId: 'plot-2', name: 'Wren', mine: false, shown: true }] });
    expect(JSON.stringify(doors)).not.toContain(wren);
  });

  it('lets a visitor look only from the door, and only while the shelf is shown', async () => {
    const { items, give } = setup();
    await give(wren);
    const s = room(items);
    expect(await s.ask(s.juniper, { type: 'shelf.visit', id: 'v', plotId: 'plot-2' })).toMatchObject({ type: 'shelf.refused' });
    await s.ask(s.wren, { type: 'shelf.show', id: 's', shown: true, revision: 0 });
    expect(await s.ask(s.juniper, { type: 'shelf.visit', id: 'v', plotId: 'plot-2' })).toEqual({ type: 'shelf.refused', id: 'v',
      message: 'Stand at the door to look at the shelf inside.' });
    s.stand([41, 2, 39]);
    const view = await s.ask(s.juniper, { type: 'shelf.visit', id: 'v', plotId: 'plot-2' });
    expect(view).toMatchObject({ type: 'shelf.view', plotId: 'plot-2', name: 'Wren', pieces: [{ slot: 0, story: { name: 'Wren' } }] });
    expect(JSON.stringify(view)).not.toContain(wren);
    expect(await s.ask(s.juniper, { type: 'shelf.visit', id: 'v', plotId: 'plot-3' })).toMatchObject({ type: 'shelf.refused' });
    await s.ask(s.wren, { type: 'shelf.show', id: 'h', shown: false, revision: 1 });
    expect(await s.ask(s.juniper, { type: 'shelf.visit', id: 'v', plotId: 'plot-2' })).toMatchObject({ type: 'shelf.refused', message: 'This shelf is kept by its owner.' });
  });

  it('arranges your own things and refuses anyone else’s', async () => {
    const { items, give } = setup();
    const mine = await give(), theirs = await give(wren);
    const s = room(items);
    expect(await s.ask(s.juniper, { type: 'shelf.arrange', id: 'a', itemId: theirs.id, revision: 0, to: 'shelf', slot: 3 })).toMatchObject({ type: 'shelf.refused' });
    expect(await s.ask(s.juniper, { type: 'shelf.arrange', id: 'a', itemId: mine.id, revision: 0, to: 'shelf', slot: 3 }))
      .toMatchObject({ type: 'shelf.arranged', items: [{ id: mine.id, slot: 3 }] });
    expect(await s.ask(s.juniper, { type: 'shelf.arrange', id: 'b', itemId: mine.id, revision: 1, to: 'shelf', slot: 64 })).toMatchObject({ type: 'shelf.refused' });
  });
});

it('finds each home’s door and owner from the plan and the current deeds', () => {
  const plan = { homes: [{ id: 'p1', approachId: 'n1', position: [1, 0, 1] as Vec3 }, { id: 'p2', approachId: 'missing', position: [5, 0, 5] as Vec3 }],
    nodes: [{ id: 'n1', position: [2, 0, 3] as Vec3 }] };
  const deeds = { p1: { id: 'p1', ownerId: juniper, layoutRevision: 'L2' }, p2: { id: 'p2', ownerId: wren, layoutRevision: 'L1' } };
  expect(shelfHomes(plan, deeds, 'L2')).toEqual([{ plotId: 'p1', ownerId: juniper, at: [2, 0, 3] }, { plotId: 'p2', ownerId: null, at: [5, 0, 5] }]);
});
