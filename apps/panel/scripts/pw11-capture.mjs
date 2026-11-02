// PW11 evidence in the lane stack: a street coming alight as people arrive (by chat, by the panel's heartbeat and by a
// real tap on "Take your place"), painted after each arrival, and the You tab's privacy page: quiet, the forget
// confirmation, what was forgotten, and taking your place again. Real realm, gateway and painter on the isolated
// panel_window schema; the only substitute is the operator Helper, which signs real HS256 tokens. No Twitch writes.
//
//   chatdom-pc-lease --wait 30 --max 10 -- node --env-file=<lane env> --env-file=<twitch env> apps/panel/scripts/pw11-capture.mjs --gpu
//
// The paintings are lit for the evening (`--hour`, default 21.5) so the windows' glow reads; each painting keeps its
// real capture time. Without --gpu the stills come from headless Chrome under the shared capture lock. Never prints a secret.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URLSearchParams } from 'node:url';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { runPainter } from '../../web/src/panel-painter/runner.mjs';
import { sign } from '../harness/helper.mjs';
import { startPanelStack } from './pw10-stack.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const gpu = process.argv.includes('--gpu');
const only = (() => { const i = process.argv.indexOf('--only'); return i >= 0 ? new Set(process.argv[i + 1].split(',')) : null; })();
const wanted = name => !only || only.has(name);
const hour = (() => { const i = process.argv.indexOf('--hour'); return i >= 0 ? Number(process.argv[i + 1]) : 21.5; })();
if (!(hour >= 0 && hour < 24)) throw new Error('--hour takes a shared-clock hour in [0, 24).');
const evidence = join(root, 'work/evidence/panel-window/PW11', gpu ? 'gpu' : 'headless');
const env = process.env;
for (const key of ['REALM_ENTRY_KINGDOM_ID', 'TWITCH_EXTENSION_SECRET', 'REALM_INGRESS_PANEL_SECRET', 'REALM_INGRESS_HERALD_SECRET',
  'PANEL_PAINTER_SECRET', 'DATABASE_URL', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) if (!env[key]) throw new Error(`Missing ${key}; load the private lane and Twitch environment files.`);
const db = new URL(env.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(db.hostname) || db.port !== '5410' || env.REALM_DATABASE_SCHEMA !== 'panel_window') throw new Error('Capture requires the isolated panel_window development database.');
const kingdom = env.REALM_ENTRY_KINGDOM_ID;
const client = env.TWITCH_EXTENSION_CLIENT_ID || 'panel-lane';
const children = [], timers = [];
const abort = new globalThis.AbortController();
let REALM, GATEWAY, streamStarted = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const interrupt = async () => {
  abort.abort();
  setTimeout(() => process.exit(130), 8_000).unref();
  if (REALM && streamStarted) await herald({ kind: 'stream', live: false, sessionId: null }).catch(() => {});
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
};
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);

