import { describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type ItemDefinition, type ItemRecord } from '@chatdom/shared';
import type { RealmDatabase } from '../persistence/database';
import { createItemCatalogue, createRealmItems, type GrantInput } from './index';
import { createMemoryItemStore } from './memory';
import { createPostgresItemStore } from './postgres';
import type { ItemTransaction } from './store';

const kingdomId = KingdomIdSchema.parse('129634568'), elsewhere = KingdomIdSchema.parse('200');
const ownerId = PersonIdSchema.parse('100'), stranger = PersonIdSchema.parse('101');
const rod: ItemDefinition = { id: 'tool:rod.willow', branch: 'held', title: 'Willow rod', lore: 'Bent from a patient willow.', stack: null, keepsake: false, model: 'pier:rod.willow', places: ['hotbar', 'hand', 'bag', 'away'] };
const keepsake: ItemDefinition = { id: 'game:pong.ribbon', branch: 'kept', title: 'Table champion', lore: 'A bright night around the table.', stack: null, keepsake: true, model: 'game:pong.ribbon', places: ['bag', 'shelf', 'away'] };

function setup() {
  const store = createMemoryItemStore();
  const items = createRealmItems({ store, catalogue: createItemCatalogue([rod, keepsake]), clock: () => 1000 });
  const grant = (key: string, changes: Partial<GrantInput> = {}): GrantInput => ({ key, ownerId, kingdomId, origin: 'live', defId: rod.id,
    story: { by: { personId: ownerId, name: 'Juniper' }, kingdomId, where: 'Willowmere pier', at: 900, line: 'Taken from the rod rack.' },
    source: { kind: 'pier', ref: 'rod-rack' }, ...changes });
  return { store, items, grant };
}

describe('bounded item placements', () => {
  it.each(['hotbar', 'shelf'] as const)('grants into the first free %s slot and refuses a full placement', async place => {
    const { store, items, grant } = setup();
    const defId = place === 'shelf' ? keepsake.id : rod.id;
    const first = await items.grant(grant('first', { defId, place }));
    const second = await items.grant(grant('second', { defId, place }));
    const third = await items.grant(grant('third', { defId, place }));
    expect([first.slot, second.slot, third.slot]).toEqual([0, 1, 2]);
    expect(await items.move(ownerId, second.id, { place: 'away', slot: null }, 0)).toMatchObject({ ok: true });
    expect((await items.grant(grant('fill-gap', { defId, place }))).slot).toBe(1);
    for (let slot = 3; slot < 64; slot++) expect((await items.grant(grant(`fill-${slot}`, { defId, place }))).slot).toBe(slot);
    await expect(items.grant(grant('overflow', { defId, place }))).rejects.toThrow('no free place');
    expect(await store.atPlace(ownerId, kingdomId, 'live', place)).toHaveLength(64);
  });

  it('refuses an occupied hand without changing either record or grant receipts', async () => {
    const { store, items, grant } = setup();
    const held = await items.grant(grant('held', { place: 'hand' }));
    await expect(items.grant(grant('other', { place: 'hand' }))).rejects.toThrow('hands are full');
    expect(await store.atPlace(ownerId, kingdomId, 'live', 'hand')).toEqual([held]);
    expect(await store.history(held.id)).toHaveLength(1);
    await store.transaction(kingdomId, async tx => { expect(await tx.receipt(ownerId, 'live', 'other')).toBeNull(); });
  });

  it('scopes placement reads and free slots by owner, kingdom, origin and place', async () => {
    const { store, items, grant } = setup();
    const own = await items.grant(grant('own'));
    const others = await Promise.all([
      items.grant(grant('other-owner', { ownerId: stranger })),
      items.grant(grant('other-origin', { origin: 'simulated' })),
      items.grant(grant('other-place', { place: 'hand' })),
      items.grant(grant('other-kingdom', { kingdomId: elsewhere, story: { ...own.story, kingdomId: elsewhere } })),
    ]);
    expect(others.map(item => item.slot)).toEqual([0, 0, null, 0]);
    expect(await store.atPlace(ownerId, kingdomId, 'live', 'hotbar')).toEqual([own]);
    await store.transaction(kingdomId, async tx => {
      expect(await tx.atPlace(ownerId, 'live', 'hotbar')).toEqual([own]);
      expect(await tx.atPlace(ownerId, 'simulated', 'hotbar')).toEqual([others[1]]);
      expect(await tx.atPlace(ownerId, 'live', 'hand')).toEqual([others[2]]);
    });
  });

  it('grants storied items to hotbar, hand, bag and away without listing the collection', async () => {
    const { store, items, grant } = setup();
    await store.transaction(kingdomId, async tx => {
      tx.list = async () => { throw new Error('Unbounded list must not be called'); };
      const placed = vi.spyOn(tx, 'atPlace');
      for (const place of ['hotbar', 'hand', 'bag', 'away'] as const) await items.grant(grant(place, { place }), tx);
      expect(placed.mock.calls).toEqual([[ownerId, 'live', 'hotbar'], [ownerId, 'live', 'hand']]);
    });
  });

  it.each([false, true])('closes the placement capability after callback completion (rollback: %s)', async rollback => {
    const { store } = setup();
    let escaped: ItemTransaction['atPlace'] | undefined;
    const work = store.transaction(kingdomId, async tx => {
      escaped = tx.atPlace;
      expect(await escaped(ownerId, 'live', 'hand')).toEqual([]);
      if (rollback) throw new Error('Rollback');
    });
    if (rollback) await expect(work).rejects.toThrow('Rollback'); else await work;
    await expect(escaped!(ownerId, 'live', 'hand')).rejects.toThrow('transaction has ended');
  });

  it('redacts store and service placement reads while preserving raw transaction provenance and snapshots', async () => {
    const { store, items, grant } = setup();
    const held = await items.grant(grant('held', { place: 'hand' }));
    await store.forgetName(ownerId);
    expect((await store.atPlace(ownerId, kingdomId, 'live', 'hand'))[0]?.story.by).toEqual({ personId: ownerId, name: 'a citizen' });
    expect((await items.atPlace(ownerId, kingdomId, 'live', 'hand'))[0]?.story.by?.name).toBe('a citizen');
    await store.transaction(kingdomId, async tx => {
      const raw = (await tx.atPlace(ownerId, 'live', 'hand'))[0]!;
      expect(raw).toEqual(held);
      Object.assign(raw.story, { line: 'Changed snapshot' });
      expect((await tx.atPlace(ownerId, 'live', 'hand'))[0]?.story.line).toBe(held.story.line);
    });
  });

  it.each(['hand', 'hotbar', 'shelf'] as const)('rejects corrupt %s overflow in memory transaction and store reads', async place => {
    const { store, items, grant } = setup();
    const first = await items.grant(grant('first', { place, defId: place === 'shelf' ? keepsake.id : rod.id }));
    await store.transaction(kingdomId, async tx => {
      for (let i = 1; i < (place === 'hand' ? 2 : 65); i++) await tx.save({ ...first, id: `corrupt-${i}`, slot: place === 'hand' ? null : i % 64 });
    });
    await expect(store.atPlace(ownerId, kingdomId, 'live', place)).rejects.toThrow('capacity');
    await expect(store.transaction(kingdomId, tx => tx.atPlace(ownerId, 'live', place))).rejects.toThrow('capacity');
  });
});

