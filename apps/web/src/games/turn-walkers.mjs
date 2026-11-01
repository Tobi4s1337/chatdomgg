/* global AbortController, requestAnimationFrame, structuredClone */
// Real tavern transport and three SDK walkers; local, memory-only reference sessions.
// Run: nice -n 10 node apps/web/src/games/turn-walkers.mjs
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
  for (const port of [5170, 5171, 5172, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5182, 5183, 5184, 5185, 5186, 5188, 5189]) {
    const probe = createPortProbe();
    if (await new Promise(resolve => {
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    })) free.push(port);
    if (free.length === 2) return free;
  }
  throw new Error('Two safe capture ports are not available.');
};
const kind = process.env.GATHER_GAME ?? 'stones';
assert.ok(['stones', 'hearth-dice'].includes(kind));
const tableId = kind === 'stones' ? 'west' : 'hearth';
const ownChair = kind === 'stones' ? 1 : 3, browserChair = ownChair + 1;
const prefix = kind === 'stones' ? 'stones' : 'dice';
const report = { started: new Date().toISOString(), fixture: 'Temporary reference sessions with synthetic identities; memory only.',
  limitations: ['No kingdom-to-tavern transfer, Twitch identity, durable session, persistence or real-GPU performance is proven.',
    'Screenshots use SwiftShader; no frame-rate claim.'], checks: [], scores: [], revisions: [], screenshots: [] };
