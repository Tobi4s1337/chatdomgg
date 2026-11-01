import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelReading } from '../../../api/src/public/panel/contracts';
import type { HelperBridge, HelperStatus } from '../helper';
import type { PanelAdapter } from '../model';
import { createProductionAdapter, HELPER_PATIENCE_MS, KINGDOM_REFRESH_MS, READING_REFRESH_MS } from './production';

const BACKEND = 'https://chatdom.io';
const AUTHORIZED: HelperStatus = { kind: 'authorized', loggedIn: true, shared: true, role: 'viewer', bits: false };
const KINGDOM = { name: 'Lanternmere', tier: 'hamlet', motto: 'A town lit by chat', walk: 'https://chatdom.io/?walk=1&kingdom=1001' } as const;
const CARD = { name: 'Wren', colour: '#8a2be2', standing: 'Citizen of Lanternmere', following: null, subscribed: null, home: { name: 'Number 5', tier: 'cottage' }, elsewhere: [] } as const;
const HOME = { street: 'Lantern Row', place: 'Number 5 on Lantern Row', description: 'A cottage of warm timber.', since: '1 Nov 2026' };
const READING: PanelReading = { version: 1, kingdom: KINGDOM, viewer: { kind: 'citizen', card: CARD, home: HOME } };
const KINGDOM_STATE = { version: 1, status: 'kingdom', stream: 'live', lights: 3, moment: 'A home rose on Lantern Row.', picture: null, pledges: null };

