import { describe, expect, it } from 'vitest';
import type { KingdomId } from '@chatdom/shared';
import { mountEntryRoutes } from './entry';

// A stand-in for the uWebSockets app: it keeps the one handler and answers like a response object.
function harness(names: ReadonlyMap<KingdomId, string>) {
  let handler!: (res: unknown, req: unknown) => void;
  const app = { get: (_route: string, next: typeof handler) => { handler = next; } };
  const founded = { manifest: async (kingdomId: KingdomId) => ({ kingdomId, origin: 'live' as const }) };
  mountEntryRoutes(app as never, founded as never, 'live', names);
  return (kingdomId: string) => new Promise<{ status: string; body: Record<string, unknown> }>(done => {
    let status = '';
    const res = {
      onAborted: () => {}, cork: (work: () => void) => work(), writeHeader: () => res,
      writeStatus: (value: string) => { status = value; return res; },
      end: (body: string) => done({ status, body: JSON.parse(body) as Record<string, unknown> }),
    };
    handler(res, { getParameter: () => kingdomId, getHeader: () => '' });
  });
}

describe('the realm entry route', () => {
  const read = harness(new Map([['129634568' as KingdomId, 'Willowmere']]));

  it('names an approved kingdom', async () => {
    expect(await read('129634568')).toEqual({ status: '200 OK', body: { version: 1, kingdomId: '129634568', origin: 'live', name: 'Willowmere' } });
  });

  it('answers 404 in words for a kingdom this host does not open to visitors, so the gate can say the road leads nowhere', async () => {
    const { status, body } = await read('999999999999');
    expect(status).toBe('404 Not Found');
    expect(body).toEqual({ version: 1, status: 'unavailable', message: 'No kingdom with this address is open to visitors.' });
  });

  it('refuses an address that is not a kingdom', async () => {
    expect((await read('../map')).status).toBe('400 Bad Request');
  });
});
