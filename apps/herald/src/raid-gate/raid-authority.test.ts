import { KingdomIdSchema } from '@chatdom/shared';
import { Secret } from '@chatdom/twitch';
import { FakeTwitch } from '@chatdom/twitch/testing';
import { randomBytes } from 'node:crypto';
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RAID_AUTHORITY_ROUTE, RaidAuthorityWriteReplySchema, type RaidAuthorityWrite } from '../../../api/src/raid-gate/raid-authority-contracts';
import { runAuthorize } from '../auth/authorize';
import { formatAuthorizeOutcome } from '../cli/report';
import type { HeraldConfig } from '../config';
import { createMockRaidAuthority, parseMockLiveChannels } from '../mock/raids';
import { createRaidAuthorityRoute, type RaidAuthority } from './raid-authority';
import { decodeTokenKey, RAID_AUTHORITY_FILE, RaidAuthorityStore, RaidAuthorityStoreError } from './raid-authority-store';
import { HelixRaidWire, RAID_WRITES_FILE, RaidWriteLedger, RaidWrites, RecordingRaidWire, type RaidWire } from './raids';
import { RaidUserSession } from './user-token';

const TOBIAS = '129634568';
const TARGET = '900000123';
const CLIENT_ID = 'simulatedclient0000000000000001';
const CLIENT_SECRET = 'simulated-client-secret-value-0001';
const GATE_SECRET = 'simulated-raid-gate-secret-0123456789abcdef';
const RAID_SCOPES = ['channel:bot', 'channel:manage:raids'];

const dirs: string[] = [];
const closers: Array<() => Promise<void>> = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'herald-raid-authority-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close().catch(() => undefined)));
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

const key = () => randomBytes(32);
const write = (requestId: string, op: 'start' | 'cancel', from = TOBIAS, to = TARGET): RaidAuthorityWrite =>
  ({ key: `${requestId}/${op}`, requestId, from: KingdomIdSchema.parse(from), to: KingdomIdSchema.parse(to) });
const held = (recordedAt = 1_000) => ({ userId: TOBIAS, login: 'tobi4s_', scopes: RAID_SCOPES, recordedAt });

/** A wire that counts sends and answers what it is told. */
function countingWire(answer: () => Promise<Awaited<ReturnType<RaidWire['send']>>> = async () => ({ kind: 'accepted', createdAt: 5 })) {
  const wire = { origin: 'simulated' as const, sends: 0, ready: async () => ({ ok: true as const }),
    send: async () => { wire.sends++; return answer(); } };
  return wire;
}

/**
 * Just enough of Twitch for the user token and raid endpoints. `raid` answers each raid call in turn; refresh
 * tokens rotate on every refresh when `rotate` is set.
 */
function fakeTwitch(options: { raid?: Array<number | 'network' | { status: number; body: unknown }>; refresh?: number; rotate?: boolean; scopes?: string[]; userId?: string } = {}) {
  const state = { refreshes: 0, validates: 0, raids: [] as Array<{ method: string; url: string; authorization: string | null }>, issued: [] as string[], lastRefresh: '' };
  const raid = [...(options.raid ?? [])];
  const reply = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const target = new URL(url);
    if (target.pathname === '/oauth2/token') {
      state.refreshes++;
      const form = new URLSearchParams(String(init.body));
      state.lastRefresh = form.get('refresh_token') ?? '';
      expect(form.get('grant_type')).toBe('refresh_token');
      await new Promise(resolve => setTimeout(resolve, 5));
      if (options.refresh) return reply(options.refresh, { status: options.refresh, message: 'Invalid refresh token' });
      const access = `user-access-${state.refreshes}-SIMULATED`;
      const refresh = options.rotate ? `rotated-refresh-${state.refreshes}-SIMULATED` : state.lastRefresh;
      state.issued.push(access, refresh);
      return reply(200, { access_token: access, refresh_token: refresh, expires_in: 14_400, scope: options.scopes ?? RAID_SCOPES, token_type: 'bearer' });
    }
    if (target.pathname === '/oauth2/validate') {
      state.validates++;
      return reply(200, { client_id: CLIENT_ID, login: 'tobi4s_', user_id: options.userId ?? TOBIAS, scopes: options.scopes ?? RAID_SCOPES, expires_in: 14_000 });
    }
    if (target.pathname === '/helix/raids') {
      state.raids.push({ method: String(init.method), url, authorization: new Headers(init.headers).get('authorization') });
      const next = raid.shift() ?? 500;
      if (next === 'network') throw new TypeError('fetch failed');
      if (typeof next === 'object') return reply(next.status, next.body);
      if (next === 200) return reply(200, { data: [{ created_at: '2026-11-02T20:15:00.25Z', is_mature: false }] });
      return next === 204 ? new Response(null, { status: 204 }) : reply(next, { status: next, message: 'SIMULATED provider detail' });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetch, state };
}