function standIn(status: HelperStatus = AUTHORIZED, token: string | null = 'token-1') {
  const listeners = new Set<(status: HelperStatus) => void>();
  let visible = true, playing = true, authorization = 1;
  const notify = () => { for (const listener of listeners) listener(status); };
  const requestIdShare = vi.fn(() => true);
  const bridge: HelperBridge = {
    status: () => status, token: () => token, visible: () => visible, active: () => visible && playing, authorization: () => authorization,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, requestIdShare,
  };
  return {
    bridge, requestIdShare,
    authorize(next: string, nextStatus: HelperStatus = AUTHORIZED) { token = next; status = nextStatus; authorization++; notify(); },
    viewer(next: HelperStatus) { status = next; notify(); },
    visible(next: boolean) { visible = next; notify(); },
    playing(next: boolean) { playing = next; notify(); },
  };
}
function backend() {
  let reading: unknown = READING, kingdom: unknown = KINGDOM_STATE, light: unknown = { status: 'deed', lit: true };
  let fail = false;
  const send = vi.fn<typeof fetch>(async (input, init) => {
    if (fail) throw new TypeError('offline');
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/picture')) return new Response(new Blob(['webp'], { type: 'image/webp' }));
    const body = path.endsWith('/reading') ? reading : path.endsWith('/kingdom') ? kingdom : path.endsWith('/light') ? light : path.endsWith('/pledge') ? { status: 'pledged', band: 'A handful of tents' } : path.endsWith('/privacy') ? { version: 1, status: 'privacy', quiet: false, projection: 'pending', forgetAvailable: true } : path.endsWith('/quiet') ? { version: 1, status: 'quiet', quiet: JSON.parse(String(init?.body)).quiet, projection: 'pending', forgetAvailable: true } : path.endsWith('/forget') ? { version: 1, status: 'forgotten', erased: ['home', 'presence'] } : { status: 'accepted', lit: false };
    expect(init?.signal?.aborted).toBe(false);
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  });
  return { send, reading(value: unknown) { reading = value; }, kingdom(value: unknown) { kingdom = value; }, light(value: unknown) { light = value; }, fail() { fail = true; } };
}
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const calls = (server: ReturnType<typeof backend>, suffix: string) => server.send.mock.calls.filter(([url]) => String(url).endsWith(suffix));
const open: PanelAdapter[] = [];
const track = (adapter: PanelAdapter) => { open.push(adapter); return adapter; };
const mount = (helper = standIn(), server = backend()) => ({ helper, server, adapter: track(createProductionAdapter(helper.bridge, { backend: BACKEND, fetch: server.send })) });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { for (const adapter of open.splice(0)) adapter.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('verified panel transport', () => {
  it('never sends without a backend or before Twitch authorizes', async () => {
    const helper = standIn({ kind: 'waiting' }, null), server = backend();
    const noBackend = track(createProductionAdapter(helper.bridge, { fetch: server.send }));
    const waiting = track(createProductionAdapter(helper.bridge, { backend: BACKEND, fetch: server.send }));
    await vi.advanceTimersByTimeAsync(HELPER_PATIENCE_MS);
    expect(waiting.get().connection.kind).toBe('no-answer'); expect(server.send).not.toHaveBeenCalled();
    helper.authorize('token-2'); await settle();
    expect(noBackend.get().connection.kind).toBe('kingdom-unavailable');
    expect(waiting.get().connection.kind).toBe('connected');
  });

  it('reads the verified home, lights and moment using header authentication only', async () => {
    const { server, adapter } = mount(); await settle();
    expect(adapter.get()).toMatchObject({ connection: { kind: 'connected' }, kingdom: { name: 'Lanternmere' }, stream: 'live', kingdomLights: 3, moment: KINGDOM_STATE.moment, home: { kind: 'citizen', displayName: 'Wren', street: 'Lantern Row' } });
    expect(adapter.get().light.kind).not.toBe('lit');
    for (const [url, init] of server.send.mock.calls) {
      expect(String(url)).not.toContain('token');
      expect(init).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', body: '{}', headers: { authorization: 'Bearer token-1' } });
    }
    expect(JSON.stringify(adapter.get())).not.toContain('token-1');
  });

  it('maps guest, monarch, anonymous and unshared readings without fabricating homes', async () => {
    const cases: [PanelReading['viewer'], string][] = [
      [{ kind: 'guest', card: { ...CARD, home: null } }, 'guest'], [{ kind: 'monarch', card: CARD }, 'known'],
      [{ kind: 'anonymous' }, 'unknown'], [{ kind: 'unshared' }, 'unknown'],
    ];
    for (const [viewer, expected] of cases) {
      const server = backend(); server.reading({ ...READING, viewer });
      const { adapter } = mount(standIn(), server); await settle(); expect(adapter.get().home.kind).toBe(expected);
      if (viewer.kind === 'anonymous' || viewer.kind === 'unshared') {
        const hidden = mount(standIn({ ...AUTHORIZED, shared: false }), server); await settle(); expect(hidden.adapter.get().privacy).toBeUndefined();
      }
    }
  });

  it('claims and lights only after a verified affirmative realm answer', async () => {
    const { server, adapter } = mount(); await settle();
    server.light({ status: 'deed', lit: false }); adapter.requestLight('named'); await settle();
    expect(adapter.get().light.kind).not.toBe('lit');
    server.light({ status: 'deed', lit: true }); adapter.requestLight('named'); await settle();
    expect(adapter.get().light).toEqual({ kind: 'lit', choice: 'named', as: 'citizen', by: 'realm' });
    expect(calls(server, '/light')).toHaveLength(2);
    expect(calls(server, '/light')[0]?.[1]?.body).toBe('{"observe":true}');
    expect(calls(server, '/reading').length).toBeGreaterThanOrEqual(2);
  });

  it('continues the original gesture only after onAuthorized, never viewer.onChanged', async () => {
    const helper = standIn({ ...AUTHORIZED, shared: false }); const { adapter, server } = mount(helper); await settle();
    adapter.requestLight('named');
    expect(helper.requestIdShare).toHaveBeenCalledOnce(); expect(adapter.get().light).toMatchObject({ kind: 'pending', step: 'sharing' });
    helper.viewer(AUTHORIZED); await settle(); expect(calls(server, '/light')).toHaveLength(0);
    helper.authorize('shared-token'); await settle();
    expect(calls(server, '/light')).toHaveLength(1);
    expect(calls(server, '/light')[0]?.[1]?.headers).toMatchObject({ authorization: 'Bearer shared-token' });
    expect(adapter.get().light.kind).toBe('lit');
  });

  it('keeps a refusal private and lets the viewer ask Twitch again', async () => {
    const helper = standIn({ ...AUTHORIZED, shared: false }), { adapter, server } = mount(helper); await settle();
    adapter.requestLight('named'); helper.authorize('refused-token', { ...AUTHORIZED, shared: false }); await settle();
    expect(adapter.get().light.kind).toBe('refused'); expect(calls(server, '/light')).toHaveLength(0);
    adapter.requestLight('named'); expect(helper.requestIdShare).toHaveBeenCalledTimes(2);
  });

  it('can finish sharing while paused and allocates without requesting presence', async () => {
    const helper = standIn({ ...AUTHORIZED, shared: false }), { adapter, server } = mount(helper); await settle();
    server.light({ status: 'deed', lit: false });
    adapter.requestLight('named'); helper.playing(false); helper.authorize('shared-token'); await settle();
    expect(calls(server, '/light')).toHaveLength(1); expect(calls(server, '/light')[0]?.[1]?.body).toBe('{"observe":false}');
    expect(calls(server, '/presence')).toHaveLength(0);
    expect(adapter.get().light.kind).not.toBe('lit');
  });

  it('shows guest, castle and private hold outcomes exactly as the realm answered', async () => {
    for (const [status, expected] of [['guest', { kind: 'lit', as: 'guest' }], ['castle', { kind: 'lit', as: 'castle' }], ['held', { kind: 'held' }]] as const) {
      const { server, adapter } = mount(); await settle(); server.light({ status, lit: true }); adapter.requestLight('named'); await settle();
      expect(adapter.get().light).toMatchObject(expected);
    }
  });

  it('pledges waiting land privately without claiming a home or lighting a window', async () => {
    const server = backend(); server.kingdom({ ...KINGDOM_STATE, status: 'unfounded', pledges: 'A few tents' }); server.reading({ version: 1, kingdom: null, viewer: { kind: 'unknown', reason: 'Waiting land.' } });
    const { adapter } = mount(standIn(), server); await settle();
    expect(adapter.get().entry.kind).toBe('none'); expect(adapter.get().light).toEqual({ kind: 'unfounded', pledged: false, band: 'A few tents' });
    adapter.requestLight('named'); await settle();
    expect(adapter.get().light).toEqual({ kind: 'unfounded', pledged: true, band: 'A handful of tents' });
    expect(calls(server, '/light')).toHaveLength(0); expect(calls(server, '/presence')).toHaveLength(0);
  });

  it('ignores malformed claim results and never infers success from Helper identity', async () => {
    const { adapter, server } = mount(); await settle();
    server.light({ status: 'deed', lit: 'true' }); adapter.requestLight('named'); await settle(); expect(adapter.get().light.kind).not.toBe('lit');
    server.fail(); adapter.requestLight('named'); await settle(); expect(adapter.get().light.kind).not.toBe('lit');
  });

  it('polls moments every five seconds, reads home each minute and marks a lost kingdom', async () => {
    const { adapter, server } = mount(); await settle();
    server.kingdom({ ...KINGDOM_STATE, lights: 7, moment: 'The gate opened.' });
    await vi.advanceTimersByTimeAsync(KINGDOM_REFRESH_MS);
    expect(adapter.get()).toMatchObject({ kingdomLights: 7, moment: 'The gate opened.' });
    expect(calls(server, '/reading')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(READING_REFRESH_MS - KINGDOM_REFRESH_MS);
    expect(calls(server, '/reading')).toHaveLength(2);
    server.fail(); await vi.advanceTimersByTimeAsync(KINGDOM_REFRESH_MS);
    expect(adapter.get().connection.kind).toBe('lost'); expect(adapter.get().kingdom?.name).toBe('Lanternmere');
  });

  it('fetches changed paintings as authenticated blobs and revokes URLs on replacement and disposal', async () => {
    const create = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second'), revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
    const server = backend(); const picture = { capturedAt: 1_793_520_000_000, revision: 'one', kind: 'realm' };
    server.kingdom({ ...KINGDOM_STATE, picture }); const { adapter } = mount(standIn(), server); await settle();
    expect(adapter.get().picture).toMatchObject({ kind: 'still', url: 'blob:first', provenance: { origin: 'realm', capturedOn: expect.any(String) } });
    expect(calls(server, '/picture')[0]?.[1]).toMatchObject({ method: 'GET', headers: { authorization: 'Bearer token-1' } });
    await vi.advanceTimersByTimeAsync(KINGDOM_REFRESH_MS); expect(calls(server, '/picture')).toHaveLength(1);
    server.kingdom({ ...KINGDOM_STATE, picture: { ...picture, revision: 'two', kind: 'sketch' } });
    await vi.advanceTimersByTimeAsync(KINGDOM_REFRESH_MS); expect(revoke).toHaveBeenCalledWith('blob:first');
    expect(adapter.get().picture).toMatchObject({ provenance: { origin: 'sketch' } });
    adapter.dispose(); expect(revoke).toHaveBeenCalledWith('blob:second');
  });

  it('stops polling, aborts pending requests and cancels a queued share gesture when hidden', async () => {
    const helper = standIn({ ...AUTHORIZED, shared: false }); const { adapter, server } = mount(helper); await settle(); adapter.requestLight('named');
    helper.visible(false); const count = server.send.mock.calls.length;
    helper.authorize('shared-token'); await vi.advanceTimersByTimeAsync(READING_REFRESH_MS * 2);
    expect(server.send).toHaveBeenCalledTimes(count); expect(adapter.get().light.kind).not.toBe('pending');
    helper.visible(true); await settle(); expect(calls(server, '/light')).toHaveLength(0);
    expect(server.send.mock.calls.length).toBeGreaterThan(count);
    adapter.dispose(); const stopped = server.send.mock.calls.length; await vi.advanceTimersByTimeAsync(READING_REFRESH_MS * 2); expect(server.send).toHaveBeenCalledTimes(stopped);
  });

  it('discards a claim answer arriving after the panel was hidden even if fetch ignores abort', async () => {
    let resolve: ((response: Response) => void) | undefined;
    let signal: AbortSignal | null | undefined;
    const helper = standIn(), server = backend();
    const send: typeof fetch = (input, init) => String(input).endsWith('/light') ? new Promise(done => { resolve = done; signal = init?.signal; }) : server.send(input, init);
    const adapter = track(createProductionAdapter(helper.bridge, { backend: BACKEND, fetch: send })); await settle(); adapter.requestLight('named');
    helper.visible(false); expect(signal?.aborted).toBe(true); resolve?.(new Response(JSON.stringify({ status: 'deed', lit: true }))); await settle();
    expect(adapter.get().light.kind).not.toBe('lit');
  });

  it('also respects document visibility when Twitch still reports visible', async () => {
    const page = Object.assign(new EventTarget(), { hidden: false }); vi.stubGlobal('document', page);
    const { server } = mount(); await settle();
    page.hidden = true; page.dispatchEvent(new Event('visibilitychange')); const count = server.send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(READING_REFRESH_MS * 2); expect(server.send).toHaveBeenCalledTimes(count);
    page.hidden = false; page.dispatchEvent(new Event('visibilitychange')); await settle(); expect(server.send.mock.calls.length).toBeGreaterThan(count);
  });

  it('gates initial presence on live, playing, visible and shared, and waits for server confirmation', async () => {
    const helper = standIn(); helper.playing(false); const { server, adapter } = mount(helper); await settle(); expect(calls(server, '/presence')).toHaveLength(0);
    helper.playing(true); await settle(); expect(calls(server, '/presence')).toHaveLength(1); expect(adapter.get().light.kind).not.toBe('lit');
    helper.playing(false); helper.visible(false); helper.playing(true); await settle(); expect(calls(server, '/presence')).toHaveLength(1);
    helper.visible(true); await settle(); expect(calls(server, '/presence')).toHaveLength(2);
    helper.viewer({ ...AUTHORIZED, shared: false }); await settle(); expect(adapter.get().home.kind).toBe('unknown');
    adapter.requestLight('named'); expect(calls(server, '/light')).toHaveLength(0);
  });

  it('allows resting claims but never sends presence offline or any claim for logged-out viewers', async () => {
    for (const loggedIn of [false, true]) {
      const helper = standIn({ ...AUTHORIZED, loggedIn }), server = backend(); server.kingdom({ ...KINGDOM_STATE, stream: 'resting' }); server.light({ status: 'deed', lit: false }); helper.playing(false);
      const { adapter } = mount(helper, server); await settle(); adapter.requestLight('named'); await settle();
      expect(calls(server, '/light')).toHaveLength(loggedIn ? 1 : 0); expect(calls(server, '/presence')).toHaveLength(0);
      if (loggedIn) expect(calls(server, '/light')[0]?.[1]?.body).toBe('{"observe":false}');
      expect(adapter.get().light.kind).toBe(loggedIn ? 'resting' : 'logged-out');
    }
  });

  it('does not observe or allocate a shared newcomer until their gesture', async () => {
    const server = backend(); server.reading({ ...READING, viewer: { kind: 'newcomer', card: { ...CARD, home: null } } });
    const { adapter } = mount(standIn(), server); await settle();
    await vi.advanceTimersByTimeAsync(KINGDOM_REFRESH_MS * 2);
    expect(calls(server, '/presence')).toHaveLength(0); expect(calls(server, '/light')).toHaveLength(0);
    adapter.requestLight('named'); await settle(); expect(calls(server, '/light')).toHaveLength(1);
  });
  it('renews each minute, and stops and restarts at every presence gate', async () => {
    const helper = standIn(), server = backend(); const { adapter } = mount(helper, server); await settle();
    expect(calls(server, '/presence')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000); expect(calls(server, '/presence')).toHaveLength(2);
    helper.playing(false); await vi.advanceTimersByTimeAsync(65_000); expect(calls(server, '/presence')).toHaveLength(2);
    helper.playing(true); await settle(); expect(calls(server, '/presence')).toHaveLength(3);
    helper.visible(false); await vi.advanceTimersByTimeAsync(65_000); expect(calls(server, '/presence')).toHaveLength(3);
    helper.visible(true); await settle(); expect(calls(server, '/presence')).toHaveLength(4);
    server.kingdom({ ...KINGDOM_STATE, stream: 'resting' }); await vi.advanceTimersByTimeAsync(KINGDOM_REFRESH_MS);
    await vi.advanceTimersByTimeAsync(65_000); expect(calls(server, '/presence')).toHaveLength(4);
    server.kingdom(KINGDOM_STATE); await vi.advanceTimersByTimeAsync(KINGDOM_REFRESH_MS); expect(calls(server, '/presence')).toHaveLength(5);
    helper.viewer({ ...AUTHORIZED, shared: false }); await vi.advanceTimersByTimeAsync(65_000); expect(calls(server, '/presence')).toHaveLength(5);
    adapter.dispose(); await vi.advanceTimersByTimeAsync(65_000); expect(calls(server, '/presence')).toHaveLength(5);
  });

  it('handles the future forget-success protocol without reading or observing until a new gesture', async () => {
    const { server, adapter } = mount(); await settle();
    expect(adapter.get().privacy).toEqual({ kind: 'ready', quiet: false, projection: 'pending', forgetAvailable: true });
    adapter.requestQuiet?.(true); expect(adapter.get().privacy).toEqual({ kind: 'pending', quiet: false, projection: 'pending', forgetAvailable: true }); await settle();
    expect(adapter.get().privacy).toEqual({ kind: 'ready', quiet: true, projection: 'pending', forgetAvailable: true }); expect(adapter.get().home.kind).toBe('citizen');
    adapter.requestForget?.(); await settle();
    expect(adapter.get().privacy).toEqual({ kind: 'forgotten', erased: ['home', 'presence'] }); expect(adapter.get().home.kind).toBe('unknown');
    const reads = calls(server, '/reading').length, presence = calls(server, '/presence').length;
    await vi.advanceTimersByTimeAsync(120_000); expect(calls(server, '/reading')).toHaveLength(reads); expect(calls(server, '/presence')).toHaveLength(presence);
    adapter.requestLight('named'); await settle(); expect(calls(server, '/light')).toHaveLength(1); expect(calls(server, '/reading').length).toBeGreaterThan(reads);
  });

  it('does not claim a privacy change while its response is pending or rejected', async () => {
    const helper = standIn(), server = backend(); let reject: ((reason: Error) => void) | undefined;
    const send: typeof fetch = (input, init) => String(input).endsWith('/quiet') ? new Promise((_resolve, fail) => { reject = fail; }) : server.send(input, init);
    const adapter = track(createProductionAdapter(helper.bridge, { backend: BACKEND, fetch: send })); await settle();
    adapter.requestQuiet?.(true); expect(adapter.get().privacy).toEqual({ kind: 'pending', quiet: false, projection: 'pending', forgetAvailable: true });
    reject?.(new Error('unavailable')); await settle(); expect(adapter.get().privacy).toEqual({ kind: 'unavailable' });
    adapter.requestPrivacy?.(); await settle(); expect(adapter.get().privacy).toEqual({ kind: 'ready', quiet: false, projection: 'pending', forgetAvailable: true });
  });

  it('backs off repeated presence failures and leaves no timers after disposal', async () => {
    const helper = standIn(), server = backend(); let attempts = 0;
    const send: typeof fetch = (input, init) => {
      if (String(input).endsWith('/presence')) { attempts++; return Promise.reject(new Error('unavailable')); }
      return server.send(input, init);
    };
    const adapter = track(createProductionAdapter(helper.bridge, { backend: BACKEND, fetch: send })); await settle();
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(29_999); expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1); expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(59_999); expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(1); expect(attempts).toBe(3);
    adapter.dispose(); const timers = vi.getTimerCount();
    await vi.advanceTimersByTimeAsync(180_000); expect(attempts).toBe(3); expect(timers).toBe(0);
  });

  it('does not send forget when erasure is unavailable', async () => {
    const helper = standIn(), server = backend();
    const send: typeof fetch = (input, init) => String(input).endsWith('/privacy')
      ? Promise.resolve(new Response(JSON.stringify({ version: 1, status: 'privacy', quiet: false, projection: 'pending', forgetAvailable: false })))
      : server.send(input, init);
    const adapter = track(createProductionAdapter(helper.bridge, { backend: BACKEND, fetch: send })); await settle();
    adapter.requestForget?.(); await settle(); expect(calls(server, '/forget')).toHaveLength(0);
    expect(adapter.get().home.kind).toBe('citizen');
  });

  it('clears privacy on a shared identity change and ignores the previous identity’s late answer', async () => {
    const helper = standIn(), server = backend(); let resolveOld: ((response: Response) => void) | undefined, oldReads = 0;
    const send: typeof fetch = (input, init) => {
      if (!String(input).endsWith('/privacy')) return server.send(input, init);
      const headers = init?.headers as Record<string, string>;
      if (headers.authorization === 'Bearer token-1') {
        if (++oldReads === 1) return Promise.resolve(new Response(JSON.stringify({ version: 1, status: 'privacy', quiet: true, projection: 'applied', forgetAvailable: true })));
        return new Promise(resolve => { resolveOld = resolve; });
      }
      return Promise.resolve(new Response(JSON.stringify({ version: 1, status: 'privacy', quiet: false, projection: 'pending', forgetAvailable: false })));
    };
    const adapter = track(createProductionAdapter(helper.bridge, { backend: BACKEND, fetch: send })); await settle();
    expect(adapter.get().privacy).toEqual({ kind: 'ready', quiet: true, projection: 'applied', forgetAvailable: true });
    adapter.requestPrivacy?.(); await settle();
    helper.authorize('token-2'); expect(adapter.get().privacy?.kind).toBe('loading'); await settle();
    expect(adapter.get().privacy).toEqual({ kind: 'ready', quiet: false, projection: 'pending', forgetAvailable: false });
    resolveOld?.(new Response(JSON.stringify({ version: 1, status: 'privacy', quiet: true, projection: 'applied', forgetAvailable: true }))); await settle();
    expect(adapter.get().privacy).toEqual({ kind: 'ready', quiet: false, projection: 'pending', forgetAvailable: false });
  });

});
