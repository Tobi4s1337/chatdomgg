import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, PRESENCE_LEASE_MS, type KingdomId, type PresenceInput } from '@chatdom/shared';
import { generateSettlementPlan, type SettlementPlan } from '@chatdom/world';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { AllocationService, TenureEvidenceVerifier } from '../../allocation';
import { createRealmCitizens } from '../../evening/citizens';
import { createRealmCastle } from '../../evening/castle';
import { FileFoundedStore } from '../../founded';
import { PostgresOutboxStore } from '../../outbox';
import { createDurableRealmServices, createRealmPool, migrateRealmSchema, PostgresRealmRepository } from '../../persistence';
import { RealmIngress } from '../service';
import { RealmPanelService } from './service';

const origin = 'simulated' as const;
const enabled = process.env.REALM_DATABASE_TESTS === '1';

describe.runIf(enabled)('durable window presence by source', () => {
  const schema = `panel_window_test_${randomBytes(6).toString('hex')}`;
  const secret = randomBytes(32).toString('hex'), herald = randomBytes(32).toString('hex');
  const names = new Map<KingdomId, string>(), plans = new Map<KingdomId, SettlementPlan>();
  let db: ReturnType<typeof createRealmPool>;
  let services: ReturnType<typeof createDurableRealmServices>;
  let ingress: RealmIngress;
  let panel: RealmPanelService;
  let allocation: AllocationService;
  let directory: string;
  let nextId = 951_000_000;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires the isolated development DATABASE_URL.');
    const url = new URL(process.env.DATABASE_URL);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '5410') throw new Error('Panel database tests run only on development Postgres port 5410.');
    db = createRealmPool({ connectionString: url.toString(), schema });
    await migrateRealmSchema(db, schema);
    directory = await mkdtemp(join(tmpdir(), 'panel-presence-'));
    const key = randomBytes(32);
    const castle = createRealmCastle({ origin, kingdomNames: names, safetyKey: key });
    const citizens = createRealmCitizens({ db, origin, kingdomNames: names });
    allocation = new AllocationService(db, { origin, verifier: new TenureEvidenceVerifier(origin, key), furnish: citizens.furnish });
    ingress = new RealmIngress(db, origin, { panel: secret, herald });
    services = createDurableRealmServices({ repository: new PostgresRealmRepository(db, { origin, guards: [castle.guard] }), outbox: new PostgresOutboxStore(db),
      auth: { authenticate: async () => { throw new Error('No socket authentication in this test'); }, current: async () => false },
      kingdom: kingdomId => ({ world: REFERENCE_WORLD, layoutRevision: plans.get(kingdomId)!.revision, spawn: () => [0, 0, 6] }),
      afterOpen: kingdom => citizens.recover(kingdom), attach: kingdom => ingress.attach(kingdom) });
    citizens.use(allocation, services); ingress.use(services);
    castle.use(allocation, new FileFoundedStore(directory));
    panel = new RealmPanelService({ db, origin, secret, allocation, citizens, services, castle: (kingdom, personId, name) => castle.observe(kingdom, personId, name) });
  });
  afterAll(async () => {
    await ingress?.stop();
    if (services) await Promise.all([...services.kingdoms.values()].map(kingdom => kingdom.dispose()));
    if (db) { try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.end(); } }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function observe(kingdomId: KingdomId, service: 'herald' | 'panel', input: Omit<PresenceInput, 'version' | 'id' | 'kingdomId' | 'origin' | 'observedAt'> & Record<string, unknown>) {
    const now = Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now')).rows[0].now);
    const id = `presence-test-${randomBytes(8).toString('hex')}`;
    expect(await ingress.accept(`Bearer ${service === 'panel' ? secret : herald}`, { version: 1,
      observation: { version: 1, id, kingdomId, origin, observedAt: now, ...input } })).toMatchObject({ http: 202, body: { status: 'accepted' } });
    await expect.poll(async () => Number((await db.query('SELECT count(*) AS n FROM realm_ingress_receipts WHERE kingdom_id = $1 AND source = $2 AND observation_id = $3', [kingdomId, service, id])).rows[0].n), { timeout: 4_000 }).toBe(1);
  }

  for (const source of ['chat', 'panel', 'walker'] as const) {
    it(`${source} lights a claimed window within five seconds and the absent lease expires`, async () => {
      const kingdomId = KingdomIdSchema.parse(String(++nextId)), personId = PersonIdSchema.parse(String(++nextId));
      const name = 'SIMULATED Presence';
      const plan = generateSettlementPlan({ seed: `presence-${kingdomId}`, tier: 'hamlet', firstYear: 2026, year: 2026 });
      plans.set(kingdomId, plan); names.set(kingdomId, 'SIMULATED Kingdom');
      expect(await allocation.adoptLayout(kingdomId, plan)).toMatchObject({ status: 'founded' });
      expect(await panel.claim(`Bearer ${secret}`, { kingdomId, personId, name })).toMatchObject({ body: { status: 'deed' } });
      const hold = await services.retain(kingdomId);
      try {
        await observe(kingdomId, 'herald', { kind: 'stream', live: true, sessionId: `presence-night-${kingdomId}` });
        expect(await panel.presence(`Bearer ${secret}`, { kingdomId, personId })).toMatchObject({ body: { lit: false, stream: 'live' } });
        // Walker observations intentionally lag the database clock by 500 ms.
        if (source === 'walker') await new Promise(resolve => setTimeout(resolve, 650));
        const start = performance.now();
        if (source === 'walker') {
          const principal = { personId, kingdomId, origin, sessionId: `walker-${personId}`, expiresAt: Date.now() + 300_000, publicName: name, look: 'tide' as const };
          hold.kingdom.lifecycle('join', principal, principal.sessionId, Date.now());
          await expect.poll(async () => (await panel.presence(`Bearer ${secret}`, { kingdomId, personId })).body, { timeout: 4_500, interval: 50 }).toMatchObject({ lit: true, stream: 'live' });
          hold.kingdom.lifecycle('leave', principal, principal.sessionId, Date.now());
        } else {
          await observe(kingdomId, source === 'chat' ? 'herald' : 'panel', { kind: 'observe', source, coverage: 'activity', people: [{ personId, disclosure: 'named', displayName: name }] });
          await expect.poll(async () => (await panel.presence(`Bearer ${secret}`, { kingdomId, personId })).body, { timeout: 4_500, interval: 50 }).toMatchObject({ lit: true, stream: 'live' });
        }
        expect(performance.now() - start).toBeLessThan(5_000);
        expect(await panel.kingdom(`Bearer ${secret}`, { kingdomId })).toMatchObject({ body: { lights: 1, presence: { windows: [{ present: true, publicName: name }] } } });
        // Advance the reader's authoritative database-clock estimate, not the panel's timer or source evidence.
        const clock = vi.spyOn(hold.kingdom, 'databaseNow').mockReturnValue(hold.kingdom.databaseNow() + PRESENCE_LEASE_MS + 1_000);
        try {
          expect(await panel.presence(`Bearer ${secret}`, { kingdomId, personId })).toMatchObject({ body: { lit: false, stream: 'live' } });
          expect(await panel.kingdom(`Bearer ${secret}`, { kingdomId })).toMatchObject({ body: { lights: 0 } });
        } finally { clock.mockRestore(); }
      } finally { await hold.release(); }
    }, 20_000);
  }
});
