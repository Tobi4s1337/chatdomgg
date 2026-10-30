import { randomBytes } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@colyseus/sdk';
import { KingdomIdSchema, PersonIdSchema, type KingdomId, type PresenceInput } from '@chatdom/shared';
import { VOXEL_FIXTURE } from '@chatdom/shared/world-fixtures';
import { KingdomRoomState, type ForgeAttachment, type RealmBootstrap, type RealmCapability, type RealmDomainCommand, type RealmForgeReservation,
  type RealmOwnedHome, type RealmPublicDelivery, type RealmWriterLease } from '@chatdom/shared/realm';
import { decideRealm } from '@chatdom/world/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { createRealmServer } from '../server';
import { PostgresOutboxStore } from '../outbox';
import { RealmIngress, presenceTransition } from '../ingress';
import { REFERENCE_KINGDOM, referenceServices } from '../reference';
import { PostgresRealmRepository, RealmCommitUncertainError, RealmLeaseHeldError, RealmWriterFencedError, assertRealmSchema, createDurableRealmServices,
  createRealmPool, digestOf, migrateRealmSchema, type RealmDatabase } from './index';

/**
 * Spec 34 R1/R2 against real Postgres. Runs only with REALM_DATABASE_TESTS=1 and then fails, never skips, without
 * DATABASE_URL. Everything lives in a random throwaway schema that is dropped afterwards; no other table is touched.
 */
const enabled = process.env.REALM_DATABASE_TESTS === '1';
const schema = `realm_test_${randomBytes(6).toString('hex')}`;
const pools: pg.Pool[] = [];
let pool: () => pg.Pool;

describe.runIf(enabled)('durable realm authority (Postgres)', () => {
  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL (load it with --env-file).');
    pool = () => { const p = createRealmPool({ connectionString, schema }); pools.push(p); return p; };
    const first = pool();
    expect(await migrateRealmSchema(first, schema)).toContain('0002_realm_authority');
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
    const fixture = forgeFixture(kingdomId, now);
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
    expect(outbox[0].message).not.toMatch(/PRIVATE|opaque-safety|judges|personId|ownerId|allocation:|names:/);
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
    const home = ownedHome(REFERENCE_KINGDOM, person);
    expect(await kingdom.execute('install-1', { type: 'home.installAllocated', home }, 'allocation')).toMatchObject({ status: 'committed', sequence: 1 });
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
    expect(JSON.stringify(bootstrap)).not.toMatch(/opaque-safety|allocation:|ownerId/);
    // The close wrote a snapshot at the last committed fact; recovery read it rather than an empty kingdom.
    const snapshots = (await pools[0]!.query(`SELECT seq FROM "${schema}".realm_snapshots WHERE kingdom_id = $1`, [REFERENCE_KINGDOM])).rows;
    expect(snapshots).toEqual([{ seq: '3' }]);
    await back.leave(true);
    await waitUntil(() => !second.durable.kingdoms.has(REFERENCE_KINGDOM));
    await secondServer.close();
  }, 30_000);

  it('ingress cannot vanish and committed public delivery resumes: one result, the same event id, one coal', async () => {
    const kingdomId = KingdomIdSchema.parse(String(810_000_000 + randomBytes(3).readUIntBE(0, 3)));
    const person = PersonIdSchema.parse(String(710_000_000 + randomBytes(3).readUIntBE(0, 3)));
    const guest = PersonIdSchema.parse(String(720_000_000 + randomBytes(3).readUIntBE(0, 3)));
    const secret = randomBytes(24).toString('hex'), bearer = `Bearer ${secret}`;
    const db = pools[0]!, rows = async (sql: string) => (await db.query(sql, [kingdomId])).rows;
    const realm = (target: RealmDatabase) => {
      const repository = new PostgresRealmRepository(target, { origin: 'live', leaseMs: 3_000 });
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

    const home = { ...ownedHome(kingdomId, person), slot: 3 };
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
    expect(lit.windows).toEqual([expect.objectContaining({ slot: 3, present: true, publicName: null })]);

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

/** Lets a test lose the reply of a COMMIT that the server did execute. */
function interruptible(target: pg.Pool) {
  let armed = false;
  const db: RealmDatabase = {
    query: target.query.bind(target) as RealmDatabase['query'],
    connect: (async () => {
      const client = await target.connect();
      return new Proxy(client, {
        get(object, property) {
          if (property === 'query') {
            return async (...args: Parameters<pg.PoolClient['query']>) => {
              const result = await (object.query as (...a: unknown[]) => Promise<unknown>)(...args);
              if (armed && args[0] === 'COMMIT') { armed = false; throw new Error('Connection terminated unexpectedly'); }
              return result;
            };
          }
          const value = Reflect.get(object, property, object);
          return typeof value === 'function' ? value.bind(object) : value;
        },
      });
    }) as RealmDatabase['connect'],
  };
  return { db, loseNextCommitReply: () => { armed = true; } };
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
 * fact-derived messages only above throughSequence and presence frames only above the installed frame, deduped by id.
 */
function deliveryCursor(bootstrap: RealmBootstrap) {
  let through = bootstrap.throughSequence;
  let frame = Math.max(-1, ...bootstrap.current.flatMap(m => m.type === 'presence' ? [m.frame.sequence] : []));
  const seen = new Set<string>();
  return {
    accept(delivery: RealmPublicDelivery): boolean {
      if (delivery.writerEpoch !== bootstrap.writerEpoch || seen.has(delivery.eventId)) return false;
      if (delivery.message.type === 'presence' ? delivery.message.frame.sequence <= frame : delivery.sequence <= through) return false;
      seen.add(delivery.eventId);
      if (delivery.message.type === 'presence') frame = delivery.message.frame.sequence; else through = delivery.sequence;
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

function ownedHome(kingdomId: KingdomId, ownerId: ReturnType<typeof PersonIdSchema.parse>): RealmOwnedHome {
  void kingdomId;
  return { id: 'plot:1', ownerId, slot: 0, allocationReceipt: 'allocation:1', layoutRevision: 'founded:1', revision: 'home:1', digest: 'a'.repeat(64),
    family: 'hearth', blueprint: VOXEL_FIXTURE, attribution: { makerName: 'Juniper', kingdomName: 'Emberwick', approvalId: 'names:1' }, attachments: {} };
}

/** One owned home, rights, a live night with ten evidenced minutes, a credited coal and an anvil reservation. */
function forgeFixture(kingdomId: KingdomId, now: number) {
  const person = PersonIdSchema.parse(String(700_000_000 + randomBytes(3).readUIntBE(0, 3)));
  const home = ownedHome(kingdomId, person), startedAt = now - 700_000;
  const rights = { revision: 1, forge: true, build: true, blocked: false, safetyIdentifier: 'opaque-safety' };
  const record: RealmForgeReservation = { attempt: { key: 'wish:1', attemptId: 'attempt:1' }, homeId: home.id, homeDigest: home.digest, streamSessionId: 'night-1', rightsRevision: 1,
    reservation: { reservationId: 'reserve:1', kingdomId, personId: person, slot: 0, revision: home.revision, family: 'hearth', home: home.blueprint, safetyIdentifier: 'opaque-safety', expiresAt: now + 600_000, attribution: home.attribution } };
  const attachment: ForgeAttachment = { version: 1, id: 'run:1', runId: 'run:1', kingdomId, slot: 0, hostId: home.blueprint.id, hostFingerprint: 'fingerprint', socketId: 'chimney', origin: [0, 24, 0],
    kitId: 'hearth', kitRevision: 1, family: 'hearth', draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' }, title: 'A sleeping dragon', plaque: 'Warm dreams' },
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
