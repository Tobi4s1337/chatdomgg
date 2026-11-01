import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { DockOutcomeSchema, DockStateSchema, type RealmDockPresentation, type RealmDockStageState } from '@chatdom/shared/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { PostgresOutboxStore } from '../outbox/store';
import { createRealmPool, type RealmDatabase } from '../persistence/database';
import { createDurableRealmServices, type DurableKingdomHold } from '../persistence/kingdom';
import { migrateRealmSchema } from '../persistence/migrate';
import { PostgresRealmRepository } from '../persistence/postgres-repository';
import { RealmDockService } from './service';

it('refuses unknown services and forged royal claims before opening authority', async () => {
  const db = { query: () => { throw new Error('Unauthorized callers must not touch storage'); } } as unknown as RealmDatabase;
  const dock = new RealmDockService(db, 'live', 's'.repeat(32));
  expect((await dock.status('Bearer wrong', {})).http).toBe(401);
  expect((await dock.action('Bearer wrong', {})).http).toBe(401);
  expect((await dock.witness('Bearer wrong', {})).http).toBe(401);
  const actor = { personId: PersonIdSchema.parse('2'), sessionId: randomUUID() };
  expect(await dock.action(`Bearer ${'s'.repeat(32)}`, { version: 1, origin: 'live', principal: actor,
    action: { id: 'forged-royal', kingdomId: '1', kind: 'gate-close', expectedRevision: 'none' } }))
    .toMatchObject({ http: 200, body: { status: 'refused' } });
  expect((await dock.status(`Bearer ${'s'.repeat(32)}`, { version: 1, origin: 'simulated', principal: actor, kingdomId: '2' })).http).toBe(400);
});

it('reserves authenticated presenter admission when the public observer pool is full', async () => {
  const kingdomId = KingdomIdSchema.parse('900008401');
  const actor = { personId: PersonIdSchema.parse(kingdomId), sessionId: randomUUID() };
  const secret = 's'.repeat(32), authorization = `Bearer ${secret}`;
  const db = { query: async (sql: string) => ({ rows: sql.includes('realm_sessions') ? [{ public_name: null, name_approval: null }] : [] }) } as unknown as RealmDatabase;
  const kingdom = { kingdomId, current: true, databaseNow: () => Date.now(), privateState: { homes: {}, rights: {} },
    loadIngress: async () => null, onClosed: () => () => {}, subscribe: () => () => {},
    writeMoments: async (work: () => unknown) => work() };
  const dock = new RealmDockService(db, 'simulated', secret);
  dock.use({ retain: async () => ({ kingdom, release: async () => {} }) } as unknown as Parameters<RealmDockService['use']>[0]);
  try {
    const publicRequest = { version: 1, origin: 'simulated', kingdomId };
    for (let i = 0; i < 32; i++) await dock.connect(authorization, publicRequest, () => true, () => {}, false);
    await expect(dock.connect(authorization, publicRequest, () => true, () => {}, false)).rejects.toThrow('Unavailable');
    const presenter = await dock.connect(authorization, { ...publicRequest, principal: actor }, () => true, () => {}, true);
    expect(presenter.presenterToken).toHaveLength(43);
    const forged = { ...publicRequest, principal: { ...actor, personId: PersonIdSchema.parse('42') } };
    await expect(dock.connect(authorization, forged, () => true, () => {}, true)).rejects.toThrow('Forbidden');
  } finally { dock.stop(); }
});

