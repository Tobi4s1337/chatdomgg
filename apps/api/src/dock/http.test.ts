import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RealmAuthConfig } from '../realm-auth/config';
import { csrfFor } from '../realm-auth/secrets';
import { DockStateSchema, type DockState } from './contracts';
import { handleDock, type DockBackend } from './index';

const config = { mode: 'simulated', secureCookies: false, publicOrigin: 'http://localhost:5170' } as RealmAuthConfig;
const state: DockState = { kingdom: { id: '42', name: 'Town' }, principal: { role: 'broadcaster', displayName: 'Ruler' },
  town: { gate: 'open', fire: 'unlit', presenceLabel: 'One', growthLabel: 'None', comingLabel: 'None' }, raids: [], citizens: [], moments: [],
  capabilities: [{ kind: 'gate-open', allowed: true, reason: '' }, { kind: 'undo', allowed: true, reason: '' }], revision: 'r1' };
const command = { id: 'action:1', kingdomId: '42', kind: 'gate-open', expectedRevision: 'r1' };
const actor = { person_id: '42', session_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function fixture(backend: DockBackend) {
  let active = true;
  const query = vi.fn(async (sql: string) => {
    // These conditions must stay in the actual database query; the stub supplies its result.
    expect(sql).toContain('revoked_at is null and expires_at > now()');
    return { rows: active ? [actor] : [] };
  });
  const pool = { query } as unknown as Pool;
  const dir = await mkdtemp(join(tmpdir(), 'dock-http-'));
  const socket = join(dir, 'api.sock');
  const server = createServer((req, res) => { void handleDock(req, res, { pool, config, backend }); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  cleanup.push(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); });
  const call = (method: 'GET' | 'POST', path: string, body?: unknown, includeCsrf = true) => new Promise<{ code: number; body: Record<string, unknown> }>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ socketPath: socket, method, path, headers: { cookie: 'chatdom_session=secret', origin: config.publicOrigin,
      'content-type': 'application/json', ...(includeCsrf ? { 'x-csrf-token': csrfFor('secret') } : {}) } }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk))); res.on('end', () => resolve({ code: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> }));
    }); req.on('error', reject); req.end(data);
  });
  return { call, endSession: () => { active = false; }, query };
}

describe('dock HTTP session and authority', () => {
  it('shows moderator status but masks royal actions and refuses a moderator POST', async () => {
    const action = vi.fn(async () => ({ status: 'refused' as const, message: 'No.' }));
    const f = await fixture({ status: async () => ({ ...state, principal: { role: 'moderator', displayName: 'Mod' } }), action });
    const status = await f.call('GET', '/api/dock/status?kingdom=42');
    expect(status.body.status).toBe('ready');
    expect(status.body.capabilities).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'gate-open', allowed: false })]));
    expect((await f.call('POST', '/api/dock/actions', command)).body.status).toBe('refused');
    expect(action).not.toHaveBeenCalled();
  });
  it('rechecks the session after ready, rejects missing CSRF and refuses expired or revoked sessions', async () => {
    const action = vi.fn(async () => ({ status: 'refused' as const, message: 'No.' }));
    const f = await fixture({ status: async () => state, action });
    expect((await f.call('GET', '/api/dock/status')).body.status).toBe('ready');
    expect((await f.call('POST', '/api/dock/actions', command, false)).code).toBe(403);
    f.endSession(); // The database returns no row when either expiry or revocation predicate fails.
    expect((await f.call('POST', '/api/dock/actions', command)).code).toBe(401);
    expect(action).not.toHaveBeenCalled();
  });
  it('rejects missing or invalid undo targets; realm retains authority over valid token targets', async () => {
    const action = vi.fn(async () => ({ status: 'refused' as const, message: 'Not undoable.' }));
    const f = await fixture({ status: async () => state, action });
    for (const targetId of [undefined, 'invalid space']) {
      const answer = await f.call('POST', '/api/dock/actions', { ...command, kind: 'undo', ...(targetId ? { targetId } : {}) });
      expect(answer.body.status).toBe('refused');
    }
    expect(action).not.toHaveBeenCalled();
    const result = await f.call('POST', '/api/dock/actions', { ...command, kind: 'undo', targetId: 'prior:1' });
    expect(result.body.status).toBe('refused');
    expect(action).toHaveBeenCalledOnce();
  });
  it('does not report accepted when a witness is bound to a different command', async () => {
    const action = vi.fn(async () => ({ status: 'accepted' as const, message: 'Shown.', receipt: 'receipt:1',
      witness: { actionId: 'other', kingdomId: '42', origin: 'simulated' as const, streamEventId: 'event:1' } }));
    const f = await fixture({ status: async () => state, action });
    expect((await f.call('POST', '/api/dock/actions', command)).body.status).toBe('unknown');
    expect(action).toHaveBeenCalledOnce();
  });
});

it('enforces the optional undoable receipt list while retaining older bridge compatibility', async () => {
  let current: DockState = state;
  const action = vi.fn(async () => ({ status: 'refused' as const, message: 'Not undoable.' }));
  const f = await fixture({ status: async () => current, action });
  const undo = { ...command, kind: 'undo', targetId: 'receipt:one' };
  await f.call('POST', '/api/dock/actions', undo);
  expect(action).toHaveBeenCalledTimes(1); // absent list: realm decides
  current = { ...state, undoable: [] };
  expect((await f.call('POST', '/api/dock/actions', undo)).body.status).toBe('refused');
  expect(action).toHaveBeenCalledTimes(1);
  current = { ...state, undoable: [{ id: 'receipt:one', kind: 'gate-open', label: 'Opening the gate' }] };
  await f.call('POST', '/api/dock/actions', { ...undo, targetId: 'receipt:other' });
  expect(action).toHaveBeenCalledTimes(1);
  await f.call('POST', '/api/dock/actions', undo);
  expect(action).toHaveBeenCalledTimes(2);
  const status = await f.call('GET', '/api/dock/status');
  expect(status.body.undoable).toEqual(current.undoable);
});

it('rejects undo lists that cannot represent an authorized original receipt', () => {
  expect(DockStateSchema.safeParse({ ...state, undoable: [{ id: 'receipt:1', kind: 'undo', label: 'Undo' }] }).success).toBe(false);
  expect(DockStateSchema.safeParse({ ...state, undoable: Array.from({ length: 21 }, (_, i) => ({ id: `receipt:${i}`, kind: 'gate-open', label: 'Gate' })) }).success).toBe(false);
});
