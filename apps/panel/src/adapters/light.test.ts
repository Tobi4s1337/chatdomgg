// The one behavior the panel must never get wrong: a window is lit only by an authority.
// The real panel, whatever Twitch says about the viewer, cannot confirm a light or send a
// world command. The SIMULATED fixture can show the whole named and unnamed journey, and
// every picture of it keeps saying where it came from.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bridgeHelper, type HelperAuthorized, type HelperExt } from '../helper';
import type { PanelSnapshot } from '../model';
import { createFixtureAdapter, FIXTURE_CONFIRM_MS, FIXTURE_SHARE_MS } from './fixture';
import { createProductionAdapter } from './production';
import { selectAdapter } from './select';

/** A Twitch Helper double: a logged-in viewer, with sharing and token refresh under the test's control. */
function fakeHelper() {
  let authorized: ((auth: HelperAuthorized) => void) | undefined, changed: (() => void) | undefined;
  const viewer = { isLinked: false, role: 'viewer', onChanged(callback: () => void) { changed = callback; } };
  const requestIdShare = vi.fn();
  const ext: HelperExt = { onAuthorized(callback) { authorized = callback; }, onContext() {}, viewer, actions: { requestIdShare } };
  return {
    ext, requestIdShare,
    authorize(token: string, userId = 'U1234567') { authorized?.({ channelId: '1', clientId: 'test', token, helixToken: `${token}-helix`, userId }); },
    share() { viewer.isLinked = true; changed?.(); },
  };
}

describe('lighting a window from the panel', () => {
  const sent = { fetch: vi.fn(), beacon: vi.fn(), socket: vi.fn(), events: vi.fn(), xhr: vi.fn() };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', sent.fetch);
    vi.stubGlobal('navigator', { sendBeacon: sent.beacon });
    vi.stubGlobal('WebSocket', sent.socket);
    vi.stubGlobal('EventSource', sent.events);
    vi.stubGlobal('XMLHttpRequest', sent.xhr);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
  const nothingSent = () => { for (const spy of Object.values(sent)) expect(spy).not.toHaveBeenCalled(); };

  it('never confirms or dispatches in production, even after Twitch shares identity and refreshes the token', () => {
    const helper = fakeHelper();
    const bridge = bridgeHelper(helper.ext);
    const adapter = createProductionAdapter(bridge);
    const seen: PanelSnapshot[] = [adapter.get()];
    adapter.subscribe(snapshot => seen.push(snapshot));

    helper.authorize('first-token');
    expect(adapter.get().light).toEqual({ kind: 'unavailable', twitch: 'unshared' });
    adapter.requestLight('named');
    adapter.requestLight('unnamed');
    vi.advanceTimersByTime(60_000);

    // Twitch says the viewer shared their identity, then refreshes the token: still only display evidence.
    helper.share();
    helper.authorize('refreshed-token');
    expect(bridge.token()).toBe('refreshed-token');
    expect(adapter.get().light).toEqual({ kind: 'unavailable', twitch: 'shared' });
    adapter.requestLight('named');
    vi.advanceTimersByTime(60_000);

    for (const snapshot of seen) {
      expect(['lit', 'pending']).not.toContain(snapshot.light.kind);
      expect(snapshot.source.kind).toBe('production');
      expect(snapshot.home.kind).toBe('unknown');
      expect(JSON.stringify(snapshot)).not.toMatch(/token|U1234567/);
    }
    // Asking Twitch to share is pointless while no kingdom could answer, so the panel does not ask.
    expect(helper.requestIdShare).not.toHaveBeenCalled();
    nothingSent();

    // A real source asked for by the page never falls back to the fixture, whatever `state=` says.
    const requested = selectAdapter('?state=named&anchor=panel');
    expect(requested.get().source.kind).toBe('production');
    expect(requested.get().light.kind).not.toBe('lit');
    requested.dispose();
    adapter.dispose();
  });

  it('demonstrates the named and unnamed light only under SIMULATED, without sending anything', () => {
    for (const choice of ['named', 'unnamed'] as const) {
      const adapter = createFixtureAdapter('unshared');
      const seen: PanelSnapshot[] = [adapter.get()];
      adapter.subscribe(snapshot => seen.push(snapshot));
      // Before Twitch shares who the viewer is, the fixture does not know their home either.
      expect(adapter.get().home.kind).toBe('unknown');

      adapter.requestLight(choice);
      expect(adapter.get().light).toEqual({ kind: 'pending', choice, step: 'sharing' });
      vi.advanceTimersByTime(FIXTURE_SHARE_MS);
      expect(adapter.get().light).toEqual({ kind: 'pending', choice, step: 'confirming' });
      vi.advanceTimersByTime(FIXTURE_CONFIRM_MS);
      expect(adapter.get().light).toEqual({ kind: 'lit', choice, as: 'citizen', by: 'simulation' });

      const home = adapter.get().home;
      if (home.kind !== 'citizen') throw new Error(`expected a citizen's home, got ${home.kind}`);
      expect(home.displayName).toBe(choice === 'named' ? 'Wrenfeather' : null);
      // A second request while lit changes nothing.
      adapter.requestLight(choice === 'named' ? 'unnamed' : 'named');
      expect(adapter.get().light).toMatchObject({ kind: 'lit', choice });

      for (const snapshot of seen) {
        expect(snapshot.source).toMatchObject({ kind: 'simulated', label: 'SIMULATED' });
        expect(snapshot.connection.kind).toBe('fixture');
        if (snapshot.picture.kind === 'still') expect(snapshot.picture.provenance.origin).toBe('simulated');
      }
      adapter.dispose();
    }
    nothingSent();
  });
});
