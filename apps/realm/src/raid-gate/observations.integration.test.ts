import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema } from '../../../../packages/shared/src/identity';
import type { RealmMomentObservation } from '@chatdom/shared/realm';
import { RaidObservationSchema } from '../../../api/src/raid-gate/observations';
import { migrateRealmSchema } from '../persistence/migrate';
import { RaidObservationLedger } from './observations';

const now = 1_800_000_000_000;
const from = { kingdomId: '101', login: 'visitor', name: 'Visitor' };
const to = { kingdomId: '202', login: 'host', name: 'Host' };
const observation = (id: string, overrides: Record<string, unknown> = {}) => RaidObservationSchema.parse({
  version: 1, id, origin: 'simulated', kingdomId: to.kingdomId, direction: 'incoming',
  occurredAt: now - 1_000, receivedAt: now, from, to, viewers: 140, ...overrides,
});

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('raid observation ledger on isolated Postgres', () => {
  const schema = `realm_test_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pool: pg.Pool;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL');
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await migrateRealmSchema(admin, schema);
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: `-c search_path="${schema}"` });
  });
  afterAll(async () => { await pool?.end(); if (admin) { await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); } });

  it('persists one observation on concurrent retries and rejects changed facts, including after restart', async () => {
    const moment = vi.fn<(value: RealmMomentObservation) => Promise<{ http: number; body: { status: string } }>>(async () => ({ http: 202, body: { status: 'accepted' } }));
    const boot = () => new RaidObservationLedger({ pool, origin: 'simulated', clock: () => now, moment });
    const ledger = boot(), raid = observation('concurrent');
    const results = await Promise.all([ledger.record(raid), ledger.record(raid)]);
    expect(results.map(r => r.status).sort()).toEqual(['accepted', 'duplicate']);
    expect(await boot().record({ ...raid, receivedAt: now + 100 })).toMatchObject({ status: 'duplicate', raidId: results[0]!.raidId });
    await expect(boot().record({ ...raid, viewers: 141 })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await boot().page()).items.filter(item => item.id === results[0]!.raidId)).toHaveLength(1);
  });

  it('retains late raids as roads and pennants but never delivers their stale beat', async () => {
    const moment = vi.fn<(value: RealmMomentObservation) => Promise<{ http: number; body: { status: string } }>>(async () => ({ http: 202, body: { status: 'accepted' } }));
    const ledger = new RaidObservationLedger({ pool, origin: 'simulated', clock: () => now, moment });
    const result = await ledger.record(observation('late', { occurredAt: now - 60_000, receivedAt: now }));
    await ledger.recover();
    expect(moment.mock.calls.some(([value]) => value.id === 'late')).toBe(false);
    expect((await ledger.page()).items.map(item => item.id)).toContain(result.raidId);
    expect(await ledger.pennants(KingdomIdSchema.parse('202'))).toContainEqual({ raidId: result.raidId, from, occurredAt: now - 60_000 });
  });

  it('selects incoming history by destination and origin in commit order, including late visits after restart', async () => {
    const moment = async () => ({ http: 202, body: { status: 'accepted' } });
    const boot = (origin: 'live' | 'simulated') => new RaidObservationLedger({ pool, origin, clock: () => now, moment });
    const sim = boot('simulated');
    const first = await sim.record(observation('wall-first', { occurredAt: now - 1000 }));
    const late = await sim.record(observation('wall-late', { occurredAt: now - 365 * 86400_000 }));
    await sim.record(observation('wall-late', { occurredAt: now - 365 * 86400_000 }));
    await sim.record(observation('wall-outgoing', { direction: 'outgoing', kingdomId: '101' }));
    await boot('live').record(observation('wall-live', { origin: 'live' }));
    const restarted = boot('simulated');
    const history = await restarted.pennants(KingdomIdSchema.parse('202'), 2);
    expect(history.map(item => item.raidId)).toEqual([late.raidId, first.raidId]);
    expect(history[0]!.occurredAt).toBe(now - 365 * 86400_000);
    expect((await restarted.pennants(KingdomIdSchema.parse('101'))).map(item => item.raidId)).not.toContain(late.raidId);
    expect((await boot('live').pennants(KingdomIdSchema.parse('202'))).map(item => item.raidId)).not.toContain(late.raidId);
    expect(await restarted.pennants(KingdomIdSchema.parse('202'), 1)).toEqual([history[0]]);
  });

  it('keeps a tolerated future provider timestamp stable across redelivery and restart', async () => {
    const moment = async () => ({ http: 202, body: { status: 'accepted' } });
    const first = new RaidObservationLedger({ pool, origin: 'live', clock: () => now, moment });
    const raid = observation('provider-skew', { origin: 'live', occurredAt: now + 2_000 });
    const accepted = await first.record(raid);
    const restarted = new RaidObservationLedger({ pool, origin: 'live', clock: () => now + 3_000, moment });
    expect(await restarted.record({ ...raid, receivedAt: now + 3_000 })).toMatchObject({ status: 'duplicate', raidId: accepted.raidId });
    const road = (await restarted.page()).items.find(item => item.id === accepted.raidId);
    expect(road).toMatchObject({ occurredAt: now + 2_000, observedAt: now });
    expect(await restarted.recover()).toMatchObject({ waiting: 0 });
  });

  it('retries a lost acknowledgement with the same event ID and coalesces simultaneous recovery', async () => {
    let current = now, calls = 0;
    const received: string[] = [];
    const moment = async (value: { id: string }) => { received.push(value.id); if (++calls === 1) throw new Error('lost acknowledgement'); return { http: 202, body: { status: 'duplicate' } }; };
    const boot = () => new RaidObservationLedger({ pool, origin: 'live', clock: () => current, moment });
    let ledger = boot();
    await ledger.record(observation('lost-ack', { origin: 'live' }));
    expect(await ledger.recover()).toEqual({ delivered: 0, expired: 0, waiting: 1 });
    current += 1000; ledger = boot();
    const [first, second] = await Promise.all([ledger.recover(), ledger.recover()]);
    expect(first).toEqual({ delivered: 1, expired: 0, waiting: 0 });
    expect(second).toEqual(first);
    expect(received).toEqual(['lost-ack', 'lost-ack']);
    expect(await boot().recover()).toEqual({ delivered: 0, expired: 0, waiting: 0 });
  });

  it('isolates origins and resumes the feed in commit order with a durable tail cursor', async () => {
    const moment = async () => ({ http: 202, body: { status: 'accepted' } });
    const live = new RaidObservationLedger({ pool, origin: 'live', clock: () => now, moment });
    const sim = new RaidObservationLedger({ pool, origin: 'simulated', clock: () => now, moment });
    await expect(live.record(observation('wrong-origin'))).rejects.toMatchObject({ kind: 'origin' });
    const tail = (await live.page()).next;
    const a = await live.record(observation('feed-a', { origin: 'live' }));
    const b = await live.record(observation('feed-b', { origin: 'live' }));
    const first = await live.page(tail, 1);
    const second = await live.page(first.next, 1);
    expect(first.items.map(item => item.id)).toEqual([a.raidId]);
    expect(second.items.map(item => item.id)).toEqual([b.raidId]);
    expect(await live.page(second.next)).toEqual({ version: 1, items: [], next: second.next });
    await expect(sim.page(second.next)).rejects.toMatchObject({ kind: 'invalid' });
    expect((await sim.page()).items.map(item => item.id)).not.toContain(a.raidId);
  });
});
