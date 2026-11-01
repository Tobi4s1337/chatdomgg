import { Readable } from 'node:stream';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { RealmAuthConfig } from '../realm-auth/config';
import { csrfFor, sha256 } from '../realm-auth/secrets';
import { classify } from '../public/routes';
import { handleRaidGuest } from './guests-http';
import { RAID_GUEST_BODY_BYTES, type RaidGuestProjection } from './guest-contracts';

// SIMULATED cookie store and authority. The real cookie hashing, CSRF and HTTP boundary run unchanged.
const kingdomId = KingdomIdSchema.parse('42'), personId = PersonIdSchema.parse('501');
const sessionId = '60d6558b-a890-4c79-a46f-6e398a348ba6', entryId = '11111111-1111-4111-8111-111111111111';
const raidId = `raid.${'a'.repeat(64)}`, at = 1_800_000_000_000;
const from = { kingdomId: KingdomIdSchema.parse('101'), login: 'source_channel', name: 'Source Channel' };
const guest: RaidGuestProjection = { version: 1, origin: 'live', kingdomId, personId, entryId, raidId, from,
  to: { kingdomId, login: 'host_channel', name: 'Host Channel' }, arrivedAt: at, raidOccurredAt: at - 1_000 };
const body = JSON.stringify({ version: 1, raidId });
function setup(options: { anonymous?: boolean; secureCookies?: boolean } = {}) {
  const config = { mode: 'live', secureCookies: options.secureCookies ?? false, publicOrigin: 'https://chatdom.gg' } as RealmAuthConfig;
  const query = vi.fn(async () => ({ rows: options.anonymous ? [] : [{ person_id: personId, session_id: sessionId }] }));
  const authority = {
    begin: vi.fn(async () => ({ version: 1 as const, status: 'pending' as const, invitation: { raidId, kingdomId, from, expiresAt: at + 600_000 } })),
    guest: vi.fn(async (): Promise<RaidGuestProjection | null> => guest),
    arrived: vi.fn(), departed: vi.fn(), present: vi.fn(),
  };
  async function request(method = 'GET', raw = '', headers: IncomingHttpHeaders = {}, path = `/api/raid-gate/guest/${kingdomId}`, chunks?: readonly string[]) {
    const req = Readable.from(chunks ?? (raw ? [raw] : [])) as IncomingMessage;
    req.method = method; req.url = path;
    req.headers = { cookie: 'chatdom_session=handle', origin: config.publicOrigin, 'content-type': 'application/json',
      'x-csrf-token': csrfFor('handle'), ...headers };
    let status = 0, output = '', responseHeaders: Record<string, string> = {};
    const res = { writeHead(code: number, values: Record<string, string>) { status = code; responseHeaders = values; return res; },
      end(value: string) { output = value; return res; } } as unknown as ServerResponse;
    const handled = await handleRaidGuest(req, res, { pool: { query } as unknown as Pool, config, authority });
    return { handled, status, body: output ? JSON.parse(output) as unknown : null, headers: responseHeaders };
  }
  return { query, authority, request };
}

