/* global AbortController, requestAnimationFrame, structuredClone */
// Eight temporary reference identities in one real tavern; no teleport or fixture seats.
// Run only against the frozen build: GATHER_WEB_DIST=/absolute/build GATHER_EVIDENCE=ga10-populated node apps/web/src/games/populated-room.mjs
import assert from 'node:assert/strict';
import { createServer as probeServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setInterval, clearInterval, setTimeout, clearTimeout } from 'node:timers';
import { chromium } from '@playwright/test';
import { Client } from '@colyseus/sdk';
import { createServer, preview } from 'vite';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { listenLocalRealm } from './local-listener.mjs';
import { captureSize } from './capture-size.mjs';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${repo}/work/evidence/gather`;
const shotSizes = [captureSize('phone')];
const host = process.env.GATHER_HOST ?? '127.0.0.1';
assert.ok(['127.0.0.1', '127.0.0.10'].includes(host));
const prefix = process.env.GATHER_EVIDENCE ?? 'ga10-populated';
assert.match(prefix, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const cancel = new AbortController();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (cancel.signal.aborted) throw cancel.signal.reason;
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await sleep(30);
  }
}
async function freePorts() {
  const free = [];
  for (const port of [5170, 5171, 5172, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5182, 5183, 5184, 5185, 5186, 5188, 5189].reverse()) {
    const probe = probeServer();
    if (await new Promise(resolve => { probe.once('error', () => resolve(false)); probe.listen(port, host, () => probe.close(() => resolve(true))); })) free.push(port);
    if (free.length === 2) return free;
  }
  throw new Error('Two safe capture ports are not available.');
}
const report = { started: new Date().toISOString(), fixture: 'Eight synthetic temporary reference sessions, memory only.',
  limitations: ['No Twitch identity, durable session, persistence or portal transfer is demonstrated.', 'SwiftShader screenshots and draw counts are not real-GPU FPS evidence.', 'Authority samples and browser public state are recorded separately; they need not be the exact rendered frame.'], checks: [], screenshots: [] };
let release, loader, realm, web, browser, timer, paddleTimer, motionTimer, lockAt, spectator;
const rooms = [], errors = [];
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cancel.abort(new Error(`Cancelled by ${signal}`)); void browser?.close().catch(() => {}); });
try {
  release = await acquireCaptureLock({ signal: cancel.signal });
  lockAt = Date.now();
  report.lockAcquired = new Date(lockAt).toISOString();
  console.log(`[gather] capture lease acquired ${report.lockAcquired}`);
  timer = setTimeout(() => { cancel.abort(new Error('Capture exceeded the 270-second lock budget.')); void browser?.close().catch(() => {}); }, 270000);
  const [realmPort, webPort] = await freePorts();
  report.ports = { host, realm: realmPort, web: webPort };
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: '/tmp/chatdom-gather/vite-populated-loader', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false } });
  const [{ createRealmServer }, { referenceServices }, { starterCitizenLook, TavernRoomState }, { createTavernInterior }, { seatApproachDriver }, { installGatherStore, MemoryGatherStore }] = await Promise.all([
    loader.ssrLoadModule('/apps/realm/src/server.ts'), loader.ssrLoadModule('/apps/realm/src/reference.ts'),
    loader.ssrLoadModule('/packages/shared/src/index.ts'), loader.ssrLoadModule('/apps/realm/src/games/interior.ts'),
    loader.ssrLoadModule('/apps/web/src/games/walker.ts'), loader.ssrLoadModule('/apps/realm/src/games/store.ts'),
  ]);
  const base = referenceServices();
  const services = { ...base, auth: { ...base.auth, authenticate: async join => { const principal = await base.auth.authenticate(join); return { ...principal, look: starterCitizenLook(principal.personId) }; } } };
  installGatherStore(services, new MemoryGatherStore());
  const created = createRealmServer(services); realm = created.server;
  created.transport.app.post('/reference/session', response => response.writeHeader('Access-Control-Allow-Origin', '*').writeHeader('Cache-Control', 'no-store').writeHeader('Content-Type', 'application/json').end(JSON.stringify(base.issue())));
  await listenLocalRealm(realm, created.transport, realmPort, host);
  const endpoint = `http://${host}:${realmPort}`;
  web = await preview({ root: `${repo}/apps/web`, configFile: `${repo}/apps/web/vite.config.ts`, logLevel: 'error', ...(process.env.GATHER_WEB_DIST ? { build: { outDir: process.env.GATHER_WEB_DIST } } : {}), preview: { host, port: webPort, strictPort: true, proxy: { '/live-realm-data': { target: endpoint, ws: true, rewrite: path => path.replace(/^\/live-realm-data/, '') } } } });
  const sdk = new Client(endpoint);
  async function join() {
    const room = await sdk.joinOrCreate('tavern', base.issue(), TavernRoomState);
    room.reconnection.enabled = false; rooms.push(room);
    const state = { tables: null, self: null, receipts: new Map() };
    for (const type of ['interior', 'transient', 'receipt']) room.onMessage(type, () => {});
    room.onMessage('private', message => { if (message.type === 'receipt') state.receipts.set(message.receipt.id, message.receipt); });
    room.onMessage('tables', message => { state.tables = message; });
    room.onMessage('self', message => { state.self = message; });
    room.send('bootstrap');
    await until(() => state.tables && state.self && room.state.walkers.get(room.sessionId), 'SDK bootstrap');
    return { room, state };
  }
  const players = [];
  for (let i = 0; i < 7; i++) players.push(await join());
  assert.equal(new Set(players.map(p => p.room.roomId)).size, 1, 'all reference sessions share a tavern');
  spectator = players[6];
  const interior = createTavernInterior();
  const assignments = [['middle', 1], ['middle', 2], ['west', 1], ['west', 2], ['hearth', 3], ['hearth', 4]];
  const drivers = assignments.map(([table, chair], index) => {
    const player = players[index], target = interior.registry.get(`tavern:${table}:seat:${chair}`);
    assert.ok(target, `authored chair ${table}/${chair}`);
    const body = player.room.state.walkers.get(player.room.sessionId);
    return { player, table, chair, target, driver: seatApproachDriver(interior.world, [body.x, body.y, body.z], target.target.approach, [14, 10]), input: player.room.input({ mode: 'reliable' }) };
  });
  const spectatorBodyAtStart = spectator.room.state.walkers.get(spectator.room.sessionId);
  const spectatorGoal = [5.75, .125, 2.625];
  const spectatorDriver = { player: spectator, driver: seatApproachDriver(interior.world, [spectatorBodyAtStart.x, spectatorBodyAtStart.y, spectatorBodyAtStart.z], spectatorGoal, [14, 10]), input: spectator.room.input({ mode: 'reliable' }) };
  const walkers = [...drivers, spectatorDriver];
  motionTimer = setInterval(() => { for (const item of walkers) { const body = item.player.room.state.walkers.get(item.player.room.sessionId); if (body && !item.driver.done) { Object.assign(item.input.data, item.driver.input(body), { placement: body.placement }); item.input.send(); } } }, 1000 / 30);
  await until(() => walkers.every(item => item.driver.done), 'six walkers reach chairs and spectator reaches bar floor', 90000);
  clearInterval(motionTimer); motionTimer = undefined;
  for (const item of drivers) item.player.room.send('intent', { version: 1, type: 'interact', id: `seat-${item.table}-${item.chair}`, targetId: item.target.target.id, action: 'tavern' });
  await until(() => drivers.every(item => item.player.state.receipts.has(`seat-${item.table}-${item.chair}`)), 'chair receipts');
  for (const item of drivers) assert.equal(item.player.state.receipts.get(`seat-${item.table}-${item.chair}`).status, 'applied');
  await until(() => drivers.every(item => item.player.state.self.table === item.table && item.player.state.self.seatIndex === item.chair - 1), 'six actual seated walkers');
  report.seats = drivers.map(({ player, table, chair, target }) => { const body = spectator.room.state.walkers.get(player.room.sessionId); return { table, chair, target: target.target.id, position: [body.x, body.y, body.z], sessionId: player.room.sessionId }; });
  const spectatorPose = spectator.room.state.walkers.get(spectator.room.sessionId);
  assert.ok(Math.hypot(spectatorPose.x - spectatorGoal[0], spectatorPose.z - spectatorGoal[2]) < .15, 'spectator physically reached bar floor');
  assert.equal(spectator.state.self.table, null, 'spectator remains unseated');
  report.checks.push('Six SDK walkers physically approached and obtained authored chairs through interaction receipts; a seventh walked unseated to the bar floor.');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text()); });
  await page.goto(`http://${host}:${webPort}/-/tavern?testWalker=1&seed=42&hour=20`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chatdomReady || window.__chatdomTavernError, null, { timeout: 90000 });
  assert.equal(await page.evaluate(() => window.__chatdomTavernError), undefined);
  await until(() => spectator.room.state.walkers.size === 8, 'spectator observes eight real room walkers');
  assert.equal(await page.evaluate(() => window.__chatdomTavernLive?.seated), null, 'browser stands without a seat');
  const browserId = [...spectator.room.state.walkers.keys()].find(id => !players.some(player => player.room.sessionId === id));
  assert.ok(browserId, 'browser has a distinct room walker');
  const browserBody = spectator.room.state.walkers.get(browserId);
  report.browserWalker = { sessionId: browserId, position: [browserBody.x, browserBody.y, browserBody.z], seated: null };
  const spectatorBody = spectator.room.state.walkers.get(spectator.room.sessionId);
  report.spectator = { sessionId: spectator.room.sessionId, position: [spectatorBody.x, spectatorBody.y, spectatorBody.z] };
  const table = (p, id) => p.state.tables.tables.find(t => t.table === id);
  for (const [i, id] of [[0, 'middle'], [2, 'west'], [4, 'hearth']]) players[i].room.send('start', { table: id, revision: table(players[i], id).revision, id: `start-${id}` });
  await until(() => table(spectator, 'middle')?.pong && table(spectator, 'west')?.stones?.phase === 'playing' && table(spectator, 'hearth')?.dice?.phase === 'playing', 'three simultaneous public matches');
  const game = (id, kind) => table(spectator, id)?.[kind];
  let sequence = 0;
  paddleTimer = setInterval(() => { const pong = game('middle', 'pong'); if (pong && ['serve', 'rally'].includes(pong.phase)) for (let i = 0; i < 2; i++) players[i].room.send('paddle', { match: pong.match, sequence: ++sequence, paddle: pong.ball.x }); }, 80);
  async function move(id, kind, action, extra = {}) {
    const current = structuredClone(game(id, kind));
    const actor = id === 'west' ? players[2 + current.turn] : players[4 + current.turn];
    actor.room.send('move', { action, table: id, match: current.match, revision: current.revision, id: `${id}-${action}-${current.revision}`, ...extra });
    await until(() => game(id, kind)?.revision > current.revision, `${id} ${action} accepted`);
    return current;
  }
  for (const column of [0, 1, 2, 3]) await move('west', 'stones', 'drop', { column });
  assert.equal(game('west', 'stones').board.filter(Boolean).length, 4, 'four actual Stones counters');
  let rolls = 0;
  while (!game('hearth', 'dice').pot && rolls++ < 20) await move('hearth', 'dice', 'roll');
  assert.ok(game('hearth', 'dice').pot > 0, 'accepted roll produces a bankable pot');
  await move('hearth', 'dice', 'hold');
  assert.ok(game('hearth', 'dice').scores.some(score => score > 0), 'accepted hold banks points');
  await until(() => game('middle', 'pong')?.phase === 'rally', 'Pong reaches a live rally');
  report.checks.push('Three simultaneous games started; four Stones counters and a Dice roll and hold were accepted.');
  await mkdir(output, { recursive: true });
  for (const [label, width, height] of shotSizes.map(([w, h]) => ['room', w, h])) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => window.__chatdomTavern && window.__chatdomTavernLive?.tables?.find(t => t.table === 'middle')?.pong?.phase === 'rally', null, { timeout: 30000 });
    await page.waitForFunction(({ width, height }) => {
      const viewport = window.__chatdomTavernLive?.nameViewport;
      return viewport?.width === width && viewport?.height === height;
    }, { width, height }, { timeout: 15000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const before = structuredClone(spectator.state.tables.tables);
    const browserState = await page.evaluate(() => ({ telemetry: window.__chatdomTavern, live: window.__chatdomTavernLive,
      names: [...document.querySelectorAll('.gather-citizen-name[data-citizen-id]')].map(element => {
        const rect = element.getBoundingClientRect();
        return { id: element.dataset.citizenId, name: element.textContent, left: rect.left, top: rect.top,
          right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      }), overflow: document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight }));
    assert.equal(browserState.overflow, false, 'viewport has no document overflow');
    assert.ok(browserState.names.length > 0, 'visible walkers retain readable names');
    for (const [index, name] of browserState.names.entries()) {
      assert.ok(name.width > 0 && name.height > 0, 'a name occupies actual rendered text');
      assert.ok(name.left >= 0 && name.top >= 0 && name.right <= width && name.bottom <= height, 'complete name stays inside the viewport');
      assert.equal(browserState.live.walkers.find(walker => walker.id === name.id)?.name, name.name, 'name identifies its actual public walker');
      for (const other of browserState.names.slice(index + 1)) assert.ok(name.right <= other.left || other.right <= name.left || name.bottom <= other.top || other.bottom <= name.top, 'rendered citizen names do not overlap');
    }
    for (const key of ['draws', 'roomDraws', 'citizenDraws', 'triangles', 'dynamicLights', 'bakedWarmSources']) assert.equal(typeof browserState.telemetry[key], 'number', `missing telemetry ${key}`);
    const telemetry = browserState.telemetry;
    assert.ok(telemetry.draws > 0 && telemetry.roomDraws > 0 && telemetry.citizenDraws > 0 && telemetry.triangles > 0, 'draw and triangle counts are positive');
    assert.equal(telemetry.roomDraws + telemetry.citizenDraws, telemetry.draws, 'room and citizen draws sum to total');
    assert.ok(telemetry.roomDraws <= (width === 390 ? 12 : 24), `room draw budget at ${width}px: ${telemetry.roomDraws}`);
    assert.equal(telemetry.dynamicLights, 1, 'one dynamic light');
    const liveTables = browserState.live?.tables ?? [];
    for (const [id, kind] of [['middle', 'pong'], ['west', 'stones'], ['hearth', 'dice']]) {
      const local = liveTables.find(item => item.table === id)?.[kind], authority = before.find(item => item.table === id)?.[kind];
      assert.ok(local && authority && local.match === authority.match, `${id} browser observes the active public match`);
      assert.ok(kind === 'pong' ? local.phase === 'rally' : local.phase === 'playing', `${id} browser match remains live`);
    }
    assert.equal(liveTables.find(item => item.table === 'west').stones.board.filter(Boolean).length, 4, 'browser observes four counters');
    assert.ok(liveTables.find(item => item.table === 'hearth').dice.scores.some(score => score > 0), 'browser observes banked Dice score');
    const path = `${output}/${prefix}-${label}@${width}x${height}.png`;
    await page.screenshot({ path });
    report.screenshots.push({ path, browser: browserState, authorityBefore: before, authorityAfter: structuredClone(spectator.state.tables.tables) });
    console.log(`[gather] ${path}`);
  }
  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  for (const id of ['middle', 'west', 'hearth']) {
    const kind = id === 'middle' ? 'pong' : id === 'west' ? 'stones' : 'dice';
    await until(() => { const a = table(spectator, id)?.[kind], b = table(players[0], id)?.[kind]; return a && b && a.match === b.match && (id === 'middle' ? a.phase === b.phase : JSON.stringify(a) === JSON.stringify(b)); }, `spectator agrees on ${id}`, 10000);
  }
  report.checks.push('A seventh SDK spectator observed eight walkers and agreed with another SDK client on each public table.');
  report.checks.push('Actual rendered name rectangles stay in the viewport, do not overlap and retain their corresponding public walker names.');
} catch (error) {
  process.exitCode = 1;
  report.failure = error instanceof Error ? error.stack : String(error);
  report.lastPublicTables = structuredClone(spectator?.state.tables?.tables ?? null);
  throw error;
} finally {
  clearInterval(motionTimer); clearInterval(paddleTimer); clearTimeout(timer);
  report.lockHeldMs = lockAt ? Date.now() - lockAt : null;
  report.browserErrors = errors;
  try {
    await mkdir(output, { recursive: true });
    const text = JSON.stringify(report, null, 2);
    assert.ok(!/"(?:seed|cursor)"\s*:/.test(text), 'private RNG must not enter evidence');
    const path = `${output}/${prefix}-${report.failure ? 'failure' : 'report'}.json`;
    await writeFile(path, `${text}\n`); console.log(`[gather] ${path}`);
  } finally {
    await browser?.close().catch(() => {});
    await Promise.all(rooms.map(room => room.leave().catch(() => {})));
    if (web) await new Promise(resolve => web.httpServer.close(resolve));
    await realm?.gracefullyShutdown(false).catch(() => {});
    await loader?.close().catch(() => {});
    await release?.();
  }
}