// SIMULATED identity and transport; actual retained writer, fenced SQL transactions and receipt storage.
describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('durable royal act and presentation witness (SIMULATED)', () => {
  it('persists one command, remains unknown without a presenter, witnesses its exact event and deduplicates retries', async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL.');
    const schema = `dock_test_${randomBytes(6).toString('hex')}`;
    const db = createRealmPool({ connectionString: process.env.DATABASE_URL, schema });
    const kingdomId = KingdomIdSchema.parse('900008401'), sessionId = randomUUID(), secret = randomBytes(32).toString('hex');
    const names = new Map([[kingdomId, 'SIMULATED Lanternmere']]);
    const actor = { personId: PersonIdSchema.parse(kingdomId), sessionId };
    const statusRequest = { version: 1, origin: 'simulated', principal: actor, kingdomId } as const;
    const authorization = `Bearer ${secret}`;
    const services = createDurableRealmServices({ repository: new PostgresRealmRepository(db, { origin: 'simulated' }),
      outbox: new PostgresOutboxStore(db), auth: { authenticate: async () => { throw new Error('No browser room in this test'); }, current: async () => false },
      kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: 'SIMULATED-dock', spawn: () => [0, 0, 6] }) });
    const dock = new RealmDockService(db, 'simulated', secret, 0, names); dock.use(services);
    let hold: DurableKingdomHold | undefined;
    const connections: { close(): void }[] = [];
    try {
      expect(await migrateRealmSchema(db, schema)).toContain('0010_realm_dock');
      await db.query("INSERT INTO realm_persons (person_id, origin, identity_issuer) VALUES ($1, 'simulated', 'SIMULATED-issuer')", [actor.personId]);
      await db.query(`INSERT INTO realm_sessions (session_id, handle_hash, person_id, origin, resume_scope, expires_at)
        VALUES ($1, $2, $3, 'simulated', $4, now() + interval '1 hour')`, [sessionId, randomBytes(32), actor.personId, randomUUID()]);
      hold = await services.retain(kingdomId);
      const initial = DockStateSchema.parse((await dock.status(authorization, statusRequest)).body);
      expect(initial.kingdom.name).toBe('SIMULATED Lanternmere');
      const received: RealmDockPresentation[] = [], states: RealmDockStageState[] = [];
      const publicConnection = await dock.connect(authorization, { version: 1, origin: 'simulated', kingdomId },
        event => { received.push(event); return true; }, () => {}, false, state => { states.push(state); return true; });
      connections.push(publicConnection);
      expect(publicConnection.presenterToken).toBeUndefined();
      expect(states[0]).toMatchObject({ gate: 'open', honours: [] });
      const request = { version: 1, origin: 'simulated', principal: actor,
        action: { id: 'SIMULATED-close', kingdomId, kind: 'gate-close', expectedRevision: initial.revision } } as const;
      expect((await dock.action(authorization, request)).body).toMatchObject({ status: 'unknown' });
      expect(received).toHaveLength(1);
      const event = received[0]!;
      expect(event).toMatchObject({ actionId: request.action.id, gate: 'closed', origin: 'simulated' });
      expect((await db.query('SELECT 1 FROM realm_dock_presentations WHERE witnessed_ms IS NOT NULL')).rowCount).toBe(0);
      const presentations: RealmDockPresentation[] = [];
      const presenter = await dock.connect(authorization, statusRequest, value => { presentations.push(value); return true; }, () => {}, true);
      connections.push(presenter);
      expect(presenter.presenterToken).toHaveLength(43);
      expect(presentations).toEqual([event]);
      const witness = { version: 1, principal: actor, kingdomId, origin: 'simulated', streamEventId: event.id, presenterToken: presenter.presenterToken };
      expect((await dock.witness(authorization, { ...witness, streamEventId: 'invented' })).http).toBe(403);
      expect((await dock.witness(authorization, witness)).body).toEqual({ status: 'witnessed' });
      const retried = DockOutcomeSchema.parse((await dock.action(authorization, request)).body);
      expect(retried).toMatchObject({ status: 'accepted', witness: { streamEventId: event.id, actionId: request.action.id } });
      expect((await db.query('SELECT 1 FROM realm_dock_presentations')).rowCount).toBe(1);
      expect((await dock.action(authorization, { ...request, action: { ...request.action, kind: 'gate-open' } })).body).toMatchObject({ status: 'refused' });
      expect((await dock.action(authorization, { ...request, action: { ...request.action, id: 'SIMULATED-stale' } })).body).toMatchObject({ status: 'refused' });
      expect((await db.query('SELECT 1 FROM realm_dock_presentations')).rowCount).toBe(1);
      expect(DockStateSchema.parse((await dock.status(authorization, statusRequest)).body).town.gate).toBe('closed');
      for (const connection of connections.splice(0)) connection.close();
      await hold.release(); hold = undefined;
      const restored = new RealmDockService(db, 'simulated', secret, 0, names); restored.use(services);
      expect(DockStateSchema.parse((await restored.status(authorization, statusRequest)).body).town.gate).toBe('closed');
      expect((await restored.action(authorization, request)).body).toMatchObject({ status: 'accepted' });
      await db.query(`UPDATE realm_dock_heads SET state = jsonb_set(state::jsonb, '{lastAt}', '0')::text WHERE kingdom_id = $1`, [kingdomId]);
      const beforeUndo = DockStateSchema.parse((await restored.status(authorization, statusRequest)).body);
      const reversals: RealmDockPresentation[] = [];
      const undoPresenter = await restored.connect(authorization, statusRequest, value => { reversals.push(value); return true; }, () => {}, true);
      connections.push(undoPresenter);
      const undoRequest = { ...request, action: { ...request.action, id: 'SIMULATED-undo', kind: 'undo',
        targetId: `receipt:${event.id}`, expectedRevision: beforeUndo.revision } };
      expect((await restored.action(authorization, undoRequest)).body).toMatchObject({ status: 'unknown' });
      expect(reversals).toHaveLength(1);
      expect(reversals[0]).toMatchObject({ kind: 'undo', undoOf: event.id, undoSubject: { kind: 'gate-close' }, gate: 'open' });
      expect((await restored.witness(authorization, { ...witness, streamEventId: reversals[0]!.id,
        presenterToken: undoPresenter.presenterToken })).body).toEqual({ status: 'witnessed' });
      expect((await restored.action(authorization, undoRequest)).body).toMatchObject({ status: 'accepted' });
      await db.query("UPDATE realm_sessions SET revoked_at = now(), revoked_reason = 'revoked' WHERE session_id = $1", [sessionId]);
      expect((await restored.status(authorization, statusRequest)).body).toBeNull();
      expect((await restored.action(authorization, request)).body).toMatchObject({ status: 'refused' });
      expect((await dock.witness(authorization, witness)).http).toBe(403);
      restored.stop();
    } finally {
      for (const connection of connections) connection.close();
      dock.stop(); await hold?.release();
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.end();
    }
  }, 30_000);
});
