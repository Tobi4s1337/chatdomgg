import { Readable } from 'node:stream';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { CrierError, type RaidCrierAuthority } from '../../../realm/src/raid-gate/crier';
import { classify } from '../public/routes';
import type { RealmAuthConfig } from '../realm-auth/config';
import { csrfFor, sha256 } from '../realm-auth/secrets';
import { handleRaidCrierSetting } from './crier-settings';

const config = { mode: 'live', secureCookies: false, publicOrigin: 'https://chatdom.gg' } as RealmAuthConfig;
const initial = { version: 1 as const, origin: 'live' as const, kingdomId: '42', revision: 0, mode: 'silent' as const };
function setup(person: string | null = '42', exists = true) {
  let setting: { version: 1; origin: 'live'; kingdomId: string; revision: number; mode: 'silent' | 'rare' | 'herald' } = { ...initial };
  const query = vi.fn(async (sql: string, values: unknown[]) => {
    if (sql.includes('realm_sessions')) return { rows: person ? [{ person_id: person, session_id: '60d6558b-a890-4c79-a46f-6e398a348ba6' }] : [] };
    if (sql.includes('realm_kingdoms')) return { rows: exists && values[0] === '42' && values[1] === 'live' ? [{ kingdom_id: '42' }] : [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const authority = {
    setting: vi.fn(async () => ({ ...setting })),
    configure: vi.fn(async (kingdomId: string, mode: typeof setting.mode, revision: number) => {
      if (revision !== setting.revision) throw new CrierError('conflict', 'stale');
      setting = { ...setting, kingdomId, mode, revision: revision + 1 }; return { ...setting };
    }),
  };
  async function request(method = 'GET', body = '', headers: IncomingHttpHeaders = {}, path = '/api/raid-gate/crier/42') {
    const req = Readable.from(body ? [body] : []) as IncomingMessage;
    req.method = method; req.url = path;
    req.headers = { cookie: 'chatdom_session=handle', origin: config.publicOrigin, 'content-type': 'application/json', 'x-csrf-token': csrfFor('handle'), ...headers };
    let status = 0, output = '', responseHeaders: Record<string, string> = {};
    const res = { writeHead(code: number, h: Record<string, string>) { status = code; responseHeaders = h; return res; }, end(value: string) { output = value; return res; } } as unknown as ServerResponse;
    const handled = await handleRaidCrierSetting(req, res, { pool: { query } as unknown as Pool, config, authority: authority as unknown as RaidCrierAuthority });
    return { handled, status, body: output ? JSON.parse(output) as unknown : null, headers: responseHeaders };
  }
  return { query, authority, request };
}
const change = JSON.stringify({ version: 1, expectedRevision: 0, mode: 'rare' });

describe('broadcaster crier setting', () => {
  it('reads the default and returns a session-bound CSRF token', async () => {
    const t = setup();
    expect(await t.request()).toMatchObject({ handled: true, status: 200, body: { ...initial, csrfToken: csrfFor('handle') }, headers: { 'Cache-Control': 'no-store' } });
    expect(t.query.mock.calls[0]?.[1]).toEqual([sha256('handle'), 'live']);
    expect(t.query.mock.calls[1]?.[1]).toEqual(['42', 'live']);
    expect(t.authority.setting).toHaveBeenCalledWith('42');
  });
  it('denies another person, an ended session, and a kingdom in another origin', async () => {
    const foreign = setup('43'), ended = setup(null), wrongOrigin = setup('42', false);
    expect((await foreign.request()).status).toBe(403);
    expect((await ended.request()).status).toBe(401);
    expect((await wrongOrigin.request()).status).toBe(404);
    expect(foreign.authority.setting).not.toHaveBeenCalled();
    expect(ended.authority.setting).not.toHaveBeenCalled();
    expect(wrongOrigin.authority.setting).not.toHaveBeenCalled();
  });
  it('requires same-origin and session-bound CSRF, and rejects authority fields', async () => {
    const t = setup();
    expect((await t.request('POST', change, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await t.request('POST', change, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await t.request('POST', change, { 'x-csrf-token': csrfFor('other') })).status).toBe(403);
    expect((await t.request('POST', JSON.stringify({ version: 1, expectedRevision: 0, mode: 'rare', role: 'monarch' }))).status).toBe(400);
    expect(t.authority.configure).not.toHaveBeenCalled();
  });
  it('writes through the same authority, reads the new revision, and propagates stale CAS', async () => {
    const t = setup();
    expect((await t.request('POST', change)).body).toEqual({ ...initial, revision: 1, mode: 'rare' });
    expect(t.authority.configure).toHaveBeenCalledWith('42', 'rare', 0);
    expect((await t.request()).body).toEqual({ ...initial, revision: 1, mode: 'rare', csrfToken: csrfFor('handle') });
    expect((await t.request('POST', change)).status).toBe(409);
    expect((await t.request()).body).toMatchObject({ revision: 1, mode: 'rare' });
  });
  it('rejects oversized bodies both by declared length and streamed bytes', async () => {
    const t = setup();
    expect((await t.request('POST', change, { 'content-length': '1025' })).status).toBe(413);
    expect((await t.request('POST', ' '.repeat(1025))).status).toBe(413);
    expect(t.authority.configure).not.toHaveBeenCalled();
  });
  it('publishes the setting to auth only and never publishes internal crier commands', () => {
    expect(classify('/api/raid-gate/crier/42', '')).toEqual({ kind: 'auth' });
    for (const path of ['/internal/realm/raid-gate/crier/claim', '/internal/realm/raid-gate/crier/receipt', '/live-realm-data/internal/realm/raid-gate/crier/claim']) {
      expect(classify(path, '')).toEqual({ kind: 'not-found', api: true });
    }
  });
});