function postgresSetup(rows: readonly { record: ItemRecord; hidden: boolean }[] = []) {
  const query = vi.fn(async (sql: string, args?: unknown[]) => {
    void args;
    return { rows: sql.includes('FROM realm_items i') ? rows : [], rowCount: 0 };
  });
  const client = { query, release: vi.fn() };
  const pool = { query, connect: vi.fn(async () => client) } as unknown as RealmDatabase;
  return { store: createPostgresItemStore({ pool }), query };
}

describe('Postgres bounded placement queries', () => {
  it.each(['hand', 'hotbar', 'shelf'] as const)('uses the %s partial index predicate with a bounded lookahead', async place => {
    const { store, query } = postgresSetup();
    await store.atPlace(ownerId, kingdomId, 'live', place);
    await store.transaction(kingdomId, tx => tx.atPlace(ownerId, 'live', place));
    const reads = query.mock.calls.filter(([sql]) => sql.includes('FROM realm_items i'));
    expect(reads).toHaveLength(2);
    for (const [sql, args] of reads) {
      expect(sql).toContain("i.kingdom_id=$1 AND i.record->>'ownerId'=$2 AND i.record->>'origin'=$3");
      expect(sql).toContain(`LIMIT ${place === 'hand' ? 2 : 65}`);
      if (place === 'hand') {
        expect(sql).toContain("i.record->>'place'='hand'");
        expect(args).toEqual([kingdomId, ownerId, 'live']);
      } else {
        expect(sql).toContain("i.record->>'place' IN ('hotbar', 'shelf') AND i.record->>'place'=$4");
        expect(sql).toContain("ORDER BY (i.record->>'slot')::integer");
        expect(args).toEqual([kingdomId, ownerId, 'live', place]);
      }
    }
    expect(reads[0]![0]).toContain('LEFT JOIN realm_item_hidden_names');
    expect(reads[1]![0]).not.toContain('realm_item_hidden_names');
  });

  it('redacts public placement records and closes transaction reads after the callback', async () => {
    const fixture = setup(), held = await fixture.items.grant(fixture.grant('held', { place: 'hand' }));
    const { store, query } = postgresSetup([{ record: held, hidden: true }]);
    expect((await store.atPlace(ownerId, kingdomId, 'live', 'hand'))[0]?.story.by?.name).toBe('a citizen');
    let escaped: ItemTransaction['atPlace'] | undefined;
    await store.transaction(kingdomId, async tx => {
      escaped = tx.atPlace;
      expect(await tx.atPlace(ownerId, 'live', 'hand')).toEqual([held]);
    });
    const calls = query.mock.calls.length;
    await expect(escaped!(ownerId, 'live', 'hand')).rejects.toThrow('not active');
    expect(query.mock.calls).toHaveLength(calls);
  });

  it.each(['hand', 'hotbar', 'shelf'] as const)('rejects corrupt %s overflow from either query path', async place => {
    const fixture = setup(), item = await fixture.items.grant(fixture.grant('first'));
    const rows = Array.from({ length: place === 'hand' ? 2 : 65 }, () => ({ record: item, hidden: false }));
    const { store } = postgresSetup(rows);
    await expect(store.atPlace(ownerId, kingdomId, 'live', place)).rejects.toThrow('capacity');
    await expect(store.transaction(kingdomId, tx => tx.atPlace(ownerId, 'live', place))).rejects.toThrow('capacity');
  });
});
