/* global AbortController, structuredClone */
// Real-GPU stills and one fps reading of a full tavern. Seven headless reference walkers walk to chairs and play three
// live games; the browser on the leased PC is the eighth person, standing in the room or seated at a table.
// Run only inside the lease, against a frozen build:
//   chatdom-pc-lease --wait 30 -- env GATHER_WEB_DIST=/abs/build nice -n 10 node apps/web/src/games/gpu-stills.mjs
// The lease owns 127.0.0.1:5192 (the PC's tunnel); the realm stays on a local gather port behind the preview proxy.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as probeServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setInterval, clearInterval, setTimeout } from 'node:timers';
import { Client } from '@colyseus/sdk';
import { createServer, preview } from 'vite';
import { listenLocalRealm } from './local-listener.mjs';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const output = process.env.GATHER_STANDIN === '1' || process.env.GATHER_LOCAL_BROWSER === '1' ? '/tmp/chatdom-gather/standin' : `${repo}/work/evidence/gather`;
// The lease's tunnel reaches 127.0.0.1 only; an off-lease rehearsal may use the lane's other loopback address.
const host = process.env.GATHER_HOST ?? '127.0.0.1';
assert.ok(host === '127.0.0.1' || host === '127.0.0.10' && (process.env.GATHER_STANDIN === '1' || process.env.GATHER_LOCAL_BROWSER === '1'));
// The lease's port; a dry run without shots (GATHER_SHOTS=none) may name a local gather port instead.
const webPort = Number(process.env.GATHER_WEB_PORT ?? 5192);
assert.ok(webPort === 5192 || webPort >= 5170 && webPort <= 5186);
const prefix = process.env.GATHER_EVIDENCE ?? 'ga10-gpu';
assert.match(prefix, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
// GATHER_STANDIN=1: no leased browser; a headless walker takes its place at each spot, so the seated flows can be
// rehearsed off the lease. Stills are skipped and nothing is written as GPU evidence.
const standin = process.env.GATHER_STANDIN === '1';
// GATHER_LOCAL_BROWSER=1: a local SwiftShader Chrome under the shared capture lock takes the PC's place, and each shot
// also records the page's own tables beside the room's. Diagnosis only: these stills are never GPU evidence.
const localBrowser = process.env.GATHER_LOCAL_BROWSER === '1';
assert.ok(standin || process.env.GATHER_WEB_DIST, 'GATHER_WEB_DIST must name a frozen web build');
const only = new Set((process.env.GATHER_SHOTS ?? 'room,room-phone,fps,pong,dice,stones,pong-phone').split(','));
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
async function freeRealmPort() {
  for (const port of [5189, 5188, 5186, 5185, 5184, 5183, 5182, 5181, 5180, 5179, 5178, 5177, 5176, 5175, 5174, 5173, 5172, 5171, 5170]) {
    const probe = probeServer();
    if (await new Promise(resolve => { probe.once('error', () => resolve(false)); probe.listen(port, host, () => probe.close(() => resolve(true))); })) return port;
  }
  throw new Error('No safe local realm port is free.');
}
/** One leased-browser command; its output line names the renderer, which the report keeps. */
function pc(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('chatdom-pc', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`chatdom-pc ${args[0]} exited ${code}: ${err.trim() || out.trim()}`)));
  });
}
const report = { started: new Date().toISOString(), renderer: null,
  fixture: 'Seven temporary reference sessions, memory only, walking and playing through the real tavern room; the leased browser is the eighth.',
  limitations: ['No Twitch identity, durable session or portal transfer is shown in these stills; door-to-table.mjs proves the transfer headlessly.',
    'The browser walker cannot type, so a seated browser player plays only through its turn clock (Stones, Dice) or an idle paddle (Pong).'],
  shots: [], checks: [] };
