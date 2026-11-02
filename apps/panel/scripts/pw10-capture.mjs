// PW10 evidence in the lane stack: the panel's tabs and join states, the tap that takes a place and lights a window,
// and the painting before and after it. Everything runs against the real realm, gateway and painter on the isolated
// panel_window schema; the only substitute is the operator Helper, which signs real HS256 tokens.
//
//   node --env-file=<lane env> --env-file=<twitch env> apps/panel/scripts/pw10-capture.mjs [--gpu]
//
// Without --gpu the stills come from headless Chrome (SwiftShader) under the shared capture lock. With --gpu, run inside
// chatdom-pc-lease: the stack serves on the forwarded port 5192 and the stills come from the real-GPU Chrome.
// Ports: two free capture-safe ports, the realm's and the stack's (which hosts the gateway; 5192 with --gpu). Never prints a secret.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URLSearchParams } from 'node:url';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../packages/testing/capture-ports.mjs';
import { runPainter } from '../../web/src/panel-painter/runner.mjs';
import { startPanelStack } from './pw10-stack.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const gpu = process.argv.includes('--gpu');
const only = (() => { const i = process.argv.indexOf('--only'); return i >= 0 ? new Set(process.argv[i + 1].split(',')) : null; })();
const evidence = join(root, 'work/evidence/panel-window/PW10');
const env = process.env;
for (const key of ['REALM_ENTRY_KINGDOM_ID', 'TWITCH_EXTENSION_SECRET', 'REALM_INGRESS_PANEL_SECRET', 'REALM_INGRESS_HERALD_SECRET',
  'PANEL_PAINTER_SECRET', 'DATABASE_URL', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) if (!env[key]) throw new Error(`Missing ${key}; load the private lane and Twitch environment files.`);
const db = new URL(env.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(db.hostname) || db.port !== '5410' || env.REALM_DATABASE_SCHEMA !== 'panel_window') throw new Error('Capture requires the isolated panel_window development database.');
let REALM, GATEWAY, STACK_PORT;
const kingdom = env.REALM_ENTRY_KINGDOM_ID;
const SIZES = [['panel', 318, 496], ['mobile', 390, 844]];
const children = [], timers = [];
const abort = new globalThis.AbortController();
// An interrupted capture still stops every service it started; a queued lock wait cannot hold them open.
const interrupt = async () => {
  abort.abort();
  setTimeout(() => process.exit(130), 8_000).unref();
  if (REALM && streamStarted) await herald({ kind: 'stream', live: false, sessionId: null }).catch(() => {});
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(130), 3_000).unref();
};
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// A port is free only when nothing listens on it at any address: the realm binds every interface, and a wildcard
// bind can succeed beside another lane's loopback listener, which would then answer our requests.
function free(port) {
  const listeners = execFileSync('ss', ['-ltnH', `sport = :${port}`], { encoding: 'utf8' }).trim();
  if (listeners) throw new Error(`Port ${port} is in use; stop its owner or wait.`);
}
const isFree = port => { try { free(port); return true; } catch { return false; } };
/** Two free capture-safe ports: the realm and (unless the lease fixes it at 5192) the stack, which also hosts the gateway. */
function choosePorts() {
  const found = [];
  for (const port of [5198, 5199, ...CAPTURE_PORTS]) if (!found.includes(port) && isFree(port)) { found.push(port); if (found.length === 2) break; }
  if (found.length < 2) throw new Error('Two free capture-safe ports are needed; other lanes hold the rest.');
  return found;
}
async function start(args, variables, log) {
  const file = await open(log, 'w', 0o600);
  try {
    const child = spawn(process.execPath, args, { cwd: root, env: variables, stdio: ['ignore', file.fd, file.fd] });
    child.exited = new Promise(resolve => child.once('exit', resolve));
    children.push(child); return child;
  } finally { await file.close(); }
}
async function ready(url, child, log) {
  // While the realm boots it holds its port with a silent reservation socket and releases it only once every connection
  // to it has closed, so probing early can stall the boot itself. Wait for the realm's own listening line first.
  const until = Date.now() + 240_000, port = new URL(url).port;
  while (log && Date.now() < until && !abort.signal.aborted && child.exitCode === null) {
    if (new RegExp(`realm on ${port}:`).test(await readFile(log, 'utf8').catch(() => ''))) break;
    await delay(250);
  }
  while (Date.now() < until && !abort.signal.aborted && child.exitCode === null) {
    try { const response = await fetch(url, { signal: globalThis.AbortSignal.timeout(5_000) }); if (response.status < 500) return; } catch { /* starting */ }
    await delay(250);
  }
  throw new Error(`Service did not start at ${new URL(url).origin} (${child.exitCode === null ? `still starting after ${Math.round((Date.now() - until + 240_000) / 1000)} s` : `exited ${child.exitCode ?? child.signalCode}`}).`);
}
async function post(url, bearer, body) {
  const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: globalThis.AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Request to ${new URL(url).pathname} failed (HTTP ${response.status}).`);
  return response.json();
}
async function twitchIds(logins) {
  const token = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' }), signal: globalThis.AbortSignal.timeout(15_000) });
  if (!token.ok) throw new Error('Twitch app token lookup failed.');
  const { access_token: access } = await token.json();
  const users = await fetch(`https://api.twitch.tv/helix/users?${logins.map(login => `login=${encodeURIComponent(login)}`).join('&')}`,
    { headers: { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${access}` }, signal: globalThis.AbortSignal.timeout(15_000) });
  if (!users.ok) throw new Error('Twitch user lookup failed.');
  const found = new Map((await users.json()).data.map(user => [user.login, user.id]));
  return logins.map(login => { const id = found.get(login); if (!/^\d+$/.test(id ?? '')) throw new Error(`No Twitch user ${login}.`); return id; });
}
const realmKingdom = () => post(`${REALM}/internal/realm/panel/kingdom`, env.REALM_INGRESS_PANEL_SECRET, { kingdomId: kingdom });
const realmPresence = person => post(`${REALM}/internal/realm/panel/presence`, env.REALM_INGRESS_PANEL_SECRET, { kingdomId: kingdom, personId: person });
async function realmNow() {
  const response = await fetch(`${REALM}/api/realm/clock`, { signal: globalThis.AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error('Realm clock unavailable.');
  return Math.floor((await response.json()).serverTime);
}
async function herald(observation) {
  const answer = await post(`${REALM}/internal/realm/ingress`, env.REALM_INGRESS_HERALD_SECRET,
    { version: 1, observation: { version: 1, id: `pw10-${randomUUID()}`, kingdomId: kingdom, observedAt: await realmNow() - 500, origin: 'live', ...observation } });
  if (answer.status !== 'accepted') throw new Error(`The ${observation.kind} observation was not accepted.`);
}
// Cold kingdom reads on a shared host can take several seconds, so waits are generous.
async function waitFor(predicate, label, ms = 60_000) {
  const until = Date.now() + ms;
  let last = 'no answer';
  while (Date.now() < until && !abort.signal.aborted) {
    const value = await predicate().catch(error => { last = error instanceof Error ? error.message : 'failed'; return null; });
    if (value) return value; await delay(150);
  }
  throw new Error(`Timed out waiting for ${label} (${last}).`);
}

async function launch() {
  if (!gpu) return chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const version = await (await fetch('http://127.0.0.1:9333/json/version', { signal: globalThis.AbortSignal.timeout(4_000) })).json();
  const ws = new URL(version.webSocketDebuggerUrl); ws.host = '127.0.0.1:9333'; ws.protocol = 'ws:';
  return chromium.connectOverCDP(ws.href, { timeout: 10_000 });
}

// The record is saved after every entry and merged with earlier runs, so a partial run (`--only`, or one that ends
// while queued for the lock) keeps what it proved. An entry replaces the earlier one with the same still, painting or tap.
const record = [];
const key = entry => entry.file ?? (entry.painting ? `painting:${entry.painting}` : `tap:${entry.tap}`);
async function remember(entry) {
  record.push(entry);
  const path = join(evidence, 'capture.json');
  const earlier = await readFile(path, 'utf8').then(text => JSON.parse(text), () => null);
  const merged = new Map((Array.isArray(earlier?.record) ? earlier.record : []).map(item => [key(item), item]));
  for (const item of record) merged.set(key(item), { renderer: gpu ? 'real GPU (pc-lease)' : 'headless Chrome, SwiftShader', ...item });
  await writeFile(path, JSON.stringify({ record: [...merged.values()] }, null, 2) + '\n');
}
let browser, origin;
async function openPanel(view, width, height, params) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto(`${origin}/panel/${view}.html?${new URLSearchParams(params)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  return { page, close: () => context.close() };
}
async function tab(page, name) {
  await page.locator('.cw-nav button', { hasText: new RegExp(`^${name}$`) }).click();
  await page.waitForFunction(view => document.querySelector('[data-chatdom-panel]')?.getAttribute('data-view') === view, name.toLowerCase());
  await delay(250);
}
async function shot(page, name, note = '') {
  const { width, height } = page.viewportSize();
  await delay(200);
  const file = `${name}@${width}x${height}.png`;
  await page.screenshot({ path: join(evidence, file) });
  const facts = await page.evaluate(() => {
    const panel = document.querySelector('[data-chatdom-panel]');
    const count = element => (element?.innerText ?? '').split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
    const main = panel?.querySelector('.cw-main');
    const clipped = [...(panel?.querySelectorAll('*') ?? [])].filter(element => {
      const style = window.getComputedStyle(element);
      return element.children.length === 0 && element.textContent.trim() && style.overflow !== 'visible' && element.scrollWidth > element.clientWidth + 1;
    }).map(element => element.textContent.trim().slice(0, 40));
    const small = [...(panel?.querySelectorAll('*') ?? [])].filter(element => element.children.length === 0 && element.textContent.trim()
      && element.getClientRects().length && parseFloat(window.getComputedStyle(element).fontSize) < 12).map(element => element.textContent.trim().slice(0, 30));
    return { light: panel?.getAttribute('data-light'), view: panel?.getAttribute('data-view'),
      words: { head: count(panel?.querySelector('.cw-head')), main: count(main), nav: count(panel?.querySelector('.cw-nav')) },
      scrolls: document.scrollingElement.scrollHeight > window.innerHeight + 1 || (main ? main.scrollHeight > main.clientHeight + 1 : false),
      clipped, small, text: (main?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) };
  });
  await remember({ file, note, at: new Date().toISOString(), ...facts });
  console.info(`${file}: ${facts.light}/${facts.view}, ${facts.words.head + facts.words.main} words${facts.scrolls ? ', SCROLLS' : ''}${facts.clipped.length ? ', CLIPPED' : ''}`);
}
const wanted = name => !only || only.has(name);

let secretDir, stack, success = false, lock = null, streamStarted = false;
try {
  const [realmPort, stackPort] = choosePorts();
  if (gpu) free(5192);
  STACK_PORT = gpu ? 5192 : stackPort; REALM = `http://127.0.0.1:${realmPort}`; GATEWAY = `http://127.0.0.1:${STACK_PORT}`;
  await mkdir(evidence, { recursive: true });
  secretDir = await mkdtemp(join(tmpdir(), 'pw10-capture-'));
  const secretFile = join(secretDir, 'helper-secret');
  await writeFile(secretFile, env.TWITCH_EXTENSION_SECRET, { mode: 0o600 });
  const [tapper, held, waiting] = await twitchIds([env.PANEL_TAP_LOGIN || 'twitchdev', env.PANEL_HELD_LOGIN || 'twitch', env.PANEL_UNFOUNDED_LOGIN || 'twitchgaming']);
  if (new Set([tapper, held, waiting, kingdom]).size !== 4) throw new Error('The capture needs four distinct Twitch IDs.');
  const vars = { ...env, REALM_PORT: String(realmPort), REALM_HOST: '127.0.0.1' };
  const realmLog = join(secretDir, 'realm.log');
  const realm = await start([join(root, 'apps/realm/dist/realm.mjs')], vars, realmLog);
  await ready(`${REALM}/readyz`, realm, realmLog);
  stack = await startPanelStack({ port: STACK_PORT, gateway: 'in-process', realm: REALM, secretFile });
  origin = stack.origin;
  console.info(`PW10 stack: realm ${realmPort}; panel, gateway and painter ${STACK_PORT}.`);

  const sessionId = `pw10-stream-${randomUUID()}`;
  const live = () => herald({ kind: 'stream', live: true, sessionId });
  await live(); streamStarted = true;
  // The stream lease lasts 180 s. One slow answer under host load is not a lapse; three misses in a row would be.
  let missed = 0;
  timers.push(globalThis.setInterval(() => {
    live().then(() => { missed = 0; }, error => {
      missed += 1;
      console.error(`Stream heartbeat missed (${missed}/3): ${String(error?.message ?? error).split('\n')[0].slice(0, 160)}`);
      if (missed >= 3) abort.abort();
    });
  }, 45_000));
  await waitFor(async () => (await realmKingdom()).stream === 'live', 'a live stream').catch(async error => {
    const state = await realmKingdom().catch(() => null);
    throw new Error(`${error.message} Realm: ${state ? `${state.status} ${state.stream} streamLive=${state.presence?.streamLive} ${state.presence?.connection}` : 'unreadable'}.`);
  });
  // A run started soon after another finds the tapping viewer still lit; the realm dims them when the lease lapses.
  if ((await realmPresence(tapper)).lit) {
    console.info('The tapping viewer is still lit from an earlier run; waiting for the realm to dim them.');
    await waitFor(async () => !(await realmPresence(tapper)).lit, 'the earlier light to lapse', 150_000);
  }

  const painterConfig = { webOrigin: origin, apiOrigin: GATEWAY, realmOrigin: REALM, kingdomIds: [kingdom],
    ingressSecret: env.REALM_INGRESS_PANEL_SECRET, uploadSecret: env.PANEL_PAINTER_SECRET, ...(gpu ? { cdpOrigin: 'http://127.0.0.1:9333' } : {}) };
  const painting = async stage => {
    const started = Date.now();
    // The painter runs inside the capture's own hold on the shared lock instead of queueing again for each step.
    const once = () => runPainter(painterConfig, { once: true, signal: abort.signal, evidenceDirectory: join(evidence, 'painting', stage), report: line => console.info(`painter: ${line}`),
      acquireLock: async () => async () => {} });
    // A software renderer page can crash under host load; the live painter retries on its next pass, and so does this.
    let result = await once();
    if (result.painted !== 1) result = await once();
    if (result.painted !== 1) throw new Error(`The ${stage} painting was not captured and uploaded.`);
    await remember({ at: new Date().toISOString(), painting: stage, lights: (await realmKingdom()).lights, ms: Date.now() - started });
    console.info(`Painting ${stage} stored (${(await realmKingdom()).lights} lights).`);
  };
  // Hold one: the painting before the tap, the first states, the tap, and the painting while the window is lit.
  lock = await acquireCaptureLock();
  if (wanted('tap')) await painting('01-before');
  browser = await launch();

  const as = (identity, user, extra = {}) => ({ identity, channel: kingdom, user, client: env.TWITCH_EXTENSION_CLIENT_ID || 'panel-lane', ...extra });
  for (const [view, width, height] of SIZES) {
    if (wanted('states')) {
      const outside = await openPanel(view, width, height, { helper: 'none' });
      await shot(outside.page, 'outside-kingdom'); await tab(outside.page, 'You'); await shot(outside.page, 'outside-you'); await outside.close();
      const out = await openPanel(view, width, height, as('logged-out', tapper));
      await delay(800); await shot(out.page, 'logged-out-kingdom'); await tab(out.page, 'You'); await shot(out.page, 'logged-out-you'); await out.close();
      const unshared = await openPanel(view, width, height, as('unshared', tapper));
      await delay(800); await shot(unshared.page, 'unshared-kingdom'); await tab(unshared.page, 'You'); await shot(unshared.page, 'unshared-you');
      await tab(unshared.page, 'Gifts'); await shot(unshared.page, 'gifts-closed'); await unshared.close();
    }
    if (wanted('tap')) {
      // The gesture: Twitch's prompt stays open for the still, then the share is granted and the window must light.
      const tap = await openPanel(view, width, height, as('unshared', tapper, { share: 'hold' }));
      await tab(tap.page, 'You');
      await tap.page.getByRole('button', { name: 'Take your place' }).click();
      await tap.page.waitForFunction(() => window.__panelHarness.sharePrompt === true);
      await shot(tap.page, 'sharing-you', 'Twitch identity prompt open');
      const granted = Date.now();
      await tap.page.evaluate(() => window.__panelHarness.grantShare());
      await tap.page.getByText('Your window is lit').waitFor({ timeout: 10_000 });
      const ms = Date.now() - granted;
      const presence = await realmPresence(tapper);
      if (!presence.lit) throw new Error('The panel said lit but the realm does not.');
      await remember({ at: new Date().toISOString(), tap: `${width}x${height}`, msToLit: ms, realmLit: presence.lit });
      console.info(`Tap at ${width}x${height}: lit in ${ms} ms, realm confirms.`);
      await shot(tap.page, 'lit-you', `lit ${ms} ms after the share was granted`);
      await tab(tap.page, 'Kingdom');
      await tap.page.locator('img.cw-picture-image').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      if (view === 'panel') {
        // The next painting is made while this viewer is still here (the light burns only while they are present),
        // and this same open panel must show it at its next poll.
        await shot(tap.page, 'tap-kingdom-before', 'the panel still shows the painting from before the tap');
        const before = await tap.page.locator('img.cw-picture-image').getAttribute('src').catch(() => null);
        await waitFor(async () => (await realmKingdom()).lights >= 1, 'the lit window in the public frame');
        await painting('02-after');
        await tap.page.waitForFunction(previous => { const img = document.querySelector('img.cw-picture-image'); return img && img.getAttribute('src') !== previous && img.complete; }, before, { timeout: 30_000 });
        // The new painting dissolves in over the old one; one still mid-way, then the settled picture and its mark.
        await delay(700); await shot(tap.page, 'tap-kingdom-dissolve', 'the painting made after the tap rising out of the one before');
        await tap.page.waitForFunction(() => !document.querySelector('.cw-picture-under, .cw-picture.settling'), null, { timeout: 15_000 }).catch(() => {});
        await delay(2_200);
      }
      await shot(tap.page, 'lit-kingdom', view === 'panel' ? 'the painting made after the tap, shown by the same open panel' : '');
      await tap.page.getByRole('button', { name: 'Walk in ↗' }).click();
      await shot(tap.page, 'lit-walk-in', 'one tap deeper: the links that leave Twitch');
      await tab(tap.page, 'You');
      // Once the painting shows the window lit, the You tab's arch looks into it at that window.
      await tap.page.locator('.cw-window-view img').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      await delay(400); await shot(tap.page, 'lit-you-painted', 'the arch looks into the latest painting at the lit window');
      const card = tap.page.getByRole('button', { name: /Your citizen card/ });
      if (await card.count()) { await card.click(); await delay(600); await shot(tap.page, 'lit-card'); await tap.page.getByRole('button', { name: /Back to You/ }).first().click(); }
      await tab(tap.page, 'Gifts'); await shot(tap.page, 'lit-gifts');
      await tap.close();
    }
  }
  await browser.close(); browser = undefined; await lock(); lock = null;

  // Hold two: the remaining states.
  lock = await acquireCaptureLock();
  browser = await launch();
  for (const [view, width, height] of SIZES) {
    if (wanted('held')) {
      // Moderated: a timeout through the Herald's own ingress, then the hold is lifted again.
      await herald({ kind: 'remove', personId: held, reason: 'timeout', until: await realmNow() + 10 * 60_000 });
      const quiet = await openPanel(view, width, height, as('shared', held));
      await tab(quiet.page, 'You');
      const place = quiet.page.getByRole('button', { name: 'Take your place' });
      if (await place.count()) await place.click();
      await quiet.page.waitForFunction(() => document.querySelector('[data-chatdom-panel]')?.getAttribute('data-light') === 'held', null, { timeout: 15_000 });
      await shot(quiet.page, 'held-you'); await tab(quiet.page, 'Kingdom'); await shot(quiet.page, 'held-kingdom');
      await quiet.close();
      await herald({ kind: 'restore', personId: held });
    }
    if (wanted('unfounded')) {
      const land = await openPanel(view, width, height, { ...as('shared', tapper), channel: waiting });
      await delay(1500); await shot(land.page, 'unfounded-kingdom'); await tab(land.page, 'You'); await shot(land.page, 'unfounded-you');
      const pledge = land.page.getByRole('button', { name: 'Take your place' });
      if (await pledge.count()) { await pledge.click(); await land.page.getByText('Your tent waits').waitFor({ timeout: 10_000 }); }
      await shot(land.page, 'unfounded-pledged');
      await land.close();
    }
  }
  if (wanted('resting')) {
    globalThis.clearInterval(timers.pop());
    await herald({ kind: 'stream', live: false, sessionId: null });
    await waitFor(async () => (await realmKingdom()).stream === 'resting', 'a resting stream');
    for (const [view, width, height] of SIZES) {
      const rest = await openPanel(view, width, height, as('shared', tapper));
      await rest.page.locator('img.cw-picture-image').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      await shot(rest.page, 'resting-kingdom'); await tab(rest.page, 'You'); await shot(rest.page, 'resting-you'); await rest.close();
    }
  }
  if (wanted('reach')) {
    // Out of reach: both panels stay open while the realm stops; the next five-second poll must say so.
    const open = [];
    for (const [view, width, height] of SIZES) {
      const panel = await openPanel(view, width, height, as('shared', tapper));
      await panel.page.locator('img.cw-picture-image').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
      open.push(panel);
    }
    realm.kill('SIGTERM'); await realm.exited;
    for (const panel of open) {
      await panel.page.waitForFunction(() => document.querySelector('[data-chatdom-panel]')?.getAttribute('data-connection') === 'lost', null, { timeout: 20_000 });
      await shot(panel.page, 'reach-kingdom'); await tab(panel.page, 'You'); await shot(panel.page, 'reach-you'); await panel.close();
    }
  }
  success = true;
  console.info(`PW10 captures saved under ${evidence}. Look at every image before accepting it.`);
} finally {
  for (const timer of timers) globalThis.clearInterval(timer);
  // End the lane stream session rather than leaving it to lapse.
  if (REALM && streamStarted) await herald({ kind: 'stream', live: false, sessionId: null }).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (lock) await lock().catch(() => {});
  if (stack) await stack.close().catch(() => {});
  for (const child of [...children].reverse()) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.all(children.map(child => child.exited));
  if (secretDir) {
    await rm(join(secretDir, 'helper-secret'), { force: true });
    if (success) await rm(secretDir, { recursive: true, force: true });
    else console.error(`Private diagnostic logs retained in ${secretDir}.`);
  }
}
