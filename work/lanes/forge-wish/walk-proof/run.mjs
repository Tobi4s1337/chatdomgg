// FW10 walk proof: a signed-in citizen types a wish into the real Forge wish box at the anvil, in the real kingdom walk
// of a served production build, and it becomes a piece in a durable realm (schema realm_forge_wish).
// SIMULATED: sign-in (the realm-auth SIMULATED provider) and Twitch chat (the Forge chat service's fetch). See README.md.
//
// REALM_DATABASE_SCHEMA=realm_forge_wish nice -n 10 node --env-file=/srv/chatdom/chatdomgg/.env \
//   work/lanes/forge-wish/walk-proof/run.mjs [--controlled | --real] [fw10-01 fw10-08 fw10-15]
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { createServer as createPortProbe } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { startWalkRealm, SCHEMA } from './realm.mjs';
import { buildWeb, serveWeb, walkProofPlugin } from './web.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
// AGENTS.md: 5170-5199 without 5187 and the capture-reserved 5190-5197; 5172, 5198 and 5199 are probed by another process.
const LANE_PORTS = [5170, 5171, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5182, 5183, 5184, 5185, 5186, 5188, 5189];
const LOCK_BUDGET_MS = 285_000; // each capture-lock hold stays under five minutes
// The host's capture guard (ops/bin/capture-guard) times a lane's hold from the moment its lock supervisor
// started, so queue time counts: past 10 min with main waiting (12 with two lanes) it stops the whole caller. A wait
// is therefore cut at QUEUE_LIMIT_MS and queued again, and every hold ends GUARD_MARGIN_MS before the 10-minute mark.
const QUEUE_LIMIT_MS = 5 * 60_000, GUARD_HOLD_MS = 10 * 60_000, GUARD_MARGIN_MS = 45_000;
const PORT_WAIT_MS = 45_000, PORT_ATTEMPTS = 20; // waiting for a busy host's lane port, inside and between holds
const SERVER_WAIT_MS = 12 * 60_000; // a real wish still forging after its cycle, waited for with no lock or port held
const STATUS_TITLES = { 'Sending your wish': 'sending', 'Still checking': 'unknown', 'Not sent': 'not-sent', 'Sent to chat': 'sent',
  'At the Forge': 'working', 'Made in the kingdom': 'delivered', 'Your wish is on hold': 'held', 'This wish could not be made': 'refused',
  'The Forge is resting': 'cold', 'Wish closed': 'canceled' };
const FINAL = new Set(['delivered', 'held', 'refused', 'cold', 'canceled', 'not-sent']);
const DEFAULT_WISHES = ['fw10-01', 'fw10-08', 'fw10-15'];

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg.startsWith('--') && !['--controlled', '--real', '--landed-still'].includes(arg));
if (unknown.length || (args.includes('--controlled') && args.includes('--real'))) throw new Error('Use --controlled (default) or --real, then optional fw10 wish ids.');
const mode = args.includes('--real') ? 'real' : 'controlled';
const landedStills = args.includes('--landed-still');
const wishIds = args.filter(arg => !arg.startsWith('--'));
if (!process.env.DATABASE_URL || process.env.REALM_DATABASE_SCHEMA !== SCHEMA) {
  throw new Error(`Load DATABASE_URL privately with node --env-file and set REALM_DATABASE_SCHEMA=${SCHEMA}.`);
}

// No request from this process may reach Twitch. The Forge chat service is given simulated Twitch explicitly; this
// guard turns any other attempt into a failure instead of a call.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const href = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
  try { if (/(^|\.)twitch\.tv$/i.test(new URL(href).hostname)) return Promise.reject(new Error('Walk proof: Twitch is simulated here.')); }
  catch { /* relative or invalid URLs fall through to fetch's own error */ }
  return nativeFetch(input, init);
};

const runId = randomUUID();
const directory = join('/tmp/chatdom-forge-wish', `walk-proof-${runId}`);
await mkdir('/tmp/chatdom-forge-wish', { recursive: true });
await mkdir(directory, { mode: 0o700 }); await chmod(directory, 0o700);
const summary = { version: 1, run: runId, mode, origin: 'simulated', schema: SCHEMA, started: new Date().toISOString(), stage: 'start',
  wishes: [], cycles: [], pageErrors: 0, ok: false };
