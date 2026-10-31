import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type KingdomId } from '../../../../packages/shared/src/identity';
import type { HelixReader } from '../../../../packages/twitch/src/helix';
import { TWITCH_OIDC_ISSUER } from '../realm-auth/oidc';
import { token } from './guard';
import { createHelixLiveChannels, createRealmGatePolicy, type HelixStreamsReader, type RealmGatePolicyDeps } from './policy';
import { createPostgresRaidGateRepository, RaidGateStorageError, type SqlPool } from './postgres-repository';
import type { RaidActionRecord } from './repository';
import { createRealmSessionAuthenticator, gateKingdomFromPath, kingdomFromGatePath, type SqlQueryable } from './session';
import { createPreviewTokens, toWebRequest, writeWebResponse } from './service';

const SOURCE = KingdomIdSchema.parse('41000001');
const MIRA = KingdomIdSchema.parse('41000002');
const MONARCH = PersonIdSchema.parse('41000001');
const WREN = PersonIdSchema.parse('52000001');
const OAK = PersonIdSchema.parse('52000002');
const SESSION = '0b6f8f9e-6a44-4c1e-9d55-3f1f3c2a9e11';
const ORIGIN = 'http://localhost:5190';
const live = () => new AbortController().signal;

const action = (revision: number, requestId = 'r1'): RaidActionRecord => ({
  requestId, revision, actorId: MONARCH, sessionId: SESSION, from: SOURCE, to: MIRA,
  target: { kingdomId: MIRA, founded: true, live: true, classification: 'general' }, state: 'prepared',
  previewTokenHash: 'a'.repeat(64), previewExpiresAt: 1_800_000_120_000, optedIn: 0,
  createdAt: 1_800_000_000_000, updatedAt: 1_800_000_000_000, observedAt: 1_800_000_000_000, raid: null, endReason: null, origin: 'simulated',
});
const row = (record: { revision: number }) => ({ revision: String(record.revision), record: JSON.stringify(record) });

type Reply = { rows?: unknown[]; rowCount?: number } | Error | undefined;
/** A pg pool double: records every statement per connection and answers from a script. */
function fakePool(script: (sql: string, params: readonly unknown[], connection: number) => Reply) {
  const log: { sql: string; params: readonly unknown[]; connection: number }[] = [];
  const released: unknown[] = [];
  let connections = 0;
  const pool: SqlPool = {
    async connect() {
      const connection = ++connections;
      return {
        async query(text: string, params: unknown[] = []) {
          const sql = text.replace(/\s+/g, ' ').trim();
          log.push({ sql, params, connection });
          const reply = script(sql, params, connection);
          if (reply instanceof Error) throw reply;
          return { rows: reply?.rows ?? [], rowCount: reply?.rowCount ?? reply?.rows?.length ?? 0 };
        },
        release(destroy?: boolean | Error) { released.push(destroy); },
      };
    },
  };
  const statements = () => log.map(entry => entry.sql.split(' ')[0]);
  return { pool, log, released, statements, get connections() { return connections; } };
}
const failure = (code: string) => Object.assign(new Error(`postgres ${code}`), { code });

