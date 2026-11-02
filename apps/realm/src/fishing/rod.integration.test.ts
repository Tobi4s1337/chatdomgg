import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runnerImport } from 'vite';
import type { Pool } from 'pg';
import type { RealmDatabase } from '../persistence';
import { createItemCatalogue, createRealmItems } from '../items';
import { createPostgresItemStore } from '../items/postgres';
import { WILLOW_ROD_DEFINITION } from '../../../../packages/content/src/pier/rod';
import { createPostgresFishingAdmission } from './entry';
import { createPostgresRodRack } from './rod';
import type { FishingRoomInstallation } from './installation';
import { freshKingdom, pierTestPool, retained, sender } from './catch-test-fixtures';

let pool: Pool;
const enabled = process.env.REALM_DATABASE_TESTS === '1';
describe.runIf(enabled)('rod rack on isolated Postgres', () => {
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

  async function setup(database: RealmDatabase = pool) {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId), owner = await sender(pool, kingdomId);
    const store = createPostgresItemStore({ pool: database }), catalogue = createItemCatalogue([WILLOW_ROD_DEFINITION]);
    const items = createRealmItems({ store, catalogue, clock: () => 1000 });
    const installation: FishingRoomInstallation = { rack: [0, 1, 0], revision: 7, biome: null,
      site: { version: 1, id: 'pier:lake', root: [0, 0, 0], turn: 0, deckY: 1, waterY: 0, walk: 20, water: 'lake', biome: 'unknown', depth: [] },
      sample: () => ({ waterY: 0, groundY: -2 }) };
    let present = true, pose = { position: [0, 1, 0] as [number, number, number], yaw: 0, grounded: true, collisionRevision: 7 };
    const from = { ...owner.from, present: () => present, pose: () => pose };
    const admit = createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => null } });
    const options = { kingdomId, origin: 'simulated' as const, store, items, where: 'Willowmere pier', authority: () => hold.kingdom,
      installation: () => installation, admit, now: () => 1000 };
    return { kingdomId, hold, owner, store, items, from, options, rack: createPostgresRodRack(options),
      setPresent: (value: boolean) => { present = value; }, setPose: (value: typeof pose) => { pose = value; } };
  }

  it('grants the authored rod to the first free hotbar slot and recovers a put-away receipt', async () => {
    const s = await setup();
    try {
      const prior = await s.items.grant({ key: 'prior', ownerId: s.owner.personId, kingdomId: s.kingdomId, origin: 'simulated', defId: WILLOW_ROD_DEFINITION.id, place: 'hotbar', source: { kind: 'pier', ref: 'rack' }, story: { by: { personId: s.owner.personId, name: 'Approved name' }, kingdomId: s.kingdomId, where: 'pier', at: 999, line: 'Earlier rod.' } });
      const result = await s.rack(s.from);
      expect(result.status).toBe('taken'); if (result.status !== 'taken') throw new Error('No rod');
      expect(result.item).toMatchObject({ defId: WILLOW_ROD_DEFINITION.id, ownerId: s.owner.personId, branch: 'held', place: 'hotbar', slot: 1, storied: true, story: { by: { name: 'Approved name' }, where: 'Willowmere pier', at: 1000 } });
      expect(await s.rack(s.from)).toMatchObject({ status: 'taken', item: { id: result.item.id } });
      expect(await s.items.history(result.item.id)).toHaveLength(1);
      expect(await s.items.move(s.owner.personId, result.item.id, { place: 'away', slot: null }, result.item.revision)).toMatchObject({ ok: true });
      expect(await s.rack(s.from)).toMatchObject({ status: 'taken', item: { id: result.item.id, place: 'away' } });
      expect(await s.items.history(result.item.id)).toHaveLength(2);
      expect((await s.store.atPlace(s.owner.personId, s.kingdomId, 'simulated', 'hotbar')).map(x => x.id)).toEqual([prior.id]);
      expect(await s.store.atPlace(s.owner.personId, s.kingdomId, 'live', 'hotbar')).toEqual([]);
      await s.store.transaction(s.kingdomId, async tx => { expect((await tx.atPlace(s.owner.personId, 'simulated', 'hotbar')).map(x => x.id)).toEqual([prior.id]); expect(await tx.atPlace(s.owner.personId, 'simulated', 'hand')).toEqual([]); });
      expect((await pool.query('SELECT 1 FROM realm_item_grants WHERE kingdom_id=$1 AND key=$2', [s.kingdomId, 'pier:willow-rod:1'])).rowCount).toBe(1);
    } finally { await s.hold.release(); }
  }, 30_000);

  it.each(['origin', 'owner', 'distance', 'grounded', 'revision', 'epoch', 'session', 'seat', 'guard'] as const)('refuses %s and rolls back the grant', async failure => {
    const s = await setup();
    try {
      let from = s.from;
      if (failure === 'origin') from = { ...from, principal: { ...from.principal, origin: 'live' } };
      if (failure === 'owner') { const other = await sender(pool, s.kingdomId); from = { ...from, principal: { ...from.principal, personId: other.personId } }; }
      if (failure === 'distance') s.setPose({ ...from.pose()!, position: [3, 1, 0] });
      if (failure === 'grounded') s.setPose({ ...from.pose()!, grounded: false });
      if (failure === 'revision') s.setPose({ ...from.pose()!, collisionRevision: 8 });
      if (failure === 'epoch') await pool.query("UPDATE realm_kingdoms SET writer_epoch=repeat('a',64) WHERE kingdom_id=$1", [s.kingdomId]);
      if (failure === 'session') await pool.query("UPDATE realm_sessions SET revoked_at=now(),revoked_reason='revoked' WHERE session_id=$1", [s.owner.sessionId]);
      if (failure === 'seat' || failure === 'guard') {
        const transaction = s.store.transaction.bind(s.store);
        s.store.transaction = (kingdom, work) => transaction(kingdom, async tx => {
          if (failure === 'seat') { const append = tx.append.bind(tx); tx.append = async event => { await append(event); s.setPresent(false); }; }
          const result = await work(tx); if (failure === 'guard') s.setPresent(false); return result;
        });
      }
      expect(await s.rack(from)).toMatchObject({ status: 'refused' });
      expect(await s.items.list(s.owner.personId, s.kingdomId)).toEqual([]);
      expect((await pool.query('SELECT 1 FROM realm_item_grants WHERE kingdom_id=$1', [s.kingdomId])).rowCount).toBe(0);
    } finally { await s.hold.release(); }
  }, 30_000);

  it('bounds and scopes Postgres placement reads and first-free allocation', async () => {
    const s = await setup();
    try {
      const other = await sender(pool, s.kingdomId), elsewhere = freshKingdom();
      const grant = (key: string, ownerId = s.owner.personId, kingdomId = s.kingdomId, origin: 'live' | 'simulated' = 'simulated', place: 'hand' | 'hotbar' = 'hotbar') => s.items.grant({ key, ownerId, kingdomId, origin, place, defId: WILLOW_ROD_DEFINITION.id, source: { kind: 'pier', ref: 'rack' }, story: { by: { personId: ownerId, name: 'Name' }, kingdomId, where: 'pier', at: 1000, line: 'Taken from the rack.' } });
      const own = await grant('own');
      const foreign = await grant('foreign', other.personId), origin = await grant('origin', s.owner.personId, s.kingdomId, 'live');
      const hand = await grant('hand', s.owner.personId, s.kingdomId, 'simulated', 'hand');
      const kingdom = await grant('kingdom', s.owner.personId, elsewhere);
      expect([own.slot, foreign.slot, origin.slot, kingdom.slot]).toEqual([0, 0, 0, 0]);
      for (let slot = 1; slot < 64; slot++) expect((await grant(`slot-${slot}`)).slot).toBe(slot);
      await expect(grant('overflow')).rejects.toThrow('no free place');
      expect(await s.store.atPlace(s.owner.personId, s.kingdomId, 'simulated', 'hotbar')).toHaveLength(64);
      expect((await s.store.atPlace(other.personId, s.kingdomId, 'simulated', 'hotbar')).map(x => x.id)).toEqual([foreign.id]);
      expect((await s.store.atPlace(s.owner.personId, elsewhere, 'simulated', 'hotbar')).map(x => x.id)).toEqual([kingdom.id]);
      await s.store.transaction(s.kingdomId, async tx => {
        expect((await tx.atPlace(s.owner.personId, 'live', 'hotbar')).map(x => x.id)).toEqual([origin.id]);
        expect((await tx.atPlace(s.owner.personId, 'simulated', 'hand')).map(x => x.id)).toEqual([hand.id]);
        expect(await tx.atPlace(s.owner.personId, 'simulated', 'hotbar')).toHaveLength(64);
      });
    } finally { await s.hold.release(); }
  }, 30_000);

  it('recovers a lost COMMIT reply without another rod or event', async () => {
    let interrupt = true;
    const database: RealmDatabase = { query: pool.query.bind(pool), async connect() {
      const client = await pool.connect();
      return new Proxy(client, { get(target, prop) {
        if (prop === 'query') return async (...args: unknown[]) => {
          if (args[0] === 'COMMIT' && interrupt) { interrupt = false; await target.query('COMMIT'); throw new Error('reply lost'); }
          return (target.query as (...args: unknown[]) => Promise<unknown>).apply(target, args);
        };
        const value = Reflect.get(target, prop, target) as unknown; return typeof value === 'function' ? value.bind(target) : value;
      } });
    } };
    const s = await setup(database);
    try {
      expect(await s.rack(s.from)).toMatchObject({ status: 'uncertain' });
      const result = await s.rack(s.from); expect(result.status).toBe('taken'); if (result.status !== 'taken') throw new Error('No recovered rod');
      expect(await s.items.list(s.owner.personId, s.kingdomId)).toHaveLength(1);
      expect(await s.items.history(result.item.id)).toHaveLength(1);
      expect((await pool.query('SELECT 1 FROM realm_item_grants WHERE kingdom_id=$1', [s.kingdomId])).rowCount).toBe(1);
    } finally { await s.hold.release(); }
  }, 30_000);
});
