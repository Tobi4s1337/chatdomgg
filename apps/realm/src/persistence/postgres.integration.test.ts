import { createHash, randomBytes } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@colyseus/sdk';
import { KingdomIdSchema, PersonIdSchema, kingdomForBroadcaster, type KingdomId, type PresenceInput, type PersonId } from '@chatdom/shared';
import { VOXEL_FIXTURE } from '@chatdom/shared/world-fixtures';
import { KingdomRoomState, type ForgeAttachment, type RealmBootstrap, type RealmCapability, type RealmDomainCommand, type RealmForgeReservation,
  type RealmOwnedHome, type RealmPublicDelivery, type RealmWriterLease } from '@chatdom/shared/realm';
import { generateSettlementPlan, type SettlementPlan } from '@chatdom/world';
import { decideRealm } from '@chatdom/world/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { createRealmServer } from '../server';
import { PostgresOutboxStore } from '../outbox';
import { RealmIngress, presenceTransition } from '../ingress';
import { REFERENCE_KINGDOM, referenceServices } from '../reference';
import { AllocationService, TenureEvidenceVerifier, signTenureEvidence, type Deed, type HomeFurnisher } from '../allocation';
import { PostgresRealmRepository, RealmCommitUncertainError, RealmLeaseHeldError, RealmWriterFencedError, assertRealmSchema, createDurableRealmServices,
  createRealmPool, digestOf, migrateRealmSchema, canonicalJson, type DurableKingdom, type RealmDatabase } from './index';

/**
 * Spec 34 R1/R2 against real Postgres. Runs only with REALM_DATABASE_TESTS=1 and then fails, never skips, without
 * DATABASE_URL. Everything lives in a random throwaway schema that is dropped afterwards; no other table is touched.
 */
const enabled = process.env.REALM_DATABASE_TESTS === '1';
const schema = `realm_test_${randomBytes(6).toString('hex')}`;
const pools: pg.Pool[] = [];
const evidenceKey = randomBytes(32);
let pool: () => pg.Pool;