let loader, realm, web, pongTimer, motionTimer, diceTimer, chrome, releaseLock;
const rooms = [];
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => cancel.abort(new Error(`Cancelled by ${signal}`)));
try {
  const realmPort = await freeRealmPort();
  report.ports = { realm: `${host}:${realmPort}`, web: `${host}:${webPort}` };
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: '/tmp/chatdom-gather/vite-gpu-loader', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false } });
  const [{ createRealmServer }, { referenceServices }, { starterCitizenLook, TavernRoomState }, { createTavernInterior }, { seatApproachDriver }, { installGatherStore, MemoryGatherStore }] = await Promise.all([
    loader.ssrLoadModule('/apps/realm/src/server.ts'), loader.ssrLoadModule('/apps/realm/src/reference.ts'),
    loader.ssrLoadModule('/packages/shared/src/index.ts'), loader.ssrLoadModule('/apps/realm/src/games/interior.ts'),
    loader.ssrLoadModule('/apps/web/src/games/walker.ts'), loader.ssrLoadModule('/apps/realm/src/games/store.ts'),
  ]);
  const base = referenceServices();
  // The person across the Pong table wears the tallest hat, so the stills check the seated framing's headroom too.
  const tall = new Set();
  const services = { ...base, auth: { ...base.auth, authenticate: async join => {
    const principal = await base.auth.authenticate(join);
    return { ...principal, look: tall.has(join.ticket) ? 'bench-pointed-hat' : starterCitizenLook(principal.personId) };
  } } };
  installGatherStore(services, new MemoryGatherStore());
  const created = createRealmServer(services); realm = created.server;
  created.transport.app.post('/reference/session', response => response.writeHeader('Access-Control-Allow-Origin', '*').writeHeader('Cache-Control', 'no-store').writeHeader('Content-Type', 'application/json').end(JSON.stringify(base.issue())));
  await listenLocalRealm(realm, created.transport, realmPort, host);
  const endpoint = `http://${host}:${realmPort}`;
  if (!standin) web = await preview({ root: `${repo}/apps/web`, configFile: `${repo}/apps/web/vite.config.ts`, logLevel: 'error', build: { outDir: process.env.GATHER_WEB_DIST },
    preview: { host, port: webPort, strictPort: true, proxy: { '/live-realm-data': { target: endpoint, ws: true, rewrite: path => path.replace(/^\/live-realm-data/, '') } } } });
  const sdk = new Client(endpoint);
  async function join(label, look) {
    const ticket = base.issue(); if (look === 'tall') tall.add(ticket.ticket);
    const room = await sdk.joinOrCreate('tavern', ticket, TavernRoomState);
    room.reconnection.enabled = false; rooms.push(room);
    const state = { tables: null, self: null, receipts: new Map(), started: new Map() };
    for (const type of ['interior', 'transient']) room.onMessage(type, () => {});
    room.onMessage('receipt', message => state.started.set(message.id, message.accepted));
    room.onMessage('private', message => { if (message.type === 'receipt') state.receipts.set(message.receipt.id, message.receipt); });
    room.onMessage('tables', message => { state.tables = message; });
    room.onMessage('self', message => { state.self = message; });
    room.send('bootstrap');
    await until(() => state.tables && state.self && room.state.walkers.get(room.sessionId), `${label} bootstrap`);
    return { label, room, state };
  }
  const interior = createTavernInterior();
  const people = [];
  for (const [index, look] of ['tall', null, null, null, null, null, null].entries()) people.push(await join(`walker ${index + 1}`, look));
  const [p0, p1, p2, p3, p4, p5, p6] = people;
  const watcher = p6;
  const tableOf = (person, id) => person.state.tables?.tables.find(t => t.table === id);
  let intents = 0;
  const interact = async (person, targetId, action) => {
    const id = `gpu-${++intents}`;
    person.room.send('intent', { version: 1, type: 'interact', id, targetId, action });
    await until(() => person.state.receipts.has(id), `${person.label} ${action} receipt`);
    return person.state.receipts.get(id);
  };
  async function walkAll(moves) {
    const items = moves.map(([person, goal]) => {
      const body = person.room.state.walkers.get(person.room.sessionId);
      return { person, driver: seatApproachDriver(interior.world, [body.x, body.y, body.z], goal, [14, 10]), input: person.room.input({ mode: 'reliable' }) };
    });
    motionTimer = setInterval(() => { for (const item of items) { const body = item.person.room.state.walkers.get(item.person.room.sessionId); if (body && !item.driver.done) { Object.assign(item.input.data, item.driver.input(body), { placement: body.placement }); item.input.send(); } } }, 1000 / 30);
    try { await until(() => items.every(item => item.driver.done), 'walkers reach their places', 60000); } finally { clearInterval(motionTimer); }
  }
  const chair = (table, n) => interior.registry.get(`tavern:${table}:seat:${n}`);
  async function sitAll(pairs) {
    await walkAll(pairs.map(([person, table, n]) => [person, chair(table, n).target.approach]));
    for (const [person, table, n] of pairs) {
      const receipt = await interact(person, `tavern:${table}:seat:${n}`, 'tavern');
      assert.equal(receipt.status, 'applied', `${person.label} sits at ${table}/${n}: ${receipt.message ?? ''}`);
    }
    await until(() => pairs.every(([person, table]) => person.state.self?.table === table), 'everyone seated');
  }
  let starts = 0;
  async function start(person, table) {
    const id = `gpu-start-${++starts}`;
    person.room.send('start', { table, revision: tableOf(person, table).revision, id });
    await until(() => person.state.started.has(id), `${table} start receipt`, 10000);
    assert.equal(person.state.started.get(id), true, `${table} start accepted`);
  }
  const live = (table, kind) => { const v = tableOf(watcher, table)?.[kind]; return v && (kind === 'pong' ? ['serve', 'rally'].includes(v.phase) : v.phase === 'playing'); };

  // Pong: the SDK players track the real ball; the browser's own paddle rests where its pointer left it.
  const pongSeats = { 0: p0, 1: p1 };
  let pongSequence = 0;
  pongTimer = setInterval(() => {
    const pong = tableOf(watcher, 'middle')?.pong;
    if (!pong || !['serve', 'rally'].includes(pong.phase)) return;
    for (const [seat, person] of Object.entries(pongSeats)) if (person && person.state.self?.table === 'middle') {
      const towardMe = Number(seat) === 0 ? pong.ball.vy > 0 : pong.ball.vy < 0;
      person.room.send('paddle', { match: pong.match, sequence: ++pongSequence, paddle: Math.max(-1, Math.min(1, towardMe ? pong.ball.x : pong.ball.x * .5)) });
    }
  }, 1000 / 30);
  // Dice and Stones: each SDK player acts promptly on its own turn; a browser player waits out its clock.
  const playing = new Map();
  let pace = 1500;
  diceTimer = setInterval(() => {
    for (const [table, roster] of playing) {
      const entry = tableOf(watcher, table), view = entry?.dice ?? entry?.stones;
      if (!view || view.phase !== 'playing') continue;
      const actor = roster[view.turn];
      const key = `${view.match}:${view.revision}`;
      if (!actor || actor.busy === key) continue;
      actor.busy = key;
      const move = entry.dice ? { action: view.pot >= 10 + 3 * view.turn ? 'hold' : 'roll' }
        : { action: 'drop', column: [3, 2, 4, 1, 5, 3, 2, 4, 0, 6][(view.board.filter(Boolean).length) % 10] };
      if (move.action === 'drop' && view.board[move.column] !== 0) move.column = [3, 2, 4, 1, 5, 0, 6].find(c => view.board[c] === 0);
      const id = `gpu-${table}-${view.match}-${view.revision}`;
      setTimeout(() => actor.room.send('move', { ...move, table, match: view.match, revision: view.revision, id }), pace);
      setTimeout(() => { if (actor.state.started.get(id) === false) report.refusedMoves = (report.refusedMoves ?? 0) + 1; }, pace + 2000);
    }
  }, 100);

  // --- The room full: three live games, eight people. ---
  await sitAll([[p0, 'middle', 1], [p1, 'middle', 2], [p2, 'west', 1], [p3, 'west', 2], [p4, 'hearth', 1], [p5, 'hearth', 2], [p6, 'east', 1]]);
  await start(p0, 'middle'); await start(p2, 'west'); await start(p4, 'hearth');
  playing.set('west', [p2, p3]); playing.set('hearth', [p4, p5]);
  await until(() => live('middle', 'pong') && live('west', 'stones') && live('hearth', 'dice'), 'three live games');
  await until(() => tableOf(watcher, 'west').stones.board.filter(Boolean).length >= 5 && tableOf(watcher, 'hearth').dice.scores.some(s => s > 0), 'stones and banked dice on the tables', 40000);
  report.checks.push('Seven reference walkers walked to chairs and sat through the room\'s interaction receipts; Pong, Stones and Hearth Dice were live before any shot.');
  await mkdir(output, { recursive: true });
  const browserIds = () => [...watcher.room.state.walkers.keys()].filter(id => !people.some(p => p.room.sessionId === id));
  async function localShot(query, size, settle, path) {
    const { chromium } = await import('@playwright/test');
    if (!releaseLock) { const { acquireCaptureLock } = await import('../../../../packages/testing/capture-lock.mjs'); releaseLock = await acquireCaptureLock({ signal: cancel.signal }); report.lockAt = Date.now(); }
    chrome ??= await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
    const [width, height] = size.split('x').map(Number);
    const page = await chrome.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`http://${host}:${webPort}/-/tavern?testWalker=1${query}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__chatdomReady || window.__chatdomTavernError, null, { timeout: 90000 });
      const samples = [];
      for (let t = 0; t < settle; t += 2) {
        await sleep(2000);
        samples.push({ at: Date.now(), page: await page.evaluate(() => ({ seated: window.__chatdomTavernLive?.seated, approach: window.__chatdomTavernLive?.approach,
          tables: window.__chatdomTavernLive?.tables?.map(t => ({ table: t.table, seats: t.seats, stones: t.stones && { match: t.stones.match, revision: t.stones.revision, turn: t.stones.turn, n: t.stones.board.filter(Boolean).length } })) })),
          room: watcher.state.tables.tables.map(t => ({ table: t.table, seats: t.seats, stones: t.stones && { match: t.stones.match, revision: t.stones.revision, turn: t.stones.turn, n: t.stones.board.filter(Boolean).length } })) });
      }
      await page.screenshot({ path });
      report.diagnosis ??= []; report.diagnosis.push({ query, samples, errors, hud: await page.locator('.cd-kit').allInnerTexts().catch(() => []) });
      return `local ${path}`;
    } finally { await page.close(); }
  }
  let standins = 0;
  async function standIn(query, settle) {
    const person = await join(`stand-in ${++standins}`);
    const seat = /seat=tavern:(\w+):seat:(\d)/.exec(query);
    if (seat) await sitAll([[person, seat[1], Number(seat[2])]]);
    await sleep(settle * 1000);
    const t = seat && tableOf(person, seat[1]);
    const view = t && (t.stones ?? t.dice ?? t.pong);
    // Dropped, not consented, as a closed tab is: the room holds the person for the reconnect grace.
    person.room.connection.close();
    return `stand-in ${person.label} · ${seat ? `${seat[1]} ${JSON.stringify(view && { phase: view.phase, revision: view.revision, score: view.score ?? view.scores, stones: view.board?.filter(Boolean).length })}` : 'standing'}`;
  }
  async function shot(name, query, size, settle, during) {
    if (!only.has(name)) return;
    const [w, h] = size.split('x');
    const path = `${output}/${prefix}-${name}@${w}x${h}.png`;
    const before = browserIds().length;
    const running = standin ? standIn(query, settle) : localBrowser ? localShot(query, size, settle, path) : pc(['shot', `http://localhost:${webPort}/-/tavern?testWalker=1${query}`, path, '--size', size, '--settle', String(settle), '--timeout', '60']);
    const side = during ? during().catch(error => { report.checks.push(`${name}: ${error.message}`); }) : null;
    const line = await running; await side;
    report.renderer ??= line.split(' · ').at(-1);
    const tables = structuredClone(watcher.state.tables.tables);
    report.shots.push({ name, path: path.slice(repo.length), size, line, walkers: watcher.room.state.walkers.size, browserWalkersBefore: before, tables });
    console.log(`[gather] ${line}`);
  }
  const sdkNames = new Set(people.map(p => watcher.room.state.walkers.get(p.room.sessionId).name));
  const awaitBrowserAt = (table, slot) => until(() => {
    const t = tableOf(watcher, table), name = t && (slot < 2 ? t.seats[slot] : t.extraSeats?.[slot - 2]);
    return !!name && !sdkNames.has(name);
  }, `browser seated at ${table}`, 40000);

  // One failed seating never costs the remaining stills: each step records its own failure and the lease moves on.
  const step = async (name, run) => { if (!only.has(name)) return; try { await run(); } catch (error) { report.failed ??= []; report.failed.push({ name, error: error.message }); console.error(`[gather] ${name}: ${error.message}`); } };
  await shot('room', '', '1440x900', 6);
  // --- Seated Stones: across from walker 7 at the east table; walker 7 opens, the browser's clock drops in the centre. ---
  await step('stones', async () => {
    await shot('stones', '&seat=tavern:east:seat:2', '1440x900', 48, async () => {
      await awaitBrowserAt('east', 1);
      await start(p6, 'east');
      playing.set('east', [p6, null]);
    });
  });
  // A tab that closes is a dropped connection: its person stays for the reconnect grace, seated or where they stood.
  // So the phone room follows a seated shot, and every shot records how many people the room really held.
  await shot('room-phone', '', '390x844', 6);
  if (only.has('fps') && !standin) {
    const line = await pc(['fps', `http://localhost:${webPort}/-/tavern?testWalker=1`, '--seconds', '10', '--size', '1440x900', '--timeout', '60']);
    report.fps = { line, walkers: watcher.room.state.walkers.size, live: ['middle', 'west', 'hearth'].filter(t => live(t, t === 'middle' ? 'pong' : t === 'west' ? 'stones' : 'dice')) };
    console.log(`[gather] fps ${line}`);
  }

  pace = 900;
  // --- Seated Pong: the person across stands and gives the chair; the browser walks to it and the match starts. ---
  const pongSeated = async () => {
    await awaitBrowserAt('middle', 1);
    pongSeats[1] = null;
    await start(p0, 'middle');
  };
  await step('pong', async () => {
    await interact(p1, 'tavern:middle:seat:2', 'stand');
    await walkAll([[p1, [5.75, .125, 2.625]]]);
    await shot('pong', '&seat=tavern:middle:seat:2', '1440x900', 16, pongSeated);
  });
  // --- Seated Hearth Dice: a fresh three-player match, the browser third at the hearth. ---
  await step('dice', async () => {
    await interact(p5, 'tavern:hearth:seat:2', 'stand');
    await until(() => !live('hearth', 'dice'), 'the old dice match ends');
    playing.delete('hearth');
    assert.equal((await interact(p5, 'tavern:hearth:seat:2', 'tavern')).status, 'applied', 'walker 6 sits again');
    await shot('dice', '&seat=tavern:hearth:seat:4', '1440x900', 22, async () => {
      await awaitBrowserAt('hearth', 3);
      await start(p4, 'hearth');
      playing.set('hearth', [p4, p5, null]);
    });
  });
  // --- Seated Pong on a phone: the chair comes back after the reconnect grace. ---
  await step('pong-phone', async () => {
    await until(() => !tableOf(watcher, 'middle').seats[1], 'the Pong chair is free again', 45000);
    await shot('pong-phone', '&seat=tavern:middle:seat:2', '390x844', 16, pongSeated);
  });
  if (report.shots.length) report.checks.push('Every still was taken by the leased browser while the room\'s public tables were live; each shot records the authoritative tables at that moment.');
} catch (error) {
  process.exitCode = 1;
  report.failure = error instanceof Error ? error.stack : String(error);
  console.error(report.failure);
} finally {
  clearInterval(pongTimer); clearInterval(motionTimer); clearInterval(diceTimer);
  report.finished = new Date().toISOString();
  await mkdir(output, { recursive: true });
  const text = JSON.stringify(report, null, 2);
  assert.ok(!/"(?:seed|cursor)"\s*:/.test(text), 'private RNG must not enter evidence');
  await writeFile(`${output}/${prefix}-${report.failure ? 'failure' : 'report'}.json`, `${text}\n`);
  await chrome?.close().catch(() => {});
  if (report.lockAt) report.lockHeldMs = Date.now() - report.lockAt;
  await Promise.all(rooms.map(room => room.leave().catch(() => {})));
  if (web) await new Promise(resolve => web.httpServer.close(resolve));
  await realm?.gracefullyShutdown(false).catch(() => {});
  await loader?.close().catch(() => {});
  await releaseLock?.();
}
