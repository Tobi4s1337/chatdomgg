/* global Buffer, Response, URLSearchParams */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AdminError, BITS_TYPE, WEBHOOK_LABEL, callbackUrl, createAdmin, credentials, options, webhookSecret } from './twitch-admin.mjs';
import { PRODUCTS, productPlan, run as products } from './register-products.mjs';
import { run as subscribe, subscriptionPlan } from './subscribe-bits.mjs';

// SIMULATED provider responses and credentials, never real Twitch access.
const env = { TWITCH_EXTENSION_CLIENT_ID: 'simulatedextension', TWITCH_EXTENSION_SECRET: Buffer.alloc(32, 7).toString('base64'), TWITCH_EXTENSION_CLIENT_SECRET: 'SIMULATED-private-oauth' };
const config = credentials(env), token = 'SIMULATED-private-access';
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function provider(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, ...init });
    if (url.endsWith('/oauth2/token')) {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('client_id'), config.clientId);
      assert.equal(form.get('client_secret'), config.clientSecret);
      return response({ access_token: token });
    }
    if (url.endsWith('/oauth2/validate')) return response({ client_id: config.clientId, expires_in: 7200 });
    assert.equal(init.headers['Client-Id'], config.clientId);
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    return handler(url, init);
  };
  return { fetch, calls };
}

test('all 60 stable SKUs import from the TypeScript catalogue with the same band effect', () => {
  assert.equal(PRODUCTS.length, 60); assert.equal(new Set(PRODUCTS.map(p => p.sku)).size, 60);
  const ids = ['friendfireworks', 'streetlanterns', 'kites', 'bell', 'bunting', 'parade', 'feast', 'bardverse', 'flowerpetals', 'paperboats', 'ribbonarch', 'plazaflowers', 'friendflowers', 'confetti', 'skybanners', 'picnic', 'pinwheels', 'starribbons', 'gatewreath', 'friendpennant'];
  assert.deepEqual(PRODUCTS.map(p => p.sku), ids.flatMap(id => ['a', 'b', 'c'].map(b => `${id}${b}`)));
  for (let i = 0; i < PRODUCTS.length; i += 3) {
    const bands = PRODUCTS.slice(i, i + 3);
    assert.deepEqual(bands.map(p => p.cost.amount), [100, 300, 500]);
    assert.equal(new Set(bands.map(p => p.display_name)).size, 1);
    bands.forEach(p => { assert.equal(p.in_development, true); assert.equal(p.is_broadcast, true); assert.equal(p.cost.type, 'bits'); });
  }
});

test('default tools run offline even with credentials and an injected fetch that fails', async () => {
  const logs = [], fetch = () => { throw Error('network forbidden'); };
  await products([], { env, fetch, log: v => logs.push(v) });
  await subscribe([], { env, fetch, log: v => logs.push(v) });
  logs.forEach(value => { assert.equal(JSON.parse(value).network, false); assert.ok(!value.includes(config.clientSecret)); assert.ok(!value.includes(env.TWITCH_EXTENSION_SECRET)); });
});

test('actual CLI entrypoints run dry without any HTTP and do not need credentials', () => {
  const blockFetch = 'globalThis.fetch = () => { throw new Error("network forbidden"); };';
  for (const file of ['register-products.mjs', 'subscribe-bits.mjs']) {
    const entry = fileURLToPath(new URL(file, import.meta.url));
    // --import installs the network trap before the real CLI entrypoint.
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--import', `data:text/javascript,${encodeURIComponent(blockFetch)}`, entry], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).network, false);
  }
});

test('credentials only accept extension-specific keys and validated base64', () => {
  assert.throws(() => credentials({ TWITCH_CLIENT_ID: 'atlas', TWITCH_CLIENT_SECRET: 'atlas' }), /Missing TWITCH_EXTENSION_CLIENT_ID/);
  assert.throws(() => credentials({ ...env, TWITCH_EXTENSION_SECRET: 'invalid' }), /Invalid base64/);
  assert.throws(() => options(['--release']), /Unknown option/);
  assert.throws(() => options(['--inspect', '--apply']), /Choose/);
});

test('OAuth validates extension app binding before any Helix call', async () => {
  for (const value of [{ client_id: 'different', expires_in: 7200 }, { client_id: config.clientId, user_id: '123', expires_in: 7200 }]) {
    const urls = [];
    const admin = createAdmin(config, { fetch: async url => { urls.push(url); return response(url.endsWith('/token') ? { access_token: token } : value); } });
    await assert.rejects(admin.request('/bits/extensions'), /does not belong/);
    assert.equal(urls.length, 2);
  }
});

test('OAuth validates hourly and retries a Helix 401 once only', async () => {
  let clock = 100, denied = true;
  const p = provider(() => denied ? response({ message: token }, 401) : response({ data: [] }));
  const admin = createAdmin(config, { fetch: p.fetch, now: () => clock });
  await assert.rejects(admin.request('/bits/extensions'), error => error.status === 401 && !error.message.includes(token));
  assert.equal(p.calls.filter(c => c.url.endsWith('/token')).length, 2);
  assert.equal(p.calls.filter(c => c.url.includes('/helix/')).length, 2);
  denied = false; clock += 3_600_001;
  await admin.request('/bits/extensions');
  assert.equal(p.calls.filter(c => c.url.endsWith('/validate')).length, 3);
});

