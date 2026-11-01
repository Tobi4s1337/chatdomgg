import { Buffer } from 'node:buffer';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { helperSource, signTransactionReceipt } from './helper.mjs';
import { bridgeHelper } from '../src/helper.ts';

test('Helper signs identities and refreshes authorization on sharing', async () => {
  const secret = randomBytes(32).toString('base64');
  const window = {};
  runInNewContext(helperSource(secret, { channel: '22', user: '33' }), { window, queueMicrotask: globalThis.queueMicrotask });
  const auths = [];
  window.Twitch.ext.onAuthorized(auth => auths.push(auth));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(auths.length, 1);
  const verify = token => {
    const [header, payload, signature] = token.split('.');
    assert.equal(signature, createHmac('sha256', Buffer.from(secret, 'base64')).update(`${header}.${payload}`).digest('base64url'));
    return JSON.parse(Buffer.from(payload, 'base64url'));
  };
  assert.equal(verify(auths[0].token).channel_id, '22');
  assert.equal(verify(auths[0].token).user_id, undefined);
  window.Twitch.ext.actions.requestIdShare();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(window.__panelHarness.shareRequests, 1);
  assert.equal(window.Twitch.ext.viewer.isLinked, true);
  assert.equal(verify(auths[1].token).user_id, '33');
  assert.notEqual(auths[0].token, auths[1].token);
  window.__panelHarness.setIdentity('logged-out');
  assert.ok(auths.at(-1).userId.startsWith('A'));
  assert.equal(verify(auths.at(-1).token).user_id, undefined);
});

test('Helper drives context, visibility and subscribed PubSub listeners', async () => {
  const window = {};
  runInNewContext(helperSource(randomBytes(32).toString('base64')), { window, queueMicrotask: globalThis.queueMicrotask });
  const contexts = [], visible = [], messages = [];
  window.Twitch.ext.onContext(context => contexts.push(context));
  window.Twitch.ext.onVisibilityChanged(value => visible.push(value));
  window.Twitch.ext.listen('broadcast', (...args) => messages.push(args));
  await new Promise(resolve => setImmediate(resolve));
  window.__panelHarness.setPlaying(false);
  window.__panelHarness.setVisible(false);
  window.__panelHarness.publish('other', 'ignored');
  window.__panelHarness.publish('broadcast', 'hello');
  assert.equal(contexts.at(-1).isPaused, true);
  assert.equal(visible.at(-1), false);
  assert.equal(messages.length, 1);
  assert.equal(messages[0][2], 'hello');
});

const products = [{ sku: 'kitesa', cost: { amount: '100', type: 'bits' }, expiration: null, isBroadcast: true }];
function bitsHarness(options = {}) {
  const secret = randomBytes(32).toString('base64'), window = {};
  const source = helperSource(secret, { identity: 'shared', bits: true, products, ...options });
  runInNewContext(source, { window, queueMicrotask: globalThis.queueMicrotask });
  return { secret, source, ext: window.Twitch.ext, control: window.__panelHarness };
}

test('Helper exposes only explicitly configured product values without exposing its signing secret', async () => {
  const t = bitsHarness();
  assert.deepEqual(JSON.parse(JSON.stringify(await t.ext.bits.getProducts())), products);
  const returned = await t.ext.bits.getProducts();
  returned[0].sku = 'unknown'; returned[0].cost.amount = 1;
  assert.equal((await t.ext.bits.getProducts())[0].sku, 'kitesa');
  assert.equal((await t.ext.bits.getProducts())[0].cost.amount, '100');
  assert.equal(t.source.includes(t.secret), false);
  assert.equal(JSON.stringify(t.control).includes(t.secret), false);
});

