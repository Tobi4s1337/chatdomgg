import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemReply, ItemRequest, PersonId } from '@chatdom/shared';
import type { ItemLink } from '../fishing/link';
import { BAG_MAX_RECORDS, createBagStore } from './store';
import { OWNER, record } from './records.fixture';

function fakeLink() {
  const sent: ItemRequest[] = [];
  const listeners = new Set<(reply: ItemReply) => void>();
  const link: ItemLink = {
    send: request => { sent.push(request); },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose: () => listeners.clear(),
  };
  const reply = (message: ItemReply) => { for (const listener of [...listeners]) listener(message); };
  const last = <T extends ItemRequest['type']>(type: T) => [...sent].reverse().find(request => request.type === type) as Extract<ItemRequest, { type: T }>;
  return { link, sent, reply, last, listeners };
}

afterEach(() => { vi.useRealTimers(); });

describe('the bag store', () => {
  it('walks every list page with the cursor and becomes ready once the last page arrives', () => {
    const fake = fakeLink();
    const store = createBagStore(fake.link, { personId: OWNER });
    expect(store.status()).toBe('loading');
    const first = fake.last('items.list');
    expect(first.after).toBeUndefined();
    const pageOne = Array.from({ length: 32 }, (_, i) => record(`a${String(i).padStart(2, '0')}`));
    fake.reply({ type: 'items.list', id: first.id, items: pageOne, next: 'a31' });
    expect(store.status()).toBe('loading');
    const second = fake.last('items.list');
    expect(second).toMatchObject({ id: first.id, after: 'a31' });
    fake.reply({ type: 'items.list', id: second.id, items: [record('b00'), record('b01')], next: null });
    expect(store.status()).toBe('ready');
    expect(store.items()).toHaveLength(34);
    expect(new Set(store.items().map(item => item.id)).size).toBe(34);
  });

  it('ignores answers to someone else’s request id and records owned by another person', () => {
    const fake = fakeLink();
    const store = createBagStore(fake.link, { personId: OWNER });
    fake.reply({ type: 'items.list', id: 'bag.other.1', items: [record('x')], next: null });
    expect(store.status()).toBe('loading');
    fake.reply({ type: 'items.list', id: fake.last('items.list').id, items: [record('a'), record('b', { ownerId: '99' as PersonId })], next: null });
    expect(store.items().map(item => item.id)).toEqual(['a']);
    fake.reply({ type: 'items.changed', items: [record('c', { ownerId: '99' as PersonId })] });
    expect(store.item('c')).toBeUndefined();
  });

  it('merges pushes by id and revision, never regressing to an older copy', () => {
    const fake = fakeLink();
    const store = createBagStore(fake.link);
    fake.reply({ type: 'items.list', id: fake.last('items.list').id, items: [record('a', { count: 3, revision: 2 })], next: null });
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.items().length));
    fake.reply({ type: 'items.changed', items: [record('a', { count: 4, revision: 3 })] });
    expect(store.item('a')?.count).toBe(4);
    fake.reply({ type: 'items.changed', items: [record('a', { count: 2, revision: 1 })] });
    expect(store.item('a')).toMatchObject({ count: 4, revision: 3 });
    fake.reply({ type: 'items.changed', items: [record('b'), record('b')] });
    expect(store.items().map(item => item.id)).toEqual(['a', 'b']);
    expect(seen).toEqual([1, 2]);
    const before = store.items();
    fake.reply({ type: 'items.changed', items: [record('a', { count: 1, revision: 1 })] });
    expect(store.items()).toBe(before);
  });

  it('lets a spent record leave and keeps a slower page from bringing it back', () => {
    const fake = fakeLink();
    const store = createBagStore(fake.link);
    fake.reply({ type: 'items.list', id: fake.last('items.list').id, items: [record('a', { count: 2, revision: 4 })], next: null });
    fake.reply({ type: 'items.invalidated' });
    const reload = fake.last('items.list');
    fake.reply({ type: 'items.changed', items: [record('a', { count: 0, place: 'spent', revision: 5 })] });
    expect(store.item('a')).toBeUndefined();
    fake.reply({ type: 'items.list', id: reload.id, items: [record('a', { count: 2, revision: 4 })], next: null });
    expect(store.item('a')).toBeUndefined();
    expect(store.status()).toBe('ready');
  });

  it('reads from page one again after items.invalidated and drops what the server no longer lists', () => {
    const fake = fakeLink();
    const store = createBagStore(fake.link);
    const first = fake.last('items.list');
    fake.reply({ type: 'items.list', id: first.id, items: [record('a'), record('b')], next: null });
    fake.reply({ type: 'items.invalidated' });
    const reload = fake.last('items.list');
    expect(reload.id).not.toBe(first.id);
    expect(reload.after).toBeUndefined();
    expect(store.status()).toBe('ready');
    // A late page from the abandoned walk is ignored.
    fake.reply({ type: 'items.list', id: first.id, items: [record('z')], next: null });
    expect(store.item('z')).toBeUndefined();
    fake.reply({ type: 'items.changed', items: [record('c')] });
    fake.reply({ type: 'items.list', id: reload.id, items: [record('b', { revision: 1, count: 2 })], next: null });
    expect(store.items().map(item => item.id).sort()).toEqual(['b', 'c']);
    expect(store.item('b')?.count).toBe(2);
  });

  it('restarts a walk that is invalidated midway', () => {
    const fake = fakeLink();
    const store = createBagStore(fake.link);
    const first = fake.last('items.list');
    fake.reply({ type: 'items.list', id: first.id, items: [record('a')], next: 'a' });
    fake.reply({ type: 'items.invalidated' });
    const restart = fake.last('items.list');
    expect(restart.after).toBeUndefined();
    fake.reply({ type: 'items.list', id: first.id, items: [record('b')], next: null });
    expect(store.status()).toBe('loading');
    fake.reply({ type: 'items.list', id: restart.id, items: [record('a'), record('b')], next: null });
    expect(store.items().map(item => item.id)).toEqual(['a', 'b']);
  });

  it('stops at a repeated cursor instead of looping', () => {
    const fake = fakeLink();
    const store = createBagStore(fake.link);
    const id = fake.last('items.list').id;
    fake.reply({ type: 'items.list', id, items: [record('a')], next: 'a' });
    fake.reply({ type: 'items.list', id, items: [record('a')], next: 'a' });
    expect(store.status()).toBe('ready');
    expect(fake.sent.filter(request => request.type === 'items.list')).toHaveLength(2);
  });

  it('holds at most the bounded number of records', () => {
    const fake = fakeLink();
    const store = createBagStore(fake.link);
    let request = fake.last('items.list');
    let n = 0;
    for (let page = 0; page < 80 && store.status() === 'loading'; page++) {
      const items = Array.from({ length: 32 }, () => record(`r${String(n++).padStart(5, '0')}`));
      fake.reply({ type: 'items.list', id: request.id, items, next: items[31]!.id });
      request = fake.last('items.list');
    }
    expect(store.status()).toBe('ready');
    expect(store.items()).toHaveLength(BAG_MAX_RECORDS);
    fake.reply({ type: 'items.changed', items: [record('zz-new')] });
    expect(store.items()).toHaveLength(BAG_MAX_RECORDS);
  });

  it('says it is unavailable when the first list is refused or never answered', () => {
    vi.useFakeTimers();
    const fake = fakeLink();
    const refused = createBagStore(fake.link);
    fake.reply({ type: 'items.refused', id: fake.last('items.list').id, message: 'Your kingdom entry has ended. Open your bag after walking in again.' });
    expect(refused.status()).toBe('unavailable');
    expect(refused.refused().at(-1)?.message).toBe('Your kingdom entry has ended. Open your bag after walking in again.');
    const quiet = createBagStore(fakeLink().link, { timeoutMs: 1000 });
    vi.advanceTimersByTime(999);
    expect(quiet.status()).toBe('loading');
    vi.advanceTimersByTime(1);
    expect(quiet.status()).toBe('unavailable');
  });

  it('moves with the current revision and resolves with the server’s record', async () => {
    const fake = fakeLink();
    const store = createBagStore(fake.link);
    fake.reply({ type: 'items.list', id: fake.last('items.list').id, items: [record('rod', { defId: 'tool:rod.willow', branch: 'held', storied: true, revision: 3 })], next: null });
    const moving = store.move('rod', 'hotbar', 0);
    const request = fake.last('items.move');
    expect(request).toMatchObject({ itemId: 'rod', revision: 3, to: 'hotbar', slot: 0 });
    fake.reply({ type: 'items.changed', id: request.id, items: [record('rod', { defId: 'tool:rod.willow', branch: 'held', storied: true, place: 'hotbar', slot: 0, revision: 4 })] });
    await expect(moving).resolves.toMatchObject({ ok: true, item: { place: 'hotbar', slot: 0, revision: 4 } });
    // The realm's push of the same commit changes nothing.
    const before = store.items();
    fake.reply({ type: 'items.changed', items: [record('rod', { defId: 'tool:rod.willow', branch: 'held', storied: true, place: 'hotbar', slot: 0, revision: 4 })] });
    expect(store.items()).toBe(before);
  });

  it('reports a refused move in plain words and reads the bag again', async () => {
    const fake = fakeLink();
    const store = createBagStore(fake.link);
    fake.reply({ type: 'items.list', id: fake.last('items.list').id, items: [record('rod', { revision: 1 })], next: null });
    const lists = fake.sent.filter(request => request.type === 'items.list').length;
    const moving = store.move('rod', 'hand', null);
    fake.reply({ type: 'items.refused', id: fake.last('items.move').id, message: 'This thing has changed. Open your bag again.' });
    await expect(moving).resolves.toEqual({ ok: false, message: 'This thing has changed. Open your bag again.' });
    expect(store.refused().at(-1)).toMatchObject({ itemId: 'rod', message: 'This thing has changed. Open your bag again.' });
    expect(fake.sent.filter(request => request.type === 'items.list')).toHaveLength(lists + 1);
    await expect(store.move('missing', 'bag', null)).resolves.toEqual({ ok: false, message: 'This thing is no longer in your bag.' });
  });

  it('pages through an item’s history in order', async () => {
    const fake = fakeLink();
    const store = createBagStore(fake.link);
    const reading = store.history('a');
    const first = fake.last('items.history');
    const event = (n: number) => ({ itemId: 'a', kind: 'stacked' as const, at: n, actor: 'kingdom' as const, count: 1 });
    fake.reply({ type: 'items.history', id: first.id, itemId: 'a', events: Array.from({ length: 32 }, (_, i) => event(i)), next: '32' });
    const second = fake.last('items.history');
    expect(second).toMatchObject({ itemId: 'a', after: '32' });
    fake.reply({ type: 'items.history', id: second.id, itemId: 'other', events: [event(99)], next: null });
    fake.reply({ type: 'items.history', id: second.id, itemId: 'a', events: [event(32)], next: null });
    const events = await reading;
    expect(events.map(entry => entry.at)).toEqual(Array.from({ length: 33 }, (_, i) => i));
    const refused = store.history('b');
    fake.reply({ type: 'items.refused', id: fake.last('items.history').id, message: 'This thing is not yours here.' });
    await expect(refused).rejects.toThrow('This thing is not yours here.');
  });

  it('settles everything on dispose and stops listening', async () => {
    const fake = fakeLink();
    const store = createBagStore(fake.link);
    fake.reply({ type: 'items.list', id: fake.last('items.list').id, items: [record('a')], next: null });
    const moving = store.move('a', 'away', null);
    const reading = store.history('a');
    store.dispose();
    await expect(moving).resolves.toMatchObject({ ok: false });
    await expect(reading).rejects.toThrow();
    expect(fake.listeners.size).toBe(0);
  });
});
