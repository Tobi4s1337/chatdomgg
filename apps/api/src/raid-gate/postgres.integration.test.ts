import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KingdomIdSchema, type KingdomId } from '../../../../packages/shared/src/identity';
import { migrateRealmSchema } from '../../../realm/src/persistence/migrate';
import { sha256 } from '../realm-auth/secrets';
import { SIMULATED_OIDC_PATH } from '../realm-auth/simulated-provider';
import { readGateReply, type GateReply } from './contracts';
import type { LiveChannels, RaidGrants, TargetDirectory, WriteConsent } from './policy';
import migrationSql from './realm-migration.sql?raw';
import { createRaidGateService, type RaidGateService } from './service';
import { createRealmSessionAuthenticator, gateKingdomFromPath } from './session';

/**
 * The Raid Gate against real Postgres, in a random `realm_test_*` schema that is dropped afterwards. Sessions,
 * persons, kingdoms and deeds are realm-auth's and the realm's own tables; the gate's tables come from
 * `realm-migration.sql`, applied here until main registers it. Live state, grants, consent and the destination
 * directory are SIMULATED ports. Nothing reaches Twitch.
 *   REALM_DATABASE_TESTS=1 node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run apps/api/src/raid-gate/postgres.integration.test.ts
 */
const ORIGIN = 'http://localhost:5190';
const COOKIE = 'chatdom_session';
const SOURCE = KingdomIdSchema.parse('990100101');
const MIRA = KingdomIdSchema.parse('990100201');
const MONARCH = '990100101';
const WALKERS = Array.from({ length: 8 }, (_, index) => String(990_100_111 + index));

