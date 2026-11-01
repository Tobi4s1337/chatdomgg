import { createHmac } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { createPanelGifts } from './index';

const client = 'SIMULATEDextension', secret = Buffer.alloc(32, 42).toString('base64'), webhookSecret = 'SIMULATED-webhook-secret-for-tests-12345';
const now = Date.parse('2026-11-01T20:00:00.000Z'), at = new Date(now - 1_000).toISOString();
const viewer = { kind: 'shared', channelId: '1234', personId: '5678', role: 'viewer' } as const;
const canonical = () => ({ id: 'SIMULATED-transaction', timestamp: at, broadcaster_id: '1234', user_id: '5678', user_name: 'SIMULATED Wren',
  product_type: 'BITS_IN_EXTENSION', product_data: { sku: 'kitesa', domain: `twitch.ext.${client}`, cost: { amount: 100, type: 'bits' }, inDevelopment: true } });
const payload = () => ({ topic: 'bits_transaction_receipt', data: { transactionId: 'SIMULATED-transaction', time: at, userId: '5678',
  product: { domainId: `twitch.ext.${client}`, sku: 'kitesa', cost: { amount: 100, type: 'bits' }, inDevelopment: true } } });
async function receipt(body: Record<string, unknown> = payload(), signing = secret, expires = now / 1000 + 300) {
  return new SignJWT(body).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(expires).sign(Buffer.from(signing, 'base64'));
}
function setup(options: { clientSecret?: string | null; retired?: ReadonlySet<string> } = {}) {
  let rows = [canonical()], storedCursor: string | null = null;
  let answer: Record<string, unknown> = { version: 1, status: 'pending' };
  const jobs = new Set<string>();
  const realm = vi.fn(async (path: string, raw: unknown): Promise<Record<string, unknown>> => {
    const body = raw as Record<string, unknown>;
    if (path.endsWith('/gift-drain')) return { version: 1, status: 'drained', processed: 0 };
    if (path.endsWith('/gift-inbox')) { if (typeof body.transactionId === 'string') { jobs.add(body.transactionId); return { version: 1, status: 'inbox' }; } return { version: 1, status: 'inbox', transactionIds: [...jobs] }; }
    if (path.endsWith('/gift-reconcile')) { if ('cursor' in body) storedCursor = body.cursor as string | null; return { version: 1, status: 'cursor', cursor: storedCursor }; }
    if (path.endsWith('/gifts')) return { version: 1, status: 'gifts', stream: 'live', offers: [{ sku: 'kitesa' }, { sku: 'retired' }], friends: [] };
    if (path.endsWith('/gift-intent')) return { version: 1, status: 'intent', intentId: 'SIMULATED-intent', sku: body.sku };
    if (path.endsWith('/gift-cancel')) return { version: 1, status: 'cancelled' };
    if (path.endsWith('/gift-evidence')) jobs.delete(String(body.transactionId));
    return answer;
  });
  const send = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    if (url.pathname === '/oauth2/token') return Response.json({ access_token: 'SIMULATED-app-token', expires_in: 7200, token_type: 'bearer' });
    if (url.pathname === '/oauth2/validate') return Response.json({ client_id: client, expires_in: 7000 });
    if (url.pathname === '/helix/extensions/transactions') {
      const requested = url.searchParams.get('id');
      return Response.json({ data: requested ? rows.filter(row => row.id === requested) : rows, pagination: {} });
    }
    throw new Error('Unexpected provider endpoint');
  });
  const service = createPanelGifts({ extensionId: client, extensionSecret: secret,
    ...(options.clientSecret === null ? {} : { extensionClientSecret: options.clientSecret ?? 'SIMULATED-extension-oauth-secret' }),
    webhookSecret, realm, fetch: send, now: () => now, ...(options.retired ? { retiredSkus: options.retired } : {}) });
  return { service, realm, send, jobs, rows(next: typeof rows) { rows = next; }, answer(next: Record<string, unknown>) { answer = next; } };
}
function event() { return { subscription: { type: 'extension.bits_transaction.create', version: '1', condition: { extension_client_id: client } },
  event: { id: 'SIMULATED-transaction', extension_client_id: client, broadcaster_user_id: '1234', user_id: '5678', product: { sku: 'kitesa', bits: 100, in_development: true } } }; }
