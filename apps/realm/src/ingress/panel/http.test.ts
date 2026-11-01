import { randomBytes } from 'node:crypto';
import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { expect, it, vi } from 'vitest';
import { RealmPanelService, type RealmPanelOptions } from './service';
import { mountRealmPanelRoutes, REALM_PANEL_ROUTES } from './http';

type App = uWebSocketsTransport['app'];
type Handler = Parameters<App['post']>[1];
const secret = randomBytes(32).toString('hex');

function harness() {
  const routes = new Map<string, Handler>();
  const query = vi.fn(async () => { throw new Error('SIMULATED no SQL expected'); });
  const currentLayout = vi.fn(async () => null);
  const panel = new RealmPanelService({ db: { query }, origin: 'simulated', secret,
    allocation: { currentLayout }, services: {}, citizens: {} } as unknown as RealmPanelOptions);
  mountRealmPanelRoutes({ post: (path: string, handle: Handler) => { routes.set(path, handle); },
    get: (path: string, handle: Handler) => { routes.set(path, handle); } } as unknown as App, panel);
  function request(route: string, headers: Record<string, string> = {}, parameter = '123') {
    let status = '', body = '', data: ((chunk: ArrayBuffer, last: boolean) => void) | undefined, aborted: (() => void) | undefined;
    const outgoing = new Map<string, string>();
    const response = {
      onAborted(fn: () => void) { aborted = fn; return response; },
      onData(fn: typeof data) { data = fn; return response; },
      cork(fn: () => void) { fn(); return response; },
      writeStatus(value: string) { status = value; return response; },
      writeHeader(name: string, value: string) { outgoing.set(name, value); return response; },
      end(value: string) { body = value; return response; },
    };
    const handle = routes.get(route);
    if (!handle) throw new Error('SIMULATED unknown route');
    handle(response as unknown as Parameters<Handler>[0], { getHeader: (name: string) => headers[name] ?? '',
      getParameter: () => parameter } as unknown as Parameters<Handler>[1]);
    return { send(text: string) { const bytes = new TextEncoder().encode(text); data?.(bytes.buffer as ArrayBuffer, true); },
      abort() { aborted?.(); }, answer: () => ({ status, body, headers: outgoing }), listening: () => !!data };
  }
  return { request, query, currentLayout };
}

it('authenticates before buffering and never offers browser CORS', () => {
  const test = harness(), response = test.request(REALM_PANEL_ROUTES.claim, { 'content-type': 'application/json' });
  expect(response.answer().status).toBe('401 Unauthorized'); expect(response.listening()).toBe(false);
  expect(response.answer().headers.get('Access-Control-Allow-Origin')).toBeUndefined();
  expect(test.query).not.toHaveBeenCalled(); expect(test.currentLayout).not.toHaveBeenCalled();
});

it('bounds streamed bodies and rejects malformed JSON without reaching realm services', () => {
  const test = harness(), headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
  const tooLarge = test.request(REALM_PANEL_ROUTES.claim, headers); tooLarge.send('a'.repeat(4_097));
  expect(tooLarge.answer().status).toBe('400 Bad Request');
  const malformed = test.request(REALM_PANEL_ROUTES.claim, headers); malformed.send('{');
  expect(malformed.answer().status).toBe('400 Bad Request');
  const declared = test.request(REALM_PANEL_ROUTES.claim, { ...headers, 'content-length': '4097' });
  expect(declared.answer().status).toBe('400 Bad Request'); expect(declared.listening()).toBe(false);
  expect(test.currentLayout).not.toHaveBeenCalled();
});

it('uses the real service for valid claims and discards work after the client aborts', async () => {
  const test = harness(), headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
  const valid = test.request(REALM_PANEL_ROUTES.claim, headers);
  valid.send(JSON.stringify({ kingdomId: '123', personId: '456', name: 'SIMULATED Wren' }));
  await vi.waitFor(() => expect(valid.answer().status).toBe('200 OK'));
  expect(JSON.parse(valid.answer().body)).toEqual({ version: 1, status: 'unfounded' });
  const aborted = test.request(REALM_PANEL_ROUTES.claim, headers); aborted.abort();
  aborted.send(JSON.stringify({ kingdomId: '123', personId: '456', name: 'SIMULATED Wren' }));
  expect(aborted.answer().body).toBe(''); expect(test.currentLayout).toHaveBeenCalledTimes(1);
});
