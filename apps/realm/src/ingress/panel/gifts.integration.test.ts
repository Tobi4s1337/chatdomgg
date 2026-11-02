import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { KingdomIdSchema, PersonIdSchema, type KingdomId, type PresenceInput } from '@chatdom/shared';
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
import { RealmPanelGifts } from './gifts';

const enabled = process.env.REALM_DATABASE_TESTS === '1';
const origin = 'simulated' as const;

describe.runIf(enabled)('panel gifts against isolated development Postgres', () => {
  const schema = `panel_window_test_${randomBytes(6).toString('hex')}`;
  const secret = randomBytes(32).toString('hex'), herald = randomBytes(32).toString('hex');
  const authorization = `Bearer ${secret}`;
  const names = new Map<KingdomId, string>(), plans = new Map<KingdomId, SettlementPlan>();
  let db: ReturnType<typeof createRealmPool>;
  let services: ReturnType<typeof createDurableRealmServices>;
  let ingress: RealmIngress;
  let allocation: AllocationService;
  let panel: RealmPanelService;
  let directory: string;
  let nextId = 971_000_000;
  const person = () => PersonIdSchema.parse(String(++nextId));
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires development DATABASE_URL.');
    const url = new URL(process.env.DATABASE_URL);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '5410') throw new Error('Panel tests require development Postgres port 5410.');
    db = createRealmPool({ connectionString: url.toString(), schema });
    await migrateRealmSchema(db, schema);
    await db.query('CREATE TABLE test_gift_dispatch (fact_id text PRIMARY KEY)');
    directory = await mkdtemp(join(tmpdir(), 'panel-gifts-'));
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
  async function founding() {
    const kingdomId = KingdomIdSchema.parse(String(++nextId));
    const plan = generateSettlementPlan({ seed: `SIMULATED-gifts-${kingdomId}`, tier: 'hamlet', firstYear: 2026, year: 2026 });
    plans.set(kingdomId, plan); names.set(kingdomId, 'SIMULATED Kingdom');
    expect(await allocation.adoptLayout(kingdomId, plan)).toMatchObject({ status: 'founded' });
    return kingdomId;
  }
  async function observe(kingdomId: KingdomId, input: Omit<PresenceInput, 'version' | 'id' | 'kingdomId' | 'origin' | 'observedAt'> & Record<string, unknown>) {
    const now = Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now')).rows[0].now);
    const id = `SIMULATED-gifts-${randomUUID()}`;
    expect(await ingress.accept(`Bearer ${herald}`, { version: 1, observation: { version: 1, id, kingdomId, origin, observedAt: now, ...input } }))
      .toMatchObject({ http: 202, body: { status: 'accepted' } });
    await expect.poll(async () => Number((await db.query('SELECT count(*) AS n FROM realm_ingress_receipts WHERE kingdom_id = $1 AND source = $2 AND observation_id = $3', [kingdomId, 'herald', id])).rows[0].n), { timeout: 4_000 }).toBe(1);
  }
  async function live(kingdomId: KingdomId, on: boolean) {
    await observe(kingdomId, { kind: 'stream', live: on, sessionId: on ? `SIMULATED-night-${kingdomId}` : null });
  }
  async function claim(kingdomId: KingdomId, personId: ReturnType<typeof person>, name: string) {
    expect(await panel.claim(authorization, { kingdomId, personId, name })).toMatchObject({ http: 200, body: { status: 'deed' } });
    const deed = await allocation.deedIn(kingdomId, personId);
    expect(deed).not.toBeNull();
    return deed!;
  }

  // The test port stands in for a mounted effect and writes its dispatch in the service's own SQL transaction.
  const effectAuthority = {
    ready: async (giftId: string) => ['kites', 'friendfireworks', 'bunting'].includes(giftId) ? { version: 1 as const } : null,
    append: async (tx: Pick<PoolClient, 'query'>, _lease: unknown, fact: { id: string }) => {
      await tx.query('INSERT INTO test_gift_dispatch (fact_id) VALUES ($1)', [fact.id]);
    },
  };
  const make = (mounted = true) => new RealmPanelGifts({ db, services, origin, ...(mounted ? { effectAuthority } : {}) });
  const request = (kingdomId: KingdomId, personId: ReturnType<typeof person>, sku = 'kitesa', targetPlotId: string | null = null) =>
    ({ kingdomId, personId, extensionId: 'panellane', requestId: randomUUID(), sku, targetPlotId });
  const payment = (intent: { kingdomId: KingdomId; personId: ReturnType<typeof person>; sku: string }, intentId?: string) =>
    ({ extensionId: 'panellane', transactionId: `SIMULATED-tx-${randomUUID()}`, kingdomId: intent.kingdomId, personId: intent.personId,
      sku: intent.sku, bits: 100, inDevelopment: true, occurredAt: Date.now(), name: 'SIMULATED Giver', ...(intentId ? { intentId } : {}) });
  async function newIntent(gifts: ReturnType<typeof make>, input: ReturnType<typeof request>) {
    const reply = await gifts.intent(input);
    expect(reply).toMatchObject({ http: 200, body: { version: 1, status: 'intent', sku: input.sku, intentId: expect.any(String) } });
    if (reply.body.status !== 'intent') throw new Error('Expected gift intent.');
    return reply.body.intentId;
  }
  async function dispatches() { return Number((await db.query('SELECT count(*) AS n FROM test_gift_dispatch')).rows[0].n); }
  async function readyKingdom() {
    const kingdomId = await founding(), personId = person();
    await claim(kingdomId, personId, 'SIMULATED Giver');
    await live(kingdomId, true);
    return { kingdomId, personId };
  }

  it('offers only mounted effects and refuses unknown SKUs and nonexistent targets', async () => {
    const subject = await readyKingdom();
    expect(await make(false).gifts(subject)).toMatchObject({ body: { status: 'gifts', offers: [] } });
    const shelf = await make().gifts(subject);
    expect(shelf).toMatchObject({ body: { status: 'gifts', stream: 'live', offers: expect.arrayContaining([expect.objectContaining({ sku: 'kitesa' })]) } });
    if (shelf.body.status !== 'gifts') throw new Error('Expected gift shelf.');
    const offers = shelf.body.offers;
    expect(offers.some(offer => offer.sku === 'bella')).toBe(false);
    expect((await make().intent(request(subject.kingdomId, subject.personId, 'unknown-retired-sku'))).http).not.toBe(200);
    expect((await make().intent(request(subject.kingdomId, subject.personId, 'friendfireworksa', 'invented-plot'))).http).not.toBe(200);
  });

  it('lists only present, named, non-quiet friends and freezes the chosen target on the intent', async () => {
    const subject = await readyKingdom(), friend = person(), quietFriend = person(), absent = person();
    const friendDeed = await claim(subject.kingdomId, friend, 'SIMULATED Friend');
    await claim(subject.kingdomId, quietFriend, 'SIMULATED Quiet');
    await claim(subject.kingdomId, absent, 'SIMULATED Absent');
    await observe(subject.kingdomId, { kind: 'observe', source: 'chat', coverage: 'activity', people: [
      { personId: friend, disclosure: 'named', displayName: 'SIMULATED Friend' },
      { personId: quietFriend, disclosure: 'named', displayName: 'SIMULATED Quiet' },
    ] });
    expect(await panel.quiet(authorization, { kingdomId: subject.kingdomId, personId: quietFriend, quiet: true })).toMatchObject({ http: 200 });
    const gifts = make(), shelf = await gifts.gifts(subject);
    if (shelf.body.status !== 'gifts') throw new Error('Expected gift shelf.');
    const friends = shelf.body.friends;
    expect(friends).toEqual(expect.arrayContaining([{ plotId: friendDeed.plotId, name: 'SIMULATED Friend' }]));
    expect(JSON.stringify(friends)).not.toContain('SIMULATED Quiet');
    expect(JSON.stringify(friends)).not.toContain('SIMULATED Absent');
    const input = request(subject.kingdomId, subject.personId, 'friendfireworksa', friendDeed.plotId);
    const intentId = await newIntent(gifts, input);
    const conflicting = await gifts.intent({ ...input, targetPlotId: 'invented-plot' });
    expect(conflicting.http).not.toBe(200);
    const result = await gifts.evidence(payment(input, intentId));
    expect(result).toMatchObject({ body: { status: 'delivered', fact: { target: { plotId: friendDeed.plotId } } } });
  }, 30_000);

  it('deduplicates concurrent receipt and webhook evidence, across a new service instance, without leaking identities', async () => {
    const subject = await readyKingdom(), gifts = make(), input = request(subject.kingdomId, subject.personId);
    const intentId = await newIntent(gifts, input), evidence = payment(input, intentId), before = await dispatches();
    const [receipt, webhook] = await Promise.all([gifts.evidence(evidence), gifts.evidence(evidence)]);
    expect(receipt).toMatchObject({ body: { status: 'delivered', fact: { type: 'panel.gift', giftId: 'kites' } } });
    expect(webhook).toEqual(receipt);
    expect(await make().evidence(evidence)).toEqual(receipt);
    expect(await dispatches()).toBe(before + 1);
    for (const table of ['realm_panel_gift_facts', 'realm_panel_gift_outbox', 'realm_panel_gift_transactions']) {
      expect(Number((await db.query(`SELECT count(*) AS n FROM ${table} WHERE kingdom_id = $1`, [subject.kingdomId])).rows[0].n)).toBe(1);
    }
    const fact = await gifts.latest(subject.kingdomId);
    expect(fact).toMatchObject({ type: 'panel.gift', giftId: 'kites' });
    const publicFact = JSON.stringify(fact);
    expect(publicFact).not.toContain(subject.personId);
    expect(publicFact).not.toContain(evidence.transactionId);
    expect((await gifts.evidence({ ...evidence, bits: 300 })).http).not.toBe(200);
    const other = await readyKingdom();
    expect((await gifts.evidence({ ...evidence, kingdomId: other.kingdomId })).http).not.toBe(200);
    expect(await dispatches()).toBe(before + 1);
  }, 30_000);

  it('does not deliver a cancelled dialog but preserves a later verified payment', async () => {
    const subject = await readyKingdom(), gifts = make(), input = request(subject.kingdomId, subject.personId);
    const intentId = await newIntent(gifts, input), before = await dispatches();
    expect(await gifts.cancel({ ...subject, intentId })).toMatchObject({ body: { status: 'cancelled' } });
    expect(await dispatches()).toBe(before);
    expect(await gifts.evidence(payment(input, intentId))).toMatchObject({ body: { status: 'delivered' } });
    expect(await dispatches()).toBe(before + 1);
  });

  it('retains payment while offline, then delivers it once after the stream returns', async () => {
    const subject = await readyKingdom(), gifts = make(), input = request(subject.kingdomId, subject.personId);
    const intentId = await newIntent(gifts, input), evidence = payment(input, intentId), before = await dispatches();
    await live(subject.kingdomId, false);
    expect(await gifts.evidence(evidence)).toMatchObject({ body: { status: 'pending' } });
    expect(await dispatches()).toBe(before);
    expect(await make().status({ ...subject, intentId })).toMatchObject({ body: { status: 'pending' } });
    await live(subject.kingdomId, true);
    expect((await make().drain({ extensionId: input.extensionId })).http).toBe(200);
    for (const table of ['realm_panel_gift_facts', 'realm_panel_gift_outbox']) {
      expect(Number((await db.query(`SELECT count(*) AS n FROM ${table} WHERE kingdom_id = $1`, [subject.kingdomId])).rows[0].n)).toBe(1);
    }
    expect(await make().status({ ...subject, intentId })).toMatchObject({ body: { status: 'delivered' } });
    expect(await dispatches()).toBe(before + 1);
  });

  it('retries a committed payment after an effect dispatch failure, only once', async () => {
    const subject = await readyKingdom();
    let fails = true;
    const authority = { ...effectAuthority, append: async (...args: Parameters<typeof effectAuthority.append>) => {
      if (fails) throw new Error('SIMULATED effect unavailable');
      await effectAuthority.append(...args);
    } };
    const gifts = new RealmPanelGifts({ db, services, origin, effectAuthority: authority });
    const input = request(subject.kingdomId, subject.personId), intentId = await newIntent(gifts, input), before = await dispatches();
    expect(await gifts.evidence(payment(input, intentId))).toMatchObject({ body: { status: 'pending' } });
    const paid = await db.query<{ intent_id: string; fact_id: string | null }>('SELECT intent_id, fact_id FROM realm_panel_gift_transactions WHERE kingdom_id = $1', [subject.kingdomId]);
    expect(paid.rows).toEqual([{ intent_id: intentId, fact_id: null }]);
    for (const table of ['realm_panel_gift_facts', 'realm_panel_gift_outbox']) {
      expect(Number((await db.query(`SELECT count(*) AS n FROM ${table} WHERE kingdom_id = $1`, [subject.kingdomId])).rows[0].n)).toBe(0);
    }
    expect(await dispatches()).toBe(before);
    fails = false;
    expect((await gifts.drain({ extensionId: input.extensionId })).http).toBe(200);
    expect((await gifts.drain({ extensionId: input.extensionId })).http).toBe(200);
    // Inspect durable output before status: status itself can also retry a pending gift.
    expect(await dispatches()).toBe(before + 1);
    for (const table of ['realm_panel_gift_facts', 'realm_panel_gift_outbox']) {
      expect(Number((await db.query(`SELECT count(*) AS n FROM ${table} WHERE kingdom_id = $1`, [subject.kingdomId])).rows[0].n)).toBe(1);
    }
    expect(await gifts.status({ ...subject, intentId })).toMatchObject({ body: { status: 'delivered' } });
  });

  it('delivers an unambiguous webhook payment without an intent ID', async () => {
    const subject = await readyKingdom(), gifts = make(), input = request(subject.kingdomId, subject.personId);
    const intentId = await newIntent(gifts, input), before = await dispatches();
    const evidence = payment(input);
    expect(await gifts.evidence(evidence)).toMatchObject({ body: { status: 'delivered' } });
    expect(await gifts.status({ ...subject, intentId })).toMatchObject({ body: { status: 'delivered' } });
    expect(await dispatches()).toBe(before + 1);
  });

  it('resolves a self-targeted gift to the purchaser’s actual home with a null target', async () => {
    const subject = await readyKingdom(), gifts = make();
    const deed = await allocation.deedIn(subject.kingdomId, subject.personId);
    expect(deed).not.toBeNull();
    const input = request(subject.kingdomId, subject.personId, 'buntinga', null);
    const intentId = await newIntent(gifts, input);
    expect(await gifts.evidence(payment(input, intentId))).toMatchObject({ body: { status: 'delivered', fact: { target: { plotId: deed!.plotId } } } });
  });

  it('keeps a cancelled old selection and a new checkout distinct when their payments race', async () => {
    const subject = await readyKingdom(), gifts = make(), input = request(subject.kingdomId, subject.personId);
    const earlier = await newIntent(gifts, input);
    expect(await gifts.cancel({ ...subject, intentId: earlier })).toMatchObject({ body: { status: 'cancelled' } });
    const newer = await newIntent(gifts, request(subject.kingdomId, subject.personId)), before = await dispatches();
    expect(newer).not.toBe(earlier);
    const [oldResult, newResult] = await Promise.all([gifts.evidence(payment(input, earlier)), gifts.evidence(payment(input, newer))]);
    expect(oldResult).toMatchObject({ body: { status: 'awaiting-target', paymentRef: expect.any(String), choices: expect.arrayContaining([
      expect.objectContaining({ intentId: earlier }), expect.objectContaining({ intentId: newer })]) } });
    expect(newResult).toMatchObject({ body: { status: 'awaiting-target', paymentRef: expect.any(String) } });
    expect(await dispatches()).toBe(before);
    if (oldResult.body.status !== 'awaiting-target' || newResult.body.status !== 'awaiting-target') throw new Error('Expected two unresolved payments.');
    const oldRef = oldResult.body.paymentRef, newRef = newResult.body.paymentRef;
    expect((await gifts.resolve({ kingdomId: subject.kingdomId, personId: person(), paymentRef: oldRef, intentId: earlier })).http).not.toBe(200);
    const [oldResolved, newResolved] = await Promise.all([
      gifts.resolve({ ...subject, paymentRef: oldRef, intentId: earlier }), gifts.resolve({ ...subject, paymentRef: newRef, intentId: newer }),
    ]);
    expect(oldResolved).toMatchObject({ body: { status: 'delivered' } });
    expect(newResolved).toMatchObject({ body: { status: 'delivered' } });
    expect(await dispatches()).toBe(before + 2);
    const rows = await db.query<{ intent_id: string; fact_id: string }>('SELECT intent_id, fact_id FROM realm_panel_gift_transactions WHERE kingdom_id = $1 ORDER BY intent_id', [subject.kingdomId]);
    expect(rows.rows.map(row => row.intent_id).sort()).toEqual([earlier, newer].sort());
    expect(new Set(rows.rows.map(row => row.fact_id)).size).toBe(2);
  });

  it('keeps an ambiguous provider payment pending instead of guessing the latest checkout', async () => {
    const subject = await readyKingdom(), gifts = make(), input = request(subject.kingdomId, subject.personId);
    const earlier = await newIntent(gifts, input);
    expect(await gifts.cancel({ ...subject, intentId: earlier })).toMatchObject({ body: { status: 'cancelled' } });
    const intentId = await newIntent(gifts, request(subject.kingdomId, subject.personId)), before = await dispatches();
    expect(await gifts.evidence(payment(input))).toMatchObject({ body: { status: 'awaiting-target', choices: expect.arrayContaining([expect.objectContaining({ intentId: earlier }), expect.objectContaining({ intentId })]) } });
    expect(await gifts.status({ ...subject, intentId })).toMatchObject({ body: { status: 'awaiting-target' } });
    expect(await dispatches()).toBe(before);
  });

  it('reports unpaid cancellation after a lost response and does not cancel paid offline work', async () => {
    const subject = await readyKingdom(), gifts = make(), input = request(subject.kingdomId, subject.personId);
    const cancelled = await newIntent(gifts, input);
    expect(await gifts.status({ ...subject, intentId: cancelled })).toMatchObject({ body: { status: 'pending', canCancel: true } });
    expect(await gifts.cancel({ ...subject, intentId: cancelled })).toMatchObject({ body: { status: 'cancelled' } });
    expect(await make().status({ ...subject, intentId: cancelled })).toMatchObject({ body: { status: 'cancelled' } });
    const unpaidRows = await db.query('SELECT count(*) AS n FROM realm_panel_gift_transactions WHERE kingdom_id = $1', [subject.kingdomId]);
    expect(Number(unpaidRows.rows[0].n)).toBe(0);
    // The fixed shelf offers a single band; use a fresh subject for an unambiguous paid checkout.
    const other = await readyKingdom(), paidInput = request(other.kingdomId, other.personId);
    const paid = await newIntent(gifts, paidInput);
    await live(other.kingdomId, false);
    expect(await gifts.evidence(payment(paidInput, paid))).toMatchObject({ body: { status: 'pending' } });
    const paidStatus = await make().status({ ...other, intentId: paid });
    expect(paidStatus.body.status).toBe('pending');
    if (paidStatus.body.status !== 'pending') throw new Error('Expected paid pending status.');
    expect(paidStatus.body.canCancel).not.toBe(true);
    expect(await gifts.cancel({ ...other, intentId: paid })).toMatchObject({ body: { status: 'pending' } });
  }, 30_000);

  it('recovers an ambiguous late payment after both checkouts were cancelled', async () => {
    const subject = await readyKingdom(), gifts = make(), input = request(subject.kingdomId, subject.personId);
    const committed = await newIntent(gifts, input);
    expect(await gifts.evidence(payment(input, committed))).toMatchObject({ body: { status: 'delivered' } });
    const first = await newIntent(gifts, request(subject.kingdomId, subject.personId));
    expect(await gifts.cancel({ ...subject, intentId: first })).toMatchObject({ body: { status: 'cancelled' } });
    const second = await newIntent(gifts, request(subject.kingdomId, subject.personId));
    expect(await gifts.cancel({ ...subject, intentId: second })).toMatchObject({ body: { status: 'cancelled' } });
    const before = await dispatches(), evidence = payment(input);
    const result = await gifts.evidence(evidence);
    expect(result).toMatchObject({ body: { status: 'awaiting-target', choices: expect.arrayContaining([
      expect.objectContaining({ intentId: first }), expect.objectContaining({ intentId: second })]) } });
    const shelf = await make().gifts(subject);
    if (shelf.body.status !== 'gifts') throw new Error('Expected gift shelf.');
    expect([first, second]).toContain(shelf.body.activeIntent?.intentId);
    expect(shelf.body.activeIntent?.sku).toBe(input.sku);
    expect(await make().status({ ...subject, intentId: shelf.body.activeIntent!.intentId })).toMatchObject({ body: { status: 'awaiting-target' } });
    expect(await make().evidence(evidence)).toEqual(result);
    expect(await dispatches()).toBe(before);
  }, 30_000);

  it('pages every retained friend choice and resolves an older target outside the first page', async () => {
    const subject = await readyKingdom(), gifts = make(), friendA = person(), friendB = person();
    const deedA = await claim(subject.kingdomId, friendA, 'SIMULATED Friend A');
    const deedB = await claim(subject.kingdomId, friendB, 'SIMULATED Friend B');
    await observe(subject.kingdomId, { kind: 'observe', source: 'chat', coverage: 'activity', people: [
      { personId: friendA, disclosure: 'named', displayName: 'SIMULATED Friend A' },
      { personId: friendB, disclosure: 'named', displayName: 'SIMULATED Friend B' },
    ] });
    const ids: string[] = [];
    for (let n = 0; n < 10; n++) {
      const id = await newIntent(gifts, request(subject.kingdomId, subject.personId, 'friendfireworksa', n % 2 ? deedB.plotId : deedA.plotId));
      ids.push(id);
      expect(await gifts.cancel({ ...subject, intentId: id })).toMatchObject({ body: { status: 'cancelled' } });
    }
    const before = await dispatches(), input = request(subject.kingdomId, subject.personId, 'friendfireworksa', deedA.plotId);
    const firstPage = await gifts.evidence(payment(input));
    expect(firstPage.body.status).toBe('awaiting-target');
    if (firstPage.body.status !== 'awaiting-target') throw new Error('Expected retained choices.');
    expect(firstPage.body.choices).toHaveLength(8);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));
    const firstIds = firstPage.body.choices.map(choice => choice.intentId);
    expect(firstIds).not.toContain(ids[0]);
    const paymentRef = firstPage.body.paymentRef;
    expect((await gifts.choices({ ...subject, paymentRef, cursor: 'invalid-cursor' })).http).toBe(400);
    expect((await gifts.choices({ kingdomId: subject.kingdomId, personId: person(), paymentRef })).http).toBe(400);
    const secondPage = await gifts.choices({ ...subject, paymentRef, cursor: firstPage.body.nextCursor! });
    if (secondPage.body.status !== 'awaiting-target') throw new Error('Expected second page.');
    expect(secondPage.body.nextCursor).toBeNull();
    const allIds = [...firstIds, ...secondPage.body.choices.map(choice => choice.intentId)];
    expect(allIds).toHaveLength(10);
    expect(new Set(allIds)).toEqual(new Set(ids));
    expect(secondPage.body.choices).toEqual(expect.arrayContaining([expect.objectContaining({ intentId: ids[0], targetName: 'SIMULATED Friend A' })]));
    expect(await dispatches()).toBe(before);
    expect(await gifts.resolve({ ...subject, paymentRef, intentId: ids[0] })).toMatchObject({ body: { status: 'delivered', fact: { target: { plotId: deedA.plotId } } } });
    expect(await dispatches()).toBe(before + 1);
  }, 45_000);

});
