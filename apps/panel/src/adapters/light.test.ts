import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeHelper, type HelperAuthorized, type HelperExt } from '../helper';
import { createProductionAdapter } from './production';
import { selectAdapter } from './select';

function fakeHelper() {
  let authorized: ((auth: HelperAuthorized) => void) | undefined;
  let changed: (() => void) | undefined;
  let context: Parameters<HelperExt['onContext']>[0] | undefined;
  let visibility: ((visible: boolean) => void) | undefined;
  const viewer = { isLinked: false, role: 'viewer', onChanged(callback: () => void) { changed = callback; } };
  const requestIdShare = vi.fn();
  const ext: HelperExt = {
    onAuthorized(callback) { authorized = callback; }, onContext(callback) { context = callback; }, onVisibilityChanged(callback) { visibility = callback; },
    viewer, actions: { requestIdShare }, features: { isBitsEnabled: true },
  };
  return {
    ext, requestIdShare,
    authorize(token: string, userId = 'U1234567') { authorized?.({ channelId: '1', clientId: 'test', token, helixToken: 'unused', userId }); },
    share(value: boolean) { viewer.isLinked = value; changed?.(); },
    paused(value: boolean) { context?.({ isPaused: value }, ['isPaused']); },
    visible(value: boolean) { visibility?.(value); },
  };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('the Twitch Helper is a gate, never the light authority', () => {
  it('keeps tokens only in memory and distinguishes authorization from viewer changes', () => {
    const helper = fakeHelper(), bridge = bridgeHelper(helper.ext), seen = vi.fn(); bridge.subscribe(seen);
    helper.authorize('first-token'); expect(bridge.authorization?.()).toBe(1);
    expect(bridge.status()).toMatchObject({ loggedIn: true, shared: false });
    helper.share(true); expect(bridge.authorization?.()).toBe(1);
    helper.authorize('shared-token'); expect(bridge.authorization?.()).toBe(2); expect(bridge.token()).toBe('shared-token');
    expect(JSON.stringify(seen.mock.calls)).not.toMatch(/first-token|shared-token|U1234567/);
  });

  it('requires actual playing context and visible Helper before activity is true', () => {
    const helper = fakeHelper(), bridge = bridgeHelper(helper.ext), seen = vi.fn(); bridge.subscribe(seen);
    helper.authorize('token'); expect(bridge.active?.()).toBe(false);
    helper.paused(false); expect(bridge.active?.()).toBe(true);
    helper.visible(false); expect(bridge.visible?.()).toBe(false); expect(bridge.active?.()).toBe(false);
    helper.visible(true); expect(bridge.active?.()).toBe(true);
    helper.paused(true); expect(bridge.active?.()).toBe(false); expect(seen).toHaveBeenCalledTimes(5);
  });

  it('does not ask logged-out viewers to share', () => {
    const helper = fakeHelper(), bridge = bridgeHelper(helper.ext);
    helper.authorize('token', 'Aanonymous'); expect(bridge.requestIdShare()).toBe(false); expect(helper.requestIdShare).not.toHaveBeenCalled();
    helper.authorize('token'); expect(bridge.requestIdShare()).toBe(true); expect(helper.requestIdShare).toHaveBeenCalledOnce();
  });

  it('never confirms a light or sends commands without a configured backend', () => {
    const helper = fakeHelper(), bridge = bridgeHelper(helper.ext), send = vi.fn();
    const adapter = createProductionAdapter(bridge, { fetch: send });
    helper.authorize('first'); helper.share(true); helper.paused(false); helper.authorize('shared');
    adapter.requestLight('named'); adapter.requestAct('vote'); adapter.requestProduct('feast');
    expect(adapter.get().light.kind).not.toBe('lit'); expect(adapter.get().act).toBeNull(); expect(adapter.get().shelf.kind).toBe('hidden'); expect(send).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it('ignores every fixture selector on extension entry points', () => {
    vi.stubGlobal('Twitch', undefined);
    for (const query of ['?source=simulated&state=named', '?state=named&anchor=panel', '?source=fixture']) {
      const adapter = selectAdapter(query);
      expect(adapter.get().source.kind).toBe('production'); expect(adapter.get().light.kind).not.toBe('lit'); adapter.dispose();
    }
  });
});