let loader, realm, web, browser, release, motion, lockAcquiredAt, lockDeadline, measurement, player, spectator;
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
    room.onMessage('tables', message => { state.tables = message; const view = message.tables.find(t => t.table === tableId)?.[kind === 'stones' ? 'stones' : 'dice']; if (view && room === player?.room && report.revisions.at(-1)?.revision !== view.revision) report.revisions.push(structuredClone(view)); });
    room.onMessage('self', message => { state.self = message; });
    room.send('bootstrap');
    await until(() => state.tables && state.self && room.state.walkers.get(room.sessionId), 'headless room bootstrap');
    return { room, state };
  };
  player = await join(); spectator = await join();
  assert.equal(player.room.roomId, spectator.room.roomId);
  const interior = createTavernInterior(), target = interior.registry.get(`tavern:${tableId}:seat:${ownChair}`);
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
  await until(() => player.state.self.table === tableId && player.state.self.seatIndex === ownChair - 1, 'headless seat');
  report.checks.push(`The first SDK walker walked through room collision and obtained chair ${ownChair} from the interaction authority.`);

  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text()); });
  page.on('requestfailed', request => console.error(`[gather] request failed ${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', response => { if (response.status() >= 400) console.error(`[gather] HTTP ${response.status()} ${response.url()}`); });
  await page.goto(`http://127.0.0.1:${webPort}/-/tavern?testWalker=1&seat=tavern:${tableId}:seat:${browserChair}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chatdomReady || window.__chatdomTavernError, null, { timeout: 90_000 });
  const setupError = await page.evaluate(() => window.__chatdomTavernError);
  assert.equal(setupError, undefined, `browser admission failed: ${setupError}`);
  try {
    // A real visitor can sit as soon as the chair prompt is actionable; the test walker need not reach a particular grid point.
    await page.waitForFunction(({ chair, table }) => window.__chatdomTavernLive?.interaction?.focus === chair
      && window.__chatdomTavernLive?.interaction?.action === 'tavern' || window.__chatdomTavernLive?.seated === table
      || window.__chatdomTavernError, { chair: `tavern:${tableId}:seat:${browserChair}`, table: tableId }, { timeout: 90_000 });
    if (await page.evaluate(table => window.__chatdomTavernLive?.seated !== table, tableId)) await page.keyboard.press('KeyE');
    await page.waitForFunction(table => window.__chatdomTavernLive?.seated === table || window.__chatdomTavernError, tableId, { timeout: 15_000 });
  }
  catch (error) {
    console.error('[gather] seat diagnostic', JSON.stringify(await page.evaluate(() => ({ live: window.__chatdomTavernLive, error: window.__chatdomTavernError }))));
    await mkdir(output, { recursive: true });
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width, height }); await sleep(800);
      const path = `${output}/ga10-${prefix}-walk@${width}x${height}.png`;
      await page.screenshot({ path }); console.error(`[gather] ${path}`);
    }
    throw error;
  }
  assert.equal(await page.evaluate(() => window.__chatdomTavernLive?.seated), tableId, 'browser walker reached and sat at its chair');
  await until(() => player.state.tables.tables.find(table => table.table === tableId) && [...player.state.tables.tables.find(table => table.table === tableId).seats, ...(player.state.tables.tables.find(table => table.table === tableId).extraSeats ?? [])].filter(Boolean).length === 2, 'two occupied chairs');
  await until(() => spectator.room.state.walkers.size === 3, 'third observer sees three walkers');
  report.checks.push('Browser walker walked and sat at the opposite chair; a third SDK walker saw all three in one room.');
  const game = () => player.state.tables.tables.find(t => t.table === tableId)?.[kind === 'stones' ? 'stones' : 'dice'];
  const watched = () => spectator.state.tables.tables.find(t => t.table === tableId)?.[kind === 'stones' ? 'stones' : 'dice'];
  const sockets = [player, spectator].map(({ room }) => {
    const socket = room.connection.transport.ws, counts = { received: 0, sent: 0 };
    socket.addEventListener('message', event => { counts.received += event.data.byteLength ?? Buffer.byteLength(event.data); });
    const send = socket.send.bind(socket);
    socket.send = data => { counts.sent += data.byteLength ?? Buffer.byteLength(data); send(data); };
    return counts;
  });
  measurement = { sockets, measuredAt: Date.now() };
  await page.getByRole('button', { name: kind === 'stones' ? 'Play Stones' : 'Play Hearth Dice' }).click();
  await until(() => game()?.phase === 'playing', 'match starts');
  if (kind === 'hearth-dice') assert.equal(game().scores.length, 2, 'sparse physical chairs map to two players');
  let moves = 0, captured = false, browserMoves = 0;
  while (game().phase === 'playing' && moves < 200) {
    const current = game(), revision = current.revision;
    const action = kind === 'stones' ? 'drop' : current.pot >= 10 || current.scores[current.turn] + current.pot >= 50 ? 'hold' : 'roll';
    if (current.turn === 0) {
      player.room.send('move', { action, table: tableId, match: current.match, revision, id: `walker-${moves}`, ...(action === 'drop' ? { column: 0 } : {}) });
    } else {
      const label = kind === 'stones' ? 'Drop stone in column 2' : action === 'roll' ? 'Roll' : 'Hold';
      await page.getByRole('button', { name: label, exact: true }).click({ timeout: 15_000 });
      browserMoves++;
    }
    await until(() => game()?.revision > revision, `accepted ${action} revision ${revision}`, 15_000);
    moves++;
    if (!captured && moves >= 2 && game().phase === 'playing') {
      await mkdir(output, { recursive: true });
      for (const [width, height] of [[1440, 900], [390, 844]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const path = `${output}/ga10-${prefix}-live@${width}x${height}.png`;
        await page.screenshot({ path }); report.screenshots.push({ path, revision: game().revision }); console.log(`[gather] ${path}`);
      }
      captured = true;
    }
  }
  assert.ok(browserMoves > 0, 'browser acted through actual controls');
  assert.equal(game().phase, 'finished', 'match completed within 200 moves');
  await until(() => watched()?.phase === 'finished' && watched().revision === game().revision, 'spectator final');
  assert.deepEqual(watched(), game(), 'spectator sees same public final');
  if (kind === 'stones') {
    assert.equal(moves, 7); assert.equal(game().winner, 0); assert.equal(game().reason, 'four');
  } else {
    assert.equal(game().reason, 'fifty'); assert.ok(game().scores[game().winner] >= 50);
  }
  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  report.checks.push(`Completed ${kind} with ${moves} accepted moves including ${browserMoves} browser actions; spectator received the same final state.`);
  report.result = structuredClone(game());
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  clearInterval(motion); clearTimeout(lockDeadline);
  try {
    if (measurement) {
      const seconds = (Date.now() - measurement.measuredAt) / 1000;
      report.payloadBytesPerSecond = { seconds, scope: 'WebSocket message payload only; excludes framing and network headers',
        player: { received: measurement.sockets[0].received / seconds, sent: measurement.sockets[0].sent / seconds },
        spectator: { received: measurement.sockets[1].received / seconds, sent: measurement.sockets[1].sent / seconds } };
    }
    report.lockHeldMs = lockAcquiredAt ? Date.now() - lockAcquiredAt : null;
    const publicJson = JSON.stringify(report);
    assert.ok(!/"(?:seed|cursor)"\s*:/.test(publicJson), 'private random state must never enter public evidence');
    await mkdir(output, { recursive: true });
    const reportPath = `${output}/ga10-${prefix}-${report.failure ? 'failure' : 'browser-match'}.json`;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[gather] ${reportPath}`);
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
