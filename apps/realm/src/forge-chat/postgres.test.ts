/** Real PostgreSQL integration; opt in with FORGE_CHAT_POSTGRES_TEST=1, DATABASE_URL and
 * REALM_DATABASE_SCHEMA=realm_forge_wish supplied outside this file. Run serially:
 * pnpm exec vitest run apps/realm/src/forge-chat/postgres.test.ts --no-file-parallelism --testTimeout=30000
 * Only run against a private database. This installs the additive migrations; it never drops a schema.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { createRealmPool, migrateRealmSchema } from '../persistence';
import { createForgeChatService } from './service';
import { ForgeChatCipher, installForgeChatSchema, PostgresForgeChatStore } from './store';

const enabled = process.env.FORGE_CHAT_POSTGRES_TEST === '1';
const suite = enabled ? describe : describe.skip;
const now = Date.now();
const config = { clientId: `SIMULATED-${randomUUID()}`, clientSecret: 'SIMULATED-secret',
  redirectUri: 'https://chatdom.test/api/realm/forge/chat/callback', tokenKey: Buffer.alloc(32, 7) };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
let pool: pg.Pool;
const people: string[] = [];
let person: ReturnType<typeof PersonIdSchema.parse>, kingdom: ReturnType<typeof KingdomIdSchema.parse>, session: string;
let a: PostgresForgeChatStore, b: PostgresForgeChatStore;
const grant = { accessToken: 'SIMULATED-access', refreshToken: 'SIMULATED-refresh', expiresAt: now + 3_600_000, validatedAt: now };
const principal = () => ({ personId: person, sessionId: session });
const request = () => ({ version: 1 as const, kingdomId: kingdom, requestId: randomUUID(), words: 'SIMULATED a copper moon' });
const sent = (id = 'SIMULATED-message') => json({ data: [{ is_sent: true, message_id: id }] });
const service = (store: PostgresForgeChatStore, transport: typeof fetch, recoverCommitted?: Parameters<typeof createForgeChatService>[0]['recoverCommitted']) =>
  createForgeChatService({ origin: 'simulated', store, config, now: () => now, fetch: transport,
    resolveTarget: async () => ({ broadcasterId: kingdom, availability: { status: 'ready' } }), ...(recoverCommitted ? { recoverCommitted } : {}) });
const transport = (fn: (url: string) => Promise<Response>): typeof fetch => async input => fn(String(input));
const saveGrant = () => a.withGrantLock(person, async (_old, save) => save(grant));

// Intercept only the timing around a real query; PostgreSQL still executes every statement.
function lockObservedPool(hooks: { before?: (pid: number) => void; after?: () => Promise<void> }): pg.Pool {
  return new Proxy(pool, { get(target, key) {
    if (key === 'connect') return async () => {
      const client = await target.connect();
      const pid = (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
      return new Proxy(client, { get(connection, property) {
        if (property === 'query') return async (...args: unknown[]) => {
          const lock = typeof args[0] === 'string' && args[0].includes('pg_advisory_xact_lock');
          if (lock) hooks.before?.(pid);
          const result = await (connection.query as (...values: unknown[]) => Promise<unknown>).apply(connection, args);
          if (lock && hooks.after) await hooks.after();
          return result;
        };
        const value: unknown = Reflect.get(connection, property, connection);
        return typeof value === 'function' ? value.bind(connection) : value;
      } });
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
async function waitForLock(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await pool.query<{ waiting: boolean }>('select exists(select 1 from pg_locks where pid=$1 and not granted) as waiting', [pid]);
    if (result.rows[0]?.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('SIMULATED contender did not wait for the PostgreSQL lock.');
}

suite('Forge chat PostgreSQL integration', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL || process.env.REALM_DATABASE_SCHEMA !== 'realm_forge_wish') {
      throw new Error('PostgreSQL integration requires explicit DATABASE_URL and REALM_DATABASE_SCHEMA=realm_forge_wish.');
    }
    pool = createRealmPool({ connectionString: process.env.DATABASE_URL, schema: 'realm_forge_wish' });
    try {
      const searchPath = await pool.query<{ path: string }>("select current_setting('search_path') as path");
      if (searchPath.rows[0]?.path !== 'realm_forge_wish') throw new Error('Unexpected search path.');
      await migrateRealmSchema(pool, 'realm_forge_wish');
      const schema = await pool.query<{ schema: string }>('select current_schema() as schema');
      if (schema.rows[0]?.schema !== 'realm_forge_wish') throw new Error('Unexpected current schema.');
      await installForgeChatSchema(pool);
    }
    catch { throw new Error('SIMULATED PostgreSQL integration setup failed.'); }
  });
  afterAll(async () => { await pool?.end(); });
  afterEach(async () => {
    if (!pool) return;
    for (const id of people.splice(0)) {
      for (const table of ['forge_chat_observations', 'forge_chat_requests', 'forge_chat_states', 'forge_chat_grants']) {
        await pool.query(`delete from ${table} where origin='simulated' and person_id=$1`, [id]);
      }
      await pool.query('delete from realm_sessions where person_id=$1', [id]);
      await pool.query('delete from realm_persons where person_id=$1', [id]);
    }
  });
  async function fixture() {
    person = PersonIdSchema.parse((BigInt('0x' + randomBytes(12).toString('hex')) + 1n).toString());
    kingdom = KingdomIdSchema.parse((BigInt('0x' + randomBytes(12).toString('hex')) + 1n).toString());
    session = randomUUID(); people.push(person);
    await pool.query("insert into realm_persons(person_id,origin,identity_issuer) values ($1,'simulated','SIMULATED-test')", [person]);
    await pool.query("insert into realm_sessions(session_id,handle_hash,person_id,origin,resume_scope,expires_at) values ($1,$2,$3,'simulated',$4,clock_timestamp()+interval '1 day')", [session, randomBytes(32), person, randomUUID()]);
    const cipher = new ForgeChatCipher(config.tokenKey, config.clientId);
    a = new PostgresForgeChatStore(pool, 'simulated', cipher, () => now);
    b = new PostgresForgeChatStore(pool, 'simulated', cipher, () => now);
  }
  it('serializes duplicate sends across independent service instances', async () => {
    await fixture(); await saveGrant(); let sends = 0;
    const fetcher = transport(async () => { sends++; return sent(); });
    const first = service(a, fetcher), second = service(b, fetcher), body = request();
    const replies = await Promise.all([first.wish(principal(), body, async () => true), second.wish(principal(), body, async () => true)]);
    expect(sends).toBe(1); expect(replies.map(r => r.wish.status)).toContain('sent');
    expect((await second.status(principal(), { version: 1, kingdomId: kingdom, requestId: body.requestId })).wish?.status).toBe('sent');
    const rows = await pool.query('select projection::text,body_digest from forge_chat_requests where person_id=$1', [person]);
    expect(rows.rowCount).toBe(1); expect(JSON.stringify(rows.rows)).not.toContain(body.words);
  });
  it.each(['before', 'after'] as const)('recovers a confirmed send when binding fails %s commit', async failure => {
    await fixture(); await saveGrant(); let bindings = 0, sends = 0, recoveries = 0;
    class OneFailedBinding extends PostgresForgeChatStore {
      override async bindSent(...args: Parameters<PostgresForgeChatStore['bindSent']>) {
        bindings++;
        if (bindings === 1 && failure === 'before') throw new Error('SIMULATED binding unavailable');
        const result = await super.bindSent(...args);
        if (bindings === 1 && failure === 'after') throw new Error('SIMULATED binding reply lost');
        return result;
      }
    }
    const store = new OneFailedBinding(pool, 'simulated', new ForgeChatCipher(config.tokenKey, config.clientId), () => now);
    const body = request(), messageId = 'SIMULATED-confirmed';
    const instance = service(store, transport(async () => { sends++; return sent(messageId); }), async input => {
      recoveries++; expect(input).toEqual({ kingdomId: kingdom, personId: person, messageId });
      return { attachmentId: 'SIMULATED-attachment', committedAt: now };
    });
    expect((await instance.wish(principal(), body, async () => true)).wish.status).toBe('sent');
    expect(bindings).toBe(2); expect(sends).toBe(1);
    expect((await instance.status(principal(), { version: 1, kingdomId: kingdom, requestId: body.requestId })).wish?.status).toBe('delivered');
    expect(recoveries).toBe(1); expect((await b.getWish(person, kingdom, body.requestId))?.status).toBe('delivered');
    expect(sends).toBe(1);
  });
  it('never sends an expired receipt UUID again after projection cleanup', async () => {
    await fixture(); await saveGrant(); let sends = 0;
    const instance = service(a, transport(async () => { sends++; return sent(); })), body = request();
    expect((await instance.wish(principal(), body, async () => true)).wish.status).toBe('sent');
    // Model only this fixture's retention tombstone; do not run the global cleanup sweep.
    const update = await pool.query("update forge_chat_requests set projection=null where origin='simulated' and person_id=$1 and request_id=$2", [person, body.requestId]);
    expect(update.rowCount).toBe(1);
    await expect(service(b, transport(async () => { sends++; return sent(); })).wish(principal(), body, async () => true)).rejects.toMatchObject({ code: 'request-expired' });
    expect(sends).toBe(1);
  });
  it('never re-sends a durable claim after restart', async () => {
    await fixture(); const body = request(); let sends = 0;
    const { createHmac } = await import('node:crypto');
    const digest = createHmac('sha256', config.tokenKey).update(JSON.stringify(['simulated', person, kingdom, body.words])).digest('hex');
    await a.claimWish(person, { requestId: body.requestId, kingdomId: kingdom, status: 'sending', updatedAt: now - 31_000 }, digest, session);
    const reply = await service(b, transport(async () => { sends++; return sent(); })).wish(principal(), body, async () => true);
    expect(reply.wish.status).toBe('unknown'); expect(sends).toBe(0);
  });
  it.each(['drop', 'ambiguous'] as const)('persists %s without a repeat send', async kind => {
    await fixture(); await saveGrant(); let sends = 0;
    const fetcher = transport(async () => { sends++; return kind === 'drop' ? json({ data: [{ is_sent: false, message_id: '', drop_reason: { code: 'automod' } }] }) : json({}, 503); });
    const body = request(), first = service(a, fetcher), second = service(b, fetcher);
    expect((await first.wish(principal(), body, async () => true)).wish.status).toBe(kind === 'drop' ? 'not-sent' : 'unknown');
    expect((await second.wish(principal(), body, async () => true)).wish.status).toBe(kind === 'drop' ? 'not-sent' : 'unknown');
    expect(sends).toBe(1);
  });
  it('matches early terminal observations and strips accidental private fields', async () => {
    await fixture(); await saveGrant(); const body = request(), messageId = 'SIMULATED-early';
    const sender = service(a, transport(async () => {
      await b.observe({ origin: 'simulated', personId: person, kingdomId: kingdom, messageId, at: now,
        status: 'delivered', attachmentId: 'SIMULATED-attachment', committedAt: now, words: 'SIMULATED-private' } as never, now);
      return sent(messageId);
    }));
    expect((await sender.wish(principal(), body, async () => true)).wish.status).toBe('delivered');
    await b.observe({ origin: 'simulated', personId: person, kingdomId: kingdom, messageId, at: now + 1, status: 'working' }, now);
    expect((await b.getWish(person, kingdom, body.requestId))?.status).toBe('delivered');
    const rows = await pool.query('select projection::text from forge_chat_requests where person_id=$1', [person]);
    expect(JSON.stringify(rows.rows)).not.toContain('SIMULATED-private');
  });
  it('only reconciles a terminal private outcome when exact committed evidence exists', async () => {
    await fixture(); await saveGrant(); const body = request(), messageId = 'SIMULATED-recover';
    const first = service(a, transport(async () => sent(messageId)));
    await first.wish(principal(), body, async () => true);
    await first.observe({ origin: 'simulated', personId: person, kingdomId: kingdom, messageId, at: now,
      status: 'cold', message: 'SIMULATED cold' });
    const missing = service(b, transport(async () => sent()), async () => null);
    expect((await missing.status(principal(), { version: 1, kingdomId: kingdom, requestId: body.requestId })).wish?.status).toBe('cold');
    const recovered = service(b, transport(async () => sent()), async input => {
      expect(input).toEqual({ kingdomId: kingdom, personId: person, messageId });
      return { attachmentId: 'SIMULATED-attachment', committedAt: now };
    });
    expect((await recovered.status(principal(), { version: 1, kingdomId: kingdom, requestId: body.requestId })).wish?.status).toBe('delivered');
  });
  it('keeps a callback transaction alive across two six-second provider calls', async () => {
    await fixture();
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/authorization/users?')) return json({ data: [{ user_id: person, has_authorized: false, scopes: [] }] });
      if (url.endsWith('/token') && new URLSearchParams(String(init?.body)).get('grant_type') === 'client_credentials')
        return json({ access_token: 'SIMULATED-app', token_type: 'bearer', expires_in: 3600 });
      await new Promise(resolve => setTimeout(resolve, 6000));
      return url.endsWith('/token') ? json({ access_token: 'SIMULATED-new', refresh_token: 'SIMULATED-new-refresh', expires_in: 3600, token_type: 'bearer' })
        : json({ client_id: config.clientId, user_id: person, scopes: ['user:write:chat'], expires_in: 3600 });
    };
    const instance = service(a, fetcher);
    const authorization = await instance.authorize(principal(), { version: 1, kingdomId: kingdom });
    const state = new URL(authorization.authorizationUrl).searchParams.get('state');
    expect(state).toBeTruthy();
    expect(await instance.callback(principal(), new URLSearchParams({ state: state!, code: 'SIMULATED-code' }), async () => true)).toContain('forgeChat=connected');
    expect(await b.withGrantLock(person, async current => current?.accessToken)).toBe('SIMULATED-new');
  }, 30000);
  it('serializes an early observation against a concurrent sent binding', async () => {
    await fixture(); const body = request(), messageId = 'SIMULATED-contended';
    await a.claimWish(person, { requestId: body.requestId, kingdomId: kingdom, status: 'sending', updatedAt: now }, 'a'.repeat(64), session);
    let release!: () => void, held!: () => void, waiting!: (pid: number) => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const hasLock = new Promise<void>(resolve => { held = resolve; });
    const contender = new Promise<number>(resolve => { waiting = resolve; });
    let firstLock = true;
    const cipher = new ForgeChatCipher(config.tokenKey, config.clientId);
    const observer = new PostgresForgeChatStore(lockObservedPool({ after: async () => {
      if (firstLock) { firstLock = false; held(); await gate; }
    } }), 'simulated', cipher, () => now);
    const binder = new PostgresForgeChatStore(lockObservedPool({ before: waiting }), 'simulated', cipher, () => now);
    let binding: ReturnType<typeof binder.bindSent> | undefined;
    const observing = observer.observe({ origin: 'simulated', personId: person, kingdomId: kingdom, messageId,
      at: now, status: 'delivered', attachmentId: 'SIMULATED-attachment', committedAt: now }, now);
    try {
      await hasLock;
      binding = binder.bindSent(person, { requestId: body.requestId, kingdomId: kingdom, messageId,
        receiptId: 'SIMULATED-receipt', status: 'sent', updatedAt: now }, now);
      let settled = false; void binding.finally(() => { settled = true; }).catch(() => {});
      await waitForLock(await contender); expect(settled).toBe(false);
    } finally { release(); await Promise.allSettled([observing, ...(binding ? [binding] : [])]); }
    expect((await binding)?.status).toBe('delivered');
    expect((await b.getWish(person, kingdom, body.requestId))?.status).toBe('delivered');
  });
  it('revokes a callback grant after contending on its real transaction lock', async () => {
    await fixture(); let release!: () => void, entered!: () => void, waiting!: (pid: number) => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const exchanging = new Promise<void>(resolve => { entered = resolve; });
    const contender = new Promise<number>(resolve => { waiting = resolve; });
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/authorization/users?')) return json({ data: [{ user_id: person, has_authorized: false, scopes: [] }] });
      if (url.endsWith('/token') && new URLSearchParams(String(init?.body)).get('grant_type') === 'client_credentials')
        return json({ access_token: 'SIMULATED-app', token_type: 'bearer', expires_in: 3600 });
      if (url.endsWith('/token')) {
        entered(); await gate;
        return json({ access_token: 'SIMULATED-new', refresh_token: 'SIMULATED-new-refresh', expires_in: 3600, token_type: 'bearer' });
      }
      return json({ client_id: config.clientId, user_id: person, scopes: ['user:write:chat'], expires_in: 3600 });
    };
    const instance = service(a, fetcher), authorization = await instance.authorize(principal(), { version: 1, kingdomId: kingdom });
    const state = new URL(authorization.authorizationUrl).searchParams.get('state'); expect(state).toBeTruthy();
    const query = new URLSearchParams({ state: state!, code: 'SIMULATED-code' });
    const revoker = new PostgresForgeChatStore(lockObservedPool({ before: waiting }), 'simulated', new ForgeChatCipher(config.tokenKey, config.clientId), () => now);
    const callback = instance.callback(principal(), query, async () => true);
    let revocation: ReturnType<typeof revoker.revokeGrant> | undefined;
    try {
      await exchanging; revocation = revoker.revokeGrant(person);
      let settled = false; void revocation.finally(() => { settled = true; }).catch(() => {});
      await waitForLock(await contender); expect(settled).toBe(false);
    } finally { release(); await Promise.allSettled([callback, ...(revocation ? [revocation] : [])]); }
    expect(await callback).toContain('forgeChat=connected');
    expect(await a.withGrantLock(person, async current => current)).toBeNull();
    expect(await instance.callback(principal(), query, async () => true)).toContain('forgeChat=expired');
  });
  it('invalidates an outstanding callback when consent is revoked', async () => {
    await fixture(); let exchanges = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/authorization/users?')) return json({ data: [{ user_id: person, has_authorized: false, scopes: [] }] });
      if (url.endsWith('/token') && new URLSearchParams(String(init?.body)).get('grant_type') === 'client_credentials')
        return json({ access_token: 'SIMULATED-app', token_type: 'bearer', expires_in: 3600 });
      exchanges++; return json({}, 503);
    };
    const instance = service(a, fetcher), authorization = await instance.authorize(principal(), { version: 1, kingdomId: kingdom });
    const state = new URL(authorization.authorizationUrl).searchParams.get('state');
    expect(state).toBeTruthy(); await b.revokeGrant(person);
    expect(await instance.callback(principal(), new URLSearchParams({ state: state!, code: 'SIMULATED-code' }), async () => true)).toContain('forgeChat=expired');
    expect(exchanges).toBe(0); expect(await a.withGrantLock(person, async current => current)).toBeNull();
  });
  it('blocks sends when forced startup validation fails', async () => {
    await fixture(); await saveGrant();
    // Production cleanup is global; this test deliberately scopes its sweep to this fixture.
    class FixtureStore extends PostgresForgeChatStore {
      override async cleanup(): Promise<void> {}
      override async listGrantPeople(): Promise<string[]> { return [person]; }
    }
    const scoped = new FixtureStore(pool, 'simulated', new ForgeChatCipher(config.tokenKey, config.clientId), () => now);
    let validations = 0, sends = 0;
    const instance = service(scoped, transport(async url => {
      if (url.endsWith('/validate')) { validations++; return json({}, 503); }
      sends++; return sent();
    }));
    try {
      await instance.start();
      expect(validations).toBe(1);
      const result = await instance.wish(principal(), request(), async () => true);
      expect(result.wish).toMatchObject({ status: 'not-sent', reason: 'service-unavailable' });
      expect(validations).toBe(2); expect(sends).toBe(0);
      expect(await b.withGrantLock(person, async current => current?.validatedAt)).toBe(0);
    } finally { await instance.stop(); }
  });
  it('waits for startup validation during stop and starts no late work', async () => {
    await fixture(); await saveGrant();
    class FixtureStore extends PostgresForgeChatStore {
      override async cleanup(): Promise<void> {}
      override async listGrantPeople(): Promise<string[]> { return [person]; }
    }
    let entered!: () => void, release!: () => void, calls = 0, stopped = false, lateQueries = 0;
    const observedPool = new Proxy(pool, { get(target, key) {
      if (key === 'query' || key === 'connect') return (...args: unknown[]) => {
        if (stopped) lateQueries++;
        return (target[key] as (...values: unknown[]) => unknown).apply(target, args);
      };
      return Reflect.get(target, key, target);
    } });
    const scoped = new FixtureStore(observedPool, 'simulated', new ForgeChatCipher(config.tokenKey, config.clientId), () => now);
    const inValidation = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const instance = service(scoped, transport(async url => {
      calls++; expect(url).toContain('/validate'); entered(); await gate;
      return json({ client_id: config.clientId, user_id: person, scopes: ['user:write:chat'], expires_in: 3600 });
    }));
    const starting = instance.start();
    await inValidation;
    const stopping = instance.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    release(); await Promise.all([starting, stopping]);
    expect(stopped).toBe(true); expect(calls).toBe(1);
    await instance.start();
    expect(calls).toBe(1); expect(lateQueries).toBe(0);
    await expect(instance.status(principal(), { version: 1, kingdomId: kingdom })).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('revocation waits for in-flight grant rotation and prevents resurrection', async () => {
    await fixture(); await saveGrant(); let release!: () => void, entered!: () => void;
    const inLock = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const rotation = a.withGrantLock(person, async (current, save) => { expect(current).not.toBeNull(); entered(); await gate; await save({ ...grant, accessToken: 'SIMULATED-rotated' }); });
    await inLock; const revocation = b.revokeGrant(person); release(); await Promise.all([rotation, revocation]);
    expect(await a.withGrantLock(person, async current => current)).toBeNull();
  });
});
