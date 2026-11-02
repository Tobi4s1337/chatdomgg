/* global AbortController, Buffer */
// From the street through the tavern door and back, in a browser, on the real kingdom entry and play's transfer.
// One browser walker opens `KingdomEntry` (the live entry source) on a founded kingdom in this script's own realm,
// walks across the tavern's street door, is carried by play's curtain into the tavern room, walks out through the
// interior doorway and stands on the street again outside the door. Two headless people watch from both rooms on
// every state patch, so the walker is seen in exactly one room at a time, under one name and one look.
//
// It needs play's door keeper and the tavern's registration in the build, so it is run from the tree that
// `with-play.mjs` assembles (and, once both lanes are merged, from the repo itself):
//   nice -n 10 node apps/web/src/games/with-play.mjs
//   nice -n 10 node /tmp/chatdom-gather/with-play/tree/apps/web/src/games/door-journey.mjs --evidence <this repo>/work/evidence/gather
// Temporary sessions with synthetic identities, memory only; the realm and the page bind 127.0.0.10 on free lane
// ports and stop at the end. The browser part holds the shared capture lock and nothing else does.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer as createHttp } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { setTimeout } from 'node:timers';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { Client } from '@colyseus/sdk';
import { build, createServer } from 'vite';
import { listenLocalRealm } from './local-listener.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const { values } = parseArgs({ options: { evidence: { type: 'string', default: `${repo}work/evidence/gather` }, 'skip-build': { type: 'boolean', default: false },
  stills: { type: 'boolean', default: true }, 'no-stills': { type: 'boolean', default: false } } });
const evidence = values.evidence.replace(/\/$/, '');
const scratch = '/tmp/chatdom-gather/door';
const host = '127.0.0.10';
const seed = process.env.GATHER_PLAN_SEED ?? 'tobi4s_';
const stills = values.stills && !values['no-stills'];
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
assert.ok(existsSync(`${repo}apps/web/src/play/portals.ts`), 'play\'s door keeper is not in this tree; run from the tree with-play.mjs assembles');

const report = { started: new Date().toISOString(), tree: repo,
  fixture: `Temporary sessions with synthetic identities, memory only. The kingdom is a founded hamlet generated from the seed "${seed}" with its tavern at growth level 1, not an adopted plan from a database.`,
  limitations: [
    'The browser renders through SwiftShader: the journey and the stills are evidence of behaviour and composition, never of frame time.',
    'The entry\'s session routes are this script\'s stand-ins for the API: one synthetic person per browser context, a fresh single-use ticket per room.',
    'One browser walker; the two observers are headless realm clients.',
  ], checks: [], phases: [], samples: {}, stills: [] };