test('error paths redact provider JSON, transport details, tokens and secret URLs', async () => {
  const raw = `${token} ${config.clientSecret} ${env.TWITCH_EXTENSION_SECRET}`;
  for (const fetch of [async () => { throw new Error(raw); }, async () => response({ message: raw }, 403), async () => new Response(raw)]) {
    await assert.rejects(createAdmin(config, { fetch }).request('/bits/extensions'), error => error instanceof AdminError && !error.message.includes(raw) && !error.message.includes(token));
  }
  assert.throws(() => callbackUrl('https://chatdom.io', `https://user:${token}@example.com/path`), error => !error.message.includes(token));
  const entry = fileURLToPath(new URL('subscribe-bits.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [entry, `--${token}`], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.ok(!result.stderr.includes(token)); assert.ok(!result.stderr.includes(' at '));
});

test('catalogue inspection compares without mutations and apply writes only test products', async () => {
  const p = provider((_url, init) => response({ data: init.method === 'PUT' ? [JSON.parse(init.body)] : PRODUCTS }));
  const logs = [];
  await products(['--inspect'], { env, fetch: p.fetch, log: v => logs.push(v) });
  assert.ok(JSON.parse(logs[0]).plan.every(p => p.action === 'unchanged'));
  assert.equal(p.calls.filter(c => c.method === 'PUT').length, 0);
  const empty = provider((_url, init) => response({ data: init.method === 'PUT' ? [JSON.parse(init.body)] : [] }));
  await products(['--apply'], { env, fetch: empty.fetch, log: () => {} });
  assert.equal(empty.calls.filter(c => c.method === 'PUT').length, 60);
  empty.calls.filter(c => c.method === 'PUT').forEach(c => assert.equal(JSON.parse(c.body).in_development, true));
});

test('released and retired products block the entire write before the first PUT', async () => {
  for (const changed of [{ in_development: false, cost: { type: 'bits', amount: 99 } }, { expiration: '2020-01-01T00:00:00Z' }]) {
    const p = provider(() => response({ data: [{ ...PRODUCTS[0], ...changed }] }));
    await assert.rejects(products(['--apply'], { env, fetch: p.fetch, log: () => {} }), /no products were written/);
    assert.equal(p.calls.filter(c => c.method === 'PUT').length, 0);
  }
  assert.equal(productPlan([{ ...PRODUCTS[0], display_name: 'Old title' }])[0].action, 'update');
});

test('webhook secret matches the API derivation and callback constraints', () => {
  assert.equal(webhookSecret(config.secret), createHmac('sha256', Buffer.alloc(32, 7)).update(WEBHOOK_LABEL).digest('hex'));
  assert.equal(webhookSecret(config.secret).length, 64);
  assert.equal(callbackUrl(), 'https://chatdom.io/api/panel/v1/bits-webhook');
  for (const value of ['http://chatdom.io/hook', 'https://chatdom.io:5196/hook', 'https://chatdom.io/hook?token=private']) assert.throws(() => callbackUrl(undefined, value));
});

const hook = { type: BITS_TYPE, version: '1', condition: { extension_client_id: config.clientId }, transport: { method: 'webhook', callback: callbackUrl() }, status: 'enabled' };

test('existing enabled or pending webhook on a later page never duplicates', async () => {
  for (const status of ['enabled', 'webhook_callback_verification_pending']) {
    const p = provider(url => response(url.includes('after=page2') ? { data: [{ ...hook, status }], pagination: {} } : { data: [], pagination: { cursor: 'page2' } }));
    const logs = [];
    await subscribe(['--apply'], { env, fetch: p.fetch, log: v => logs.push(v) });
    assert.equal(p.calls.filter(c => c.url.includes('/helix/')).length, 2);
    assert.equal(p.calls.filter(c => c.url.includes('/helix/') && c.method === 'POST').length, 0);
    assert.equal(JSON.parse(logs[0]).plan.status, status);
  }
});

test('webhook create uses extension condition and derived secret without logging it', async () => {
  const p = provider((_url, init) => response({ data: init.method === 'POST' ? [{ status: 'webhook_callback_verification_pending' }] : [] }));
  const logs = [];
  await subscribe(['--apply'], { env, fetch: p.fetch, log: v => logs.push(v) });
  const create = p.calls.find(c => c.url.includes('/helix/') && c.method === 'POST');
  const body = JSON.parse(create.body);
  assert.equal(body.transport.secret, webhookSecret(config.secret)); assert.equal(body.type, BITS_TYPE); assert.equal(body.version, '1');
  assert.deepEqual(body.condition, { extension_client_id: config.clientId });
  assert.ok(!logs.join('').includes(body.transport.secret)); assert.ok(!logs.join('').includes(token));
});

test('wrong callback, revoked subscription or a repeated cursor requires repair, never replacement', async () => {
  assert.equal(subscriptionPlan([{ ...hook, status: 'authorization_revoked' }], config.clientId, callbackUrl()).action, 'blocked');
  const p = provider(() => response({ data: [{ ...hook, transport: { method: 'webhook', callback: 'https://elsewhere.example/hook' } }] }));
  await assert.rejects(subscribe(['--apply'], { env, fetch: p.fetch, log: () => {} }), /operator review/);
  assert.equal(p.calls.filter(c => c.url.includes('/helix/') && c.method === 'POST').length, 0);
  const cycle = provider(() => response({ data: [], pagination: { cursor: 'same' } }));
  await assert.rejects(subscribe(['--inspect'], { env, fetch: cycle.fetch, log: () => {} }), /pagination/);
});

test('concurrent webhook creation conflict rechecks instead of creating again', async () => {
  let conflict = false;
  const p = provider((_url, init) => {
    if (init.method === 'POST') { conflict = true; return response({ message: token }, 409); }
    return response({ data: conflict ? [hook] : [] });
  });
  await subscribe(['--apply'], { env, fetch: p.fetch, log: () => {} });
  assert.equal(p.calls.filter(c => c.url.includes('/helix/') && c.method === 'POST').length, 1);
});
