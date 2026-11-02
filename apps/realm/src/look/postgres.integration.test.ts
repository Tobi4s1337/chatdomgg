import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { starterLookRecipe, wearPiece } from '@chatdom/content/avatar-style';
import { KingdomIdSchema, PersonIdSchema, starterCitizenLook } from '@chatdom/shared';
import { generateSettlementPlan } from '@chatdom/world';
import { AllocationService, TenureEvidenceVerifier, signTenureEvidence } from '../allocation';
import { createRealmAuthenticator } from '../auth/authenticator';
import { migrateRealmSchema } from '../persistence/migrate';
import { createRealmLookRecords } from './entitlements';
import { PostgresLookRepository } from './postgres-repository';
import { createPostgresLookSessions, csrfFor } from './session';
import { LookStore } from './store';
import { canonicalLook } from './token';

/**
 * The look store against real Postgres, in a random `realm_test_*` schema that is dropped afterwards. People,
 * sessions, deeds and evidence are SIMULATED rows written the way realm-auth and allocation write them.
 *   REALM_DATABASE_TESTS=1 node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run apps/realm/src/look
 */
const KINGDOM = KingdomIdSchema.parse('990400001'), ELSEWHERE = KingdomIdSchema.parse('990400002');
const WREN = PersonIdSchema.parse('990400101'), FERN = PersonIdSchema.parse('990400102'), REED = PersonIdSchema.parse('990400103');
const COLOURS = ['#41677d', '#e5d8b7'] as const;
const MONTH = 31 * 24 * 60 * 60 * 1000;
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest();

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('Looks on Postgres (SIMULATED people)', () => {
  const schema = `realm_test_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pool: pg.Pool;
  const handles = { live: `wren-live-${randomUUID()}`, revoked: `wren-revoked-${randomUUID()}`, expired: `wren-expired-${randomUUID()}`, other: `fern-live-${randomUUID()}` };
  const key = randomBytes(32), verifier = new TenureEvidenceVerifier('simulated', key);
  let open = true;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 needs DATABASE_URL; load it with --env-file-if-exists=.env');
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    expect(await migrateRealmSchema(admin, schema)).toContain('0013_realm_citizen_looks');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: `-c search_path="${schema}"` });
    const person = (id: string, origin: string) => pool.query(`insert into realm_persons (person_id, origin, identity_issuer) values ($1, $2, 'SIMULATED')`, [id, origin]);
    await person(WREN, 'simulated'); await person(REED, 'simulated'); await person(FERN, 'live');
    const session = (handle: string, personId: string, origin: string, expires: string, revoked = false) => pool.query(`
      insert into realm_sessions (session_id, handle_hash, person_id, origin, resume_scope, expires_at, revoked_at, revoked_reason)
      values ($1, $2, $3, $4, $5, now() + $6::interval, ${revoked ? "now(), 'signout'" : 'null, null'})`,
    [randomUUID(), sha(handle), personId, origin, randomBytes(16).toString('hex'), expires]);
    await session(handles.live, WREN, 'simulated', '1 hour');
    await session(handles.revoked, WREN, 'simulated', '1 hour', true);
    await session(handles.expired, WREN, 'simulated', '-1 minute');
    await session(handles.other, FERN, 'live', '1 hour');
    // Wren settles with signed evidence: following for fourteen months when the follow was observed.
    const allocation = new AllocationService(pool, { origin: 'simulated', verifier });
    expect(['founded', 'unchanged']).toContain((await allocation.adoptLayout(KINGDOM, generateSettlementPlan({ seed: 'SIMULATED-looks', tier: 'hamlet', firstYear: 2026, year: 2026 }))).status);
    const observedAt = Date.now() - 1_000;
    const follow = signTenureEvidence(key, { version: 1, kingdomId: KINGDOM, personId: WREN, origin: 'simulated', kind: 'follow',
      source: 'helix.channel-followers', observedAt, followedAt: observedAt - 14 * MONTH });
    expect(await allocation.allocate({ kingdomId: KINGDOM, personId: WREN, evidence: [follow] })).toMatchObject({ status: 'deed' });
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); }
  });

  const store = () => new LookStore({ repository: new PostgresLookRepository(pool), origin: 'simulated',
    records: createRealmLookRecords({ pool, origin: 'simulated', verifier, name: () => 'SIMULATED Hollowmere', colours: () => open ? COLOURS : null }) });

  it('finds only a live session of this origin, and derives the API\'s CSRF token from it', async () => {
    const sessions = createPostgresLookSessions({ pool, origin: 'simulated', cookie: 'chatdom_session' });
    expect(await sessions.resolve(`chatdom_session=${handles.live}`)).toEqual({ personId: WREN, csrfToken: csrfFor(handles.live) });
    for (const handle of [handles.revoked, handles.expired, handles.other, 'never-issued-handle']) expect(await sessions.resolve(`chatdom_session=${handle}`)).toBeNull();
    expect(await sessions.resolve(`__Host-chatdom_session=${handles.live}`)).toBeNull();
    expect(await sessions.resolve('')).toBeNull();
    const live = createPostgresLookSessions({ pool, origin: 'live', cookie: 'chatdom_session' });
    expect(await live.resolve(`chatdom_session=${handles.other}`)).toMatchObject({ personId: FERN });
    expect(await live.resolve(`chatdom_session=${handles.live}`)).toBeNull();
  });

  it('builds entitlements from the deed\'s verified evidence and checks a save against them', async () => {
    const looks = store();
    const mine = await looks.mine(WREN, KINGDOM);
    expect(mine).toMatchObject({ status: 'none', starter: starterCitizenLook(WREN), entitlements: { origin: 'simulated', followedMonths: 14, sub: null,
      kingdom: { id: KINGDOM, name: 'SIMULATED Hollowmere', colours: COLOURS } } });
    expect(await looks.mine(REED, KINGDOM)).toMatchObject({ entitlements: { followedMonths: 0 } });
    expect(await looks.mine(WREN, ELSEWHERE)).toMatchObject({ entitlements: null });
    const hood = wearPiece(starterLookRecipe('sun')!, { family: 'hood', value: { cloth: COLOURS[0], trim: COLOURS[1] } });
    expect(await looks.save(REED, { version: 1, look: hood, kingdomId: KINGDOM })).toMatchObject({ status: 403, reply: { code: 'unearned' } });
    expect(await looks.save(WREN, { version: 1, look: hood, kingdomId: ELSEWHERE })).toMatchObject({ status: 403, reply: { code: 'unearned' } });
    open = false;
    expect(await looks.save(WREN, { version: 1, look: hood, kingdomId: KINGDOM })).toMatchObject({ status: 503, reply: { code: 'unavailable' } });
    open = true;
    const saved = await looks.save(WREN, { version: 1, look: hood, kingdomId: KINGDOM });
    expect(saved).toMatchObject({ status: 200, reply: { ok: true, token: canonicalLook(hood).token } });
  });

  it('keeps one immutable recipe per token, one current look per person, and wears it at the next entry', async () => {
    const looks = store(), look = starterLookRecipe('clay')!, { token, canonical } = canonicalLook(look);
    const first = await looks.save(WREN, { version: 1, look });
    const second = await looks.save(WREN, { version: 1, look: JSON.parse(canonical) });
    expect(first.reply).toMatchObject({ ok: true, token }); expect(second.reply).toMatchObject({ ok: true, token });
    expect((await pool.query('select count(*)::int as n from realm_look_recipes where token = $1', [token])).rows[0].n).toBe(1);
    expect((await pool.query('select token from realm_citizen_looks where person_id = $1', [WREN])).rows).toEqual([{ token }]);
    await expect(pool.query(`update realm_look_recipes set recipe = '{}' where token = $1`, [token])).rejects.toThrow(/immutable/);
    expect(await looks.recipe(token)).toMatchObject({ status: 'found', immutable: true, reply: { token, look: JSON.parse(canonical) } });
    expect(await store().recipe(`lk.${'f'.repeat(40)}`)).toEqual({ status: 'missing' });

    // The next entry ticket carries the saved token as the principal's look; someone who never saved keeps a starter.
    const authenticator = createRealmAuthenticator({ pool, origin: 'simulated' });
    const ticket = async (personId: string, handle: string) => {
      const value = randomUUID(), session = (await pool.query('select session_id from realm_sessions where handle_hash = $1', [sha(handle)])).rows[0].session_id;
      await pool.query(`insert into realm_tickets (ticket_hash, session_id, person_id, kingdom_id, protocol, origin, requested_by, expires_at)
        values ($1, $2, $3, $4, 1, 'simulated', 'SIMULATED test', now() + interval '1 minute')`, [sha(value), session, personId, KINGDOM]);
      return { ticket: value, kingdomId: KINGDOM, protocol: 1 as const };
    };
    expect(await authenticator.authenticate(await ticket(WREN, handles.live))).toMatchObject({ personId: WREN, look: token });
    const reedHandle = `reed-${randomUUID()}`;
    await pool.query(`insert into realm_sessions (session_id, handle_hash, person_id, origin, resume_scope, expires_at) values ($1, $2, $3, 'simulated', $4, now() + interval '1 hour')`,
      [randomUUID(), sha(reedHandle), REED, randomBytes(16).toString('hex')]);
    expect(await authenticator.authenticate(await ticket(REED, reedHandle))).toMatchObject({ personId: REED, look: starterCitizenLook(REED) });
  });

  it('grants a forged piece once, even to someone who has not signed in yet', async () => {
    const looks = store(), stranger = PersonIdSchema.parse('990400199');
    const grant = { personId: stranger, pieceId: 'forge.SIMULATED-fox', slot: 'held' as const, title: 'Sleeping fox', recipe: { motif: 'sleeping-fox' }, source: 'forge' as const };
    const first = await looks.grantWardrobePiece(grant);
    expect(await looks.grantWardrobePiece({ ...grant, title: 'Changed' })).toEqual(first);
    expect(first).toMatchObject({ pieceId: 'forge.SIMULATED-fox', slot: 'held', title: 'Sleeping fox', recipe: { motif: 'sleeping-fox' } });
    await looks.grantWardrobePiece({ ...grant, personId: WREN });
    expect(await looks.mine(WREN, null)).toMatchObject({ status: 'saved', granted: [{ pieceId: 'forge.SIMULATED-fox' }] });
  });
});