async function liveWrites(options: Parameters<typeof fakeTwitch>[0] = {}, broadcasterId = TOBIAS) {
  const dir = await scratch();
  const store = new RaidAuthorityStore({ dataDir: dir, key: key(), clientId: CLIENT_ID });
  await store.write(held(), new Secret('stored-refresh-SIMULATED'));
  const twitch = fakeTwitch(options);
  const session = new RaidUserSession({ store, clientId: CLIENT_ID, clientSecret: new Secret(CLIENT_SECRET), broadcasterId, fetch: twitch.fetch });
  const ledger = await RaidWriteLedger.open({ dir });
  closers.push(() => ledger.close());
  const writes = new RaidWrites({ ledger, broadcasterId, wire: new HelixRaidWire({ session, clientId: CLIENT_ID, fetch: twitch.fetch }) });
  return { dir, store, session, ledger, writes, twitch };
}

describe('raid authority store', () => {
  it('seals the refresh token, owner-only and atomically, and opens it again', async () => {
    const dir = await scratch(), tokenKey = key();
    const store = new RaidAuthorityStore({ dataDir: dir, key: tokenKey, clientId: CLIENT_ID });
    expect(await store.read()).toBeNull();
    await store.write(held(), new Secret('refresh-value-SIMULATED'));
    const text = await readFile(join(dir, RAID_AUTHORITY_FILE), 'utf8');
    expect(text).not.toContain('refresh-value-SIMULATED');
    expect((await stat(join(dir, RAID_AUTHORITY_FILE))).mode & 0o777).toBe(0o600);
    const again = await new RaidAuthorityStore({ dataDir: dir, key: tokenKey, clientId: CLIENT_ID }).read();
    expect(again).toMatchObject({ state: 'held', userId: TOBIAS, login: 'tobi4s_', scopes: RAID_SCOPES, recordedAt: 1_000 });
    expect(again?.state === 'held' && again.refresh.reveal()).toBe('refresh-value-SIMULATED');
    expect(JSON.stringify(again)).not.toContain('refresh-value-SIMULATED');
  });

  it('fails closed on a wrong key, an edited ciphertext or edited metadata', async () => {
    const dir = await scratch(), tokenKey = key();
    const store = new RaidAuthorityStore({ dataDir: dir, key: tokenKey, clientId: CLIENT_ID });
    await store.write(held(), new Secret('refresh-value-SIMULATED'));
    await expect(new RaidAuthorityStore({ dataDir: dir, key: key(), clientId: CLIENT_ID }).read()).rejects.toMatchObject({ fault: 'tampered' });
    const path = join(dir, RAID_AUTHORITY_FILE), original = JSON.parse(await readFile(path, 'utf8'));
    const flip = (text: string) => `${text.slice(0, -2)}${text.at(-2) === 'A' ? 'B' : 'A'}${text.at(-1)}`;
    for (const edited of [{ ...original, sealed: { ...original.sealed, data: flip(original.sealed.data) } }, { ...original, login: 'someone_else' },
      { ...original, scopes: ['channel:manage:raids'] }, { ...original, userId: '900000002' }]) {
      await writeFile(path, JSON.stringify(edited), { mode: 0o600 });
      await expect(store.read()).rejects.toBeInstanceOf(RaidAuthorityStoreError);
    }
    await writeFile(path, '{not json', { mode: 0o600 });
    await expect(store.read()).rejects.toMatchObject({ fault: 'corrupt' });
    await writeFile(path, JSON.stringify(original), { mode: 0o600 });
    await chmod(path, 0o644);
    await expect(store.read()).rejects.toMatchObject({ fault: 'insecure' });
  });

  it('never lives inside the repository, and treats another app\'s record as nothing stored', async () => {
    const dir = await scratch();
    const inside = new RaidAuthorityStore({ dataDir: join(dir, 'data'), key: key(), clientId: CLIENT_ID, repositoryRoot: dir });
    await expect(inside.write(held(), new Secret('x-SIMULATED'))).rejects.toMatchObject({ fault: 'inside_repository' });
    const tokenKey = key();
    await new RaidAuthorityStore({ dataDir: dir, key: tokenKey, clientId: CLIENT_ID }).write(held(), new Secret('x-SIMULATED'));
    expect(await new RaidAuthorityStore({ dataDir: dir, key: tokenKey, clientId: 'anotherclient000001' }).read()).toBeNull();
  });

  it('accepts only a 32-byte base64 key', () => {
    const raw = randomBytes(32);
    expect(decodeTokenKey(raw.toString('base64'))?.equals(raw)).toBe(true);
    expect(decodeTokenKey(raw.toString('base64url'))?.equals(raw)).toBe(true);
    expect(decodeTokenKey(randomBytes(16).toString('base64'))).toBeNull();
    expect(decodeTokenKey('not a key')).toBeNull();
  });
});

