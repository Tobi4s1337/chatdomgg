// The real panel reads one thing: this channel's kingdom and the viewer's own card, from the Extension backend,
// signed with the token Twitch's Helper gave this view. These tests stand in for the Helper and the backend.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelReading } from '../../../api/src/public/panel/contracts';
import type { HelperBridge, HelperStatus } from '../helper';
import type { PanelAdapter, PanelSnapshot } from '../model';
import { createProductionAdapter, HELPER_PATIENCE_MS, READING_REFRESH_MS } from './production';

const BACKEND = 'https://chatdom.io';
const READING_URL = `${BACKEND}/api/panel/v1/reading`;
const AUTHORIZED: HelperStatus = { kind: 'authorized', loggedIn: true, shared: true, role: 'viewer', bits: false };

/** A Helper bridge under the test's control: Twitch's status and token change only when the test says so. */
function standIn(status: HelperStatus = AUTHORIZED, token: string | null = 'token-1') {
  const listeners = new Set<(status: HelperStatus) => void>();
  const requestIdShare = vi.fn(() => true);
  const bridge: HelperBridge = {
    status: () => status,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    token: () => token,
    requestIdShare,
  };
  return {
    bridge, requestIdShare,
    /** Twitch calls `onAuthorized` again: a new token, and possibly new viewer facts. */
    authorize(next: string, nextStatus: HelperStatus = AUTHORIZED) { token = next; status = nextStatus; for (const listener of listeners) listener(status); },
  };
}

const KINGDOM = { name: 'Lanternmere', tier: 'hamlet', motto: 'One home lit by chat, of 12', walk: 'https://chatdom.io/?walk=1&kingdom=1001' } as const;
const CARD = {
  name: 'Wren', colour: '#8a2be2', standing: 'Citizen of Lanternmere', following: null, subscribed: null,
  home: { name: 'Number 5', tier: 'cottage' }, elsewhere: [{ kingdom: 'Millbrook', home: 'Number 2, Mill Lane' }],
} as const;
const HOME = { street: 'Lantern Row', place: 'Number 5 on Lantern Row', description: 'A cottage of warm timber.', since: '1 Nov 2026' };
const reading = (viewer: PanelReading['viewer'], kingdom: PanelReading['kingdom'] = KINGDOM): PanelReading => ({ version: 1, kingdom, viewer });

type Answer = PanelReading | { status: number } | 'unreadable' | 'offline';
/** A backend that answers each reading request with the next queued answer (the last one repeats). */
function backend(...answers: Answer[]) {
  const send = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
    const answer = answers.length > 1 ? answers.shift()! : answers[0]!;
    if (answer === 'offline') throw new TypeError('fetch failed');
    if (answer === 'unreadable') return { ok: true, status: 200, text: async () => '{"version":1,"kingdom":null}' } as Response;
    if ('status' in answer) return { ok: false, status: answer.status, text: async () => '' } as Response;
    return { ok: true, status: 200, text: async () => JSON.stringify(answer) } as Response;
  });
  return { send, fetch: send as unknown as typeof fetch };
}

/** Lets the in-flight reading finish: the fetch, its body and the snapshot that follows. */
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

const open: PanelAdapter[] = [];
const track = (adapter: PanelAdapter) => { open.push(adapter); return adapter; };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  for (const adapter of open.splice(0)) adapter.dispose();
  vi.useRealTimers();
});

