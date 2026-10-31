import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KingdomIdSchema } from '@chatdom/shared';
import { momentRepository } from '../../../herald/src/twitch-moments/records';
import type { MomentRecordPort } from '../../../herald/src/twitch-moments/ports';
import { createRealmPool, RealmCommitUncertainError, RealmWriterFencedError, type RealmDatabase } from '../persistence/database';
import { migrateRealmSchema } from '../persistence/migrate';
import { PostgresRealmRepository } from '../persistence/postgres-repository';
import { createPostgresMomentRecords } from './records';

const schema = `moment_test_${randomBytes(6).toString('hex')}`;
let db: pg.Pool;

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('durable moment records (Postgres)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL.');
    db = createRealmPool({ connectionString: process.env.DATABASE_URL, schema });
    expect(await migrateRealmSchema(db, schema)).toContain('0008_realm_moments');
  });
  afterAll(async () => {
    if (db) { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.end(); }
  });

  it('claims survive recreation; facts/current/outbox commit together, rollback and stale epochs publish nothing', async () => {
    const kingdomId = KingdomIdSchema.parse('987654321');
    const repository = new PostgresRealmRepository(db, { origin: 'simulated' });
    const lease = await repository.acquire(kingdomId);
    // A moment is delivered at the current domain sequence; it never consumes a domain sequence.
    await db.query('UPDATE realm_kingdoms SET sequence = 41 WHERE kingdom_id = $1', [kingdomId]);
    const port = () => createPostgresMomentRecords(db, lease, 'simulated', () => true);
    const now = Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now')).rows[0].now);
    const clocks = { occurredAt: now, receivedAt: now };
    const body = { kind: 'ad' as const, key: 'ad:1', displayUntil: now + 300_000, endsAt: now + 60_000 };
    const deliver = (records: MomentRecordPort, delivery = 'delivery:1') => records.transact(kingdomId, async tx => {
      const r = momentRepository(tx);
      if (!await r.claimDelivery(delivery)) return false;
      const first = await tx.appendFact(body, clocks, { kind: 'external', source: 'eventsub', id: delivery }, 'simulated');
      await r.setCurrent(first);
      const second = await tx.appendFact({ ...body, endsAt: now + 120_000 }, clocks, { kind: 'external', source: 'eventsub', id: delivery }, 'simulated');
      await r.setCurrent(second);
      return true;
    });
    expect(await deliver(port())).toBe(true);
    expect(await deliver(port())).toBe(false);
    const checkpoint = await port().transact(kingdomId, async tx => {
      const r = momentRepository(tx);
      return { throughSeq: await r.watermark(), facts: await r.currentFacts() };
    });
    expect(checkpoint.throughSeq).toBe(2);
    expect(checkpoint.facts).toMatchObject([{ seq: 2, origin: 'simulated', actor: null }]);
    const rows = (await db.query('SELECT sequence, event_id, message FROM realm_outbox ORDER BY id')).rows;
    expect(rows.map(row => [row.sequence, row.event_id, JSON.parse(row.message).current])).toEqual([
      ['41', `${kingdomId}:m:1`, false], ['41', `${kingdomId}:m:2`, true],
    ]);
    expect((await db.query('SELECT sequence FROM realm_kingdoms')).rows).toEqual([{ sequence: '41' }]);

    await expect(port().transact(kingdomId, async tx => {
      const r = momentRepository(tx);
      await r.claimDelivery('rollback');
      const fact = await tx.appendFact(body, clocks, { kind: 'external', source: 'eventsub', id: 'rollback' }, 'simulated');
      await r.setCurrent(fact);
      throw new Error('roll back all writes');
    })).rejects.toThrow('roll back all writes');
    expect(await port().transact(kingdomId, tx => tx.get('twitch-moments:delivery:rollback'))).toBeUndefined();
    for (const table of ['realm_moment_facts', 'realm_outbox']) expect(Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n)).toBe(2);

    // Cancellation after work must roll back claims as well as facts and the current checkpoint.
    let current = true;
    const cancel = createPostgresMomentRecords(db, lease, 'simulated', () => current);
    await expect(cancel.transact(kingdomId, async tx => { await tx.claim('twitch-moments:delivery:canceled'); current = false; })).rejects.toBeInstanceOf(RealmWriterFencedError);
    expect(await port().transact(kingdomId, tx => tx.get('twitch-moments:delivery:canceled'))).toBeUndefined();
    await expect(port().transact(kingdomId, tx => tx.put('twitch-moments:watermark', { version: 1, throughSeq: 2, providerBody: 'private' }))).rejects.toThrow();
    await expect(port().transact(kingdomId, tx => tx.put('outside:watermark', {}))).rejects.toThrow();

    // Lose the reply after the server committed, then recreate the port and retry the SAME delivery claim.
    let loseReply = true;
    const uncertainDb: RealmDatabase = {
      query: db.query.bind(db),
      connect: async () => {
        const client = await db.connect();
        return new Proxy(client, { get(target, property) {
          if (property === 'query') return async (...args: Parameters<pg.PoolClient['query']>) => {
            const result = await Reflect.apply(target.query, target, args);
            if (args[0] === 'COMMIT' && loseReply) { loseReply = false; throw new Error('lost commit reply'); }
            return result;
          };
          const value: unknown = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      },
    };
    await expect(deliver(createPostgresMomentRecords(uncertainDb, lease, 'simulated', () => true), 'uncertain')).rejects.toBeInstanceOf(RealmCommitUncertainError);
    expect(await deliver(port(), 'uncertain')).toBe(false);
    expect(Number((await db.query('SELECT count(*) AS n FROM realm_moment_facts')).rows[0].n)).toBe(4);
    await repository.release(lease);
    const replacement = await repository.acquire(kingdomId);
    await expect(deliver(port(), 'stale')).rejects.toBeInstanceOf(RealmWriterFencedError);
    await expect(createPostgresMomentRecords(db, replacement, 'live', () => true).transact(kingdomId, async () => true)).rejects.toBeInstanceOf(RealmWriterFencedError);
    expect(Number((await db.query('SELECT count(*) AS n FROM realm_outbox')).rows[0].n)).toBe(4);
    await repository.release(replacement);
  }, 15_000);
});
