import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '../../../../packages/shared/src/identity';
import migrationSql from '../../../api/src/raid-gate/realm-migration.sql?raw';
import type { GateContext } from '../../../api/src/raid-gate/contracts';
import { migrateRealmSchema } from '../persistence/migrate';
import { createRaidTravelCoordinator } from './coordinator';
import { createPostgresTravelRepository } from './postgres-repository';
import { createSimulatedRooms } from './simulated-rooms';

/**
 * The travel coordinator against real Postgres, in a random `realm_test_*` schema that is dropped afterwards. The
 * travel tables come from `realm-migration.sql` until main registers it. The room transport and march check are
 * SIMULATED.
 *   REALM_DATABASE_TESTS=1 node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run apps/realm/src/raid-gate/postgres.integration.test.ts
 */
const SOURCE = KingdomIdSchema.parse('990200101');
const MIRA = KingdomIdSchema.parse('990200201');
const WREN = PersonIdSchema.parse('990200111');

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('Raid travel on Postgres (SIMULATED rooms)', () => {
  const schema = `realm_test_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pool: pg.Pool;
  let now = Date.now();
  const clock = () => now;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 needs DATABASE_URL; load it with --env-file-if-exists=.env');
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    await migrateRealmSchema(admin, schema);
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: `-c search_path="${schema}"` });
    const registered = (await pool.query<{ present: boolean }>("select to_regclass('realm_raid_travel') is not null as present")).rows[0]!.present;
    if (!registered) await pool.query(migrationSql);
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); }
  });

  it('commits one journey once across a lost answer, and lets only one concurrent reservation through', async () => {
    const repository = createPostgresTravelRepository({ pool });
    const rooms = createSimulatedRooms({ clock, rooms: [SOURCE, MIRA] });
    let issued = 0;
    const boot = () => createRaidTravelCoordinator({
      repository, rooms: rooms.transport, origin: 'simulated', clock, tickets: () => `pg${++issued}`,
      marches: { check: async () => ({ kind: 'marching', from: SOURCE, to: MIRA, founded: true, origin: 'simulated' }) },
    });
    let coordinator = boot();
    const context = (): GateContext => ({ principal: { personId: WREN, sessionId: 's1', sourceKingdomId: SOURCE, sourceRole: 'citizen' }, now, signal: new AbortController().signal });
    const reason = { kind: 'raid', requestId: 'r1', raidId: 'simulated-raid-1' } as const;

    const raced = await Promise.all([coordinator.reserve(context(), 'a', MIRA, reason), coordinator.reserve(context(), 'b', MIRA, reason)]);
    expect(raced.filter(reply => reply.kind === 'travel')).toHaveLength(1);
    expect(raced.filter(reply => reply.kind === 'denied')).toEqual([{ kind: 'denied', code: 'stale' }]);
    const ticket = raced.find(reply => reply.kind === 'travel')!.value as { ticket: string };

    expect(await coordinator.prepare(context(), ticket.ticket)).toMatchObject({ value: { state: 'ready' } });
    rooms.loseNextCommitAnswer();
    expect(await coordinator.commit(context(), ticket.ticket)).toMatchObject({ value: { state: 'unknown' } });
    coordinator = boot();
    now += 1_000;
    expect(await coordinator.recover(now, 50)).toEqual({ expired: 0, reconciled: 1, released: 0 });
    expect(await coordinator.whereabouts(context())).toMatchObject({ value: { state: 'committed', to: MIRA, arrivalId: `arrival.${ticket.ticket}` } });
    const rows = await pool.query<{ n: string }>('select (select count(*) from realm_raid_arrivals)::text as n');
    expect(rows.rows[0]!.n).toBe('1');
    expect(rooms.calls.filter(call => call.startsWith('commit'))).toHaveLength(1);
    expect(rooms.retainedSources()).toBe(0);
  });
});