describe('the production panel adapter', () => {
  it('sends nothing at all when it was built without a backend', async () => {
    const helper = standIn();
    const server = backend(reading({ kind: 'anonymous' }));
    const adapter = track(createProductionAdapter(helper.bridge, { fetch: server.fetch }));
    helper.authorize('token-2');
    await vi.advanceTimersByTimeAsync(READING_REFRESH_MS * 2);
    expect(server.send).not.toHaveBeenCalled();
    expect(adapter.get().connection).toEqual({ kind: 'kingdom-unavailable' });
    expect(adapter.get().kingdom).toBeNull();
    expect(adapter.get().entry).toEqual({ kind: 'none' });
    expect(adapter.get().home.kind).toBe('unknown');
  });

  it('asks the backend for the reading with the Helper\'s token and no cookies', async () => {
    const server = backend(reading({ kind: 'anonymous' }));
    track(createProductionAdapter(standIn().bridge, { backend: BACKEND, fetch: server.fetch }));
    await settle();
    expect(server.send).toHaveBeenCalledTimes(1);
    const [url, init] = server.send.mock.calls[0]!;
    expect(url).toBe(READING_URL);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', mode: 'cors', cache: 'no-store', body: '{}' });
    expect(init?.headers).toMatchObject({ authorization: 'Bearer token-1', 'content-type': 'application/json' });
  });

  it('waits for Twitch\'s token before asking anything', async () => {
    const helper = standIn({ kind: 'waiting' }, null);
    const server = backend(reading({ kind: 'anonymous' }));
    const adapter = track(createProductionAdapter(helper.bridge, { backend: BACKEND, fetch: server.fetch }));
    expect(adapter.get().connection).toEqual({ kind: 'knocking' });
    await vi.advanceTimersByTimeAsync(HELPER_PATIENCE_MS);
    expect(adapter.get().connection).toEqual({ kind: 'no-answer' });
    expect(server.send).not.toHaveBeenCalled();
    helper.authorize('token-1');
    await settle();
    expect(server.send).toHaveBeenCalledTimes(1);
    expect(adapter.get().connection).toEqual({ kind: 'connected' });
  });

  it('shows a citizen their kingdom, their home and the way in', async () => {
    const server = backend(reading({ kind: 'citizen', card: CARD, home: HOME }));
    const adapter = track(createProductionAdapter(standIn().bridge, { backend: BACKEND, fetch: server.fetch }));
    const seen: PanelSnapshot[] = [];
    adapter.subscribe(snapshot => seen.push(snapshot));
    await settle();
    const snapshot = adapter.get();
    expect(seen.at(-1)).toBe(snapshot);
    expect(snapshot.source).toEqual({ kind: 'production', label: null });
    expect(snapshot.connection).toEqual({ kind: 'connected' });
    expect(snapshot.kingdom).toEqual({ name: 'Lanternmere', tier: 'hamlet', motto: 'One home lit by chat, of 12' });
    expect(snapshot.entry).toEqual({ kind: 'gate', path: KINGDOM.walk });
    expect(snapshot.home).toMatchObject({
      kind: 'citizen', street: 'Lantern Row', place: 'Number 5 on Lantern Row', description: 'A cottage of warm timber.', displayName: 'Wren',
      tenure: { kind: 'known', since: '1 Nov 2026' }, history: [],
      card: { ...CARD, portrait: null, worn: [] },
      passport: { kind: 'readable', simulated: false },
    });
    // Only a kingdom service could light a window, and none answers the panel yet.
    expect(snapshot.light.kind).not.toBe('lit');
    expect(JSON.stringify(snapshot)).not.toContain('token-1');
  });

  it('maps each kind of viewer to the home the panel shows', async () => {
    const cases: [PanelReading['viewer'], Partial<Record<string, unknown>>][] = [
      [{ kind: 'guest', card: { ...CARD, standing: 'Guest of Lanternmere', home: null } }, { kind: 'guest', displayName: 'Wren' }],
      [{ kind: 'newcomer', card: { ...CARD, standing: 'Welcome to Lanternmere', home: null } }, { kind: 'known', note: expect.stringContaining('No home in Lanternmere yet') }],
      [{ kind: 'monarch', card: { ...CARD, standing: 'Monarch of Lanternmere', home: { name: 'The castle', tier: null } } }, { kind: 'known', note: expect.stringContaining('Lanternmere is yours') }],
      [{ kind: 'unshared' }, { kind: 'unknown', ask: 'share', reason: expect.stringContaining('Share who you are') }],
      [{ kind: 'anonymous' }, { kind: 'unknown', reason: 'Log in to Twitch to see your citizen card.' }],
      [{ kind: 'unknown', reason: 'Twitch has not told us your name just now.' }, { kind: 'unknown', reason: 'Twitch has not told us your name just now.' }],
    ];
    for (const [viewer, home] of cases) {
      const server = backend(reading(viewer));
      const adapter = track(createProductionAdapter(standIn().bridge, { backend: BACKEND, fetch: server.fetch }));
      await settle();
      expect(adapter.get().connection, viewer.kind).toEqual({ kind: 'connected' });
      expect(adapter.get().home, viewer.kind).toMatchObject(home);
      if (viewer.kind === 'anonymous') expect(adapter.get().home).not.toHaveProperty('ask');
    }
  });

  it('keeps the gate closed when the channel has no kingdom yet', async () => {
    const server = backend(reading({ kind: 'unknown', reason: 'This channel has no kingdom yet.' }, null));
    const adapter = track(createProductionAdapter(standIn().bridge, { backend: BACKEND, fetch: server.fetch }));
    await settle();
    expect(adapter.get().kingdom).toBeNull();
    expect(adapter.get().entry).toEqual({ kind: 'none' });
  });

  it('refreshes the reading while open, and says the kingdom was lost after a failure that follows a success', async () => {
    const server = backend(reading({ kind: 'citizen', card: CARD, home: HOME }), 'offline');
    const adapter = track(createProductionAdapter(standIn().bridge, { backend: BACKEND, fetch: server.fetch }));
    await settle();
    expect(adapter.get().connection).toEqual({ kind: 'connected' });

    await vi.advanceTimersByTimeAsync(READING_REFRESH_MS - 1);
    expect(server.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.send).toHaveBeenCalledTimes(2);
    const lost = adapter.get();
    expect(lost.connection).toMatchObject({ kind: 'lost', asOf: expect.any(String) });
    // What was last read stays on screen, and says how old it is.
    expect(lost.kingdom?.name).toBe('Lanternmere');
    expect(lost.home.kind).toBe('citizen');
  });

  it('retries a failed reading after 15 seconds, then backs off, and recovers', async () => {
    const server = backend({ status: 503 }, 'unreadable', 'offline', reading({ kind: 'anonymous' }));
    const adapter = track(createProductionAdapter(standIn().bridge, { backend: BACKEND, fetch: server.fetch }));
    await settle();
    // Never read anything yet: nothing to call lost.
    expect(adapter.get().connection).toEqual({ kind: 'kingdom-unavailable' });
    expect(adapter.get().home).toMatchObject({ kind: 'unknown', reason: expect.stringContaining('not answering the panel') });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(server.send).toHaveBeenCalledTimes(2);
    expect(adapter.get().connection).toEqual({ kind: 'kingdom-unavailable' });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(server.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.send).toHaveBeenCalledTimes(4);
    expect(adapter.get().connection).toEqual({ kind: 'connected' });
  });

  it('reads again at once when Twitch refreshes the token, and not for the same token twice', async () => {
    const helper = standIn();
    const server = backend(reading({ kind: 'unshared' }), reading({ kind: 'citizen', card: CARD, home: HOME }));
    const adapter = track(createProductionAdapter(helper.bridge, { backend: BACKEND, fetch: server.fetch }));
    await settle();
    helper.authorize('token-1');
    await settle();
    expect(server.send).toHaveBeenCalledTimes(1);
    helper.authorize('token-2');
    await settle();
    expect(server.send).toHaveBeenCalledTimes(2);
    expect(server.send.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: 'Bearer token-2' });
    expect(adapter.get().home.kind).toBe('citizen');
  });

  it('asks Twitch to share the viewer\'s identity only when that is all that stands between them and their card', async () => {
    const unshared = standIn();
    const first = track(createProductionAdapter(unshared.bridge, { backend: BACKEND, fetch: backend(reading({ kind: 'unshared' })).fetch }));
    first.requestIdentity?.();
    expect(unshared.requestIdShare).not.toHaveBeenCalled();
    await settle();
    first.requestIdentity?.();
    expect(unshared.requestIdShare).toHaveBeenCalledTimes(1);

    for (const viewer of [{ kind: 'anonymous' }, { kind: 'citizen', card: CARD, home: HOME }] as PanelReading['viewer'][]) {
      const helper = standIn();
      const adapter = track(createProductionAdapter(helper.bridge, { backend: BACKEND, fetch: backend(reading(viewer)).fetch }));
      await settle();
      adapter.requestIdentity?.();
      expect(helper.requestIdShare, viewer.kind).not.toHaveBeenCalled();
    }
  });

  it('stops reading and stops telling anyone once disposed', async () => {
    const helper = standIn();
    const server = backend(reading({ kind: 'anonymous' }));
    const adapter = createProductionAdapter(helper.bridge, { backend: BACKEND, fetch: server.fetch });
    const listener = vi.fn();
    adapter.subscribe(listener);
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    adapter.dispose();
    helper.authorize('token-2');
    await vi.advanceTimersByTimeAsync(READING_REFRESH_MS * 3);
    expect(server.send).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
