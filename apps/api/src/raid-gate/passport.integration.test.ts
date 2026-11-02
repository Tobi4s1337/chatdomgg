import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateRealmSchema } from '../../../realm/src/persistence/migrate';
import { RaidGuestAuthority } from '../../../realm/src/raid-gate/guests';
import { RaidObservationLedger } from '../../../realm/src/raid-gate/observations';
import type { CardSource } from '../citizen-card/contracts';
import { createPassportReader, type PassportPorts } from '../passport/read';
import { simulatedPassportAuthorities } from '../passport/simulated';
import type { RealmAuthConfig } from '../realm-auth/config';
import { csrfFor, sha256 } from '../realm-auth/secrets';
import type { PersonId } from './contracts';
import { RaidObservationSchema } from './observations';
import { cardTravels, createPostgresGatePassportStore, gateCrest, gatePassportPorts } from './passport';
import { RAID_PASSPORT_TRAVELS_ROUTE } from './passport-contracts';
import { handleRaidPassport } from './passport-http';

const start = 1_800_000_000_000;
const ORIGIN = 'http://127.0.0.1:5199';

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('raid passport stamps on isolated Postgres', () => {
  const schema = `realm_test_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pool: pg.Pool, server: Server, base = '', now = start;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL');
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    expect(await migrateRealmSchema(admin, schema)).toContain('0011f_realm_raid_passport');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: `-c search_path="${schema}"` });
    const config = { mode: 'simulated', publicOrigin: ORIGIN, secureCookies: false } as RealmAuthConfig;
    server = createServer((request, response) => {
      void handleRaidPassport(request, response, { pool, config, clock: () => now }).then(handled => { if (!handled) response.writeHead(404).end(); });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise(resolve => server?.close(resolve));
    await pool?.end();
    if (admin) { await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); }
  });

  const authority = () => new RaidGuestAuthority({ pool, origin: 'simulated', clock: () => now });
  const ledger = () => new RaidObservationLedger({ pool, origin: 'simulated', clock: () => now, moment: async () => ({ http: 202, body: { status: 'accepted' } }) });
  const record = (id: string, from: { kingdomId: string; name: string }, to: { kingdomId: string; name: string }, viewers = 12) =>
    ledger().record(RaidObservationSchema.parse({
      version: 1, id, origin: 'simulated', direction: 'incoming', kingdomId: to.kingdomId, occurredAt: now, receivedAt: now,
      from: { ...from, login: from.name.toLowerCase().replace(/\W/gu, '') }, to: { ...to, login: to.name.toLowerCase().replace(/\W/gu, '') }, viewers,
    }));
  const person = async (personId: string, handle = randomBytes(24).toString('base64url')) => {
    const sessionId = randomUUID();
    await pool.query(`insert into realm_persons (person_id, origin, identity_issuer) values ($1, 'simulated', 'test-oidc') on conflict do nothing`, [personId]);
    await pool.query(`insert into realm_sessions (session_id, handle_hash, person_id, origin, resume_scope, created_at, expires_at)
      values ($1, $2, $3, 'simulated', $4, $5, $6)`, [sessionId, sha256(handle), personId, randomUUID(), new Date(now), new Date(now + 86_400_000)]);
    return { sessionId, handle };
  };
  const entry = async (personId: string, sessionId: string, kingdomId: string) => {
    const entryId = randomUUID();
    await pool.query(`insert into realm_entries (entry_id, session_id, person_id, kingdom_id, origin, opened_at)
      values ($1, $2, $3, $4, 'simulated', $5)`, [entryId, sessionId, personId, kingdomId, new Date(now)]);
    return entryId;
  };
  /** The book the card reads, through the real reader over the gate's Postgres store and a host card source. */
  const readerFor = (personId: string) => {
    const sim = simulatedPassportAuthorities('none', { signedIn: true, travelsHidden: false });
    const store = createPostgresGatePassportStore({ pool, origin: 'simulated' });
    const key = { ...sim.key, personId } as typeof sim.key;
    const card = async (): Promise<CardSource> => {
      const source = sim.card();
      const travels = cardTravels(await store.choice(personId as PersonId), source.document.revision.person);
      return { ...source, travelsHidden: travels.travelsHidden,
        document: { ...source.document, key, revision: { ...source.document.revision, person: travels.personRevision } } };
    };
    const empty = { revision: 0, items: [], nextCursor: null } as const;
    const ports: PassportPorts = { ...gatePassportPorts(store), origin: 'simulated', card, bonds: async () => empty, keepsakes: async () => empty };
    const reader = createPassportReader(ports);
    return (request: unknown) => reader.handle({ key, now: now + 1, signal: new AbortController().signal }, request);
  };
  const choose = (handle: string, travels: 'shown' | 'hidden', csrf = csrfFor(handle)) => fetch(`${base}${RAID_PASSPORT_TRAVELS_ROUTE}`, {
    method: 'POST', headers: { cookie: `chatdom_session=${handle}`, origin: ORIGIN, 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ version: 1, travels }),
  });

  it('puts a walk-in and a ride from witnessed evidence into the book, in each kingdom’s Atlas arms, and hides them on the holder’s word', async () => {
    const host = { kingdomId: '129634568', name: 'tobi4s_' }, raider = { kingdomId: '4363967', name: 'MashaD4' };
    // A raider who walked in with the raid through its welcome: a visit stamp.
    const { raidId } = await record('passport-walk', raider, host);
    const walker = await person('7001');
    now += 1_000;
    expect(await authority().begin({ version: 1, origin: 'simulated', raidId, kingdomId: host.kingdomId, personId: '7001', sessionId: walker.sessionId }))
      .toMatchObject({ status: 'pending' });
    now += 1_000;
    const entered = await entry('7001', walker.sessionId, host.kingdomId);
    expect(await authority().arrived({ version: 1, origin: 'simulated', entryId: entered, personId: '7001', kingdomId: host.kingdomId, at: now }))
      .toMatchObject({ status: 'accepted', stamp: { kind: 'visit' } });

    const read = readerFor('7001');
    const book = await read({ op: 'book' });
    if (book.kind !== 'book' || book.book.visibility !== 'visible') throw new Error(JSON.stringify(book));
    expect(book.book.stamps.items).toHaveLength(1);
    expect(book.book.stamps.items[0]).toMatchObject({ kind: 'visit', kingdom: { kingdomId: host.kingdomId, name: 'tobi4s_', crest: gateCrest(host.kingdomId)! } });
    expect(book.book.kingdoms.items.map(visit => visit.kingdom.name)).toEqual(['tobi4s_']);

    // Unauthenticated, cross-origin or tokenless asks change nothing.
    expect((await fetch(`${base}${RAID_PASSPORT_TRAVELS_ROUTE}`)).status).toBe(401);
    expect((await choose(walker.handle, 'hidden', 'forged')).status).toBe(403);
    expect((await fetch(`${base}${RAID_PASSPORT_TRAVELS_ROUTE}`, { headers: { cookie: `chatdom_session=${walker.handle}` } }).then(r => r.json())))
      .toEqual({ version: 1, origin: 'simulated', travels: 'shown', revision: 0 });

    now += 1_000;
    const hidden = await choose(walker.handle, 'hidden');
    expect(hidden.status).toBe(200);
    expect(await hidden.json()).toEqual({ version: 1, origin: 'simulated', travels: 'hidden', revision: now });
    const closed = await read({ op: 'book' });
    expect(closed).toEqual({ kind: 'book', book: { version: 1, origin: 'simulated', visibility: 'hidden' } });
    expect(await read({ op: 'page', collection: 'stamps', cursor: 'gate-stamps.9', revision: book.book.revision })).toEqual(closed);
    // The history stays; only its projections are closed.
    expect((await authority().history('7001')).items).toHaveLength(1);

    now += 1_000;
    expect(await (await choose(walker.handle, 'shown')).json()).toMatchObject({ travels: 'shown', revision: now });
    const reopened = await read({ op: 'book' });
    expect(reopened).toMatchObject({ kind: 'book', book: { visibility: 'visible' } });
  });

  it('records a source citizen’s ride as a raid stamp on the witnessed road, never with an invented leader', async () => {
    const home = { kingdomId: '910000501', name: 'Larkspur Hollow' }, destination = { kingdomId: '910000502', name: 'Thornwick' };
    const rider = await person('7002');
    expect(rider).toBeTruthy();
    // A citizen of the raiding kingdom: a deed there.
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set constraints all deferred');
      await client.query(`insert into realm_layout_heads values ($1, 'simulated', 'r1', 'seed', 2020, $2, $2) on conflict (kingdom_id) do nothing`, [home.kingdomId, now]);
      await client.query(`insert into realm_layouts values ($1, 'r1', null, '{}', $2, $3) on conflict (kingdom_id, revision) do nothing`, [home.kingdomId, 'a'.repeat(64), now]);
      await client.query(`insert into realm_layout_plots values ($1, 'r1', $2, $3, 2020, 'row', 0, '{}')`, [home.kingdomId, '7002', 7002]);
      await client.query(`insert into realm_deed_holders values ($1, 'simulated', 1, $2) on conflict (person_id) do nothing`, ['7002', now]);
      await client.query(`insert into realm_deeds (deed_id, receipt, person_id, kingdom_id, origin, layout_revision, plot_id, slot,
        placement, tenure, evidence, status, allocated_ms) values ($1, $2, $3, $4, 'simulated', 'r1', $3, $5, '{}', '{}', '{}', 'pending', $6)`,
      [randomBytes(16).toString('hex'), `deed:${randomBytes(32).toString('hex')}`, '7002', home.kingdomId, 7002, now]);
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    now += 60_000;
    const { raidId } = await record('passport-ride', home, destination);
    now += 30_000;
    expect(await authority().chat({ version: 1, origin: 'simulated', kingdomId: destination.kingdomId, personId: '7002', messageId: 'passport-ride-chat', at: now }))
      .toMatchObject({ status: 'accepted', stamp: { kind: 'raid' } });
    const book = await readerFor('7002')({ op: 'book' });
    if (book.kind !== 'book' || book.book.visibility !== 'visible') throw new Error(JSON.stringify(book));
    expect(book.book.stamps.items).toEqual([expect.objectContaining({
      kind: 'raid', raidId, road: { id: raidId, from: home.kingdomId, to: destination.kingdomId }, leader: null, gifts: [],
      kingdom: { kingdomId: destination.kingdomId, name: 'Thornwick', crest: gateCrest(destination.kingdomId)! },
    })]);
  });
});
