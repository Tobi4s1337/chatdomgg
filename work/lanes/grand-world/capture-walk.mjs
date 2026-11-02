// The signed-in walk on tobi4s_'s grand floor, through the production walk entry (`/?walk=1&kingdom=…`):
// main.tsx's walk route -> createLiveKingdomEntrySource -> API session and ticket -> founded receipt and scene ->
// compileFoundedScene -> connectRealm over `/live-realm-data` -> KingdomRoom authority -> the walk controller.
//
// Everything the page talks to is this bench's own, in memory, on this host:
// - a realm (the real createRealmServer and KingdomRoom) whose room world is compileFoundedScene of the real
//   founded scene, with the receipt and scene bytes read once from the live realm's public GET routes;
// - a session and ticket endpoint standing in for Twitch sign-in (the API's OIDC flow is not what this checks);
// - the land read server over this lane's current store (grader 3, format 2).
// Nothing is written to any live service. The walker is a bench principal in this process only.
//
//   node work/lanes/grand-world/capture-walk.mjs --pc        inside chatdom-pc-lease (preview 5192, realm 5191)
//   node work/lanes/grand-world/capture-walk.mjs             SwiftShader under the capture lock
//   [--sizes 1440x900,390x844] [--hour 17.5] [--views street,door,forge,castle]
//
// For each size: a fresh browser context (cold cache) opens the walk and records time to the designed gate, to
// the loaded frame and to walkable. Then for each view the server places the walker a few metres short of the
// spot, the camera is turned by a real mouse drag, the walker walks in with the W key, and the page is captured.
/* global AbortSignal, AbortController, TextDecoderStream, performance -- Node 22 and page globals */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer as createHttpServer, get as httpGet } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { createServer as createViteServer, preview as createPreview } from 'vite';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../packages/testing/capture-ports.mjs';
import { closeCapturePreview } from '../../../packages/testing/preview.mjs';

const { values } = parseArgs({ options: {
  pc: { type: 'boolean', default: false },
  sizes: { type: 'string', default: '1440x900,390x844' },
  hour: { type: 'string', default: '17.5' },
  views: { type: 'string', default: 'street,door,forge,castle' },
  out: { type: 'string', default: 'work/evidence/grand-world' },
  label: { type: 'string', default: '' },
  // A comparison build with no grand recipe (build-today.mjs): the same walk on today's land.
  today: { type: 'string' },
  // A realm that never answers land routes (today's live realm): the grand build must fall back to today's land.
  unpublished: { type: 'boolean', default: false },
} });
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const pc = values.pc, hour = Number(values.hour);
const hourName = new Map([[6.5, 'dawn'], [12, 'noon'], [17.5, 'golden'], [22, 'night']]).get(hour);
assert.ok(hourName, 'Use a named evidence hour');
const sizes = values.sizes.split(',').map(text => { const [w, h] = text.split('x').map(Number); assert.ok(w > 0 && h > 0); return { w, h }; });
const viewNames = values.views.split(',');
for (const name of viewNames) assert.ok(['street', 'door', 'forge', 'castle'].includes(name), `unknown view ${name}`);
const today = values.today, unpublished = values.unpublished;
assert.ok(!(today && unpublished), 'Choose either the comparison build or an unpublished land');
const prefix = `gw10-${pc ? 'gpu-' : ''}${today ? 'today-' : ''}${unpublished ? 'unpublished-' : ''}walk${values.label ? `-${values.label}` : ''}`;
const sleep = ms => new Promise(done => setTimeout(done, ms));
const host = '127.0.0.1', kingdomId = '129634568';
const live = 'http://127.0.0.1:5197';
// GET only. A pooled keep-alive socket the live server has already closed fails as "other side closed"; a GET is
// safe to repeat once on a fresh connection.
const readLive = (path, init = {}, retry = true) => fetch(`${live}${path}`, init).catch(error => {
  if (retry && !init.signal?.aborted && /other side closed|ECONNRESET|socket/i.test(String(error.cause?.message ?? error.cause?.code ?? ''))) return sleep(250).then(() => readLive(path, init, false));
  throw new Error(`Reading ${path} from the live realm failed: ${error.cause?.message ?? error.message}`);
});

