import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RaidObservationSchema } from '../../../api/src/raid-gate/observations';
import { migrateRealmSchema } from '../persistence/migrate';
import { RaidGuestAuthority } from './guests';
import { RaidObservationLedger } from './observations';

const start = 1_800_000_000_000;
describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('raid guests on isolated Postgres', () => {
  const schema = `realm_test_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pool: pg.Pool, now = start;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL');
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    expect(await migrateRealmSchema(admin, schema)).toContain('0011d_realm_raid_guests');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: `-c search_path="${schema}"` });
  });
  afterAll(async () => { await pool?.end(); if (admin) { await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); } });
  const authority = () => new RaidGuestAuthority({ pool, origin: 'simulated', clock: () => now });
  const ledger = () => new RaidObservationLedger({ pool, origin: 'simulated', clock: () => now,
    moment: async () => ({ http: 202, body: { status: 'accepted' } }) });
  const record = async (id: string, kingdomId = '201', viewers = 3) => ledger().record(RaidObservationSchema.parse({
    version: 1, id, origin: 'simulated', direction: 'incoming', kingdomId, occurredAt: now, receivedAt: now,
    from: { kingdomId: '101', login: 'raider', name: 'Raider' }, to: { kingdomId, login: 'host', name: 'Host' }, viewers,
  }));
  const person = async (personId: string) => {
    const sessionId = randomUUID();
    await pool.query(`insert into realm_persons (person_id, origin, identity_issuer) values ($1, 'simulated', 'test-oidc')`, [personId]);
    await pool.query(`insert into realm_sessions (session_id, handle_hash, person_id, origin, resume_scope, created_at, expires_at)
      values ($1, $2, $3, 'simulated', $4, $5, $6)`, [sessionId, randomBytes(32), personId, randomUUID(), new Date(now), new Date(now + 86_400_000)]);
    return sessionId;
  };
  const entry = async (personId: string, sessionId: string, kingdomId = '201') => {
    const entryId = randomUUID();
    await pool.query(`insert into realm_entries (entry_id, session_id, person_id, kingdom_id, origin, opened_at)
      values ($1, $2, $3, $4, 'simulated', $5)`, [entryId, sessionId, personId, kingdomId, new Date(now)]);
    return entryId;
  };
  const deed = async (personId: string, kingdomId: string) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set constraints all deferred');
      await client.query(`insert into realm_layout_heads values ($1, 'simulated', 'r1', 'seed', 2020, $2, $2)
        on conflict (kingdom_id) do nothing`, [kingdomId, now]);
      await client.query(`insert into realm_layouts values ($1, 'r1', null, '{}', $2, $3)
        on conflict (kingdom_id, revision) do nothing`, [kingdomId, 'a'.repeat(64), now]);
      await client.query(`insert into realm_layout_plots values ($1, 'r1', $2, $3, 2020, 'row', 0, '{}')`, [kingdomId, personId, Number(personId)]);
      await client.query(`insert into realm_deed_holders values ($1, 'simulated', 1, $2) on conflict (person_id) do nothing`, [personId, now]);
      const id = randomBytes(16).toString('hex');
      await client.query(`insert into realm_deeds (deed_id, receipt, person_id, kingdom_id, origin, layout_revision, plot_id, slot,
        placement, tenure, evidence, status, allocated_ms) values ($1, $2, $3, $4, 'simulated', 'r1', $3, $5, '{}', '{}', '{}', 'pending', $6)`,
      [id, `deed:${randomBytes(32).toString('hex')}`, personId, kingdomId, Number(personId), now]);
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  };
  const begin = (raidId: string, personId: string, sessionId: string, kingdomId = '201') =>
    authority().begin({ version: 1, origin: 'simulated', raidId, kingdomId, personId, sessionId });
  const arrive = (entryId: string, personId: string, kingdomId = '201') =>
    authority().arrived({ version: 1, origin: 'simulated', entryId, personId, kingdomId, at: now });

  it('requires both a pending invitation and the matching committed entry; persists exactly once under concurrent retries', async () => {
    const { raidId } = await record('guest-once');
    const session = await person('501');
    const naked = await entry('501', session);
    expect(await arrive(naked, '501')).toMatchObject({ status: 'refused' });
    expect((await authority().history('501')).items).toHaveLength(0);
    now += 1;
    expect(await begin(raidId, '501', session)).toMatchObject({ status: 'pending', invitation: { raidId, kingdomId: '201', from: { kingdomId: '101' } } });
    // An entry opened before intent cannot serve as proof.
    expect(await arrive(naked, '501')).toMatchObject({ status: 'refused' });
    now += 1;
    const committed = await entry('501', session);
    expect(await arrive(committed, '502')).toMatchObject({ status: 'refused' });
    expect(await arrive(committed, '501', '202')).toMatchObject({ status: 'refused' });
    const results = await Promise.all([arrive(committed, '501'), arrive(committed, '501')]);
    expect(results.map(r => r.status).sort()).toEqual(['accepted', 'duplicate']);
    expect(await arrive(committed, '501')).toMatchObject({ status: 'duplicate' });
    const history = await authority().history('501');
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ kind: 'visit', kingdomId: '201', raidId: null });
  });

  it('rejects unknown, expired and cross-origin invitations and revoked or mismatched sessions', async () => {
    const { raidId } = await record('guest-expiry');
    const session = await person('503');
    expect(await begin(`raid.${'a'.repeat(64)}`, '503', session)).toMatchObject({ status: 'refused' });
    expect(await begin(raidId, '504', session)).toMatchObject({ status: 'refused', reason: 'session' });
    await expect(authority().begin({ version: 1, origin: 'live', raidId, kingdomId: '201', sessionId: session, personId: '503' })).rejects.toMatchObject({ kind: 'origin' });
    await pool.query("update realm_sessions set revoked_at = $2, revoked_reason = 'signout' where session_id = $1", [session, new Date(now)]);
    expect(await begin(raidId, '503', session)).toMatchObject({ status: 'refused', reason: 'session' });
    const other = await person('505');
    now += 600_000;
    expect(await begin(raidId, '505', other)).toMatchObject({ status: 'refused', reason: 'expired' });
    expect((await authority().history('505')).items).toHaveLength(0);
  });

  it('keeps a confirmed guest chat as a visit rather than inventing a raid ride', async () => {
    const { raidId } = await record('guest-chat');
    const session = await person('506');
    expect(await begin(raidId, '506', session)).toMatchObject({ status: 'pending' });
    now += 1;
    const committed = await entry('506', session);
    expect(await arrive(committed, '506')).toMatchObject({ status: 'accepted' });
    const message = { version: 1 as const, origin: 'simulated' as const, kingdomId: '201', personId: '506', messageId: 'guest-message', at: now };
    expect(await authority().chat(message)).toMatchObject({ status: 'accepted', presentation: {
      origin: 'simulated', kingdomId: '201', personId: '506', messageId: 'guest-message', at: now,
      proofMessageId: 'guest-message', proofAt: now, raid: { raidId, fromKingdomId: '101', fromName: 'Raider' },
    } });
    expect(await authority().chat(message)).toMatchObject({ status: 'duplicate', presentation: { messageId: 'guest-message', proofAt: now } });
    expect((await authority().history('506')).items.map(i => i.kind)).toEqual(['visit']);
    const outsider = await person('507');
    expect(outsider).toBeTruthy();
    expect(await authority().chat({ ...message, personId: '507', messageId: 'outsider' })).toMatchObject({ status: 'ignored' });
    expect((await authority().history('507')).items).toHaveLength(0);
  });

  it('refuses an invitation home and retains source citizen chat history with the daily reward cap', async () => {
    const session = await person('508');
    await deed('508', '101');
    await deed('508', '201');
    const homeRaid = await record('citizen-home');
    expect(await begin(homeRaid.raidId, '508', session)).toMatchObject({ status: 'refused', reason: 'citizen_here' });
    expect((await authority().history('508')).items).toHaveLength(0);

    const sourceSession = await person('509');
    expect(sourceSession).toBeTruthy();
    await deed('509', '101');
    for (let i = 0; i < 4; i++) {
      now += 601_000;
      await record(`citizen-ride-${i}`, '202', i === 0 ? 2 : 3);
      expect(await authority().chat({ version: 1, origin: 'simulated', kingdomId: '202', personId: '509', messageId: `citizen-chat-${i}`, at: now })).toMatchObject({ status: 'accepted' });
    }
    const rides = (await authority().history('509')).items.filter(item => item.kind === 'raid');
    expect(rides).toHaveLength(4);
    expect(rides.filter(item => item.reward.eligible)).toHaveLength(2);
    expect(rides.filter(item => !item.reward.eligible)).toHaveLength(2);
  });

  it('withholds allocation during pending intent without inventing a guest or visit, including departure before arrival', async () => {
    const { raidId } = await record('pending-departure');
    const sessionId = await person('510');
    const read = { version: 1, origin: 'simulated', sessionId, personId: '510', kingdomId: '201' };
    expect(await begin(raidId, '510', sessionId)).toMatchObject({ status: 'pending' });
    expect(await authority().visitors('201', ['510'], now)).toEqual(['510']);
    expect(await authority().guest(read)).toBeNull();
    expect((await authority().history('510')).items).toHaveLength(0);
    now += 1;
    const entryId = await entry('510', sessionId);
    const receipt = { version: 1, origin: 'simulated', entryId, personId: '510', kingdomId: '201', at: now };
    expect(await authority().departed(receipt)).toMatchObject({ status: 'accepted' });
    expect(await authority().departed(receipt)).toMatchObject({ status: 'duplicate' });
    await authority().arrived(receipt);
    expect(await authority().guest({ ...read, entryId })).toBeNull();
    // Intent expires at the raid window, independently of the departure tombstone.
    now += 600_000;
    expect(await authority().visitors('201', ['510'], now)).toEqual([]);
  });

  it('exposes a committed guest until the matching departure', async () => {
    const { raidId } = await record('arrival-departure');
    const sessionId = await person('514');
    expect(await begin(raidId, '514', sessionId)).toMatchObject({ status: 'pending' });
    now += 1;
    const entryId = await entry('514', sessionId);
    const read = { version: 1, origin: 'simulated', sessionId, personId: '514', kingdomId: '201', entryId };
    expect(await arrive(entryId, '514')).toMatchObject({ status: 'accepted' });
    expect(await authority().guest(read)).toMatchObject({ raidId, kingdomId: '201' });
    expect(await authority().visitors('201', ['514'], now)).toEqual(['514']);
    expect(await authority().departed({ version: 1, origin: 'simulated', entryId, personId: '514', kingdomId: '201', at: now })).toMatchObject({ status: 'accepted' });
    expect(await authority().guest(read)).toBeNull();
    expect((await authority().history('514')).items).toHaveLength(1);
  });

  it('expires a crashed room lease, accepts trusted heartbeats, and never renews by repeating arrival', async () => {
    const { raidId } = await record('room-lease', '208');
    const sessionId = await person('515');
    expect(await begin(raidId, '515', sessionId, '208')).toMatchObject({ status: 'pending' });
    now += 1;
    const entryId = await entry('515', sessionId, '208');
    const receipt = { version: 1, origin: 'simulated', entryId, personId: '515', kingdomId: '208', at: now };
    const read = { version: 1, origin: 'simulated', entryId, sessionId, personId: '515', kingdomId: '208' };
    expect(await authority().arrived(receipt)).toMatchObject({ status: 'accepted' });
    await expect(deed('515', '208')).rejects.toMatchObject({ code: 'RG001' });
    now += 89_999;
    expect(await authority().present({ ...receipt, personId: '516', at: now })).toMatchObject({ status: 'refused' });
    expect(await authority().present({ ...receipt, at: now })).toMatchObject({ status: 'accepted' });
    expect(await authority().present({ ...receipt, at: now })).toMatchObject({ status: 'duplicate' });
    now += 89_999;
    expect(await authority().guest(read)).not.toBeNull();
    expect(await authority().arrived(receipt)).toMatchObject({ status: 'duplicate' });
    now += 1;
    expect(await authority().guest(read)).toBeNull();
    expect(await authority().visitors('208', ['515'], now)).toEqual([]);
    await deed('515', '208');
    expect((await pool.query("select status from realm_deeds where person_id = '515' and kingdom_id = '208'")).rows).toEqual([{ status: 'pending' }]);
  });

  it('blocks new homes for pending and chat visitors while permitting ordinary homes and updates', async () => {
    const { raidId } = await record('deed-guard', '209');
    const sessionId = await person('516');
    expect(await begin(raidId, '516', sessionId, '209')).toMatchObject({ status: 'pending' });
    await expect(deed('516', '209')).rejects.toMatchObject({ code: 'RG001' });
    expect((await pool.query("select count(*)::int as count from realm_deeds where person_id = '516' and kingdom_id = '209'")).rows[0].count).toBe(0);
    await person('517');
    await deed('517', '101');
    expect(await authority().chat({ version: 1, origin: 'simulated', kingdomId: '209', personId: '517', messageId: 'deed-guard-chat', at: now })).toMatchObject({ status: 'accepted' });
    await expect(deed('517', '209')).rejects.toMatchObject({ code: 'RG001' });
    await pool.query("update realm_deeds set install_command = 'command' where person_id = '517' and kingdom_id = '101'");
    await person('518');
    await deed('518', '209');
    expect((await pool.query("select count(*)::int as count from realm_deeds where person_id = '518' and kingdom_id = '209'")).rows[0].count).toBe(1);
  });

  it('serializes a READ COMMITTED allocation against a racing invitation', async () => {
    const { raidId } = await record('allocation-race', '210');
    const sessionId = await person('519');
    await deed('519', '101');
    await person('520');
    await deed('520', '210');
    const client = await pool.connect();
    try {
      await client.query('begin isolation level read committed');
      await client.query("update realm_raid_guest_heads set lock_revision = lock_revision + 1 where origin = 'simulated' and person_id = '519'");
      const invitation = begin(raidId, '519', sessionId, '210');
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        const result = await pool.query("select 1 from pg_stat_activity where wait_event_type = 'Lock' and query like '%INSERT INTO realm_raid_guest_heads%' and pid <> pg_backend_pid()");
        blocked = result.rowCount !== 0;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await client.query("insert into realm_layout_plots values ('210', 'r1', '519', 519, 2020, 'row', 0, '{}')");
      await client.query(`insert into realm_deeds (deed_id, receipt, person_id, kingdom_id, origin, layout_revision, plot_id, slot,
        placement, tenure, evidence, status, allocated_ms) values ($1, $2, '519', '210', 'simulated', 'r1', '519', 519, '{}', '{}', '{}', 'pending', $3)`,
      [randomBytes(16).toString('hex'), `deed:${randomBytes(32).toString('hex')}`, now]);
      await client.query('commit');
      expect(await invitation).toMatchObject({ status: 'refused', reason: 'citizen_here' });
      expect((await pool.query("select count(*)::int as count from realm_deeds where person_id = '519' and kingdom_id = '210'")).rows[0].count).toBe(1);
    } finally { await client.query('rollback').catch(() => {}); client.release(); }
  });

  it('rejects a READ COMMITTED allocation that waited for a concurrently committed invitation', async () => {
    const { raidId } = await record('invitation-race', '211');
    const sessionId = await person('521');
    let releaseCommit!: () => void, reachedCommit!: () => void;
    const gate = new Promise<void>(resolve => { releaseCommit = resolve; });
    const ready = new Promise<void>(resolve => { reachedCommit = resolve; });
    const gatedPool = { connect: async () => {
      const client = await pool.connect();
      return {
        query: async (sql: string, values?: unknown[]) => {
          if (sql === 'commit') { reachedCommit(); await gate; }
          return client.query(sql, values);
        },
        release: (destroy?: boolean | Error) => client.release(destroy),
      };
    } };
    const pending = new RaidGuestAuthority({ pool: gatedPool, origin: 'simulated', clock: () => now })
      .begin({ version: 1, origin: 'simulated', raidId, kingdomId: '211', sessionId, personId: '521' });
    await ready;
    const allocation = deed('521', '211').then(() => null, error => error as { code?: string });
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        const result = await pool.query("select 1 from pg_stat_activity where wait_event_type = 'Lock' and query like '%insert into realm_deeds%' and pid <> pg_backend_pid()");
        blocked = result.rowCount !== 0;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
    } finally { releaseCommit(); }
    expect(await pending).toMatchObject({ status: 'pending' });
    expect(await allocation).toMatchObject({ code: 'RG001' });
    expect((await pool.query("select count(*)::int as count from realm_deeds where person_id = '521' and kingdom_id = '211'")).rows[0].count).toBe(0);
  });

  it('extends a source chat visit past the raid window only while chat remains within the lease', async () => {
    await person('511');
    await deed('511', '101');
    await record('lease-raid', '203');
    now += 599_999;
    const message = { version: 1, origin: 'simulated', kingdomId: '203', personId: '511', messageId: 'lease-first', at: now };
    const first = await authority().chat(message);
    expect(first).toMatchObject({ status: 'accepted', stamp: { kind: 'raid' }, presentation: {
      messageId: 'lease-first', at: message.at, proofMessageId: 'lease-first', proofAt: message.at,
    } });
    const history = await authority().history('511');
    expect(history.items).toHaveLength(1);
    now += 2;
    const continued = await authority().chat({ ...message, messageId: 'lease-next', at: now });
    expect(continued).toMatchObject({ status: 'accepted', stamp: history.items[0], presentation: {
      messageId: 'lease-next', at: now, proofMessageId: 'lease-first', proofAt: message.at,
    } });
    expect(await authority().chat({ ...message, messageId: 'lease-next', at: now }))
      .toMatchObject({ status: 'duplicate', presentation: { messageId: 'lease-next', at: now, proofMessageId: 'lease-first', proofAt: message.at } });
    expect(await authority().history('511')).toEqual(history);
    now += 89_999;
    expect(await authority().visitors('203', ['511'], now)).toEqual(['511']);
    now += 1;
    expect(await authority().visitors('203', ['511'], now)).toEqual([]);
    expect(await authority().chat({ ...message, messageId: 'lease-expired', at: now })).toMatchObject({ status: 'ignored' });
    expect(await authority().history('511')).toEqual(history);
  });

  it('awards source citizen chat even when the person also has a destination home', async () => {
    await person('512');
    await deed('512', '101');
    await deed('512', '204');
    await record('both-homes', '204');
    expect(await authority().chat({ version: 1, origin: 'simulated', kingdomId: '204', personId: '512', messageId: 'both-homes-chat', at: now }))
      .toMatchObject({ status: 'accepted', guest: null, stamp: { kind: 'raid', kingdomId: '204' } });
    expect(await authority().visitors('204', ['512'], now)).toEqual([]);
  });

  it('serializes reward slots across concurrent qualifying raids for the same citizen', async () => {
    await person('513');
    await deed('513', '101');
    for (const kingdom of ['205', '206', '207']) await record(`concurrent-${kingdom}`, kingdom);
    const results = await Promise.all(['205', '206', '207'].map(kingdomId => authority().chat({
      version: 1, origin: 'simulated', kingdomId, personId: '513', messageId: `concurrent-${kingdomId}`, at: now,
    })));
    expect(results.map(result => result.status)).toEqual(['accepted', 'accepted', 'accepted']);
    const history = await authority().history('513');
    expect(history.items).toHaveLength(3);
    expect(history.items.filter(item => item.reward.eligible)).toHaveLength(2);
    expect(history.items.filter(item => !item.reward.eligible)).toHaveLength(1);
  });
});
