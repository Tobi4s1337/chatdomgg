import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { RealmAuthConfig } from '../realm-auth/config';
import { csrfFor } from '../realm-auth/secrets';
import { handleDock, type DockBackend } from './index';
import type { DockState } from './contracts';

const config = { mode: 'simulated', secureCookies: false, publicOrigin: 'http://localhost:5170' } as RealmAuthConfig;
const pool = { query: async () => ({ rows: [{ person_id: '42', session_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }] }) } as unknown as Pool;
const state: DockState = { kingdom: { id: '42', name: 'Town' }, principal: { role: 'broadcaster', displayName: 'Ruler' },
  town: { gate: 'closed', fire: 'unlit', presenceLabel: 'None', growthLabel: 'None', comingLabel: 'None' }, raids: [], citizens: [], moments: [],
  capabilities: [{ kind: 'gate-open', allowed: true, reason: '' }], revision: 'r1' };
function request(method: string, path: string, data?: unknown, overrides: Record<string, string> = {}) {
  const req = Readable.from(data === undefined ? [] : [JSON.stringify(data)]) as IncomingMessage;
  req.method = method; req.url = path; req.headers = { cookie: 'chatdom_session=secret', origin: config.publicOrigin,
    'content-type': 'application/json', 'x-csrf-token': csrfFor('secret'), ...overrides };
  let code = 0, output = '';
  const res = { setHeader: vi.fn(), writeHead: vi.fn((status: number) => { code = status; return res; }), end: vi.fn((value: string) => { output = value; return res; }) } as unknown as ServerResponse;
  return { req, res, result: () => ({ code, body: JSON.parse(output) as Record<string, unknown> }) };
}
const command = { id: 'one', kingdomId: '42', kind: 'gate-open', expectedRevision: 'r1' };