let loader, realm, release, webPort, browser, web, page, finished = false, closing;
const writePrivate = (name, value) => writeFile(join(directory, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2), { mode: 0o600 });
const say = line => console.log(`[walk-proof] ${line}`);
let heldSince = null; // inside a lock hold, progress lines carry the seconds since the lock was acquired
const stage = name => { summary.stage = name; say(heldSince === null ? name : `${name} (+${Math.round((Date.now() - heldSince) / 1000)} s)`); };
const redact = text => realm?.redact(text) ?? String(text);

const closeCycle = async () => {
  page = undefined;
  await browser?.close().catch(() => {}); browser = undefined;
  await web?.close().catch(() => {}); web = undefined;
  const unlock = release; release = undefined; await unlock?.();
};
const cleanup = () => closing ??= (async () => {
  await closeCycle();
  await realm?.stop().catch(() => {});
  await loader?.close().catch(() => {});
  if (realm) Object.assign(summary, { facts: { ...realm.facts, observations: realm.facts.observations.length, heralds: realm.facts.heralds.length } });
  await writePrivate('summary.json', summary).catch(() => {});
})();
// `on`, not `once`: a second signal during cleanup must not fall through to the default exit before Chrome and the lock close.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { summary.interrupted ??= signal; void cleanup().finally(() => process.exit(130)); });
process.once('beforeExit', () => { if (!finished) { console.error(`[walk-proof] stopped without a result at: ${summary.stage}`); process.exitCode = 1; } });

const freePort = (port) => new Promise(resolve => {
  const probe = createPortProbe();
  probe.once('error', () => resolve(false));
  probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => probe.close(() => resolve(true)));
});
/** The first cycle chooses the web port; later cycles reuse it (the sign-in issuer and Forge chat origin are bound to it). */
async function waitForPort(until) {
  for (;;) {
    for (const port of webPort ? [webPort] : LANE_PORTS) if (await freePort(port)) return port;
    if (Date.now() >= until) return null;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
// SwiftShader on a loaded host renders a frame in seconds at 1440x900. The walk runs at the 390x844 target size, so
// the per-wish still needs no resize; only the first wish's optional 1440x900 still resizes (and lays out again).
const WALK_VIEWPORT = { width: 390, height: 844 };
const frames = page => page.evaluate(() => window.__chatdomWalk?.frames ?? 0);
/** Wait until the walk has stepped `count` more frames, so input sent before this call has been applied and read. */
async function afterFrames(page, count, timeout = 90_000) {
  const start = await frames(page);
  await page.waitForFunction(([start, count]) => (window.__chatdomWalk?.frames ?? 0) >= start + count, [start, count], { timeout, polling: 200 });
}
// Each page round trip waits for the renderer's main thread, which spends seconds per frame here: keep them few.
const shot = async (page, name, size = WALK_VIEWPORT) => {
  const resize = size.width !== WALK_VIEWPORT.width || size.height !== WALK_VIEWPORT.height;
  if (resize) await page.setViewportSize(size);
  await afterFrames(page, resize ? 2 : 1, 120_000); await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(directory, name), timeout: 120_000 });
  if (resize) await page.setViewportSize(WALK_VIEWPORT);
  return name;
};