describe('Postgres Raid Gate repository', () => {
  it('returns what is stored now when a compare-and-set loses, and writes nothing else', async () => {
    const db = fakePool(sql => {
      if (sql.startsWith('update') || sql.startsWith('insert')) return { rowCount: 0 };
      if (sql.startsWith('select')) return { rows: [row(action(3))] };
      return undefined;
    });
    const repository = createPostgresRaidGateRepository({ pool: db.pool });
    const results = await repository.transaction(async tx => [
      await tx.putAction(action(2), 1),
      await tx.putAction(action(1), 0),
      // Not exactly one higher: refused without attempting the write.
      await tx.putAction(action(5), 1),
    ], live());
    for (const result of results) expect(result).toEqual({ kind: 'conflict', current: action(3) });
    expect(db.statements()).toEqual(['begin', 'update', 'select', 'insert', 'select', 'select', 'commit']);
    const update = db.log[1]!;
    expect(update.sql).toMatch(/where request_id = \$1 and revision = \$8$/);
    expect(update.params.at(-1)).toBe(1);
    expect(db.log[3]!.sql).toMatch(/on conflict do nothing$/);
    expect(db.released).toEqual([undefined]);
  });

  it('throws on a stored row that fails its reader, and never writes a malformed record', async () => {
    for (const stored of [{ revision: '1', record: '{"requestId":"r1"}' }, { revision: '1', record: 'not json' }, row(action(1, 'r2')), { ...row(action(2)), revision: '1' }]) {
      const db = fakePool(sql => sql.startsWith('select') ? { rows: [stored] } : undefined);
      const repository = createPostgresRaidGateRepository({ pool: db.pool });
      await expect(repository.transaction(tx => tx.getAction('r1'), live())).rejects.toBeInstanceOf(RaidGateStorageError);
      expect(db.statements()).toEqual(['begin', 'select', 'rollback']);
      expect(db.released).toHaveLength(1);
    }
    const db = fakePool(() => undefined);
    const repository = createPostgresRaidGateRepository({ pool: db.pool });
    const malformed = { ...action(1), state: 'flying' } as unknown as RaidActionRecord;
    await expect(repository.transaction(tx => tx.putAction(malformed, 0), live())).rejects.toBeInstanceOf(RaidGateStorageError);
    expect(db.statements()).toEqual(['begin', 'rollback']);
  });

  it('reruns the whole transaction on a serialization failure, and gives up after three attempts', async () => {
    const flaky = fakePool((sql, _params, connection) => sql === 'commit' && connection === 1 ? failure('40001') : sql.startsWith('insert') ? { rowCount: 1 } : undefined);
    const work = vi.fn(async (tx: Parameters<Parameters<ReturnType<typeof createPostgresRaidGateRepository>['transaction']>[0]>[0]) => tx.putAction(action(1), 0));
    expect(await createPostgresRaidGateRepository({ pool: flaky.pool }).transaction(work, live())).toEqual({ kind: 'stored', record: action(1) });
    expect(work).toHaveBeenCalledTimes(2);
    expect(flaky.statements()).toEqual(['begin', 'insert', 'commit', 'rollback', 'begin', 'insert', 'commit']);
    expect(flaky.released).toHaveLength(2);

    const stuck = fakePool(sql => sql === 'commit' ? failure('40P01') : undefined);
    await expect(createPostgresRaidGateRepository({ pool: stuck.pool }).transaction(async () => 'never', live())).rejects.toThrow(/3 attempts/);
    expect(stuck.connections).toBe(3);
    expect(stuck.released).toHaveLength(3);
  });

  it('rolls back and rejects with the reason when aborted before commit', async () => {
    const db = fakePool(sql => sql.startsWith('insert') ? { rowCount: 1 } : undefined);
    const controller = new AbortController();
    const reason = new Error('the viewer left');
    await expect(createPostgresRaidGateRepository({ pool: db.pool }).transaction(async tx => {
      await tx.putAction(action(1), 0);
      controller.abort(reason);
      return 'done';
    }, controller.signal)).rejects.toBe(reason);
    expect(db.statements()).toEqual(['begin', 'insert', 'rollback']);
    expect(db.released).toEqual([undefined]);
  });
});

