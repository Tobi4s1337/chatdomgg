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
import { RealmPanelService, panelPledgeBand } from './service';

const enabled = process.env.REALM_DATABASE_TESTS === '1';
const origin = 'simulated' as const;
const secret = randomBytes(32).toString('hex'), herald = randomBytes(32).toString('hex');
const authorization = `Bearer ${secret}`;

it('exposes pledge counts only in bands', () => {
  expect([0, 1, 9, 10, 24, 25, 49, 50, 99, 100, 10_000].map(panelPledgeBand))
    .toEqual(['0', '1–9', '1–9', '10–24', '10–24', '25–49', '25–49', '50–99', '50–99', '100+', '100+']);
});

/** Real allocation, native furnishing, retained writer, ingress, reducer, SQL migration and public outbox.
 * Only geometry is the explicit SIMULATED reference world; no network or rendered-scene claim. */
describe.runIf(enabled)('panel realm door against isolated development Postgres', () => {
  const schema = `panel_window_test_${randomBytes(6).toString('hex')}`;
  const names = new Map<KingdomId, string>(), plans = new Map<KingdomId, SettlementPlan>();
  let db: ReturnType<typeof createRealmPool>;
  let services: ReturnType<typeof createDurableRealmServices>;
  let citizens: ReturnType<typeof createRealmCitizens>;
  let allocation: AllocationService;
  let ingress: RealmIngress;
  let panel: RealmPanelService;
  let castle: ReturnType<typeof createRealmCastle>;
  let directory: string;
  const key = randomBytes(32);
  let nextId = 941_000_000;
  const person = () => PersonIdSchema.parse(String(++nextId));

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires the isolated development DATABASE_URL.');
    const url = new URL(process.env.DATABASE_URL);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '5410') throw new Error('Panel database tests run only on development Postgres port 5410.');
    db = createRealmPool({ connectionString: url.toString(), schema });
    expect(await migrateRealmSchema(db, schema)).toContain('0012_realm_panel');
    directory = await mkdtemp(join(tmpdir(), 'panel-window-castle-'));
    castle = createRealmCastle({ origin, kingdomNames: names, safetyKey: key });
    citizens = createRealmCitizens({ db, origin, kingdomNames: names });
    allocation = new AllocationService(db, { origin, verifier: new TenureEvidenceVerifier(origin, key), furnish: citizens.furnish });
    ingress = new RealmIngress(db, origin, { panel: secret, herald });
    services = createDurableRealmServices({ repository: new PostgresRealmRepository(db, { origin, guards: [castle.guard] }), outbox: new PostgresOutboxStore(db),
      auth: { authenticate: async () => { throw new Error('SIMULATED test has no socket authentication'); }, current: async () => false },
      kingdom: kingdomId => ({ world: REFERENCE_WORLD, layoutRevision: plans.get(kingdomId)!.revision, spawn: () => [0, 0, 6] }),
      afterOpen: kingdom => citizens.recover(kingdom), attach: kingdom => ingress.attach(kingdom) });
    citizens.use(allocation, services); ingress.use(services);
    castle.use(allocation, new FileFoundedStore(directory));
    panel = makePanel();
  });
  afterAll(async () => {
    await ingress?.stop();
    if (services) await Promise.all([...services.kingdoms.values()].map(kingdom => kingdom.dispose()));
    if (db) { try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.end(); } }
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const makePanel = () => new RealmPanelService({ db, origin, secret, allocation, citizens, services, castle: (kingdom, personId, name) => castle.observe(kingdom, personId, name) });
  async function founding(id = KingdomIdSchema.parse(String(++nextId))) {
    const plan = generateSettlementPlan({ seed: `SIMULATED-panel-${id}`, tier: 'hamlet', firstYear: 2026, year: 2026 });
    plans.set(id, plan); names.set(id, 'SIMULATED Panel Kingdom');
    expect(await allocation.adoptLayout(id, plan)).toMatchObject({ status: 'founded' });
    return id;
  }
  async function observe(kingdomId: KingdomId, source: 'herald' | 'panel', input: Omit<PresenceInput, 'version' | 'id' | 'kingdomId' | 'origin' | 'observedAt'> & Record<string, unknown>) {
    const now = Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now')).rows[0].now);
    const id = `SIMULATED-panel-${randomBytes(8).toString('hex')}`;
    const response = await ingress.accept(`Bearer ${source === 'panel' ? secret : herald}`, { version: 1,
      observation: { version: 1, id, kingdomId, origin, observedAt: now, ...input } });
    expect(response).toMatchObject({ http: 202, body: { status: 'accepted' } });
    await expect.poll(async () => Number((await db.query(
      'SELECT count(*) AS n FROM realm_ingress_receipts WHERE kingdom_id = $1 AND source = $2 AND observation_id = $3', [kingdomId, source, id])).rows[0].n), { timeout: 4_000 }).toBe(1);
    return now;
  }

  it('refuses unknown services, unshared IDs, invalid names and caller-selected extra fields without writes', async () => {
    const kingdomId = await founding(), personId = person();
    expect(await panel.claim('Bearer wrong', { kingdomId, personId, name: 'SIMULATED Wren' })).toMatchObject({ http: 401 });
    expect(await panel.claim(authorization, { kingdomId, personId: 'Uopaque', name: 'SIMULATED Wren' })).toMatchObject({ http: 400 });
    expect(await panel.claim(authorization, { kingdomId, personId, name: '\u0001' })).toMatchObject({ http: 400 });
    expect(await panel.claim(authorization, { kingdomId, personId, name: 'SIMULATED Wren', months: 99 })).toMatchObject({ http: 400 });
    expect(await panel.kingdom('', { kingdomId })).toMatchObject({ http: 401 });
    expect(await panel.pledge(authorization, { kingdomId, personId, name: 'extra' })).toMatchObject({ http: 400 });
    expect(await allocation.deedIn(kingdomId, personId)).toBeNull();
    expect((await db.query('SELECT count(*) AS n FROM realm_panel_pledges')).rows[0].n).toBe('0');
    expect(new RealmPanelService({ db, origin, secret: undefined, allocation, citizens, services }).authenticate(authorization)).toBe(false);
    expect(() => new RealmPanelService({ db, origin, secret: 'short', allocation, citizens, services })).toThrow('at least 32');
  });

  it('installs through the citizens service exactly once, keeps unknown tenure unknown and reports the same place after restart', async () => {
    const kingdomId = await founding(), personId = person(), request = { kingdomId, personId, name: 'SIMULATED Wren' };
    const first = await panel.claim(authorization, request);
    expect(first).toMatchObject({ http: 200, body: { status: 'deed', home: { street: expect.any(String), place: expect.stringContaining('Number ') } } });
    expect(await makePanel().claim(authorization, request)).toEqual(first);
    const deed = await allocation.deedIn(kingdomId, personId);
    expect(deed).toMatchObject({ status: 'installed', tenure: { followYear: null, quarter: 'unknown-newest', subscriptionStep: false } });
    const hold = await services.retain(kingdomId);
    try {
      expect(Object.values(hold.kingdom.privateState.homes)).toHaveLength(1);
      expect(hold.kingdom.privateState.coals).toEqual({}); expect(hold.kingdom.privateState.rights).toEqual({});
    } finally { await hold.release(); }
    expect(await panel.kingdom(authorization, { kingdomId })).toMatchObject({ body: { publicEvent: { type: 'home', at: expect.any(Number), cursor: expect.any(Number), plotId: deed?.plotId } } });
    expect((await db.query("SELECT count(*) AS n FROM realm_facts WHERE kingdom_id = $1 AND fact::json->'body'->>'type' = 'home.installAllocated'", [kingdomId])).rows[0].n).toBe('1');
    expect((await db.query('SELECT public_name FROM realm_citizen_names WHERE person_id = $1', [personId])).rows[0].public_name).toBe('SIMULATED Wren');
    expect(JSON.stringify(first)).not.toMatch(/receipt|deedId|allocationReceipt/);
  });

  it('uses the global three-home cap and leaves the monarch castle outside it', async () => {
    const personId = person();
    for (let n = 0; n < 3; n++) expect(await panel.claim(authorization, { kingdomId: await founding(), personId, name: 'SIMULATED Traveller' }))
      .toMatchObject({ http: 200, body: { status: 'deed' } });
    const fourth = await founding();
    expect(await panel.claim(authorization, { kingdomId: fourth, personId, name: 'SIMULATED Traveller' }))
      .toMatchObject({ http: 200, body: { status: 'guest', reason: 'three-homes' } });
    const castle = await founding(KingdomIdSchema.parse(personId));
    expect(await panel.claim(authorization, { kingdomId: castle, personId, name: 'SIMULATED Traveller' })).toMatchObject({ http: 200, body: { status: 'castle' } });
    expect((await allocation.deedsOf(personId))).toHaveLength(3);
    expect(await allocation.guestIn(fourth, personId)).toMatchObject({ reason: 'three-homes' });
    const hold = await services.retain(castle);
    try { expect(hold.kingdom.privateState.castle?.ownerId).toBe(personId); }
    finally { await hold.release(); }
  }, 30_000);

  it('never founds a kingdom on claim and persists private idempotent pledges outside the home cap', async () => {
    const kingdomId = KingdomIdSchema.parse(String(++nextId)), personId = person();
    expect(await panel.claim(authorization, { kingdomId, personId, name: 'SIMULATED Settler' })).toMatchObject({ body: { status: 'unfounded' } });
    expect(await panel.kingdom(authorization, { kingdomId })).toMatchObject({ body: { status: 'unfounded', pledges: '0' } });
    expect(await panel.pledge(authorization, { kingdomId, personId })).toEqual({ http: 200, body: { version: 1, status: 'pledged', band: '1–9' } });
    expect(await makePanel().pledge(authorization, { kingdomId, personId })).toMatchObject({ body: { status: 'pledged', band: '1–9' } });
    expect((await db.query('SELECT count(*) AS n FROM realm_panel_pledges WHERE kingdom_id = $1', [kingdomId])).rows[0].n).toBe('1');
    expect((await db.query('SELECT count(*) AS n FROM realm_kingdoms WHERE kingdom_id = $1', [kingdomId])).rows[0].n).toBe('0');
    expect(await allocation.deedsOf(personId)).toHaveLength(0);
    expect(await makePanel().kingdom(authorization, { kingdomId })).toMatchObject({ body: { status: 'unfounded', pledges: '1–9' } });
  });

  it('holds moderated claims privately and confirms actual committed lights through existing panel ingress', async () => {
    const kingdomId = await founding(), personId = person(), request = { kingdomId, personId, name: 'SIMULATED Light' };
    const hold = await services.retain(kingdomId);
    try {
      await observe(kingdomId, 'herald', { kind: 'remove', personId, reason: 'ban', until: null });
      expect(await panel.claim(authorization, request)).toMatchObject({ body: { status: 'held' } });
      expect(await allocation.deedIn(kingdomId, personId)).toBeNull();
      await observe(kingdomId, 'herald', { kind: 'restore', personId });
      expect(await panel.claim(authorization, request)).toMatchObject({ body: { status: 'deed' } });
      const resting = await panel.presence(authorization, { kingdomId, personId });
      expect(resting).toMatchObject({ body: { status: 'presence', lit: false, stream: 'resting', held: false } });
      expect(resting.body).not.toHaveProperty('slot');
      await observe(kingdomId, 'herald', { kind: 'stream', live: true, sessionId: 'SIMULATED-panel-night' });
      await observe(kingdomId, 'panel', { kind: 'observe', source: 'panel', coverage: 'activity', people: [{ personId, disclosure: 'named', displayName: 'SIMULATED Light' }] });
      const lit = await panel.presence(authorization, { kingdomId, personId });
      expect(lit).toMatchObject({ body: { status: 'presence', lit: true, stream: 'live', held: false } });
      // Only the person's own lit window is named back to them, so the panel can find it in the painting.
      const ownSlot = Object.values(hold.kingdom.privateState.homes).find(home => home.ownerId === personId)?.slot;
      expect(ownSlot).toEqual(expect.any(Number));
      expect((lit.body as { slot?: number }).slot).toBe(ownSlot);
      const reading = await panel.kingdom(authorization, { kingdomId });
      expect(reading).toMatchObject({ body: { status: 'kingdom', lights: 1, stream: 'live', presence: { windows: [{ present: true, publicName: 'SIMULATED Light' }] } } });
      expect(JSON.stringify(reading)).not.toMatch(/personId|rights|leases|receipt|qualification/);
      expect(await panel.quiet(authorization, { kingdomId, personId, quiet: true })).toMatchObject({ body: { quiet: true, projection: 'pending' } });
      expect(await panel.kingdom(authorization, { kingdomId })).toMatchObject({ body: { lights: 1, presence: { windows: [{ present: true, publicName: null }] } } });
      expect((await db.query('SELECT public_name FROM realm_citizen_names WHERE person_id = $1 AND origin = $2', [personId, origin])).rows[0]?.public_name).toBe('SIMULATED Light');
      expect(await panel.quiet(authorization, { kingdomId, personId, quiet: false })).toMatchObject({ body: { quiet: false } });
      const clock = vi.spyOn(hold.kingdom, 'databaseNow').mockReturnValue(hold.kingdom.databaseNow() + PRESENCE_LEASE_MS + 1);
      try { expect(await panel.presence(authorization, { kingdomId, personId })).toMatchObject({ body: { lit: false, stream: 'live' } }); }
      finally { clock.mockRestore(); }
      await observe(kingdomId, 'herald', { kind: 'stream', live: false, sessionId: null });
      expect(await panel.presence(authorization, { kingdomId, personId })).toMatchObject({ body: { lit: false, stream: 'resting' } });
      expect(await panel.kingdom(authorization, { kingdomId })).toMatchObject({ body: { lights: 0, stream: 'resting' } });
    } finally { await hold.release(); }
  });

  it('reads the latest actual committed public moment without leaking private support identities', async () => {
    const kingdomId = await founding(), hold = await services.retain(kingdomId);
    try {
      const now = Math.floor(hold.kingdom.databaseNow());
      const support = { version: 1, id: 'SIMULATED-panel-moment', kingdomId, origin, occurredAt: now, receivedAt: now,
        notice: { kind: 'aggregate', groupKey: 'SIMULATED-panel-gifts', gifter: { personId: null, name: null }, tier: '1', total: 7 } };
      expect(await ingress.accept(`Bearer ${herald}`, { version: 1, support })).toMatchObject({ http: 202 });
      await expect.poll(async () => (await panel.kingdom(authorization, { kingdomId })).body, { timeout: 4_000 })
        .toMatchObject({ status: 'kingdom', moment: { type: 'twitch.moment', actor: null, body: { kind: 'gifts', giver: null, total: 7 } },
          publicEvent: { type: 'moment', at: expect.any(Number), cursor: expect.any(Number), fact: { body: { kind: 'gifts', total: 7 } } } });
      expect(JSON.stringify((await panel.kingdom(authorization, { kingdomId })).body)).not.toMatch(/personId|receipt/);
    } finally { await hold.release(); }
  });

  it('reports unavailable rather than a successful claim when native names or storage are unavailable', async () => {
    const kingdomId = await founding(), personId = person();
    names.delete(kingdomId);
    expect(await panel.claim(authorization, { kingdomId, personId, name: 'SIMULATED Pending' })).toMatchObject({ http: 503, body: { status: 'unavailable' } });
    expect(await allocation.deedIn(kingdomId, personId)).toMatchObject({ status: 'pending' });
    names.set(kingdomId, 'SIMULATED Panel Kingdom');
    expect(await panel.claim(authorization, { kingdomId, personId, name: 'SIMULATED Pending' })).toMatchObject({ http: 200, body: { status: 'deed' } });
    const broken = new RealmPanelService({ db: { query: async () => { throw new Error('SIMULATED unavailable storage'); }, connect: async () => { throw new Error('SIMULATED unavailable storage'); } }, origin, secret, allocation, citizens, services });
    expect(await broken.kingdom(authorization, { kingdomId })).toMatchObject({ http: 503, body: { status: 'unavailable' } });
    expect(await broken.pledge(authorization, { kingdomId, personId })).toMatchObject({ http: 503, body: { status: 'unavailable' } });
  });
});
