import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type ItemRecord } from '@chatdom/shared';
import type { Pool } from 'pg';
import { createRealmPool, type RealmDatabase } from '../persistence/database';
import { createItemCatalogue, createRealmItems, type GrantInput } from './index';
import { ItemCommitUncertainError } from './store';
import { migrateRealmSchema } from '../persistence/migrate';
import { createPostgresItemStore, postgresItemClient } from './postgres';
import type { ItemTransaction } from './store';

const enabled = process.env.REALM_DATABASE_TESTS === '1';
let pool: Pool;
const id = () => BigInt(`0x${randomBytes(12).toString('hex')}`).toString();

describe.runIf(enabled)('pier item store on isolated Postgres', () => {
  beforeAll(async () => {
    if (process.env.REALM_DATABASE_SCHEMA !== 'pier' || !process.env.DATABASE_URL) throw new Error('Set REALM_DATABASE_SCHEMA=pier and DATABASE_URL for this suite.');
    const url = new URL(process.env.DATABASE_URL);
    if (url.hostname !== '127.0.0.1' || url.port !== '5410') throw new Error('Pier tests require Postgres at 127.0.0.1:5410.');
    pool = createRealmPool({ connectionString: process.env.DATABASE_URL, schema: 'pier' });
    await migrateRealmSchema(pool, 'pier');
  });
  afterAll(async () => { if (pool) await pool.end(); });

  it('commits durable records and history; protects stories and retains all records', async () => {
    const kingdomId = KingdomIdSchema.parse(id()), ownerId = PersonIdSchema.parse(id());
    const item: ItemRecord = { version: 1, id: id(), defId: 'tool:rod', branch: 'held', ownerId, kingdomId, origin: 'live', place: 'hand', slot: null, count: 1, storied: true, number: null, story: { by: { personId: ownerId, name: 'Juniper' }, kingdomId, where: 'pier', at: 10, line: 'Taken from the rack' }, source: { kind: 'pier', ref: id() }, detail: {}, createdAt: 10, revision: 0 };
    const store = createPostgresItemStore({ pool });
    await store.transaction(kingdomId, async tx => { await tx.save(item); await tx.append({ itemId: item.id, kind: 'granted', at: 10, actor: 'kingdom' }); });
    const restarted = createPostgresItemStore({ pool });
    expect(await restarted.get(item.id)).toEqual(item);
    expect(await restarted.history(item.id)).toEqual([{ itemId: item.id, kind: 'granted', at: 10, actor: 'kingdom' }]);
    await expect(store.transaction(kingdomId, tx => tx.saveReceipt({ key: id(), ownerId: PersonIdSchema.parse(id()), origin: 'live', fingerprint: 'different owner', itemId: item.id }))).rejects.toThrow();
    await expect(store.transaction(kingdomId, tx => tx.saveReceipt({ key: id(), ownerId, origin: 'simulated', fingerprint: 'different origin', itemId: item.id }))).rejects.toThrow();
    const incompleteId = id();
    await expect(pool.query("INSERT INTO realm_items (id, kingdom_id, record) VALUES ($1, $2, $3)", [incompleteId, kingdomId, { id: incompleteId, kingdomId }])).rejects.toThrow();
    await expect(pool.query('DELETE FROM realm_items WHERE id=$1 AND kingdom_id=$2', [item.id, kingdomId])).rejects.toThrow();
    await expect(pool.query("UPDATE realm_items SET record=jsonb_set(jsonb_set(record, '{storied}', 'false'), '{revision}', '1') WHERE id=$1 AND kingdom_id=$2", [item.id, kingdomId])).rejects.toThrow();
    await expect(pool.query("UPDATE realm_item_events SET event='{}' WHERE item_id=$1", [item.id])).rejects.toThrow();
    await restarted.forgetName(ownerId);
    expect((await restarted.get(item.id))?.story.by?.name).toBe('a citizen');
    await restarted.transaction(kingdomId, async tx => { expect((await tx.get(item.id))?.story.by?.name).toBe('Juniper'); });
  });

  it('rolls back numbers and callbacks; invalidates transaction capabilities', async () => {
    const kingdomId = KingdomIdSchema.parse(id());
    const store = createPostgresItemStore({ pool });
    let captured: ItemTransaction | undefined, escapedQuery: ReturnType<typeof postgresItemClient>['query'] | undefined, notified = false;
    await expect(store.transaction(kingdomId, async tx => {
      captured = tx;
      const scoped = postgresItemClient(tx);
      expect(Object.keys(scoped)).toEqual(['query']);
      escapedQuery = scoped.query;
      await scoped.query('SELECT 1');
      expect(await tx.nextNumber('keepsake:fish')).toBe(1);
      tx.afterCommit(() => { notified = true; });
      throw new Error('rollback requested');
    })).rejects.toThrow('rollback requested');
    expect(notified).toBe(false);
    expect(() => postgresItemClient(captured!)).toThrow('Item transaction is not active');
    expect(() => escapedQuery!('SELECT 1')).toThrow('Item transaction is not active');
    await expect(captured!.nextNumber('keepsake:fish')).rejects.toThrow('Item transaction is not active');
    const values = await Promise.all(Array.from({ length: 8 }, () => store.transaction(kingdomId, tx => tx.nextNumber('keepsake:fish'))));
    expect(values.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await store.transaction(kingdomId, tx => tx.sharedNumber('shared', 'keepsake:fish', 'same'))).toBe(9);
    expect(await store.transaction(kingdomId, tx => tx.sharedNumber('shared', 'keepsake:fish', 'same'))).toBe(9);
    await expect(store.transaction(kingdomId, tx => tx.sharedNumber('shared', 'keepsake:fish', 'changed'))).rejects.toThrow();
    expect(await store.transaction(kingdomId, tx => tx.nextNumber('keepsake:fish'))).toBe(10);
    await expect(store.transaction(kingdomId, async tx => { tx.afterCommit(() => { throw new Error('listener'); }); return 42; })).resolves.toBe(42);
  });
  it('serializes real grants, survives recreation, and retains a spent gathered record', async () => {
    const kingdomId = KingdomIdSchema.parse(id()), ownerId = PersonIdSchema.parse(id());
    const store = createPostgresItemStore({ pool });
    const catalogue = createItemCatalogue([{ id: 'fish:perch', branch: 'gathered', title: 'Perch', lore: 'A fish.', stack: 99, keepsake: false, model: 'fish:perch', places: ['bag', 'away'] }]);
    const service = () => createRealmItems({ store, catalogue, clock: () => 100 });
    const input: GrantInput = { key: id(), ownerId, kingdomId, origin: 'live', defId: 'fish:perch', story: { by: { personId: ownerId, name: 'Juniper' }, kingdomId, at: 10, where: 'pier', line: 'Caught at the pier' }, source: { kind: 'fishing', ref: id() } };
    const grants = await Promise.all(Array.from({ length: 12 }, () => service().grant(input)));
    expect(new Set(grants.map(item => item.id)).size).toBe(1);
    const persisted = await service().list(ownerId, kingdomId);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.count).toBe(1);
    expect(await service().history(grants[0]!.id)).toHaveLength(1);
    const result = await service().release(ownerId, grants[0]!.id, 1, 0);
    expect(result.ok).toBe(true);
    expect((await service().get(grants[0]!.id))?.place).toBe('spent');
    expect(await service().list(ownerId, kingdomId)).toEqual([]);
    await expect(pool.query("UPDATE realm_items SET record=jsonb_set(jsonb_set(record,'{count}','1'),'{revision}','2') WHERE id=$1 AND kingdom_id=$2", [grants[0]!.id, kingdomId])).rejects.toThrow();
    await expect(pool.query('DELETE FROM realm_items WHERE id=$1 AND kingdom_id=$2', [grants[0]!.id, kingdomId])).rejects.toThrow();
  });

  it('rolls back caller SQL and item grant together and recovers a lost commit acknowledgement', async () => {
    const kingdomId = KingdomIdSchema.parse(id()), ownerId = PersonIdSchema.parse(id());
    const catalogue = createItemCatalogue([{ id: 'tool:rod', branch: 'held', title: 'Rod', lore: 'A rod.', stack: null, keepsake: false, model: 'tool:rod', places: ['bag', 'away'] }]);
    const store = createPostgresItemStore({ pool });
    const service = createRealmItems({ store, catalogue, clock: () => 100 });
    const input: GrantInput = { key: id(), ownerId, kingdomId, origin: 'live', defId: 'tool:rod', story: { by: null, kingdomId, at: 10, where: 'pier', line: 'A rod' }, source: { kind: 'pier', ref: id() } };
    const marker = PersonIdSchema.parse(id());
    await expect(store.transaction(kingdomId, async tx => {
      await postgresItemClient(tx).query('INSERT INTO realm_item_hidden_names(person_id) VALUES ($1)', [marker]);
      await service.grant(input, tx);
      throw new Error('abort both');
    })).rejects.toThrow('abort both');
    expect((await pool.query('SELECT person_id FROM realm_item_hidden_names WHERE person_id=$1', [marker])).rowCount).toBe(0);
    expect(await service.list(ownerId, kingdomId)).toEqual([]);
    let interrupt = true;
    const failingPool: RealmDatabase = {
      query: pool.query.bind(pool),
      async connect() {
        const client = await pool.connect();
        return new Proxy(client, { get(target, prop) {
          if (prop === 'query') return async (...args: unknown[]) => {
            const query = args[0];
            if (query === 'COMMIT' && interrupt) {
              interrupt = false;
              await target.query('COMMIT');
              throw new Error('reply lost');
            }
            return (target.query as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          };
          const value = Reflect.get(target, prop, target) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      },
    };
    const uncertainStore = createPostgresItemStore({ pool: failingPool });
    const uncertainService = createRealmItems({ store: uncertainStore, catalogue, clock: () => 100 });
    let notified = false;
    uncertainService.onChange(() => { notified = true; });
    await expect(uncertainService.grant(input)).rejects.toBeInstanceOf(ItemCommitUncertainError);
    expect(notified).toBe(false);
    const recovered = await uncertainService.grant(input);
    expect(await service.list(ownerId, kingdomId)).toEqual([recovered]);
    expect(await service.history(recovered.id)).toHaveLength(1);
    await expect.poll(() => notified).toBe(true);
  });

  it('shares one durable keepsake number under concurrent retries and rolls back allocations without gaps', async () => {
    const kingdomId = KingdomIdSchema.parse(id());
    const people = [PersonIdSchema.parse(id()), PersonIdSchema.parse(id())].map(personId => ({ personId, name: 'Citizen' }));
    const catalogue = createItemCatalogue([{ id: 'keepsake:fish', branch: 'kept', title: 'Fish mount', lore: 'A catch.', stack: null, keepsake: true, model: 'fish:mount', places: ['bag', 'away'] }]);
    const store = createPostgresItemStore({ pool });
    const service = createRealmItems({ store, catalogue, clock: () => 100 });
    await expect(store.transaction(kingdomId, async tx => { expect(await tx.nextNumber('keepsake:fish')).toBe(1); throw new Error('abort'); })).rejects.toThrow('abort');
    const input = { key: id(), people, kingdomId, origin: 'live' as const, defId: 'keepsake:fish', story: { kingdomId, at: 10, where: 'pier', line: 'A catch' }, source: { kind: 'fishing' as const, ref: id() } };
    const [first, second] = await Promise.all([service.grantShared(input), service.grantShared(input)]);
    expect(first.map(item => item.number)).toEqual([1, 1]);
    expect(second.map(item => item.id)).toEqual(first.map(item => item.id));
    expect(await store.transaction(kingdomId, tx => tx.nextNumber('keepsake:fish'))).toBe(2);
  });

  it('destroys a pooled client when rollback fails', async () => {
    let releasedWith: boolean | Error | undefined;
    const wrapped: RealmDatabase = {
      query: pool.query.bind(pool),
      async connect() {
        const client = await pool.connect();
        return new Proxy(client, { get(target, prop) {
          if (prop === 'query') return async (...args: unknown[]) => {
            if (args[0] === 'ROLLBACK') { await target.query('ROLLBACK'); throw new Error('rollback reply lost'); }
            return (target.query as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          };
          if (prop === 'release') return (error?: boolean | Error) => { releasedWith = error; target.release(error); };
          const value = Reflect.get(target, prop, target) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      },
    };
    const store = createPostgresItemStore({ pool: wrapped });
    await expect(store.transaction(KingdomIdSchema.parse(id()), async () => { throw new Error('abort'); })).rejects.toThrow('abort');
    expect(releasedWith).toBe(true);
  });

  it('redacts hidden names in new and replayed grant results without changing stored provenance', async () => {
    const kingdomId = KingdomIdSchema.parse(id()), ownerId = PersonIdSchema.parse(id());
    const catalogue = createItemCatalogue([{ id: 'tool:rod', branch: 'held', title: 'Rod', lore: 'A rod.', stack: null, keepsake: false, model: 'tool:rod', places: ['bag', 'away'] }]);
    const store = createPostgresItemStore({ pool });
    const service = createRealmItems({ store, catalogue, clock: () => 100 });
    const input: GrantInput = { key: id(), ownerId, kingdomId, origin: 'live', defId: 'tool:rod', story: { by: { personId: ownerId, name: 'Juniper' }, kingdomId, at: 10, where: 'pier', line: 'A rod' }, source: { kind: 'pier', ref: id() } };
    await service.forgetName(ownerId);
    const granted = await service.grant(input);
    expect(granted.story.by?.name).toBe('a citizen');
    expect((await service.grant(input)).story.by?.name).toBe('a citizen');
    await store.transaction(kingdomId, async tx => { expect((await tx.get(granted.id))?.story.by?.name).toBe('Juniper'); });
  });

});