describe('dock boundary', () => {
  it('reports unavailable without a realm bridge', async () => {
    const f = request('GET', '/api/dock/status');
    await handleDock(f.req, f.res, { pool, config });
    expect(f.result().body.status).toBe('unavailable');
  });
  it('requires CSRF, broadcaster authority, an enabled capability, and a current revision', async () => {
    const action = vi.fn(async () => ({ status: 'accepted' as const, message: 'Seen on stream.', receipt: 'receipt-1', witness: { actionId: 'one', kingdomId: '42', origin: 'simulated' as const, streamEventId: 'stream:1' } }));
    let current = state;
    const backend: DockBackend = { status: async () => current, action };
    const badCsrf = request('POST', '/api/dock/actions', command, { 'x-csrf-token': 'bad' });
    await handleDock(badCsrf.req, badCsrf.res, { pool, config, backend });
    expect(badCsrf.result().code).toBe(403);
    current = { ...state, principal: { role: 'moderator', displayName: 'Mod' } };
    const mod = request('POST', '/api/dock/actions', command);
    await handleDock(mod.req, mod.res, { pool, config, backend });
    expect(mod.result().code).toBe(409);
    current = state;
    const stale = request('POST', '/api/dock/actions', { ...command, expectedRevision: 'old' });
    await handleDock(stale.req, stale.res, { pool, config, backend });
    expect(stale.result().code).toBe(409);
    expect(action).not.toHaveBeenCalled();
    const ok = request('POST', '/api/dock/actions', command);
    await handleDock(ok.req, ok.res, { pool, config, backend });
    expect(ok.result().body.status).toBe('accepted');
  });
  it('reports an unknown outcome if delivery may have happened and never retries', async () => {
    const action = vi.fn(async () => { throw new Error('lost reply'); });
    const f = request('POST', '/api/dock/actions', command);
    await handleDock(f.req, f.res, { pool, config, backend: { status: async () => state, action } });
    expect(f.result().body.status).toBe('unknown');
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe('dock refusal cases', () => {
  it('does not expose session handles, and refuses anonymous or revoked sessions', async () => {
    const backend: DockBackend = { status: async () => state, action: async () => ({ status: 'refused', message: 'No.' }) };
    const anonymous = request('GET', '/api/dock/status', undefined, { cookie: '' });
    await handleDock(anonymous.req, anonymous.res, { pool, config, backend });
    expect(anonymous.result().body.status).toBe('anonymous');
    const revokedPool = { query: async () => ({ rows: [] }) } as unknown as Pool;
    const revoked = request('GET', '/api/dock/status');
    await handleDock(revoked.req, revoked.res, { pool: revokedPool, config, backend });
    expect(revoked.result().body.status).toBe('anonymous');
    const ready = request('GET', '/api/dock/status');
    await handleDock(ready.req, ready.res, { pool, config, backend });
    expect(JSON.stringify(ready.result().body)).not.toContain('secret');
  });
  it('refuses forged broadcaster identity and malformed state', async () => {
    for (const candidate of [{ ...state, kingdom: { id: '43', name: 'Other' } }, { ...state, town: { ...state.town, gate: 'broken' } }]) {
      const f = request('GET', '/api/dock/status?kingdom=43');
      await handleDock(f.req, f.res, { pool, config, backend: { status: async () => candidate as DockState, action: async () => ({ status: 'refused', message: 'No.' }) } });
      expect(['forbidden', 'unavailable']).toContain(f.result().body.status);
    }
  });
  it('rejects cross-origin, malformed, disabled and invalid target actions', async () => {
    const action = vi.fn(async () => ({ status: 'accepted' as const, message: 'Seen.', receipt: 'r', witness: { actionId: 'one', kingdomId: '42', origin: 'simulated' as const, streamEventId: 'stream:1' } }));
    const backend: DockBackend = { status: async () => ({ ...state, capabilities: [...state.capabilities, { kind: 'citizen-crown', allowed: true, reason: '' }] }), action };
    for (const [payload, overrides] of [[command, { origin: 'https://evil.test' }], [{ ...command, kind: 'bad' }, {}], [{ ...command, kind: 'fire-light' }, {}], [{ ...command, kind: 'citizen-crown', targetId: 'noncitizen' }, {}]] as const) {
      const f = request('POST', '/api/dock/actions', payload, overrides);
      await handleDock(f.req, f.res, { pool, config, backend });
      expect(f.result().body.status).toBe('refused');
    }
    expect(action).not.toHaveBeenCalled();
  });
  it('does not accept an unwitnessed receipt', async () => {
    const f = request('POST', '/api/dock/actions', command);
    await handleDock(f.req, f.res, { pool, config, backend: { status: async () => state, action: async () => ({ status: 'accepted', message: 'Done.' }) } });
    expect(f.result().body.status).toBe('unknown');
  });
});

it('requires the stream witness to match the action, kingdom and origin', async () => {
  for (const witness of [
    { actionId: 'other', kingdomId: '42', origin: 'simulated' as const, streamEventId: 'stream:1' },
    { actionId: 'one', kingdomId: '43', origin: 'simulated' as const, streamEventId: 'stream:1' },
    { actionId: 'one', kingdomId: '42', origin: 'live' as const, streamEventId: 'stream:1' },
  ]) {
    const f = request('POST', '/api/dock/actions', command);
    await handleDock(f.req, f.res, { pool, config, backend: { status: async () => state,
      action: async () => ({ status: 'accepted', message: 'Done.', receipt: 'receipt:1', witness }) } });
    expect(f.result().body.status).toBe('unknown');
  }
});

it('accepts realm token identifiers such as colon-bearing moment IDs', async () => {
  const f = request('POST', '/api/dock/actions', { ...command, id: 'dock:1', kind: 'moment-play', targetId: 'moment:dragon.1' });
  const momentState: DockState = { ...state, capabilities: [{ kind: 'moment-play', allowed: true, reason: '' }],
    moments: [{ id: 'moment:dragon.1', name: 'Dragon', available: true, reason: '' }] };
  await handleDock(f.req, f.res, { pool, config, backend: { status: async () => momentState,
    action: async () => ({ status: 'accepted', message: 'Seen.', receipt: 'receipt:1', witness: { actionId: 'dock:1', kingdomId: '42', origin: 'simulated', streamEventId: 'stream:1' } }) } });
  expect(f.result().body.status).toBe('accepted');
});
