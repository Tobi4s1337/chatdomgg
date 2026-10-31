// The one behavior the panel must never get wrong: a window is lit only by an authority.
// The real panel, whatever Twitch says about the viewer or the channel's Bits, cannot
// confirm a light, send a world command or offer the shelf. The SIMULATED fixture can show
// the whole named and unnamed journey and tonight's crowd acts, its shelf can only ever be
// closed without Bits, and every picture of it keeps saying where it came from.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bridgeHelper, type HelperAuthorized, type HelperExt } from '../helper';
import type { PanelSnapshot } from '../model';
import { createFixtureAdapter, FIXTURE_ACT_MS, FIXTURE_BITS_MS, FIXTURE_CONFIRM_MS, FIXTURE_SHARE_MS, type FixtureAdapter } from './fixture';
import { openSimulationWire } from './simulation';
import { createProductionAdapter } from './production';
import { selectAdapter } from './select';

/** A Twitch Helper double: a logged-in viewer, with sharing and token refresh under the test's control. */
function fakeHelper() {
  let authorized: ((auth: HelperAuthorized) => void) | undefined, changed: (() => void) | undefined;
  const viewer = { isLinked: false, role: 'viewer', onChanged(callback: () => void) { changed = callback; } };
  const requestIdShare = vi.fn(), useBits = vi.fn();
  // Twitch says Bits work on this channel; any use of them is recorded.
  const ext: HelperExt & { bits: { useBits: typeof useBits } } = {
    onAuthorized(callback) { authorized = callback; }, onContext() {}, viewer, actions: { requestIdShare },
    features: { isBitsEnabled: true, onChanged() {} }, bits: { useBits },
  };
  return {
    ext, requestIdShare, useBits,
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
    // A crowd act or a shelf product asked for anyway: no service could count it or deliver it.
    adapter.requestAct('1');
    adapter.requestProduct('feast');
    vi.advanceTimersByTime(60_000);

    for (const snapshot of seen) {
      expect(['lit', 'pending']).not.toContain(snapshot.light.kind);
      expect(snapshot.act).toBeNull();
      expect(snapshot.shelf).toEqual({ kind: 'hidden' });
      expect(snapshot.entry.kind).toBe('none');
      expect(snapshot.source.kind).toBe('production');
      expect(snapshot.home.kind).toBe('unknown');
      expect(JSON.stringify(snapshot)).not.toMatch(/token|U1234567/);
    }
    // Asking Twitch to share is pointless while no kingdom could answer, so the panel does not ask.
    expect(helper.requestIdShare).not.toHaveBeenCalled();
    expect(helper.useBits).not.toHaveBeenCalled();
    nothingSent();

    // A real source asked for by the page never falls back to the fixture, whatever `state=` says.
    const requested = selectAdapter('?state=named&anchor=panel');
    expect(requested.get().source.kind).toBe('production');
    expect(requested.get().light.kind).not.toBe('lit');
    requested.dispose();
    adapter.dispose();
  });

  it('demonstrates the named and unnamed light, tonight\'s acts and the streamer\'s Hide only under SIMULATED, without sending anything', async () => {
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

    // One person, one vote: the vote waits for a light, counts once, and the shelf only ever closes without Bits.
    const night = createFixtureAdapter('act-unshared');
    const seen: PanelSnapshot[] = [night.get()];
    night.subscribe(snapshot => seen.push(snapshot));
    night.requestAct('1');
    expect(night.get().act?.status).toMatchObject({ kind: 'unavailable', way: 'light' });
    night.requestLight('unnamed');
    vi.advanceTimersByTime(FIXTURE_SHARE_MS + FIXTURE_CONFIRM_MS);
    expect(night.get().act?.status).toEqual({ kind: 'open' });
    night.requestAct('1');
    expect(night.get().act?.status).toEqual({ kind: 'pending', option: '1' });
    vi.advanceTimersByTime(FIXTURE_ACT_MS);
    expect(night.get().act?.status).toEqual({ kind: 'accepted', option: '1', restMs: null });
    night.requestAct('2');
    vi.advanceTimersByTime(60_000);
    expect(night.get().act?.status).toEqual({ kind: 'accepted', option: '1', restMs: null });

    night.requestProduct('feast');
    expect(night.get().shelf).toMatchObject({ kind: 'offered', request: { kind: 'confirming', sku: 'feast' } });
    vi.advanceTimersByTime(FIXTURE_BITS_MS);
    expect(night.get().shelf).toMatchObject({ kind: 'offered', request: { kind: 'cancelled', sku: 'feast' } });
    for (const snapshot of seen) {
      expect(snapshot.source).toMatchObject({ kind: 'simulated', label: 'SIMULATED' });
      if (snapshot.shelf.kind === 'offered') expect(['idle', 'confirming', 'cancelled']).toContain(snapshot.shelf.request.kind);
    }
    // The streamer's choices act on the fixture alone: no crowd-acts section means no act, no chosen product no shelf.
    night.configure({ sections: { night: true, home: true, acts: false, shelf: true } });
    expect(night.get().act).toBeNull();
    night.configure({ sections: { night: true, home: true, acts: true, shelf: true }, products: [] });
    expect(night.get().act).not.toBeNull();
    expect(night.get().shelf).toEqual({ kind: 'hidden' });
    night.dispose();

    // Simulated Hide from the live dashboard reaches every simulated panel beside it, and one opened later asks and
    // is told. The real panel never listens: nothing simulated can hide, or show, anything in it.
    let hidden = false;
    const host = openSimulationWire(message => { if (message.kind === 'ask') host?.post({ kind: 'hide', hidden }); });
    if (!host) throw new Error('BroadcastChannel is missing');
    const changed = (adapter: FixtureAdapter, done: (snapshot: PanelSnapshot) => boolean) => new Promise<void>(resolve => {
      const off = adapter.subscribe(snapshot => { if (done(snapshot)) { off(); resolve(); } });
    });
    const open = [createFixtureAdapter('vote'), createFixtureAdapter('errand')];
    const production = createProductionAdapter(bridgeHelper(fakeHelper().ext));
    const productionSeen = vi.fn();
    production.subscribe(productionSeen);
    for (const adapter of open) expect(adapter.get().act).not.toBeNull();
    hidden = true;
    host.post({ kind: 'hide', hidden: true });
    await Promise.all(open.map(adapter => changed(adapter, snapshot => snapshot.act === null)));
    for (const adapter of open) {
      expect(adapter.get().shelf).toEqual({ kind: 'hidden' });
      adapter.requestAct('haul');
      expect(adapter.get().act).toBeNull();
    }
    const later = createFixtureAdapter('dragon');
    await changed(later, snapshot => snapshot.act === null);
    host.post({ kind: 'hide', hidden: false });
    await changed(open[1]!, snapshot => snapshot.act !== null);
    expect(open[1]!.get().act?.status).toEqual({ kind: 'open' });
    expect(productionSeen).not.toHaveBeenCalled();
    expect(production.get().act).toBeNull();
    for (const adapter of [...open, later, production]) adapter.dispose();
    host.close();
    nothingSent();
  });
});