test('Helper admits known SKUs and requires explicit completion through the production bridge', async () => {
  const t = bitsHarness(), bridge = bridgeHelper(t.ext), completions = [], metadata = [];
  bridge.onGiftTransaction(event => completions.push(event));
  t.ext.bits.onTransactionComplete((_event, detail) => metadata.push(detail));
  assert.equal(bridge.useBits('kitesa'), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(t.control.bitsRequests, 1);
  assert.equal(t.control.selectedSku, 'kitesa');
  assert.equal(t.control.pendingSku, 'kitesa');
  assert.equal(completions.length, 0);
  assert.equal(bridge.useBits('kitesa'), false);
  assert.equal(t.control.bitsRequests, 1);
  assert.throws(() => t.control.transactionComplete({ product: { sku: 'unknown' } }), /does not match/);
  assert.equal(t.control.pendingSku, 'kitesa');
  const receipt = signTransactionReceipt(t.secret, { extensionId: 'panel-lane', transactionId: 'SIMULATED-transaction',
    userId: '5678', sku: 'kitesa', bits: 100, occurredAt: Date.now(), inDevelopment: true });
  assert.equal(t.control.transactionComplete({ product: { sku: 'kitesa' }, transactionReceipt: receipt }), true);
  assert.equal(completions.length, 1);
  assert.equal(completions[0].initiator, 'current_user');
  assert.equal(completions[0].transactionReceipt, receipt);
  assert.equal(metadata[0].isTransactionCurrentUser, true);
  assert.equal(t.control.pendingSku, null);
  assert.equal(t.control.transactionComplete({ transactionReceipt: receipt }), false);
  assert.equal(t.control.transactionCancelled(), false);
  assert.equal(completions.length, 1);
});

test('Helper cancels a pending dialog explicitly without completing or reopening it', async () => {
  const t = bitsHarness(), bridge = bridgeHelper(t.ext), completed = [], cancelled = [];
  bridge.onGiftTransaction(event => completed.push(event));
  bridge.onGiftCancelled(() => cancelled.push(true));
  assert.equal(t.control.transactionCancelled(), false);
  assert.equal(bridge.useBits('kitesa'), true);
  assert.equal(t.control.transactionCancelled(), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled.length, 1);
  assert.equal(completed.length, 0);
  assert.equal(t.control.pendingSku, null);
  assert.equal(t.control.bitsRequests, 1);
  assert.equal(t.control.transactionComplete(), false);
  assert.equal(bridge.useBits('kitesa'), true);
  assert.equal(t.control.bitsRequests, 2);
});

test('Helper refuses unknown products, disabled Bits and an absent product catalogue', async () => {
  for (const options of [{}, { bits: false }, { products: [] }, { products: undefined }]) {
    const t = bitsHarness(options), bridge = bridgeHelper(t.ext);
    assert.equal(bridge.useBits('unknown'), false);
    assert.equal(t.control.bitsRequests, 0);
    assert.equal(t.control.selectedSku, null);
    assert.equal(t.control.pendingSku, null);
    if (options.bits === false || 'products' in options) assert.equal(bridge.useBits('kitesa'), false);
    if ('products' in options) assert.equal((await t.ext.bits.getProducts()).length, 0);
  }
});

test('Helper validates bounded fixed product shape before generating browser source', () => {
  const valid = products[0];
  for (const invalid of [null, {}, 'products', Array(101).fill(valid), [valid, valid],
    [{ ...valid, secret: 'SIMULATED-forbidden' }], [{ ...valid, sku: '' }], [{ ...valid, isBroadcast: 'true' }],
    [{ ...valid, expiration: 'not-a-time' }], [{ ...valid, cost: { amount: 100, type: 'usd' } }],
    ...[0, -1, 1.5, 10001, '001', '100.1', '', null, true, Infinity].map(amount => [{ ...valid, cost: { amount, type: 'bits' } }]),
    [{ ...valid, cost: { amount: 100, type: 'bits', secret: 'SIMULATED-forbidden' } }]]) {
    assert.throws(() => bitsHarness({ products: invalid }), /Invalid harness product/);
  }
});

test('Node receipt signer uses the documented signed claims without inventing a channel', () => {
  const secret = randomBytes(32).toString('base64'), occurredAt = Date.parse('2026-11-02T15:30:00.000Z');
  const args = { extensionId: 'panel-lane', transactionId: 'SIMULATED-transaction', userId: '5678', sku: 'kitesa', bits: 100, occurredAt, inDevelopment: true };
  const receipt = signTransactionReceipt(secret, args), [header, encoded, signature] = receipt.split('.');
  assert.equal(signature, createHmac('sha256', Buffer.from(secret, 'base64')).update(`${header}.${encoded}`).digest('base64url'));
  const payload = JSON.parse(Buffer.from(encoded, 'base64url'));
  assert.deepEqual(payload.data, { transactionId: args.transactionId, time: new Date(occurredAt).toISOString(), userId: '5678',
    product: { domainID: 'twitch.ext.panel-lane', sku: 'kitesa', cost: { amount: 100, type: 'bits' }, inDevelopment: true } });
  assert.equal(payload.topic, 'bits_transaction_receipt');
  assert.ok(payload.exp > Date.now() / 1000);
  assert.equal('channel_id' in payload, false);
  assert.equal('channelId' in payload.data, false);
  const stringTimeReceipt = signTransactionReceipt(secret, { ...args, occurredAt: new Date(occurredAt).toISOString() });
  assert.deepEqual(JSON.parse(Buffer.from(stringTimeReceipt.split('.')[1], 'base64url')).data, payload.data);
  for (const changed of [{ extensionId: '' }, { transactionId: '' }, { userId: 'anonymous' }, { sku: '' }, { bits: 0 }, { inDevelopment: undefined }, { occurredAt: 'invalid' }]) {
    assert.throws(() => signTransactionReceipt(secret, { ...args, ...changed }), /Invalid harness receipt/);
  }
});