describe('realm session authenticator', () => {
  const hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
  const SESSIONS = new Map([
    [hex('handle-monarch'), { session_id: SESSION, person_id: MONARCH, origin: 'simulated' }],
    [hex('handle-wren'), { session_id: '1c3b7e0a-2f4d-4b8e-8a1f-6d5e4c3b2a10', person_id: WREN, origin: 'simulated' }],
    [hex('handle-oak'), { session_id: '7d1a2b3c-4e5f-4a6b-9c7d-8e9f0a1b2c3d', person_id: OAK, origin: 'simulated' }],
  ]);
  /** Answers like the realm schema: kingdoms of one origin, and Wren's deed in the source. */
  function realm() {
    const calls: unknown[][] = [];
    const pool: SqlQueryable = {
      async query(_sql, params = []) {
        calls.push(params);
        const [hash, origin, kingdomId] = params as [Buffer, string, string];
        const session = SESSIONS.get(hash.toString('hex'));
        if (!session || session.origin !== origin) return { rows: [] };
        return { rows: [{ session_id: session.session_id, person_id: session.person_id, kingdom: [SOURCE, MIRA].includes(kingdomId as KingdomId) && origin === 'simulated', citizen: kingdomId === SOURCE && session.person_id === WREN }] };
      },
    };
    return { pool, calls };
  }
  const authenticator = (pool: SqlQueryable, origin: 'live' | 'simulated' = 'simulated') =>
    createRealmSessionAuthenticator({ pool, origin, sessionCookie: 'chatdom_session', kingdomOf: gateKingdomFromPath('/api/raid-gate') });
  const request = (cookie: string | null, kingdom: string = SOURCE, init: RequestInit = {}) =>
    new Request(`${ORIGIN}/api/raid-gate/${kingdom}`, { ...init, headers: { ...(cookie === null ? {} : { cookie }), ...init.headers as Record<string, string> } });

  it('refuses a missing, oversized or foreign session, and an unknown kingdom', async () => {
    const { pool, calls } = realm();
    const auth = authenticator(pool);
    expect(await auth(request(null), live())).toBeNull();
    expect(await auth(request(`chatdom_session=${'x'.repeat(129)}`), live())).toBeNull();
    expect(await auth(request(`__Host-chatdom_session=handle-monarch`), live())).toBeNull();
    expect(await auth(request('chatdom_session=handle-monarch', 'gate'), live())).toBeNull();
    expect(calls).toHaveLength(0);
    expect(await authenticator(pool, 'live')(request('chatdom_session=handle-monarch'), live())).toBeNull();
    expect(await auth(request('chatdom_session=handle-stolen'), live())).toBeNull();
    expect(await auth(request('chatdom_session=handle-monarch', '41000009'), live())).toBeNull();
    // The handle itself never reaches the database, only its SHA-256.
    expect(calls.every(([hash]) => Buffer.isBuffer(hash) && hash.length === 32)).toBe(true);
  });

  it('derives monarch, citizen and guest on the server and never reads the body', async () => {
    const auth = authenticator(realm().pool);
    const monarch = await auth(request('theme=night; chatdom_session=handle-monarch'), live());
    expect(monarch).toEqual({ personId: MONARCH, sessionId: SESSION, sourceKingdomId: SOURCE, sourceRole: 'monarch' });
    expect(token(monarch?.sessionId)).toBe(SESSION);
    expect(await auth(request('chatdom_session=handle-monarch', MIRA), live())).toMatchObject({ sourceKingdomId: MIRA, sourceRole: 'guest' });
    expect(await auth(request('chatdom_session=handle-wren'), live())).toMatchObject({ personId: WREN, sourceRole: 'citizen' });
    const forged = request('chatdom_session=handle-oak; chatdom_session=handle-monarch', SOURCE, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'gate', personId: MONARCH, sourceRole: 'monarch', sessionId: SESSION }),
    });
    expect(await auth(forged, live())).toMatchObject({ personId: OAK, sourceRole: 'guest' });
    expect(forged.bodyUsed).toBe(false);
  });

  it('reads the kingdom from exactly one canonical path segment', () => {
    expect(kingdomFromGatePath('/api/raid-gate', '/api/raid-gate/41000001')).toBe(SOURCE);
    expect(gateKingdomFromPath('/api/raid-gate')(new Request(`${ORIGIN}/api/raid-gate/41000001?request=r1`))).toBe(SOURCE);
    for (const path of ['/api/raid-gate', '/api/raid-gate/', '/api/raid-gate/41000001/', '/api/raid-gate/041000001', '/api/raid-gate/4100x',
      '/api/raid-gate/%34%31', '/api/raid-gate/41000001/extra', '/api/raid-gateway/41000001', '/other/41000001', `/api/raid-gate/${'9'.repeat(33)}`]) {
      expect(kingdomFromGatePath('/api/raid-gate', path), path).toBeNull();
    }
    expect(() => gateKingdomFromPath('api/raid-gate/')).toThrow();
  });
});

describe('realm gate policy', () => {
  const ports = () => ({
    live: { read: vi.fn(async (ids: readonly KingdomId[]) => new Map(ids.map(id => [id, true]))) },
    grants: { read: vi.fn(async () => 'granted' as const) },
    consent: { read: vi.fn(async () => 'enabled' as const) },
    directory: { read: vi.fn(async (_from: KingdomId, target: KingdomId) => target === MIRA ? { classification: 'general' as const, permitted: true } : null) },
  });
  const pool = (verified: boolean): SqlQueryable => ({
    query: async sql => ({ rows: [/realm_layout_heads/.test(sql) ? { founded: true } : { current: true, verified }] }),
  });
  const policy = (deps: Partial<RealmGatePolicyDeps> & Pick<RealmGatePolicyDeps, 'pool'>) =>
    createRealmGatePolicy({ origin: 'simulated', issuer: `${ORIGIN}/api/realm/simulated-oidc`, ...ports(), ...deps });
  const principal = (personId: typeof MONARCH) => ({ personId, sessionId: SESSION, sourceKingdomId: SOURCE, sourceRole: 'monarch' as const });

  it('reads the Twitch side only for the verified broadcaster, and fails rather than guessing', async () => {
    const p = ports();
    const walker = await policy({ pool: pool(true), ...p }).readStanding(principal(WREN), 0, live());
    const unverified = await policy({ pool: pool(false), ...p }).readStanding(principal(MONARCH), 0, live());
    for (const standing of [walker, unverified]) expect(standing).toEqual({ session: 'current', broadcaster: false, live: false, raids: 'unknown', actions: 'disabled' });
    expect(p.live.read).not.toHaveBeenCalled();
    expect(p.grants.read).not.toHaveBeenCalled();
    expect(await policy({ pool: pool(true), ...p }).readStanding(principal(MONARCH), 0, live())).toEqual({ session: 'current', broadcaster: true, live: true, raids: 'granted', actions: 'enabled' });
    expect(await policy({ pool: pool(true), ...p }).readStanding({ ...principal(MONARCH), sessionId: 'not-a-session' }, 0, live())).toMatchObject({ session: 'ended', broadcaster: false });

    const silent = { read: async () => new Map<KingdomId, boolean>() };
    await expect(policy({ pool: pool(true), live: silent }).readStanding(principal(MONARCH), 0, live())).rejects.toThrow(/did not answer/);
    expect(await policy({ pool: pool(true) }).readTarget(SOURCE, MIRA, 0, live())).toEqual({ target: { kingdomId: MIRA, founded: true, live: true, classification: 'general' }, permitted: true });
    expect(await policy({ pool: pool(true) }).readTarget(SOURCE, KingdomIdSchema.parse('41000009'), 0, live())).toBeNull();
    expect(() => createRealmGatePolicy({ pool: pool(true), origin: 'live', issuer: `${ORIGIN}/api/realm/simulated-oidc`, ...ports() })).toThrow(/Twitch/);
    expect(() => createRealmGatePolicy({ pool: pool(true), origin: 'simulated', issuer: TWITCH_OIDC_ISSUER, ...ports() })).toThrow(/SIMULATED/);
  });

  it('asks Helix Get Streams in batches of at most 100 and counts only live streams', async () => {
    expectTypeOf<HelixReader>().toMatchTypeOf<HelixStreamsReader>();
    const ids = Array.from({ length: 250 }, (_, index) => KingdomIdSchema.parse(String(41_000_000 + index)));
    const getStreams = vi.fn(async (batch: readonly string[]) => batch.filter((_, index) => index % 2 === 0).map(userId => ({ userId, type: userId.endsWith('2') ? '' : 'live' })));
    const read = await createHelixLiveChannels({ getStreams }).read([...ids, ids[0]!], live());
    expect(getStreams.mock.calls.map(([batch]) => batch.length)).toEqual([100, 100, 50]);
    expect(read.size).toBe(250);
    expect(read.get(ids[0]!)).toBe(true);
    expect(read.get(ids[1]!)).toBe(false);
    expect(read.get(ids[2]!)).toBe(false);
  });
});

