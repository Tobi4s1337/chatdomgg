import { describe, expect, it } from 'vitest';
import { createConfigTransport } from './transport';
import { DEFAULT_SETTINGS } from './schema';
import type { HelperBridge } from '../helper';

const current = { version: 1 as const, status: 'settings' as const, revision: '1', settings: DEFAULT_SETTINGS, connected: true };
const newer = { ...current, revision: '2', settings: { ...DEFAULT_SETTINGS, hidden: true } };
const sync = (publication: 'pending' | 'verified', reading = current) => ({ version: 1, status: 'sync', reading, publication, verifiedAt: publication === 'verified' ? 100 : null });
function setup(fetcher: typeof fetch, timeout = 10, requestTimeout = 20) {
  let authorization = 1, notify = () => {};
  const helper: HelperBridge = { token: () => 'private', authorization: () => authorization, status: () => ({ kind: 'waiting' }), subscribe: cb => { notify = () => cb(helper.status()); return () => {}; }, requestIdShare: () => false };
  const transport = createConfigTransport(helper, 'https://example.test', fetcher, timeout, requestTimeout);
  return { transport, changeIdentity: () => { authorization++; notify(); } };
}
const response = (value: unknown) => new Response(JSON.stringify(value));
describe('server-owned configuration publication', () => {
  it('keeps a realm acknowledgement pending until the exact publication is verified', async () => {
    const paths: string[] = [];
    const { transport } = setup(async input => { paths.push(String(input)); return response(String(input).endsWith('/configure') ? current : sync('pending')); });
    expect(await transport.save('0', DEFAULT_SETTINGS)).toEqual({ kind: 'pending', reading: current });
    expect(paths.every(path => path.endsWith('/configure') || path.endsWith('/configuration-sync'))).toBe(true);
  });
  it('confirms only a verified matching revision, settings and connection', async () => {
    const { transport } = setup(async input => response(String(input).endsWith('/configure') ? current : sync('verified')));
    expect(await transport.save('0', DEFAULT_SETTINGS)).toEqual({ kind: 'saved', reading: current });
  });
  it.each([newer, { ...current, connected: false }, { ...current, settings: { ...DEFAULT_SETTINGS, hidden: true } }])('surfaces a different current reading', async value => {
    const { transport } = setup(async input => response(String(input).endsWith('/configure') ? current : sync('verified', value)));
    expect(await transport.save('0', DEFAULT_SETTINGS)).toEqual({ kind: 'conflict', reading: value });
  });
  it('allows retrying a pending realm save without writing again', async () => {
    let verified = false, writes = 0;
    const { transport } = setup(async input => { if (String(input).endsWith('/configure')) { writes++; return response(current); } return response(sync(verified ? 'verified' : 'pending')); });
    expect((await transport.save('0', DEFAULT_SETTINGS)).kind).toBe('pending'); verified = true;
    expect((await transport.retrySync(current)).kind).toBe('saved'); expect(writes).toBe(1);
  });
  it('reports configure conflicts and refusals', async () => {
    expect((await setup(async () => response({ status: 'conflict', current: newer })).transport.save('0', DEFAULT_SETTINGS)).kind).toBe('conflict');
    expect((await setup(async () => new Response('', { status: 403 })).transport.save('0', DEFAULT_SETTINGS)).kind).toBe('refused');
  });
  it.each(['dispose', 'identity'] as const)('cancels a hanging request on %s', async action => {
    const state = setup(() => new Promise(() => {}), 10000, 10000);
    const result = state.transport.save('0', DEFAULT_SETTINGS);
    if (action === 'dispose') state.transport.dispose(); else state.changeIdentity();
    expect((await result).kind).toBe('changed');
  });
  it('ignores an old identity read even when the provider returns later', async () => {
    let respond!: (response: Response) => void;
    const state = setup(() => new Promise(resolve => { respond = resolve; }));
    const result = state.transport.readSync(); state.changeIdentity(); respond(response(sync('verified')));
    expect(await result).toBeNull();
  });
  it('bounds response size and provider time', async () => {
    expect(await setup(async () => new Response('x'.repeat(16385))).transport.readSync()).toBeNull();
    expect(await setup(() => new Promise(() => {}), 10, 5).transport.readSync()).toBeNull();
  });
  it('does not accept malformed verification', async () => {
    const { transport } = setup(async () => response({ ...sync('verified'), verifiedAt: null }));
    expect(await transport.readSync()).toBeNull();
  });
  it.each(['01', '-1', '9223372036854775808', '1.0', ''])('rejects noncanonical revision %s', async revision => {
    expect(await setup(async () => response(sync('verified', { ...current, revision }))).transport.readSync()).toBeNull();
  });
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER, Date.now() + 600_000])('rejects invalid verification time %s', async verifiedAt => {
    expect(await setup(async () => response({ ...sync('verified'), verifiedAt })).transport.readSync()).toBeNull();
  });

});