/** One capture-lock hold: the web port, served build and Chrome exist only inside it. */
async function cycle(label, work) {
  for (let attempt = 1; ; attempt++) {
    stage(`${label}: waiting for the capture lock`);
    let queuedAt;
    for (release = undefined; !release;) {
      queuedAt = Date.now();
      const requeue = new AbortController(), timer = setTimeout(() => requeue.abort(), QUEUE_LIMIT_MS);
      try { release = await acquireCaptureLock({ priority: 'lane', signal: requeue.signal }); }
      catch (error) { if (!requeue.signal.aborted) throw error; say(`${label}: queued ${QUEUE_LIMIT_MS / 60_000} min; queueing again (the host guard counts queue time)`); }
      finally { clearTimeout(timer); }
    }
    const lockedAt = heldSince = Date.now(), record = { label, port: null, seconds: null, queued: Math.round((lockedAt - queuedAt) / 1000) };
    summary.cycles.push(record);
    let timer;
    try {
      const port = await waitForPort(lockedAt + PORT_WAIT_MS);
      if (!port) {
        record.noPort = true;
        if (attempt >= PORT_ATTEMPTS) throw new Error('Walk proof: no free lane port for the web server.');
        continue;
      }
      webPort = record.port = port;
      const origin = `http://127.0.0.1:${port}`;
      webState.auth = await realm.open(origin);
      web = await serveWeb(repo, plugin, outDir, cacheDir, port);
      browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
      const deadline = Math.min(lockedAt + LOCK_BUDGET_MS, queuedAt + GUARD_HOLD_MS - GUARD_MARGIN_MS);
      const working = work({ origin, deadline });
      working.catch(() => {}); // a budget stop closes Chrome under it; its late rejection is expected
      try {
        return await Promise.race([working, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Walk proof: ${label} reached the capture-lock budget.`)), Math.max(1000, deadline - Date.now() - 15_000));
        })]);
      } catch (error) {
        await diagnose(label.replace(/[^a-z0-9-]+/gi, '-')).catch(() => {});
        throw error;
      }
    } finally {
      clearTimeout(timer);
      await closeCycle();
      record.seconds = Math.round((Date.now() - lockedAt) / 1000); heldSince = null;
      say(`${label}: released the capture lock after ${record.seconds} s${record.noPort ? ' (no free port; queueing again in a minute)' : ''}`);
      if (record.noPort && attempt < PORT_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, 60_000));
    }
  }
}

/** On a failed cycle: one screenshot and the page's state, in the private directory (wish words redacted). */
async function diagnose(name) {
  if (!page || page.isClosed()) return;
  const state = await Promise.race([page.evaluate(() => {
    const walk = window.__chatdomWalk, kingdom = window.__chatdomKingdom;
    return { path: location.pathname + location.search, ready: window.__chatdomReady ?? null,
      walk: walk ? { ready: walk.ready, owner: walk.owner, frames: walk.frames, self: walk.self, authority: walk.authority ?? null } : null,
      action: kingdom?.interactionDebug?.()?.action ?? null, text: document.body.innerText.slice(0, 1500) };
  }), new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 10_000))]).catch(error => ({ error: String(error?.message ?? error) }));
  if (state.text) state.text = redact(state.text);
  await writePrivate(`failure-${name}.json`, { stage: summary.stage, state, trail: pageTrail });
  await page.screenshot({ path: join(directory, `failure-${name}.png`), timeout: 15_000 }).catch(() => {});
  say(`${name}: failure state written to the private directory`);
}
let pageTrail = [];
async function openPage(origin, person) {
  const context = await browser.newContext({ viewport: WALK_VIEWPORT, deviceScaleFactor: 1 });
  await context.route(/^https?:\/\/([^/]+\.)?twitch\.tv(\/|$)/, route => route.abort());
  await context.routeWebSocket(/\/(?:realm-data|forge-data|map-data|presence-data)(?:\/|$)/, ws => ws.close());
  page = await context.newPage();
  pageTrail = [];
  const note = item => { if (pageTrail.length < 120) pageTrail.push({ at: Math.round(performance.now()), ...item }); };
  const pathOf = url => { try { return new URL(url).pathname; } catch { return '?'; } };
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) note({ console: message.type(), text: redact(message.text()).slice(0, 300) }); });
  page.on('response', response => { if (response.status() >= 400) note({ status: response.status(), path: pathOf(response.url()) }); });
  page.on('requestfailed', request => note({ failed: pathOf(request.url()), reason: request.failure()?.errorText ?? null }));
  page.on('websocket', socket => { note({ websocket: pathOf(socket.url()) }); socket.on('close', () => note({ websocketClosed: pathOf(socket.url()) })); });
  page.on('pageerror', error => { summary.pageErrors++; (summary.pageErrorSamples ??= []).length < 8 && summary.pageErrorSamples.push(redact(error.message).slice(0, 300)); });
  stage('sign in as the wish\'s citizen (SIMULATED provider)');
  await page.goto(`${origin}/?walk=1&kingdom=${realm.kingdomId}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  // The real sign-in: the entry's own link, the SIMULATED provider's chooser, the realm-auth callback and session.
  const link = page.getByRole('link', { name: 'Sign in with Twitch' });
  await link.waitFor({ timeout: 180_000 });
  await link.click();
  await page.waitForURL(/\/api\/realm\/simulated-oidc\/authorize/, { timeout: 60_000 });
  await page.evaluate(personId => { document.querySelector('button[name="person"]').value = personId; }, person.personId);
  await Promise.all([page.waitForURL(url => url.pathname === '/' && url.searchParams.get('walk') === '1', { timeout: 60_000 }),
    page.locator('button[name="person"]').first().click()]);
  stage('signed in; waiting for the kingdom walk');
  await page.waitForFunction(() => window.__chatdomReady === true && window.__chatdomWalk?.ready === true && window.__chatdomWalk.owner === 'walking',
    null, { timeout: 200_000, polling: 500 });
  const before = await frames(page), at = Date.now();
  await page.waitForTimeout(4000);
  stage(`walking in the kingdom (${((await frames(page) - before) / ((Date.now() - at) / 1000)).toFixed(1)} frames/s)`);
  return page;
}

const walk = page => page.evaluate(() => {
  const d = window.__chatdomWalk;
  return d && { selfId: d.selfId, owner: d.owner, self: d.self, yaw: d.camera.yaw, height: d.viewport.height,
    action: window.__chatdomKingdom?.interactionDebug()?.action ?? null };
});
/** A real mouse drag on the canvas: as few events as possible, since each one waits for a slow frame. */
async function drag(page, pixels) {
  const box = await page.locator('canvas').first().boundingBox();
  // Inside the middle of the canvas, clear of the HUD in the corners (a press there never reaches the walk).
  const x = box.x + box.width * .5, y = box.y + box.height * .55, span = box.width * .5;
  for (let left = pixels; Math.abs(left) > .5;) {
    const step = Math.max(-span, Math.min(span, left)); left -= step;
    await page.mouse.move(x - step / 2, y); await page.mouse.down();
    await page.mouse.move(x + step / 2, y, { steps: 2 }); await page.mouse.up();
  }
}
/** Turn the camera with a real drag until the walker's own interaction focus is `want`. */
async function face(page, target, want) {
  const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  const trail = (summary.facing ??= []), mark = (step, now, desired, seen) => trail.length < 80 && trail.push({ want, step,
    x: +now.self.x.toFixed(2), z: +now.self.z.toFixed(2), yaw: +now.yaw.toFixed(3), desired: +desired.toFixed(3), action: seen, at: summary.stage });
  for (let i = 0; i < 6; i++) {
    const now = await walk(page), seen = now.action;
    const desired = Math.atan2(target[0] - now.self.x, target[2] - now.self.z), error = wrap(desired - now.yaw);
    mark(i, now, desired, seen);
    if (seen === want) return true;
    if (Math.abs(error) < .05) break;
    // Dragging right turns the view right: yaw -= dx / height * 2.6 (apps/web/src/walk/camera/shoulder.ts).
    await drag(page, -error * now.height / 2.6);
    await afterFrames(page, 2);
  }
  for (let i = 0; i < 48; i++) { // fallback sweep, about one full turn
    await afterFrames(page, 2);
    const now = await walk(page), seen = now.action;
    mark(`sweep ${i}`, now, Math.atan2(target[0] - now.self.x, target[2] - now.self.z), seen);
    if (seen === want) return true;
    await drag(page, 45);
  }
  return (await walk(page)).action === want;
}
/** Stand the walker within reach of the anvil on the side the camera already looks from, so no turn is needed.
 * Falls back to the anvil's own approach and a camera drag when no such spot is clear and supported. */
async function toAnvil(page) {
  const now = await walk(page);
  const { approach, position } = realm.anvil;
  const look = [Math.sin(now.yaw), Math.cos(now.yaw)], side = [look[1], -look[0]];
  const reach = Math.hypot(approach[0] - position[0], approach[2] - position[2]);
  const spots = [];
  for (const distance of [reach, reach * .85, reach * 1.1, reach * .7]) for (const offset of [0, .3, -.3]) {
    spots.push([position[0] - look[0] * distance + side[0] * offset, approach[1], position[2] - look[1] * distance + side[1] * offset]);
  }
  spots.push(approach);
  let spot = null;
  for (let i = 0; i < 10 && !spot; i++) {
    spot = spots.find(candidate => realm.place(now.selfId, candidate)) ?? null;
    if (!spot) await page.waitForTimeout(500);
  }
  if (!spot) throw new Error('Walk proof: the kingdom did not place the walker at the anvil.');
  summary.anvilSpot ??= spot === approach ? 'approach' : 'facing';
  stage(`placed at the anvil (${spot === approach ? 'its approach' : 'already facing it'}); waiting for the walk to show it`);
  await page.waitForFunction(([x, z]) => { const s = window.__chatdomWalk?.self; return !!s && Math.hypot(s.x - x, s.z - z) < .75; },
    [spot[0], spot[2]], { timeout: 120_000, polling: 250 });
  await afterFrames(page, 2);
  if (!await face(page, position, 'forge')) throw new Error('Walk proof: the walker could not face the anvil.');
  await page.keyboard.press('KeyE');
  stage('pressed E at the anvil');
}
const boxStatus = page => page.evaluate(titles => {
  const title = document.querySelector('.forge-wish-result h3')?.textContent ?? null;
  return { open: !!document.querySelector('.forge-wish-panel'), title, status: title ? titles[title] ?? 'unrecognised' : null,
    field: !!document.querySelector('#forge-wish-words') };
}, STATUS_TITLES);

/** After the outcome: close the box and stand the walker out in front of the citizen's home, turned to the door, where the
 * new piece sits. The kingdom's own placement seam, as at the anvil. */
async function standAtHome(page, person) {
  const door = realm.door(person.personId);
  if (!door) throw new Error('Walk proof: the citizen has no home door target.');
  if ((await boxStatus(page)).open) await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForFunction(() => window.__chatdomWalk?.owner === 'walking' && !document.querySelector('.forge-wish-panel'), null, { timeout: 60_000, polling: 250 });
  const now = await walk(page);
  const out = [door.approach[0] - door.position[0], door.approach[2] - door.position[2]], length = Math.hypot(...out) || 1;
  let spot = null;
  for (const distance of [9, 7.5, 6, 4.5, 3, 1.5, 0]) {
    const candidate = [door.approach[0] + out[0] / length * distance, door.approach[1], door.approach[2] + out[1] / length * distance];
    if (realm.place(now.selfId, candidate)) { spot = candidate; break; }
  }
  if (!spot) throw new Error('Walk proof: the kingdom did not place the walker before the home.');
  stage('placed before the citizen\'s home');
  await page.waitForFunction(([x, z]) => { const s = window.__chatdomWalk?.self; return !!s && Math.hypot(s.x - x, s.z - z) < .75; },
    [spot[0], spot[2]], { timeout: 120_000, polling: 250 });
  await afterFrames(page, 2);
  for (let i = 0; i < 3; i++) {
    const here = await walk(page);
    const error = Math.atan2(Math.sin(Math.atan2(door.position[0] - here.self.x, door.position[2] - here.self.z) - here.yaw),
      Math.cos(Math.atan2(door.position[0] - here.self.x, door.position[2] - here.self.z) - here.yaw));
    if (Math.abs(error) < .08) break;
    await drag(page, -error * here.height / 2.6);
    await afterFrames(page, 3);
  }
}

/** Sign in as the wish's citizen, walk to the anvil, press E, type the words, take the still, send, and follow the box
 * until its outcome or the end of the hold. The lock is released as soon as the send has settled and time is up. */
async function typeWish(row, person, wish, first) {
  return cycle(`wish ${row.id}`, async ({ origin, deadline }) => {
    const page = await openPage(origin, person);
    await toAnvil(page);
    const field = page.getByLabel('What would you like to make?');
    await field.waitFor({ timeout: 90_000 });
    await field.click();
    await page.keyboard.type(wish.words, { delay: 25 });
    if (await field.inputValue() !== wish.words) throw new Error('Walk proof: the typed words did not reach the wish box.');
    row.typed = true;
    stage(`wish ${row.id}: typed into the wish box`);
    row.shots.push(await shot(page, `wish-${row.id}-typed@390x844.png`));
    // The first wish also at 1440x900, when the hold can afford one large SwiftShader frame and still send.
    if (first) {
      if (deadline - Date.now() > 130_000) row.shots.push(await shot(page, `wish-${row.id}-typed@1440x900.png`, { width: 1440, height: 900 }));
      else row.skipped = 'wide still: too little of the hold left';
    }
    const send = page.getByRole('button', { name: 'Send wish to chat' });
    await send.waitFor({ timeout: 30_000 });
    // The send must finish inside this hold: closing Chrome under the request would abort it.
    if (deadline - Date.now() < 40_000) throw new Error('Walk proof: too little of the hold was left to send the wish.');
    await send.click();
    row.sentAt = Date.now();
    stage(`wish ${row.id}: sent from the wish box`);
    await followBox(page, row, deadline);
  });
}

/** Read the box until it shows an outcome, or until the hold ends once the send has settled. */
async function followBox(page, row, deadline, live = true) {
  const seen = new Set();
  for (let box = await boxStatus(page); Date.now() < deadline - 20_000; box = await boxStatus(page)) {
    if (box.status && !seen.has(box.status)) { seen.add(box.status); (row.boxTrail ??= []).push({ status: box.status, seconds: row.sentAt ? Math.round((Date.now() - row.sentAt) / 100) / 10 : null }); }
    if (box.status && FINAL.has(box.status)) {
      row.box = { title: box.title, status: box.status, seconds: live ? Math.round((Date.now() - row.sentAt) / 100) / 10 : null, live,
        reopened: !!row.boxClosed };
      stage(`wish ${row.id}: the box shows "${box.title}"`);
      return;
    }
    if (!box.open) {
      // The box closed under the proof (the founded scene reloads when the piece is committed): open it again at the
      // anvil with E, where it shows this citizen's latest wish.
      row.boxClosed = (row.boxClosed ?? 0) + 1;
      if (row.boxClosed > 2 || deadline - Date.now() < 75_000) return;
      stage(`wish ${row.id}: the box closed; opening it again at the anvil`);
      await page.waitForFunction(() => window.__chatdomReady === true && window.__chatdomWalk?.ready === true && window.__chatdomWalk.owner === 'walking',
        null, { timeout: Math.max(5_000, deadline - Date.now() - 45_000), polling: 500 });
      await toAnvil(page);
      await page.locator('.forge-wish-panel').waitFor({ timeout: 30_000 });
      continue;
    }
    await page.waitForTimeout(1000);
  }
  row.boxAtRelease = (await boxStatus(page)).status;
}

/** A later hold for a wish whose outcome came after its first hold: the box at the anvil shows the latest wish. */
async function revisit(row, person) {
  return cycle(`revisit ${row.id}`, async ({ origin, deadline }) => {
    const page = await openPage(origin, person);
    await toAnvil(page);
    await page.locator('.forge-wish-result h3').waitFor({ timeout: 90_000 });
    await followBox(page, row, deadline, false);
  });
}

/** Optional (--landed-still): a hold that stands the citizen before the home and takes one still of the new piece. */
async function landedStill(row, person) {
  return cycle(`landed ${row.id}`, async ({ origin }) => {
    const page = await openPage(origin, person);
    await standAtHome(page, person);
    row.shots.push(await shot(page, `wish-${row.id}-landed@390x844.png`));
  });
}

let plugin, outDir, cacheDir;
const webState = { config: null, socketPath: null, auth: null };
try {
  stage('load workspace modules');
  cacheDir = join(directory, 'vite-cache'); outDir = join(directory, 'web');
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: join(cacheDir, 'loader'),
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false } });
  const { FW10_WISHES } = await loader.ssrLoadModule('/apps/codex/src/fixtures/fw10-wishes.ts');
  const { FORGE_CHAT_LIMITS } = await loader.ssrLoadModule('/packages/shared/src/index.ts');
  const wishes = (wishIds.length ? wishIds : DEFAULT_WISHES).map(id => {
    const wish = FW10_WISHES.find(item => item.id === id);
    if (!wish) throw new Error(`Walk proof: unknown wish id ${id}.`);
    if (wish.words.trim().length > FORGE_CHAT_LIMITS.words) throw new Error(`Walk proof: ${id} exceeds the wish box limit.`);
    return wish;
  });
  if (new Set(wishes.map(wish => wish.id)).size !== wishes.length) throw new Error('Walk proof: repeat wish ids.');
  summary.wishes = wishes.map(wish => ({ id: wish.id, category: wish.category, shots: [] }));
  stage(`prepare the durable SIMULATED realm (${mode} providers)`);
  realm = await startWalkRealm({ loader, repo, directory, mode, wishes, log: line => say(line) });
  summary.kingdom = 'SIMULATED Birchlight';
  webState.config = { kingdomId: realm.kingdomId, kingdomName: realm.kingdomName, notice: realm.notice };
  webState.socketPath = realm.socketPath;
  plugin = walkProofPlugin(repo, webState);
  stage('build the web app (production build, main.tsx replaced)');
  const built = Date.now();
  await buildWeb(repo, plugin, outDir, cacheDir);
  summary.buildSeconds = Math.round((Date.now() - built) / 1000);

  for (const [index, wish] of wishes.entries()) {
    const row = summary.wishes[index], person = realm.people[index];
    try {
      await typeWish(row, person, wish, index === 0);
    } catch (error) {
      row.error = redact(error?.message ?? error).slice(0, 400);
      say(`wish ${row.id}: ${row.error}`);
    }
    if (row.sentAt && !row.box) {
      stage(`wish ${row.id}: waiting for the realm's outcome without the lock`);
      const until = Date.now() + SERVER_WAIT_MS;
      const heard = () => realm.facts.heralds.some(item => item.personId === person.personId);
      // A send that never reached simulated chat (no Herald playback within a minute) has nothing to wait for.
      for (const begun = Date.now(); !realm.outcome(person.personId) && Date.now() < until && (heard() || Date.now() - begun < 60_000);) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (realm.outcome(person.personId)) {
        try { await revisit(row, person); }
        catch (error) { row.revisitError = redact(error?.message ?? error).slice(0, 400); }
      }
    }
    if (landedStills && row.box?.status === 'delivered') {
      try { await landedStill(row, person); }
      catch (error) { row.landedStillError = redact(error?.message ?? error).slice(0, 400); }
    }
    const outcome = realm.outcome(person.personId);
    const sent = realm.facts.heralds.filter(item => item.personId === person.personId).at(-1);
    row.realm = outcome ? { status: outcome.status, seconds: row.sentAt ? Math.round((outcome.at - row.sentAt) / 100) / 10 : null } : null;
    row.herald = sent ? { witness: sent.witness ?? null, wish: sent.wish ?? null, error: sent.error ?? null } : null;
    row.landed = await realm.landed(person.personId);
    delete row.sentAt;
    await writePrivate('summary.json', { ...summary, facts: { ...realm.facts, observations: realm.facts.observations.length, heralds: realm.facts.heralds.length } });
  }
  summary.ok = summary.wishes.every(row => row.typed && row.box?.status === 'delivered' && row.realm?.status === 'delivered'
    && row.landed.attachments === 1 && row.landed.spent === 1) && !realm.facts.publicLeak;
  stage(summary.ok ? 'complete' : 'finished with a failed wish');
} catch (error) {
  summary.error = redact(error?.message ?? error).slice(0, 600);
  console.error(`[walk-proof] failed at ${summary.stage}: ${summary.error}`);
} finally {
  await cleanup();
  finished = true;
  process.exitCode = summary.ok ? 0 : 1;
  const report = { run: runId, mode, ok: summary.ok, stage: summary.stage, buildSeconds: summary.buildSeconds,
    wishes: summary.wishes.map(row => ({ id: row.id, typed: !!row.typed, box: row.box?.title ?? null, boxSeconds: row.box?.seconds ?? null,
      realm: row.realm?.status ?? null, realmSeconds: row.realm?.seconds ?? null, attachments: row.landed?.attachments ?? null,
      coalSpent: row.landed?.spent ?? null, shots: row.shots, error: row.error ?? null })),
    cycles: summary.cycles, pageErrors: summary.pageErrors, directory };
  console.log(JSON.stringify(report, null, 2));
}
