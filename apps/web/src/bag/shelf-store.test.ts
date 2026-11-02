import { describe, expect, it, vi } from 'vitest';
import type { ItemReply, ItemRequest, ShelfReply, ShelfRequest } from '@chatdom/shared';
import type { ItemLink, ShelfLink } from '../fishing/link';
import { OWNER, record } from './records.fixture';
import { createShelfStore } from './shelf-store';
import { createBagStore } from './store';

function fake<Req extends { type: string; id?: string }, Rep>() {
  const sent: Req[] = [];
  const listeners = new Set<(reply: Rep) => void>();
  const link = { send: (request: Req) => { sent.push(request); },
    subscribe: (listener: (reply: Rep) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, dispose: () => listeners.clear() };
  const reply = (message: Rep) => { for (const listener of [...listeners]) listener(message); };
  const last = <T extends Req['type']>(type: T) => [...sent].reverse().find(request => request.type === type) as Extract<Req, { type: T }>;
  return { link, sent, reply, last };
}

function setup() {
  const items = fake<ItemRequest, ItemReply>(), shelf = fake<ShelfRequest, ShelfReply>();
  const bag = createBagStore(items.link as ItemLink, { personId: OWNER });
  items.reply({ type: 'items.list', id: items.last('items.list').id, next: null,
    items: [record('a', { place: 'shelf', slot: 0, revision: 3 }), record('b', { place: 'bag', slot: null, revision: 1 })] });
  const store = createShelfStore(shelf.link as ShelfLink, bag, { personId: OWNER, timeoutMs: 500 });
  return { items, shelf, bag, store };
}

describe('the shelf store', () => {
  it('reads its settings and doors, and keeps your own door', () => {
    const { shelf, store } = setup();
    expect(store.settings()).toBeNull();
    const door = { plotId: 'home:3', at: [4, 1, 9] as const, name: null, mine: true, shown: false };
    shelf.reply({ type: 'shelf.state', id: shelf.last('shelf.read').id, settings: { shown: false, revision: 0 }, door });
    shelf.reply({ type: 'shelf.doors', id: shelf.last('shelf.doors').id, doors: [door, { plotId: 'home:5', at: [9, 1, 9], name: 'Wren', mine: false, shown: true }] });
    expect(store.settings()).toEqual({ shown: false, revision: 0 });
    expect(store.door()).toMatchObject({ plotId: 'home:3', mine: true });
    expect(store.doors().map(entry => entry.name)).toEqual([null, 'Wren']);
    // An older settings echo never rolls the shelf back.
    shelf.reply({ type: 'shelf.state', settings: { shown: true, revision: 2 }, door });
    shelf.reply({ type: 'shelf.state', settings: { shown: false, revision: 1 }, door });
    expect(store.settings()).toEqual({ shown: true, revision: 2 });
  });

  it('arranges with the bag’s revision on the shelf and the belt, and reads the bag again after a refusal', async () => {
    const { items, shelf, store } = setup();
    const done = store.arrange('b', 4);
    expect(shelf.last('shelf.arrange')).toMatchObject({ itemId: 'b', revision: 1, to: 'shelf', slot: 4 });
    shelf.reply({ type: 'shelf.arranged', id: shelf.last('shelf.arrange').id, items: [] });
    expect(await done).toEqual({ ok: true });
    const belt = store.arrangeBelt('a', 2);
    expect(shelf.last('shelf.arrange')).toMatchObject({ itemId: 'a', revision: 3, to: 'hotbar', slot: 2 });
    const lists = items.sent.filter(request => request.type === 'items.list').length;
    shelf.reply({ type: 'shelf.refused', id: shelf.last('shelf.arrange').id, message: 'Only tools go on your belt.' });
    expect(await belt).toEqual({ ok: false, message: 'Only tools go on your belt.' });
    expect(items.sent.filter(request => request.type === 'items.list').length).toBe(lists + 1);
    expect(await store.arrange('gone', 0)).toMatchObject({ ok: false });
  });

  it('shows with the current revision, refuses before the kingdom answered, and visits by door', async () => {
    const { shelf, store } = setup();
    expect(await store.show(true)).toMatchObject({ ok: false });
    shelf.reply({ type: 'shelf.state', id: shelf.last('shelf.read').id, settings: { shown: false, revision: 4 }, door: null });
    const shown = store.show(true);
    expect(shelf.last('shelf.show')).toMatchObject({ shown: true, revision: 4 });
    shelf.reply({ type: 'shelf.state', id: shelf.last('shelf.show').id, settings: { shown: true, revision: 5 }, door: null });
    expect(await shown).toEqual({ ok: true });
    expect(store.settings()).toEqual({ shown: true, revision: 5 });
    const look = store.visit('home:5');
    shelf.reply({ type: 'shelf.view', id: shelf.last('shelf.visit').id, plotId: 'home:5', name: 'Wren', pieces: [] });
    expect(await look).toMatchObject({ ok: true, plotId: 'home:5', source: { mode: 'visit', name: 'Wren', pieces: [] } });
    const far = store.visit('home:6');
    shelf.reply({ type: 'shelf.refused', id: shelf.last('shelf.visit').id, message: 'Stand at the door to look at the shelf inside.' });
    expect(await far).toEqual({ ok: false, message: 'Stand at the door to look at the shelf inside.' });
  });

  it('answers in words when the kingdom is silent, and closes cleanly', async () => {
    vi.useFakeTimers();
    try {
      const { store } = setup();
      const silent = store.visit('home:9');
      vi.advanceTimersByTime(600);
      expect(await silent).toMatchObject({ ok: false });
      const open = store.visit('home:9');
      store.dispose();
      expect(await open).toMatchObject({ ok: false });
    } finally { vi.useRealTimers(); }
  });
});
