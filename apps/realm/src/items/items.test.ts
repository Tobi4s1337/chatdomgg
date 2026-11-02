import { describe, expect, it, vi } from 'vitest';
import { ItemRequestSchema, KingdomIdSchema, PersonIdSchema, type ItemDefinition } from '@chatdom/shared';
import { createItemCatalogue, createRealmItems, type GrantInput } from './index';
import { createMemoryItemStore } from './memory';
import type { ItemTransaction } from './store';

const kingdomId = KingdomIdSchema.parse('129634568');
const elsewhere = KingdomIdSchema.parse('200');
const ownerId = PersonIdSchema.parse('100');
const stranger = PersonIdSchema.parse('101');
const fish: ItemDefinition = { id: 'fish:copper-perch', branch: 'gathered', title: 'Copper Perch', lore: 'A copper flash beneath the lilies.', stack: 5, keepsake: false, model: 'fish:copper-perch', places: ['bag', 'away'] };
const rod: ItemDefinition = { id: 'tool:rod.willow', branch: 'held', title: 'Willow rod', lore: 'Bent from a patient willow.', stack: null, keepsake: false, model: 'pier:rod.willow', places: ['hotbar', 'hand', 'bag', 'away'] };
const keepsake: ItemDefinition = { id: 'game:pong.ribbon', branch: 'kept', title: 'Table champion', lore: 'A bright night around the table.', stack: null, keepsake: true, model: 'game:pong.ribbon', places: ['bag', 'shelf', 'away'] };

function setup() {
  let time = 1000;
  const store = createMemoryItemStore(), catalogue = createItemCatalogue([fish, rod, keepsake]);
  const items = createRealmItems({ store, catalogue, clock: () => time++ });
  const grant = (changes: Partial<GrantInput> = {}): GrantInput => ({ key: 'fishing:one:100', ownerId, kingdomId, origin: 'live', defId: fish.id,
    story: { by: { personId: ownerId, name: 'Juniper' }, kingdomId, where: 'Willowmere pier', at: 900, line: 'Caught at dusk in clear water' },
    source: { kind: 'fishing', ref: 'one' }, detail: { weightG: 412 }, ...changes });
  return { items, store, catalogue, grant };
}

async function notifications() { await new Promise(resolve => setImmediate(resolve)); }

