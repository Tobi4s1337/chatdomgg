import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { KingdomIdSchema, PersonIdSchema, type KingdomId, type PresenceInput } from '@chatdom/shared';
import { generateSettlementPlan, type SettlementPlan } from '@chatdom/world';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import type { PanelSettings } from '../../../../../packages/shared/src/panel';
import { DEFAULT_SETTINGS } from '../../../../panel/src/settings/schema';
import { AllocationService, TenureEvidenceVerifier } from '../../allocation';
import { createRealmCitizens } from '../../evening/citizens';
import { PostgresOutboxStore } from '../../outbox';
import { createDurableRealmServices, createRealmPool, migrateRealmSchema, PostgresRealmRepository, type RealmDatabase } from '../../persistence';
import { RealmIngress } from '../service';
import { RealmPanelGifts, type PanelGiftEffectAuthority } from './gifts';
import { RealmPanelService } from './service';
import { RealmPanelSettings } from './settings';

const origin = 'simulated' as const;
const enabled = process.env.REALM_DATABASE_TESTS === '1';
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe.runIf(enabled)('panel settings and gift serialization against isolated development Postgres', () => {
  const schema = `panel_settings_test_${randomBytes(6).toString('hex')}`;
  const secret = randomBytes(32).toString('hex'), herald = randomBytes(32).toString('hex');
  const authorization = `Bearer ${secret}`;
  const names = new Map<KingdomId, string>(), plans = new Map<KingdomId, SettlementPlan>();
  let db: ReturnType<typeof createRealmPool>;
  let services: ReturnType<typeof createDurableRealmServices>;
  let ingress: RealmIngress;
  let allocation: AllocationService;
  let settings: RealmPanelSettings;
  let panel: RealmPanelService;
  let nextId = 975_000_000;
  const kingdomId = () => KingdomIdSchema.parse(String(++nextId));
  const personId = () => PersonIdSchema.parse(String(++nextId));

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires development DATABASE_URL.');
    const url = new URL(process.env.DATABASE_URL);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '5410') throw new Error('Settings tests require development Postgres port 5410.');
    db = createRealmPool({ connectionString: url.toString(), schema });
    await migrateRealmSchema(db, schema);
    await db.query('CREATE TABLE test_settings_dispatch (fact_id text PRIMARY KEY)');
    const key = randomBytes(32), citizens = createRealmCitizens({ db, origin, kingdomNames: names });
    allocation = new AllocationService(db, { origin, verifier: new TenureEvidenceVerifier(origin, key), furnish: citizens.furnish });
    ingress = new RealmIngress(db, origin, { panel: secret, herald });
    services = createDurableRealmServices({ repository: new PostgresRealmRepository(db, { origin }), outbox: new PostgresOutboxStore(db),
      auth: { authenticate: async () => { throw new Error('No socket authentication in this test'); }, current: async () => false },
      kingdom: id => ({ world: REFERENCE_WORLD, layoutRevision: plans.get(id)!.revision, spawn: () => [0, 0, 6] }),
      afterOpen: kingdom => citizens.recover(kingdom), attach: kingdom => ingress.attach(kingdom) });
    citizens.use(allocation, services); ingress.use(services);
    settings = new RealmPanelSettings({ db, services, origin });
    panel = new RealmPanelService({ db, origin, secret, allocation, citizens, services, settings });
  });
  afterAll(async () => {
    await ingress?.stop();
    if (services) await Promise.all([...services.kingdoms.values()].map(kingdom => kingdom.dispose()));
    if (db) { try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.end(); } }
  });

  async function observe(id: KingdomId, input: Omit<PresenceInput, 'version' | 'id' | 'kingdomId' | 'origin' | 'observedAt'> & Record<string, unknown>) {
    const now = Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now')).rows[0].now);
    const observationId = `SIMULATED-settings-${randomUUID()}`;
    const source = input.kind === 'observe' && input.source === 'panel' ? 'panel' : 'herald';
    expect(await ingress.accept(`Bearer ${source === 'panel' ? secret : herald}`, { version: 1, observation: { version: 1, id: observationId, kingdomId: id, origin, observedAt: now, ...input } }))
      .toMatchObject({ http: 202, body: { status: 'accepted' } });
    await expect.poll(async () => Number((await db.query('SELECT count(*) AS n FROM realm_ingress_receipts WHERE kingdom_id = $1 AND source = $2 AND observation_id = $3', [id, source, observationId])).rows[0].n), { timeout: 4_000 }).toBe(1);
  }
  async function founded(id = kingdomId()) {
    const person = personId();
    const plan = generateSettlementPlan({ seed: `SIMULATED-settings-${id}`, tier: 'hamlet', firstYear: 2026, year: 2026 });
    plans.set(id, plan); names.set(id, 'SIMULATED Kingdom');
    expect(await allocation.adoptLayout(id, plan)).toMatchObject({ status: 'founded' });
    expect(await panel.claim(authorization, { kingdomId: id, personId: person, name: 'SIMULATED Giver' })).toMatchObject({ body: { status: 'deed' } });
    await observe(id, { kind: 'stream', live: true, sessionId: `SIMULATED-settings-night-${id}` });
    return { kingdomId: id, personId: person };
  }
  const save = (id: KingdomId, expectedRevision: string, value: PanelSettings, authority = settings) => authority.save({ kingdomId: id, personId: id, expectedRevision, settings: value });
  const effectAuthority: PanelGiftEffectAuthority = {
    ready: async giftId => ['kites', 'flowerpetals'].includes(giftId) ? { version: 1 } : null,
    append: async (sql, _lease, fact) => { await sql.query('INSERT INTO test_settings_dispatch (fact_id) VALUES ($1)', [fact.id]); },
  };
  const gifts = (effect: PanelGiftEffectAuthority = effectAuthority) => new RealmPanelGifts({ db, services, origin, effectAuthority: effect });
  const intent = (subject: Awaited<ReturnType<typeof founded>>, sku = 'kitesa') => ({ ...subject, extensionId: 'panelsettings', requestId: randomUUID(), sku, targetPlotId: null });
  async function checkout(authority: RealmPanelGifts, input: ReturnType<typeof intent>) {
    const result = await authority.intent(input);
    expect(result).toMatchObject({ http: 200, body: { status: 'intent' } });
    if (result.body.status !== 'intent') throw new Error('Expected an issued checkout.');
    return { ...input, intentId: result.body.intentId };
  }
  const paid = (input: Awaited<ReturnType<typeof checkout>>) => ({ kingdomId: input.kingdomId, personId: input.personId, extensionId: input.extensionId,
    sku: input.sku, intentId: input.intentId, transactionId: `SIMULATED-settings-tx-${randomUUID()}`, bits: 100, inDevelopment: true, occurredAt: Date.now(), name: 'SIMULATED Giver' });
  async function dispatches() { return Number((await db.query('SELECT count(*) AS n FROM test_settings_dispatch')).rows[0].n); }

  it('persists defaults and CAS saves before founding without creating a kingdom, and gates the internal bearer', async () => {
    const id = kingdomId();
    expect(await settings.read({ kingdomId: id })).toEqual({ http: 200, body: { version: 1, status: 'settings', revision: '0', settings: DEFAULT_SETTINGS, connected: false } });
    expect((await panel.settings('', { kingdomId: id })).http).toBe(401);
    expect((await panel.settingsSave('Bearer incorrect', { kingdomId: id, personId: id, expectedRevision: '0', settings: DEFAULT_SETTINGS })).http).toBe(401);
    expect((await settings.save({ kingdomId: id, personId: personId(), expectedRevision: '0', settings: DEFAULT_SETTINGS })).http).toBe(400);
    const hidden = { ...DEFAULT_SETTINGS, hidden: true };
    expect(await panel.settingsSave(authorization, { kingdomId: id, personId: id, expectedRevision: '0', settings: hidden })).toMatchObject({ http: 200, body: { status: 'settings', revision: '1', settings: hidden, connected: false } });
    expect((await db.query('SELECT 1 FROM realm_kingdoms WHERE kingdom_id = $1', [id])).rowCount).toBe(0);
    expect(await new RealmPanelSettings({ db, services, origin }).read({ kingdomId: id })).toMatchObject({ body: { revision: '1', settings: hidden, connected: false } });
    expect(await panel.kingdom(authorization, { kingdomId: id })).toMatchObject({ body: { status: 'unfounded', settings: hidden, settingsRevision: '1' } });
    expect(await new RealmPanelSettings({ db, services, origin: 'live' }).read({ kingdomId: id })).toMatchObject({ body: { revision: '0', settings: DEFAULT_SETTINGS, connected: false } });
  });

  it('gives concurrent initial saves one winner and prevents a stale page from undoing Hide', async () => {
    const id = kingdomId(), hidden = { ...DEFAULT_SETTINGS, hidden: true };
    const replies = await Promise.all([save(id, '0', hidden), save(id, '0', { ...DEFAULT_SETTINGS, gifts: [] })]);
    expect(replies.map(answer => answer.body.status).sort()).toEqual(['conflict', 'settings']);
    const winner = replies.find(answer => answer.body.status === 'settings')!;
    if (winner.body.status !== 'settings') throw new Error('Expected CAS winner.');
    expect(replies.find(answer => answer.body.status === 'conflict')).toMatchObject({ body: { current: winner.body } });
    expect(await save(id, '1', hidden)).toMatchObject({ body: { status: 'settings', revision: '2' } });
    expect(await save(id, '1', DEFAULT_SETTINGS)).toMatchObject({ body: { status: 'conflict', current: { revision: '2', settings: hidden } } });
    expect(await settings.read({ kingdomId: id })).toMatchObject({ body: { revision: '2', settings: hidden } });
  });

  it('joins the actual writer if founding wins while an unfounded save is in flight', async () => {
    const id = kingdomId(), entered = latch(), release = latch();
    const delayedDb = { query: db.query.bind(db), connect: async () => {
      const sql = await db.connect();
      return new Proxy(sql, { get(target, property) {
        if (property !== 'query') { const value: unknown = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value; }
        return async (...args: unknown[]) => {
          if (String(args[0]) === 'SELECT 1 FROM realm_kingdoms WHERE kingdom_id = $1 AND origin = $2') { entered.resolve(); await release.promise; }
          return Reflect.apply(target.query, target, args) as ReturnType<PoolClient['query']>;
        };
      } });
    } } as RealmDatabase;
    const delayed = new RealmPanelSettings({ db: delayedDb, services, origin });
    const saving = save(id, '0', { ...DEFAULT_SETTINGS, hidden: true }, delayed);
    await entered.promise;
    try { await founded(id); } finally { release.resolve(); }
    expect(await saving).toMatchObject({ http: 200, body: { revision: '1', connected: true, settings: { hidden: true } } });
    expect(await gifts().gifts({ kingdomId: id, personId: id })).toMatchObject({ body: { offers: [] } });
  });

  it('derives connection from the retained realm and offers only selected bands with mounted effects', async () => {
    const subject = await founded();
    expect(await settings.read({ kingdomId: subject.kingdomId })).toMatchObject({ body: { connected: true } });
    const chosen: PanelSettings = { ...DEFAULT_SETTINGS, gifts: [{ giftId: 'kites', band: 'b' }, { giftId: 'flowerpetals', band: 'c' }, { giftId: 'bell', band: 'c' }] };
    expect(await save(subject.kingdomId, '0', chosen)).toMatchObject({ body: { connected: true, revision: '1' } });
    const authority = gifts(), shelf = await authority.gifts(subject);
    if (shelf.body.status !== 'gifts') throw new Error('Expected shelf.');
    expect(shelf.body.offers.map(offer => offer.sku)).toEqual(['kitesb', 'flowerpetalsc']);
    for (const sku of ['kitesa', 'kitesc', 'bellc', 'paradea']) expect((await authority.intent(intent(subject, sku))).http).not.toBe(200);
    await checkout(authority, intent(subject, 'kitesb'));
    await save(subject.kingdomId, '1', { ...chosen, tabs: { ...chosen.tabs, gifts: false } });
    expect(await authority.gifts(subject)).toMatchObject({ body: { offers: [] } });
    expect((await authority.intent(intent(subject, 'flowerpetalsc'))).http).not.toBe(200);
    expect(await panel.kingdom(authorization, { kingdomId: subject.kingdomId })).toMatchObject({ body: { status: 'kingdom', settingsRevision: '2', settings: { tabs: { gifts: false } } } });
  });

  it('fails closed for unsupported saved settings instead of granting defaults', async () => {
    const subject = await founded(), authority = gifts(), issued = await checkout(authority, intent(subject));
    expect((await settings.save({ ...subject, personId: subject.kingdomId, expectedRevision: '0', settings: { ...DEFAULT_SETTINGS, version: 2 } })).http).toBe(400);
    await save(subject.kingdomId, '0', DEFAULT_SETTINGS);
    await db.query('UPDATE realm_panel_settings SET settings = $2 WHERE kingdom_id = $1', [subject.kingdomId, JSON.stringify({ ...DEFAULT_SETTINGS, version: 2 })]);
    expect((await settings.read({ kingdomId: subject.kingdomId })).http).toBe(503);
    expect((await save(subject.kingdomId, '1', DEFAULT_SETTINGS)).http).toBe(503);
    expect((await gifts().gifts(subject)).http).toBe(503);
    expect((await gifts().intent(intent(subject))).http).toBe(503);
    expect((await panel.kingdom(authorization, { kingdomId: subject.kingdomId })).http).toBe(503);
    const payment = paid(issued);
    expect(await authority.evidence(payment)).toMatchObject({ http: 200, body: { status: 'pending' } });
    expect((await db.query('SELECT intent_id, fact_id FROM realm_panel_gift_transactions WHERE transaction_id = $1', [payment.transactionId])).rows[0])
      .toEqual({ intent_id: issued.intentId, fact_id: null });
  });

  it('retains a paid gift through Hide, shelf removal and band changes, then delivers it once after unhide', async () => {
    const subject = await founded(), authority = gifts();
    const issued = await checkout(authority, intent(subject)), payment = paid(issued), before = await dispatches();
    const hidden: PanelSettings = { ...DEFAULT_SETTINGS, hidden: true, gifts: [{ giftId: 'flowerpetals', band: 'c' }], tabs: { kingdom: true, you: true, gifts: false } };
    expect(await save(subject.kingdomId, '0', hidden)).toMatchObject({ body: { status: 'settings', revision: '1' } });
    expect(await authority.evidence(payment)).toMatchObject({ http: 200, body: { status: 'pending' } });
    expect(await authority.drain({ extensionId: 'panelsettings' })).toMatchObject({ body: { status: 'drained', committed: 0 } });
    expect(await dispatches()).toBe(before);
    const stored = (await db.query('SELECT intent_id, fact_id FROM realm_panel_gift_transactions WHERE transaction_id = $1', [payment.transactionId])).rows[0];
    expect(stored).toEqual({ intent_id: issued.intentId, fact_id: null });
    expect(await panel.claim(authorization, { ...subject, name: 'SIMULATED Giver' })).toMatchObject({ body: { status: 'deed' } });
    await observe(subject.kingdomId, { kind: 'observe', source: 'panel', coverage: 'activity', people: [{ personId: subject.personId, disclosure: 'named', displayName: 'SIMULATED Giver' }] });
    expect(await panel.presence(authorization, subject)).toMatchObject({ body: { lit: true } });
    expect(await save(subject.kingdomId, '1', { ...hidden, hidden: false, gifts: [] })).toMatchObject({ body: { status: 'settings', revision: '2' } });
    expect(await authority.drain({ extensionId: 'panelsettings' })).toMatchObject({ body: { status: 'drained', committed: 1 } });
    expect(await authority.status({ ...subject, intentId: issued.intentId })).toMatchObject({ body: { status: 'delivered', fact: { giftId: 'kites', effectVersion: 1 } } });
    await authority.evidence(payment);
    expect(await dispatches()).toBe(before + 1);
    expect(await authority.gifts(subject)).toMatchObject({ body: { offers: [] } });
  });

  it('lets an already committing gift finish before Hide and pauses the next paid gift', async () => {
    const subject = await founded(), entered = latch(), release = latch();
    const authority = gifts({ ...effectAuthority, append: async (sql, lease, fact) => {
      entered.resolve(); await release.promise; await effectAuthority.append(sql, lease, fact);
    } });
    const selected: PanelSettings = { ...DEFAULT_SETTINGS, gifts: [{ giftId: 'kites', band: 'a' }, { giftId: 'flowerpetals', band: 'a' }] };
    await save(subject.kingdomId, '0', selected);
    const first = await checkout(authority, intent(subject)), second = await checkout(authority, intent(subject, 'flowerpetalsa'));
    const delivery = authority.evidence(paid(first));
    await entered.promise;
    let saved = false;
    const hide = save(subject.kingdomId, '1', { ...selected, hidden: true }).then(answer => { saved = true; return answer; });
    try {
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(saved).toBe(false);
    } finally { release.resolve(); }
    expect(await delivery).toMatchObject({ body: { status: 'delivered' } });
    expect(await hide).toMatchObject({ body: { status: 'settings', settings: { hidden: true } } });
    expect(await authority.evidence(paid(second))).toMatchObject({ body: { status: 'pending' } });
  });

  it('queues a gift behind an in-flight Hide on the existing writer and retains payment without dispatch', async () => {
    const subject = await founded(), authority = gifts(), issued = await checkout(authority, intent(subject));
    const entered = latch(), release = latch(), before = await dispatches();
    const delayedDb = { query: db.query.bind(db), connect: async () => {
      const sql = await db.connect();
      return new Proxy(sql, { get(target, property) {
        if (property !== 'query') { const value: unknown = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value; }
        return async (...args: unknown[]) => {
          if (String(args[0]).startsWith('INSERT INTO realm_panel_settings')) { entered.resolve(); await release.promise; }
          return Reflect.apply(target.query, target, args) as ReturnType<PoolClient['query']>;
        };
      } });
    } } as RealmDatabase;
    const delayed = new RealmPanelSettings({ db: delayedDb, services, origin });
    const hide = save(subject.kingdomId, '0', { ...DEFAULT_SETTINGS, hidden: true }, delayed);
    await entered.promise;
    let delivered = false;
    const delivery = authority.evidence(paid(issued)).then(answer => { delivered = true; return answer; });
    try {
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(delivered).toBe(false);
      expect(await dispatches()).toBe(before);
    } finally { release.resolve(); }
    expect(await hide).toMatchObject({ body: { status: 'settings', settings: { hidden: true } } });
    expect(await delivery).toMatchObject({ body: { status: 'pending' } });
    expect(await dispatches()).toBe(before);
  });
});
