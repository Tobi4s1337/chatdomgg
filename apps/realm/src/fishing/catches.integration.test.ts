import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runnerImport } from 'vite';
import type { Pool } from 'pg';
import type { RealmDatabase } from '../persistence';
import { createItemCatalogue, createRealmItems } from '../items';
import { createPostgresItemStore, postgresItemClient } from '../items/postgres';
import { createPostgresFishingAdmission } from './entry';
import { createPostgresFishingCatchWriter } from './catches';
import { createFishingSpecies } from './species';
import { fishMountId } from '../../../../packages/content/src/keepsakes';
import { common, definition, definitions, freshKingdom, pierTestPool, rare, retained, sender, wonCast } from './catch-test-fixtures';

const enabled = process.env.REALM_DATABASE_TESTS === '1';
let pool: Pool;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe.runIf(enabled)('fishing catch ledger on isolated Postgres', () => {
  beforeAll(async () => {
    if (process.env.REALM_DATABASE_SCHEMA !== 'pier' || !process.env.DATABASE_URL) throw new Error('Set REALM_DATABASE_SCHEMA=pier and DATABASE_URL for this suite.');
    const url = new URL(process.env.DATABASE_URL);
    if (url.hostname !== '127.0.0.1' || url.port !== '5410') throw new Error('Pier tests require Postgres at 127.0.0.1:5410.');
    pool = pierTestPool(process.env.DATABASE_URL, 1);
    expect((await pool.query('SELECT current_schema() AS schema')).rows[0]?.schema).toBe('pier');
    const { module } = await runnerImport<typeof import('../persistence/migrate')>(resolve('apps/realm/src/persistence/migrate.ts'), { configFile: false });
    await module.migrateRealmSchema(pool, 'pier');
  });
  afterAll(async () => { if (pool) await pool.end(); });

  it('commits an atomic first catch and recovers its receipt after finish, expiry and writer recreation', async () => {
    const kingdomId = freshKingdom(); let hold = await retained(pool, kingdomId);
    try {
      const owner = await sender(pool, kingdomId), cast = wonCast(kingdomId, owner.personId), store = createPostgresItemStore({ pool });
      const catalogue = createItemCatalogue(definitions(common)), species = createFishingSpecies([common]);
      const items = createRealmItems({ store, catalogue, clock: Date.now });
      const options = { kingdomId, origin: 'simulated' as const, store, items, catalogue, species, where: 'Willowmere pier', authority: () => hold.kingdom,
        candidate: cast.casts.candidate, finish: cast.casts.finish,
        admit: createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => null } }) };
      const writer = createPostgresFishingCatchWriter(options);
      const result = await writer.keep(owner.from, cast.id);
      expect(result.status).toBe('kept');
      if (result.status !== 'kept') throw new Error('Catch was not kept.');
      expect(result).toMatchObject({ replayed: false, catch: { ownerId: owner.personId, kingdomId, origin: 'simulated', personalFirst: true, kingdomFirst: true }, item: { ownerId: owner.personId, storied: true, story: { by: { name: 'Approved name' } } } });
      expect((await items.history(result.item.id)).map(event => event.kind)).toEqual(['granted']);
      expect(await pool.query('SELECT id,item_id,grant_key,record FROM realm_fishing_catches WHERE kingdom_id=$1 AND id=$2', [kingdomId, cast.id])).toMatchObject({ rowCount: 1, rows: [{ id: cast.id, item_id: result.item.id }] });
      const link = await pool.query(`SELECT c.item_id FROM realm_fishing_catches c JOIN realm_item_grants g ON g.kingdom_id=c.kingdom_id AND g.origin=c.origin AND g.owner_id=c.owner_id AND g.key=c.grant_key AND g.item_id=c.item_id JOIN realm_items i ON i.id=c.item_id WHERE c.kingdom_id=$1 AND c.id=$2`, [kingdomId, cast.id]);
      expect(link.rows).toEqual([{ item_id: result.item.id }]);
      cast.expire();
      const retry = await createPostgresFishingCatchWriter(options).keep(owner.from, cast.id);
      expect(retry).toMatchObject({ status: 'kept', replayed: true, item: { id: result.item.id }, catch: { id: result.catch.id } });
      const oldEpoch = hold.kingdom.writerEpoch;
      await hold.release();
      hold = await retained(pool, kingdomId);
      expect(hold.kingdom.writerEpoch).not.toBe(oldEpoch);
      const newStore = createPostgresItemStore({ pool }), newItems = createRealmItems({ store: newStore, catalogue, clock: Date.now });
      const restarted = createPostgresFishingCatchWriter({ ...options, store: newStore, items: newItems, authority: () => hold.kingdom, candidate: () => null });
      expect(await restarted.keep(owner.from, cast.id)).toMatchObject({ status: 'kept', replayed: true, item: { id: result.item.id }, catch: { id: result.catch.id } });
      // The kingdom's first of a species also brings its numbered mount: one fish, one mount, never twice.
      expect((await newItems.list(owner.personId, kingdomId)).map(item => item.defId).sort()).toEqual([common.id, fishMountId(common.id)].sort());
      expect((await items.list(owner.personId, kingdomId)).map(item => item.defId).sort()).toEqual([common.id, fishMountId(common.id)].sort());
      expect(result.keepsake).toMatchObject({ defId: fishMountId(common.id), number: 1 });
      expect((await pool.query('SELECT id FROM realm_fishing_catches WHERE kingdom_id=$1', [kingdomId])).rowCount).toBe(1);
      await expect(pool.query('UPDATE realm_fishing_catches SET record=record WHERE kingdom_id=$1 AND id=$2', [kingdomId, cast.id])).rejects.toThrow();
      await expect(pool.query('DELETE FROM realm_fishing_catches WHERE kingdom_id=$1 AND id=$2', [kingdomId, cast.id])).rejects.toThrow();
    } finally { await hold.release(); }
  }, 30_000);

  it('protects the first, stacks later common catches, and keeps rare fish separate', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const owner = await sender(pool, kingdomId), store = createPostgresItemStore({ pool }), catalogue = createItemCatalogue(definitions(common, rare));
      const items = createRealmItems({ store, catalogue, clock: Date.now });
      const admit = createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => null } });
      const keep = async (fish: typeof common) => {
        const cast = wonCast(kingdomId, owner.personId, fish);
        return createPostgresFishingCatchWriter({ kingdomId, origin: 'simulated', store, items, catalogue, species: createFishingSpecies([fish]), where: 'pier',
          authority: () => hold.kingdom, candidate: cast.casts.candidate, finish: cast.casts.finish, admit }).keep(owner.from, cast.id);
      };
      const results = [];
      for (const fish of [common, common, common, rare, rare]) results.push(await keep(fish));
      expect(results.every(r => r.status === 'kept')).toBe(true);
      const [first, second, third, fourth, fifth] = results;
      if ([first, second, third, fourth, fifth].some(r => r?.status !== 'kept')) throw new Error('A catch was not kept.');
      if (first?.status !== 'kept' || second?.status !== 'kept' || third?.status !== 'kept' || fourth?.status !== 'kept' || fifth?.status !== 'kept') throw new Error('Missing catch.');
      expect(first.item.storied).toBe(true);
      expect(second.item.id).toBe(third.item.id); expect(third.item.count).toBe(2);
      expect(second.item.id).not.toBe(first.item.id);
      expect(fourth.item.storied).toBe(true); expect(fifth.item.storied).toBe(true); expect(fourth.item.id).not.toBe(fifth.item.id);
    } finally { await hold.release(); }
  }, 30_000);

  it('serializes truly concurrent first catches and refuses another owner receipt lookup', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    const racePool = pierTestPool(process.env.DATABASE_URL!, 2);
    try {
      const owners = await Promise.all([sender(pool, kingdomId), sender(pool, kingdomId)]), casts = owners.map(owner => wonCast(kingdomId, owner.personId));
      let twoClients!: () => void, firstAdmitted!: () => void, resume!: () => void;
      const connected = new Promise<void>(resolve => { twoClients = resolve; });
      const admitted = new Promise<void>(resolve => { firstAdmitted = resolve; });
      const gate = new Promise<void>(resolve => { resume = resolve; });
      const pids: number[] = [];
      const database: RealmDatabase = { query: racePool.query.bind(racePool), async connect() {
        const client = await racePool.connect();
        pids.push(Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
        if (pids.length === 2) twoClients();
        return client;
      } };
      const store = createPostgresItemStore({ pool: database }), catalogue = createItemCatalogue(definitions(common)), items = createRealmItems({ store, catalogue, clock: Date.now });
      const actualAdmission = createPostgresFishingAdmission({ pool: racePool, origin: 'simulated', readiness: { held: () => null } });
      let first = true;
      const admit: typeof actualAdmission = async (from, tx) => {
        const result = await actualAdmission(from, tx);
        if (first) { first = false; firstAdmitted(); await gate; }
        return result;
      };
      const writers = casts.map(cast => createPostgresFishingCatchWriter({ kingdomId, origin: 'simulated', store, items, catalogue, species: createFishingSpecies([common]), where: 'pier',
        authority: () => hold.kingdom, candidate: cast.casts.candidate, finish: cast.casts.finish, admit }));
      const pendingFirst = writers[0]!.keep(owners[0]!.from, casts[0]!.id);
      await admitted;
      const pendingSecond = writers[1]!.keep(owners[1]!.from, casts[1]!.id);
      try {
        await connected;
        let blocked = false;
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          const result = await pool.query('SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked', [pids[0], pids[1]]);
          if (result.rows[0]?.blocked) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
      } finally { resume(); }
      const results = await Promise.all([pendingFirst, pendingSecond]);
      expect(results.every(r => r.status === 'kept')).toBe(true);
      expect(results.filter(r => r.status === 'kept' && r.catch.personalFirst)).toHaveLength(2);
      expect(results.filter(r => r.status === 'kept' && r.catch.kingdomFirst)).toHaveLength(1);
      const foreign = await writers[0]!.keep(owners[1]!.from, casts[0]!.id);
      const absent = await writers[0]!.keep(owners[1]!.from, '123e4567-e89b-42d3-a456-426614174000');
      expect(foreign).toMatchObject({ status: 'refused' }); expect(foreign).toEqual(absent);
      const wrongOrigin = { ...owners[0]!.from, principal: { ...owners[0]!.from.principal, origin: 'live' as const } };
      expect(await writers[0]!.keep(wrongOrigin, casts[0]!.id)).toMatchObject({ status: 'refused' });
    } finally { await hold.release(); await racePool.end(); }
  }, 30_000);

  it('rolls back the catch, item, history and notifications when authority vanishes after writing', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const owner = await sender(pool, kingdomId), cast = wonCast(kingdomId, owner.personId), store = createPostgresItemStore({ pool });
      const catalogue = createItemCatalogue(definitions(common)), items = createRealmItems({ store, catalogue, clock: Date.now }), changed = vi.fn();
      items.onChange(changed);
      const transaction = store.transaction.bind(store);
      store.transaction = (kingdom, work) => transaction(kingdom, tx => {
        const append = tx.append.bind(tx);
        tx.append = async event => { await append(event); cast.disconnect(); };
        return work(tx);
      });
      const writer = createPostgresFishingCatchWriter({ kingdomId, origin: 'simulated', store, items, catalogue, species: createFishingSpecies([common]), where: 'pier',
        authority: () => hold.kingdom, candidate: cast.casts.candidate, finish: cast.casts.finish,
        admit: createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => null } }) });
      expect(await writer.keep(owner.from, cast.id)).toMatchObject({ status: 'refused' });
      expect(await items.list(owner.personId, kingdomId)).toEqual([]);
      expect((await pool.query('SELECT id FROM realm_fishing_catches WHERE kingdom_id=$1', [kingdomId])).rowCount).toBe(0);
      expect((await pool.query('SELECT item_id FROM realm_item_events WHERE item_id IN (SELECT id FROM realm_items WHERE kingdom_id=$1)', [kingdomId])).rowCount).toBe(0);
      await flush(); expect(changed).not.toHaveBeenCalled();
    } finally { await hold.release(); }
  }, 30_000);

  it('recovers an uncertain commit by cast receipt without duplicating the catch or item', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const owner = await sender(pool, kingdomId), cast = wonCast(kingdomId, owner.personId);
      let interrupt = true;
      const failingPool: RealmDatabase = { query: pool.query.bind(pool), async connect() {
        const client = await pool.connect();
        return new Proxy(client, { get(target, prop) {
          if (prop === 'query') return async (...args: unknown[]) => {
            if (args[0] === 'COMMIT' && interrupt) { interrupt = false; await target.query('COMMIT'); throw new Error('reply lost'); }
            return (target.query as (...args: unknown[]) => Promise<unknown>).apply(target, args);
          };
          const value = Reflect.get(target, prop, target) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      } };
      const store = createPostgresItemStore({ pool: failingPool }), catalogue = createItemCatalogue(definitions(common)), items = createRealmItems({ store, catalogue, clock: Date.now });
      const writer = createPostgresFishingCatchWriter({ kingdomId, origin: 'simulated', store, items, catalogue, species: createFishingSpecies([common]), where: 'pier',
        authority: () => hold.kingdom, candidate: cast.casts.candidate, finish: cast.casts.finish,
        admit: createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => null } }) });
      expect(await writer.keep(owner.from, cast.id)).toMatchObject({ status: 'uncertain', castId: cast.id });
      expect(await writer.keep(owner.from, cast.id)).toMatchObject({ status: 'kept', replayed: true });
      expect((await items.list(owner.personId, kingdomId)).filter(item => item.defId === common.id)).toHaveLength(1);
      expect((await pool.query('SELECT id FROM realm_fishing_catches WHERE kingdom_id=$1', [kingdomId])).rowCount).toBe(1);
    } finally { await hold.release(); }
  }, 30_000);

  it.each(['session', 'lease'] as const)('rolls back all writes if %s fails before the final fence', async failure => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const owner = await sender(pool, kingdomId), cast = wonCast(kingdomId, owner.personId), store = createPostgresItemStore({ pool });
      const catalogue = createItemCatalogue(definitions(common)), items = createRealmItems({ store, catalogue, clock: Date.now }), changed = vi.fn();
      items.onChange(changed);
      const transaction = store.transaction.bind(store);
      store.transaction = (kingdom, work) => transaction(kingdom, tx => {
        const append = tx.append.bind(tx);
        tx.append = async event => {
          await append(event);
          if (failure === 'session') await postgresItemClient(tx).query("UPDATE realm_sessions SET revoked_at=now(),revoked_reason='revoked' WHERE session_id=$1", [owner.sessionId]);
          else await postgresItemClient(tx).query('UPDATE realm_kingdoms SET lease_expires_ms=1 WHERE kingdom_id=$1', [kingdomId]);
        };
        return work(tx);
      });
      const writer = createPostgresFishingCatchWriter({ kingdomId, origin: 'simulated', store, items, catalogue, species: createFishingSpecies([common]), where: 'pier',
        authority: () => hold.kingdom, candidate: cast.casts.candidate, finish: cast.casts.finish,
        admit: createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => null } }) });
      expect(await writer.keep(owner.from, cast.id)).toMatchObject({ status: 'refused' });
      expect(await items.list(owner.personId, kingdomId)).toEqual([]);
      expect((await pool.query('SELECT 1 FROM realm_fishing_catches WHERE kingdom_id=$1', [kingdomId])).rowCount).toBe(0);
      expect((await pool.query('SELECT 1 FROM realm_item_grants WHERE kingdom_id=$1', [kingdomId])).rowCount).toBe(0);
      await flush(); expect(changed).not.toHaveBeenCalled();
    } finally { await hold.release(); }
  }, 30_000);

  it('locks session rows against revocation until the one-connection catch transaction commits', async () => {
    const other = pierTestPool(process.env.DATABASE_URL!, 2);
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const owner = await sender(pool, kingdomId), cast = wonCast(kingdomId, owner.personId), store = createPostgresItemStore({ pool });
      const catalogue = createItemCatalogue(definitions(common)), items = createRealmItems({ store, catalogue, clock: Date.now });
      const admission = createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => null } });
      let enter!: () => void, resume!: () => void, first = true, catchPid = 0;
      const locked = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
      const writer = createPostgresFishingCatchWriter({ kingdomId, origin: 'simulated', store, items, catalogue, species: createFishingSpecies([common]), where: 'pier',
        authority: () => hold.kingdom, candidate: cast.casts.candidate, finish: cast.casts.finish,
        admit: async (from, tx) => { const result = await admission(from, tx); if (first) { first = false; catchPid = Number((await postgresItemClient(tx).query('SELECT pg_backend_pid() AS pid')).rows[0].pid); enter(); await gate; } return result; } });
      const pending = writer.keep(owner.from, cast.id);
      await locked;
      const revoker = await other.connect();
      try {
        const pid = Number((await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        const revoke = revoker.query("UPDATE realm_sessions SET revoked_at=now(),revoked_reason='revoked' WHERE session_id=$1", [owner.sessionId]);
        let blocked = false;
        try {
          const deadline = Date.now() + 2000;
          while (Date.now() < deadline) {
            const row = await other.query('SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked', [catchPid, pid]);
            if (row.rows[0]?.blocked) { blocked = true; break; }
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          expect(blocked).toBe(true);
        } finally { resume(); }
        expect(await pending).toMatchObject({ status: 'kept' });
        expect((await revoke).rowCount).toBe(1);
      } finally { revoker.release(); }
    } finally { await hold.release(); await other.end(); }
  }, 30_000);


  it.each(['item', 'history', 'receipt', 'catch'] as const)('rolls back after the %s write fails', async phase => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const owner = await sender(pool, kingdomId), cast = wonCast(kingdomId, owner.personId);
      const faultPool: RealmDatabase = { query: pool.query.bind(pool), async connect() {
        const client = await pool.connect();
        return new Proxy(client, { get(target, prop) {
          if (prop === 'query') return async (...args: unknown[]) => {
            const result = await (target.query as (...args: unknown[]) => Promise<unknown>).apply(target, args);
            if (phase === 'catch' && typeof args[0] === 'string' && /insert\s+into\s+realm_fishing_catches/i.test(args[0])) throw new Error('injected catch write fault');
            return result;
          };
          const value = Reflect.get(target, prop, target) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      } };
      const store = createPostgresItemStore({ pool: faultPool }), transaction = store.transaction.bind(store);
      store.transaction = (kingdom, work) => transaction(kingdom, tx => {
        const save = tx.save.bind(tx), append = tx.append.bind(tx), receipt = tx.saveReceipt.bind(tx);
        tx.save = async value => { await save(value); if (phase === 'item') throw new Error('injected item write fault'); };
        tx.append = async value => { await append(value); if (phase === 'history') throw new Error('injected history write fault'); };
        tx.saveReceipt = async value => { await receipt(value); if (phase === 'receipt') throw new Error('injected receipt write fault'); };
        return work(tx);
      });
      const catalogue = createItemCatalogue(definitions(common)), items = createRealmItems({ store, catalogue, clock: Date.now }), changed = vi.fn();
      items.onChange(changed);
      const writer = createPostgresFishingCatchWriter({ kingdomId, origin: 'simulated', store, items, catalogue, species: createFishingSpecies([common]), where: 'pier',
        authority: () => hold.kingdom, candidate: cast.casts.candidate, finish: cast.casts.finish,
        admit: createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => null } }) });
      await expect(writer.keep(owner.from, cast.id)).rejects.toThrow();
      expect(await items.list(owner.personId, kingdomId)).toEqual([]);
      expect((await pool.query('SELECT 1 FROM realm_item_grants WHERE kingdom_id=$1', [kingdomId])).rowCount).toBe(0);
      expect((await pool.query('SELECT 1 FROM realm_fishing_catches WHERE kingdom_id=$1', [kingdomId])).rowCount).toBe(0);
      await flush(); expect(changed).not.toHaveBeenCalled();
      expect(cast.casts.candidate(owner.personId)).not.toBeNull();
    } finally { await hold.release(); }
  }, 30_000);


  it('refuses an initially stale database writer epoch without inserting a catch', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const owner = await sender(pool, kingdomId), cast = wonCast(kingdomId, owner.personId), store = createPostgresItemStore({ pool });
      const catalogue = createItemCatalogue(definitions(common)), items = createRealmItems({ store, catalogue, clock: Date.now });
      const writer = createPostgresFishingCatchWriter({ kingdomId, origin: 'simulated', store, items, catalogue, species: createFishingSpecies([common]), where: 'pier',
        authority: () => hold.kingdom, candidate: cast.casts.candidate, finish: cast.casts.finish,
        admit: createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => null } }) });
      await pool.query("UPDATE realm_kingdoms SET writer_epoch=repeat('a',64) WHERE kingdom_id=$1", [kingdomId]);
      expect(await writer.keep(owner.from, cast.id)).toMatchObject({ status: 'refused' });
      expect(await items.list(owner.personId, kingdomId)).toEqual([]);
      expect((await pool.query('SELECT 1 FROM realm_fishing_catches WHERE kingdom_id=$1', [kingdomId])).rowCount).toBe(0);
    } finally { await hold.release(); }
  }, 30_000);


  it('rolls back if the candidate disappears after callback completion and before COMMIT', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const owner = await sender(pool, kingdomId), cast = wonCast(kingdomId, owner.personId), store = createPostgresItemStore({ pool });
      const transaction = store.transaction.bind(store);
      store.transaction = (kingdom, work) => transaction(kingdom, async tx => { const result = await work(tx); cast.disconnect(); return result; });
      const catalogue = createItemCatalogue(definitions(common)), items = createRealmItems({ store, catalogue, clock: Date.now }), changed = vi.fn();
      items.onChange(changed);
      const writer = createPostgresFishingCatchWriter({ kingdomId, origin: 'simulated', store, items, catalogue, species: createFishingSpecies([common]), where: 'pier',
        authority: () => hold.kingdom, candidate: cast.casts.candidate, finish: cast.casts.finish,
        admit: createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => null } }) });
      expect(await writer.keep(owner.from, cast.id)).toMatchObject({ status: 'refused' });
      expect(await items.list(owner.personId, kingdomId)).toEqual([]);
      expect((await pool.query('SELECT 1 FROM realm_fishing_catches WHERE kingdom_id=$1', [kingdomId])).rowCount).toBe(0);
      expect((await pool.query('SELECT 1 FROM realm_item_grants WHERE kingdom_id=$1', [kingdomId])).rowCount).toBe(0);
      await flush(); expect(changed).not.toHaveBeenCalled();
    } finally { await hold.release(); }
  }, 30_000);

  it('redacts a withdrawn name on the initial item and receipt retry', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const owner = await sender(pool, kingdomId), cast = wonCast(kingdomId, owner.personId), store = createPostgresItemStore({ pool });
      const catalogue = createItemCatalogue(definitions(common)), items = createRealmItems({ store, catalogue, clock: Date.now });
      await items.forgetName(owner.personId);
      const writer = createPostgresFishingCatchWriter({ kingdomId, origin: 'simulated', store, items, catalogue, species: createFishingSpecies([common]), where: 'pier',
        authority: () => hold.kingdom, candidate: cast.casts.candidate, finish: cast.casts.finish,
        admit: createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => null } }) });
      expect(await writer.keep(owner.from, cast.id)).toMatchObject({ status: 'kept', replayed: false, item: { story: { by: { name: 'a citizen' } } } });
      expect(await writer.keep(owner.from, cast.id)).toMatchObject({ status: 'kept', replayed: true, item: { story: { by: { name: 'a citizen' } } } });
    } finally { await hold.release(); }
  }, 30_000);

  it('returns an already spent stack on receipt retry without resurrecting it', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const owner = await sender(pool, kingdomId), store = createPostgresItemStore({ pool });
      const catalogue = createItemCatalogue(definitions(common)), items = createRealmItems({ store, catalogue, clock: Date.now });
      const admit = createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => null } });
      const first = wonCast(kingdomId, owner.personId), second = wonCast(kingdomId, owner.personId);
      const writer = (cast: typeof first) => createPostgresFishingCatchWriter({ kingdomId, origin: 'simulated', store, items, catalogue,
        species: createFishingSpecies([common]), where: 'pier', authority: () => hold.kingdom, candidate: cast.casts.candidate, finish: cast.casts.finish, admit });
      expect(await writer(first).keep(owner.from, first.id)).toMatchObject({ status: 'kept' });
      const secondWriter = writer(second), result = await secondWriter.keep(owner.from, second.id);
      expect(result.status).toBe('kept'); if (result.status !== 'kept') throw new Error('Catch was not kept.');
      expect(result.item.storied).toBe(false);
      expect(await items.release(owner.personId, result.item.id, 1, result.item.revision)).toMatchObject({ ok: true, item: { place: 'spent', count: 0 } });
      expect(await secondWriter.keep(owner.from, second.id)).toMatchObject({ status: 'kept', replayed: true, item: { id: result.item.id, place: 'spent', count: 0 } });
      expect((await items.list(owner.personId, kingdomId)).filter(item => item.defId === common.id)).toHaveLength(1);
    } finally { await hold.release(); }
  }, 30_000);


  it('orders admission behind sign-in person lock, allowing revocation to finish without deadlock', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    const other = pierTestPool(process.env.DATABASE_URL!, 2);
    const locker = await other.connect();
    try {
      const owner = await sender(pool, kingdomId), cast = wonCast(kingdomId, owner.personId);
      let catchPid = 0, started!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      const database: RealmDatabase = { query: pool.query.bind(pool), async connect() {
        const client = await pool.connect();
        catchPid = Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid); started(); return client;
      } };
      const store = createPostgresItemStore({ pool: database }), catalogue = createItemCatalogue(definitions(common)), items = createRealmItems({ store, catalogue, clock: Date.now });
      const writer = createPostgresFishingCatchWriter({ kingdomId, origin: 'simulated', store, items, catalogue, species: createFishingSpecies([common]), where: 'pier',
        authority: () => hold.kingdom, candidate: cast.casts.candidate, finish: cast.casts.finish,
        admit: createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => null } }) });
      await locker.query('BEGIN');
      const lockerPid = Number((await locker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await locker.query('UPDATE realm_persons SET last_sign_in_at=now() WHERE person_id=$1', [owner.personId]);
      const pending = writer.keep(owner.from, cast.id);
      await ready;
      let blocked = false;
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const row = await other.query('SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked', [lockerPid, catchPid]);
        if (row.rows[0]?.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await locker.query("UPDATE realm_sessions SET revoked_at=now(),revoked_reason='revoked' WHERE session_id=$1", [owner.sessionId]);
      await locker.query('COMMIT');
      expect(await pending).toMatchObject({ status: 'refused' });
      expect(await items.list(owner.personId, kingdomId)).toEqual([]);
      expect((await pool.query('SELECT 1 FROM realm_fishing_catches WHERE kingdom_id=$1', [kingdomId])).rowCount).toBe(0);
    } finally { await locker.query('ROLLBACK').catch(() => {}); locker.release(); await hold.release(); await other.end(); }
  }, 30_000);

});
