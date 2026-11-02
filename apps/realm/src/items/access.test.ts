import { expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type ItemDefinition } from '@chatdom/shared';
import { createItemCatalogue, createRealmItems } from './index';
import { createMemoryItemStore } from './memory';

const kingdomId = KingdomIdSchema.parse('200'), ownerId = PersonIdSchema.parse('100');
const fish: ItemDefinition = { id: 'fish:perch', branch: 'gathered', title: 'Perch', lore: 'A fish.', stack: 10, keepsake: false, model: 'fish:perch', places: ['bag', 'away'] };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function setup() {
  const store = createMemoryItemStore();
  const items = createRealmItems({ store, catalogue: createItemCatalogue([fish]), clock: () => 1000 });
  const grant = () => items.grant({ key: 'one', ownerId, kingdomId, origin: 'live', defId: fish.id, count: 3,
    story: { by: null, kingdomId, where: 'pier', at: 900, line: 'Caught here.' }, source: { kind: 'fishing', ref: 'one' } });
  return { store, items, grant };
}

it.each(['move', 'release'] as const)('rolls back %s, its history and its notification if entry expires after save', async action => {
  const { items, store, grant } = setup(), item = await grant();
  await tick();
  const changed = vi.fn(); items.onChange(changed);
  let current = true;
  const transaction = store.transaction.bind(store);
  store.transaction = (kingdom, work) => transaction(kingdom, tx => {
    const save = tx.save.bind(tx);
    tx.save = async value => { await save(value); current = false; };
    return work(tx);
  });
  const access = { kingdomId, origin: 'live' as const, current: async () => current };
  const result = action === 'move' ? await items.move(ownerId, item.id, { place: 'away', slot: null }, 0, access)
    : await items.release(ownerId, item.id, 1, 0, access);
  expect(result).toMatchObject({ ok: false });
  expect(await items.get(item.id)).toEqual(item);
  expect((await items.history(item.id)).map(event => event.kind)).toEqual(['granted']);
  await tick(); expect(changed).not.toHaveBeenCalled();
});

it('rechecks entry after waiting for the transaction and refuses before writing', async () => {
  const { items, store, grant } = setup(), item = await grant();
  await tick();
  const changed = vi.fn(); items.onChange(changed);
  let unlock!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  const blocker = store.transaction(kingdomId, async () => { entered(); await gate; });
  await ready;
  let current = true;
  const pending = items.move(ownerId, item.id, { place: 'away', slot: null }, 0, { kingdomId, origin: 'live', current: async () => current });
  await tick(); current = false; unlock();
  await blocker;
  expect(await pending).toMatchObject({ ok: false });
  expect(await items.get(item.id)).toEqual(item);
  expect((await items.history(item.id)).map(event => event.kind)).toEqual(['granted']);
  await tick(); expect(changed).not.toHaveBeenCalled();
});