/** SIMULATED stand-ins for main's ports: every channel live, the grant held, consent given, Mira a general kingdom. */
const SIMULATED_PORTS: Readonly<{ live: LiveChannels; grants: RaidGrants; consent: WriteConsent; directory: TargetDirectory }> = {
  live: { read: async ids => new Map(ids.map(id => [id, true])) },
  grants: { read: async () => 'granted' },
  consent: { read: async () => 'enabled' },
  directory: { read: async (_from, target) => target === MIRA ? { classification: 'general', permitted: true } : null },
};

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('Raid Gate on Postgres (SIMULATED ports)', () => {
  const schema = `realm_test_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pool: pg.Pool;
  const services: RaidGateService[] = [];
  const handles = new Map<string, string>();
  const clock = Date.now();

  const service = () => {
    const created = createRaidGateService({
      pool, origin: 'simulated', issuer: `${ORIGIN}${SIMULATED_OIDC_PATH}`, sessionCookie: COOKIE, publicOrigin: ORIGIN, origins: [ORIGIN],
      clock: () => clock, policyPorts: SIMULATED_PORTS,
    });
    services.push(created);
    return created;
  };
  const as = (gate: RaidGateService, personId: string) => async (command: unknown): Promise<GateReply> => {
    const response = await gate.http.handle(new Request(`${ORIGIN}/api/raid-gate/${SOURCE}`, {
      method: 'POST', body: JSON.stringify(command),
      headers: { cookie: `${COOKIE}=${handles.get(personId)}`, 'content-type': 'application/json', origin: ORIGIN },
    }));
    const body: unknown = await response.json();
    const reply = readGateReply(body);
    if (!reply) throw new Error(`The gate sent a reply its own reader refuses (${response.status}).`);
    return reply;
  };

  async function person(personId: string, revoked = false): Promise<string> {
    const handle = randomBytes(32).toString('base64url');
    await pool.query('insert into realm_persons (person_id, origin, identity_issuer) values ($1, $2, $3)', [personId, 'simulated', `${ORIGIN}${SIMULATED_OIDC_PATH}`]);
    await pool.query(`insert into realm_sessions (session_id, handle_hash, person_id, origin, resume_scope, expires_at, revoked_at, revoked_reason)
      values ($1, $2, $3, 'simulated', $4, now() + interval '1 hour', case when $5::boolean then now() end, case when $5::boolean then 'signout' end)`,
    [randomUUID(), sha256(handle), personId, randomBytes(24).toString('base64url'), revoked]);
    return handle;
  }
  /** A kingdom the realm knows and Genesis founded: a layout head, its layout and one plot. */
  async function found(kingdomId: KingdomId): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("insert into realm_kingdoms (kingdom_id, origin, created_ms) values ($1, 'simulated', $2)", [kingdomId, clock]);
      await client.query(`insert into realm_layout_heads (kingdom_id, origin, revision, seed, first_year, adopted_ms, founded_ms)
        values ($1, 'simulated', 'SIMULATED-r1', 'SIMULATED-seed', 2026, $2, $2)`, [kingdomId, clock]);
      await client.query(`insert into realm_layouts (kingdom_id, revision, parent_revision, plan, digest, adopted_ms)
        values ($1, 'SIMULATED-r1', null, '{}', $2, $3)`, [kingdomId, 'b'.repeat(64), clock]);
      await client.query(`insert into realm_layout_plots (kingdom_id, revision, plot_id, slot, quarter_year, row_id, ordinal, placement)
        values ($1, 'SIMULATED-r1', 'plot-1', 0, 2026, 'row-1', 0, '{}')`, [kingdomId]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  async function deed(kingdomId: KingdomId, personId: string): Promise<void> {
    await pool.query("insert into realm_deed_holders (person_id, origin, citizen_deeds, updated_ms) values ($1, 'simulated', 1, $2)", [personId, clock]);
    await pool.query(`insert into realm_deeds (deed_id, receipt, person_id, kingdom_id, origin, layout_revision, plot_id, slot, placement, tenure, evidence, status, allocated_ms)
      values ($1, $2, $3, $4, 'simulated', 'SIMULATED-r1', 'plot-1', 0, '{}', '{}', '{}', 'pending', $5)`,
    [randomBytes(16).toString('hex'), `deed:${randomBytes(32).toString('hex')}`, personId, kingdomId, clock]);
  }
  const membership = async (requestId: string) => {
    const action = (await pool.query<{ record: string }>('select record from realm_raid_gate_actions where request_id = $1', [requestId])).rows[0]!;
    const joined = (await pool.query<{ n: string }>('select count(*)::text as n from realm_raid_gate_members where request_id = $1 and joined', [requestId])).rows[0]!;
    return { optedIn: (JSON.parse(action.record) as { optedIn: number }).optedIn, joined: Number(joined.n) };
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 needs DATABASE_URL; load it with --env-file-if-exists=.env');
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    expect(await migrateRealmSchema(admin, schema)).toContain('0003_realm_allocation');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: `-c search_path="${schema}"` });
    // Until main registers the file as 0009_realm_raid_gate, the realm migrator does not know these tables.
    const registered = (await pool.query<{ present: boolean }>("select to_regclass('realm_raid_gate_actions') is not null as present")).rows[0]!.present;
    if (!registered) await pool.query(migrationSql);
    await found(SOURCE);
    await found(MIRA);
    for (const id of [MONARCH, ...WALKERS]) handles.set(id, await person(id));
    await deed(SOURCE, WALKERS[0]!);
  });
  afterAll(async () => {
    for (const each of services) each.close();
    await pool?.end();
    if (admin) { await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); }
  });

  it('derives the role from realm records and refuses ended sessions and unknown kingdoms', async () => {
    const auth = createRealmSessionAuthenticator({ pool, origin: 'simulated', sessionCookie: COOKIE, kingdomOf: gateKingdomFromPath('/api/raid-gate') });
    const at = (personId: string | null, kingdom: string = SOURCE, handle = personId ? handles.get(personId) : undefined) =>
      auth(new Request(`${ORIGIN}/api/raid-gate/${kingdom}`, { headers: handle ? { cookie: `${COOKIE}=${handle}` } : {} }), new AbortController().signal);
    expect(await at(MONARCH)).toMatchObject({ personId: MONARCH, sourceRole: 'monarch' });
    expect(await at(WALKERS[0]!)).toMatchObject({ sourceRole: 'citizen' });
    expect(await at(WALKERS[1]!)).toMatchObject({ sourceRole: 'guest' });
    expect(await at(MONARCH, MIRA)).toMatchObject({ sourceKingdomId: MIRA, sourceRole: 'guest' });
    expect(await at(MONARCH, '990100999')).toBeNull();
    expect(await at(null)).toBeNull();
    expect(await at('990100199', SOURCE, await person('990100199', true))).toBeNull();
    const live = createRealmSessionAuthenticator({ pool, origin: 'live', sessionCookie: COOKIE, kingdomOf: gateKingdomFromPath('/api/raid-gate') });
    expect(await live(new Request(`${ORIGIN}/api/raid-gate/${SOURCE}`, { headers: { cookie: `${COOKIE}=${handles.get(MONARCH)}` } }), new AbortController().signal)).toBeNull();
  });

  it('previews, gathers walkers by choice, keeps the count consistent under concurrency and survives a restart', async () => {
    const gate = service();
    const monarch = as(gate, MONARCH);
    const [wren, oak, ...rest] = WALKERS.map(id => as(gate, id));

    expect(await monarch({ op: 'gate' })).toMatchObject({ kind: 'gate', value: { viewer: 'monarch', authority: 'ready', open: null } });
    expect(await wren!({ op: 'gate' })).toMatchObject({ kind: 'gate', value: { viewer: 'walker', authority: null, open: null } });
    expect(await oak!({ op: 'preview', requestId: 'r1', target: MIRA })).toEqual({ kind: 'denied', code: 'unauthorized' });
    const preview = await monarch({ op: 'preview', requestId: 'r1', target: MIRA });
    expect(preview).toMatchObject({ kind: 'preview', value: { requestId: 'r1', from: SOURCE, to: MIRA, optedIn: 0, target: { founded: true, live: true, classification: 'general' } } });
    const secret = preview.kind === 'preview' ? preview.value.token : '';

    expect(await wren!({ op: 'join', requestId: 'r1' })).toMatchObject({ kind: 'party', value: { joined: true, optedIn: 1 } });
    expect(await oak!({ op: 'join', requestId: 'r1' })).toMatchObject({ kind: 'party', value: { joined: true, optedIn: 2 } });
    expect(await oak!({ op: 'leave', requestId: 'r1' })).toMatchObject({ kind: 'party', value: { joined: false, optedIn: 1 } });
    expect(await membership('r1')).toEqual({ optedIn: 1, joined: 1 });

    // Six walkers press at once. Some may lose a serializable race and answer stale/unavailable; none may be lost or doubled.
    const first = await Promise.all(rest.map(join => join({ op: 'join', requestId: 'r1' })));
    const joined = first.filter(reply => reply.kind === 'party' && reply.value.joined).length;
    expect(await membership('r1')).toEqual({ optedIn: 1 + joined, joined: 1 + joined });
    for (const [index, reply] of first.entries()) {
      if (reply.kind !== 'party') expect(await rest[index]!({ op: 'join', requestId: 'r1' })).toMatchObject({ kind: 'party', value: { joined: true } });
    }
    expect(await membership('r1')).toEqual({ optedIn: 7, joined: 7 });

    // Only the token's hash is stored, and no session handle is anywhere in the gate's tables.
    const stored = (await pool.query<{ record: string }>(`select record from realm_raid_gate_actions union all select record from realm_raid_gate_members
      union all select record from realm_raid_gate_pointers`)).rows.map(row => row.record).join('\n');
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toContain(secret);
    for (const handle of handles.values()) expect(stored).not.toContain(handle);

    // A new process: fresh repository and application over the same rows.
    const restarted = service();
    expect(await as(restarted, WALKERS[0]!)({ op: 'gate' })).toMatchObject({ kind: 'gate', value: { open: { requestId: 'r1', to: MIRA, optedIn: 7, joined: true } } });
    expect(await as(restarted, WALKERS[1]!)({ op: 'gate' })).toMatchObject({ kind: 'gate', value: { open: { requestId: 'r1', optedIn: 7, joined: false } } });
    expect(await as(restarted, MONARCH)({ op: 'preview', requestId: 'r1', target: MIRA })).toMatchObject({ kind: 'preview', value: { optedIn: 7 } });
  });
});