describe('realm item foundation', () => {
  it('exposes no browser grant, owner, definition, or kingdom override', () => {
    for (const input of [
      { type: 'items.grant', id: 'x', defId: fish.id },
      { type: 'items.list', id: 'x', ownerId },
      { type: 'items.move', id: 'x', itemId: 'one', revision: 0, to: 'bag', slot: null, kingdomId: elsewhere },
      { type: 'items.release', id: 'x', itemId: 'one', revision: 0, count: -1 },
      { type: 'items.move', id: 'x', itemId: 'one', revision: 0, to: 'hotbar', slot: 64 },
    ]) expect(ItemRequestSchema.safeParse(input).success).toBe(false);
    expect(ItemRequestSchema.parse({ type: 'items.list', id: 'bag' })).toEqual({ type: 'items.list', id: 'bag' });
  });

  it('retries one grant under concurrency, and rejects a key reused for another thing', async () => {
    const { items, grant } = setup();
    const replies = await Promise.all(Array.from({ length: 20 }, () => items.grant(grant())));
    expect(new Set(replies.map(item => item.id)).size).toBe(1);
    expect(await items.list(ownerId, kingdomId)).toHaveLength(1);
    expect(await items.history(replies[0]!.id)).toHaveLength(1);
    await expect(items.grant(grant({ count: 2 }))).rejects.toThrow('different thing');
    expect((await items.get(replies[0]!.id))?.count).toBe(1);
  });

  it('keeps stacks apart by person, kingdom, origin, and capacity, retaining the first, latest and best catch', async () => {
    const { items, grant } = setup();
    const first = await items.grant(grant({ count: 4 }));
    const second = await items.grant(grant({ key: 'second', source: { kind: 'fishing', ref: 'second' }, story: { ...first.story, at: 1500, where: 'the north rail' }, detail: { weightG: 920 } }));
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ count: 5, revision: 1, story: first.story, source: first.source, detail: { firstCaughtAt: 900, lastCaughtAt: 1500, firstCaughtWhere: 'Willowmere pier', lastCaughtWhere: 'the north rail', weightG: 920 } });
    const overflow = await items.grant(grant({ key: 'overflow' }));
    expect(overflow.id).not.toBe(first.id);
    const isolated = await Promise.all([
      items.grant(grant({ ownerId: stranger })),
      items.grant(grant({ kingdomId: elsewhere, story: { ...first.story, kingdomId: elsewhere } })),
      items.grant(grant({ origin: 'simulated' })),
    ]);
    expect(new Set([first, overflow, ...isolated].map(item => item.id)).size).toBe(5);
    expect((await items.history(first.id)).map(event => [event.kind, event.source?.ref])).toEqual([['granted', 'one'], ['stacked', 'second']]);
  });

  it('enforces ownership, revision and place rules; occupied slots never displace or lose another item', async () => {
    const { items, grant } = setup();
    const tool = await items.grant(grant({ defId: rod.id }));
    const other = await items.grant(grant({ key: 'second rod', defId: rod.id }));
    expect(tool).toMatchObject({ place: 'hotbar', slot: 0, count: 1, storied: true });
    expect(other.slot).toBe(1);
    expect(await items.move(stranger, tool.id, { place: 'hand', slot: null }, 0)).toMatchObject({ ok: false });
    expect(await items.release(stranger, tool.id, 1, 0)).toMatchObject({ ok: false });
    expect(await items.move(ownerId, tool.id, { place: 'shelf', slot: 0 }, 0)).toMatchObject({ ok: false });
    expect(await items.move(ownerId, tool.id, { place: 'hand', slot: 0 }, 0)).toMatchObject({ ok: false });
    expect(await items.move(ownerId, tool.id, { place: 'hand', slot: null }, 0)).toMatchObject({ ok: true, item: { revision: 1 } });
    expect(await items.move(ownerId, other.id, { place: 'hand', slot: null }, 0)).toMatchObject({ ok: false });
    expect(await items.move(ownerId, tool.id, { place: 'bag', slot: null }, 0)).toMatchObject({ ok: false });
    expect(await items.move(ownerId, tool.id, { place: 'away', slot: null }, 1)).toMatchObject({ ok: true });
    expect(await items.release(ownerId, tool.id, 1, 2)).toMatchObject({ ok: false });
    expect((await items.history(tool.id)).map(event => event.kind)).toEqual(['granted', 'moved', 'put-away']);
    expect((await items.list(ownerId, kingdomId)).map(item => item.id).sort()).toEqual([tool.id, other.id].sort());
  });

  it('lets spare fish return to water and retains their spent record and history forever', async () => {
    const { items, grant } = setup();
    const stack = await items.grant(grant({ count: 3 }));
    expect(await items.release(ownerId, stack.id, 4, 0)).toMatchObject({ ok: false });
    expect(await items.release(ownerId, stack.id, 1, 0)).toMatchObject({ ok: true, item: { count: 2, revision: 1, place: 'bag' } });
    expect(await items.release(ownerId, stack.id, 2, 1)).toMatchObject({ ok: true, item: { count: 0, revision: 2, place: 'spent' } });
    expect(await items.list(ownerId, kingdomId)).toEqual([]);
    expect(await items.list(ownerId, kingdomId, { place: 'spent' })).toHaveLength(1);
    expect((await items.history(stack.id)).map(event => event.kind)).toEqual(['granted', 'released', 'released']);
    expect(await items.move(ownerId, stack.id, { place: 'bag', slot: null }, 2)).toMatchObject({ ok: false });
    const retry = await items.grant(grant({ count: 3 }));
    expect(retry).toMatchObject({ id: stack.id, place: 'spent', count: 0 });
  });

  it('protects a personal first even for an ordinary species and never merges it into spare fish', async () => {
    const { items, grant } = setup();
    const first = await items.grant(grant({ storied: true }));
    const spare = await items.grant(grant({ key: 'spare' }));
    expect(first.id).not.toBe(spare.id);
    expect(await items.release(ownerId, first.id, 1, 0)).toMatchObject({ ok: false });
    await expect(items.grant(grant({ key: 'invalid', storied: true, count: 2 }))).rejects.toThrow();
  });

  it('rolls back grants, receipts, history, numbering, and notifications with its caller’s transaction', async () => {
    const { items, store, grant } = setup();
    const changed = vi.fn(); items.onChange(changed);
    let id = '', stale: ItemTransaction | undefined;
    await expect(store.transaction(kingdomId, async tx => {
      stale = tx; id = (await items.grant(grant({ defId: keepsake.id }), tx)).id;
      throw new Error('the catch write failed');
    })).rejects.toThrow('the catch write failed');
    await notifications();
    expect(await items.get(id)).toBeNull();
    expect(await items.history(id)).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
    await expect(stale!.get(id)).rejects.toThrow('ended');
    const granted = await items.grant(grant({ defId: keepsake.id }));
    expect(granted.number).toBe(1);
    await notifications(); expect(changed).toHaveBeenCalledTimes(1);
    const foreign = createMemoryItemStore();
    await expect(foreign.transaction(kingdomId, tx => items.grant(grant({ key: 'foreign' }), tx))).rejects.toThrow('different kingdom or store');
  });

  it('numbers distinct keepsakes without gaps and gives a shared moment the same number once to everyone', async () => {
    const { items, grant } = setup();
    const one = await items.grant(grant({ defId: keepsake.id }));
    expect(one.number).toBe(1);
    const { by: _by, ...story } = one.story; void _by;
    const input = { key: 'game:match-one', origin: 'live', kingdomId, defId: keepsake.id, source: { kind: 'game', ref: 'match-one' }, story, people: [{ personId: ownerId, name: 'Juniper' }, { personId: stranger, name: 'Rowan' }] } as const;
    const a = await items.grantShared(input);
    const b = await items.grantShared({ ...input, people: [...input.people].reverse() });
    expect(a.map(item => item.number)).toEqual([2, 2]);
    expect(new Set([...a, ...b].map(item => item.id)).size).toBe(2);
    for (const item of a) expect(await items.history(item.id)).toHaveLength(1);
    expect((await items.grant(grant({ key: 'next', defId: keepsake.id }))).number).toBe(3);
  });

  it('redacts names from current, future and changed-item reads without changing ownership or original history', async () => {
    const { items, store, grant } = setup();
    const first = await items.grant(grant());
    await items.forgetName(ownerId);
    expect((await items.get(first.id))?.story.by).toEqual({ personId: ownerId, name: 'a citizen' });
    expect((await items.list(ownerId, kingdomId))[0]?.story.by?.name).toBe('a citizen');
    const spy = vi.fn(); items.onChange(spy);
    const next = await items.grant(grant({ key: 'after withdrawal', defId: rod.id }));
    expect(next.story.by?.name).toBe('a citizen');
    expect((await items.grant(grant({ story: { ...grant().story, by: { personId: ownerId, name: 'Another approved name' } } }))).story.by?.name).toBe('a citizen');
    await notifications();
    expect(spy.mock.calls.at(-1)?.[2][0].story.by.name).toBe('a citizen');
    await store.transaction(kingdomId, async tx => { expect((await tx.get(next.id))?.story.by?.name).toBe('Juniper'); });
    expect(await items.move(ownerId, next.id, { place: 'away', slot: null }, 0)).toMatchObject({ ok: true, item: { ownerId, story: { by: { name: 'a citizen' } } } });
  });

  it('rejects malformed server grants atomically and validates provider definitions before registration', async () => {
    const { items, grant, catalogue } = setup();
    await expect(items.grant(grant({ detail: { weightG: NaN } }))).rejects.toThrow();
    await expect(items.grant(grant({ story: { ...grant().story, kingdomId: elsewhere } }))).rejects.toThrow();
    await expect(items.grant(grant({ defId: 'fish:missing' }))).rejects.toThrow('catalogue');
    await expect(items.grant({ ...grant(), payment: 100 } as GrantInput)).rejects.toThrow();
    expect(await items.list(ownerId, kingdomId)).toEqual([]);
    expect(() => catalogue.register([{ ...fish, id: 'fish:other' }, { ...fish }])).toThrow('already');
    expect(catalogue.get('fish:other')).toBeUndefined();
    expect(() => createItemCatalogue([{ ...keepsake, stack: 5 }])).toThrow();
    expect(() => createItemCatalogue([{ ...rod, places: ['hand'] }])).toThrow();
  });
});