describe('raid user session', () => {
  it('persists a rotated refresh token before using the new access token', async () => {
    const { store, session, twitch } = await liveWrites({ rotate: true });
    const token = await session.token();
    expect(token.reveal()).toBe('user-access-1-SIMULATED');
    expect(twitch.state.lastRefresh).toBe('stored-refresh-SIMULATED');
    const record = await store.read();
    expect(record?.state === 'held' && record.refresh.reveal()).toBe('rotated-refresh-1-SIMULATED');
    expect(await session.token()).toBe(token);
    expect(twitch.state.refreshes).toBe(1);
  });

  it('shares one refresh between concurrent callers', async () => {
    const { session, twitch } = await liveWrites();
    const tokens = await Promise.all(Array.from({ length: 8 }, () => session.token()));
    expect(new Set(tokens.map(token => token.reveal())).size).toBe(1);
    expect(twitch.state.refreshes).toBe(1);
    expect(twitch.state.validates).toBe(1);
  });

  it('reports revoked after a definite refusal, and keeps saying so after a restart', async () => {
    const { store, session, dir } = await liveWrites({ refresh: 400 });
    expect(await session.standing()).toBe('granted');
    await expect(session.token()).rejects.toMatchObject({ state: 'revoked' });
    expect(await session.standing()).toBe('revoked');
    expect(await store.read()).toMatchObject({ state: 'revoked' });
    expect(await readFile(join(dir, RAID_AUTHORITY_FILE), 'utf8')).toContain('"sealed":null');
  });

  it('refuses a token that speaks for another account, and one without the raid scope', async () => {
    const other = await liveWrites({ userId: '900000002' });
    await expect(other.session.token()).rejects.toMatchObject({ state: 'unknown' });
    const narrowed = await liveWrites({ scopes: ['channel:bot'] });
    await expect(narrowed.session.token()).rejects.toMatchObject({ state: 'revoked' });
  });

  it('without a key nothing is held', async () => {
    const session = new RaidUserSession({ store: null, clientId: CLIENT_ID, clientSecret: new Secret(CLIENT_SECRET), broadcasterId: TOBIAS, fetch: fakeTwitch().fetch });
    expect(await session.standing()).toBe('missing');
    await expect(session.token()).rejects.toMatchObject({ state: 'missing' });
  });
});

