/* global AbortController, requestAnimationFrame */
// Real tavern transport and three SDK walkers; local, memory-only reference sessions.
// Run: nice -n 10 node apps/web/src/games/two-walkers.mjs
import assert from 'node:assert/strict';
import { createServer as createPortProbe } from 'node:net';
import { Buffer } from 'node:buffer';
import { setInterval, clearInterval, setTimeout, clearTimeout } from 'node:timers';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { Client } from '@colyseus/sdk';
import { createServer, preview } from 'vite';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${repo}/work/evidence/gather`;
const lockedInput = process.env.GATHER_INPUT === 'locked';
const imagePrefix = lockedInput ? 'ga10-pong-input' : 'ga10-pong-live';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, description, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (cancellation.signal.aborted) throw cancellation.signal.reason;
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await sleep(30);
  }
};
const freePorts = async () => {
  const free = [];
  for (const port of [5171, 5172, 5173, 5182]) {
    const probe = createPortProbe();
    if (await new Promise(resolve => {
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    })) free.push(port);
    if (free.length === 2) return free;
  }
  throw new Error('Two safe capture ports are not available.');
};
const report = { started: new Date().toISOString(), fixture: 'Temporary reference sessions with synthetic identities; memory only.',
  limitations: ['No kingdom-to-tavern transfer, Twitch identity, durable session, persistence or real-GPU performance is proven.',
    'Screenshots use SwiftShader; no frame-rate claim.'], checks: [], scores: [], screenshots: [] };
let loader, realm, web, browser, release, motion, paddle, lockAcquiredAt, lockDeadline, measurement, player, spectator;
const rooms = [];
const cancellation = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  cancellation.abort(new Error(`Capture cancelled by ${signal}`));
  void browser?.close().catch(() => {});
});
try {
  release = await acquireCaptureLock({ signal: cancellation.signal });
  lockAcquiredAt = Date.now();
  lockDeadline = setTimeout(() => {
    cancellation.abort(new Error('Capture exceeded its four-and-a-half-minute budget.'));
    void browser?.close().catch(() => {});
  }, 270_000);
  const [realmPort, webPort] = await freePorts();
  report.ports = { realm: realmPort, web: webPort };
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: '/tmp/chatdom-gather/vite-harness-loader', optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false } });
  const [{ createRealmServer }, { referenceServices }, { starterCitizenLook, TavernRoomState }, { createTavernInterior }, { seatApproachDriver }, { installGatherStore, MemoryGatherStore }] = await Promise.all([
    loader.ssrLoadModule('/apps/realm/src/server.ts'), loader.ssrLoadModule('/apps/realm/src/reference.ts'),
    loader.ssrLoadModule('/packages/shared/src/index.ts'), loader.ssrLoadModule('/apps/realm/src/games/interior.ts'),
    loader.ssrLoadModule('/apps/web/src/games/walker.ts'), loader.ssrLoadModule('/apps/realm/src/games/store.ts'),
  ]);
  const base = referenceServices();
  const services = { ...base, auth: { ...base.auth, authenticate: async join => {
    const principal = await base.auth.authenticate(join);
    return { ...principal, look: starterCitizenLook(principal.personId) };
  } } };
  installGatherStore(services, new MemoryGatherStore());
  const created = createRealmServer(services); realm = created.server;
  created.transport.app.post('/reference/session', response => response.writeHeader('Access-Control-Allow-Origin', '*')
    .writeHeader('Cache-Control', 'no-store').writeHeader('Content-Type', 'application/json').end(JSON.stringify(base.issue())));
  await realm.listen(realmPort, '127.0.0.1');
  const endpoint = `http://127.0.0.1:${realmPort}`;
  web = await preview({ root: `${repo}/apps/web`, configFile: `${repo}/apps/web/vite.config.ts`, logLevel: 'error',
    preview: { host: '127.0.0.1', port: webPort, strictPort: true,
      proxy: { '/live-realm-data': { target: endpoint, ws: true, rewrite: path => path.replace(/^\/live-realm-data/, '') } } } });
  const sdk = new Client(endpoint);
  const join = async () => {
    const room = await sdk.joinOrCreate('tavern', base.issue(), TavernRoomState);
    room.reconnection.enabled = false; rooms.push(room);
    const state = { tables: null, self: null, receipt: null };
    for (const type of ['interior', 'transient', 'receipt']) room.onMessage(type, () => {});
    room.onMessage('private', message => { if (message.type === 'receipt') state.receipt = message.receipt; });
    room.onMessage('tables', message => { state.tables = message; });
    room.onMessage('self', message => { state.self = message; });
    room.send('bootstrap');
    await until(() => state.tables && state.self && room.state.walkers.get(room.sessionId), 'headless room bootstrap');
    return { room, state };
  };
  player = await join(); spectator = await join();
  assert.equal(player.room.roomId, spectator.room.roomId);
  const interior = createTavernInterior(), target = interior.registry.get('tavern:middle:seat:1');
  assert.ok(target, 'authored chair exists');
  const body = player.room.state.walkers.get(player.room.sessionId);
  const driver = seatApproachDriver(interior.world, [body.x, body.y, body.z], target.target.approach, [14, 10]);
  const input = player.room.input({ mode: 'reliable' });
  motion = setInterval(() => {
    const current = player.room.state.walkers.get(player.room.sessionId);
    if (current && !driver.done) { Object.assign(input.data, driver.input(current), { placement: current.placement }); input.send(); }
  }, 1000 / 30);
  await until(() => driver.done, 'headless player walks to chair', 30_000);
  clearInterval(motion); motion = undefined;
  player.room.send('intent', { version: 1, type: 'interact', id: 'headless-chair', targetId: target.target.id, action: 'tavern' });
  await until(() => player.state.receipt?.id === 'headless-chair', 'headless chair receipt');
  assert.equal(player.state.receipt.status, 'applied', 'server admits chair only after walk');
  await until(() => player.state.self.table === 'middle' && player.state.self.seat === 0, 'headless seat');
  report.checks.push('The first SDK walker walked through room collision and obtained chair 1 from the interaction authority.');

  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text()); });
  page.on('requestfailed', request => console.error(`[gather] request failed ${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', response => { if (response.status() >= 400) console.error(`[gather] HTTP ${response.status()} ${response.url()}`); });
  await page.goto(`http://127.0.0.1:${webPort}/-/tavern?testWalker=1&seat=tavern:middle:seat:2`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chatdomReady || window.__chatdomTavernError, null, { timeout: 90_000 });
  const setupError = await page.evaluate(() => window.__chatdomTavernError);
  assert.equal(setupError, undefined, `browser admission failed: ${setupError}`);
  try {
    // A real visitor can sit as soon as the chair prompt is actionable; the test walker need not reach a particular grid point.
    await page.waitForFunction(() => window.__chatdomTavernLive?.interaction?.focus === 'tavern:middle:seat:2'
      && window.__chatdomTavernLive?.interaction?.action === 'tavern' || window.__chatdomTavernLive?.seated === 'middle'
      || window.__chatdomTavernError, null, { timeout: 50_000 });
    if (await page.evaluate(() => window.__chatdomTavernLive?.seated !== 'middle')) await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__chatdomTavernLive?.seated === 'middle' || window.__chatdomTavernError, null, { timeout: 15_000 });
  }
  catch (error) {
    console.error('[gather] seat diagnostic', JSON.stringify(await page.evaluate(() => ({ live: window.__chatdomTavernLive, error: window.__chatdomTavernError }))));
    await mkdir(output, { recursive: true });
    for (const [width, height] of lockedInput ? [] : [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width, height }); await sleep(800);
      const path = `${output}/ga10-walk-live@${width}x${height}.png`;
      await page.screenshot({ path }); console.error(`[gather] ${path}`);
    }
    throw error;
  }
  assert.equal(await page.evaluate(() => window.__chatdomTavernLive?.seated), 'middle', 'browser walker reached and sat at its chair');
  await until(() => player.state.tables.tables.find(table => table.table === 'middle')?.seats.every(Boolean), 'two occupied chairs');
  await until(() => spectator.room.state.walkers.size === 3, 'third observer sees three walkers');
  report.checks.push('Browser walker walked and sat at the opposite chair; a third SDK walker saw all three in one room.');
  // WebSocket message payload bytes, including room patches and all table/self messages, excluding framing and IP overhead.
  const sockets = [player, spectator].map(({ room }) => {
    const socket = room.connection.transport.ws, counts = { received: 0, sent: 0 };
    socket.addEventListener('message', event => { counts.received += event.data.byteLength ?? Buffer.byteLength(event.data); });
    const send = socket.send.bind(socket);
    socket.send = data => { counts.sent += data.byteLength ?? Buffer.byteLength(data); send(data); };
    return counts;
  });
  const measuredAt = Date.now();
  measurement = { sockets, measuredAt };
  if (lockedInput) {
    const gameCanvas = page.locator('canvas[data-gather-game-input]');
    await gameCanvas.waitFor({ state: 'visible' });
    await gameCanvas.click({ position: { x: 30, y: 30 } });
    await page.waitForFunction(() => document.pointerLockElement?.matches('canvas[data-gather-game-input]'), null, { timeout: 10_000 });
    await page.keyboard.press('Enter');
  } else await page.getByRole('button', { name: 'Play Pong' }).click();
  await until(() => player.state.tables.tables.find(table => table.table === 'middle')?.pong, 'Pong start');
  const game = () => player.state.tables.tables.find(table => table.table === 'middle')?.pong;
  let sequence = 0;
  paddle = setInterval(() => { const pong = game(); if (pong && ['serve', 'rally'].includes(pong.phase)) player.room.send('paddle', { match: pong.match, sequence: ++sequence, paddle: 1 }); }, 80);
  await page.keyboard.down('KeyD');
  try {
    await until(() => game()?.acknowledged[1] >= 0 && Math.abs(game()?.paddles[1] ?? 0) > .1, 'browser paddle reaches server', 30_000);
  } catch (error) {
    console.error('[gather] paddle diagnostic', JSON.stringify({ game: game(), live: await page.evaluate(() => window.__chatdomTavernLive) }));
    await mkdir(output, { recursive: true });
    for (const [width, height] of lockedInput ? [] : [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width, height }); await sleep(800);
      const path = `${output}/${imagePrefix}@${width}x${height}.png`;
      await page.screenshot({ path }); report.screenshots.push({ path, authorityPhase: game()?.phase, score: game()?.score }); console.log(`[gather] ${path} (${game()?.phase})`);
    }
    throw error;
  } finally { await page.keyboard.up('KeyD'); }
  assert.equal(await page.evaluate(() => window.__chatdomTavernLive?.seated), 'middle', 'game key keeps the physical chair');
  report.checks.push('Browser D input moves its server-confirmed paddle without standing.');
  if (lockedInput) {
    assert.equal(await page.evaluate(() => document.pointerLockElement?.matches('canvas[data-gather-game-input]')), true, 'game canvas retains pointer lock after walking look disables');
    await page.mouse.move(700, 400);
    await sleep(250);
    const before = game().paddles[1], acknowledged = game().acknowledged[1];
    await page.mouse.move(580, 400, { steps: 4 });
    await until(() => game().acknowledged[1] > acknowledged && Math.abs(game().paddles[1] - before) > .05, 'mouse moves server-confirmed paddle', 10_000);
    assert.equal(await page.evaluate(() => document.pointerLockElement?.matches('canvas[data-gather-game-input]')), true, 'game canvas retains pointer lock after mouse movement');
    assert.equal(await page.evaluate(() => window.__chatdomTavernLive?.seated), 'middle');
    report.checks.push('Dedicated game canvas retains pointer lock and real mouse movement changes the server-confirmed paddle while seated.');
    report.mouse = { before, after: game().paddles[1], acknowledged: game().acknowledged[1] };
  }
  await until(() => game()?.phase === 'rally', 'live rally');
  await mkdir(output, { recursive: true });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await sleep(800);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const path = `${output}/${imagePrefix}@${width}x${height}.png`;
    const beforeCapture = { phase: game()?.phase, score: game()?.score };
    await page.screenshot({ path }); report.screenshots.push({ path, authorityBeforeCapture: beforeCapture, authorityAfterCapture: { phase: game()?.phase, score: game()?.score }, note: 'The rendered frame may lag either authority sample.' }); console.log(`[gather] ${path} (${game()?.phase})`);
  }
  let lastScore = '';
  await until(() => {
    const own = game(), other = spectator.state.tables.tables.find(table => table.table === 'middle')?.pong;
    if (!own || !other) return false;
    const score = own.score.join(':');
    if (score !== lastScore) { report.scores.push({ at: new Date().toISOString(), score: own.score, phase: own.phase }); lastScore = score; }
    return own.phase === 'finished' && other.phase === 'finished' && own.match === other.match && own.score.join(':') === other.score.join(':');
  }, 'complete match and matching spectator result', 150_000);
  const final = game();
  assert.equal(Math.max(...final.score), 7); assert.equal(final.reason, 'points');
  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  report.checks.push('A whole server-timed Pong match reached seven; the spectator received the same match and final score.');
  report.result = { score: final.score, winner: final.winner, reason: final.reason, roomId: player.room.roomId };
  if (lockedInput) {
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__chatdomTavernLive?.seated !== 'middle', null, { timeout: 10_000 });
    await page.waitForFunction(() => window.__chatdomTavernLive?.interaction?.focus === 'tavern:middle:seat:2' && window.__chatdomTavernLive?.interaction?.action === 'tavern', null, { timeout: 10_000 });
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__chatdomTavernLive?.seated === 'middle', null, { timeout: 10_000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__chatdomTavernLive?.seated !== 'middle', null, { timeout: 10_000 });
    report.checks.push('E stands, E sits again at the same physical chair, and Escape stands.');
  }
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  clearInterval(motion); clearInterval(paddle); clearTimeout(lockDeadline);
  try {
    if (measurement) {
      const seconds = (Date.now() - measurement.measuredAt) / 1000;
      report.payloadBytesPerSecond = { seconds, scope: 'WebSocket message payload only, including room state and all tables; excludes frame and network headers',
        player: { received: measurement.sockets[0].received / seconds, sent: measurement.sockets[0].sent / seconds },
        spectator: { received: measurement.sockets[1].received / seconds, sent: measurement.sockets[1].sent / seconds } };
      const final = player?.state.tables?.tables.find(table => table.table === 'middle')?.pong;
      const watched = spectator?.state.tables?.tables.find(table => table.table === 'middle')?.pong;
      if (final?.phase === 'finished') report.result = { score: final.score, winner: final.winner, reason: final.reason, match: final.match };
      if (watched?.phase === 'finished') report.spectatorResult = { score: watched.score, winner: watched.winner, reason: watched.reason, match: watched.match };
      await mkdir(output, { recursive: true });
      await writeFile(`${output}/${lockedInput ? 'ga10-pong-input' : 'ga10-pong-browser-match'}.json`, `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify(report, null, 2));
    }
  } finally {
    try {
      await browser?.close().catch(() => {});
      await Promise.all(rooms.map(room => room.leave().catch(() => {})));
      if (web) await new Promise(resolve => web.httpServer.close(resolve));
      await realm?.gracefullyShutdown(false).catch(() => {});
      await loader?.close().catch(() => {});
    } finally {
      await release?.();
      if (lockAcquiredAt) console.log(`[gather] capture lock held ${(Date.now() - lockAcquiredAt) / 1000}s`);
    }
  }
}
