// Run only while holding the real-GPU lease and forwarding Chrome to 127.0.0.1:9333.
// Load the private lane and Twitch environments externally; never print their contents.
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, request as proxyRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URLSearchParams } from 'node:url';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { sign } from '../harness/helper.mjs';
import { runPainter } from '../../web/src/panel-painter/runner.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = join(root, 'work/evidence/panel-window/PW11');
const env = process.env;
const required = ['REALM_ENTRY_KINGDOM_ID', 'PANEL_TEST_USER', 'TWITCH_EXTENSION_SECRET', 'REALM_INGRESS_PANEL_SECRET',
  'REALM_INGRESS_HERALD_SECRET', 'PANEL_PAINTER_SECRET', 'DATABASE_URL', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'];
for (const key of required) if (!env[key]) throw new Error(`Missing ${key}; load the private lane and Twitch environment files.`);
const db = new URL(env.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(db.hostname) || db.port !== '5410' || env.REALM_DATABASE_SCHEMA !== 'panel_window') throw new Error('Capture requires the isolated panel_window development database.');
const kingdom = env.REALM_ENTRY_KINGDOM_ID;
const children = [];
const controller = new globalThis.AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function checkFree(port) {
  const server = createNetServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}
async function start(args, cwd, variables, logPath) {
  const log = await open(logPath, 'w', 0o600);
  try {
    const child = spawn(process.execPath, args, { cwd, env: variables, stdio: ['ignore', log.fd, log.fd] });
    child.once('error', () => controller.abort()); children.push(child); return child;
  } finally { await log.close(); }
}
async function ready(url, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !controller.signal.aborted && child.exitCode === null) {
    try { const response = await fetch(url, { signal: globalThis.AbortSignal.timeout(1_000) }); if (response.status < 500) return; } catch { /* Retry until the service is ready. */ }
    await delay(250);
  }
  throw new Error(`Service did not start at ${new URL(url).origin}.`);
}
async function post(url, bearer, body) {
  const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: globalThis.AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Request to ${new URL(url).pathname} failed (HTTP ${response.status}).`);
  return response.json();
}
async function secondUser() {
  if (env.PANEL_TEST_USER_2) return env.PANEL_TEST_USER_2;
  const token = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' }), signal: globalThis.AbortSignal.timeout(15_000) });
  if (!token.ok) throw new Error('Twitch app token lookup failed.');
  const credentials = await token.json();
  const user = await fetch('https://api.twitch.tv/helix/users?login=twitch', { headers: { 'Client-Id': env.TWITCH_CLIENT_ID,
    Authorization: `Bearer ${credentials.access_token}` }, signal: globalThis.AbortSignal.timeout(15_000) });
  if (!user.ok) throw new Error('Twitch user lookup failed.');
  const body = await user.json();
  if (!/^\d+$/.test(body.data?.[0]?.id ?? '')) throw new Error('Twitch user lookup returned no real person.');
  return body.data[0].id;
}
function viewerToken(user) {
  return sign(env.TWITCH_EXTENSION_SECRET, { channel_id: kingdom, opaque_user_id: 'Ulaneviewer', role: 'viewer',
    exp: Math.floor(Date.now() / 1_000) + 3_600, pubsub_perms: { listen: ['broadcast'], send: [] }, user_id: user });
}
async function realmSnapshot() {
  return post('http://127.0.0.1:5172/internal/realm/panel/kingdom', env.REALM_INGRESS_PANEL_SECRET, { kingdomId: kingdom });
}
async function waitFor(predicate, label, ms = 8_000) {
  const end = Date.now() + ms;
  while (Date.now() < end && !controller.signal.aborted) { const value = await predicate(); if (value) return value; await delay(100); }
  throw new Error(`Timed out waiting for ${label}.`);
}
let proxy, secretDir, success = false, heartbeatError;
const heartbeatTimers = [], pendingHeartbeats = new Set();
function heartbeat(interval, action, label) {
  const timer = globalThis.setInterval(() => {
    if (controller.signal.aborted) return;
    const task = action().catch(() => {
      heartbeatError ??= new Error(`${label} heartbeat failed.`);
      controller.abort();
    }).finally(() => pendingHeartbeats.delete(task));
    pendingHeartbeats.add(task);
  }, interval);
  heartbeatTimers.push(timer);
}
function assertHeartbeats() { if (heartbeatError) throw heartbeatError; if (controller.signal.aborted) throw new Error('Capture interrupted.'); }
async function pcShot(url, path) {
  await new Promise((resolve, reject) => execFile('chatdom-pc', ['shot', url, path, '--size', '318x496', '--timeout', '90', '--settle', '4'],
    { timeout: 100_000 }, error => error ? reject(new Error('chatdom-pc shot failed.')) : resolve()));
}
try {
  for (const port of [5182, 5183, 5184, 5191, 5192]) await checkFree(port);
  const person2 = await secondUser();
  const people = [env.PANEL_TEST_USER, person2];
  if (people.some(id => !/^\d+$/.test(id)) || new Set(people).size !== 2) throw new Error('Two distinct real Twitch user IDs are required.');
  secretDir = await mkdtemp(join(tmpdir(), 'pw11-capture-'));
  const secretFile = join(secretDir, 'helper-secret');
  await writeFile(secretFile, env.TWITCH_EXTENSION_SECRET, { mode: 0o600 });
  const vars = { ...env, PANEL_GATEWAY_PORT: '5191', PUBLIC_REALM_TARGET: 'http://127.0.0.1:5172',
    CHATDOM_API_TARGET: 'http://127.0.0.1:5191', CHATDOM_REALM_TARGET: 'http://127.0.0.1:5172',
    VITE_CHATDOM_ORIGIN: 'http://localhost:5192', PANEL_UPSTREAM: 'http://127.0.0.1:5184', PANEL_HARNESS_PORT: '5192', PANEL_HARNESS_SECRET_FILE: secretFile };
  const gateway = await start([join(root, 'apps/api/src/panel/serve.mjs')], root, vars, join(secretDir, 'gateway.log'));
  await ready('http://127.0.0.1:5191/api/panel/v1/kingdom', gateway);
  const web = await start([join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5182', '--strictPort'], join(root, 'apps/web'), vars, join(secretDir, 'web.log'));
  await ready('http://127.0.0.1:5182/-/panel-painter', web);
  const panel = await start([join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5183', '--strictPort', '--base', '/panel/'], join(root, 'apps/panel'), vars, join(secretDir, 'panel.log'));
  await ready('http://127.0.0.1:5183/panel/panel.html', panel);
  proxy = createHttpServer((req, res) => {
    const port = req.url?.startsWith('/panel/') ? 5183 : 5182;
    const upstream = proxyRequest({ hostname: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(5184, '127.0.0.1', resolve); });
  const harness = await start([join(root, 'apps/panel/scripts/pw10-harness.mjs')], root, vars, join(secretDir, 'harness.log'));
  await ready('http://127.0.0.1:5192/-/panel-painter', operator);

  const tokens = people.map(viewerToken);
  for (const token of tokens) {
    const claim = await post('http://127.0.0.1:5191/api/panel/v1/light', token, { observe: false });
    if (claim.status !== 'deed') throw new Error(`Expected a street home for each viewer; realm answered ${claim.status}.`);
  }
  const sessionId = `pw11-stream-${randomUUID()}`;
  async function refreshStream() {
    const clockResponse = await fetch('http://127.0.0.1:5172/api/realm/clock', { signal: globalThis.AbortSignal.timeout(5_000) });
    if (!clockResponse.ok) throw new Error('Realm clock unavailable.');
    const now = (await clockResponse.json()).serverTime;
    const stream = await post('http://127.0.0.1:5172/internal/realm/ingress', env.REALM_INGRESS_HERALD_SECRET, { version: 1,
      observation: { version: 1, id: `pw11-stream-${randomUUID()}`, kingdomId: kingdom, observedAt: Math.floor(now) - 500,
        origin: 'live', kind: 'stream', live: true, sessionId } });
    if (stream.status !== 'accepted') throw new Error('The stream observation was not accepted.');
  }
  await refreshStream();
  heartbeat(45_000, refreshStream, 'Stream');
  await waitFor(async () => (await realmSnapshot()).stream === 'live', 'live stream');
  const baseline = await realmSnapshot();
  if (baseline.status !== 'kingdom' || !baseline.presence || baseline.lights !== 0) throw new Error('The initial kingdom must have zero lit windows; wait for earlier leases to expire.');
  const config = { webOrigin: 'http://localhost:5192', apiOrigin: 'http://127.0.0.1:5191', realmOrigin: 'http://127.0.0.1:5172',
    cdpOrigin: 'http://127.0.0.1:9333', kingdomIds: [kingdom], ingressSecret: env.REALM_INGRESS_PANEL_SECRET, uploadSecret: env.PANEL_PAINTER_SECRET };
  async function painting(stage) {
    const result = await runPainter(config, { once: true, signal: controller.signal, evidenceDirectory: join(evidence, stage) });
    assertHeartbeats();
    if (result.painted !== 1 || result.unavailable) throw new Error(`Could not capture ${stage} painting.`);
  }
  await painting('01-before');
  for (const [index, token] of tokens.entries()) {
    const result = await post('http://127.0.0.1:5191/api/panel/v1/light', token, { observe: true });
    if (result.status !== 'deed' || result.lit !== true) throw new Error(`Viewer ${index + 1} did not receive a lit deed.`);
    heartbeat(60_000, async () => {
      const renewal = await post('http://127.0.0.1:5191/api/panel/v1/presence', token, {});
      if (renewal.status !== 'accepted' || renewal.lit !== true) throw new Error('Presence not renewed.');
    }, `Viewer ${index + 1}`);
    await waitFor(async () => (await realmSnapshot()).lights === index + 1, `window ${index + 1} in the public frame`);
    await painting(index === 0 ? '02-first-window' : '03-second-window');
  }
  const version = await fetch('http://127.0.0.1:9333/json/version', { signal: globalThis.AbortSignal.timeout(4_000) });
  if (!version.ok) throw new Error('The GPU Chrome tunnel is unavailable.');
  const ws = new URL((await version.json()).webSocketDebuggerUrl);
  if (!['ws:', 'wss:'].includes(ws.protocol) || !ws.pathname.startsWith('/devtools/browser/')) throw new Error('The GPU tunnel did not return Chrome.');
  ws.host = '127.0.0.1:9333'; ws.protocol = 'ws:';
  const release = await acquireCaptureLock();
  let browser;
  try {
    const shotParams = new URLSearchParams({ identity: 'shared', channel: kingdom, user: people[0], client: env.TWITCH_EXTENSION_CLIENT_ID || 'panel-lane' });
    await pcShot(`http://localhost:5192/harness/panel/panel.html?${shotParams}`, join(evidence, 'kingdom-pc-shot@318x496.png'));
    assertHeartbeats();
    browser = await chromium.connectOverCDP(ws.href, { timeout: 10_000 });
    for (const [view, width, height] of [['panel', 318, 496], ['mobile', 390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      try {
        const page = await context.newPage();
        const params = new URLSearchParams({ identity: 'shared', channel: kingdom, user: people[0], client: env.TWITCH_EXTENSION_CLIENT_ID || 'panel-lane' });
        await page.bringToFront();
        await page.goto(`http://localhost:5192/harness/panel/${view}.html?${params}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
        await page.locator('.cw-picture img').first().waitFor({ state: 'visible', timeout: 30_000 });
        await page.bringToFront();
        await page.screenshot({ path: join(evidence, `kingdom@${width}x${height}.png`) });
        await page.getByRole('button', { name: 'You', exact: true }).click();
        await page.getByRole('button', { name: /privacy/i }).click();
        await page.getByRole('button', { name: /Keep my name off the stream/ }).waitFor({ timeout: 15_000 });
        const quiet = page.getByRole('button', { name: /Keep my name off the stream/ });
        await page.screenshot({ path: join(evidence, `privacy@${width}x${height}.png`) });
        const wasQuiet = await quiet.getAttribute('aria-pressed') === 'true';
        if (!wasQuiet) await quiet.click();
        await page.getByText('Preference saved; stream update pending.').waitFor({ timeout: 15_000 });
        await page.screenshot({ path: join(evidence, `quiet-pending@${width}x${height}.png`) });
        if (!wasQuiet) { await quiet.click(); await waitFor(async () => await quiet.getAttribute('aria-pressed') === 'false', 'quiet preference restoration'); }
      } finally { await context.close(); }
    }
  } finally { await browser?.close(); await release(); }
  for (const timer of heartbeatTimers) globalThis.clearInterval(timer);
  await Promise.all([...pendingHeartbeats]);
  assertHeartbeats();
  success = true;
  console.log(`PW11 captures saved under ${evidence}. Inspect every image before accepting them.`);
} finally {
  for (const timer of heartbeatTimers) globalThis.clearInterval(timer);
  await Promise.all([...pendingHeartbeats]);
  for (const child of [...children].reverse()) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.all(children.map(child => child.exitCode !== null ? undefined : new Promise(resolve => child.once('exit', resolve))));
  if (proxy) await new Promise(resolve => proxy.close(resolve));
  if (secretDir) {
    await rm(join(secretDir, 'helper-secret'), { force: true });
    if (success) await rm(secretDir, { recursive: true, force: true });
    else console.error(`Private diagnostic logs retained in ${secretDir}.`);
  }
}