describe('raid write ledger', () => {
  it('a claim without an outcome answers unknown after a restart and is never sent again', async () => {
    const dir = await scratch();
    const first = await RaidWriteLedger.open({ dir });
    const pending = write('req-1', 'start');
    await first.append({ ...pending, op: 'start', state: 'claimed', at: 10 });
    await first.close();
    // A crash mid-append leaves a torn line; it was never synced, so nothing acted on it.
    await appendFile(join(dir, RAID_WRITES_FILE), '{"v":1,"at":11,"key":"req-1/sta');
    const ledger = await RaidWriteLedger.open({ dir });
    closers.push(() => ledger.close());
    const wire = countingWire();
    const writes = new RaidWrites({ ledger, wire, broadcasterId: TOBIAS });
    expect(await writes.start(pending)).toEqual({ kind: 'unknown' });
    expect(await writes.reconcile(pending)).toEqual({ kind: 'unknown' });
    expect(wire.sends).toBe(0);
    expect((await readFile(join(dir, RAID_WRITES_FILE), 'utf8')).endsWith('\n')).toBe(true);
  });

  it('an accepted write answers accepted again, across a restart, without a second Twitch call', async () => {
    const live = await liveWrites({ raid: [200] });
    const start = write('req-2', 'start');
    const accepted = { kind: 'accepted', createdAt: Date.parse('2026-11-02T20:15:00.25Z') };
    expect(await live.writes.start(start)).toEqual(accepted);
    await live.ledger.close();
    const reopened = await RaidWriteLedger.open({ dir: live.dir });
    closers.push(() => reopened.close());
    const writes = new RaidWrites({ ledger: reopened, broadcasterId: TOBIAS,
      wire: new HelixRaidWire({ session: live.session, clientId: CLIENT_ID, fetch: live.twitch.fetch }) });
    expect(await writes.start(start)).toEqual(accepted);
    expect(await writes.reconcile(start)).toEqual(accepted);
    expect(live.twitch.state.raids).toHaveLength(1);
    expect(await writes.reconcile(write('req-never', 'start'))).toEqual({ kind: 'unknown' });
  });

  it('claims before sending and shares one send between concurrent repeats', async () => {
    const dir = await scratch();
    const ledger = await RaidWriteLedger.open({ dir });
    closers.push(() => ledger.close());
    let claimedFirst = false;
    const wire = countingWire(async () => {
      claimedFirst = (await readFile(join(dir, RAID_WRITES_FILE), 'utf8')).includes('"state":"claimed"');
      return { kind: 'accepted', createdAt: 7 };
    });
    const writes = new RaidWrites({ ledger, wire, broadcasterId: TOBIAS });
    const results = await Promise.all([writes.start(write('req-3', 'start')), writes.start(write('req-3', 'start'))]);
    expect(results).toEqual([{ kind: 'accepted', createdAt: 7 }, { kind: 'accepted', createdAt: 7 }]);
    expect(wire.sends).toBe(1);
    expect(claimedFirst).toBe(true);
    // The same key for a different write is not a repeat: it is never sent and cannot be vouched for.
    expect(await writes.start(write('req-3', 'start', TOBIAS, '900000999'))).toEqual({ kind: 'unknown' });
    expect(wire.sends).toBe(1);
  });

  it('refuses a foreign source without calling Twitch, and on a live origin only tobi4s_ raids', async () => {
    const live = await liveWrites({ raid: [200] });
    expect(await live.writes.start(write('req-4', 'start', '900000002'))).toEqual({ kind: 'rejected', code: 'not-this-channel' });
    const other = await liveWrites({ raid: [200] }, '900000002');
    expect(await other.writes.start(write('req-5', 'start', '900000002'))).toEqual({ kind: 'rejected', code: 'not-this-channel' });
    expect(live.twitch.state.raids.length + other.twitch.state.raids.length).toBe(0);
    expect(live.twitch.state.refreshes + other.twitch.state.refreshes).toBe(0);
  });
});