function signed(body: unknown = event(), type = 'notification', timestamp = new Date(now).toISOString()) {
  const raw = Buffer.from(JSON.stringify(body)), messageId = 'SIMULATED-webhook-delivery';
  return { raw, headers: { 'twitch-eventsub-message-id': messageId, 'twitch-eventsub-message-timestamp': timestamp, 'twitch-eventsub-message-type': type,
    'twitch-eventsub-subscription-type': 'extension.bits_transaction.create', 'twitch-eventsub-subscription-version': '1',
    'twitch-eventsub-message-signature': `sha256=${createHmac('sha256', webhookSecret).update(messageId).update(timestamp).update(raw).digest('hex')}` } };
}

describe('server-verified panel gifts', () => {
  it('keeps gifts closed without extension-specific OAuth and never borrows other app credentials', async () => {
    const { service, realm, send } = setup({ clientSecret: null });
    expect(await service.handle('gifts', viewer, {})).toMatchObject({ http: 200, body: { offers: [], message: 'TWITCH_EXTENSION_CLIENT_SECRET' } });
    expect((await service.handle('gift-receipt', viewer, { intentId: 'SIMULATED-intent', receipt: await receipt() })).http).toBe(503);
    expect(send).not.toHaveBeenCalled(); expect(realm).toHaveBeenCalledOnce();
  });

  it('preserves paid-checkout recovery and durable webhook intake while OAuth configuration is absent', async () => {
    const { service, realm, send, jobs } = setup({ clientSecret: null });
    realm.mockResolvedValueOnce({ version: 1, status: 'gifts', stream: 'resting', offers: [{ sku: 'kitesa' }], friends: [], activeIntent: { intentId: 'SIMULATED-intent', sku: 'kitesa' } });
    expect(await service.handle('gifts', viewer, {})).toMatchObject({ body: { offers: [], activeIntent: { intentId: 'SIMULATED-intent' } } });
    expect(await service.handle('gift-status', viewer, { intentId: 'SIMULATED-intent' })).toMatchObject({ body: { status: 'pending' } });
    expect(await service.handle('gift-cancel', viewer, { intentId: 'SIMULATED-intent' })).toMatchObject({ body: { status: 'cancelled' } });
    const message = signed(); expect((await service.webhook(message.raw, message.headers)).http).toBe(202);
    expect(jobs.has('SIMULATED-transaction')).toBe(true); expect(send).not.toHaveBeenCalled();
  });

  it('retries durable paid obligations without OAuth, provider history or an open viewer', async () => {
    const { service, realm, send } = setup({ clientSecret: null });
    expect((await service.reconcileOnce()).http).toBe(503);
    expect(realm.mock.calls).toEqual([['/internal/realm/panel/gift-drain', { extensionId: client }]]);
    expect(send).not.toHaveBeenCalled();
    realm.mockClear();
    vi.useFakeTimers();
    const stop = service.startReconciliation();
    try {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(realm.mock.calls).toEqual([['/internal/realm/panel/gift-drain', { extensionId: client }], ['/internal/realm/panel/gift-drain', { extensionId: client }]]);
      stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(realm).toHaveBeenCalledTimes(2); expect(send).not.toHaveBeenCalled();
    } finally { stop(); vi.useRealTimers(); }
  });

  it('forwards only verified identity and known active checkout SKUs', async () => {
    const { service, realm } = setup({ retired: new Set(['bella']) });
    const valid = { requestId: 'c91c7f57-df37-4b47-9c75-f18ac44ac81a', sku: 'kitesa', targetPlotId: null };
    expect((await service.handle('gift-intent', viewer, valid)).http).toBe(200);
    expect(realm).toHaveBeenCalledWith('/internal/realm/panel/gift-intent', { ...valid, kingdomId: '1234', personId: '5678', extensionId: client });
    for (const body of [{ ...valid, personId: '999' }, { ...valid, sku: 'bella' }, { ...valid, sku: 'no-such-gift' }, { ...valid, name: 'Other' }]) {
      expect((await service.handle('gift-intent', viewer, body)).http).toBe(400);
    }
    expect(realm).toHaveBeenCalledTimes(1);
    expect((await service.handle('gift-intent', { kind: 'unshared', channelId: '1234', role: 'viewer' }, valid)).http).toBe(403);
  });

  it('does not offer an unknown SKU or invent a delivery effect', async () => {
    const { service, realm } = setup();
    expect(await service.handle('gifts', viewer, {})).toMatchObject({ http: 200, body: { offers: [{ sku: 'kitesa' }] } });
    realm.mockResolvedValueOnce({ version: 1, status: 'gifts', stream: 'live', offers: [], friends: [] });
    expect(await service.handle('gifts', viewer, {})).toMatchObject({ http: 200, body: { offers: [] } });
  });

  it('refuses forged, expired, wrong-topic, wrong-extension and wrong-person receipts before realm evidence', async () => {
    const { service, realm, send } = setup();
    const otherDomain = payload(); otherDomain.data.product.domainId = 'twitch.ext.other';
    const otherUser = payload(); otherUser.data.userId = '8888';
    for (const raw of [await receipt(payload(), Buffer.alloc(32, 9).toString('base64')), await receipt(payload(), secret, now / 1000 - 1),
      await receipt({ ...payload(), topic: 'viewer' }), await receipt(otherDomain), await receipt(otherUser)]) {
      expect((await service.handle('gift-receipt', viewer, { intentId: 'SIMULATED-intent', receipt: raw })).http).toBe(400);
    }
    expect(realm).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it('normalizes signed digit-string amounts and omitted release mode only when canonical history agrees', async () => {
    const { service, realm, rows } = setup();
    const source = payload();
    const signedProduct = (product: Record<string, unknown>) => receipt({ ...source, data: { ...source.data, product } });
    rows([{ ...canonical(), product_data: { ...canonical().product_data, inDevelopment: false } }]);
    const released = { domainId: source.data.product.domainId, sku: source.data.product.sku, cost: { amount: '100', type: 'bits' } };
    expect((await service.handle('gift-receipt', viewer, { intentId: 'SIMULATED-intent', receipt: await signedProduct(released) })).http).toBe(200);
    expect(realm.mock.calls.at(-1)?.[1]).toMatchObject({ bits: 100, inDevelopment: false });
    for (const invalid of [{ ...released, cost: { amount: '100x', type: 'bits' } }, { ...released, cost: { amount: -100, type: 'bits' } },
      { ...released, cost: { amount: '0', type: 'bits' } }, { ...released, cost: { amount: '10001', type: 'bits' } },
      { ...released, inDevelopment: 'false' }, { ...released, inDevelopment: true }]) {
      expect((await service.handle('gift-receipt', viewer, { intentId: 'SIMULATED-intent', receipt: await signedProduct(invalid) })).http).toBe(400);
    }
    expect(realm).toHaveBeenCalledOnce();
  });

  it('binds channel, purchaser, SKU, amount, mode and time to canonical transaction history', async () => {
    const { service, realm, rows } = setup(); const raw = await receipt();
    const valid = canonical();
    for (const row of [{ ...valid, broadcaster_id: '9999' }, { ...valid, user_id: '9999' }, { ...valid, timestamp: new Date(now - 2000).toISOString() },
      { ...valid, product_data: { ...valid.product_data, sku: 'bella' } }, { ...valid, product_data: { ...valid.product_data, inDevelopment: false } },
      { ...valid, product_data: { ...valid.product_data, cost: { amount: 300, type: 'bits' } } }]) {
      rows([row]); expect((await service.handle('gift-receipt', viewer, { intentId: 'SIMULATED-intent', receipt: raw })).http).toBe(400);
    }
    expect(realm).not.toHaveBeenCalled();
  });

  it('returns only the realm result, and still records a real paid issued gift after checkout retirement', async () => {
    const { service, realm, answer } = setup({ retired: new Set(['kitesa']) });
    const request = { intentId: 'SIMULATED-intent', receipt: await receipt() };
    expect(await service.handle('gift-receipt', viewer, request)).toEqual({ http: 200, body: { version: 1, status: 'pending' } });
    expect(realm).toHaveBeenCalledWith('/internal/realm/panel/gift-evidence', { extensionId: client, transactionId: 'SIMULATED-transaction', kingdomId: '1234', personId: '5678',
      sku: 'kitesa', bits: 100, inDevelopment: true, occurredAt: Date.parse(at), name: 'SIMULATED Wren', intentId: 'SIMULATED-intent' });
    answer({ version: 1, status: 'delivered', fact: { id: 'SIMULATED-public-fact' } });
    expect(await service.handle('gift-status', viewer, { intentId: 'SIMULATED-intent' })).toMatchObject({ body: { status: 'delivered' } });
    expect(realm.mock.calls.at(-1)).toEqual(['/internal/realm/panel/gift-status', { intentId: 'SIMULATED-intent', kingdomId: '1234', personId: '5678' }]);
  });

  it('records cancellation without creating payment evidence or a client-inferred grant', async () => {
    const { service, realm } = setup();
    expect(await service.handle('gift-cancel', viewer, { intentId: 'SIMULATED-intent' })).toMatchObject({ body: { status: 'cancelled' } });
    expect(realm).toHaveBeenCalledOnce();
    expect(realm.mock.calls[0]).toEqual(['/internal/realm/panel/gift-cancel', { intentId: 'SIMULATED-intent', kingdomId: '1234', personId: '5678' }]);
    expect((await service.handle('gift-cancel', viewer, { intentId: 'SIMULATED-intent', receipt: 'not-a-receipt' })).http).toBe(400);
  });

  it('resolves a persisted payment using only authenticated identity and explicit opaque choices, without OAuth', async () => {
    const { service, realm, send } = setup({ clientSecret: null });
    const body = { paymentRef: '0825cfd0-15dc-44b0-bff2-cf25e6f1099c', intentId: '97532d2d-dd9b-429d-a3f9-6c32f1ac378d' };
    expect(await service.handle('gift-resolve', viewer, body)).toMatchObject({ http: 200, body: { status: 'pending' } });
    expect(realm.mock.calls[0]).toEqual(['/internal/realm/panel/gift-resolve', { ...body, kingdomId: '1234', personId: '5678' }]);
    for (const invalid of [{ ...body, personId: '9999' }, { ...body, kingdomId: '9999' }, { ...body, paymentRef: 'not-a-uuid' }, { ...body, intentId: 'not-a-uuid' }, { ...body, name: 'Other' }]) {
      expect((await service.handle('gift-resolve', viewer, invalid)).http).toBe(400);
    }
    expect((await service.handle('gift-resolve', { kind: 'unshared', channelId: '1234', role: 'viewer' }, body)).http).toBe(403);
    expect(realm).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled();
  });

  it('pages persisted payment choices with authenticated identity while OAuth is unavailable', async () => {
    const { service, realm, send, answer } = setup({ clientSecret: null });
    const paymentRef = '0825cfd0-15dc-44b0-bff2-cf25e6f1099c';
    const result = { version: 1, status: 'awaiting-target', paymentRef, choices: [], nextCursor: 'SIMULATED-next-page' };
    answer(result);
    expect(await service.handle('gift-choices', viewer, { paymentRef })).toEqual({ http: 200, body: result });
    expect(realm.mock.calls.at(-1)).toEqual(['/internal/realm/panel/gift-choices', { paymentRef, kingdomId: '1234', personId: '5678' }]);
    expect(await service.handle('gift-choices', viewer, { paymentRef, cursor: 'SIMULATED-cursor' })).toEqual({ http: 200, body: result });
    expect(realm.mock.calls.at(-1)).toEqual(['/internal/realm/panel/gift-choices', { paymentRef, cursor: 'SIMULATED-cursor', kingdomId: '1234', personId: '5678' }]);
    for (const invalid of [{ paymentRef, cursor: 'x'.repeat(257) }, { paymentRef, cursor: 10 }, { paymentRef, cursor: '' }, { paymentRef, personId: '9999' },
      { paymentRef, kingdomId: '9999' }, { paymentRef: 'not-a-uuid' }]) {
      expect((await service.handle('gift-choices', viewer, invalid)).http).toBe(400);
    }
    expect((await service.handle('gift-choices', { kind: 'unshared', channelId: '1234', role: 'viewer' }, { paymentRef })).http).toBe(403);
    expect(realm).toHaveBeenCalledTimes(2); expect(send).not.toHaveBeenCalled();
    answer({ version: 1, status: 'cancelled' });
    expect(await service.handle('gift-status', viewer, { intentId: 'SIMULATED-intent' })).toEqual({ http: 200, body: { version: 1, status: 'cancelled' } });
  });

  it('keeps a canonical paid transaction awaiting a target instead of replacing the realm choice with the receipt intent', async () => {
    const { service, realm, answer } = setup();
    const choice = { intentId: '97532d2d-dd9b-429d-a3f9-6c32f1ac378d', title: 'Kites on the breeze', targetName: null, createdAt: now - 5000 };
    const result = { version: 1, status: 'awaiting-target', paymentRef: '0825cfd0-15dc-44b0-bff2-cf25e6f1099c', choices: [choice] };
    answer(result);
    expect(await service.handle('gift-receipt', viewer, { intentId: 'SIMULATED-intent', receipt: await receipt() })).toEqual({ http: 200, body: result });
    expect(realm.mock.calls.at(-1)?.[1]).toMatchObject({ intentId: 'SIMULATED-intent', transactionId: 'SIMULATED-transaction' });
    expect((await service.reconcileOnce()).http).toBe(200);
    expect(realm.mock.calls.filter(([path, raw]) => path.endsWith('/gift-reconcile') && 'cursor' in (raw as object))).toHaveLength(1);
  });

  it('acknowledges a verified webhook only after durable enqueue, without waiting for provider lookup', async () => {
    const { service, realm, send, jobs } = setup();
    send.mockImplementation(() => new Promise(() => {}));
    const message = signed();
    expect(await service.webhook(message.raw, message.headers)).toMatchObject({ http: 202 });
    expect(send).not.toHaveBeenCalled(); expect(jobs.has('SIMULATED-transaction')).toBe(true);
    expect(realm.mock.calls[0]).toEqual(['/internal/realm/panel/gift-inbox', { extensionId: client, transactionId: 'SIMULATED-transaction' }]);
    realm.mockRejectedValueOnce(new Error('Storage unavailable'));
    expect((await service.webhook(message.raw, message.headers)).http).toBe(503);
  });

  it('verifies raw webhook HMAC, freshness, subscription extension/version and challenge', async () => {
    const { service, realm } = setup();
    const valid = signed();
    expect((await service.webhook(Buffer.from('{}'), valid.headers)).http).toBe(403);
    const old = signed(event(), 'notification', new Date(now - 600_001).toISOString()); expect((await service.webhook(old.raw, old.headers)).http).toBe(403);
    const future = signed(event(), 'notification', new Date(now + 600_001).toISOString()); expect((await service.webhook(future.raw, future.headers)).http).toBe(403);
    const wrong = event(); wrong.subscription.version = '2'; const bad = signed(wrong); expect((await service.webhook(bad.raw, bad.headers)).http).toBe(400);
    const condition = event(); condition.subscription.condition.extension_client_id = 'other'; const other = signed(condition); expect((await service.webhook(other.raw, other.headers)).http).toBe(400);
    const challenge = signed({ subscription: event().subscription, challenge: 'SIMULATED-challenge' }, 'webhook_callback_verification');
    expect(await service.webhook(challenge.raw, challenge.headers)).toEqual({ http: 200, body: 'SIMULATED-challenge', contentType: 'text/plain' });
    expect(realm).not.toHaveBeenCalled();
  });

  it('makes replayed receipts and the webhook worker converge on identical canonical evidence', async () => {
    const { service, realm, jobs } = setup(); const message = signed();
    const request = { intentId: 'SIMULATED-intent', receipt: await receipt() };
    await Promise.all([service.handle('gift-receipt', viewer, request), service.handle('gift-receipt', viewer, request), service.webhook(message.raw, message.headers)]);
    await service.reconcileOnce();
    const evidence = realm.mock.calls.filter(([path]) => path.endsWith('/gift-evidence')).map(([, body]) => body as Record<string, unknown>);
    expect(evidence.length).toBeGreaterThanOrEqual(3);
    for (const row of evidence) { const canonical = { ...row }; delete canonical.intentId; expect(canonical).toEqual({ extensionId: client, transactionId: 'SIMULATED-transaction', kingdomId: '1234', personId: '5678',
      sku: 'kitesa', bits: 100, inDevelopment: true, occurredAt: Date.parse(at), name: 'SIMULATED Wren' }); }
    expect(jobs.size).toBe(0);
  });

  it('validates its own extension OAuth token and refreshes after provider authorization is revoked', async () => {
    const { service, send } = setup(); const implementation = send.getMockImplementation()!;
    let first = true;
    send.mockImplementation(async (input, init) => {
      if (new URL(String(input)).pathname === '/helix/extensions/transactions' && first) { first = false; return new Response('', { status: 401 }); }
      return implementation(input, init);
    });
    expect((await service.handle('gift-receipt', viewer, { intentId: 'SIMULATED-intent', receipt: await receipt() })).http).toBe(200);
    expect(send.mock.calls.filter(([input]) => String(input).endsWith('/oauth2/token'))).toHaveLength(2);
    for (const [input, init] of send.mock.calls) {
      const url = new URL(String(input));
      if (url.pathname === '/oauth2/token') expect((init?.body as URLSearchParams).get('client_id')).toBe(client);
      if (url.pathname === '/helix/extensions/transactions') expect(init?.headers).toMatchObject({ 'Client-Id': client });
    }
  });

  it('does not advance reconciliation over unaccepted canonical evidence', async () => {
    const { service, realm } = setup();
    realm.mockImplementation(async (path, raw) => {
      if (path.endsWith('/gift-drain')) return { status: 'drained' };
      if (path.endsWith('/gift-inbox')) return { status: 'inbox', transactionIds: [] };
      if (path.endsWith('/gift-reconcile')) return { status: 'cursor', cursor: null };
      expect(raw).toMatchObject({ transactionId: 'SIMULATED-transaction' }); throw new Error('Uncertain write');
    });
    expect((await service.reconcileOnce()).http).toBe(503);
    expect(realm.mock.calls.some(([path]) => path.endsWith('/gift-evidence'))).toBe(true);
    expect(realm.mock.calls.filter(([path, body]) => path.endsWith('/gift-reconcile') && 'cursor' in (body as object))).toHaveLength(0);
  });
});