let loader, realm, web, browser, release, diagnose;
const rooms = [];
try {
  const [realmPort, webPort] = await freePorts(2);
  report.ports = { host, realm: realmPort, web: webPort };
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: '/tmp/chatdom-gather/vite-door-loader',
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false } });
  const load = path => loader.ssrLoadModule(path);
  const [{ createRealmServer }, { referenceServices, REFERENCE_KINGDOM }, shared, { KingdomRoomState }, { TAVERN_ENTRY, TAVERN_EXIT },
    { installGatherStore, MemoryGatherStore }, { tavernPortalFor }, worldPkg, { createGrowthState }, { createRealmState },
    { createNativeTown, assembleFoundedScene, compileFoundedScene }, { installTavernReturns }, { embeddedSolids, supported }, arrivals] = await Promise.all([
    load('/apps/realm/src/server.ts'), load('/apps/realm/src/reference.ts'), load('/packages/shared/src/index.ts'), load('/packages/shared/src/realm/index.ts'),
    load('/apps/realm/src/games/interior.ts'), load('/apps/realm/src/games/store.ts'), load('/apps/realm/src/games/portal.ts'),
    load('/packages/world/src/index.ts'), load('/packages/world/src/growth/index.ts'), load('/packages/world/src/realm/reducer.ts'),
    load('/apps/realm/src/founded/index.ts'), load('/apps/realm/src/games/return.ts'), load('/packages/world/src/movement/collide.ts'),
    load('/apps/realm/src/portals/arrivals.ts'),
  ]);
  const { TavernRoomState, starterCitizenLook } = shared;

  // The founded kingdom: its plan, installed tavern and exact collision, as the realm serves it.
  const plan = worldPkg.generateSettlementPlan({ seed, tier: 'hamlet', firstYear: 2025, year: 2026 });
  const growth = createGrowthState(REFERENCE_KINGDOM, 'simulated');
  const state = { ...createRealmState(REFERENCE_KINGDOM, 'simulated'),
    growth: { ...growth, civic: { ...growth.civic, levels: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 } } } };
  const { scene, bytes, manifest } = await assembleFoundedScene({ kingdomId: REFERENCE_KINGDOM, plan, native: createNativeTown(plan), state, collisionRevision: 7 });
  const world = compileFoundedScene(scene);
  const portal = tavernPortalFor(REFERENCE_KINGDOM, scene, world);
  assert.ok(portal, 'the installed tavern offers a door');
  const tavern = scene.placements.find(piece => piece.id === 'civic:growth:v1:tavern');
  report.kingdom = { seed, placements: scene.placements.length, tavern: { position: tavern.position, rotation: tavern.rotation }, door: portal.door,
    returnAnchor: portal.returnAnchor, manifest };
  // Newcomers arrive on the door's axis a step and a half out, so the walk to the door is short and straight.
  const gate = (() => {
    const [ax, ay, az] = portal.returnAnchor.feet, [tx, tz] = portal.door.through;
    for (let out = 1.5; out <= 5; out += .25) for (let drop = .5; drop >= -2.5; drop -= .0625) {
      const at = { x: ax - tx * out, y: ay + drop, z: az - tz * out };
      if (!embeddedSolids(at, world).length && supported(at, world)) return [at.x, at.y, at.z];
    }
    throw new Error('No safe gate on the door axis');
  })();
  report.kingdom.gate = gate;

  // One person per session: the first ticket names them, every later ticket is fresh and single-use for the same person.
  const base = referenceServices(), byTicket = new Map(), people = new Map();
  const services = { ...base, auth: { ...base.auth, authenticate: async join => {
    const carried = byTicket.get(join.ticket);
    if (carried) { byTicket.delete(join.ticket); return carried; }
    const principal = { ...await base.auth.authenticate(join) };
    principal.look = starterCitizenLook(principal.personId);
    return principal;
  } }, open: async kingdomId => {
    const handle = await base.open(kingdomId);
    let effects;
    return { ...handle, layoutRevision: scene.layoutRevision, world, spawn: () => [...gate],
      bootstrap: principal => ({ ...handle.bootstrap(principal), layoutRevision: scene.layoutRevision, collisionRevision: world.revision }),
      recoverWalker: (id, revision) => revision === world.revision && !!effects?.placeWalker(id, [...gate], revision),
      bindRoom: bound => { effects = bound; const off = handle.bindRoom(bound); return () => { if (effects === bound) effects = undefined; off(); }; } };
  } };
  const ticketFor = async session => {
    let person = people.get(session);
    if (!person) {
      const first = base.issue();
      person = { ...await base.auth.authenticate(first) };
      person.look = starterCitizenLook(person.personId);
      people.set(session, person);
    }
    const ticket = randomUUID();
    byTicket.set(ticket, person);
    return { ticket, kingdomId: REFERENCE_KINGDOM, protocol: 1 };
  };
  installGatherStore(services, new MemoryGatherStore());
  installTavernReturns(services, kingdomId => kingdomId === REFERENCE_KINGDOM ? scene : undefined);
  // Play's doors too, as main.ts installs them: the entry names the door it came back through.
  arrivals.installPortalArrivals(services, new arrivals.RealmPortalArrivals());
  const created = createRealmServer(services); realm = created.server;
  await listenLocalRealm(realm, created.transport, realmPort, host);
  const endpoint = `http://${host}:${realmPort}`;

  // The page: built once into scratch, in place of main.tsx.
  if (!values['skip-build']) {
    const swap = { name: 'door-journey', enforce: 'pre',
      transform(_code, id) { if (id.split('?')[0] === `${repo}apps/web/src/main.tsx`) return { code: "import './tavern/door/page';", map: null }; } };
    console.log('[door] building the page');
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
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://door').pathname);
    response.setHeader('Cache-Control', 'no-store');
    const cookie = /gather-door=([0-9a-f-]{36})/.exec(request.headers.cookie ?? '')?.[1];
    if (path === '/__door/info') return json(response, info);
    if (path === '/api/realm/session') {
      if (!cookie) return json(response, { version: 1, status: 'anonymous' });
      return json(response, { version: 1, status: 'authenticated', expiresAt: Date.now() + 3_600_000, resumeScope: `door-${cookie}`, csrfToken: `csrf-${cookie}-${cookie}` });
    }
    if (path === '/api/realm/ticket' && request.method === 'POST') {
      if (!cookie || request.headers['x-csrf-token'] !== `csrf-${cookie}-${cookie}`) return json(response, { version: 1, status: 'unauthenticated', message: 'No session.' }, 401);
      return json(response, { version: 1, status: 'issued', join: await ticketFor(cookie), expiresAt: Date.now() + 60_000 });
    }
    if (path === `/api/realm/founded/${REFERENCE_KINGDOM}`) return json(response, manifest);
    if (path === `/api/realm/founded/scenes/${manifest.sceneHash}`) { response.setHeader('Content-Type', 'application/json'); response.end(sceneBytes); return; }
    if (path.startsWith('/api/')) return json(response, { version: 1, status: 'unavailable', message: 'Not part of this journey.' }, 404);
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

  // Two headless watchers: one on the square, one inside the tavern, both for the whole run.
  const sdk = new Client(endpoint);
  const quiet = room => { room.reconnection.enabled = false; rooms.push(room); room.onMessage('*', () => {}); return room; };
  const square = quiet(await sdk.joinOrCreate('kingdom', base.issue(), KingdomRoomState));
  await until(() => square.state.walkers.get(square.sessionId), 'the square observer stands on the square');
  const inn = quiet(await sdk.joinOrCreate('tavern', base.issue(), TavernRoomState));
  inn.send('bootstrap');
  await until(() => inn.state.walkers.get(inn.sessionId), 'the tavern observer is inside');
  const observers = new Set([square.sessionId, inn.sessionId]);
  const others = room => [...room.state.walkers.entries()].filter(([id]) => !observers.has(id)).map(([id, walker]) => ({ id, walker }));
  const samples = { both: 0, tavern: 0, square: 0, neither: 0 }, seen = { names: new Set(), looks: new Set() };
  const sample = () => {
    const t = others(inn), q = others(square);
    for (const { walker } of [...t, ...q]) { seen.names.add(walker.name); seen.looks.add(walker.look); }
    samples[t.length && q.length ? 'both' : t.length ? 'tavern' : q.length ? 'square' : 'neither']++;
    if (t.length > 1 || q.length > 1) samples.duplicate = (samples.duplicate ?? 0) + 1;
  };
  square.onStateChange(sample); inn.onStateChange(sample);
  const body = room => others(room)[0]?.walker;

  // --- The browser: the shared capture lock from here until the stills are taken. ---
  release = await acquireCaptureLock({ signal: cancellation.signal });
  const locked = Date.now();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  await context.addCookies([{ name: 'gather-door', value: randomUUID(), url: `http://${host}:${webPort}` }]);
  const page = await context.newPage();
  const errors = report.errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // The API's shared clock route is not part of this journey; the page keeps its own hour without it (soul/realm-clock.ts).
  const ignored = url => url.endsWith('/favicon.ico') || url.endsWith('/api/realm/clock');
  page.on('console', message => { if (message.type() === 'error' && !ignored(message.location().url)) errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400 && !ignored(response.url())) errors.push(`${response.status()} ${response.url()}`); });
  diagnose = async () => ({ door: await page.evaluate(() => ({ report: window.__gatherDoor, walk: window.__chatdomWalk && { owner: window.__chatdomWalk.owner, self: window.__chatdomWalk.self, input: window.__chatdomWalk.input },
    prompts: [...document.querySelectorAll('button, [role="button"], [class*="portal"], [class*="door"]')].map(node => `${node.className}: ${node.textContent?.trim().slice(0, 60)}`).slice(0, 20) })).catch(error => String(error)),
    square: body(square) && { x: body(square).x, y: body(square).y, z: body(square).z, yaw: body(square).yaw }, inn: body(inn) && { x: body(inn).x, z: body(inn).z } });
  await page.goto(`http://${host}:${webPort}/?walk=1&kingdom=${REFERENCE_KINGDOM}&hour=19.5`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => window.__chatdomWalk?.ready === true && window.__chatdomWalk.owner === 'walking', null, { timeout: 200_000 });
  report.checks.push(`The real kingdom entry opened the founded hamlet and placed the browser walker (${((Date.now() - locked) / 1000).toFixed(0)} s after the lock).`);
  const outside = await until(() => body(square), 'the browser walker on the square');
  report.walker = { name: outside.name, look: outside.look, arrived: [outside.x, outside.y, outside.z] };
  assert.ok(Math.hypot(outside.x - gate[0], outside.z - gate[2]) < .05, 'the browser walker starts at the gate before the door');
  await page.locator('canvas').first().click({ position: { x: 480, y: 300 } });
  await sleep(300);

  // Walking on the realm's own feet: W follows the camera's yaw (0 faces +Z, 64 faces +X; the body turns to its own
  // movement, so the camera's is read from the page's walk), A is its left. The key that heads for the target is
  // chosen afresh each step and held until the journey moves on.
  const KEYS = { KeyW: [0, 1], KeyS: [0, -1], KeyA: [1, 0], KeyD: [-1, 0] };
  const heading = (key, yaw) => {
    const angle = yaw * Math.PI / 128, [side, ahead] = KEYS[key];
    const forward = [Math.sin(angle), Math.cos(angle)], left = [Math.cos(angle), -Math.sin(angle)];
    return [forward[0] * ahead + left[0] * side, forward[1] * ahead + left[1] * side];
  };
  const walk = async (room, camera, route, done, what, timeout = 30_000) => {
    const deadline = Date.now() + timeout, trail = [];
    let held = null, leg = 0;
    try {
      while (!(await done())) {
        const at = body(room), radians = await page.evaluate(camera).catch(() => null), yaw = Number.isFinite(radians) ? radians * 128 / Math.PI : null;
        if (at) trail.push([+at.x.toFixed(2), +at.z.toFixed(2), yaw === null ? null : +yaw.toFixed(1)]);
        // Each waypoint but the last is reached within 12 cm, then the next one is walked to.
        while (at && leg < route.length - 1 && Math.hypot(route[leg][0] - at.x, route[leg][2] - at.z) < .12) leg++;
        const target = route[leg];
        if (Date.now() > deadline) { report.walking = { what, route, leg, held, trail: trail.filter((_, i) => i % 10 === 0).slice(-40) }; throw new Error(`Timed out walking: ${what}`); }
        if (at && Number.isFinite(yaw)) {
          const dx = target[0] - at.x, dz = target[2] - at.z;
          const best = Object.keys(KEYS).reduce((a, b) => { const [ax, az] = heading(a, yaw), [bx, bz] = heading(b, yaw); return bx * dx + bz * dz > ax * dx + az * dz ? b : a; });
          if (best !== held) { if (held) await page.keyboard.up(held); await page.keyboard.down(best); held = best; }
        }
        await sleep(60);
      }
    } finally { if (held) await page.keyboard.up(held); }
  };
  const phases = () => page.evaluate(() => window.__gatherDoor?.phases ?? []);
  const door = portal.door, through = door.through;
  const doorCentre = [(door.min[0] + door.max[0]) / 2, (door.min[1] + door.max[1]) / 2, (door.min[2] + door.max[2]) / 2];
  const pastDoor = [doorCentre[0] + through[0] * 1.2, doorCentre[1], doorCentre[2] + through[1] * 1.2];
  const goingIn = Date.now();
  await walk(square, () => window.__chatdomWalk?.camera?.yaw, [[doorCentre[0], 0, gate[2]], pastDoor], async () => (await phases()).some(phase => phase !== 'idle'), 'across the street door');
  report.checks.push('Walking across the street doorway started play\'s transfer: the walk feature saw the crossing on the predicted feet, with no key pressed but movement.');
  await page.waitForFunction(() => window.__gatherDoor?.phases.at(-1) === 'inside', null, { timeout: 40_000 });
  const inside = await until(() => body(inn), 'the browser walker inside the tavern');
  report.timings = { doorToInsideMs: Date.now() - goingIn };
  assert.equal(inside.name, report.walker.name, 'the same name inside'); assert.equal(inside.look, report.walker.look, 'the same look inside');
  assert.ok(Math.hypot(inside.x - TAVERN_ENTRY.feet[0], inside.z - TAVERN_ENTRY.feet[2]) <= 1.7, 'arrived just inside the tavern door');
  assert.equal(body(square), undefined, 'no walker is left on the square');
  report.inside = { feet: [inside.x, inside.y, inside.z], yaw: inside.yaw };
  report.checks.push(`Inside the tavern as ${inside.name} with the same look, just inside the door (${inside.x.toFixed(2)}, ${inside.z.toFixed(2)}); the square holds no body.`);
  await page.waitForFunction(() => window.__chatdomTavernLive?.ready === true, null, { timeout: 60_000 });
  report.timings.insideToTavernDrawnMs = Date.now() - goingIn - report.timings.doorToInsideMs;
  if (stills) {
    await page.setViewportSize({ width: 1440, height: 900 }); await sleep(2_500);
    const path = `${evidence}/ga10-journey-inside@1440x900.png`; await mkdir(evidence, { recursive: true });
    await page.screenshot({ path }); report.stills.push(path.slice(evidence.length + 1));
    await page.setViewportSize({ width: 960, height: 600 }); await sleep(500);
  }

  // Out through the interior doorway, the way the room's own exit is drawn.
  const exitCentre = [(TAVERN_EXIT.min[0] + TAVERN_EXIT.max[0]) / 2, 0, (TAVERN_EXIT.min[2] + TAVERN_EXIT.max[2]) / 2];
  const pastExit = [exitCentre[0] + TAVERN_EXIT.through[0] * 1.2, 0, exitCentre[2] + TAVERN_EXIT.through[1] * 1.2];
  const goingOut = Date.now();
  await page.locator('canvas').last().click({ position: { x: 480, y: 300 } }).catch(() => {});
  await walk(inn, () => window.__chatdomTavernLive?.camera?.yaw, [[exitCentre[0], 0, body(inn).z], pastExit], async () => (await phases()).at(-1) !== 'inside', 'out through the interior doorway');
  // The old walk's debug goes with its scene; the street is back once a new walk has placed the camera.
  await page.evaluate(() => { delete window.__chatdomWalk; });
  await page.waitForFunction(() => window.__gatherDoor?.phases.at(-1) === 'idle', null, { timeout: 40_000 });
  const curtainUp = Date.now();
  const back = await until(() => body(square), 'the browser walker back on the square');
  await until(() => !body(inn), 'the tavern has let the walker go');
  report.timings.exitToCurtainUpMs = curtainUp - goingOut;
  await page.waitForFunction(() => window.__chatdomWalk?.ready === true && window.__chatdomWalk.owner === 'walking', null, { timeout: 200_000 });
  // How long the person looks at the gate opening again after the curtain has lifted (play's and the entry's timing).
  report.timings.curtainUpToStreetDrawnMs = Date.now() - curtainUp;
  const anchor = portal.returnAnchor;
  report.back = { feet: [back.x, back.y, back.z], yaw: back.yaw, anchor };
  assert.equal(back.name, report.walker.name, 'the same name back outside'); assert.equal(back.look, report.walker.look, 'the same look back outside');
  assert.ok(Math.hypot(back.x - anchor.feet[0], back.z - anchor.feet[2]) < .05, `back outside at the return anchor (${back.x.toFixed(2)}, ${back.z.toFixed(2)})`);
  assert.equal(back.yaw, anchor.yaw, 'facing out of the door');
  report.checks.push(`Back on the street outside the door at the return anchor, facing out (yaw ${back.yaw}), as ${back.name} with the same look; the tavern holds no body.`);
  if (stills) {
    await page.setViewportSize({ width: 1440, height: 900 }); await sleep(3_000);
    const path = `${evidence}/ga10-journey-back@1440x900.png`;
    await page.screenshot({ path }); report.stills.push(path.slice(evidence.length + 1));
  }
  report.phases = await phases();
  report.lockSeconds = Math.round((Date.now() - locked) / 1000);
  await browser.close(); browser = undefined;
  await release(); release = undefined;

  square.onStateChange.remove(sample); inn.onStateChange.remove(sample);
  report.samples = { ...samples, names: [...seen.names], looks: [...seen.looks] };
  assert.equal(samples.both, 0, 'never in both rooms'); assert.equal(samples.duplicate ?? 0, 0, 'never two bodies in one room');
  assert.equal(seen.names.size, 1, 'one name throughout'); assert.equal(seen.looks.size, 1, 'one look throughout');
  const order = report.phases.filter((phase, index, all) => phase !== all[index - 1]);
  assert.deepEqual(order, ['idle', 'leaving', 'joining', 'inside', 'returning', 'idle'], `play's phases in order (${order.join(' → ')})`);
  report.checks.push(`Sampled on every patch of both rooms (square ${samples.square}, tavern ${samples.tavern}, between ${samples.neither}, both ${samples.both}); play's phases ran ${order.join(' → ')}.`);
  assert.deepEqual(errors, [], 'no page errors');
  report.result = 'passed';
} catch (error) {
  report.result = 'failed'; report.error = String(error?.stack ?? error);
  if (diagnose) report.diagnosis = await diagnose().catch(cause => String(cause));
  if (browser) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: '/tmp/chatdom-gather/door/failure.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await release?.().catch(() => {});
  for (const room of rooms) await room.leave().catch(() => {});
  await realm?.gracefullyShutdown?.(false).catch(() => {});
  await new Promise(resolve => web ? web.close(resolve) : resolve());
  await loader?.close().catch(() => {});
  report.finished = new Date().toISOString();
  await mkdir(evidence, { recursive: true });
  await writeFile(`${evidence}/ga10-journey.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[door] ${report.result}${report.error ? `: ${report.error.split('\n')[0]}` : ''}`);
  process.exit();
}
