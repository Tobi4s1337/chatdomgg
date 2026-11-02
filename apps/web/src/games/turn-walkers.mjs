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
import { listenLocalRealm } from './local-listener.mjs';
import { captureSize } from './capture-size.mjs';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${repo}/work/evidence/gather`;
const shotSizes = [captureSize()];
const host = process.env.GATHER_HOST ?? '127.0.0.1';
assert.ok(['127.0.0.1', '127.0.0.10'].includes(host), 'Only the two explicit local gather hosts are allowed');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, description, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (cancellation.signal.aborted) throw cancellation.signal.reason;
    if (Date.now() >= deadline) throw new Error(`Timed out: ${description}`);
    await sleep(30);
  }
};
// Inspection is emitted by the real live surface; all actions use the visible sound control.
async function checkSound(page, report) {
  const before = await page.evaluate(() => window.__chatdomTavernSound);
  assert.equal(before.status, 'ready');
  assert.equal(before.audible, true);
  assert.ok(before.peakSources <= 6 && before.peakVoices <= 6, `sound limits exceeded: ${JSON.stringify(before)}`);
  await page.getByRole('button', { name: 'Mute sound' }).click();
  await page.waitForFunction(() => window.__chatdomTavernSound?.activeSources === 0 && !window.__chatdomTavernSound?.audible, null, { timeout: 10_000 });
  const muted = await page.evaluate(() => window.__chatdomTavernSound);
  assert.equal(muted.activeVoices, 0);
  await page.getByRole('button', { name: 'Enable sound' }).click();
  await page.waitForFunction(() => window.__chatdomTavernSound?.status === 'ready' && window.__chatdomTavernSound?.audible
    && window.__chatdomTavernSound?.activeSources > 0, null, { timeout: 10_000 });
  await sleep(1000);
  const resumed = await page.evaluate(() => window.__chatdomTavernSound);
  const attacks = played => Object.fromEntries(Object.entries(played).filter(([cue]) => cue !== 'hearth' && cue !== 'murmur'));
  assert.deepEqual(attacks(resumed.played), attacks(muted.played), 'unmute must not replay stale attacks');
  assert.ok(resumed.peakSources <= 6 && resumed.peakVoices <= 6, `sound limits exceeded: ${JSON.stringify(resumed)}`);
  assert.ok((resumed.played.hearth ?? 0) > (muted.played.hearth ?? 0), 'hearth ambience resumes');
  report.sound = { before, muted, resumed };
  report.checks.push('Live accepted game sound played; standing mute stopped all sources, and enable resumed ambience without replaying attacks (peak six voices).');
}
const freePorts = async () => {
  const free = [];
  for (const port of [5170, 5171, 5172, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5182, 5183, 5184, 5185, 5186, 5188, 5189]) {
    const probe = createPortProbe();
    if (await new Promise(resolve => {
      probe.once('error', () => resolve(false));
      probe.listen(port, host, () => probe.close(() => resolve(true)));
    })) free.push(port);
    if (free.length === 2) return free;
  }
  throw new Error('Two safe capture ports are not available.');
};
const kind = process.env.GATHER_GAME ?? 'stones';
assert.ok(['stones', 'hearth-dice'].includes(kind));
const locked = process.env.GATHER_INPUT === 'locked';
const reconnect = locked && process.env.GATHER_RECONNECT === '1';
const tableId = kind === 'stones' ? 'west' : 'hearth';
const ownChair = kind === 'stones' ? 1 : 3, browserChair = ownChair + 1;
const prefix = `${kind === 'stones' ? 'stones' : 'dice'}${locked ? '-locked' : ''}`;
const evidencePrefix = process.env.GATHER_EVIDENCE;
assert.ok(evidencePrefix === undefined || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(evidencePrefix), 'GATHER_EVIDENCE must be a lowercase, hyphen-separated filename prefix');
const artifactPrefix = evidencePrefix ?? `ga10-${prefix}`;
const report = { started: new Date().toISOString(), fixture: 'Temporary reference sessions with synthetic identities; memory only.',
  limitations: ['No kingdom-to-tavern transfer, Twitch identity, durable session, persistence or real-GPU performance is proven.',
    'Screenshots use SwiftShader; no frame-rate claim.'], checks: [], scores: [], revisions: [], screenshots: [], soundedMoves: [] };
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
  report.lockAcquired = new Date(lockAcquiredAt).toISOString();
  console.log(`[gather] capture lease acquired ${report.lockAcquired}`);
  lockDeadline = setTimeout(() => {
    cancellation.abort(new Error('Capture exceeded its four-and-a-half-minute budget.'));
    void browser?.close().catch(() => {});
  }, 270_000);
  const [realmPort, webPort] = await freePorts();
  report.ports = { host, realm: realmPort, web: webPort };
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: '/tmp/chatdom-gather/vite-harness-loader', optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false } });
  const [{ createRealmServer }, { referenceServices }, { starterCitizenLook, TavernRoomState }, { createTavernInterior }, { seatApproachDriver }, { installGatherStore, MemoryGatherStore }, { severWalker }, { tickStones }] = await Promise.all([
    loader.ssrLoadModule('/apps/realm/src/server.ts'), loader.ssrLoadModule('/apps/realm/src/reference.ts'),
    loader.ssrLoadModule('/packages/shared/src/index.ts'), loader.ssrLoadModule('/apps/realm/src/games/interior.ts'),
    loader.ssrLoadModule('/apps/web/src/games/walker.ts'), loader.ssrLoadModule('/apps/realm/src/games/store.ts'),
    loader.ssrLoadModule('/apps/realm/src/auth/reconnect-harness.ts'), loader.ssrLoadModule('/apps/realm/src/games/stones.ts'),
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
  await listenLocalRealm(realm, created.transport, realmPort, host);
  const endpoint = `http://${host}:${realmPort}`;
  web = await preview({ root: `${repo}/apps/web`, configFile: `${repo}/apps/web/vite.config.ts`, logLevel: 'error',
    ...(process.env.GATHER_WEB_DIST ? { build: { outDir: process.env.GATHER_WEB_DIST } } : {}),
    preview: { host, port: webPort, strictPort: true,
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
  await page.goto(`http://${host}:${webPort}/-/tavern?testWalker=1&seat=tavern:${tableId}:seat:${browserChair}${reconnect ? `&resumeScope=ga10-locked-browser-session-scope-${Date.now()}` : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chatdomReady || window.__chatdomTavernError, null, { timeout: 90_000 });
  const setupError = await page.evaluate(() => window.__chatdomTavernError);
  assert.equal(setupError, undefined, `browser admission failed: ${setupError}`);
  try {
    // The loopback driver finishes its real approach and sends the normal chair request. Do not race
    // that acceptance with E: a just-accepted seat would interpret the delayed key as standing up.
    await page.waitForFunction(table => window.__chatdomTavernLive?.seated === table
      || window.__chatdomTavernError, tableId, { timeout: 90_000 });
  }
  catch (error) {
    report.seatFailure = await page.evaluate(() => ({ live: window.__chatdomTavernLive, error: window.__chatdomTavernError }));
    console.error('[gather] seat diagnostic', JSON.stringify(report.seatFailure));
    await mkdir(output, { recursive: true });
    for (const [width, height] of shotSizes) {
      await page.setViewportSize({ width, height }); await sleep(800);
      const path = `${output}/${artifactPrefix}-walk@${width}x${height}.png`;
      await page.screenshot({ path }); console.error(`[gather] ${path}`);
    }
    throw error;
  }
  assert.equal(await page.evaluate(() => window.__chatdomTavernLive?.seated), tableId, 'browser walker reached and sat at its chair');
  await until(() => player.state.tables.tables.find(table => table.table === tableId) && [...player.state.tables.tables.find(table => table.table === tableId).seats, ...(player.state.tables.tables.find(table => table.table === tableId).extraSeats ?? [])].filter(Boolean).length === 2, 'two occupied chairs');
  await until(() => spectator.room.state.walkers.size === 3, 'third observer sees three walkers');
  report.checks.push('Browser walker walked and sat at the opposite chair; a third SDK walker saw all three in one room.');
  console.log('[gather] initial seated');
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
  const canvas = page.locator('canvas[data-gather-game-input]');
  const assertLocked = async () => assert.equal(await page.evaluate(() => document.pointerLockElement === document.querySelector('canvas[data-gather-game-input]')), true, 'canvas retains pointer lock');
  if (locked) {
    await canvas.click({ position: { x: 10, y: 10 } });
    await page.waitForFunction(() => document.pointerLockElement === document.querySelector('canvas[data-gather-game-input]'));
    await page.keyboard.press('Enter');
    await assertLocked();
  } else await page.getByRole('button', { name: kind === 'stones' ? 'Play Stones' : 'Play Hearth Dice' }).click();
  await until(() => game()?.phase === 'playing', 'match starts');
  await page.waitForFunction(() => window.__chatdomTavernSound?.status === 'ready' && window.__chatdomTavernSound?.audible
    && window.__chatdomTavernSound?.activeSources > 0, null, { timeout: 15_000 });
  if (kind === 'hearth-dice') assert.equal(game().scores.length, 2, 'sparse physical chairs map to two players');
  let clockCaughtUp = false;
  if (reconnect) {
    const browserId = [...spectator.room.state.walkers.keys()].find(id => id !== player.room.sessionId && id !== spectator.room.sessionId);
    assert.ok(browserId, 'browser walker is visible to SDK');
    const walker = spectator.room.state.walkers.get(browserId);
    const identity = { name: walker.name, look: JSON.stringify(walker.look) };
    const before = structuredClone(game());
    const beforeSeat = structuredClone(player.state.tables.tables.find(t => t.table === tableId).seats);
    const initialDrops = await page.evaluate(() => window.__chatdomTavernLive?.disconnects ?? 0);
    const initialReconnects = await page.evaluate(() => window.__chatdomTavernLive?.reconnects ?? 0);
    assert.equal(severWalker(player.room.roomId, browserId), true, 'server severed real browser socket');
    await page.waitForFunction(n => (window.__chatdomTavernLive?.disconnects ?? 0) > n, initialDrops, { timeout: 15000 });
    console.log('[gather] cut witnessed');
    await page.waitForFunction(({ table, count }) => window.__chatdomTavernLive?.connected && window.__chatdomTavernLive?.seated === table
      && window.__chatdomTavernLive?.reconnects > count, { table: tableId, count: initialReconnects }, { timeout: 30000 });
    console.log('[gather] reconnect bootstrap complete');
    await until(() => spectator.room.state.walkers.has(browserId) && spectator.room.state.walkers.size === 3, 'same three walkers after reconnect');
    assert.equal(spectator.room.state.walkers.get(browserId).name, identity.name);
    assert.equal(JSON.stringify(spectator.room.state.walkers.get(browserId).look), identity.look);
    assert.deepEqual(player.state.tables.tables.find(t => t.table === tableId).seats, beforeSeat);
    assert.equal(game().match, before.match); assert.equal(game().revision, before.revision); assert.equal(game().deadline, before.deadline);
    assert.equal(await page.evaluate(() => window.__chatdomTavernLive?.resumeStored), true, 'rotated resume token is stored');
    await page.reload({ waitUntil: 'domcontentloaded' });
    try {
      const reloadReady = table => window.__chatdomTavernError || (window.__chatdomTavernLive?.connected
        && window.__chatdomTavernLive?.seated === table && window.__chatdomTavernLive?.resumeStored);
      try { await page.waitForFunction(reloadReady, tableId, { timeout: 15000 }); }
      catch {
        console.log('[gather] reload 15s diagnostic', JSON.stringify(await page.evaluate(() => ({ live: window.__chatdomTavernLive, error: window.__chatdomTavernError, ready: window.__chatdomReady }))));
        await page.waitForFunction(reloadReady, tableId, { timeout: 75000 });
      }
      assert.equal(await page.evaluate(() => window.__chatdomTavernError), undefined, 'reload entry succeeds');
    } catch (error) {
      report.reloadDiagnostic = await page.evaluate(() => ({ live: window.__chatdomTavernLive, error: window.__chatdomTavernError, ready: window.__chatdomReady }));
      console.error('[gather] reload diagnostic', JSON.stringify(report.reloadDiagnostic));
      throw error;
    }
    console.log('[gather] reload bootstrap complete');
    await until(() => spectator.room.state.walkers.has(browserId) && spectator.room.state.walkers.size === 3, 'same walkers after reload');
    assert.equal(spectator.room.state.walkers.get(browserId).name, identity.name);
    assert.equal(JSON.stringify(spectator.room.state.walkers.get(browserId).look), identity.look);
    assert.deepEqual(player.state.tables.tables.find(t => t.table === tableId).seats, beforeSeat);
    const expectedAfterReload = structuredClone(before);
    tickStones(expectedAfterReload, player.state.tables.at);
    assert.deepEqual(game(), expectedAfterReload, 'reload preserves state except lawful clock catch-up');
    clockCaughtUp = expectedAfterReload.revision !== before.revision;
    if (clockCaughtUp) report.checks.push('The live Stones deadline expired during reload; public timeout catch-up matched tickStones.');
    await page.getByRole('region', { name: 'Stones table' }).waitFor();
    await canvas.click({ position: { x: 10, y: 10 } });
    await page.waitForFunction(() => document.pointerLockElement === document.querySelector('canvas[data-gather-game-input]'));
    await assertLocked();
    console.log('[gather] relocked after reload');
    report.checks.push('Server severed browser socket; reconnect and page reload restored the same SDK walker, identity, chair, match, revision and deadline using the rotated resume token.');
  }
  let moves = 0, captured = false, browserMoves = 0, mouseRolls = 0, mouseHolds = 0;
  while (game().phase === 'playing' && moves < 200) {
    const current = game(), revision = current.revision;
    // Bank the browser's first positive pot to exercise a real right-click hold, then use the normal strategy.
    const firstMouseHold = locked && kind === 'hearth-dice' && current.turn === 1 && !mouseHolds && current.pot > 0;
    const action = kind === 'stones' ? 'drop' : firstMouseHold || current.pot >= 10 || current.scores[current.turn] + current.pot >= 50 ? 'hold' : 'roll';
    let soundBefore = null;
    if (current.turn === 0) {
      player.room.send('move', { action, table: tableId, match: current.match, revision, id: `walker-${moves}`, ...(action === 'drop' ? { column: 0 } : {}) });
    } else {
      await page.waitForFunction(({ tableId, kind, revision }) => {
        const table = window.__chatdomTavernLive?.tables?.find(t => t.table === tableId);
        const local = kind === 'stones' ? table?.stones : table?.dice;
        return local?.revision === revision && local.turn === 1 && window.__chatdomTavernLive?.seated === tableId;
      }, { tableId, kind, revision }, { timeout: 15000 });
      await page.getByRole('status').filter({ hasText: 'Your turn' }).waitFor({ timeout: 15000 });
      if (game()?.revision !== revision) continue;
      if (locked && kind === 'hearth-dice') {
        // Pace checked moves like a person, rather than forcing attacks into an intentionally full voice budget.
        await page.waitForFunction(() => window.__chatdomTavernSound?.audible && window.__chatdomTavernSound?.activeSources <= 2, null, { timeout: 15000 });
        if (game()?.revision !== revision) continue;
        soundBefore = await page.evaluate(() => window.__chatdomTavernSound.played);
      }
      if (locked) {
        if (kind === 'stones') {
          const beforePosition = spectator.room.state.walkers.get([...spectator.room.state.walkers.keys()].find(id => id !== player.room.sessionId && id !== spectator.room.sessionId));
          const position = [beforePosition.x, beforePosition.z];
          if (browserMoves === 0) {
            await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
            await page.waitForFunction(() => window.__chatdomTavernLive?.column === 1, null, { timeout: 5000 });
          }
          assert.equal(await page.evaluate(() => window.__chatdomTavernLive?.seated), tableId);
          const afterPosition = spectator.room.state.walkers.get([...spectator.room.state.walkers.keys()].find(id => id !== player.room.sessionId && id !== spectator.room.sessionId));
          assert.deepEqual([afterPosition.x, afterPosition.z], position, 'arrow did not walk');
          if (browserMoves === 0) await page.keyboard.press('Enter');
          else if (browserMoves === 1) await page.mouse.click(12, 12);
          else await page.keyboard.press('Digit2');
        } else if (browserMoves === 0) await page.keyboard.press(action === 'roll' ? 'KeyR' : 'KeyH');
        else if ((action === 'roll' && !mouseRolls) || (action === 'hold' && !mouseHolds)) {
          await page.mouse.click(12, 12, { button: action === 'roll' ? 'left' : 'right' });
          if (action === 'roll') mouseRolls++; else mouseHolds++;
        } else await page.keyboard.press(action === 'roll' ? 'KeyR' : 'KeyH');
        await assertLocked();
      } else {
      const label = kind === 'stones' ? 'Drop stone in column 2' : action === 'roll' ? 'Roll' : 'Hold';
      await page.getByRole('button', { name: label, exact: true }).click({ timeout: 15_000 });
      }
      browserMoves++;
    }
    await until(() => game()?.revision > revision, `accepted ${action} revision ${revision}`, 15_000);
    if (locked && current.turn !== 0 && kind === 'hearth-dice') {
      assert.equal(game().revision, revision + 1, 'browser move advances exactly once');
      assert.ok(action === 'roll' ? ['roll', 'bust'].includes(game().last) : game().last === 'hold', 'browser action was accepted, not a timeout');
      const cue = action === 'roll' ? 'dice' : 'bank', before = soundBefore[cue] ?? 0;
      await page.waitForFunction(({ cue, before }) => (window.__chatdomTavernSound?.played?.[cue] ?? 0) > before, { cue, before }, { timeout: 15000 });
      const soundAfter = await page.evaluate(() => window.__chatdomTavernSound);
      report.soundedMoves.push({ revision: game().revision, action, last: game().last, cue, before, after: soundAfter.played[cue] });
    }
    if (locked && current.turn !== 0 && kind === 'stones') {
      assert.equal(game().board.filter((cell, index) => index % 7 === 1 && cell !== 0).length, current.board.filter((cell, index) => index % 7 === 1 && cell !== 0).length + 1, 'SDK confirms browser drop in column 2');
    }
    moves++;
    if (!captured && moves >= 2 && game().phase === 'playing') {
      await mkdir(output, { recursive: true });
      for (const [width, height] of shotSizes) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const path = `${output}/${artifactPrefix}-live@${width}x${height}.png`;
        await page.screenshot({ path }); report.screenshots.push({ path, revision: game().revision }); console.log(`[gather] ${path}`);
      }
      if (locked) {
        await page.setViewportSize({ width: 1440, height: 900 });
        if (!await page.evaluate(() => document.pointerLockElement === document.querySelector('canvas[data-gather-game-input]')))
          await canvas.click({ position: { x: 10, y: 10 } });
        await page.waitForFunction(() => document.pointerLockElement === document.querySelector('canvas[data-gather-game-input]'));
      }
      captured = true;
    }
  }
  assert.ok(browserMoves >= (locked ? 2 : 1), 'browser acted through actual controls, including locked mouse');
  if (locked && kind === 'hearth-dice') assert.ok(mouseRolls > 0 && mouseHolds > 0, 'browser used both left-click roll and right-click hold');
  assert.equal(game().phase, 'finished', 'match completed within 200 moves');
  await until(() => watched()?.phase === 'finished' && watched().revision === game().revision, 'spectator final');
  assert.deepEqual(watched(), game(), 'spectator sees same public final');
  if (kind === 'stones') {
    if (!clockCaughtUp) { assert.equal(moves, 7); assert.equal(game().winner, 0); }
    assert.equal(game().reason, 'four');
  } else {
    assert.equal(game().reason, 'fifty'); assert.ok(game().scores[game().winner] >= 50);
  }
  await page.waitForFunction(cue => (window.__chatdomTavernSound?.played?.[cue] ?? 0) > 0, kind === 'stones' ? 'stone' : 'dice', { timeout: 15_000 });
  if (locked) {
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => window.__chatdomTavernLive?.seated === null, null, { timeout: 15000 });
    report.checks.push('Game keys retained pointer lock; E released the chair.');
  } else {
    await page.getByRole('button', { name: /Stand up/ }).click();
    await page.waitForFunction(() => window.__chatdomTavernLive?.seated === null, null, { timeout: 15_000 });
  }
  await checkSound(page, report);
  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  report.checks.push(`Completed ${kind} with ${moves} accepted moves including ${browserMoves} browser actions; spectator received the same final state.`);
  if (locked && kind === 'hearth-dice') report.mouseActions = { rolls: mouseRolls, holds: mouseHolds };
  report.result = structuredClone(game());
} catch (error) {
  process.exitCode = 1;
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
    const reportPath = `${output}/${artifactPrefix}-${report.failure ? 'failure' : 'browser-match'}.json`;
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
