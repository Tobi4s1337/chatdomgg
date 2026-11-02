/** Real Postgres with SIMULATED policy/Twitch ports. Every write stays in an isolated, disposable schema. */
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '../../../../packages/shared/src/identity';
import { createRaidGateApplication } from '../../../api/src/raid-gate/application';
import type { GateCommand, GateContext } from '../../../api/src/raid-gate/contracts';
import { RaidObservationSchema } from '../../../api/src/raid-gate/observations';
import type { AuthorizedRaidTransport } from '../../../api/src/raid-gate/ports';
import { createPostgresRaidGateRepository } from '../../../api/src/raid-gate/postgres-repository';
import { outboxId } from '../../../api/src/raid-gate/repository';
import { migrateRealmSchema } from '../persistence/migrate';
import { RaidObservationLedger } from './observations';

const T0 = 1_800_000_000_000;
const TARGET = KingdomIdSchema.parse('990200201');
const WALKER = PersonIdSchema.parse('990200111');
const OWN = new AbortController().signal;

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('outgoing raid landing on isolated Postgres (SIMULATED Twitch)', () => {
  const schema = `realm_test_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pool: pg.Pool;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL.');
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    await migrateRealmSchema(admin, schema);
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: `-c search_path="${schema}"` });
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
  });

  function stack(sourceId: string) {
    const source = KingdomIdSchema.parse(sourceId), monarch = PersonIdSchema.parse(sourceId);
    let now = T0;
    const writes: { kind: 'start' | 'cancel'; key: string }[] = [];
    const raids: AuthorizedRaidTransport = {
      origin: 'simulated',
      async start(write) { writes.push({ kind: 'start', key: write.key }); return { kind: 'accepted', createdAt: now }; },
      async cancel(write) { writes.push({ kind: 'cancel', key: write.key }); return { kind: 'accepted', createdAt: now }; },
      async reconcile() { return { kind: 'unknown' }; },
    };
    const moment = vi.fn(async () => ({ http: 202, body: { status: 'accepted' } }));
    const repository = createPostgresRaidGateRepository({ pool });
    const ledger = () => new RaidObservationLedger({ pool, origin: 'simulated', clock: () => now, moment });
    const boot = () => createRaidGateApplication({
      repository, origin: 'simulated', clock: () => now, raids, roads: ledger().roads,
      tokens: { issue: () => randomBytes(32).toString('hex'), hash: async value => createHash('sha256').update(value).digest('hex') },
      policy: {
        async readStanding(principal) { return { session: 'current', broadcaster: principal.personId === monarch, live: true, raids: 'granted', actions: 'enabled' }; },
        async readTarget(_from, to) { return to === TARGET ? { target: { kingdomId: TARGET, founded: true, live: true, classification: 'general' }, permitted: true } : null; },
      },
    });
    let app = boot();
    const command = (value: GateCommand, personId = monarch) => {
      const context: GateContext = { principal: { personId, sessionId: `session.${personId}`, sourceKingdomId: source,
        sourceRole: personId === monarch ? 'monarch' : 'citizen' }, now, signal: OWN };
      return app.handle(context, value);
    };
    const preview = async (requestId: string) => {
      const reply = await command({ op: 'preview', requestId, target: TARGET });
      expect(reply.kind).toBe('preview');
      if (reply.kind !== 'preview') throw new Error('The gate did not issue the expected preview.');
      return reply.value.token;
    };
    const start = async (requestId: string, gather = false) => {
      const token = await preview(requestId);
      if (gather) expect(await command({ op: 'join', requestId }, WALKER)).toMatchObject({ kind: 'party', value: { joined: true, optedIn: 1 } });
      expect(await command({ op: 'start', requestId, previewToken: token })).toMatchObject({ kind: 'action', value: { state: 'pending', raid: null } });
      return repository.transaction(tx => tx.getAction(requestId), OWN);
    };
    const observation = (id: string) => RaidObservationSchema.parse({ version: 1, id, origin: 'simulated', kingdomId: source,
      direction: 'outgoing', occurredAt: now, receivedAt: now, from: { kingdomId: source, login: `source_${source}`, name: 'Source Kingdom' },
      to: { kingdomId: TARGET, login: 'destination', name: 'Destination Kingdom' }, viewers: 14 });
    const action = (requestId: string) => repository.transaction(tx => tx.getAction(requestId), OWN);
    const effects = (requestId: string) => repository.transaction(async tx => ({
      start: await tx.getOutbox(outboxId(requestId, 'start')), cancel: await tx.getOutbox(outboxId(requestId, 'cancel')), road: await tx.getOutbox(outboxId(requestId, 'road')),
    }), OWN);
    return { repository, command, preview, start, observation, action, effects, ledger, writes, moment,
      advance(ms: number) { now += ms; }, restart() { app = boot(); }, app: () => app };
  }

  it('starts through the gate, lands the joined party and road together, and keeps the first correlation after restart', async () => {
    const world = stack('990201101'), requestId = 'outgoing.first';
    const pending = await world.start(requestId, true);
    expect(pending).toMatchObject({ state: 'pending', optedIn: 1, raid: null });
    expect((await world.effects(requestId)).start).toMatchObject({ attempts: 1, state: 'settled', outcome: 'accepted' });
    world.advance(30_000);
    const evidence = world.observation('outgoing-event1');
    const result = await world.ledger().record(evidence);
    expect(result).toMatchObject({ status: 'accepted', gate: { kind: 'landed', requestId } });
    const landed = await world.action(requestId);
    expect(landed).toMatchObject({ state: 'landed', revision: pending!.revision + 1, raidEventId: evidence.id, raid: { id: result.raidId }, optedIn: 1 });
    expect((await world.effects(requestId)).road).toMatchObject({ state: 'settled', outcome: 'delivered', revision: 1, attempts: 1 });
    expect((await world.ledger().page()).items.filter(item => item.id === result.raidId)).toHaveLength(1);
    expect((await pool.query('SELECT beat_state FROM realm_raid_observation_effects WHERE event_id = $1', [evidence.id])).rows)
      .toEqual([{ beat_state: 'none' }]);
    expect(world.writes).toEqual([{ kind: 'start', key: outboxId(requestId, 'start') }]);

    world.restart();
    expect(await world.command({ op: 'gate' }, WALKER)).toMatchObject({ value: { open: { state: 'landed', joined: true, optedIn: 1 } } });
    const before = await world.effects(requestId);
    expect(await world.ledger().record({ ...evidence, receivedAt: evidence.receivedAt + 100 }))
      .toEqual({ status: 'duplicate', raidId: result.raidId, gate: null });
    expect(await world.action(requestId)).toEqual(landed);
    expect(await world.effects(requestId)).toEqual(before);
    expect(await world.app().recover(evidence.receivedAt, 32)).toEqual({ reconciled: 0, sent: 0, lapsed: 0, delivered: 0, overdue: 0 });
    expect(await world.ledger().recover()).toEqual({ delivered: 0, expired: 0, waiting: 0 });
    expect(world.moment).not.toHaveBeenCalled();

    // A later request for the same pair cannot adopt this observation when its provider retries it.
    await world.start('outgoing.second');
    expect(await world.ledger().record(evidence)).toMatchObject({ status: 'duplicate', gate: null });
    expect(await world.action('outgoing.second')).toMatchObject({ state: 'pending', raid: null });
    expect((await world.effects('outgoing.second')).road).toBeNull();
    expect((await pool.query('SELECT action_request_id FROM realm_raid_observations WHERE event_id = $1', [evidence.id])).rows)
      .toEqual([{ action_request_id: requestId }]);
  });

  it('never correlates an old uncorrelated observation when a request is opened later', async () => {
    const world = stack('990202101');
    const evidence = world.observation('outgoing-before-request');
    const first = await world.ledger().record(evidence);
    expect(first).toMatchObject({ status: 'accepted', gate: null });
    await world.start('outgoing.later');
    world.restart();
    expect(await world.ledger().record(evidence)).toEqual({ status: 'duplicate', raidId: first.raidId, gate: null });
    expect(await world.action('outgoing.later')).toMatchObject({ state: 'pending', raid: null });
    expect((await world.effects('outgoing.later')).road).toBeNull();
    expect((await pool.query('SELECT action_request_id FROM realm_raid_observations WHERE event_id = $1', [evidence.id])).rows)
      .toEqual([{ action_request_id: null }]);
  });

  it('records an honest road without landing a request that Twitch confirmed canceled', async () => {
    const world = stack('990203101'), requestId = 'outgoing.canceled';
    await world.start(requestId);
    expect(await world.command({ op: 'cancel', requestId })).toMatchObject({ value: { state: 'cancelled' } });
    const canceled = await world.action(requestId);
    world.advance(30_000);
    const evidence = world.observation('outgoing-after-cancel');
    const result = await world.ledger().record(evidence);
    expect(result).toMatchObject({ status: 'accepted', gate: { kind: 'ignored', reason: 'settled' } });
    expect(await world.action(requestId)).toEqual(canceled);
    expect((await world.effects(requestId)).road).toBeNull();
    expect((await world.ledger().page()).items.map(item => item.id)).toContain(result.raidId);
    expect(world.writes.map(write => write.kind)).toEqual(['start', 'cancel']);
  });

  it('does not land a queued start that never reached its transport, even if recovery sends it later', async () => {
    const world = stack('990204101'), requestId = 'outgoing.unsent';
    await world.preview(requestId);
    // SIMULATED crash between committing start intent and claiming its transport call. The preview itself is real.
    await world.repository.transaction(async tx => {
      const action = (await tx.getAction(requestId))!;
      expect(await tx.putAction({ ...action, state: 'dispatching', dispatchedAt: T0, revision: action.revision + 1 }, action.revision)).toMatchObject({ kind: 'stored' });
      expect(await tx.putOutbox({ id: outboxId(requestId, 'start'), revision: 1, requestId, kind: 'start', state: 'queued', createdAt: T0,
        claimedAt: null, settledAt: null, outcome: null, attempts: 0, origin: 'simulated' }, 0)).toMatchObject({ kind: 'stored' });
    }, OWN);
    const evidence = world.observation('outgoing-before-attempt');
    const first = await world.ledger().record(evidence);
    expect(first).toMatchObject({ status: 'accepted', gate: null });
    expect(await world.action(requestId)).toMatchObject({ state: 'dispatching', raid: null });
    expect((await world.effects(requestId)).start).toMatchObject({ state: 'queued', attempts: 0 });
    expect(world.writes).toEqual([]);
    expect(await world.app().recover(T0, 32)).toMatchObject({ sent: 1 });
    world.restart();
    expect(await world.ledger().record(evidence)).toEqual({ status: 'duplicate', raidId: first.raidId, gate: null });
    expect(await world.action(requestId)).toMatchObject({ state: 'pending', raid: null });
    expect((await world.effects(requestId)).road).toBeNull();
  });

  it('rolls back the feed, beat and landing together when recording the delivered road fails', async () => {
    const world = stack('990205101'), requestId = 'outgoing.atomic';
    const pending = await world.start(requestId);
    const before = (await pool.query('SELECT sequence::text AS sequence FROM realm_raid_feed_heads WHERE origin = $1', ['simulated'])).rows;
    await pool.query("ALTER TABLE realm_raid_gate_outbox ADD CONSTRAINT test_reject_atomic_road CHECK (kind <> 'road' OR request_id <> 'outgoing.atomic')");
    const evidence = world.observation('outgoing-atomic-event');
    try {
      await expect(world.ledger().record(evidence)).rejects.toMatchObject({ code: '23514' });
      expect(await world.action(requestId)).toEqual(pending);
      expect((await world.effects(requestId)).road).toBeNull();
      expect((await pool.query('SELECT event_id FROM realm_raid_observations WHERE event_id = $1', [evidence.id])).rows).toEqual([]);
      expect((await pool.query('SELECT event_id FROM realm_raid_observation_effects WHERE event_id = $1', [evidence.id])).rows).toEqual([]);
      expect((await pool.query('SELECT sequence::text AS sequence FROM realm_raid_feed_heads WHERE origin = $1', ['simulated'])).rows).toEqual(before);
    } finally { await pool.query('ALTER TABLE realm_raid_gate_outbox DROP CONSTRAINT test_reject_atomic_road'); }
    expect(await world.ledger().record(evidence)).toMatchObject({ status: 'accepted', gate: { kind: 'landed', requestId } });
    expect(await world.action(requestId)).toMatchObject({ state: 'landed', revision: pending!.revision + 1 });
    expect((await world.effects(requestId)).road).toMatchObject({ state: 'settled', outcome: 'delivered' });
  });
});