function free(port) {
  if (execFileSync('ss', ['-ltnH', `sport = :${port}`], { encoding: 'utf8' }).trim()) throw new Error(`Port ${port} is in use; stop its owner or wait.`);
}
const isFree = port => { try { free(port); return true; } catch { return false; } };
function choosePorts() {
  const found = [];
  for (const port of Array.from({ length: 17 }, (_, i) => 5170 + i)) if (!found.includes(port) && port !== 5192 && isFree(port)) { found.push(port); if (found.length === 2) break; }
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
  const until = Date.now() + 240_000, port = new URL(url).port;
  while (Date.now() < until && !abort.signal.aborted && child.exitCode === null) {
    if (new RegExp(`realm on ${port}:`).test(await readFile(log, 'utf8').catch(() => ''))) break;
    await delay(250);
  }
  while (Date.now() < until && !abort.signal.aborted && child.exitCode === null) {
    try { if ((await fetch(url, { signal: globalThis.AbortSignal.timeout(5_000) })).status < 500) return; } catch { /* starting */ }
    await delay(250);
  }
  throw new Error(`Service did not start at ${new URL(url).origin}.`);
}
async function post(url, bearer, body) {
  const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: globalThis.AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Request to ${new URL(url).pathname} failed (HTTP ${response.status}).`);
  return response.json();
}
/** Real public Twitch accounts, read once through Helix; only their ID and display name are used, in the lane realm only. */
async function twitchUsers(logins) {
  const token = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' }), signal: globalThis.AbortSignal.timeout(15_000) });
  if (!token.ok) throw new Error('Twitch app token lookup failed.');
  const { access_token: access } = await token.json();
  const users = await fetch(`https://api.twitch.tv/helix/users?${logins.map(login => `login=${encodeURIComponent(login)}`).join('&')}`,
    { headers: { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${access}` }, signal: globalThis.AbortSignal.timeout(15_000) });
  if (!users.ok) throw new Error('Twitch user lookup failed.');
  return (await users.json()).data.filter(user => /^\d+$/.test(user.id) && user.id !== kingdom).map(user => ({ id: user.id, name: user.display_name }));
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
    { version: 1, observation: { version: 1, id: `pw11-${randomUUID()}`, kingdomId: kingdom, observedAt: await realmNow() - 500, origin: 'live', ...observation } });
  if (answer.status !== 'accepted') throw new Error(`The ${observation.kind} observation was not accepted.`);
}
/** The person's own verified extension token, exactly as the Helper would hand the panel one. */
const jwt = person => sign(env.TWITCH_EXTENSION_SECRET, { channel_id: kingdom, opaque_user_id: `U${person}`, user_id: person, role: 'viewer',
  exp: Math.floor(Date.now() / 1000) + 600, pubsub_perms: { listen: ['broadcast'] } });
const gateway = (route, person, body = {}) => post(`${GATEWAY}/api/panel/v1/${route}`, jwt(person), body);
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

const record = [];
async function remember(entry) {
  record.push({ renderer: gpu ? 'real GPU (pc-lease)' : 'headless Chrome, SwiftShader', ...entry });
  await writeFile(join(evidence, 'capture.json'), JSON.stringify({ hour, record }, null, 2) + '\n');
}
let browser, origin;
async function openPanel(view, width, height, params) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  if (gpu) {
    const cdp = await context.newCDPSession(page);
    try {
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 10, top: 10, width: width + 24, height: Math.min(height + 140, 1000) } });
    } catch { /* A Chrome without windows still renders the page. */ } finally { await cdp.detach().catch(() => {}); }
  }
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
  await page.bringToFront().catch(() => {});
  await delay(250);
  const file = `${name}@${width}x${height}.png`;
  await page.screenshot({ path: join(evidence, file) });
  const facts = await page.evaluate(() => {
    const panel = document.querySelector('[data-chatdom-panel]');
    const count = element => (element?.innerText ?? '').split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
    const main = panel?.querySelector('.cw-main');
    const small = [...(panel?.querySelectorAll('*') ?? [])].filter(element => element.children.length === 0 && element.textContent.trim()
      && element.getClientRects().length && parseFloat(window.getComputedStyle(element).fontSize) < 12).map(element => element.textContent.trim().slice(0, 30));
    return { light: panel?.getAttribute('data-light'), view: panel?.getAttribute('data-view'), words: count(panel?.querySelector('.cw-head')) + count(main),
      scrolls: document.scrollingElement.scrollHeight > window.innerHeight + 1, small, text: (main?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) };
  });
  await remember({ file, note, at: new Date().toISOString(), ...facts });
  console.info(`${file}: ${facts.light}/${facts.view}, ${facts.words} words${facts.scrolls ? ', SCROLLS' : ''}${facts.small.length ? ', SMALL TEXT' : ''}`);
}

let secretDir, stack, lock = null, success = false;
try {
  const [realmPort, spare] = choosePorts();
  if (gpu) free(5192);
  const stackPort = gpu ? 5192 : spare;
  REALM = `http://127.0.0.1:${realmPort}`; GATEWAY = `http://127.0.0.1:${stackPort}`;
  await mkdir(evidence, { recursive: true });
  // A partial rerun keeps the other parts' records and replaces only its own.
  if (only) record.push(...(JSON.parse(await readFile(join(evidence, 'capture.json'), 'utf8').catch(() => '{"record":[]}')).record ?? [])
    .filter(entry => wanted('street') ? !('painting' in entry || 'arrival' in entry || String(entry.file ?? '').startsWith('street')) : !('forgot' in entry || 'rejoined' in entry || /^(privacy|forgotten|rejoined)/.test(String(entry.file ?? '')))));
  secretDir = await mkdtemp(join(tmpdir(), 'pw11-capture-'));
  const secretFile = join(secretDir, 'helper-secret');
  await writeFile(secretFile, env.TWITCH_EXTENSION_SECRET, { mode: 0o600 });
  // Evening paintings go to a throwaway store, never over the panel's real resting picture.
  env.PANEL_STILL_DIRECTORY = join(secretDir, 'stills');
  const people = await twitchUsers(['twitchdev', 'twitchrivals', 'twitchgaming', 'twitchmedia', 'twitchpresents', 'twitchmusic', 'twitchsupport', 'twitchsports']);
  if (people.length < 6) throw new Error('The capture needs six real Twitch accounts.');
  const [tapper, ...crowd] = people;
  const byChat = crowd.slice(0, 2), byPanel = crowd.slice(2, 4), quietOne = crowd[4];
  const realmLog = join(secretDir, 'realm.log');
  const realm = await start([join(root, 'apps/realm/dist/realm.mjs')], { ...env, REALM_PORT: String(realmPort), REALM_HOST: '127.0.0.1' }, realmLog);
  await ready(`${REALM}/readyz`, realm, realmLog);
  stack = await startPanelStack({ port: stackPort, gateway: 'in-process', realm: REALM, secretFile });
  origin = stack.origin;
  console.info(`PW11 stack: realm ${realmPort}; panel, gateway and painter ${stackPort}.`);

  const sessionId = `pw11-stream-${randomUUID()}`;
  const live = () => herald({ kind: 'stream', live: true, sessionId });
  await live(); streamStarted = true;
  timers.push(globalThis.setInterval(() => void live().catch(() => {}), 45_000));
  await waitFor(async () => (await realmKingdom()).stream === 'live', 'a live stream');
  // A run soon after another may find someone still lit; the realm dims them when their lease lapses.
  if (wanted('street') && (await realmKingdom()).lights > 0) {
    console.info('Someone is still lit from an earlier run; waiting for the realm to dim them.');
    await waitFor(async () => (await realmKingdom()).lights === 0, 'earlier lights to lapse', 150_000);
  }
  // Everyone already has a place, so each arrival only lights a window; claiming is not part of the street sequence.
  for (const person of [tapper, ...crowd]) {
    const answer = await gateway('light', person.id, { observe: false });
    if (!['deed', 'guest', 'castle'].includes(answer.status)) throw new Error(`${person.name} could not take their place (${answer.status}).`);
  }
  // Arrivals keep their light only while they are here: chat people keep chatting, panel people keep their panel open.
  const arrived = { chat: [], panel: [] };
  const renew = async () => {
    for (const person of arrived.chat) await herald({ kind: 'observe', source: 'chat', coverage: 'activity', people: [{ personId: person.id, disclosure: 'named', displayName: person.name }] });
    for (const person of arrived.panel) await gateway('presence', person.id);
  };
  timers.push(globalThis.setInterval(() => void renew().catch(error => console.error(`Renewal missed: ${String(error?.message ?? error).slice(0, 120)}`)), 40_000));

  const painterConfig = { webOrigin: origin, apiOrigin: GATEWAY, realmOrigin: REALM, kingdomIds: [kingdom],
    ingressSecret: env.REALM_INGRESS_PANEL_SECRET, uploadSecret: env.PANEL_PAINTER_SECRET, ...(gpu ? { cdpOrigin: 'http://127.0.0.1:9333' } : {}) };
  const painting = async stage => {
    const started = Date.now();
    const once = () => runPainter(painterConfig, { once: true, signal: abort.signal, evidenceDirectory: join(evidence, 'street', stage),
      report: line => console.info(`painter: ${line}`), acquireLock: async () => async () => {}, hour });
    let result = await once();
    if (result.painted !== 1) result = await once();
    if (result.painted !== 1) throw new Error(`The ${stage} painting was not captured and uploaded.`);
    const state = await realmKingdom();
    await remember({ at: new Date().toISOString(), painting: stage, lights: state.lights, ms: Date.now() - started });
    console.info(`Painting ${stage}: ${state.lights} lights.`);
  };
  lock = gpu ? async () => {} : await acquireCaptureLock();
  browser = await launch();

  if (wanted('street')) {
    // One open panel watches the whole evening from the Kingdom tab, the way a viewer under the video would.
    const watcher = await openPanel('panel', 318, 496, { identity: 'unshared', channel: kingdom, user: tapper.id, client });
    const seen = async (name, note) => {
      const before = await watcher.page.locator('img.cw-picture-image').getAttribute('src').catch(() => null);
      await watcher.page.waitForFunction(previous => { const img = document.querySelector('img.cw-picture-image'); return img && img.getAttribute('src') !== previous && img.complete; }, before, { timeout: 30_000 }).catch(() => {});
      await watcher.page.waitForFunction(() => !document.querySelector('.cw-picture-under, .cw-picture.settling'), null, { timeout: 15_000 }).catch(() => {});
      await delay(2_400); await shot(watcher.page, name, note);
    };
    await painting('01-dark'); await seen('street-01-dark', 'the street before anyone arrives');
    const lit = async (person, label) => {
      const start = Date.now();
      await waitFor(async () => (await realmPresence(person.id)).lit, `${person.name} lit by ${label}`, 15_000);
      await remember({ arrival: person.name, by: label, msToLit: Date.now() - start });
    };
    for (const person of byChat) {
      arrived.chat.push(person);
      await herald({ kind: 'observe', source: 'chat', coverage: 'activity', people: [{ personId: person.id, disclosure: 'named', displayName: person.name }] });
      await lit(person, 'chat');
    }
    await painting('02-chat'); await seen('street-02-chat', 'two neighbours arrive by chatting');
    for (const person of byPanel) { arrived.panel.push(person); await gateway('presence', person.id); await lit(person, 'panel heartbeat'); }
    await painting('03-panel'); await seen('street-03-panel', 'two more arrive with the panel open under the video');
    // A real tap, in a real panel, by the last arrival.
    const tap = await openPanel('panel', 318, 496, { identity: 'unshared', channel: kingdom, user: tapper.id, client, share: 'grant' });
    await tab(tap.page, 'You');
    const tapped = Date.now();
    await tap.page.getByRole('button', { name: 'Take your place' }).click();
    await tap.page.getByText('Your window is lit').waitFor({ timeout: 15_000 });
    await remember({ arrival: tapper.name, by: 'Take your place', msToLit: Date.now() - tapped, realmLit: (await realmPresence(tapper.id)).lit });
    arrived.panel.push(tapper);
    await painting('04-tap'); await seen('street-04-tap', 'a viewer takes their place: the street is alight');
    await tap.close();
    await tab(watcher.page, 'You'); await shot(watcher.page, 'street-watcher-you', 'the watching viewer has not shared');
    await watcher.close();
  }

  if (wanted('privacy')) {
    // Where the realm cannot renew consent yet, forget is permanent for these accounts in panel_window: run this part
    // only when that is acceptable, or after the renewal patch lands.
    if (!process.argv.includes('--forget-for-good') && !(await gateway('privacy', tapper.id).then(answer => answer.renewal === 'applied', () => false))) {
      throw new Error('The realm cannot renew consent after forget yet; pass --forget-for-good to forget these accounts permanently.');
    }
    // Quiet and forget for two people, one at each size, through the real panel and gateway.
    for (const [view, width, height, person] of [['panel', 318, 496, tapper], ['mobile', 390, 844, quietOne]]) {
      if (!arrived.panel.includes(person)) { await gateway('light', person.id); arrived.panel.push(person); }
      const panel = await openPanel(view, width, height, { identity: 'shared', channel: kingdom, user: person.id, client });
      const page = panel.page;
      await tab(page, 'You');
      await page.getByText('Your window is lit').waitFor({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Your privacy' }).click();
      await page.getByRole('button', { name: /Keep my name off the stream/ }).waitFor({ timeout: 10_000 });
      await shot(page, 'privacy', 'the privacy page, one tap below the You tab');
      await page.getByRole('button', { name: /Keep my name off the stream/ }).click();
      await page.getByText('Your window still lights.').waitFor({ timeout: 10_000 });
      await shot(page, 'privacy-quiet', 'quiet on: the light stays, the name leaves the stream');
      await page.getByRole('button', { name: /Forget me/ }).click();
      await shot(page, 'privacy-confirm', 'forget asks once, plainly');
      await page.getByRole('button', { name: 'Yes, forget me' }).click();
      await page.getByRole('heading', { name: 'Forgotten' }).waitFor({ timeout: 20_000 });
      arrived.panel.splice(arrived.panel.indexOf(person), 1);
      const dark = !(await realmPresence(person.id)).lit;
      await remember({ forgot: person.name, view, realmDark: dark });
      await shot(page, 'privacy-forgotten', `the realm says what it erased and what it kept; window dark: ${dark}`);
      await page.getByRole('button', { name: /Back to You/ }).click();
      await delay(400);
      // Until the shared presence rules carry renewed consent (PW11-RENEW-NEEDS.patch) the realm keeps the forget hold,
      // and the panel says so instead of offering a light it cannot give. That hold is durable in panel_window.
      if (await page.getByText('Your window stays dark').isVisible()) {
        await shot(page, 'forgotten-you', 'the realm cannot lift the forget hold yet: the window stays dark, no button');
        await remember({ rejoined: person.name, view, renewal: 'pending' });
        await panel.close();
        continue;
      }
      await shot(page, 'forgotten-you', 'the You tab offers Take your place again');
      const rejoined = Date.now();
      await page.getByRole('button', { name: 'Take your place' }).click();
      await page.getByText('Your window is lit').waitFor({ timeout: 15_000 });
      arrived.panel.push(person);
      await remember({ rejoined: person.name, view, msToLit: Date.now() - rejoined, realmLit: (await realmPresence(person.id)).lit });
      await shot(page, 'rejoined-you', 'taking your place again lights the same home');
      await panel.close();
    }
  }
  success = true;
  console.info(`PW11 captures saved under ${evidence}. Look at every image before accepting it.`);
} finally {
  for (const timer of timers) globalThis.clearInterval(timer);
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
