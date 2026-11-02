import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RaidObservationSchema } from '../../../api/src/raid-gate/observations';
import { raidWelcomePath } from '../../../api/src/raid-gate/guest-contracts';
import { migrateRealmSchema } from '../persistence/migrate';
import { RaidCrierAuthority } from './crier';
import { RaidObservationLedger } from './observations';

const start = 1_800_000_000_000;
describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('durable raid crier on isolated Postgres', () => {
  const schema = `realm_test_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pool: pg.Pool, now = start;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL');
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    expect(await migrateRealmSchema(admin, schema)).toContain('0011c_realm_raid_crier');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: `-c search_path="${schema}"` });
  });
  afterAll(async () => { await pool?.end(); if (admin) { await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); } });
  const authority = () => new RaidCrierAuthority({ pool, origin: 'simulated', clock: () => now, publicOrigin: 'https://chatdom.gg' });
  const ledger = () => new RaidObservationLedger({ pool, origin: 'simulated', clock: () => now,
    moment: async () => ({ http: 202, body: { status: 'accepted' } }) });
  const request = (kingdomId: string, senderId = '999') => ({ version: 1, origin: 'simulated', kingdomId, senderId });
  const record = (id: string, kingdomId: string, overrides: Record<string, unknown> = {}) => ledger().record(RaidObservationSchema.parse({
    version: 1, id, origin: 'simulated', direction: 'incoming', kingdomId, occurredAt: now, receivedAt: now,
    from: { kingdomId: '101', login: 'raider', name: 'Raider' }, to: { kingdomId, login: 'host', name: 'Host' }, viewers: 3, ...overrides,
  }));

  it('recovers claimed and queued jobs at their independent deadlines without polling', async () => {
    await record('recovery-claimed', '901');
    expect(await authority().claim(request('901'))).not.toBeNull();
    await record('recovery-queued', '902');
    now += 14_999;
    expect(await authority().recover()).toEqual({ expired: 0, unknown: 0 });
    now += 1;
    expect(await authority().recover()).toEqual({ expired: 0, unknown: 1 });
    now += 44_999;
    expect(await authority().recover()).toEqual({ expired: 0, unknown: 0 });
    now += 1;
    expect(await authority().recover()).toEqual({ expired: 1, unknown: 0 });
    const result = await pool.query('select event_id, state, outcome from realm_raid_crier_jobs where event_id = any($1) order by event_id', [['recovery-claimed', 'recovery-queued']]);
    expect(result.rows).toEqual([{ event_id: 'recovery-claimed', state: 'unknown', outcome: null }, { event_id: 'recovery-queued', state: 'expired', outcome: null }]);
  });

  it.each([{ status: 'refused', code: 'denied' }, { status: 'sent', messageId: 'late-ack' }] as const)('accepts a late $status receipt for an auto-aged unknown without a resend', async outcome => {
    const kingdom = outcome.status === 'sent' ? '904' : '903', eventId = `late-${outcome.status}`;
    await record(eventId, kingdom);
    const claim = (await authority().claim(request(kingdom)))!;
    now += 15_000;
    expect(await authority().recover()).toMatchObject({ unknown: 1 });
    const receipt = { ...request(kingdom), claimId: claim.claimId, outcome };
    expect(await authority().receipt(receipt)).toBe('accepted');
    expect(await authority().receipt(receipt)).toBe('duplicate');
    expect(await authority().claim(request(kingdom))).toBeNull();
    const row = await pool.query('select state, outcome from realm_raid_crier_jobs where event_id = $1', [eventId]);
    expect(row.rows[0]).toEqual({ state: outcome.status, outcome: JSON.stringify(receipt.outcome) });
  });

  it('claims a witnessed raid once across concurrency, restart and receipt retry', async () => {
    const event = await record('welcome-once', '201');
    expect((await record('welcome-once', '201')).status).toBe('duplicate');
    const [a, b] = await Promise.all([authority().claim(request('201')), authority().claim(request('201'))]);
    const claims = [a, b].filter(claim => claim !== null);
    expect(claims).toHaveLength(1);
    const claim = claims[0]!;
    expect(claim).toMatchObject({ raidId: event.raidId, kingdomId: '201', senderId: '999' });
    expect(claim.text).toContain('Raider'); expect(claim.text).toContain(raidWelcomePath('201', event.raidId));
    expect(await authority().claim(request('201'))).toBeNull();
    const receipt = { ...request('201'), claimId: claim.claimId, outcome: { status: 'sent', messageId: 'chat-ack' } };
    expect(await authority().receipt(receipt)).toBe('accepted');
    expect(await authority().receipt(receipt)).toBe('duplicate');
    await expect(authority().receipt({ ...receipt, outcome: { status: 'refused', code: 'denied' } })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(authority().receipt({ ...receipt, senderId: '998' })).rejects.toMatchObject({ kind: 'conflict' });
  });
  it('retains rare default and silent CAS across restart without replaying suppressed raids', async () => {
    const crier = authority();
    expect(await crier.setting('202')).toMatchObject({ mode: 'rare', revision: 0 });
    expect(await crier.configure('202', 'silent', 0)).toMatchObject({ mode: 'silent', revision: 1 });
    await expect(crier.configure('202', 'herald', 0)).rejects.toMatchObject({ kind: 'conflict' });
    await record('silent', '202');
    expect(await authority().setting('202')).toMatchObject({ mode: 'silent', revision: 1 });
    await authority().configure('202', 'rare', 1);
    expect(await authority().claim(request('202'))).toBeNull();
    await record('after-silent', '202');
    expect((await authority().claim(request('202')))?.text).toContain('Raider');
  });
  it('does not send for outgoing, tiny or stale raids and never retries refused or uncertain sends', async () => {
    await record('tiny', '203', { viewers: 2 });
    await record('outgoing', '203', { direction: 'outgoing', from: { kingdomId: '203', login: 'host', name: 'Host' }, to: { kingdomId: '101', login: 'raider', name: 'Raider' } });
    await record('stale', '203', { occurredAt: now - 60_000 });
    expect(await authority().claim(request('203'))).toBeNull();
    await record('refused', '203');
    const claim = (await authority().claim(request('203')))!;
    expect(await authority().receipt({ ...request('203'), claimId: claim.claimId, outcome: { status: 'refused', code: 'denied' } })).toBe('accepted');
    now += 65_001;
    expect(await authority().claim(request('203'))).toBeNull();
    await record('uncertain', '203');
    const uncertain = (await authority().claim(request('203')))!;
    now += 65_001;
    expect(await authority().claim(request('203'))).toBeNull();
    const row = await pool.query<{ state: string }>('select state from realm_raid_crier_jobs where event_id = $1', ['uncertain']);
    expect(row.rows[0]?.state).toBe('unknown');
    expect(await authority().receipt({ ...request('203'), claimId: uncertain.claimId, outcome: { status: 'unknown' } })).toBe('accepted');
    expect(await authority().receipt({ ...request('203'), claimId: uncertain.claimId, outcome: { status: 'unknown' } })).toBe('duplicate');
  });
  it('limits one attempt per minute and six per rolling hour', async () => {
    for (let i = 0; i < 6; i++) {
      await record(`rate-${i}`, '204');
      expect(await authority().claim(request('204'))).not.toBeNull();
      if (i === 0) { await record('rate-blocked-minute', '204'); expect(await authority().claim(request('204'))).toBeNull(); }
      now += 65_001;
    }
    await record('rate-seventh', '204');
    expect(await authority().claim(request('204'))).toBeNull();
    now += 3_605_001;
    await record('rate-after-hour', '204');
    expect(await authority().claim(request('204'))).not.toBeNull();
  });
  it('limits one bot to twenty attempts across kingdoms per rolling window', async () => {
    for (let i = 0; i < 20; i++) {
      const kingdom = String(300 + i);
      await record(`global-${i}`, kingdom);
      expect(await authority().claim(request(kingdom, '888'))).not.toBeNull();
    }
    await record('global-blocked', '400');
    expect(await authority().claim(request('400', '888'))).toBeNull();
    now += 35_001;
    expect(await authority().claim(request('400', '888'))).not.toBeNull();
  });
});
