import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HelperBridge, HelperTransaction } from '../helper';
import { createGiftTransport } from './transport';

// These exercise the proposed wire protocol with a fake API, not production gift effects.
const offer = { sku: 'kitesa', giftId: 'kites', title: 'Kites', what: 'Kites cross the sky.', target: 'none', durationMs: 1000 };
function setup() {
  let complete: ((t: HelperTransaction) => void) | undefined, cancel: (() => void) | undefined;
  let visible = true, live = true, shared = true, bits = true, offered = true, delivered = false, failIntent = false, ambiguous = false, canCancel = false, activeIntent: { intentId: string; sku: string } | null = null;
  const helper: HelperBridge = {
    status: () => ({ kind: 'authorized', loggedIn: true, shared, role: 'viewer', bits }), token: () => 'token', subscribe: () => () => {}, requestIdShare: () => false,
    getProducts: async () => [{ sku: 'kitesa', cost: { amount: '245', type: 'bits' } }, { sku: 'bella', cost: { amount: '100', type: 'bits' } }], useBits: vi.fn(() => true),
    onGiftTransaction: fn => { complete = fn; return () => { complete = undefined; }; }, onGiftCancelled: fn => { cancel = fn; return () => { cancel = undefined; }; },
  };
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url).split('/').pop();
    if (path === 'gift-intent' && failIntent) { failIntent = false; throw new Error('connection'); }
    const body = path === 'gifts' ? { version: 1, status: 'gifts', stream: live ? 'live' : 'resting', offers: offered ? [offer, { ...offer, sku: 'bella', giftId: 'bell', title: 'Bell' }] : [], friends: [], activeIntent } : path === 'gift-intent' ? { version: 1, status: 'intent', intentId: 'intent', sku: JSON.parse(String(init?.body)).sku } : path === 'gift-status' && ambiguous ? { version: 1, status: 'awaiting-target', paymentRef: 'payment', choices: [{ intentId: 'choice', title: 'Kites', targetName: null, createdAt: 1 }] } : path === 'gift-resolve' ? { version: 1, status: 'delivered', fact: { version: 1, type: 'panel.gift', line: 'Kites cross the sky.' } } : path === 'gift-status' && delivered ? { version: 1, status: 'delivered', fact: { version: 1, type: 'panel.gift', line: 'Kites cross the sky.' } } : path === 'gift-cancel' ? { version: 1, status: 'cancelled' } : { version: 1, status: 'pending', canCancel };
    return new Response(JSON.stringify(body));
  });
  const transport = createGiftTransport({ helper, backend: 'https://chatdom.io', fetch: fetcher, visible: () => visible, live: () => live, onChange: () => {} });
  return { transport, helper, fetcher, complete: (t: HelperTransaction) => complete?.(t), cancel: () => cancel?.(), visible: (v: boolean) => { visible = v; }, live: (v: boolean) => { live = v; }, shared: (v: boolean) => { shared = v; }, deliver: () => { delivered = true; }, failIntent: () => { failIntent = true; }, ambiguous: () => { ambiguous = true; }, cancellable: () => { canCancel = true; }, bits: (v: boolean) => { bits = v; }, offered: (v: boolean) => { offered = v; }, active: (v: typeof activeIntent) => { activeIntent = v; } };
}
const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('gift protocol transport', () => {
  it('requires the actual product and intent, then waits for an authoritative delivered fact', async () => {
    const t = setup(); await t.transport.refresh(); expect(t.transport.get()).toMatchObject({ kind: 'open', offers: [expect.objectContaining({ bits: 245 }), expect.anything()] });
    t.transport.requestProduct('kitesa'); await settle(); expect(t.helper.useBits).toHaveBeenCalledWith('kitesa');
    const intentCall = t.fetcher.mock.calls.find(([u]) => String(u).endsWith('gift-intent'));
    expect(JSON.parse(String(intentCall?.[1]?.body))).toMatchObject({ sku: 'kitesa', targetPlotId: null, requestId: expect.any(String) });
    t.complete({ initiator: 'other', product: { sku: 'kitesa' }, transactionReceipt: 'secret' }); expect(t.transport.get()).toMatchObject({ request: { kind: 'confirming' } });
    t.complete({ initiator: 'current_user', product: { sku: 'kitesa' }, transactionReceipt: 'secret' }); await settle();
    expect(t.transport.get()).toMatchObject({ request: { kind: 'pending' } }); expect(JSON.stringify(t.transport.get())).not.toContain('secret');
    t.deliver(); await vi.advanceTimersByTimeAsync(5_000); expect(t.transport.get()).toMatchObject({ request: { kind: 'delivered', line: 'Kites cross the sky.' } });
    t.transport.dispose();
  });
  it('does not purchase when hidden, offline or unshared and stops timers on dispose', async () => {
    const t = setup(); await t.transport.refresh();
    t.visible(false); t.transport.requestProduct('kitesa'); t.live(false); t.visible(true); t.transport.requestProduct('kitesa'); t.live(true); t.shared(false); t.transport.requestProduct('kitesa');
    expect(t.helper.useBits).not.toHaveBeenCalled(); t.transport.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('allows a different gift after the server acknowledges cancellation', async () => {
    const t = setup(); await t.transport.refresh(); t.transport.requestProduct('kitesa'); await settle(); t.cancel(); await settle();
    expect(t.transport.get()).toMatchObject({ request: { kind: 'cancelled' } }); t.transport.resetGift(); await settle();
    expect(t.transport.get()).toMatchObject({ request: { kind: 'idle' } });
    t.transport.requestProduct('bella'); await settle(); expect(t.helper.useBits).toHaveBeenCalledTimes(2); expect(t.helper.useBits).toHaveBeenLastCalledWith('bella'); t.transport.dispose();
  });
  it('refreshes uncertain intent before allowing a different gift after a failed request', async () => {
    const t = setup(); await t.transport.refresh(); t.failIntent(); t.transport.requestProduct('kitesa'); await settle();
    expect(t.transport.get()).toMatchObject({ request: { kind: 'unavailable' } }); t.transport.resetGift(); await settle();
    expect(t.transport.get()).toMatchObject({ request: { kind: 'idle' } }); t.transport.requestProduct('bella'); await settle();
    expect(t.helper.useBits).toHaveBeenCalledWith('bella'); t.transport.dispose();
  });
  it('asks for a fresh gesture to resolve an ambiguous paid gift', async () => {
    const t = setup(); t.active({ intentId: 'intent', sku: 'kitesa' }); t.ambiguous(); await t.transport.refresh(); await settle();
    expect(t.transport.get()).toMatchObject({ request: { kind: 'choosing-paid', paymentRef: 'payment' } });
    await vi.advanceTimersByTimeAsync(60_000); expect(t.fetcher.mock.calls.some(([u]) => String(u).endsWith('gift-resolve'))).toBe(false);
    t.transport.resolveGiftIntent('invalid'); await settle(); expect(t.fetcher.mock.calls.some(([u]) => String(u).endsWith('gift-resolve'))).toBe(false);
    t.transport.resolveGiftIntent('choice'); await settle();
    const resolve = t.fetcher.mock.calls.find(([u]) => String(u).endsWith('gift-resolve'));
    expect(JSON.parse(String(resolve?.[1]?.body))).toEqual({ paymentRef: 'payment', intentId: 'choice' });
    expect(resolve?.[1]?.headers).toMatchObject({ authorization: 'Bearer token' });
    expect(t.transport.get()).toMatchObject({ request: { kind: 'delivered', line: 'Kites cross the sky.' } }); t.transport.dispose();
  });
  it('does not send a receipt for a completion without one, and resumes status after hiding', async () => {
    const t = setup(); await t.transport.refresh(); t.transport.requestProduct('kitesa'); await settle();
    t.complete({ initiator: 'current_user', product: { sku: 'kitesa' } }); await settle();
    expect(t.transport.get()).toMatchObject({ request: { kind: 'pending' } });
    expect(t.fetcher.mock.calls.some(([u]) => String(u).endsWith('gift-receipt'))).toBe(false);
    t.visible(false); t.transport.suspend(); const count = t.fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000); expect(t.fetcher).toHaveBeenCalledTimes(count);
    t.visible(true); t.deliver(); await t.transport.refresh(); await settle();
    expect(t.transport.get()).toMatchObject({ request: { kind: 'delivered' } }); t.transport.dispose();
  });

  it('recovers verified active intent after authorization refresh without reopening Twitch', async () => {
    const t = setup(); await t.transport.refresh(); t.transport.requestProduct('kitesa'); await settle();
    expect(t.helper.useBits).toHaveBeenCalledTimes(1);
    t.active({ intentId: 'intent', sku: 'kitesa' }); t.transport.clearIdentity();
    await t.transport.refresh(); await settle();
    expect(t.transport.get()).toMatchObject({ request: { kind: 'pending', sku: 'kitesa' } });
    expect(t.helper.useBits).toHaveBeenCalledTimes(1);
    expect(t.fetcher.mock.calls.some(([u, init]) => String(u).endsWith('gift-status') && JSON.parse(String(init?.body)).intentId === 'intent')).toBe(true);
    t.transport.dispose();
  });
  it('does not read the prior subject’s intent when the new subject has none', async () => {
    const t = setup(); t.active({ intentId: 'previous', sku: 'kitesa' }); await t.transport.refresh(); await settle();
    t.transport.clearIdentity(); t.active(null); const before = t.fetcher.mock.calls.length;
    await t.transport.refresh(); await settle();
    expect(t.transport.get()).toMatchObject({ request: { kind: 'idle' } });
    expect(t.fetcher.mock.calls.slice(before).some(([u]) => String(u).endsWith('gift-status'))).toBe(false);
    expect(t.helper.useBits).not.toHaveBeenCalled(); t.transport.dispose();
  });
  it('resumes a verified active intent on cold open without a purchase gesture', async () => {
    const t = setup(); t.active({ intentId: 'recovered', sku: 'kitesa' }); await t.transport.refresh(); await settle();
    expect(t.transport.get()).toMatchObject({ request: { kind: 'pending', sku: 'kitesa' } });
    expect(t.fetcher.mock.calls.some(([u, init]) => String(u).endsWith('gift-status') && JSON.parse(String(init?.body)).intentId === 'recovered')).toBe(true);
    expect(t.helper.useBits).not.toHaveBeenCalled(); t.transport.dispose();
  });

  it.each(['resting', 'no offers', 'Bits disabled'])('keeps a pending gift visible and checks status with %s', async (gate) => {
    const t = setup(); t.active({ intentId: 'paid', sku: 'kitesa' });
    if (gate === 'resting') t.live(false);
    if (gate === 'no offers') t.offered(false);
    if (gate === 'Bits disabled') t.bits(false);
    await t.transport.refresh(); await settle();
    expect(t.transport.get()).toMatchObject({ kind: 'open', offers: [], request: { kind: 'pending', sku: 'kitesa' } });
    const calls = t.fetcher.mock.calls.filter(([u]) => String(u).endsWith('gift-status')).length;
    t.transport.requestProduct('kitesa'); expect(t.helper.useBits).not.toHaveBeenCalled();
    t.deliver(); await vi.advanceTimersByTimeAsync(5_000);
    expect(t.fetcher.mock.calls.filter(([u]) => String(u).endsWith('gift-status')).length).toBeGreaterThan(calls);
    expect(t.transport.get()).toMatchObject({ kind: 'open', offers: [], request: { kind: 'delivered' } });
    t.transport.dispose();
  });

  it('lets a recovered unpaid intent be cancelled explicitly and then permits another gift', async () => {
    const t = setup(); t.active({ intentId: 'old', sku: 'kitesa' }); t.cancellable(); await t.transport.refresh(); await settle();
    expect(t.transport.get()).toMatchObject({ request: { kind: 'pending', canCancel: true } });
    t.transport.cancelGiftChoice(); await settle(); expect(t.transport.get()).toMatchObject({ request: { kind: 'cancelled' } });
    t.active(null); t.transport.resetGift(); t.transport.requestProduct('bella'); await settle();
    expect(t.helper.useBits).toHaveBeenCalledWith('bella'); t.transport.dispose();
  });
  it('never requests cancellation for a paid or uncertain intent', async () => {
    const t = setup(); t.active({ intentId: 'paid', sku: 'kitesa' }); await t.transport.refresh(); await settle();
    t.transport.cancelGiftChoice(); await settle(); expect(t.fetcher.mock.calls.some(([u]) => String(u).endsWith('gift-cancel'))).toBe(false);
    t.transport.dispose();
  });

  it('tracks the selected older intent after resolution while the newer remains unpaid', async () => {
    const t = setup(); t.transport.dispose(); let resolved = false;
    const send: typeof fetch = async (url, init) => {
      const path = String(url).split('/').pop(), body = JSON.parse(String(init?.body));
      if (path === 'gifts') return new Response(JSON.stringify({ version: 1, status: 'gifts', stream: 'live', offers: [offer], friends: [], activeIntent: { intentId: 'B', sku: 'kitesa' } }));
      if (path === 'gift-status') return new Response(JSON.stringify(!resolved ? { version: 1, status: 'awaiting-target', paymentRef: 'payment', choices: [{ intentId: 'A', title: 'Kites', targetName: null, createdAt: 1 }] } : body.intentId === 'A' ? { version: 1, status: 'delivered', fact: { version: 1, type: 'panel.gift', line: 'A arrived' } } : { version: 1, status: 'pending' }));
      if (path === 'gift-resolve') { resolved = true; return new Response(JSON.stringify({ version: 1, status: 'pending' })); }
      throw new Error('unexpected');
    };
    const transport = createGiftTransport({ helper: t.helper, backend: 'https://chatdom.io', fetch: send, visible: () => true, live: () => true, onChange: () => {} });
    await transport.refresh(); await settle(); transport.resolveGiftIntent('A'); await settle();
    expect(transport.get()).toMatchObject({ request: { kind: 'delivered', line: 'A arrived' } }); transport.dispose();
  });
  it('recovers a lost cancellation response from authoritative status', async () => {
    const t = setup(); t.transport.dispose(); let cancelled = false;
    const send: typeof fetch = async (url, init) => {
      const path = String(url).split('/').pop();
      if (path === 'gifts') return new Response(JSON.stringify({ version: 1, status: 'gifts', stream: 'live', offers: [offer, { ...offer, sku: 'bella' }], friends: [], activeIntent: cancelled ? null : { intentId: 'old', sku: 'kitesa' } }));
      if (path === 'gift-cancel') { cancelled = true; throw new Error('lost response'); }
      if (path === 'gift-status') return new Response(JSON.stringify(cancelled ? { version: 1, status: 'cancelled' } : { version: 1, status: 'pending', canCancel: true }));
      if (path === 'gift-intent') return new Response(JSON.stringify({ version: 1, status: 'intent', intentId: 'new', sku: JSON.parse(String(init?.body)).sku }));
      throw new Error('unexpected');
    };
    const transport = createGiftTransport({ helper: t.helper, backend: 'https://chatdom.io', fetch: send, visible: () => true, live: () => true, onChange: () => {} });
    await transport.refresh(); await settle(); transport.cancelGiftChoice(); await settle(); await vi.advanceTimersByTimeAsync(5_000);
    expect(transport.get()).toMatchObject({ request: { kind: 'cancelled' } });
    transport.resetGift(); transport.requestProduct('bella'); await settle(); expect(t.helper.useBits).toHaveBeenCalledWith('bella'); transport.dispose();
  });
  it('loads another page of paid choices only after a gesture', async () => {
    const t = setup(); t.transport.dispose(); const paths: string[] = [];
    const send: typeof fetch = async (url, init) => {
      const path = String(url).split('/').pop()!; paths.push(path);
      if (path === 'gifts') return new Response(JSON.stringify({ version: 1, status: 'gifts', stream: 'live', offers: [offer], friends: [], activeIntent: { intentId: 'B', sku: 'kitesa' } }));
      if (path === 'gift-status') return new Response(JSON.stringify({ version: 1, status: 'awaiting-target', paymentRef: 'pay', nextCursor: 'next', choices: [{ intentId: 'A', title: 'First', targetName: null, createdAt: 1 }] }));
      if (path === 'gift-choices') { expect(JSON.parse(String(init?.body))).toEqual({ paymentRef: 'pay', cursor: 'next' }); return new Response(JSON.stringify({ version: 1, status: 'awaiting-target', paymentRef: 'pay', choices: [{ intentId: 'C', title: 'Next', targetName: null, createdAt: 2 }] })); }
      throw new Error('unexpected');
    };
    const transport = createGiftTransport({ helper: t.helper, backend: 'https://chatdom.io', fetch: send, visible: () => true, live: () => true, onChange: () => {} });
    await transport.refresh(); await settle(); expect(paths).not.toContain('gift-choices'); transport.moreGiftChoices(); await settle();
    expect(transport.get()).toMatchObject({ request: { kind: 'choosing-paid', choices: [{ intentId: 'C' }] } }); expect(t.helper.useBits).not.toHaveBeenCalled(); transport.dispose();
  });

});