describe('node HTTP adapter', () => {
  let server: Server | undefined;
  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
    server = undefined;
  });

  it('issues opaque preview tokens and stores only their SHA-256 hex', async () => {
    const tokens = createPreviewTokens();
    const first = tokens.issue(), second = tokens.issue();
    expect(first).not.toBe(second);
    expect(token(first)).toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    const hash = await tokens.hash(first);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(createHash('sha256').update(first).digest('hex'));
    expect(hash).not.toBe(first);
  });

  it('rebuilds the URL on the public origin, streams the body and ends it when the client leaves', async () => {
    const seen: Request[] = [];
    let cancelled = false;
    server = createServer((incoming, outgoing) => {
      const request = toWebRequest(incoming, outgoing, ORIGIN);
      seen.push(request);
      const body = request.method === 'POST'
        ? request.body
        : new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new TextEncoder().encode('retry: 3000\n\n')); },
          cancel() { cancelled = true; },
        });
      void writeWebResponse(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), outgoing);
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const echo = await fetch(`${base}/api/raid-gate/41000001`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"op":"gate"}' });
    expect(await echo.text()).toBe('{"op":"gate"}');
    expect(seen[0]!.url).toBe(`${ORIGIN}/api/raid-gate/41000001`);

    const client = new AbortController();
    const stream = await fetch(`${base}/api/raid-gate/41000001?request=r1`, { headers: { accept: 'text/event-stream' }, signal: client.signal });
    expect(stream.headers.get('x-content-type-options')).toBe('nosniff');
    const reader = stream.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('retry: 3000\n\n');
    client.abort();
    await vi.waitFor(() => { expect(cancelled).toBe(true); expect(seen[1]!.signal.aborted).toBe(true); });
    expect(seen[1]!.url).toBe(`${ORIGIN}/api/raid-gate/41000001?request=r1`);
  });
});

describe('Raid Gate HTTP origin rule', () => {
  it('refuses a command that names no origin, or a foreign one, before authenticating', async () => {
    const { createGateFanout, createRaidGateHttp } = await import('./http');
    const authenticate = vi.fn(async () => null);
    const http = createRaidGateHttp({
      application: { handle: async () => ({ kind: 'denied', code: 'unavailable' }) }, changes: createGateFanout(),
      authenticate, clock: () => 1, origins: ['https://chatdom.gg'],
    });
    const post = (headers: Record<string, string>) => http.handle(new Request('https://chatdom.gg/api/raid-gate/41000001', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"op":"gate"}',
    }));
    expect((await post({})).status).toBe(403);
    expect((await post({ origin: 'https://elsewhere.example' })).status).toBe(403);
    expect(authenticate).not.toHaveBeenCalled();
    expect((await post({ origin: 'https://chatdom.gg' })).status).toBe(401);
    expect(authenticate).toHaveBeenCalledTimes(1);
  });
});
