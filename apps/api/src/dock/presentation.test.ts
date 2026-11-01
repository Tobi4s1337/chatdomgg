import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import type { RealmAuthConfig } from '../realm-auth/config';
import { csrfFor } from '../realm-auth/secrets';
import { handleDockPresentation } from './presentation';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('forwards a draw acknowledgement with the session actor and refuses browser authority fields', async () => {
  vi.stubEnv('DOCK_REALM_URL', 'http://127.0.0.1:5197');
  const config = { mode: 'live', secureCookies: false, publicOrigin: 'http://localhost:5190', internalSecret: 'private-service-credential' } as RealmAuthConfig;
  const pool = { query: async () => ({ rows: [{ person_id: '42', session_id: '60d6558b-a890-4c79-a46f-6e398a348ba6' }] }) };
  const send = vi.fn(async () => new Response(JSON.stringify({ status: 'witnessed' }), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', send);
  async function request(body: unknown) {
    const req = Readable.from([JSON.stringify(body)]) as IncomingMessage;
    req.method = 'POST'; req.url = '/api/dock/witness'; req.headers = { cookie: 'chatdom_session=handle', origin: config.publicOrigin,
      'content-type': 'application/json', 'x-csrf-token': csrfFor('handle') };
    let status = 0, output = '';
    const res = { writeHead(code: number) { status = code; return res; }, end(value: string) { output = value; return res; } } as unknown as ServerResponse;
    expect(await handleDockPresentation(req, res, { config, pool })).toBe(true);
    return { status, output };
  }
  const event = { kingdomId: '42', streamEventId: 'dock:event', presenterToken: 'p'.repeat(43) };
  expect((await request({ ...event, principal: { personId: 'other' } })).status).toBe(400);
  expect(send).not.toHaveBeenCalled();
  const response = await request(event);
  expect(response).toEqual({ status: 200, output: '{"status":"witnessed"}' });
  const [, options] = send.mock.calls[0] as unknown as [URL, RequestInit];
  expect(JSON.parse(String(options.body))).toEqual({ version: 1, origin: 'live', principal: { personId: '42', sessionId: '60d6558b-a890-4c79-a46f-6e398a348ba6' }, ...event });
  expect(response.output).not.toContain(config.internalSecret);
});