const report = { started: new Date().toISOString(), renderer: pc ? 'his Chrome, RTX 5080, through chatdom-pc' : 'Chrome SwiftShader',
  entry: 'production walk route /?walk=1&kingdom= with a bench session, ticket and realm', hour, runs: [], errors: [] };
let loader, realm, api, land, preview, browser, release;
const cleanups = [];
const sockets = new Set();
const own = server => server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
async function listenFirst(server, candidates) {
  for (const port of candidates) {
    const ok = await new Promise(done => {
      const fail = error => { server.off('listening', bound); done(error.code === 'EADDRINUSE' ? false : Promise.reject(error)); };
      const bound = () => { server.off('error', fail); done(true); };
      server.once('error', fail); server.once('listening', bound);
      server.listen({ port, host, exclusive: true });
    });
    if (ok) return port;
  }
  throw new Error('No free capture port; nothing was started');
}

try {

  // The live receipt and its exact scene bytes, read once through the public GET routes.
  const receiptResponse = await readLive(`/api/realm/founded/${kingdomId}`, { signal: AbortSignal.timeout(8000) });
  assert.equal(receiptResponse.status, 200);
  const receiptText = await receiptResponse.text(), receipt = JSON.parse(receiptText);
  const sceneBytes = new Uint8Array(await (await readLive(`/api/realm/founded/scenes/${receipt.sceneHash}`, { signal: AbortSignal.timeout(20_000) })).arrayBuffer());
  const entryText = await (await readLive(`/api/realm/entry/${kingdomId}`, { signal: AbortSignal.timeout(8000) })).text();
  const entryInfo = JSON.parse(entryText);
  assert.equal(entryInfo.origin, 'live');
  report.receipt = receipt;

  loader = await createViteServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
  const load = path => loader.ssrLoadModule(path);
  const [{ createRealmServer }, { decodeFoundedScene }, { compileFoundedScene }, { foundedSpawnAnchors }, interactions, { grandKingdomLand }] = await Promise.all([
    load('/apps/realm/src/server.ts'), load('/packages/world/src/founded-world/validate.ts'), load('/packages/world/src/founded-world/collision.ts'),
    load('/apps/realm/src/founded/anchors.ts'), load('/packages/world/src/interactions/index.ts'), load('/packages/world/src/grand/kingdom/ground.ts'),
  ]);
  const scene = await decodeFoundedScene(sceneBytes, receipt);
  const world = compileFoundedScene(scene);
  assert.equal(world.revision, receipt.collisionRevision);
  const anchors = foundedSpawnAnchors(scene.plan, world);
  const groundLand = grandKingdomLand(scene, world);

  // Evidence spots on the real plan. A spot is where the walker stops; it starts `lead` metres short of it, facing it.
  const unit = (from, to) => { const dx = to[0] - from[0], dz = to[2] - from[2], l = Math.hypot(dx, dz); return [dx / l, dz / l]; };
  const settle = point => interactions.settleOnFloor(world, point);
  function approach(spot, dir, lead) {
    for (let back = lead; back >= 1; back -= .5) {
      for (const lift of [0, .5, -.5, 1, -1, 1.5, -1.5]) {
        const start = settle([spot[0] - dir[0] * back, spot[1] + lift, spot[2] - dir[1] * back]);
        if (start) return { start, walk: back };
      }
    }
    throw new Error('No supported approach to the spot');
  }
  const plots = scene.placements.filter(p => p.plotId && scene.assets.some(a => a.assetHash === p.assetHash && a.blueprint.kind === 'home')).map(p => p.plotId).sort();
  const installed = interactions.foundedInstalledHomes(scene, new Map([[plots[0], 'walk-bench']]));
  const door = interactions.homeThreshold(installed.homes[0], world).placement.anchors.find(a => a.kind === 'home-door');
  const castleGate = groundLand.moments.castleGate, plaza = groundLand.moments.plaza;
  const spots = {};
  {
    const dir = unit(door.approach, door.rest);
    spots.door = { ...approach(door.approach, dir, 5), heading: Math.atan2(dir[0], dir[1]), stop: door.approach, note: `first installed plot ${plots[0]}'s door, from the lane` };
  }
  {
    const anvil = groundLand.forge.anvil, dir = unit(groundLand.forge.approach, anvil);
    spots.forge = { ...approach(groundLand.forge.approach, dir, 6), heading: Math.atan2(dir[0], dir[1]), stop: groundLand.forge.approach, note: 'the Forge approach, facing the anvil' };
  }
  {
    const dir = unit(plaza, castleGate);
    spots.castle = { ...approach(castleGate, dir, 8), heading: Math.atan2(dir[0], dir[1]), stop: castleGate, note: 'Crown Road up to the castle gate' };
  }
  {
    const start = anchors[0], dir = unit(start, castleGate);
    spots.street = { start, walk: 2, heading: Math.atan2(dir[0], dir[1]), stop: null, note: 'arrival anchor 0 on the street, facing up toward the castle' };
  }
  report.spots = Object.fromEntries(Object.entries(spots).map(([k, v]) => [k, { start: v.start, heading: v.heading, walk: v.walk, stop: v.stop, note: v.note }]));

  console.log(JSON.stringify(report.spots));
  if (!pc) release = await acquireCaptureLock({ signal: AbortSignal.timeout(900_000) });

  // The live kingdom's public world, mirrored read-only from its watch stream: the checkpoint seeds the bench
  // room's bootstrap (same writer epoch and cursors) and later `world` deliveries are forwarded verbatim.
  const watchAbort = new AbortController(), subscribers = new Set();
  cleanups.push(() => watchAbort.abort());
  const checkpoint = await new Promise((resolveCheckpoint, rejectCheckpoint) => {
    readLive(`/api/realm/watch/${kingdomId}`, { headers: { Accept: 'text/event-stream' }, signal: watchAbort.signal }).then(async response => {
      assert.equal(response.status, 200, 'live watch');
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '', seeded = false;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += value;
        for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
          const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1], data = /^data: (.+)$/m.exec(block)?.[1];
          if (!event || !data) continue;
          if (event === 'checkpoint' && !seeded) { seeded = true; resolveCheckpoint(JSON.parse(data)); }
          else if (event === 'world') { report.mirroredWorld = (report.mirroredWorld ?? 0) + 1; for (const deliver of subscribers) deliver(JSON.parse(data)); }
        }
      }
    }).catch(error => { if (!watchAbort.signal.aborted) rejectCheckpoint(error); });
    setTimeout(() => rejectCheckpoint(new Error('No live watch checkpoint')), 10_000).unref();
  });
  assert.equal(checkpoint.manifest.sceneHash, receipt.sceneHash, 'Live watch and receipt disagree');
  report.checkpoint = { throughSequence: checkpoint.checkpoint.throughSequence, current: checkpoint.checkpoint.current.map(m => m.type) };

  // Bench realm: the real server, the real founded collision world, one bench principal per ticket.
  const tickets = new Map(), sessions = new Map(), effectsSet = new Set();
  let writerOpen = false;
  const services = {
    auth: {
      async authenticate(join) {
        const principal = tickets.get(join.ticket); tickets.delete(join.ticket);
        if (!principal || principal.expiresAt <= Date.now() || join.kingdomId !== kingdomId) throw new Error('Bench entry expired');
        return principal;
      },
      async current(principal, now) { const s = sessions.get(principal.sessionId); return !!s && s.personId === principal.personId && s.expiresAt > now; },
    },
    async open(id) {
      assert.equal(id, kingdomId); assert.ok(!writerOpen); writerOpen = true;
      const { writerEpoch, throughSequence, throughCursor, current } = checkpoint.checkpoint;
      return { kingdomId, origin: 'live', writerEpoch, layoutRevision: receipt.layoutRevision, world, sequence: throughSequence,
        spawn: () => anchors[0],
        intent: async (_context, intent) => ({ version: 1, id: intent.id, status: 'unavailable', message: 'This bench hosts walking only. Nothing was changed.' }),
        bootstrap: () => ({ version: 1, kingdomId, writerEpoch, throughSequence, throughCursor, layoutRevision: receipt.layoutRevision, collisionRevision: receipt.collisionRevision, current }),
        recoverWalker: (walkerId, revision) => revision === world.revision && [...effectsSet].some(e => e.placeWalker(walkerId, anchors[0], revision)),
        bindRoom: effects => { effectsSet.add(effects); return () => effectsSet.delete(effects); }, lifecycle: () => {},
        subscribe: deliver => { subscribers.add(deliver); return () => subscribers.delete(deliver); }, bindTransient: () => () => {}, dispose: async () => { writerOpen = false; } };
    },
  };
  const created = createRealmServer(services);
  realm = created.server;
  const app = created.transport.app;
  const send = (res, status, type, body) => res.cork(() => res.writeStatus(status).writeHeader('Content-Type', type).writeHeader('Cache-Control', 'no-store').end(body));
  const sceneBuffer = Buffer.from(sceneBytes);
  app.get(`/api/realm/founded/${kingdomId}`, res => send(res, '200 OK', 'application/json', receiptText));
  app.get(`/api/realm/founded/scenes/${receipt.sceneHash}`, res => send(res, '200 OK', 'application/json', sceneBuffer));
  app.get(`/api/realm/entry/${kingdomId}`, res => send(res, '200 OK', 'application/json', entryText));
  // The shared kingdom clock: each request reads the live realm's public clock (GET only).
  app.get('/api/realm/clock', res => {
    let aborted = false; res.onAborted(() => { aborted = true; });
    fetch(`${live}/api/realm/clock`, { signal: AbortSignal.timeout(5000) }).then(r => r.text().then(text => [r.ok, text]))
      .then(([ok, text]) => { if (!aborted) send(res, ok ? '200 OK' : '503 Service Unavailable', 'application/json', text); },
        () => { if (!aborted) send(res, '503 Service Unavailable', 'application/json', JSON.stringify({ version: 1, status: 'unavailable', message: 'Clock unavailable.' })); });
  });
  app.get('/api/realm/*', (res, req) => { report.unserved = [...new Set([...(report.unserved ?? []), req.getUrl()])];
    send(res, '404 Not Found', 'application/json', JSON.stringify({ version: 1, status: 'unavailable', message: 'Not on this bench.' })); });
  const realmPort = pc ? 5191 : null;
  if (pc) await realm.listen(5191, host);
  else {
    let bound;
    // uWS listens with port reuse, so a taken port would silently share another process's socket.
    // Probe each port exclusively with Node first; only a port nobody holds is given to the realm.
    for (const port of CAPTURE_PORTS) {
      const probe = createNetServer();
      const free = await new Promise(done => { probe.once('error', () => done(false)); probe.listen({ port, host, exclusive: true }, () => probe.close(() => done(true))); });
      if (free) { await realm.listen(port, host); bound = port; break; }
    }
    assert.ok(bound, 'No realm port'); report.realmPort = bound;
  }

  // Bench session and ticket endpoint (the API's shape; Twitch OIDC itself is not under test here).
  const csrf = randomBytes(24).toString('hex'), scope = randomBytes(16).toString('hex');
  api = createHttpServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/api/realm/session') return reply(200, { version: 1, status: 'authenticated', expiresAt: Date.now() + 3_600_000, resumeScope: scope, csrfToken: csrf });
    if (req.method === 'POST' && req.url === '/api/realm/ticket') {
      if (req.headers['x-csrf-token'] !== csrf) return reply(403, { version: 1, status: 'refused', message: 'Bad CSRF token.' });
      const ticket = randomBytes(24).toString('hex'), sessionId = randomUUID();
      const principal = { personId: kingdomId, kingdomId, sessionId, expiresAt: Date.now() + 3_600_000, origin: 'live', publicName: 'tobi4s_', look: 'tide' };
      tickets.set(ticket, principal); sessions.set(sessionId, principal);
      report.lastWalker = sessionId;
      return reply(200, { version: 1, status: 'issued', join: { kingdomId, ticket, protocol: 1 }, expiresAt: Date.now() + 60_000 });
    }
    if (req.method === 'GET' && req.url.startsWith('/api/dock/')) {
      // The dock's public presentation stream, read from the live API (GET only), as the page reads it in production.
      const upstream = httpGet(`http://127.0.0.1:5196${req.url}`, { headers: { Accept: req.headers.accept ?? '*/*' } }, response => {
        res.writeHead(response.statusCode ?? 502, { 'Content-Type': response.headers['content-type'] ?? 'application/json', 'Cache-Control': 'no-store' });
        response.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) reply(502, { version: 1, status: 'unavailable', message: 'Dock unavailable.' }); else res.end(); });
      req.on('close', () => upstream.destroy());
      return;
    }
    report.unserved = [...new Set([...(report.unserved ?? []), `${req.method} ${req.url}`])];
    reply(404, { version: 1, status: 'unavailable', message: 'Not on this bench.' });
  });
  own(api);
  const apiPort = await listenFirst(api, CAPTURE_PORTS.filter(p => p !== report.realmPort));

  const { createLandReadServer } = await import(pathToFileURL(resolve('shots/grand-world/land-server/server.mjs')).href);
  // Unpublished: the land routes hang like the live realm's unknown routes do, so only the probe's timeout ends them.
  land = unpublished ? createHttpServer(req => { report.heldLandRequests = (report.heldLandRequests ?? 0) + 1; req.socket.setTimeout(0); })
    : createLandReadServer(resolve('shots/grand-world/land-bake-g3'));
  own(land);
  const landPort = await listenFirst(land, CAPTURE_PORTS.filter(p => p !== report.realmPort && p !== apiPort));

  process.env.CHATDOM_REALM_TARGET = `http://${host}:${realmPort ?? report.realmPort}`;
  process.env.CHATDOM_API_TARGET = `http://${host}:${apiPort}`;
  process.env.CHATDOM_LAND_TARGET = `http://${host}:${landPort}`;
  let previewPort;
  for (const port of pc ? [5192] : CAPTURE_PORTS.filter(p => ![report.realmPort, apiPort, landPort].includes(p))) {
    try { preview = await createPreview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error', ...(today ? { build: { outDir: today } } : {}), preview: { host, port, strictPort: true } }); previewPort = port; break; }
    catch (error) { if (pc || !/already in use/i.test(String(error?.message))) throw error; }
  }
  assert.ok(preview, 'No preview port');
  own(preview.httpServer);
  report.ports = { realm: realmPort ?? report.realmPort, api: apiPort, land: landPort, preview: previewPort };
  const base = pc ? 'http://localhost:5192' : `http://${host}:${previewPort}`;

  browser = pc ? await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 15_000 })
    : await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });

  for (const { w, h } of sizes) {
    const phone = w < 600;
    const run = { size: `${w}x${h}`, cold: true, views: [], landRequests: 0, landBytes: 0 };
    report.runs.push(run);
    // SwiftShader: a fresh context per size. His Chrome: a foreground tab in his own profile (a new window could be
    // occluded and throttled), with the HTTP cache and this origin's storage cleared first, as the cold-load probe does.
    const context = pc ? browser.contexts()[0] : await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    if (pc) {
      await page.setViewportSize({ width: w, height: h }); await page.bringToFront();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.clearBrowserCache');
      await cdp.send('Storage.clearDataForOrigin', { origin: 'http://localhost:5192', storageTypes: 'all' });
      run.renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'), e = gl?.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
    }
    page.on('pageerror', error => report.errors.push(`${run.size}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(`${run.size} console: ${message.text().slice(0, 300)}`); });
    page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/api/realm/land/')) run.landRequests++; });
    // Frame pacing probe: how long each animation-frame callback runs, and the interval between them.
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window), probe = window.__walkFrames = { calls: 0, slow: [], last: 0, intervals: [] };
      window.requestAnimationFrame = callback => raf(time => {
        const started = performance.now();
        if (probe.last) { probe.intervals.push(Math.round(started - probe.last)); if (probe.intervals.length > 20) probe.intervals.shift(); }
        probe.last = started;
        try { callback(time); } finally {
          const took = performance.now() - started; probe.calls++;
          if (took > 200) { probe.slow.push(Math.round(took)); if (probe.slow.length > 20) probe.slow.shift(); }
        }
      });
    });
    const url = `${base}/?walk=1&kingdom=${kingdomId}&hour=${hour}`;
    run.url = url;
    await page.goto(url, { waitUntil: 'commit', timeout: 30_000 });
    run.trail = [];
    const timed = async (predicate, timeout) => {
      const started = Date.now();
      for (;;) {
        const met = await page.waitForFunction(predicate, null, { timeout: 5_000, polling: 100 }).then(() => true, error => { if (error?.name === 'TimeoutError') return false; throw error; });
        if (met) return Math.round(await page.evaluate(() => performance.now()));
        run.trail.push(await page.evaluate(() => {
          const state = window.__chatdomKingdom?.inspect?.();
          return { at: Math.round(performance.now()), ready: !!window.__chatdomReady, loaded: state?.loaded ?? null, renderPhase: state?.renderPhase ?? null,
            land: state?.land ? { phase: state.land.phase, covered: state.land.initialCoveredRegions, required: state.land.initialRequiredRegions, installs: state.land.installs, busy: state.land.busy, queued: state.land.queued, active: state.land.activeRequests, completed: state.land.completedBlobs, startup: state.land.startupPhase, results: state.land.resultBytes } : null, frames: window.__chatdomWalk?.frames ?? null, raf: window.__walkFrames ? { calls: window.__walkFrames.calls, slow: window.__walkFrames.slow.slice(-6), intervals: window.__walkFrames.intervals.slice(-6) } : null, camera: window.__chatdomWalk?.camera ? [window.__chatdomWalk.camera.yaw, window.__chatdomWalk.camera.distance] : null,
            walk: window.__chatdomWalk ? { ready: window.__chatdomWalk.ready, owner: window.__chatdomWalk.owner } : null,
            gate: document.querySelector('.kingdom-gate')?.textContent?.trim().slice(0, 120) ?? null };
        }));
        console.log(JSON.stringify(run.trail.at(-1)));
        if (Date.now() - started > timeout) throw new Error(`Timed out: ${JSON.stringify(run.trail.at(-1))}`);
      }
    };
    // The opening map replaced the plain gate; either one, or the opening's own gate mark, is the designed loader.
    run.gateMs = await timed(() => !!document.querySelector('.kingdom-gate, .opening') || performance.getEntriesByName('chatdom:open:gate').length > 0, 30_000);
    run.gateMs = await page.evaluate(fallback => Math.round(performance.getEntriesByName('chatdom:open:gate')[0]?.startTime ?? fallback), run.gateMs);
    run.loadedMs = await timed(() => window.__chatdomReady === true && !!window.__chatdomKingdom?.inspect?.().loaded, 240_000);
    run.walkableMs = await timed(() => window.__chatdomWalk?.ready === true && window.__chatdomWalk.owner === 'walking', 240_000);
    run.land = await page.evaluate(() => { const s = window.__chatdomKingdom.inspect().land; return s && { generatedColumns: s.generatedColumns, initialNetworkBytes: s.initialNetworkBytes, phase: s.phase, regions: s.regions ?? null }; });
    if (today) assert.equal(run.land, null, "Today's build must draw the old land");
    else if (unpublished) {
      assert.equal(run.land, null, 'An unpublished land must leave the kingdom on today\'s land');
      run.hostedLand = await page.evaluate(() => JSON.parse(document.querySelector('canvas[data-hosted-land]')?.dataset.hostedLand ?? 'null'));
      assert.equal(run.hostedLand?.phase, 'absent'); assert.equal(run.hostedLand?.reason, 'unanswered');
    }
    else { assert.ok(run.land, 'The walk must stand on the grand land'); assert.equal(run.land.generatedColumns, 0); }
    const walker = report.lastWalker;
    const effects = () => { const e = [...effectsSet]; assert.equal(e.length, 1); return e[0]; };
    const self = () => page.evaluate(() => window.__chatdomWalk.self && { ...window.__chatdomWalk.self, yaw: window.__chatdomWalk.camera.yaw });

    for (const name of viewNames) {
      const spot = spots[name];
      const view = { name, note: spot.note, start: spot.start };
      assert.ok(effects().placeWalker(walker, spot.start, world.revision), `placeWalker ${name}`);
      await page.waitForFunction(([x, z]) => { const s = window.__chatdomWalk.self; return s && Math.hypot(s.x - x, s.z - z) < .3 && s.speed < .05; }, [spot.start[0], spot.start[2]], { timeout: 60_000, polling: 100 })
        .catch(async error => { throw new Error(`${error.message}: ${JSON.stringify(await page.evaluate(() => ({ self: window.__chatdomWalk.self, authority: window.__chatdomWalk.authority, frames: window.__chatdomWalk.frames, owner: window.__chatdomWalk.owner })))}`); });
      // Turn the camera with a real drag until it faces the spot (heading convention: (sin h, cos h)).
      const box = { x: Math.round(w * .5), y: Math.round(h * .45) };
      let perPixel = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const yaw = (await self()).yaw;
        const delta = Math.atan2(Math.sin(spot.heading - yaw), Math.cos(spot.heading - yaw));
        if (Math.abs(delta) < .04) break;
        const px = perPixel ? Math.max(-w * .4, Math.min(w * .4, delta / perPixel)) : (delta > 0 ? -60 : 60);
        await page.mouse.move(box.x, box.y); await page.mouse.down();
        await page.mouse.move(box.x + px, box.y, { steps: 8 }); await page.mouse.up();
        await sleep(400);
        const after = (await self()).yaw, turned = Math.atan2(Math.sin(after - yaw), Math.cos(after - yaw));
        if (Math.abs(turned) > 1e-3) perPixel = turned / px;
      }
      view.cameraYaw = (await self()).yaw; view.wantedYaw = spot.heading;
      // Walk in with W, for about the lead distance at walking pace.
      const before = await self();
      // Hold W until the walker has covered the lead (a wall or the door frame may stop it first).
      await page.keyboard.down('KeyW');
      const holdStarted = Date.now(), holdLimit = pc ? spot.walk / 3 * 1000 * 2 + 1500 : 90_000;
      let last = before, stillSince = Date.now();
      while (Date.now() - holdStarted < holdLimit) {
        await sleep(100);
        const now = await self();
        if (Math.hypot(now.x - before.x, now.z - before.z) >= spot.walk - .35) break;
        if (Math.hypot(now.x - last.x, now.z - last.z) > .01) { last = now; stillSince = Date.now(); }
        else if (Date.now() - stillSince > (pc ? 1200 : 20_000) && Math.hypot(now.x - before.x, now.z - before.z) > .2) { view.stopped = true; break; }
      }
      await page.keyboard.up('KeyW');
      view.heldMs = Date.now() - holdStarted;
      await page.waitForFunction(() => (window.__chatdomWalk.self?.speed ?? 1) < .05, null, { timeout: pc ? 10_000 : 60_000, polling: 100 })
        .catch(async error => { throw new Error(`${error.message} (still after W): ${JSON.stringify({ view, before, now: await self(), frames: await page.evaluate(() => window.__chatdomWalk.frames), raf: await page.evaluate(() => window.__walkFrames && { calls: window.__walkFrames.calls, slow: window.__walkFrames.slow, intervals: window.__walkFrames.intervals }) })}`); });
      const after = await self();
      view.walked = Math.hypot(after.x - before.x, after.z - before.z);
      view.end = [after.x, after.y, after.z];
      view.authority = await page.evaluate(() => window.__chatdomWalk.authority);
      if (spot.stop) view.fromStop = Math.hypot(after.x - spot.stop[0], after.z - spot.stop[2]);
      // Ground under the feet: the walker's y against the founded ground and the collision floor.
      const floor = settle([after.x, after.y + .6, after.z]);
      view.floorGap = floor ? after.y - floor[1] : null;
      await sleep(phone ? 1500 : 1200);
      const path = `${values.out}/${prefix}-${name}-${hourName}@${w}x${h}.png`;
      await page.screenshot({ path, timeout: pc ? 30_000 : 180_000 });
      view.png = path;
      run.views.push(view);
      console.log(JSON.stringify({ size: run.size, name, walked: +view.walked.toFixed(2), floorGap: view.floorGap, fromStop: view.fromStop }));
    }
    if (pc) await page.close(); else await context.close();
  }
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  // His Chrome is never closed; only the contexts this run created (closed per size) were ours.
  if (!pc) await browser?.close().catch(() => {});
  for (const cleanup of cleanups) cleanup();
  for (const socket of sockets) socket.destroy();
  try { if (preview) await closeCapturePreview(preview); } catch { /* closed */ }
  await Promise.all([api, land].map(server => server?.listening ? new Promise(done => server.close(done)) : null));
  try { await realm?.gracefullyShutdown?.(false); } catch { /* closed */ }
  await loader?.close().catch(() => {});
  await release?.();
  await mkdir(values.out, { recursive: true });
  await writeFile(`${values.out}/${prefix}-${hourName}.json`, `${JSON.stringify(report, null, 2)}\n`);
  setTimeout(() => process.exit(), 500).unref();
}
