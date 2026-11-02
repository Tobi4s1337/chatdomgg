import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type ItemDefinition } from '@chatdom/shared';
import type { Pool } from 'pg';
import { runnerImport } from 'vite';
import { createRealmPool } from '../persistence/database';
import { createItemCatalogue, createRealmItems } from './index';
import { createPostgresItemStore } from './postgres';

const enabled = process.env.REALM_DATABASE_TESTS === '1';
let pool: Pool;
const id = () => BigInt(`0x${randomBytes(12).toString('hex')}`).toString();
const mount: ItemDefinition = { id: 'keepsake:mount.copper-perch', branch: 'kept', title: 'Copper Perch, mounted', lore: 'A perch.',
  stack: null, keepsake: true, model: 'keepsake:mount.copper-perch', places: ['shelf', 'bag', 'away'] };
const rod: ItemDefinition = { id: 'tool:rod.willow', branch: 'held', title: 'Willow Rod', lore: 'A rod.',
  stack: null, keepsake: false, model: 'tool:rod.willow', places: ['hand', 'hotbar', 'bag', 'away'] };
const lantern: ItemDefinition = { id: 'tool:lantern.tin', branch: 'held', title: 'Tin Lantern', lore: 'A lantern.',
  stack: null, keepsake: false, model: 'tool:lantern.tin', places: ['hand', 'hotbar', 'bag', 'away'] };

describe.runIf(enabled)('the keepsake shelf on isolated Postgres', () => {
  beforeAll(async () => {
    if (process.env.REALM_DATABASE_SCHEMA !== 'pier' || !process.env.DATABASE_URL) throw new Error('Set REALM_DATABASE_SCHEMA=pier and DATABASE_URL for this suite.');
    const url = new URL(process.env.DATABASE_URL);
    if (url.hostname !== '127.0.0.1' || url.port !== '5410') throw new Error('Pier tests require Postgres at 127.0.0.1:5410.');
    pool = createRealmPool({ connectionString: process.env.DATABASE_URL, schema: 'pier' });
    expect((await pool.query('SELECT current_schema() AS schema')).rows[0]?.schema).toBe('pier');
    const { module } = await runnerImport<typeof import('../persistence/migrate')>(resolve('apps/realm/src/persistence/migrate.ts'), { configFile: false });
    await module.migrateRealmSchema(pool, 'pier');
  });
  afterAll(async () => { if (pool) await pool.end(); });

  const setup = () => {
    const kingdomId = KingdomIdSchema.parse(id()), ownerId = PersonIdSchema.parse(id());
    let time = 1_000;
    const items = createRealmItems({ store: createPostgresItemStore({ pool }), catalogue: createItemCatalogue([mount, rod, lantern]), clock: () => ++time });
    let n = 0;
    const give = (def: ItemDefinition = mount, place?: 'bag' | 'hotbar' | 'shelf') => items.grant({ key: `shelf-${++n}`, ownerId, kingdomId, origin: 'live',
      defId: def.id, ...(place ? { place } : {}), story: { by: { personId: ownerId, name: 'Juniper' }, kingdomId, where: 'Willowmere pier', at: 500 + n, line: 'Caught at dusk.' },
      source: { kind: 'fishing', ref: `ref-${n}` } });
    return { kingdomId, ownerId, items, give };
  };

  it('swaps two keepsakes through each other’s slots, and the database still refuses two in one slot', async () => {
    const { kingdomId, ownerId, items, give } = setup();
    const a = await give(), b = await give(), c = await give();
    const swap = await items.arrange(ownerId, a.id, { place: 'shelf', slot: 2 }, 0);
    expect(swap.ok && swap.items.map(item => [item.id, item.slot, item.revision])).toEqual([[a.id, 2, 1], [c.id, 0, 1]]);
    const after = await items.atPlace(ownerId, kingdomId, 'live', 'shelf');
    expect(after.map(item => [item.id, item.slot])).toEqual([[c.id, 0], [b.id, 1], [a.id, 2]]);
    expect((await items.history(c.id)).map(event => event.kind)).toEqual(['granted', 'moved']);
    // Outside a swap the constraint is immediate; inside one it still holds at the commit.
    await expect(pool.query("UPDATE realm_items SET record=jsonb_set(jsonb_set(record, '{slot}', '1'), '{revision}', '2') WHERE id=$1", [a.id])).rejects.toThrow();
    await expect(pool.query(`BEGIN; SET CONSTRAINTS realm_items_slot_places DEFERRED;
      UPDATE realm_items SET record=jsonb_set(jsonb_set(record, '{slot}', '1'), '{revision}', '2') WHERE id='${a.id}'; COMMIT;`)).rejects.toThrow();
    await pool.query('ROLLBACK').catch(() => {});
    expect((await items.get(a.id))?.slot).toBe(2);
  });

  it('reorders the belt and moves a bagged keepsake into a taken slot without losing the other', async () => {
    const { kingdomId, ownerId, items, give } = setup();
    const r = await give(rod, 'hotbar'), l = await give(lantern, 'hotbar');
    expect((await items.arrange(ownerId, l.id, { place: 'hotbar', slot: 0 }, 0)).ok).toBe(true);
    expect((await items.atPlace(ownerId, kingdomId, 'live', 'hotbar')).map(item => item.id)).toEqual([l.id, r.id]);
    const a = await give(), bagged = await give(mount, 'bag');
    const moved = await items.arrange(ownerId, bagged.id, { place: 'shelf', slot: 0 }, 0);
    expect(moved.ok && moved.items.map(item => [item.id, item.place, item.slot])).toEqual([[bagged.id, 'shelf', 0], [a.id, 'shelf', 1]]);
  });

  it('keeps the shelf hidden until shown, with revisions, and serves no person ids to visitors', async () => {
    const { kingdomId, ownerId, items, give } = setup();
    await give();
    expect(await items.shelf(ownerId, kingdomId, 'live')).toEqual({ shown: false, revision: 0 });
    expect(await items.visitShelf(ownerId, kingdomId, 'live')).toBeNull();
    const [first, second] = await Promise.all([items.showShelf(ownerId, kingdomId, 'live', true, 0, 'Juniper'),
      items.showShelf(ownerId, kingdomId, 'live', true, 0, 'Juniper')]);
    // Two tabs choosing at once: one wins, the other is told to look again.
    expect([first, second].filter(result => result.ok)).toHaveLength(1);
    expect(await items.shelf(ownerId, kingdomId, 'live')).toEqual({ shown: true, revision: 1 });
    const pieces = await items.visitShelf(ownerId, kingdomId, 'live');
    expect(pieces).toHaveLength(1);
    expect(JSON.stringify(pieces)).not.toContain(ownerId);
    expect(await items.shownShelves(kingdomId, 'live')).toEqual([{ ownerId, name: 'Juniper' }]);
    await expect(pool.query("INSERT INTO realm_item_shelves VALUES ($1,$2,'live',false,'Juniper',1,0)", [kingdomId, id()])).rejects.toThrow();
    expect(await items.showShelf(ownerId, kingdomId, 'live', false, 1, 'Juniper')).toEqual({ ok: true, settings: { shown: false, revision: 2 } });
    expect(await items.shownShelves(kingdomId, 'live')).toEqual([]);
  });
});
