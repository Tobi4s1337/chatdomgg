/* global AbortController, Buffer */
// A recorded round of Dusk Court at the kingdom campfire: five headless walkers and one browser walker, from the logs
// to a result, in the real kingdom walk with play's walk features (the fire, its lanterns and its carved HUD).
//
// The realm is `campfireReference` (SIMULATED identities, a founded hamlet from the seed "tobi4s_" held in memory,
// the live realm's interaction authority, campfire seat host and kingdom-room hook) on 127.0.0.10 at a free lane port;
// the page is play's `KingdomEntry` with the live entry source, built once from `tavern/door/page.tsx` in place of
// main.tsx and served beside the session routes the entry asks for. Arrivals stand at a log's approach point. The
// fire's clock is skewed forward whenever everyone has made their choice, so the minutes of a round pass in seconds.
//
// It needs play's walk feature slot and the campfire hooks in the build, so it runs from an assembled tree (until the
// lanes are merged), for example:
//   nice -n 10 node /tmp/chatdom-gather/fire-tree/apps/web/src/campfire/round.mjs --evidence <this repo>/work/evidence/gather
// Only the browser part holds the shared capture lock. Everything is stopped at the end.
//
// The log keeps only what is public: every public frame revision (without any card, except in the final frame, which
// shows every card to everyone), the accepted acts (asks and votes by seat, never whom for; night taps only counted),
// and the result. No `campfire.self` content is written for any seat.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer as createHttp } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { setTimeout } from 'node:timers';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { Client } from '@colyseus/sdk';
import { build, createServer } from 'vite';
import { listenLocalRealm } from '../games/local-listener.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const { values } = parseArgs({ options: { evidence: { type: 'string', default: `${repo}work/evidence/gather` }, 'skip-build': { type: 'boolean', default: false },
  'no-stills': { type: 'boolean', default: false }, hour: { type: 'string', default: '22' } } });
const evidence = values.evidence.replace(/\/$/, '');
const scratch = '/tmp/chatdom-gather/round';
const host = '127.0.0.10';
const seed = process.env.GATHER_PLAN_SEED ?? 'tobi4s_';
const stills = !values['no-stills'];
const hour = Number(values.hour);
const BROWSER_SEAT = 6, HEADLESS = 5;
const BROWSER = { personId: '990000106', name: 'Visitor 6' };
const VIEW = { width: 1440, height: 900 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cancellation = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => cancellation.abort(new Error(`Cancelled by ${signal}`)));
const until = async (predicate, description, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (cancellation.signal.aborted) throw cancellation.signal.reason;
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await sleep(40);
  }
};
const freePorts = async count => {
  const found = [];
  for (const port of [5183, 5184, 5185, 5186, 5188, 5189, 5170, 5171, 5172, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5182]) {
    if (found.length === count) break;
    const probe = createPortProbe();
    if (await new Promise(resolve => { probe.once('error', () => resolve(false)); probe.listen(port, host, () => probe.close(() => resolve(true))); })) found.push(port);
  }
  assert.equal(found.length, count, 'No approved free ports on the gather loopback address.');
  return found;
};
assert.ok(existsSync(`${repo}apps/web/src/play/slots.ts`), 'play\'s walk feature slot is not in this tree; run from an assembled tree');
assert.ok(existsSync(`${repo}apps/realm/src/campfire/reference.ts`), 'the campfire realm is not in this tree');

const report = { started: new Date().toISOString(), tree: repo, game: 'Dusk Court',
  fixture: `SIMULATED: reference identities (Visitor 1-6) and a founded hamlet generated from the seed "${seed}", held in memory; nothing is durable or signed in. The fire's clock is skewed forward once every choice is made.`,
  limitations: [
    'The browser renders through SwiftShader: the round and the stills are evidence of behaviour and composition, never of frame time or the real look of light.',
    'The entry\'s session routes are this script\'s stand-ins for the API.',
    'Five headless walkers and one browser walker; nobody sits in the Magistrate\'s chair and the stream is not live, so phases advance on the fire\'s clock and the Gallery is quiet.',
    'Night taps are counted, never attributed; votes are logged by seat, never whom for.',
  ], checks: [], frames: [], acts: [], nights: {}, browser: { keys: [], receipts: [] }, stills: [] };