describe('the cookie-owned raid guest HTTP boundary', () => {
  it('uses only the cookie session identity, hashes its handle, and never accepts a browser-selected entry', async () => {
    const t = setup();
    const response = await t.request('POST', body);
    expect(response).toMatchObject({ handled: true, status: 200, body: { status: 'pending', invitation: { raidId } },
      headers: { 'Cache-Control': 'no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' } });
    expect(t.query).toHaveBeenCalledWith(expect.stringContaining('realm_sessions'), [sha256('handle'), 'live']);
    expect(t.authority.begin).toHaveBeenCalledWith({ version: 1, origin: 'live', kingdomId, personId, sessionId, raidId });
    expect(t.authority.guest).not.toHaveBeenCalled();
  });

  it('reads only the caller’s committed current guest, including a truthful null result', async () => {
    const t = setup();
    expect(await t.request('GET', '', { origin: undefined, 'x-csrf-token': undefined })).toMatchObject({ status: 200, body: { version: 1, guest } });
    expect(t.authority.guest).toHaveBeenCalledWith({ version: 1, origin: 'live', kingdomId, personId, sessionId });
    t.authority.guest.mockResolvedValueOnce(null);
    expect((await t.request()).body).toEqual({ version: 1, guest: null });
    expect(t.authority.begin).not.toHaveBeenCalled();
  });

  it('refuses absent, expired or malformed cookie identity before calling authority', async () => {
    const absent = setup(), expired = setup({ anonymous: true });
    expect((await absent.request('POST', body, { cookie: undefined })).status).toBe(401);
    expect((await expired.request('GET', '', { cookie: 'chatdom_session=handle' })).status).toBe(401);
    expect(absent.authority.begin).not.toHaveBeenCalled(); expect(expired.authority.guest).not.toHaveBeenCalled();
  });

  it('requires the configured secure cookie name and a valid server principal', async () => {
    const t = setup({ secureCookies: true });
    expect((await t.request('POST', body)).status).toBe(401);
    expect((await t.request('POST', body, { cookie: '__Host-chatdom_session=handle' })).status).toBe(200);
    const malformed = setup();
    malformed.query.mockResolvedValueOnce({ rows: [{ person_id: personId, session_id: 'not-a-session' }] });
    expect((await malformed.request()).status).toBe(401);
    expect(malformed.authority.guest).not.toHaveBeenCalled();
  });

  it.each([
    { origin: 'https://outside.test' }, { origin: undefined }, { 'sec-fetch-site': 'cross-site' },
    { 'x-csrf-token': undefined }, { 'x-csrf-token': csrfFor('another-session') },
  ])('requires same Origin and the same session’s CSRF token: %j', async headers => {
    const t = setup();
    expect((await t.request('POST', body, headers)).status).toBe(403);
    expect(t.authority.begin).not.toHaveBeenCalled();
  });

  it.each(['personId', 'sessionId', 'entryId', 'origin', 'kingdomId', 'arrivedAt', 'status'])('rejects browser authority field %s', async field => {
    const t = setup();
    expect((await t.request('POST', JSON.stringify({ version: 1, raidId, [field]: 'asserted-by-browser' }))).status).toBe(400);
    expect(t.authority.begin).not.toHaveBeenCalled();
  });

  it('caps declared and actual streamed bytes, including multibyte bodies', async () => {
    const t = setup();
    expect((await t.request('POST', body, { 'content-length': String(RAID_GUEST_BODY_BYTES + 1) })).status).toBe(413);
    expect((await t.request('POST', '', {}, undefined, [' '.repeat(1_024), ' '.repeat(1_025)])).status).toBe(413);
    expect((await t.request('POST', 'é'.repeat(1_025))).status).toBe(413);
    expect(t.authority.begin).not.toHaveBeenCalled();
  });

  it('rejects unsupported content, malformed JSON, schema mismatches and unsupported methods', async () => {
    const t = setup();
    expect((await t.request('POST', body, { 'content-type': 'text/plain' })).status).toBe(415);
    for (const invalid of ['{', '{}', JSON.stringify({ version: 2, raidId }), JSON.stringify({ version: 1, raidId: 'guessed-raid' })]) {
      expect((await t.request('POST', invalid)).status).toBe(400);
    }
    expect((await t.request('DELETE', body)).status).toBe(405);
    expect(t.authority.begin).not.toHaveBeenCalled();
  });

  it('exposes no HTTP arrival, departure, heartbeat, query assertion or private authority command', async () => {
    const t = setup();
    for (const suffix of ['/arrived', '/departed', '/present', `?entryId=${entryId}`, `?raidId=${raidId}`]) {
      expect((await t.request('POST', body, {}, `/api/raid-gate/guest/${kingdomId}${suffix}`)).status).toBe(400);
    }
    for (const path of ['/internal/realm/raid-gate/guests/arrived', '/live-realm-data/internal/realm/raid-gate/guests/arrived']) {
      expect((await t.request('POST', body, {}, path)).handled).toBe(false);
      expect(classify(path, '')).toEqual({ kind: 'not-found', api: true });
    }
    expect(t.authority.begin).not.toHaveBeenCalled(); expect(t.authority.guest).not.toHaveBeenCalled();
    expect(t.authority.arrived).not.toHaveBeenCalled(); expect(t.authority.departed).not.toHaveBeenCalled(); expect(t.authority.present).not.toHaveBeenCalled();
  });

  it('reports storage failure or an invalid authority projection as unavailable', async () => {
    const brokenSession = setup(); brokenSession.query.mockRejectedValueOnce(new Error('SIMULATED storage outage'));
    expect((await brokenSession.request()).status).toBe(503);
    const brokenRead = setup(); brokenRead.authority.guest.mockRejectedValueOnce(new Error('SIMULATED read outage'));
    expect((await brokenRead.request()).status).toBe(503);
    const malformed = setup(); malformed.authority.guest.mockResolvedValueOnce({ ...guest, to: { ...guest.to, kingdomId: KingdomIdSchema.parse('99') } });
    expect((await malformed.request()).status).toBe(503);
    const brokenBegin = setup(); brokenBegin.authority.begin.mockRejectedValueOnce(new Error('SIMULATED write outage'));
    expect((await brokenBegin.request('POST', body)).status).toBe(503);
  });
});
