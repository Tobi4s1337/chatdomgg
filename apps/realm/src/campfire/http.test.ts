import { GATHER_CHAT_ROUTE, type GatherChatEnvelope } from '@chatdom/shared';
import { expect, it } from 'vitest';
import { listenForTest } from '../games/test-socket';
import { referenceServices } from '../reference';
import { createRealmServer } from '../server';
import { mountGatherChatRoute } from './http';

const SECRET = 'SIMULATED-gather-route-secret-0123456789abcdef';
const line = (messageId: string): GatherChatEnvelope => ({ kind: 'command', kingdomId: '999000001' as never, messageId, at: Date.UTC(2026, 10, 2, 21),
  chatter: { twitchId: '5551234' as never, login: 'simulatedviewer', displayName: 'SimulatedViewer' }, command: 'sus', arg: 'Visitor 2' });

it('takes the Gallery\'s chat lines only with the internal bearer, as strict JSON, and answers nothing in chat', async () => {
  expect(() => mountGatherChatRoute({} as never, 'short', async () => {})).toThrow(/32 characters/);
  const created = createRealmServer(referenceServices()), delivered: GatherChatEnvelope[] = [];
  let failing = false;
  mountGatherChatRoute(created.transport.app, SECRET, async envelope => { if (failing) throw new Error('store down'); delivered.push(envelope); });
  const url = await listenForTest(created);
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${url}${GATHER_CHAT_ROUTE}`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}`, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  try {
    expect((await post(line('m-1'), { authorization: '' })).status).toBe(401);
    expect((await post(line('m-1'), { authorization: `Bearer ${SECRET}x` })).status).toBe(401);
    expect((await post(line('m-1'), { 'content-type': 'text/plain' })).status).toBe(400);
    expect((await post('{not json')).status).toBe(400);
    expect((await post({ ...line('m-1'), extra: true })).status).toBe(400);
    expect((await post({ ...line('m-1'), arg: 'x'.repeat(33) })).status).toBe(400);
    expect((await post({ ...line('m-1'), padding: 'x'.repeat(5_000) })).status).toBe(400);
    expect(delivered).toEqual([]);
    const ok = await post(line('m-2'));
    expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ status: 'received' });
    expect(delivered).toEqual([line('m-2')]);
    failing = true;
    expect((await post(line('m-3'))).status).toBe(503);
  } finally { await created.server.gracefullyShutdown(false).catch(() => {}); }

  // Without a secret the route refuses everyone.
  const closed = createRealmServer(referenceServices());
  mountGatherChatRoute(closed.transport.app, undefined, async envelope => { delivered.push(envelope); });
  const closedUrl = await listenForTest(closed);
  try {
    const answer = await fetch(`${closedUrl}${GATHER_CHAT_ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer anything-at-all' }, body: JSON.stringify(line('m-4')) });
    expect(answer.status).toBe(401); expect(delivered).toHaveLength(1);
  } finally { await closed.server.gracefullyShutdown(false).catch(() => {}); }
}, 30_000);