let loader, realm, web, browser, release, diagnose, reference, locked = null;
const rooms = [];
try {
  const [realmPort, webPort] = await freePorts(2);
  report.ports = { host, realm: realmPort, web: webPort };
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: '/tmp/chatdom-gather/vite-round-loader',
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false } });
  const load = path => loader.ssrLoadModule(path);
  const [{ createRealmServer }, { REFERENCE_KINGDOM }, shared, { KingdomRoomState }, worldPkg, { createGrowthState }, { createRealmState },
    { createNativeTown, assembleFoundedScene, compileFoundedScene }, { createFoundedInteractionRegistry }, { campfireReference },
    { installGatherStore, MemoryGatherStore }, { installTavernReturns }, arrivals] = await Promise.all([
    load('/apps/realm/src/server.ts'), load('/apps/realm/src/reference.ts'), load('/packages/shared/src/index.ts'), load('/packages/shared/src/realm/index.ts'),
    load('/packages/world/src/index.ts'), load('/packages/world/src/growth/index.ts'), load('/packages/world/src/realm/reducer.ts'),
    load('/apps/realm/src/founded/index.ts'), load('/packages/world/src/interactions/index.ts'), load('/apps/realm/src/campfire/reference.ts'),
    load('/apps/realm/src/games/store.ts'), load('/apps/realm/src/games/return.ts'), load('/apps/realm/src/portals/arrivals.ts'),
  ]);
  const { CAMPFIRE_MESSAGES, CampfireFrameSchema, CampfireSelfSchema, starterCitizenLook } = shared;

  // The founded kingdom with its civic places installed, as the realm serves it, and the clearing's eleven logs.
  const plan = worldPkg.generateSettlementPlan({ seed, tier: 'hamlet', firstYear: 2025, year: 2026 });
  const growth = createGrowthState(REFERENCE_KINGDOM, 'simulated');
  const state = { ...createRealmState(REFERENCE_KINGDOM, 'simulated'),
    growth: { ...growth, civic: { ...growth.civic, levels: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 } } } };
  const { scene, bytes, manifest } = await assembleFoundedScene({ kingdomId: REFERENCE_KINGDOM, plan, native: createNativeTown(plan), state, collisionRevision: 7 });
  const world = compileFoundedScene(scene);
  const logs = createFoundedInteractionRegistry(scene, world).records.filter(record => record.target.kind === 'campfire-seat').map(record => record.target)
    .sort((a, b) => Number(a.id.split(':').at(-1)) - Number(b.id.split(':').at(-1)));
  assert.deepEqual(logs.map(log => log.id), Array.from({ length: 11 }, (_, i) => `fire:clearing:seat:${i}`), 'the clearing has the Magistrate\'s chair and ten logs');
  report.kingdom = { seed, placements: scene.placements.length, manifest: { sceneHash: manifest.sceneHash, layoutRevision: manifest.layoutRevision },
    logs: logs.map(log => ({ id: log.id, position: log.position, approach: log.approach, reach: log.reach })) };

  // A real clock for the sockets, a skewed one for the fire (and the interaction authority beside it).
  let skew = 0;
  const clock = () => Date.now() + skew;
  // Arrivals in join order: the five headless walkers at logs 1-5, then the browser walker at log 6.
  reference = campfireReference({ scene, world, clock, live: () => false, spawn: index => [...logs[Math.min(index + 1, BROWSER_SEAT)].approach] });
  const services = reference.services, inner = services.auth;
  // Everyone wears a starter look, as a newcomer does (the reference principal's look is a placeholder string).
  services.auth = { ...inner, authenticate: async join => { const principal = await inner.authenticate(join); return { ...principal, look: starterCitizenLook(principal.personId) }; } };
  installGatherStore(services, new MemoryGatherStore());
  installTavernReturns(services, kingdomId => kingdomId === REFERENCE_KINGDOM ? scene : undefined);
  arrivals.installPortalArrivals(services, new arrivals.RealmPortalArrivals());
  const fire = reference.campfires.fire(REFERENCE_KINGDOM);
  const created = createRealmServer(services); realm = created.server;
  await listenLocalRealm(realm, created.transport, realmPort, host);
  const endpoint = `http://${host}:${realmPort}`;

  // The page: built once into scratch, in place of main.tsx (the door page opens `KingdomEntry` with the live source).
  if (!values['skip-build']) {
    const swap = { name: 'campfire-round', enforce: 'pre',
      transform(_code, id) { if (id.split('?')[0] === `${repo}apps/web/src/main.tsx`) return { code: "import './tavern/door/page';", map: null }; } };
    console.log('[round] building the page');
    await build({ root: `${repo}apps/web`, configFile: `${repo}apps/web/vite.config.ts`, plugins: [swap], logLevel: 'warn',
      build: { outDir: `${scratch}/web`, emptyOutDir: true, sourcemap: false, reportCompressedSize: false, chunkSizeWarningLimit: 1e9 } });
  }
  await loader.close(); loader = undefined;
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.ttf': 'font/ttf', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.opus': 'audio/ogg' };
  const root = `${scratch}/web`, sceneBytes = Buffer.from(bytes);
  const info = { kingdomId: REFERENCE_KINGDOM, kingdomName: 'tobi4s_', endpoint, notice: '' };
  const json = (response, value, status = 200) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
  web = createHttp(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://round').pathname);
    response.setHeader('Cache-Control', 'no-store');
    const cookie = /gather-round=([0-9a-f-]{36})/.exec(request.headers.cookie ?? '')?.[1];
    if (path === '/__door/info') return json(response, info);
    if (path === '/api/realm/session') {
      if (!cookie) return json(response, { version: 1, status: 'anonymous' });
      return json(response, { version: 1, status: 'authenticated', expiresAt: Date.now() + 3_600_000, resumeScope: `round-${cookie}`, csrfToken: `csrf-${cookie}-${cookie}` });
    }
    if (path === '/api/realm/ticket' && request.method === 'POST') {
      if (!cookie || request.headers['x-csrf-token'] !== `csrf-${cookie}-${cookie}`) return json(response, { version: 1, status: 'unauthenticated', message: 'No session.' }, 401);
      // One person for the browser, a fresh single-use ticket per join.
      return json(response, { version: 1, status: 'issued', join: reference.issue(BROWSER), expiresAt: Date.now() + 60_000 });
    }
    if (path === `/api/realm/founded/${REFERENCE_KINGDOM}`) return json(response, manifest);
    if (path === `/api/realm/founded/scenes/${manifest.sceneHash}`) { response.setHeader('Content-Type', 'application/json'); response.end(sceneBytes); return; }
    // The entry's gate and footer: this round's one kingdom, and no other doors to list.
    if (path === '/api/public/door') return json(response, { kingdoms: [] });
    if (path === `/api/realm/entry/${REFERENCE_KINGDOM}`) return json(response, { version: 1, kingdomId: REFERENCE_KINGDOM, origin: 'simulated', name: 'tobi4s_' });
    if (path.startsWith('/api/')) return json(response, { version: 1, status: 'unavailable', message: 'Not part of this round.' }, 404);
    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    try {
      if (!file.startsWith(root + sep) && file !== root) throw new Error('outside');
      const body = await readFile(file);
      response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      response.end(body);
    } catch {
      if (extname(path)) { response.statusCode = 404; response.end(); return; }
      response.setHeader('Content-Type', TYPES['.html']);
      response.end(await readFile(join(root, 'index.html')));
    }
  });
  await new Promise((resolve, reject) => { web.once('error', reject); web.listen(webPort, host, resolve); });

  // --- Five headless walkers: each hears only what the room sends it, and keeps its own view to itself. ---
  const sdk = new Client(endpoint);
  const listen = room => {
    const frames = [], selves = [], receipts = new Map(), acts = new Map(), heard = { frame: null };
    room.onMessage(CAMPFIRE_MESSAGES.frame, raw => { const frame = CampfireFrameSchema.parse(raw); frames.push(frame); heard.frame?.(frame); });
    room.onMessage(CAMPFIRE_MESSAGES.self, raw => { selves.push(CampfireSelfSchema.parse(raw)); });
    room.onMessage(CAMPFIRE_MESSAGES.receipt, raw => { acts.set(raw.id, raw.accepted); });
    room.onMessage('private', raw => { if (raw?.type === 'receipt') receipts.set(raw.receipt.id, raw.receipt.status); });
    for (const type of ['transient', 'world', 'bootstrap', 'revision']) room.onMessage(type, () => {});
    room.onMessage('*', () => {});
    room.send('bootstrap'); room.send(CAMPFIRE_MESSAGES.hello);
    return { room, frames, selves, receipts, acts, heard, self: () => selves.at(-1), frame: () => frames.at(-1) };
  };
  const people = [];
  for (let i = 0; i < HEADLESS; i++) {
    const room = await sdk.joinOrCreate('kingdom', reference.issue(), KingdomRoomState);
    room.reconnection.enabled = false; rooms.push(room);
    const person = listen(room);
    await until(() => room.state.walkers.get(room.sessionId), `headless walker ${i + 1} stands in the kingdom`);
    person.name = room.state.walkers.get(room.sessionId).name; person.seat = i + 1;
    people.push(person);
  }
  const observer = people[0];
  let intents = 0;
  const sit = async (person, seat) => {
    const id = `sit-${++intents}`;
    person.room.send('intent', { version: 1, type: 'interact', id, targetId: `fire:clearing:seat:${seat}`, action: 'sit' });
    await until(() => person.receipts.has(id), `receipt ${id}`, 10_000);
    return person.receipts.get(id);
  };
  for (const person of people) {
    const at = person.room.state.walkers.get(person.room.sessionId);
    assert.ok(Math.hypot(at.x - logs[person.seat].approach[0], at.z - logs[person.seat].approach[2]) < .1, `${person.name} arrived at log ${person.seat}'s approach`);
    assert.equal(await sit(person, person.seat), 'applied', `${person.name} sits on log ${person.seat}`);
  }
  await until(() => observer.frame()?.seated.length === HEADLESS, 'five on the logs');
  report.checks.push(`Five headless walkers arrived at the approach of logs 1-5 and sat with the seat's own interaction (${people.map(p => `${p.name} on ${p.seat}`).join(', ')}).`);

  // Every public frame, logged once per change. Cards appear only in the final frame (the end shows every card).
  let lastLogged = '';
  const publicPlayers = (court, reveal) => court.players.map(p => ({ seat: p.seat, name: p.name, lantern: p.lantern, away: p.away, gone: p.gone, embers: p.embers, voted: p.voted,
    ...(reveal ? { role: p.role } : {}) }));
  const logFrame = frame => {
    const court = frame.court;
    const key = JSON.stringify({ seated: frame.seated, match: court?.match, revision: court?.revision, phase: court?.phase });
    if (key === lastLogged) return;
    lastLogged = key;
    report.frames.push({ received: new Date().toISOString(), seated: frame.seated, live: frame.live, magistrate: frame.magistrate,
      court: court ? { match: court.match, revision: court.revision, phase: court.phase, night: court.night, waiting: court.waiting, wolves: court.wolves,
        phaseMs: court.deadline - court.startedAt, dawn: court.dawn, verdict: court.verdict, result: court.result,
        players: publicPlayers(court, court.phase === 'ended') } : null });
  };
  observer.heard.frame = logFrame;
  if (observer.frame()) logFrame(observer.frame());

  // --- The browser: the shared capture lock from here until the last still. ---
  release = await acquireCaptureLock({ signal: cancellation.signal });
  locked = Date.now();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  await context.addCookies([{ name: 'gather-round', value: randomUUID(), url: `http://${host}:${webPort}` }]);
  const page = await context.newPage();
  const errors = report.errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const ignored = url => url.endsWith('/favicon.ico') || url.endsWith('/api/realm/clock');
  page.on('console', message => { if (message.type() === 'error' && !ignored(message.location().url)) errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400 && !ignored(response.url())) errors.push(`${response.status()} ${response.url()}`); });
  // The browser's own act receipts, read off its socket: only whether the fire took them, never what they were.
  const receiptName = Buffer.from(CAMPFIRE_MESSAGES.receipt), acceptedKey = Buffer.from('accepted');
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    if (typeof payload === 'string') return;
    const bytes = Buffer.from(payload);
    if (bytes.indexOf(receiptName) < 0) return;
    const at = bytes.indexOf(acceptedKey);
    if (at >= 0) report.browser.receipts.push({ at: Date.now(), accepted: bytes[at + acceptedKey.length] === 0xc3 });
  }));
  const browserBody = () => [...observer.room.state.walkers.values()].find(walker => walker.name === BROWSER.name);
  diagnose = async () => ({ page: await page.evaluate(() => ({ walk: window.__chatdomWalk && { owner: window.__chatdomWalk.owner, self: window.__chatdomWalk.self },
    interaction: window.__chatdomKingdom?.interactionDebug?.() ?? null, hud: !!document.querySelector('[data-campfire-hud]'), fire: !!document.querySelector('.campfire-words'),
    hudText: document.querySelector('[data-campfire-hud]')?.textContent?.slice(0, 300) ?? null })).catch(error => String(error)),
    body: browserBody() && { x: browserBody().x, y: browserBody().y, z: browserBody().z }, frame: observer.frame() && { seated: observer.frame().seated, phase: observer.frame().court?.phase } });
  await page.goto(`http://${host}:${webPort}/?walk=1&kingdom=${REFERENCE_KINGDOM}&hour=${hour}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => window.__chatdomWalk?.ready === true && window.__chatdomWalk.owner === 'walking', null, { timeout: 200_000 });
  report.timings = { pageWalkingMs: Date.now() - locked };
  const arrived = await until(() => browserBody(), 'the browser walker in the room');
  report.walker = { name: arrived.name, arrived: [arrived.x, arrived.y, arrived.z] };
  assert.ok(Math.hypot(arrived.x - logs[BROWSER_SEAT].approach[0], arrived.z - logs[BROWSER_SEAT].approach[2]) < .1, 'the browser walker arrived at log 6\'s approach');
  await page.waitForFunction(() => !!document.querySelector('.campfire-words'), null, { timeout: 30_000 });
  report.checks.push(`The real kingdom entry opened the founded hamlet at hour ${hour}; the browser walker (${arrived.name}) stands at log ${BROWSER_SEAT}'s approach and play mounted the campfire walk feature (${(report.timings.pageWalkingMs / 1000).toFixed(0)} s after the lock).`);

  // Face log 6: the look must hold the log in view. Walking a step towards it turns the camera behind the walk.
  const targetId = `fire:clearing:seat:${BROWSER_SEAT}`, log = logs[BROWSER_SEAT];
  const focused = () => page.evaluate(id => { const debug = window.__chatdomKingdom?.interactionDebug?.(); return debug?.focus === id && !!debug.prompt?.actionable; }, targetId);
  await page.locator('canvas').first().click({ position: { x: VIEW.width / 2, y: VIEW.height / 2 } }).catch(() => {});
  await sleep(600);
  if (!(await focused())) {
    const KEYS = { KeyW: [0, 1], KeyS: [0, -1], KeyA: [1, 0], KeyD: [-1, 0] };
    const heading = (key, yaw) => {
      const angle = yaw * Math.PI / 128, [side, ahead] = KEYS[key];
      const forward = [Math.sin(angle), Math.cos(angle)], left = [Math.cos(angle), -Math.sin(angle)];
      return [forward[0] * ahead + left[0] * side, forward[1] * ahead + left[1] * side];
    };
    let held = null;
    const deadline = Date.now() + 25_000, trail = [];
    try {
      while (!(await focused())) {
        if (Date.now() > deadline) { report.facing = { trail: trail.slice(-30) }; throw new Error('Timed out turning to log 6'); }
        const at = browserBody(), radians = await page.evaluate(() => window.__chatdomWalk?.camera?.yaw).catch(() => null), yaw = Number.isFinite(radians) ? radians * 128 / Math.PI : null;
        if (at) trail.push([+at.x.toFixed(2), +at.z.toFixed(2), yaw === null ? null : +yaw.toFixed(1)]);
        if (at && yaw !== null) {
          const dx = log.position[0] - at.x, dz = log.position[2] - at.z;
          const best = Object.keys(KEYS).reduce((a, b) => { const [ax, az] = heading(a, yaw), [bx, bz] = heading(b, yaw); return bx * dx + bz * dz > ax * dx + az * dz ? b : a; });
          if (best !== held) { if (held) await page.keyboard.up(held); await page.keyboard.down(best); held = best; }
        }
        await sleep(60);
      }
    } finally { if (held) await page.keyboard.up(held); }
    report.facing = { steps: trail.length, trail: trail.filter((_, i) => i % 5 === 0).slice(-20) };
  }
  await until(() => focused(), 'the prompt for log 6 after stopping', 10_000);
  report.browser.keys.push({ at: Date.now(), keys: ['KeyE'], why: 'sit on log 6 at the prompt' });
  await page.keyboard.press('KeyE');
  await until(() => observer.frame()?.seated.some(s => s.seat === BROWSER_SEAT && s.name === BROWSER.name) && observer.frame().seated.length === HEADLESS + 1,
    'the fire sees six on the logs, the browser walker on log 6', 15_000);
  const seatedMode = await until(() => page.evaluate(() => { const self = window.__chatdomKingdom?.interactionDebug?.()?.self; return self && self.mode !== 'standing' ? self : null; }), 'the page shows the walker seated', 60_000);
  await page.waitForFunction(() => !!document.querySelector('[data-campfire-hud]'), null, { timeout: 15_000 });
  report.seated = { frame: observer.frame().seated, page: seatedMode };
  report.checks.push(`The browser walker pressed E at the log's prompt; the fire's public frame seats six (${observer.frame().seated.map(s => `${s.seat}:${s.name}`).join(', ')}), the page's interaction state is ${seatedMode.mode} on ${seatedMode.targetId}, and the carved HUD is up.`);

  // --- The round. ---
  let acts = 0;
  const act = async (person, body) => {
    const id = `act-${++acts}`;
    person.room.send(CAMPFIRE_MESSAGES.act, { ...body, id });
    await until(() => person.acts.has(id), `act ${id}`, 10_000);
    return person.acts.get(id);
  };
  const asker = people[1];
  const asked = await act(asker, { action: 'ask' });
  report.acts.push({ phase: null, seat: asker.seat, action: 'ask', accepted: asked });
  assert.equal(asked, true, 'a seated headless walker asked the fire for a round');
  const roundStarted = Date.now();
  const court = () => observer.frame()?.court ?? null;
  await until(() => court()?.phase === 'call', 'the call');
  assert.ok(court().players.some(p => p.seat === BROWSER_SEAT), 'the browser walker is in the circle');

  const still = async name => {
    if (!stills) return;
    await sleep(1_800);
    const path = `${evidence}/ga11-round-${name}@${VIEW.width}x${VIEW.height}.png`;
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path, timeout: 150_000 });
    const size = (await stat(path)).size;
    report.stills.push({ file: path.slice(evidence.length + 1), bytes: size, phase: court()?.phase ?? null, night: court()?.night ?? null });
  };
  const choiceShown = () => page.evaluate(() => !!document.querySelector('[data-campfire-hud] .campfire-choice-title'));
  const browserReceipts = () => report.browser.receipts.length;
  let phaseKey = '', phaseAt = Date.now(), browserTried = false, browserReceiptsAt = 0, chosenBy = new Set(), took = { night: false, ballot: false };
  for (let step = 0; step < 2_000; step++) {
    if (cancellation.signal.aborted) throw cancellation.signal.reason;
    if (Date.now() - roundStarted > 180_000) throw new Error('The round took longer than three minutes of real time');
    const now = court();
    if (!now) throw new Error('The round was dropped');
    if (now.phase === 'ended') break;
    const key = `${now.match}:${now.phase}:${now.night}`;
    if (key !== phaseKey) { phaseKey = key; phaseAt = Date.now(); browserTried = false; chosenBy = new Set(); browserReceiptsAt = browserReceipts(); }
    const elapsed = Date.now() - phaseAt;
    const choosing = now.phase === 'night' || now.phase === 'ballot';
    // Headless choices: a fixed, spread pick among the offered targets; never logged with the target.
    if (choosing) for (const person of people) {
      const self = person.self(), choice = self?.choice;
      if (!choice || choice.chosen !== null || self.match !== now.match || chosenBy.has(person.seat)) continue;
      chosenBy.add(person.seat);
      const target = choice.targets[(now.night * 7 + person.seat * 3) % choice.targets.length];
      const accepted = await act(person, { action: 'choose', match: now.match, seat: target });
      if (now.phase === 'ballot') report.acts.push({ phase: 'ballot', night: now.night, seat: person.seat, action: 'vote', accepted });
      else { const n = report.nights[now.night] ??= { taps: 0, accepted: 0 }; n.taps++; if (accepted) n.accepted++; }
    }
    // The browser walker's own choice, with real keys, once its HUD offers one.
    const me = now.players.find(p => p.seat === BROWSER_SEAT);
    if (choosing && !browserTried && me?.lantern === 'lit' && elapsed > 600 && await choiceShown()) {
      browserTried = true;
      const keys = now.night % 2 ? ['ArrowRight', 'Enter'] : ['ArrowLeft', 'ArrowLeft', 'Enter'];
      for (const key of keys) { await page.keyboard.press(key); await sleep(120); }
      report.browser.keys.push({ at: Date.now(), keys, why: now.phase === 'ballot' ? `vote, night ${now.night}` : `night ${now.night}` });
      const answered = await until(() => browserReceipts() > browserReceiptsAt && report.browser.receipts.at(-1), 'the fire answers the browser walker', 8_000).catch(() => null);
      if (now.phase === 'ballot') report.acts.push({ phase: 'ballot', night: now.night, seat: BROWSER_SEAT, action: 'vote', by: 'keys', accepted: answered?.accepted ?? null });
      else { const n = report.nights[now.night] ??= { taps: 0, accepted: 0 }; n.taps++; if (answered?.accepted) n.accepted++; }
    }
    if (now.phase === 'night' && !took.night && elapsed > 2_500) { took.night = true; await still('night'); }
    if (now.phase === 'ballot' && !took.ballot && (now.players.find(p => p.seat === BROWSER_SEAT)?.voted || elapsed > 6_000)) { took.ballot = true; await still('ballot'); }
    // When is the phase done? Choices made (or plainly none to make), else a short beat to be seen.
    const headlessDone = people.every(person => { const choice = person.self()?.choice; return !choice || choice.chosen !== null || person.self()?.match !== now.match; });
    let done;
    if (now.phase === 'night') done = headlessDone && (browserTried ? browserReceipts() > browserReceiptsAt || elapsed > 8_000 : elapsed > 3_500) && (took.night || !stills);
    else if (now.phase === 'ballot') done = (now.players.filter(p => p.lantern === 'lit' && !p.gone).every(p => p.voted) && (took.ballot || !stills)) || elapsed > 15_000;
    else done = elapsed > (now.phase === 'deal' ? 2_000 : 1_200);
    if (done) {
      const revision = now.revision;
      skew += Math.max(0, now.deadline - clock()) + 1;
      await fire.tick();
      await until(() => court() && (court().revision !== revision || court().phase === 'ended'), 'the next public change', 10_000);
      continue;
    }
    await sleep(120);
  }
  const ended = court();
  assert.equal(ended.phase, 'ended', 'the round ended');
  assert.ok(ended.result, 'with a result');
  report.timings.roundMs = Date.now() - roundStarted;
  report.timings.skewMs = skew;
  await page.waitForFunction(() => /ended|won|wolf|town|lantern/i.test(document.querySelector('[data-campfire-hud] .campfire-plate')?.textContent ?? ''), null, { timeout: 10_000 }).catch(() => {});
  await still('end');
  report.lockSeconds = Math.round((Date.now() - locked) / 1000);
  await browser.close(); browser = undefined;
  await release(); release = undefined;

  report.result = { winner: ended.result.winner, reason: ended.result.reason, nights: ended.night, dawn: ended.dawn, verdict: ended.verdict,
    cards: ended.players.map(p => ({ seat: p.seat, name: p.name, role: p.role, lantern: p.lantern })) };
  const votes = report.acts.filter(a => a.action === 'vote');
  const browserVotes = votes.filter(a => a.seat === BROWSER_SEAT);
  report.checks.push(`A headless walker asked; ${report.frames.filter(f => f.court).length} public frame revisions were logged through ${[...new Set(report.frames.map(f => f.court?.phase).filter(Boolean))].join(' → ')}.`);
  report.checks.push(`The browser walker chose with real keys ${report.browser.keys.length - 1} time(s); the fire took ${report.browser.receipts.filter(r => r.accepted).length} of ${report.browser.receipts.length} of its acts (${browserVotes.length} vote(s) in the ballot).`);
  report.checks.push(`Result: ${ended.result.winner ?? 'nobody'} (${ended.result.reason}) after night ${ended.night}; the final frame shows every card.`);
  assert.ok(ended.players.every(p => p.role !== null), 'the end shows every card');
  assert.ok(report.browser.receipts.length > 0 && report.browser.receipts.every(r => r.accepted), 'every act the browser walker made was accepted');
  const pageErrors = errors.filter(e => !/AudioContext|autoplay/i.test(e));
  report.pageErrors = pageErrors;
  assert.deepEqual(pageErrors, [], 'no page errors');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error?.stack ?? error);
  if (diagnose) report.diagnosis = await diagnose().catch(cause => String(cause));
  if (browser) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: `${scratch}/failure.png`, timeout: 90_000 }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (locked !== null && report.lockSeconds === undefined) report.lockSeconds = Math.round((Date.now() - locked) / 1000);
  await browser?.close().catch(() => {});
  await release?.().catch(() => {});
  for (const room of rooms) await room.leave().catch(() => {});
  await realm?.gracefullyShutdown?.(false).catch(() => {});
  reference?.campfires.dispose();
  await new Promise(resolve => web ? web.close(resolve) : resolve());
  await loader?.close().catch(() => {});
  report.finished = new Date().toISOString();
  await mkdir(evidence, { recursive: true });
  await writeFile(`${evidence}/ga11-round.json`, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    '# GA11: a recorded round of Dusk Court at the campfire',
    '',
    `${report.status === 'passed' ? 'Passed' : 'Failed'} on ${report.finished}. SIMULATED: reference identities and a founded hamlet ("${seed}") held in memory; SwiftShader in the browser.`,
    '',
    `Rerun: \`nice -n 10 node ${repo}apps/web/src/campfire/round.mjs --evidence ${evidence}\` (from an assembled tree with play's walk features).`,
    `Ports: realm ${report.ports?.realm ?? '-'}, page ${report.ports?.web ?? '-'} on ${host}. Capture lock held ${report.lockSeconds ?? '-'} s.`,
    '',
    ...(report.result ? [`Result: **${report.result.winner ?? 'nobody'}** (${report.result.reason}) after night ${report.result.nights}.`, '',
      '| Seat | Name | Card | Lantern |', '|---|---|---|---|', ...report.result.cards.map(c => `| ${c.seat} | ${c.name} | ${c.role} | ${c.lantern} |`), ''] : []),
    '## Checks', '', ...report.checks.map(c => `- ${c}`), '',
    ...(report.stills.length ? ['## Stills', '', ...report.stills.map(s => `- \`${s.file}\` (${s.phase}, night ${s.night})`), ''] : []),
    ...(report.error ? ['## Error', '', '```', report.error.split('\n').slice(0, 6).join('\n'), '```', ''] : []),
    'The full log (every public frame revision, accepted acts, timings) is `ga11-round.json`.', '',
  ];
  await writeFile(`${evidence}/ga11-round.md`, lines.join('\n'));
  console.log(`[round] ${report.status}${report.error ? `: ${report.error.split('\n')[0]}` : ''}`);
  process.exit();
}
