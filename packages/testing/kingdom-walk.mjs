// Real town component + real KingdomRoom + three real Colyseus browser clients. Test-only SIMULATED fixtures.
// Run only after the kingdom build is ready: node packages/testing/kingdom-walk.mjs [--look-only] [--out shots/kingdom/walk]
// --look-only renders one actual town with two additional real SDK clients in that browser context; it is no transport/tour reproof.
// This demonstrates integration in a limited known market floor, NOT immutable-producer/house/tour acceptance.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer as createPortProbe } from 'node:net';
import assert from 'node:assert/strict';
import { acquireCaptureLock } from './capture-lock.mjs';

const { values } = parseArgs({ options: { out: { type: 'string', default: 'shots/kingdom/walk' }, 'look-only': { type: 'boolean', default: false } } });
const lookOnly = values['look-only'];
const repo = fileURLToPath(new URL('../../', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { started: new Date().toISOString(), origin: 'SIMULATED', mode: lookOnly ? 'LOOK-only: one rendered town, three real SDK clients in one browser context' : 'three-world-smoke', checks: [], errors: [], shots: [], limitations: [
  'Temporary test-only reference services, synthetic identities, memory only; no durable claims.',
  'Collision covers only a bounded sampled open part of the actual market. Unknown space is solid.',
  'Immutable founded-world producer, house collision, stairs and tour acceptance remain pending.',
  'SwiftShader screenshots demonstrate appearance and integration; they do not measure real GPU performance.',
  ...(lookOnly ? ['LOOK-only framing review; the previously passed three-browser movement/touch smoke was not rerun. Multiple full town terrain preparations under concurrent SwiftShader rendering exceeded the terrain time budget in a corrective framing attempt.'] : []),
] };
let loader, web, realm, browser, release;
const cancellation = new globalThis.AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  cancellation.abort(new Error(`Capture cancelled by ${signal}`));
  // Closing our browser rejects any pending page wait, allowing the normal owned-service cleanup below.
  void browser?.close().catch(() => {});
});
// Bind only free development ports, never the user's 5190/5191/5192 services. A competing bind fails closed.
const freePorts = async count => {
  const found = [];
  for (let port = 5170; port <= 5199 && found.length < count; port++) {
    if ([5190, 5191, 5192].includes(port)) continue;
    const probe = createPortProbe();
    const free = await new Promise(resolve => { probe.once('error', () => resolve(false)); probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true))); });
    if (free) found.push(port);
  }
  assert.equal(found.length, count, 'Two free development ports are required');
  return found;
};
try {
  release = await acquireCaptureLock({ priority: 'main', signal: cancellation.signal });
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
  const { createRealmServer } = await loader.ssrLoadModule('/apps/realm/src/server.ts');
  const { referenceServices } = await loader.ssrLoadModule('/apps/realm/src/reference.ts');
  const { createSimulatedKingdomWalkFixture, queryLimitedMarketFloor } = await loader.ssrLoadModule('/packages/testing/fixtures/kingdom-walk.ts');
  const fixture = createSimulatedKingdomWalkFixture();
  report.fixture = { manifest: fixture.manifest, homes: fixture.scene.plan.homes.length, placements: fixture.scene.placements.length,
    assets: fixture.scene.assets.length, marketBounds: fixture.floor.bounds, limitation: fixture.limitation };
  const [realmPort, webPort] = await freePorts(2);
  const endpoint = `http://127.0.0.1:${realmPort}`;
  const base = referenceServices();
  let effects, spawnIndex = 0;
  const services = { auth: { ...base.auth, authenticate: async join => {
    const principal = await base.auth.authenticate(join);
    const index = Number(principal.personId.slice(-1)) - 1;
    return { ...principal, look: ['tide', 'grove', 'clay'][index % 3] };
  } }, open: async kingdomId => {
    const handle = await base.open(kingdomId);
    return { ...handle, layoutRevision: fixture.scene.layoutRevision, world: fixture.world,
      spawn: () => fixture.spawns[spawnIndex++ % fixture.spawns.length],
      bootstrap: principal => ({ ...handle.bootstrap(principal), layoutRevision: fixture.scene.layoutRevision, collisionRevision: fixture.world.revision }),
      recoverWalker: (id, revision) => revision === fixture.world.revision && !!effects?.placeWalker(id, fixture.spawns[0], revision),
      bindRoom: bound => { effects = bound; const off = handle.bindRoom(bound); return () => { if (effects === bound) effects = undefined; off(); }; },
    };
  } };
  const created = createRealmServer(services);
  realm = created.server;
  created.transport.app.post('/reference/session', response => response.writeHeader('Access-Control-Allow-Origin', '*').writeHeader('Cache-Control', 'no-store')
    .writeHeader('Content-Type', 'application/json').end(JSON.stringify(base.issue())));
  await realm.listen(realmPort, '127.0.0.1');
  const mainSource = `import { render } from 'solid-js/web'; import { createComponent } from 'solid-js';
    import './style.css'; import Kingdom from './kingdom';
    const response = await fetch('/__simulated-walk/scene');
    if (!response.ok) throw new Error('SIMULATED fixture scene unavailable');
    const bytes = await response.text();
    const fixture = await (await fetch('/__simulated-walk/fixture')).json();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bytes))), n => n.toString(16).padStart(2, '0')).join('');
    if (hash !== fixture.manifest.sceneHash) throw new Error('SIMULATED fixture scene hash mismatch');
    render(() => createComponent(Kingdom, { founded: JSON.parse(bytes) }), document.getElementById('root'));`;
  const plugin = { name: 'simulated-kingdom-walk-fixture-only', enforce: 'pre',
    transform(_code, id) { if (id.split('?')[0] === `${repo}apps/web/src/main.tsx`) return { code: mainSource, map: null }; },
    configureServer(server) { server.middlewares.use((req, res, next) => {
      const path = req.url?.split('?')[0];
      if (!path?.startsWith('/__simulated-walk/')) return next();
      res.setHeader('Cache-Control', 'no-store');
      if (path === '/__simulated-walk/query.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(`export const queryLimitedMarketFloor = ${queryLimitedMarketFloor.toString()};`); }
      else if (path === '/__simulated-walk/scene') { res.setHeader('Content-Type', 'application/json'); res.end(fixture.sceneBytes); }
      else if (path === '/__simulated-walk/fixture') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ manifest: fixture.manifest, floor: fixture.floor, limitation: fixture.limitation })); }
      else { res.statusCode = 404; res.end(); }
    }); },
  };
  web = await createServer({ root: `${repo}apps/web`, configFile: `${repo}apps/web/vite.config.ts`, plugins: [plugin], logLevel: 'error',
    server: { host: '127.0.0.1', port: webPort, strictPort: true, hmr: false } });
  await web.listen();
  const url = `http://127.0.0.1:${webPort}/?walk=1&source=simulated&hour=19.5&time=30`;
  report.url = url; report.ports = { web: webPort, realm: realmPort };
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const clients = [];
  // Pages are constructed and readied serially. The third uses the same real component, briefly, at low size.
  const views = lookOnly ? [['desktop', 1440, 900, false]] : [['desktop', 1440, 900, false], ['phone', 390, 844, true], ['third', 160, 120, false]];
  for (const [name, width, height, mobile] of views) {
    const context = await browser.newContext({ viewport: lookOnly ? { width, height } : { width: 160, height: 120 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    page.on('pageerror', error => { report.errors.push(`${name}: ${error.message}`); console.error(`[walk] ${name}: ${error.message}`); });
    page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) report.errors.push(`${name}: ${message.text()}`); });
    console.log(`[walk] opening ${name}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240_000 });
    await page.waitForFunction(() => window.__chatdomReady === true && window.__chatdomKingdom?.stats.ready, null, { timeout: 240_000 });
    const identity = await page.evaluate(async endpoint => {
      const [{ connectRealm }, { queryLimitedMarketFloor }, fixture] = await Promise.all([
        import('/src/realm/client.ts'), import('/__simulated-walk/query.js'), fetch('/__simulated-walk/fixture').then(r => r.json()),
      ]);
      const collision = { revision: fixture.floor.revision, query: bounds => queryLimitedMarketFloor(fixture.floor, bounds) };
      const scope = window.crypto.randomUUID();
      const client = await connectRealm(endpoint, { kingdomId: fixture.manifest.kingdomId, resumeScope: scope,
        ticket: async () => (await fetch(`${endpoint}/reference/session`, { method: 'POST' })).json() }, collision);
      window.__kingdomWalkEvidence = { client };
      await window.__chatdomKingdom.attachWalk({ client, collision, manifest: fixture.manifest, heading: 0, hud: document.querySelector('[data-chatdom-kingdom]') });
      const ribbon = document.querySelector('.source-ribbon');
      if (ribbon) ribbon.append(document.createTextNode(' · MARKET WALK FIXTURE'));
      return { id: client.selfId, roomId: client.room.roomId, kingdomId: client.room.state.kingdomId, origin: client.room.state.origin,
        layoutRevision: client.room.state.layoutRevision, collisionRevision: client.room.state.collisionRevision };
    }, endpoint);
    assert.equal(identity.origin, 'simulated'); assert.equal(identity.layoutRevision, fixture.manifest.layoutRevision);
    assert.equal(identity.collisionRevision, fixture.manifest.collisionRevision);
    await page.waitForFunction(() => window.__chatdomWalk?.ready === true && window.__chatdomWalk.owner === 'walking' && window.__kingdomWalkEvidence.client.predicting, null, { timeout: 120_000 });
    await page.locator('.source-ribbon').filter({ hasText: 'SIMULATED' }).waitFor({ state: 'visible' });
    clients.push({ name, page, context, width, height, ...identity });
    // Keep earlier real scenes intact at fewer pixels while the next full world prepares on SwiftShader.
    if (!lookOnly && name !== 'third') await page.setViewportSize({ width: 160, height: 120 });
  }
  if (lookOnly) {
    const { page, context, ...identity } = clients[0];
    const peers = await page.evaluate(async endpoint => {
      const [{ connectRealm }, { queryLimitedMarketFloor }, fixture] = await Promise.all([
        import('/src/realm/client.ts'), import('/__simulated-walk/query.js'), fetch('/__simulated-walk/fixture').then(r => r.json()),
      ]);
      const collision = { revision: fixture.floor.revision, query: bounds => queryLimitedMarketFloor(fixture.floor, bounds) };
      const peers = [];
      for (let index = 0; index < 2; index++) peers.push(await connectRealm(endpoint, {
        kingdomId: fixture.manifest.kingdomId, resumeScope: window.crypto.randomUUID(),
        ticket: async () => (await fetch(`${endpoint}/reference/session`, { method: 'POST' })).json(),
      }, collision));
      const timer = window.setInterval(() => {
        for (const client of peers) client.tick(window.performance.now(), { moveX: 0, moveZ: 0, buttons: 0, yaw: 0, collisionRevision: fixture.floor.revision });
      }, 50);
      window.__kingdomWalkLookPeers = { peers, timer };
      return peers.map(client => ({ id: client.selfId, roomId: client.room.roomId, kingdomId: client.room.state.kingdomId,
        origin: client.room.state.origin, layoutRevision: client.room.state.layoutRevision, collisionRevision: client.room.state.collisionRevision }));
    }, endpoint);
    report.clients = [{ ...identity, renderedTown: true }, ...peers.map(peer => ({ ...peer, renderedTown: false, sameBrowserContext: true }))];
    await page.waitForFunction(() => window.__chatdomWalk?.walkers === 3 && window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 180_000 });
    await mkdir(values.out, { recursive: true });
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width, height });
      if (width === 390) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 78, y: 550, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await page.locator('.walker-name').filter({ hasText: 'Visitor 2' }).waitFor({ state: 'visible', timeout: 30_000 });
      await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
      const path = `${values.out}/kingdom-market-walk@${width}x${height}.png`;
      await page.screenshot({ path }); report.shots.push(path); console.log(`[walk] captured ${path}`);
      report.checks.push({ name: `LOOK-only ${width}x${height}; same actual town resized`, stats: await page.evaluate(() => ({ ...window.__chatdomKingdom.stats })),
        walk: await page.evaluate(() => window.__chatdomKingdom.walkDebug()) });
    }
    await page.evaluate(() => {
      window.clearInterval(window.__kingdomWalkLookPeers.timer);
      for (const client of window.__kingdomWalkLookPeers.peers) client.dispose();
      window.__chatdomKingdom.detachWalk(); window.__kingdomWalkEvidence.client.dispose();
    });
  } else {
  assert.equal(new Set(clients.map(client => client.id)).size, 3, 'Three clients must have distinct simulated identities');
  for (const { page, width, height } of clients) await page.setViewportSize({ width, height });
  for (const { page } of clients) await page.waitForFunction(() => window.__chatdomWalk?.walkers === 3, null, { timeout: 15_000 });
  console.log('[walk] three real kingdom clients ready');
  report.clients = clients.map(client => Object.fromEntries(['name', 'width', 'height', 'id', 'roomId', 'kingdomId', 'origin', 'layoutRevision', 'collisionRevision'].map(key => [key, client[key]])));
  const [desktop, phone, third] = clients;
  const truth = id => { const state = effects.readWalker(id); assert.ok(state, 'Room lost its citizen'); return { x: state.x, y: state.y, z: state.z, vx: state.vx, vz: state.vz }; };
  const seenByAll = async (id, position) => {
    for (const { page } of clients) await page.waitForFunction(({ id, position }) => {
      const p = window.__kingdomWalkEvidence.client.room.state.walkers.get(id);
      return p && p.x === position.x && p.y === position.y && p.z === position.z;
    }, { id, position }, { timeout: 15_000 });
  };
  const idle = async id => {
    const end = Date.now() + 15_000;
    let prior = truth(id), stable = 0;
    while (Date.now() < end) { await sleep(150); const next = truth(id); stable = next.x === prior.x && next.z === prior.z && next.vx === 0 && next.vz === 0 ? stable + 1 : 0; if (stable >= 3) return next; prior = next; }
    throw new Error('Citizen failed to stop after input release');
  };
  const moved = async (id, from) => {
    const end = Date.now() + 10_000;
    while (Date.now() < end) { await sleep(100); const p = truth(id); if (Math.hypot(p.x - from.x, p.z - from.z) > .15) return; }
    throw new Error('No authoritative movement after input was held for ten seconds');
  };
  await desktop.page.bringToFront();
  const moves = [];
  // Real keyboard event path, including each WASD direction; every stopped authority pose reaches all clients.
  for (const key of ['KeyW', 'KeyD', 'KeyS', 'KeyA']) {
    const from = truth(desktop.id);
    await desktop.page.keyboard.down(key);
    try { await moved(desktop.id, from); } finally { await desktop.page.keyboard.up(key); }
    const to = await idle(desktop.id);
    assert.ok(Math.hypot(to.x - from.x, to.z - from.z) > .1, `${key} did not move the room's citizen`);
    await seenByAll(desktop.id, to); moves.push({ key, from, to, observedBy: 3 });
    console.log(`[walk] ${key} moved and stopped in all three clients`);
  }
  report.checks.push({ name: 'real WASD moves and stops; all three browsers hold authority positions', moves });
  await phone.page.bringToFront();
  await phone.page.setViewportSize({ width: 420, height: 820 });
  await phone.page.setViewportSize({ width: 390, height: 844 });
  const from = truth(phone.id), cdp = await phone.context.newCDPSession(phone.page);
  // Genuine browser touch sequence through the lower-left floating stick, rather than an input override.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 78, y: 550, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 78, y: 510, id: 1 }] });
  try { await moved(phone.id, from); } finally { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  const to = await idle(phone.id);
  assert.ok(Math.hypot(to.x - from.x, to.z - from.z) > .1, 'Phone touch did not move the room citizen');
  await seenByAll(phone.id, to);
  report.checks.push({ name: 'phone resize and real touch move/stop', from, to, observedBy: 3 });
  console.log('[walk] phone touch moved and stopped in all three clients');
  await desktop.page.bringToFront();
  await desktop.page.getByRole('button', { name: 'Above the streets', exact: true }).click();
  await desktop.page.waitForFunction(() => window.__chatdomWalk.owner === 'released');
  await desktop.page.getByRole('button', { name: 'Walk with everyone', exact: true }).click();
  await desktop.page.waitForFunction(() => window.__chatdomWalk.owner === 'walking');
  report.checks.push({ name: 'overview releases the walk camera; Walk with everyone resumes it', passed: true });
  // Keep the real third citizen ahead in the street view, with its full scene at fewer pixels for capture.
  await third.page.setViewportSize({ width: 160, height: 120 });
  await mkdir(values.out, { recursive: true });
  for (const client of [desktop, phone]) {
    await client.page.bringToFront();
    await client.page.waitForFunction(() => window.__chatdomReady === true && window.__chatdomWalk?.ready === true && window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 180_000 });
    await client.page.locator('.walker-name').first().waitFor({ state: 'visible', timeout: 30_000 });
    await client.page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
    const path = `${values.out}/kingdom-market-walk@${client.width}x${client.height}.png`;
    await client.page.screenshot({ path }); report.shots.push(path);
    console.log(`[walk] captured ${path}`);
    report.checks.push({ name: `${client.name} actual kingdom walk`, stats: await client.page.evaluate(() => ({ ...window.__chatdomKingdom.stats })),
      walk: await client.page.evaluate(() => window.__chatdomKingdom.walkDebug()) });
  }
  for (const { page } of clients) await page.evaluate(() => { window.__chatdomKingdom.detachWalk(); window.__kingdomWalkEvidence.client.dispose(); });
  }
  assert.deepEqual(report.errors, [], 'Browser errors must be empty');
  report.result = 'passed';
} catch (error) {
  report.result = 'failed'; report.failure = error.stack ?? String(error); process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await web?.close().catch(() => {});
  await realm?.gracefullyShutdown(false).catch(() => {});
  await loader?.close().catch(() => {});
  await release?.();
  await mkdir(values.out, { recursive: true });
  await writeFile(`${values.out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
// uWebSockets may retain native handles briefly after graceful shutdown; all owned services are closed above.
process.exit(process.exitCode ?? 0);
