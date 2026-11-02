import { afterAll, describe, expect, it } from 'vitest';
import type { ItemReply } from '@chatdom/shared';
import { FISH_ITEM_DEFINITIONS } from '../../../../packages/content/src/fish';
import { WILLOW_ROD_DEFINITION } from '../../../../packages/content/src/pier/rod';
import { registerItemDefinitions } from './definitions';
import { createStagedItemLink } from './staged';
import { createBagStore } from './store';
import { record } from './records.fixture';

const release = registerItemDefinitions([...FISH_ITEM_DEFINITIONS, WILLOW_ROD_DEFINITION]);
afterAll(release);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const rod = () => record('0-rod', { defId: 'tool:rod.willow', branch: 'held', storied: true, place: 'hotbar', slot: 0, source: { kind: 'pier', ref: 'rack' } });

describe('the staged items channel', () => {
  it('answers lists in 32-row pages with a cursor, as the realm does', async () => {
    const records = Array.from({ length: 70 }, (_, i) => record(`id-${String(i).padStart(3, '0')}`));
    const link = createStagedItemLink(records);
    const replies: ItemReply[] = [];
    link.subscribe(reply => replies.push(reply));
    link.send({ type: 'items.list', id: 'p1' });
    await settle();
    const first = replies[0] as Extract<ItemReply, { type: 'items.list' }>;
    expect(first.items).toHaveLength(32);
    expect(first.next).toBe('id-031');
    link.send({ type: 'items.list', id: 'p2', after: 'id-063' });
    await settle();
    const last = replies[1] as Extract<ItemReply, { type: 'items.list' }>;
    expect(last.items.map(item => item.id)).toEqual(['id-064', 'id-065', 'id-066', 'id-067', 'id-068', 'id-069']);
    expect(last.next).toBeNull();
  });

  it('loads a whole bag through the store with no duplicates', async () => {
    const link = createStagedItemLink(Array.from({ length: 100 }, (_, i) => record(`id-${String(i).padStart(3, '0')}`)));
    const store = createBagStore(link);
    await settle();
    expect(store.status()).toBe('ready');
    expect(store.items()).toHaveLength(100);
    expect(new Set(store.items().map(item => item.id)).size).toBe(100);
  });

  it('checks revisions and places on move with the realm’s words, and appends history', async () => {
    const link = createStagedItemLink([rod(), record('1-perch', { count: 7 })]);
    const store = createBagStore(link);
    await settle();
    await expect(store.move('1-perch', 'hotbar', 1)).resolves.toEqual({ ok: false, message: 'This thing cannot live there.' });
    await settle();
    await expect(store.move('0-rod', 'hotbar', null)).resolves.toEqual({ ok: false, message: 'Choose a valid place for this thing.' });
    await settle();
    const taken = await store.move('0-rod', 'hand', null);
    expect(taken).toMatchObject({ ok: true, item: { place: 'hand', slot: null, revision: 1 } });
    await settle();
    expect(store.item('0-rod')).toMatchObject({ place: 'hand', revision: 1 });
    // A stale revision is refused exactly as the realm refuses it.
    const replies: ItemReply[] = [];
    link.subscribe(reply => replies.push(reply));
    link.send({ type: 'items.move', id: 'stale', itemId: '0-rod', revision: 0, to: 'bag', slot: null });
    await settle();
    expect(replies).toContainEqual({ type: 'items.refused', id: 'stale', message: 'This thing has changed. Open your bag again.' });
    const history = await store.history('0-rod');
    expect(history.map(event => event.kind)).toEqual(['granted', 'moved']);
    expect(history[1]).toMatchObject({ from: 'hotbar', to: 'hand', actor: 'owner' });
  });

  it('refuses a second thing in the hand and a taken belt slot', async () => {
    const second = record('2-rod', { defId: 'tool:rod.willow', branch: 'held', storied: true, place: 'bag', source: { kind: 'pier', ref: 'rack-2' } });
    const link = createStagedItemLink([rod(), second]);
    const store = createBagStore(link);
    await settle();
    await expect(store.move('2-rod', 'hotbar', 0)).resolves.toEqual({ ok: false, message: 'Another thing is already there. Choose a free place.' });
    await settle();
    await expect(store.move('0-rod', 'hand', null)).resolves.toMatchObject({ ok: true });
    await settle();
    await expect(store.move('2-rod', 'hand', null)).resolves.toEqual({ ok: false, message: 'Another thing is already there. Choose a free place.' });
  });

  it('pushes grants and stacks, and keeps their history', async () => {
    const link = createStagedItemLink([]);
    const store = createBagStore(link);
    await settle();
    expect(store.items()).toHaveLength(0);
    link.grant(record('3-minnow', { defId: 'fish:bell-minnow', count: 1 }));
    await settle();
    link.grant(record('3-minnow', { defId: 'fish:bell-minnow', count: 3, revision: 1, detail: { weightG: 60, lastCaughtAt: Date.UTC(2026, 10, 2, 18) } }));
    link.grant(record('3-minnow', { defId: 'fish:bell-minnow', count: 2, revision: 0 }));
    await settle();
    expect(store.items()).toHaveLength(1);
    expect(store.item('3-minnow')).toMatchObject({ count: 3, revision: 1 });
    const history = await store.history('3-minnow');
    expect(history.map(event => [event.kind, event.count])).toEqual([['granted', 1], ['stacked', 2]]);
  });

  it('pages a long history with the realm’s numeric cursor', async () => {
    const link = createStagedItemLink([record('a')], { history: { a: Array.from({ length: 40 }, (_, i) => ({ itemId: 'a', kind: 'stacked' as const, at: i, actor: 'kingdom' as const })) } });
    const replies: ItemReply[] = [];
    link.subscribe(reply => replies.push(reply));
    link.send({ type: 'items.history', id: 'h1', itemId: 'a' });
    await settle();
    expect(replies[0]).toMatchObject({ type: 'items.history', next: '32' });
    const store = createBagStore(link);
    await settle();
    await expect(store.history('a')).resolves.toHaveLength(40);
  });

  it('lets gathered stacks go but never a storied thing, and refuses malformed requests', async () => {
    const link = createStagedItemLink([rod(), record('1-perch', { count: 2 })]);
    const replies: ItemReply[] = [];
    link.subscribe(reply => replies.push(reply));
    link.send({ type: 'items.release', id: 'r1', itemId: '0-rod', revision: 0, count: 1 });
    link.send({ type: 'items.release', id: 'r2', itemId: '1-perch', revision: 0, count: 2 });
    link.send({ type: 'items.move', id: 'bad', itemId: '1-perch', revision: -1, to: 'bag', slot: null });
    await settle();
    expect(replies[0]).toEqual({ type: 'items.refused', id: 'r1', message: 'A thing with a story stays yours. You can put it away.' });
    expect(replies[1]).toMatchObject({ type: 'items.changed', id: 'r2', items: [{ count: 0, place: 'spent' }] });
    expect(replies).toContainEqual({ type: 'items.refused', id: 'bad', message: 'Choose a valid bag request.' });
    link.send({ type: 'items.list', id: 'after' });
    await settle();
    expect((replies.at(-1) as Extract<ItemReply, { type: 'items.list' }>).items.map(item => item.id)).toEqual(['0-rod']);
  });
});
