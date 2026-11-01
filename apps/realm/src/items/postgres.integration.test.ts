import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type ItemRecord } from '@chatdom/shared';
import pg, { type Pool } from 'pg';
import { runnerImport } from 'vite';
import { resolve } from 'node:path';
import { createRealmPool, type RealmDatabase } from '../persistence/database';
import { createItemCatalogue, createRealmItems, type GrantInput } from './index';
import { ItemCommitUncertainError } from './store';
import { createPostgresItemStore, postgresItemClient } from './postgres';
import type { ItemTransaction } from './store';
import { createPostgresItemAdmission } from './entry';
import { createRealmAuthenticator } from '../auth/authenticator';
import type { RealmChannelSender } from '../room-channels';

const enabled = process.env.REALM_DATABASE_TESTS === '1';
let pool: Pool;
const id = () => BigInt(`0x${randomBytes(12).toString('hex')}`).toString();

describe.runIf(enabled)('pier item store on isolated Postgres', () => {
  beforeAll(async () => {
    if (process.env.REALM_DATABASE_SCHEMA !== 'pier' || !process.env.DATABASE_URL) throw new Error('Set REALM_DATABASE_SCHEMA=pier and DATABASE_URL for this suite.');
    const url = new URL(process.env.DATABASE_URL);
    if (url.hostname !== '127.0.0.1' || url.port !== '5410') throw new Error('Pier tests require Postgres at 127.0.0.1:5410.');
    pool = createRealmPool({ connectionString: process.env.DATABASE_URL, schema: 'pier' });
    expect((await pool.query('SELECT current_schema() AS schema')).rows[0]?.schema).toBe('pier');
    // A disk-cached glob can miss a newly added SQL file. Use the same fresh source runner as the migration CLI.
    const { module } = await runnerImport<typeof import('../persistence/migrate')>(resolve('apps/realm/src/persistence/migrate.ts'), { configFile: false });
    await module.migrateRealmSchema(pool, 'pier');
    expect((await pool.query("SELECT 1 FROM pg_indexes WHERE schemaname='pier' AND indexname='realm_items_owner_page'")).rowCount).toBe(1);
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
  it('rolls back SQL item writes and history if the room entry ends before commit', async () => {
    const kingdomId = KingdomIdSchema.parse(id()), ownerId = PersonIdSchema.parse(id());
    const store = createPostgresItemStore({ pool });
    const catalogue = createItemCatalogue([{ id: 'fish:perch', branch: 'gathered', title: 'Perch', lore: 'A fish.', stack: 99, keepsake: false, model: 'fish:perch', places: ['bag', 'away'] }]);
    const items = createRealmItems({ store, catalogue, clock: () => 100 });
    let sawGrant!: () => void;
    const firstPush = new Promise<void>(resolve => { sawGrant = resolve; });
    const pushes: unknown[] = []; items.onChange((...change) => { pushes.push(change); sawGrant(); });
    const fish = await items.grant({ key: id(), ownerId, kingdomId, origin: 'live', defId: 'fish:perch', count: 3,
      story: { by: null, kingdomId, at: 10, where: 'pier', line: 'Caught here' }, source: { kind: 'fishing', ref: id() } });
    await firstPush; pushes.length = 0;
    let current = true;
    let callbacks = 0;
    const transaction = store.transaction.bind(store);
    store.transaction = (kingdom, work) => transaction(kingdom, tx => {
      const append = tx.append.bind(tx);
      const committed = tx.afterCommit.bind(tx);
      tx.afterCommit = callback => committed(() => { callbacks++; callback(); });
      tx.append = async event => { await append(event); current = false; };
      return work(tx);
    });
    for (const action of ['move', 'release'] as const) {
      current = true;
      const access = { kingdomId, origin: 'live' as const, current: async () => current };
      const result = action === 'move' ? await items.move(ownerId, fish.id, { place: 'away', slot: null }, 0, access)
        : await items.release(ownerId, fish.id, 1, 0, access);
      expect(result).toMatchObject({ ok: false });
      expect(await items.get(fish.id)).toEqual(fish);
      expect((await items.history(fish.id)).map(event => event.kind)).toEqual(['granted']);
    }
    await new Promise(resolve => setImmediate(resolve));
    expect(pushes).toEqual([]);
    expect(callbacks).toBe(0);
  });
  it('checks eight concurrent guarded owners through their own transaction on a one-connection pool', async () => {
    const single = new pg.Pool({ connectionString: process.env.DATABASE_URL!, max: 1, connectionTimeoutMillis: 500,
      statement_timeout: 5000, query_timeout: 6000, idle_in_transaction_session_timeout: 10000, options: '-c search_path=pier' });
    single.on('error', () => {});
    try {
      const kingdomId = KingdomIdSchema.parse(id()), store = createPostgresItemStore({ pool: single });
      const catalogue = createItemCatalogue([{ id: 'fish:perch', branch: 'gathered', title: 'Perch', lore: 'A fish.', stack: 99, keepsake: false, model: 'fish:perch', places: ['bag', 'away'] }]);
      const items = createRealmItems({ store, catalogue, clock: Date.now });
      const auth = createRealmAuthenticator({ pool: single, origin: 'simulated' });
      let available = true;
      const admit = createPostgresItemAdmission({ pool: single, origin: 'simulated', readiness: { held: () => available ? null : 'unavailable' } });
      const owners: { from: RealmChannelSender; item: ItemRecord; sessionId: string }[] = [];
      for (let i = 0; i < 8; i++) {
        const ownerId = PersonIdSchema.parse(id()), sessionId = randomUUID(), entryId = randomUUID();
        await single.query("INSERT INTO realm_persons(person_id,origin,identity_issuer) VALUES($1,'simulated','pier-test')", [ownerId]);
        await single.query("INSERT INTO realm_sessions(session_id,handle_hash,person_id,origin,resume_scope,expires_at) VALUES($1,$2,$3,'simulated',$4,now()+interval '1 hour')", [sessionId, randomBytes(32), ownerId, randomUUID()]);
        await single.query("INSERT INTO realm_entries(entry_id,session_id,person_id,kingdom_id,origin) VALUES($1,$2,$3,$4,'simulated')", [entryId, sessionId, ownerId, kingdomId]);
        const principal = { personId: ownerId, kingdomId, origin: 'simulated' as const, sessionId: entryId, expiresAt: Date.now() + 3_600_000, publicName: 'A fisher', look: 'reference' };
        const from: RealmChannelSender = { principal, walkerId: entryId, pose: () => null, present: () => true, current: () => auth.current(principal, Date.now()) };
        const item = await items.grant({ key: id(), ownerId, kingdomId, origin: 'simulated', defId: 'fish:perch', count: 3,
          story: { by: null, kingdomId, at: 10, where: 'pier', line: 'Caught here' }, source: { kind: 'fishing', ref: id() } });
        owners.push({ from, item, sessionId });
      }
      const replies = await Promise.all(owners.map(({ from, item }) => items.move(item.ownerId, item.id, { place: 'away', slot: null }, 0,
        { kingdomId, origin: 'simulated', current: tx => admit(from, tx) })));
      expect(replies.every(reply => reply.ok && reply.item.revision === 1)).toBe(true);
      const first = owners[0]!;
      await single.query("UPDATE realm_sessions SET revoked_at=now(),revoked_reason='revoked' WHERE session_id=$1", [first.sessionId]);
      expect(await items.release(first.item.ownerId, first.item.id, 1, 1, { kingdomId, origin: 'simulated', current: tx => admit(first.from, tx) })).toMatchObject({ ok: false });
      available = false;
      expect(await items.move(owners[1]!.item.ownerId, owners[1]!.item.id, { place: 'bag', slot: null }, 1,
        { kingdomId, origin: 'simulated', current: tx => admit(owners[1]!.from, tx) })).toMatchObject({ ok: false });
      expect((await items.get(first.item.id))?.revision).toBe(1);
    } finally { await single.end(); }
  }, 30_000);

  it('keyset-pages retained Postgres records and history with the same scope and byte ceilings', async () => {
    const kingdomId = KingdomIdSchema.parse(id()), ownerId = PersonIdSchema.parse(id());
    const store = createPostgresItemStore({ pool });
    const catalogue = createItemCatalogue([{ id: 'tool:rod', branch: 'held', title: 'Rod', lore: 'A rod.', stack: null, keepsake: false, model: 'tool:rod', places: ['bag', 'away'] }]);
    const items = createRealmItems({ store, catalogue, clock: Date.now });
    const input: GrantInput = { key: id(), ownerId, kingdomId, origin: 'simulated', defId: 'tool:rod',
      story: { by: { personId: ownerId, name: 'Juniper' }, kingdomId, at: 10, where: 'pier', line: 'Taken here' }, source: { kind: 'pier', ref: id() } };
    const records = await store.transaction(kingdomId, async tx => {
      const records = [];
      for (let i = 0; i < 75; i++) records.push(await items.grant({ ...input, key: `${input.key}-${i}` }, tx));
      return records;
    });
    await items.grant({ ...input, key: `${input.key}-live`, origin: 'live' });
    await items.forgetName(ownerId);
    const seen: string[] = [];
    let after: string | undefined;
    do {
      const page = await items.listPage(ownerId, kingdomId, 'simulated', after);
      expect(page.items.length).toBeLessThanOrEqual(32);
      expect(page.items.every(item => item.story.by?.name === 'a citizen')).toBe(true);
      expect(Buffer.byteLength(JSON.stringify({ type: 'items.list', id: 'x', ...page }))).toBeLessThanOrEqual(48 * 1024);
      seen.push(...page.items.map(item => item.id)); after = page.next ?? undefined;
    } while (after);
    expect(seen).toEqual(records.map(item => item.id).sort());
    const first = records[0]!;
    for (let revision = 0; revision < 105; revision++) expect(await items.move(ownerId, first.id, { place: revision % 2 ? 'bag' : 'away', slot: null }, revision)).toMatchObject({ ok: true });
    const history = [];
    after = undefined;
    do {
      const page = await items.historyPage(first.id, after);
      expect(page.events.length).toBeLessThanOrEqual(32);
      history.push(...page.events); after = page.next ?? undefined;
    } while (after);
    expect(history).toEqual(await items.history(first.id)); expect(history).toHaveLength(106);
  }, 30_000);
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