describe('Start and Cancel a Raid', () => {
  it.each([
    [200, { kind: 'accepted', createdAt: Date.parse('2026-11-02T20:15:00.25Z') }],
    [409, { kind: 'rejected', code: 'already-raiding' }],
    [429, { kind: 'rejected', code: 'rate-limited' }],
    [400, { kind: 'rejected', code: 'raid-refused' }],
    [404, { kind: 'rejected', code: 'target-not-found' }],
    [403, { kind: 'rejected', code: 'forbidden' }],
    [422, { kind: 'rejected', code: 'unprocessable' }],
    [500, { kind: 'unknown' }],
    [503, { kind: 'unknown' }],
    ['network', { kind: 'unknown' }],
    [{ status: 200, body: { data: [] } }, { kind: 'unknown' }],
  ] as const)('start answered %s', async (answer, outcome) => {
    const live = await liveWrites({ raid: [answer as never] });
    expect(await live.writes.start(write('req-s', 'start'))).toEqual(outcome);
    const [call] = live.twitch.state.raids;
    expect(call?.method).toBe('POST');
    expect(call?.url).toBe(`https://api.twitch.tv/helix/raids?from_broadcaster_id=${TOBIAS}&to_broadcaster_id=${TARGET}`);
    expect(call?.authorization).toBe('Bearer user-access-1-SIMULATED');
  });

  it.each([[204, 'accepted'], [404, 'nothing-pending'], [500, 'unknown']] as const)('cancel answered %s', async (status, kind) => {
    const live = await liveWrites({ raid: [status] });
    const outcome = await live.writes.cancel(write('req-c', 'cancel'));
    if (kind === 'accepted') expect(outcome).toMatchObject({ kind: 'accepted' });
    else if (kind === 'unknown') expect(outcome).toEqual({ kind: 'unknown' });
    else expect(outcome).toEqual({ kind: 'rejected', code: kind });
    expect(live.twitch.state.raids[0]).toMatchObject({ method: 'DELETE', url: `https://api.twitch.tv/helix/raids?broadcaster_id=${TOBIAS}` });
  });

  it('a 401 refreshes once and tries once more; a second 401 revokes the grant', async () => {
    const once = await liveWrites({ raid: [401, 200] });
    expect(await once.writes.start(write('req-6', 'start'))).toMatchObject({ kind: 'accepted' });
    expect(once.twitch.state.refreshes).toBe(2);
    const twice = await liveWrites({ raid: [401, 401] });
    expect(await twice.writes.start(write('req-7', 'start'))).toEqual({ kind: 'rejected', code: 'grant-revoked' });
    expect(await twice.session.standing()).toBe('revoked');
    expect(await twice.writes.start(write('req-8', 'start'))).toEqual({ kind: 'rejected', code: 'grant-revoked' });
    expect(twice.twitch.state.raids).toHaveLength(2);
  });

  it('a revoked grant is refused before any claim', async () => {
    const live = await liveWrites({ refresh: 400 });
    expect(await live.writes.start(write('req-9', 'start'))).toEqual({ kind: 'rejected', code: 'grant-revoked' });
    expect(live.twitch.state.raids).toHaveLength(0);
    expect(await readFile(join(live.dir, RAID_WRITES_FILE), 'utf8')).not.toContain('"claimed"');
  });
});

