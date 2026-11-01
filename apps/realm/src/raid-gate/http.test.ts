import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrateRealmSchema } from '../persistence/migrate';
import { createRaidShowService, RAID_OBSERVATION_BODY_LIMIT } from './http';

const now = 1_800_000_000_000;
const secret = 'h'.repeat(40), panel = 'p'.repeat(40);
const raid = { version: 1, id: 'http-raid', origin: 'simulated', kingdomId: '202', direction: 'incoming',
  occurredAt: now - 1000, receivedAt: now, from: { kingdomId: '101', login: 'visitor', name: 'Visitor' },
  to: { kingdomId: '202', login: 'host', name: 'Host' }, viewers: 3 };
const route = 'http://realm.test/internal/realm/raid-gate/observe';

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('raid show HTTP boundaries on isolated Postgres', () => {
  const schema = `realm_test_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pool: pg.Pool, service: ReturnType<typeof createRaidShowService>;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL');
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await migrateRealmSchema(admin, schema);
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: `-c search_path="${schema}"` });
    service = createRaidShowService({ pool, origin: 'simulated', clock: () => now, credentials: { herald: secret, panel }, recoverEveryMs: 0,
      moment: async () => ({ http: 202, body: { status: 'accepted' } }) });
  });
  afterAll(async () => { await service?.close(); await pool?.end(); if (admin) { await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); } });
  const post = (body: string, authorization = `Bearer ${secret}`, extra: Record<string, string> = {}) =>
    service.handle(new Request(route, { method: 'POST', headers: { authorization, 'content-type': 'application/json', ...extra }, body }));

  it('admits only Herald and records exactly once; changed facts conflict', async () => {
    const body = JSON.stringify({ version: 1, raid });
    expect((await post(body, '')).status).toBe(401);
    expect((await post(body, `Bearer ${panel}`)).status).toBe(401);
    const first = await post(body);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ version: 1, status: 'accepted' });
    expect(await (await post(body)).json()).toEqual({ version: 1, status: 'duplicate' });
    expect((await post(JSON.stringify({ version: 1, raid: { ...raid, viewers: 4 } }))).status).toBe(409);
    expect((await post(JSON.stringify({ version: 1, raid: { ...raid, origin: 'live' } }))).status).toBe(403);
    const feed = await service.handle(new Request('http://realm.test/realm/raid-roads'));
    expect((await feed.json()).items).toHaveLength(1);
  });

  it('coalesces recovery wakes and waits for the active recovery during close', async () => {
    const local = createRaidShowService({ pool, origin: 'simulated', clock: () => now, credentials: { herald: secret }, recoverEveryMs: 0,
      moment: async () => ({ http: 202, body: { status: 'accepted' } }) });
    let release!: (value: { delivered: number; expired: number; waiting: number }) => void;
    const blocked = new Promise<{ delivered: number; expired: number; waiting: number }>(resolve => { release = resolve; });
    const recover = vi.spyOn(local.ledger, 'recover').mockReturnValue(blocked);
    const send = () => local.handle(new Request(route, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, raid: { ...raid, id: 'wake-test' } }) }));
    try {
      expect((await send()).status).toBe(202);
      expect((await send()).status).toBe(202);
      expect(recover).toHaveBeenCalledTimes(1);
      let closed = false;
      const closing = local.close().then(() => { closed = true; });
      await Promise.resolve();
      expect(closed).toBe(false);
      release({ delivered: 0, expired: 0, waiting: 0 });
      await closing;
      expect(closed).toBe(true);
    } finally { release({ delivered: 0, expired: 0, waiting: 0 }); await local.close(); }
  });

  it('drains an accepted in-flight observation before close resolves', async () => {
    const local = createRaidShowService({ pool, origin: 'simulated', clock: () => now, credentials: { herald: secret }, recoverEveryMs: 0,
      moment: async () => ({ http: 202, body: { status: 'accepted' } }) });
    let release!: () => void, started!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const record = local.ledger.record.bind(local.ledger);
    vi.spyOn(local.ledger, 'record').mockImplementation(async input => { started(); await barrier; return record(input); });
    const sending = local.handle(new Request(route, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, raid: { ...raid, id: 'drain-test' } }) }));
    try {
      await entered;
      let closed = false;
      const closing = local.close().then(() => { closed = true; });
      await Promise.resolve(); await Promise.resolve();
      expect(closed).toBe(false);
      release();
      expect((await sending).status).toBe(202);
      await closing;
      expect(closed).toBe(true);
      expect((await pool.query('select event_id from realm_raid_observations where event_id = $1', ['drain-test'])).rowCount).toBe(1);
    } finally { release(); await sending; await local.close(); }
  });

  it('rejects malformed or oversized requests and strict query violations', async () => {
    expect((await post('{')).status).toBe(400);
    expect((await post(JSON.stringify({ version: 1, raid: { ...raid, people: ['101'] } }))).status).toBe(400);
    expect((await post('{}', `Bearer ${secret}`, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post('x'.repeat(RAID_OBSERVATION_BODY_LIMIT + 1))).status).toBe(400);
    expect((await post('{}', `Bearer ${secret}`, { 'content-length': String(RAID_OBSERVATION_BODY_LIMIT + 1) })).status).toBe(413);
    for (const query of ['?limit=0', '?limit=201', '?limit=1&limit=2', '?other=1', '?after=live:1']) {
      expect((await service.handle(new Request(`http://realm.test/realm/raid-roads${query}`))).status, query).toBe(400);
    }
    expect((await service.handle(new Request('http://realm.test/realm/raid-pennants/202?limit=65'))).status).toBe(400);
  });
});