describe.runIf(enabled)('durable realm authority (Postgres)', () => {
  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL (load it with --env-file).');
    pool = () => { const p = createRealmPool({ connectionString, schema }); pools.push(p); return p; };
    const first = pool();
    expect(await migrateRealmSchema(first, schema)).toEqual(expect.arrayContaining(['0002_realm_authority', '0003_realm_allocation']));
    expect(await migrateRealmSchema(first, schema)).toEqual([]);
    await assertRealmSchema(first);
  });
  afterAll(async () => {
    const owner = pools[0];
    if (owner) await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all(pools.map(p => p.end()));
  });

  it('two writers race, a COMMIT reply is lost and the stale epoch retries: one spend, one fact, one outcome', async () => {
    const kingdomId = KingdomIdSchema.parse(String(800_000_000 + randomBytes(3).readUIntBE(0, 3)));
    const a = interruptible(pool()), b = interruptible(pool());
    const writerA = new PostgresRealmRepository(a.db, { origin: 'live', leaseMs: 3_000 });
    const writerB = new PostgresRealmRepository(b.db, { origin: 'live', leaseMs: 3_000 });

    // R1: exactly one of two simultaneous acquisitions wins.
    const raced = await Promise.allSettled([writerA.acquire(kingdomId), writerB.acquire(kingdomId)]);
    expect(raced.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(raced.find(r => r.status === 'rejected')).toMatchObject({ reason: expect.any(RealmLeaseHeldError) });
    const winnerIsA = raced[0].status === 'fulfilled';
    const [owner, other, ownerFaults] = winnerIsA ? [writerA, writerB, a] : [writerB, writerA, b];
    const lease = (raced[winnerIsA ? 0 : 1] as PromiseFulfilledResult<RealmWriterLease>).value;
    expect(lease.epoch).toMatch(/^[a-f0-9]{64}$/);

    const now = await dbNow(pools[0]!);
    const person = PersonIdSchema.parse(String(700_000_000 + randomBytes(3).readUIntBE(0, 3)));
    const fixture = forgeFixture(kingdomId, person, await settledHome(allocations('live'), kingdomId, person), now);
    const run = (repo: PostgresRealmRepository, l: RealmWriterLease, id: string, command: RealmDomainCommand, capability: RealmCapability, current = () => true) =>
      repo.execute(l, id, command, (state, at) => decideRealm(state, command, { now: at, writerEpoch: l.epoch, commandId: id, capability, current: current(), anvilCapacity: 2 }), current);

    const [install, rights, night, interval, credit, reserve] = fixture.setup;
    for (const [id, command, capability] of [install!, rights!, night!]) expect(await run(owner, lease, id, command, capability)).toMatchObject({ status: 'committed' });
    // A refusal is the latest answer, not a final one: the night's credit is held until ten minutes are evidenced.
    expect(await run(owner, lease, ...credit!)).toEqual({ status: 'rejected', reason: 'held' });
    expect(await owner.lookup(kingdomId, credit![0])).toEqual({ status: 'rejected', reason: 'held' });
    for (const [id, command, capability] of [interval!, credit!, reserve!]) expect(await run(owner, lease, id, command, capability)).toMatchObject({ status: 'committed' });
    expect((await owner.load(lease)).coals[fixture.person]).toBe(1);

    // R2: the commit lands but its reply is lost. The writer must not guess success or refund.
    ownerFaults.loseNextCommitReply();
    await expect(run(owner, lease, 'forge-commit-1', fixture.commit, 'forge')).rejects.toBeInstanceOf(RealmCommitUncertainError);

    // The process stalls past its lease; the other server takes over with a new, unguessable epoch.
    await waitUntil(async () => (await dbNow(pools[0]!)) > lease.expiresAt);
    await expect(owner.renew(lease)).rejects.toBeInstanceOf(RealmWriterFencedError);
    const takeover = await other.acquire(kingdomId);
    expect(takeover.epoch).not.toBe(lease.epoch);

    // The new writer resolves the uncertain command by lookup, then retries the same id: the stored outcome, nothing new.
    const known = await other.lookup(kingdomId, 'forge-commit-1');
    expect(known).toMatchObject({ status: 'committed', sequence: fixture.setup.length + 1 });
    expect(await run(other, takeover, 'forge-commit-1', fixture.commit, 'forge')).toEqual(known);
    // The same id with another payload is a conflict, never a second decision.
    expect(await run(other, takeover, 'forge-commit-1', { ...fixture.commit, approvalReceipt: 'judges:other' }, 'forge')).toEqual({ status: 'rejected', reason: 'conflict' });
    // A closed authority gate cancels without storing: the command stays undecided and lookup says so.
    expect(await run(other, takeover, 'rights-2', fixture.rights2, 'moderation', () => false)).toEqual({ status: 'rejected', reason: 'cold' });
    expect(await other.lookup(kingdomId, 'rights-2')).toBeNull();

    // The resumed old process cannot write anything under its stale epoch.
    await expect(run(owner, lease, 'rights-2', fixture.rights2, 'moderation')).rejects.toBeInstanceOf(RealmWriterFencedError);
    expect(await run(other, takeover, 'rights-2', fixture.rights2, 'moderation')).toMatchObject({ status: 'committed', sequence: fixture.setup.length + 2 });

    // Reload from storage alone, in a third repository with no cache: one spend, one attachment, private words retained.
    await other.release(takeover);
    const reader = new PostgresRealmRepository(pool(), { origin: 'live' });
    const fresh = await reader.acquire(kingdomId);
    const state = await reader.load(fresh);
    expect(state.sequence).toBe(fixture.setup.length + 2);
    expect(state.coals[fixture.person]).toBe(0);
    expect(Object.keys(state.attachments)).toEqual(['run:1']);
    expect(state.attachments['run:1']?.creation.words).toBe('PRIVATE WISH');
    expect(state.reservations).toEqual({});
    await reader.release(fresh);

    const db = pools[0]!;
    const count = async (sql: string) => Number((await db.query(sql, [kingdomId])).rows[0].n);
    expect(await count(`SELECT count(*) AS n FROM "${schema}".realm_facts WHERE kingdom_id = $1 AND fact LIKE '%"forge.commitApproved"%'`)).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM "${schema}".realm_commands WHERE kingdom_id = $1 AND command_id = 'forge-commit-1'`)).toBe(1);
    const ledger = (await db.query(`SELECT delta, balance, reason FROM "${schema}".realm_coal_ledger WHERE kingdom_id = $1 ORDER BY seq`, [kingdomId])).rows;
    expect(ledger).toEqual([{ delta: 1, balance: 1, reason: 'coal.creditQualifiedNight' }, { delta: -1, balance: 0, reason: 'forge.commitApproved' }]);
    expect(await count(`SELECT count(*) AS n FROM "${schema}".realm_designs WHERE kingdom_id = $1`)).toBe(1);
    const outbox = (await db.query(`SELECT event_id, kind, message FROM "${schema}".realm_outbox WHERE kingdom_id = $1`, [kingdomId])).rows;
    expect(outbox.map(r => [r.event_id, r.kind])).toEqual([[`${kingdomId}:${fixture.setup.length + 1}:0`, 'forge']]);
    expect(outbox[0].message).not.toMatch(/PRIVATE|opaque-safety|judges|personId|ownerId|deed:|names:/);
    expect(outbox[0].message).not.toContain(fixture.person);
    const epochs = (await db.query(`SELECT writer_epoch, writer_generation FROM "${schema}".realm_kingdoms WHERE kingdom_id = $1`, [kingdomId])).rows[0];
    expect(epochs).toEqual({ writer_epoch: null, writer_generation: '3' });
  }, 30_000);

  it('a committed fact survives a room restart and returns through bootstrap', async () => {
    const services = () => {
      const reference = referenceServices();
      const db = pool(), repository = new PostgresRealmRepository(db, { origin: 'simulated' });
      return { reference, durable: createDurableRealmServices({ repository, outbox: new PostgresOutboxStore(db), auth: reference.auth,
        kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: 'reference-court-v1', spawn: (_p, n) => [n * 3 - 6, 0, 7] }) }) };
    };

    // First process: a citizen walks in, the kingdom commits a home publication and the room broadcasts it after commit.
    const first = services(), firstServer = await listen(first.durable);
    const room = await new Client(firstServer.endpoint).joinOrCreate<KingdomRoomState>('kingdom', first.reference.issue(), KingdomRoomState);
    const deliveries: RealmPublicDelivery[] = [];
    room.onMessage('world', (delivery: RealmPublicDelivery) => { deliveries.push(delivery); });
    await waitUntil(() => room.state.walkers.size === 1);
    const firstEpoch = room.state.writerEpoch;
    const kingdom = first.durable.kingdoms.get(REFERENCE_KINGDOM)!;
    const person = PersonIdSchema.parse('990000001');
    const install = await settle(allocations('simulated'), REFERENCE_KINGDOM, person);
    const home = install.home;
    expect(await kingdom.execute('install-1', install, 'allocation')).toMatchObject({ status: 'committed', sequence: 1 });
    expect(await kingdom.execute('rights-1', { type: 'citizen.rights', personId: person, rights: { revision: 1, forge: true, build: true, blocked: false, safetyIdentifier: 'opaque-safety' } }, 'moderation')).toMatchObject({ status: 'committed', sequence: 2 });
    const rebuilt = { ...home, revision: 'house:2', digest: 'c'.repeat(64) };
    expect(await kingdom.execute('publish-1', { type: 'home.replaceApproved', homeId: home.id, expectedRevision: home.revision, home: rebuilt, approvalReceipt: 'build:2', attachments: [] }, 'publication')).toMatchObject({ status: 'committed', sequence: 3 });
    await waitUntil(() => deliveries.length === 1);
    expect(deliveries[0]).toMatchObject({ kingdomId: REFERENCE_KINGDOM, writerEpoch: firstEpoch, sequence: 3, eventId: `${REFERENCE_KINGDOM}:3:0`, message: { type: 'home', plotId: home.id, revision: 'house:2' } });
    await waitUntil(() => room.state.factSequence === 3);
    await room.leave(true);
    await waitUntil(() => !first.durable.kingdoms.has(REFERENCE_KINGDOM));
    await firstServer.close();

    // Second process with its own pool, repository and room: the same kingdom, the same committed facts, a new epoch.
    const second = services(), secondServer = await listen(second.durable);
    const back = await new Client(secondServer.endpoint).joinOrCreate<KingdomRoomState>('kingdom', second.reference.issue(), KingdomRoomState);
    await waitUntil(() => back.state.walkers.size === 1);
    expect(back.state.factSequence).toBe(3);
    expect(back.state.writerEpoch).not.toBe(firstEpoch);
    const bootstrap = await new Promise<RealmBootstrap>(resolve => { back.onMessage('bootstrap', resolve); back.send('bootstrap'); });
    expect(bootstrap).toMatchObject({ throughSequence: 3, writerEpoch: back.state.writerEpoch, current: [{ type: 'home', plotId: home.id, revision: 'house:2', assetHash: 'c'.repeat(64) }] });
    expect(JSON.stringify(bootstrap)).not.toMatch(/opaque-safety|deed:|ownerId/);
    // The close wrote a snapshot at the last committed fact; recovery read it rather than an empty kingdom.
    const snapshots = (await pools[0]!.query(`SELECT seq FROM "${schema}".realm_snapshots WHERE kingdom_id = $1`, [REFERENCE_KINGDOM])).rows;
    expect(snapshots).toEqual([{ seq: '3' }]);
    await back.leave(true);
    await waitUntil(() => !second.durable.kingdoms.has(REFERENCE_KINGDOM));
    await secondServer.close();
  }, 30_000);
  it('one person races into four kingdoms through a restart: three deeds, the castle apart, the guest kept, streets that stay put', async () => {
    const db = pools[0]!, log: string[] = [];
    const id = (base: number) => String(base + randomBytes(3).readUIntBE(0, 3));
    const person = PersonIdSchema.parse(id(600_000_000)), castle = kingdomForBroadcaster(person);
    const kingdoms = [0, 1, 2, 3].map(n => KingdomIdSchema.parse(id(510_000_000 + n * 20_000_000)));
    // Four kingdoms founded alike, from a founding whose next year re-cuts a lane (see GROWING_SEED).
    const growing = founding(GROWING_SEED), plans = kingdoms.map(() => growing);
    const admin = allocations('live');
    for (const [n, k] of kingdoms.entries()) expect(await admin.adoptLayout(k, plans[n]!)).toEqual({ status: 'founded', revision: plans[n]!.revision });
    // Herald saw a follow from August 2024 and fourteen subscribed months, in each kingdom.
    const evidence = (kingdomId: KingdomId) => [
      signTenureEvidence(evidenceKey, { version: 1, kind: 'follow', source: 'helix.channel-followers', kingdomId, personId: person, origin: 'live', observedAt: Date.now() - 5_000, followedAt: Date.UTC(2024, 7, 1) }),
      signTenureEvidence(evidenceKey, { version: 1, kind: 'subscription', source: 'chat.badge-info', kingdomId, personId: person, origin: 'live', observedAt: Date.now() - 5_000, months: 14 }),
    ];
    const ask = (service: AllocationService, kingdomId: KingdomId) => service.allocate({ kingdomId, personId: person, evidence: evidence(kingdomId) });
    const holder = async () => Number((await db.query(`SELECT citizen_deeds FROM "${schema}".realm_deed_holders WHERE person_id = $1`, [person])).rows[0]?.citizen_deeds ?? 0);
    const liveDeeds = async () => (await db.query(`SELECT kingdom_id, status FROM "${schema}".realm_deeds WHERE person_id = $1 AND status <> 'void' ORDER BY kingdom_id`, [person])).rows;

    // The monarch's castle is a seat in their own kingdom, never a deed and never one of the three.
    expect(await admin.allocate({ kingdomId: castle, personId: person, evidence: [] })).toEqual({ status: 'castle' });
    // The process dies inside an allocation, before COMMIT: nothing of it survives and the person is not counted.
    const dying = interruptible(pool());
    dying.dieAtNextCommit();
    await expect(ask(allocations('live', dying.db), kingdoms[0]!)).rejects.toThrow();
    expect(await liveDeeds()).toEqual([]);
    expect(await holder()).toBe(0);

    // Five servers race: four kingdoms plus a duplicate ask for the first; one COMMIT reply is lost on the way.
    const lossy = interruptible(pool());
    lossy.loseNextCommitReply();
    const raced = await Promise.all([
      ask(allocations('live', lossy.db), kingdoms[0]!), ask(allocations('live'), kingdoms[1]!), ask(allocations('live'), kingdoms[2]!),
      ask(allocations('live'), kingdoms[3]!), ask(allocations('live'), kingdoms[0]!),
    ]);
    const deeds = new Map<string, Deed>();
    for (const outcome of raced) if (outcome.status === 'deed') deeds.set(outcome.deed.deedId, outcome.deed);
    const guests = raced.flatMap((outcome, n) => outcome.status === 'guest' ? [{ kingdom: kingdoms[n % 4]!, reason: outcome.reason }] : []);
    expect(deeds.size).toBe(3);
    expect(new Set([...deeds.values()].map(d => d.kingdomId)).size).toBe(3);
    const guestKingdom = kingdoms.find(k => ![...deeds.values()].some(d => d.kingdomId === k))!;
    expect(guests.length).toBeGreaterThanOrEqual(1);
    expect(guests.every(g => g.kingdom === guestKingdom && g.reason === 'three-homes')).toBe(true);
    expect(raced.every(o => o.status === 'deed' || o.status === 'guest')).toBe(true);
    expect(await holder()).toBe(3);
    expect((await liveDeeds()).map(r => r.status)).toEqual(['pending', 'pending', 'pending']);
    for (const deed of deeds.values()) {
      // Follow year 2024 picks the quarter; the sub months stepped one street toward the castle, never another quarter.
      expect(deed.tenure).toMatchObject({ followYear: 2024, quarter: 'follow-year', quarterYear: 2024, subscribedMonths: 14, subscriptionStep: true });
      expect(deed.placement).toMatchObject({ id: deed.plotId, quarterYear: 2024, slot: deed.slot });
      expect(deed.layoutRevision).toBe(plans[kingdoms.indexOf(deed.kingdomId)]!.revision);
    }
    const stored = (await db.query(`SELECT evidence FROM "${schema}".realm_deeds WHERE person_id = $1 LIMIT 1`, [person])).rows[0].evidence as string;
    expect(JSON.parse(stored).map((e: { kind: string }) => e.kind)).toEqual(['follow', 'subscription']);

    // First server: kingdom A installs its deed but loses the COMMIT reply; kingdom B's install command is fixed, then the process stops.
    const [deedA, deedB, deedC] = [...deeds.values()].sort((x, y) => x.kingdomId.localeCompare(y.kingdomId));
    const options = async (k: KingdomId) => ({ world: REFERENCE_WORLD, layoutRevision: (await admin.currentLayout(k))!.revision, spawn: () => [0, 0, 7] as const });
    const noEntry = { authenticate: () => Promise.reject(new Error('no entry in this test')), current: async () => false };
    const firstRepo = interruptible(pool());
    const first = createDurableRealmServices({ repository: new PostgresRealmRepository(firstRepo.db, { origin: 'live' }), outbox: new PostgresOutboxStore(firstRepo.db), auth: noEntry, kingdom: options });
    const roomA = await first.open(deedA!.kingdomId);
    const kingdomA = first.kingdoms.get(deedA!.kingdomId)!;
    firstRepo.loseNextCommitReply();
    expect(await allocations('live').install(kingdomA, deedA!)).toMatchObject({ status: 'installed', sequence: 1 });
    await allocations('live').prepare(deedB!);
    await roomA.dispose();

    // Second server: opening each kingdom installs whatever the interrupted allocation left pending.
    const recovering = allocations('live', pool(), line => log.push(line));
    const second = createDurableRealmServices({ repository: new PostgresRealmRepository(pool(), { origin: 'live' }), outbox: new PostgresOutboxStore(pool()), auth: noEntry, kingdom: options,
      afterOpen: kingdom => recovering.recover(kingdom) });
    const opened = new Map<string, DurableKingdom>();
    const rooms = [];
    for (const deed of [deedA!, deedB!, deedC!]) {
      rooms.push(await second.open(deed.kingdomId));
      opened.set(deed.kingdomId, second.kingdoms.get(deed.kingdomId)!);
    }
    expect(log.filter(line => line.includes('recovered deeds'))).toHaveLength(2);
    for (const deed of [deedA!, deedB!, deedC!]) {
      const home = opened.get(deed.kingdomId)!.privateState.homes[deed.plotId];
      expect(home).toMatchObject({ id: deed.plotId, ownerId: person, slot: deed.slot, allocationReceipt: deed.receipt, layoutRevision: deed.layoutRevision, family: deed.placement.style });
      expect(Object.keys(opened.get(deed.kingdomId)!.privateState.homes)).toEqual([deed.plotId]);
    }
    expect((await liveDeeds()).map(r => r.status)).toEqual(['installed', 'installed', 'installed']);
    expect(Number((await db.query(`SELECT count(*) AS n FROM "${schema}".realm_facts WHERE fact LIKE '%"home.installAllocated"%' AND fact LIKE $1`, [`%${person}%`])).rows[0].n)).toBe(3);

    // Only a pending deed's own command installs: a forged receipt, another kingdom's receipt or a changed slot is refused in the writer's transaction.
    const kingdomB = opened.get(deedB!.kingdomId)!;
    const installedB = kingdomB.privateState.homes[deedB!.plotId]!;
    const other = PersonIdSchema.parse(id(610_000_000));
    for (const [n, home] of [
      { ...installedB, id: 'plot:2023:9', ownerId: other, slot: 9, allocationReceipt: `deed:${'0'.repeat(64)}` },
      { ...installedB, id: 'plot:2023:8', ownerId: other, slot: 8, allocationReceipt: deedA!.receipt },
    ].entries()) expect(await kingdomB.execute(`forged-${n}`, { type: 'home.installAllocated', home }, 'allocation')).toEqual({ status: 'rejected', reason: 'conflict' });
    const pendingOther = await allocations('live').allocate({ kingdomId: deedB!.kingdomId, personId: other, evidence: [] });
    if (pendingOther.status !== 'deed') throw new Error('expected a deed for the neighbour');
    const fixed = await allocations('live').prepare(pendingOther.deed);
    expect(await kingdomB.execute('moved-slot', { type: 'home.installAllocated', home: { ...fixed.home, slot: fixed.home.slot + 4096 } }, 'allocation')).toEqual({ status: 'rejected', reason: 'conflict' });
    expect(kingdomB.privateState.homes[pendingOther.deed.plotId]).toBeUndefined();
    for (const room of rooms) await room.dispose();

    // After every restart the answers hold: the same deed, the same guest light, still three.
    const later = allocations('live');
    expect(await ask(later, guestKingdom)).toEqual({ status: 'guest', reason: 'three-homes' });
    expect(await later.guestIn(guestKingdom, person)).toMatchObject({ reason: 'three-homes' });
    expect(await ask(later, deedA!.kingdomId)).toMatchObject({ status: 'deed', fresh: false, deed: { deedId: deedA!.deedId, receipt: deedA!.receipt, status: 'installed' } });
    expect((await later.deedsOf(person)).map(d => d.deedId).sort()).toEqual([...deeds.keys()].sort());
    expect(await holder()).toBe(3);

    // Streets stay put. A new year extends the layout; every plot keeps its transform and the occupied home its original placement.
    const k = deedA!.kingdomId, founded = plans[kingdoms.indexOf(k)]!, nextYear = generateSettlementPlan({ ...founded.config, year: 2026 });
    expect(nextYear.revision).not.toBe(founded.revision);
    // The new year's frontages add junctions, so the generator cuts a merged lane into new segments: an existing plot's
    // segment ID changes while not one stone moves. That is growth, and adoption must accept it.
    const segment = (plan: SettlementPlan, id: string) => plan.reservations.find(p => p.id === id)!.streetId;
    expect(founded.reservations.filter(p => segment(nextYear, p.id) !== p.streetId).length).toBeGreaterThan(0);
    expect(await later.adoptLayout(k, nextYear)).toEqual({ status: 'extended', revision: nextYear.revision });
    expect(await later.adoptLayout(k, nextYear)).toEqual({ status: 'unchanged', revision: nextYear.revision });
    expect({ ...nextYear.homes.find(h => h.id === deedA!.plotId)!, streetId: null }).toEqual({ ...deedA!.placement, streetId: null });
    expect((await later.deedIn(k, person))!.placement).toEqual(deedA!.placement);
    expect((await later.deedIn(k, person))!.layoutRevision).toBe(founded.revision);
    // A regenerated plan, an old revision, a rewritten revision or a moved plot is an explicit rejection.
    expect(await later.adoptLayout(k, founding('another-seed', 2026))).toMatchObject({ status: 'rejected', reason: 'regenerated' });
    expect(await later.adoptLayout(k, founded)).toMatchObject({ status: 'rejected', reason: 'superseded' });
    const shift = (plan: SettlementPlan, revision: string): SettlementPlan => ({ ...plan, revision,
      reservations: plan.reservations.map(p => p.id === deedA!.plotId ? { ...p, position: [p.position[0] + 1, p.position[1], p.position[2]] } : p),
      homes: plan.homes.map(h => h.id === deedA!.plotId ? { ...h, position: [h.position[0] + 1, h.position[1], h.position[2]] } : h) });
    expect(await later.adoptLayout(k, shift(nextYear, nextYear.revision))).toMatchObject({ status: 'rejected', reason: 'revision-conflict' });
    const thirdYear = generateSettlementPlan({ ...founded.config, year: 2027 });
    expect(await later.adoptLayout(k, shift(thirdYear, 'settlement:moved'))).toMatchObject({ status: 'rejected', reason: 'moved-plot' });
    // Moving a lane a metre is refused even when every plot stays: the street geometry is part of the founding.
    const lane = thirdYear.streets.find(edge => edge.kind === 'lane')!;
    const bent: SettlementPlan = { ...thirdYear, revision: 'settlement:bent', streets: thirdYear.streets.map(edge => edge === lane
      ? { ...edge, points: edge.points.map((p, i) => i === 1 ? [p[0] + 1, p[1], p[2]] as const : p) } : edge) };
    expect(await later.adoptLayout(k, bent)).toMatchObject({ status: 'rejected', reason: 'moved-street' });
    expect((await later.currentLayout(k))!.revision).toBe(nextYear.revision);
    expect(canonicalJson(await later.layoutPlan(k, founded.revision))).toBe(canonicalJson(founded));
    // The database itself refuses to rewrite a layout, a plot or a deed's placement.
    for (const sql of [
      `UPDATE "${schema}".realm_layout_plots SET placement = '{}' WHERE kingdom_id = $1`,
      `UPDATE "${schema}".realm_layouts SET plan = '{}' WHERE kingdom_id = $1`,
      `UPDATE "${schema}".realm_deeds SET plot_id = 'plot:2023:0' WHERE kingdom_id = $1`,
      `UPDATE "${schema}".realm_deeds SET status = 'void', void_reason = 'x' WHERE kingdom_id = $1 AND status = 'installed'`,
      `DELETE FROM "${schema}".realm_deeds WHERE kingdom_id = $1`,
    ]) await expect(db.query(sql, [k]), sql).rejects.toThrow(/immutable|fixed once|never deleted/);
    // A newcomer after the extension settles on the extended layout; the earlier deed did not move.
    const newcomer = await later.allocate({ kingdomId: k, personId: PersonIdSchema.parse(id(620_000_000)), evidence: [] });
    expect(newcomer).toMatchObject({ status: 'deed', deed: { layoutRevision: nextYear.revision, tenure: { quarter: 'unknown-newest', quarterYear: 2026 } } });
    // The year after grows again around both of them: the town extends, each deed keeps its founded placement.
    expect(await later.adoptLayout(k, thirdYear)).toEqual({ status: 'extended', revision: thirdYear.revision });
    expect((await later.deedIn(k, person))!.placement).toEqual(deedA!.placement);
    if (newcomer.status === 'deed') expect((await later.deedIn(k, newcomer.deed.personId))!.placement).toEqual(newcomer.deed.placement);
  }, 60_000);

  it('ingress cannot vanish and committed public delivery resumes: one result, the same event id, one coal', async () => {
    const kingdomId = KingdomIdSchema.parse(String(810_000_000 + randomBytes(3).readUIntBE(0, 3)));
    const person = PersonIdSchema.parse(String(710_000_000 + randomBytes(3).readUIntBE(0, 3)));
    const guest = PersonIdSchema.parse(String(720_000_000 + randomBytes(3).readUIntBE(0, 3)));
    const secret = randomBytes(24).toString('hex'), bearer = `Bearer ${secret}`;
    const db = pools[0]!, rows = async (sql: string) => (await db.query(sql, [kingdomId])).rows;
    const realm = (target: RealmDatabase) => {
      const repository = new PostgresRealmRepository(target, { origin: 'live', leaseMs: 6_000 });
      const ingress = new RealmIngress(target, 'live', { herald: secret });
      const services = createDurableRealmServices({ repository, outbox: new PostgresOutboxStore(target), attach: kingdom => ingress.attach(kingdom),
        auth: { authenticate: () => Promise.reject(new Error('no entry in this test')), current: () => Promise.resolve(false) },
        kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: 'founded:1', spawn: () => [0, 0, 7] }) });
      ingress.use(services);
      return { ingress, services };
    };
    const observe = (id: string, at: number, extra: object) => ({ version: 1, id, kingdomId, observedAt: at, origin: 'live', ...extra });
    const sweep = (id: string, at: number, ids: readonly string[]) => observe(id, at, { kind: 'observe', source: 'chatters', coverage: 'complete', people: ids.map(personId => ({ personId, disclosure: 'anonymous' })) });
    const said = (id: string, at: number) => observe(id, at, { kind: 'observe', source: 'chat', coverage: 'activity', people: [{ personId: guest, disclosure: 'named', displayName: 'Quill' }] });
    const send = (target: RealmIngress, observation: object) => target.accept(bearer, { version: 1, observation });

    // Process A owns the kingdom. It dies the instant its transport takes a chosen frame, before acknowledging it.
    const a = faulty(pool()), first = realm(a.db);
    const hold = await first.services.retain(kingdomId), kingdom = hold.kingdom;
    const seenA: RealmPublicDelivery[] = [];
    let dieAt = Infinity;
    kingdom.subscribe(d => { seenA.push(d); if (d.message.type === 'presence' && d.message.frame.sequence === dieAt) a.die(); });
    const frames = (list: RealmPublicDelivery[]) => list.flatMap(d => d.message.type === 'presence' ? [d.message.frame] : []);
    const frameAt = async (list: RealmPublicDelivery[], revision: number) => { await waitUntil(() => frames(list).some(f => f.sequence === revision)); };

    const home = await settledHome(allocations('live'), kingdomId, person);
    expect(await kingdom.execute('install-1', { type: 'home.installAllocated', home }, 'allocation')).toMatchObject({ status: 'committed' });
    expect(await kingdom.execute('rights-1', { type: 'citizen.rights', personId: person, rights: { revision: 1, forge: true, build: true, blocked: false, safetyIdentifier: 'opaque-safety' } }, 'moderation')).toMatchObject({ status: 'committed' });

    // The stream went live eleven minutes before this writer heard of it; the night starts then, not at this heartbeat.
    const start = await dbNow(db) - 660_000;
    expect(await send(first.ingress, observe('stream:night-1.a', start, { kind: 'stream', live: true, sessionId: 'session:night-1' }))).toMatchObject({ http: 202, body: { status: 'accepted' } });
    expect(await send(first.ingress, observe('stream:night-1.b', await dbNow(db) - 20, { kind: 'stream', live: true, sessionId: 'session:night-1' }))).toMatchObject({ http: 202 });
    await frameAt(seenA, 2);
    expect(kingdom.privateState.stream).toMatchObject({ sessionId: 'session:night-1', startedAt: start });
    // Earlier evidence of this night, committed by the same reducer: 599 of the 600 seconds a coal needs.
    expect(await kingdom.execute('seed-coverage', { type: 'presence.confirmInterval', personId: person, streamSessionId: 'session:night-1', from: start + 1_000, through: start + 600_000, evidenceReceipt: 'herald:earlier' }, 'presence'))
      .toMatchObject({ status: 'committed' });

    // The gate: no secret, a browser-shaped domain command and a field outside the strict schema all fail before storage.
    expect(await first.ingress.accept('Bearer wrong-secret-wrong-secret-wrong-secret', { version: 1, observation: sweep('sweep:x', await dbNow(db), [person]) })).toMatchObject({ http: 401 });
    expect(await first.ingress.accept(bearer, { version: 1, command: { type: 'coal.creditQualifiedNight', personId: person } })).toMatchObject({ http: 400 });
    expect(await send(first.ingress, { ...said('chat:x', await dbNow(db)), text: 'raw chat words' })).toMatchObject({ http: 400 });
    expect(await send(first.ingress, observe('walk:x', await dbNow(db), { kind: 'observe', source: 'walker', coverage: 'activity', people: [{ personId: person, disclosure: 'anonymous' }] }))).toMatchObject({ http: 400 });

    // Two sources see the guest across the same span; Chatters sees the citizen too.
    const t1 = await dbNow(db) - 20;
    expect(await send(first.ingress, sweep('sweep:1', t1, [person, guest]))).toMatchObject({ http: 202 });
    expect(await send(first.ingress, said('chat:1', t1))).toMatchObject({ http: 202 });
    await frameAt(seenA, 4);
    await new Promise(r => setTimeout(r, 1_200));
    const t2 = await dbNow(db) - 20;
    expect(await send(first.ingress, said('chat:2', t2))).toMatchObject({ http: 202 });
    await frameAt(seenA, 5);

    // This sweep closes the citizen's tenth minute: interval, credit and frame commit together. The transport takes the
    // frame and the process dies right there: no acknowledgement, no inbox settlement, no retry.
    dieAt = 6;
    const closing = sweep('sweep:2', t2, [person, guest]);
    expect(await send(first.ingress, closing)).toMatchObject({ http: 202, body: { status: 'accepted' } });
    await frameAt(seenA, 6);
    const delivered = seenA.find(d => d.message.type === 'presence' && d.message.frame.sequence === 6)!;
    await waitUntil(() => a.refusedAcknowledgements > 0);
    expect(kingdom.privateState.coals[person]).toBe(1);
    const lit = frames(seenA).at(-1)!;
    expect(lit).toMatchObject({ kingdomId, epoch: `realm:${kingdomId}`, streamLive: true, connection: 'fresh' });
    expect(lit.windows).toEqual([expect.objectContaining({ slot: home.slot, present: true, publicName: null })]);

    // A's lease runs out; B takes the kingdom over and resumes delivery from the durable cursor: the unacknowledged
    // frame again, with the same event id and sequence.
    await waitUntil(async () => (await dbNow(db)) > Number((await rows('SELECT lease_expires_ms FROM realm_kingdoms WHERE kingdom_id = $1'))[0].lease_expires_ms));
    const second = realm(pool());
    const back = await second.services.retain(kingdomId), resumed = back.kingdom;
    expect(resumed.writerEpoch).not.toBe(kingdom.writerEpoch);
    const seenB: RealmPublicDelivery[] = [];
    resumed.subscribe(d => { seenB.push(d); });
    await waitUntil(() => seenB.length > 0);
    // Herald never heard its 202 and sends the same sweep again: durable already, so nothing new is accepted.
    expect(await send(second.ingress, closing)).toMatchObject({ http: 202, body: { status: 'duplicate' } });
    expect(await send(second.ingress, { ...closing, people: [] })).toMatchObject({ http: 409 });
    expect(seenB[0]).toMatchObject({ eventId: delivered.eventId, sequence: delivered.sequence, message: delivered.message, writerEpoch: resumed.writerEpoch });
    expect(seenB.filter(d => d.eventId === delivered.eventId)).toHaveLength(1);
    await waitUntil(() => resumed.delivery.delivered === resumed.delivery.committed);

    // A fresh join installs the current crowd at throughSequence; the browser rule then ignores the redelivery.
    const bootstrap = resumed.bootstrap({ personId: person, kingdomId, sessionId: 'not-used', expiresAt: 0, origin: 'live', publicName: 'Citizen', look: 'neutral' });
    expect(bootstrap.throughSequence).toBe(resumed.sequence);
    expect(bootstrap.current).toEqual([{ type: 'presence', frame: lit }]);
    const browser = deliveryCursor(bootstrap);
    expect(seenB.filter(browser.accept)).toEqual([]);

    // A lost executeIngress reply, retried by the writer itself: the stored receipt, nothing applied twice.
    const receipt = (await rows(`SELECT status, sequence, checkpoint_revision FROM realm_ingress_receipts WHERE kingdom_id = $1 AND observation_id = 'sweep:2'`))[0];
    expect(receipt).toMatchObject({ status: 'committed', checkpoint_revision: '6' });
    expect(await resumed.ingest({ source: 'herald', digest: digestOf(closing), receivedAt: t2, observation: closing as PresenceInput },
      presenceTransition({ service: 'herald', observation: closing as PresenceInput, writerEpoch: resumed.writerEpoch }))).toEqual({ status: 'committed', sequence: Number(receipt.sequence), at: expect.any(Number) });

    // Under the new writer the guest's run starts again: the outage is never coverage, and two sources never count twice.
    const t3 = await dbNow(db) - 20;
    expect(await send(second.ingress, said('chat:3', t3))).toMatchObject({ http: 202 });
    await new Promise(r => setTimeout(r, 400));
    const t4 = await dbNow(db) - 20;
    expect(await send(second.ingress, said('chat:4', t4))).toMatchObject({ http: 202, body: { status: 'accepted' } });
    expect(await send(second.ingress, sweep('sweep:3', t4, [person, guest]))).toMatchObject({ http: 202 });
    await waitUntil(async () => (await rows('SELECT count(*) AS n FROM realm_ingress_inbox WHERE kingdom_id = $1 AND settled_ms IS NULL'))[0].n === '0');
    await waitUntil(() => frames(seenB).some(f => f.sequence === 9));
    expect(resumed.privateState.qualification[`${guest}:session:night-1`]).toEqual({ coveredMs: (t2 - t1) + (t4 - t3), intervals: [[t1, t2], [t3, t4]] });
    expect(resumed.privateState.qualification[`${person}:session:night-1`]?.coveredMs).toBeGreaterThanOrEqual(600_000);
    expect(resumed.privateState.coals[person]).toBe(1);
    expect(resumed.privateState.coals[guest]).toBeUndefined();

    // One applied result per observation, one coal, one credit fact; every row settled and every delivery acknowledged.
    expect(await rows(`SELECT observation_id FROM realm_ingress_receipts WHERE kingdom_id = $1 AND observation_id = 'sweep:2'`)).toHaveLength(1);
    expect(await rows('SELECT delta, balance, reason FROM realm_coal_ledger WHERE kingdom_id = $1')).toEqual([{ delta: 1, balance: 1, reason: 'coal.creditQualifiedNight' }]);
    expect(await rows(`SELECT seq FROM realm_facts WHERE kingdom_id = $1 AND fact LIKE '%"coal.creditQualifiedNight"%'`)).toHaveLength(1);
    expect(await rows(`SELECT observation_id FROM realm_ingress_inbox WHERE kingdom_id = $1 AND (settled_status <> 'committed' OR settled_ms IS NULL)`)).toEqual([]);
    const outbox = await rows('SELECT id, event_id, message FROM realm_outbox WHERE kingdom_id = $1 ORDER BY id');
    expect(outbox.map(r => r.event_id)).toEqual([...new Set(outbox.map(r => r.event_id))]);
    expect((await rows('SELECT delivered_id FROM realm_outbox_cursors WHERE kingdom_id = $1'))[0].delivered_id).toBe(outbox.at(-1).id);
    // The public payload names nobody's account and carries no rights, sessions, secrets or chat.
    const published = JSON.stringify(outbox.map(r => r.message)) + JSON.stringify(seenB) + JSON.stringify(bootstrap);
    for (const secretish of [person, guest, 'opaque-safety', 'session:night-1', secret, 'Quill', 'raw chat words', 'sweep:', 'herald:', 'allocation:1']) expect(published).not.toContain(secretish);

    await back.release();
    await second.ingress.stop();
    await first.ingress.stop();
    await hold.release().catch(() => {});
  }, 60_000);
});

// -------------------------------------------------------------------------------------------------------------------

/**
 * Lets a test lose the reply of a COMMIT that the server did execute, or let the process die at its next COMMIT:
 * the transaction rolls back on the server and this process never speaks to the database again.
 */
function interruptible(target: pg.Pool) {
  let armed: 'lose' | 'die' | null = null, dead = false;
  const gone = () => Promise.reject(new Error('This process has died'));
  const db: RealmDatabase = {
    query: ((...args: Parameters<pg.Pool['query']>) => dead ? gone() : (target.query as (...a: unknown[]) => unknown)(...args)) as RealmDatabase['query'],
    connect: (async () => {
      if (dead) return gone();
      const client = await target.connect();
      return new Proxy(client, {
        get(object, property) {
          if (property === 'query') {
            return async (...args: Parameters<pg.PoolClient['query']>) => {
              if (dead) return gone();
              if (armed === 'die' && args[0] === 'COMMIT') { armed = null; dead = true; await object.query('ROLLBACK'); throw new Error('Connection terminated unexpectedly'); }
              const result = await (object.query as (...a: unknown[]) => Promise<unknown>)(...args);
              if (armed === 'lose' && args[0] === 'COMMIT') { armed = null; throw new Error('Connection terminated unexpectedly'); }
              return result;
            };
          }
          const value = Reflect.get(object, property, object);
          return typeof value === 'function' ? value.bind(object) : value;
        },
      });
    }) as RealmDatabase['connect'],
  };
  return { db, loseNextCommitReply: () => { armed = 'lose'; }, dieAtNextCommit: () => { armed = 'die'; } };
}

/** A pool whose process can die: from then on nothing reaches the database. Counts the delivery acknowledgements it refused. */
function faulty(target: pg.Pool) {
  let dead = false, refused = 0;
  const check = (sql: unknown) => {
    const text = typeof sql === 'string' ? sql : (sql as { text?: string } | undefined)?.text ?? '';
    if (!dead) return;
    if (/UPDATE realm_outbox_cursors/.test(text)) refused++;
    throw new Error('Connection terminated unexpectedly');
  };
  const db: RealmDatabase = {
    query: (async (...args: unknown[]) => { check(args[0]); return (target.query as (...a: unknown[]) => Promise<unknown>)(...args); }) as RealmDatabase['query'],
    connect: (async () => {
      if (dead) throw new Error('Connection terminated unexpectedly');
      const client = await target.connect();
      return new Proxy(client, {
        get(object, property) {
          if (property === 'query') return async (...args: unknown[]) => { check(args[0]); return (object.query as (...a: unknown[]) => Promise<unknown>)(...args); };
          const value = Reflect.get(object, property, object);
          return typeof value === 'function' ? value.bind(object) : value;
        },
      });
    }) as RealmDatabase['connect'],
  };
  return { db, die: () => { dead = true; }, get refusedAcknowledgements() { return refused; } };
}

/**
 * The browser's delivery rule (README: delivery cursor), as the web lane implements it: install bootstrap, then accept
 * messages only above throughCursor, including presence frames that add no domain fact, deduped by event id.
 */
function deliveryCursor(bootstrap: RealmBootstrap) {
  let cursor = bootstrap.throughCursor;
  const seen = new Set<string>();
  return {
    accept(delivery: RealmPublicDelivery): boolean {
      if (delivery.writerEpoch !== bootstrap.writerEpoch || seen.has(delivery.eventId)) return false;
      if (delivery.cursor <= cursor) return false;
      seen.add(delivery.eventId);
      cursor = delivery.cursor;
      return true;
    },
  };
}

async function dbNow(db: pg.Pool) {
  return Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS n')).rows[0].n);
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, ms = 10_000) {
  const end = Date.now() + ms;
  while (!await predicate()) {
    if (Date.now() > end) throw new Error('Condition did not arrive in time');
    await new Promise(r => setTimeout(r, 25));
  }
}

async function listen(services: Parameters<typeof createRealmServer>[0]) {
  const probe = createNetServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const { server } = createRealmServer(services);
  await server.listen(address.port, '127.0.0.1');
  return { endpoint: `http://127.0.0.1:${address.port}`, close: () => server.gracefullyShutdown(false) };
}

/** Furnishes a deed's first home for tests: fixture content and approved names, always the plot's own family. */
const furnishFixture: HomeFurnisher = async deed => ({ revision: 'home:1', digest: createHash('sha256').update(deed.deedId).digest('hex'), family: deed.placement.style,
  blueprint: VOXEL_FIXTURE, attribution: { makerName: 'Juniper', kingdomName: 'Emberwick', approvalId: 'names:1' } });

function allocations(origin: 'live' | 'simulated', db: RealmDatabase = pool(), log?: (line: string) => void) {
  return new AllocationService(db, { origin, verifier: new TenureEvidenceVerifier(origin, evidenceKey), furnish: furnishFixture, ...(log ? { log } : {}) });
}

/** A founding whose 2026 and 2027 growth re-cut a merged lane (plot:2024:41 joins a renamed segment) and move nothing. */
const GROWING_SEED = 'rs03-517713746';
const founding = (seed: string, year = 2025): SettlementPlan => generateSettlementPlan({ seed, tier: 'hamlet', firstYear: 2023, year });

/** A founded kingdom and a real deed, prepared to install. No home enters a kingdom any other way. */
async function settle(service: AllocationService, kingdomId: KingdomId, person: PersonId) {
  const adopted = await service.adoptLayout(kingdomId, founding(`seed-${kingdomId}`));
  expect(['founded', 'unchanged']).toContain(adopted.status);
  const outcome = await service.allocate({ kingdomId, personId: person, evidence: [] });
  if (outcome.status !== 'deed') throw new Error(`Expected a deed, got ${outcome.status}`);
  return service.prepare(outcome.deed);
}
const settledHome = async (service: AllocationService, kingdomId: KingdomId, person: PersonId) => (await settle(service, kingdomId, person)).home;

/** One allocated home, rights, a live night with ten evidenced minutes, a credited coal and an anvil reservation. */
function forgeFixture(kingdomId: KingdomId, person: PersonId, home: RealmOwnedHome, now: number) {
  const startedAt = now - 700_000;
  const rights = { revision: 1, forge: true, build: true, blocked: false, safetyIdentifier: 'opaque-safety' };
  const record: RealmForgeReservation = { attempt: { key: 'wish:1', attemptId: 'attempt:1' }, homeId: home.id, homeDigest: home.digest, streamSessionId: 'night-1', rightsRevision: 1,
    reservation: { reservationId: 'reserve:1', kingdomId, personId: person, slot: home.slot, revision: home.revision, family: home.family, home: home.blueprint, safetyIdentifier: 'opaque-safety', expiresAt: now + 600_000, attribution: home.attribution } };
  const attachment: ForgeAttachment = { version: 1, id: 'run:1', runId: 'run:1', kingdomId, slot: home.slot, hostId: home.blueprint.id, hostFingerprint: 'fingerprint', socketId: 'chimney', origin: [0, 24, 0],
    kitId: home.family, kitRevision: 1, family: home.family, draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' }, title: 'A sleeping dragon', plaque: 'Warm dreams' },
    provenance: { source: 'live', makerName: 'Juniper', kingdomName: 'Emberwick', designId: `design:${kingdomId}` } };
  const setup: [string, RealmDomainCommand, RealmCapability][] = [
    ['install-1', { type: 'home.installAllocated', home }, 'allocation'],
    ['rights-1', { type: 'citizen.rights', personId: person, rights }, 'moderation'],
    ['night-1', { type: 'stream.observe', sessionId: 'night-1', startedAt, liveUntil: now + 3_600_000 }, 'presence'],
    ['interval-1', { type: 'presence.confirmInterval', personId: person, streamSessionId: 'night-1', from: startedAt, through: startedAt + 600_000, evidenceReceipt: 'interval:1' }, 'presence'],
    ['credit-1', { type: 'coal.creditQualifiedNight', personId: person, streamSessionId: 'night-1', qualificationReceipt: 'qualified:1' }, 'presence'],
    ['reserve-1', { type: 'forge.reserve', record }, 'forge'],
  ];
  const commit: RealmDomainCommand = { type: 'forge.commitApproved', attempt: record.attempt, reservationId: 'reserve:1', expectedRevision: home.revision, expectedHomeDigest: home.digest,
    attachment, creation: { words: 'PRIVATE WISH' }, approvalReceipt: 'judges:1' };
  const rights2: RealmDomainCommand = { type: 'citizen.rights', personId: person, rights: { ...rights, revision: 2 } };
  return { person, setup, commit, rights2 };
}