describe('the private route', () => {
  const servers: Server[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))); });

  async function serve(authority: RaidAuthority | null, secret: string | null = GATE_SECRET) {
    const route = createRaidAuthorityRoute({ authority: () => authority, secret: secret ? new Secret(secret) : null });
    const server = createServer((request, response) => { void route(request, response); });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${RAID_AUTHORITY_ROUTE}`;
    return (body: unknown, headers: Record<string, string> = {}) => fetch(url, { method: 'POST',
      headers: { authorization: `Bearer ${GATE_SECRET}`, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  }

  async function mock() {
    const dir = await scratch();
    const raids = await createMockRaidAuthority({ kingdomId: KingdomIdSchema.parse(TOBIAS), dir, repositoryRoot: null, secret: null, liveChannels: [KingdomIdSchema.parse(TARGET)] });
    closers.push(() => raids.close());
    return { raids, dir };
  }

  it('refuses without the bearer, the media type, within the limit and in the strict shape', async () => {
    const { raids } = await mock();
    const post = await serve(raids.authority);
    const standing = { version: 1, origin: 'simulated', op: 'standing', kingdomId: TOBIAS };
    expect((await post(standing, { authorization: '' })).status).toBe(401);
    expect((await post(standing, { authorization: `Bearer ${GATE_SECRET}x` })).status).toBe(401);
    expect((await post(standing, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post(`{"pad":"${'x'.repeat(5000)}"}`)).status).toBe(413);
    expect((await post('{not json')).status).toBe(400);
    expect((await post({ ...standing, extra: true })).status).toBe(400);
    expect((await post({ ...standing, origin: 'live' })).status).toBe(409);
    expect((await post({ ...standing, kingdomId: TARGET })).status).toBe(409);
    expect((await post({ version: 1, origin: 'simulated', op: 'start', write: write('req-10', 'cancel') })).status).toBe(400);
    expect((await post({ version: 1, origin: 'simulated', op: 'start', write: { ...write('req-10', 'start'), requestId: 'req-11' } })).status).toBe(400);
    const ok = await post(standing);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ version: 1, origin: 'simulated', kingdomId: TOBIAS, grant: 'granted', consent: 'enabled' });
  });

  it('refuses everything while the secret is unset or the authority is not bound', async () => {
    const { raids } = await mock();
    expect((await (await serve(raids.authority, null))({ version: 1, origin: 'simulated', op: 'standing', kingdomId: TOBIAS })).status).toBe(503);
    expect((await (await serve(null))({ version: 1, origin: 'simulated', op: 'standing', kingdomId: TOBIAS })).status).toBe(503);
  });

  it('answers writes and live reads in the contract\'s shapes, once per key, across a mock restart', async () => {
    const { raids, dir } = await mock();
    const post = await serve(raids.authority);
    const command = (op: 'start' | 'cancel' | 'reconcile', body: RaidAuthorityWrite) => post({ version: 1, origin: 'simulated', op, write: body }).then(async response => {
      expect(response.status).toBe(200);
      return RaidAuthorityWriteReplySchema.parse(await response.json()).outcome;
    });
    expect(await command('start', write('req-12', 'start'))).toMatchObject({ kind: 'accepted' });
    expect(await command('start', write('req-13', 'start'))).toEqual({ kind: 'rejected', code: 'already-raiding' });
    expect(await command('cancel', write('req-12', 'cancel'))).toMatchObject({ kind: 'accepted' });
    expect(await command('cancel', write('req-14', 'cancel'))).toEqual({ kind: 'rejected', code: 'nothing-pending' });
    const first = await command('reconcile', write('req-12', 'start'));
    expect(first).toMatchObject({ kind: 'accepted' });
    const live = await post({ version: 1, origin: 'simulated', op: 'live', kingdomIds: [TOBIAS, TARGET, '900000777'] });
    expect(await live.json()).toEqual({ version: 1, origin: 'simulated', live: { [TOBIAS]: true, [TARGET]: true, '900000777': false } });
    expect(raids.health().recorded.map(entry => [entry.key, entry.outcome.kind])).toEqual(expect.arrayContaining([['req-12/start', 'accepted'], ['req-14/cancel', 'rejected']]));
    await raids.close();
    const restarted = await createMockRaidAuthority({ kingdomId: KingdomIdSchema.parse(TOBIAS), dir, repositoryRoot: null, secret: null, liveChannels: [] });
    // A fresh recording wire holds no pending raid, but the ledger still answers the old key without a second write.
    expect(await restarted.authority.writes.start(write('req-12', 'start'))).toEqual(first);
    expect(restarted.health().pending).toBeNull();
    await restarted.close();
  });

  it('parses the bench\'s live channel list strictly', () => {
    expect(parseMockLiveChannels(undefined)).toEqual([]);
    expect(parseMockLiveChannels(` ${TARGET}, 900000777 ,`)).toEqual([TARGET, '900000777']);
    expect(parseMockLiveChannels('tobi4s_')).toBeNull();
  });

  it('the recording wire mirrors Twitch\'s countdown', async () => {
    let now = 1_000;
    const wire = new RecordingRaidWire(() => now);
    expect(await wire.send('start', write('a', 'start'))).toEqual({ kind: 'accepted', createdAt: 1_000 });
    now += 91_000;
    expect(await wire.send('cancel', write('a', 'cancel'))).toEqual({ kind: 'rejected', code: 'nothing-pending' });
  });
});

describe('authorize keeps the raid control', () => {
  const REDIRECT = 'http://localhost:5195/herald/callback';
  const BROADCASTER_SCOPES = ['channel:bot', 'moderator:read:chatters', 'bits:read', 'channel:read:hype_train', 'moderator:read:followers',
    'channel:manage:redemptions', 'channel:manage:polls', 'channel:manage:raids', 'moderator:read:shield_mode'];

  async function authorize(dataDir: string, tokenKey: Buffer | null) {
    const fake = new FakeTwitch({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, users: [{ id: TOBIAS, login: 'tobi4s_', displayName: 'tobi4s_' },
      { id: '900000001', login: 'herald_reader', displayName: 'HeraldReader' }], grants: {} });
    const config: HeraldConfig = { channelLogin: 'tobi4s_', channelLoginDefaulted: true, readerLogin: 'herald_reader', redirectUri: new URL(REDIRECT),
      credentials: { clientId: CLIENT_ID, clientSecret: new Secret(CLIENT_SECRET) }, conduitId: null, problems: [], dataDir,
      kingdom: { seed: 'tobi4s_', tier: 'hamlet', firstYear: 2026, year: 2026 }, port: 5194, secretsFile: '/simulated/atlas.env', settingsFile: '/simulated/herald.env',
      tokenKey: tokenKey ? new Secret(tokenKey.toString('base64')) : null };
    const lines: string[] = [];
    let browsing: Promise<void> = Promise.resolve();
    const outcome = await runAuthorize({ config, role: 'broadcaster', fetch: fake.fetch, print: line => lines.push(line), listenPort: 0, deadlineMs: 5_000, lingerMs: 50,
      repositoryRoot: null, onListening: port => {
        const state = new URL(lines.find(line => line.includes('/oauth2/authorize'))!.trim()).searchParams.get('state') ?? '';
        const code = fake.consent(TOBIAS, BROADCASTER_SCOPES, REDIRECT);
        browsing = fetch(`http://127.0.0.1:${port}/herald/callback?${new URLSearchParams({ code, state })}`, { redirect: 'manual' }).then(() => undefined);
      } });
    await browsing;
    const printed = [...lines, ...formatAuthorizeOutcome(outcome)].join('\n');
    for (const value of fake.issuedValues) expect(printed).not.toContain(value);
    return { outcome, printed, fake };
  }

  it('seals the refresh token with the key set', async () => {
    const dir = await scratch(), tokenKey = key();
    const { outcome, printed, fake } = await authorize(join(dir, 'herald'), tokenKey);
    expect(outcome).toMatchObject({ status: 'recorded', raidControl: 'held' });
    expect(printed).toContain('The raid control is held');
    const record = await new RaidAuthorityStore({ dataDir: join(dir, 'herald'), key: tokenKey, clientId: CLIENT_ID }).read();
    expect(record).toMatchObject({ state: 'held', userId: TOBIAS, login: 'tobi4s_' });
    expect(record?.state === 'held' && fake.issuedValues.includes(record.refresh.reveal())).toBe(true);
    const text = await readFile(join(dir, 'herald', RAID_AUTHORITY_FILE), 'utf8');
    for (const value of fake.issuedValues) expect(text).not.toContain(value);
  });

  it('without the key keeps nothing and says the raid control cannot be held', async () => {
    const dir = await scratch();
    await mkdir(join(dir, 'herald'), { mode: 0o700 });
    const { outcome, printed } = await authorize(join(dir, 'herald'), null);
    expect(outcome).toMatchObject({ status: 'recorded', raidControl: 'key_missing' });
    expect(printed).toContain('cannot be held until HERALD_TOKEN_KEY is set');
    await expect(stat(join(dir, 'herald', RAID_AUTHORITY_FILE))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
