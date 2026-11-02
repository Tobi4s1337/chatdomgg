import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RAID_CRIER_CLAIM_ROUTE, RAID_CRIER_RECEIPT_ROUTE } from '../../../api/src/raid-gate/crier-contracts';
import { RaidObservationSchema } from '../../../api/src/raid-gate/observations';
import { migrateRealmSchema } from '../persistence/migrate';
import { RaidCrierAuthority } from './crier';
import { createRaidCrierService, RAID_CRIER_BODY_LIMIT } from './crier-http';
import { RaidObservationLedger } from './observations';

const now = 1_800_000_000_000, secret = 'h'.repeat(40), panel = 'p'.repeat(40);
describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('private crier HTTP on isolated Postgres', () => {
  const schema = `realm_test_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pool: pg.Pool, service: ReturnType<typeof createRaidCrierService>;
  const body = { version: 1, origin: 'simulated', kingdomId: '202', senderId: '999' };
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL');
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL }); await migrateRealmSchema(admin, schema);
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path="${schema}"` });
    service = createRaidCrierService({ authority: new RaidCrierAuthority({ pool, origin: 'simulated', publicOrigin: 'https://chatdom.gg', clock: () => now }),
      origin: 'simulated', credentials: { herald: secret, panel } });
  });
  afterAll(async () => { await service?.close(); await pool?.end(); if (admin) { await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); } });
  const post = (path: string, value: unknown, token = secret, headers: Record<string, string> = {}) => service.handle(new Request(`http://realm.test${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(value),
  }));
  it('refuses panel, malformed bodies, wrong origin and bot impersonating broadcaster', async () => {
    expect((await post(RAID_CRIER_CLAIM_ROUTE, body, panel)).status).toBe(401);
    expect((await post(RAID_CRIER_CLAIM_ROUTE, body, 'wrong')).status).toBe(401);
    expect((await post(RAID_CRIER_CLAIM_ROUTE, { ...body, origin: 'live' })).status).toBe(403);
    expect((await post(RAID_CRIER_CLAIM_ROUTE, { ...body, senderId: '202' })).status).toBe(400);
    expect((await post(RAID_CRIER_CLAIM_ROUTE, { ...body, extra: 1 })).status).toBe(400);
    expect((await post(`${RAID_CRIER_CLAIM_ROUTE}?x=1`, body)).status).toBe(400);
    expect((await post(RAID_CRIER_CLAIM_ROUTE, body, secret, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post(RAID_CRIER_CLAIM_ROUTE, { ...body, padding: 'x'.repeat(RAID_CRIER_BODY_LIMIT) })).status).toBe(413);
  });
  it('claims real ledger evidence and rejects forged or conflicting receipts', async () => {
    const ledger = new RaidObservationLedger({ pool, origin: 'simulated', clock: () => now, moment: async () => ({ http: 202, body: { status: 'accepted' } }) });
    await ledger.record(RaidObservationSchema.parse({ version: 1, id: 'http-welcome', origin: 'simulated', direction: 'incoming', kingdomId: '202',
      occurredAt: now, receivedAt: now, from: { kingdomId: '101', login: 'raider', name: 'Raider' },
      to: { kingdomId: '202', login: 'host', name: 'Host' }, viewers: 3 }));
    const response = await post(RAID_CRIER_CLAIM_ROUTE, body);
    expect(response.status).toBe(200);
    const { claim } = await response.json();
    expect(claim).toMatchObject({ kingdomId: '202', senderId: '999' });
    const receipt = { ...body, claimId: claim.claimId, outcome: { status: 'sent', messageId: 'chat-id' } };
    expect((await post(RAID_CRIER_RECEIPT_ROUTE, { ...receipt, claimId: randomUUID() })).status).toBe(409);
    expect((await post(RAID_CRIER_RECEIPT_ROUTE, { ...receipt, senderId: '998' })).status).toBe(409);
    expect(await (await post(RAID_CRIER_RECEIPT_ROUTE, receipt)).json()).toEqual({ version: 1, status: 'accepted' });
    expect(await (await post(RAID_CRIER_RECEIPT_ROUTE, receipt)).json()).toEqual({ version: 1, status: 'duplicate' });
    expect((await post(RAID_CRIER_RECEIPT_ROUTE, { ...receipt, outcome: { status: 'unknown' } })).status).toBe(409);
  });
  it('disallows a live claim for another broadcaster', async () => {
    const live = createRaidCrierService({ authority: new RaidCrierAuthority({ pool, origin: 'live', publicOrigin: 'https://chatdom.gg', clock: () => now }),
      origin: 'live', credentials: { herald: secret } });
    try {
      const response = await live.handle(new Request(`http://realm.test${RAID_CRIER_CLAIM_ROUTE}`, { method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...body, origin: 'live' }) }));
      expect(response.status).toBe(403);
    } finally { await live.close(); }
  });
});
