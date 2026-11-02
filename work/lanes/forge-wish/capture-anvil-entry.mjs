// The anvil opening the wish box in the kingdom's own walk (FW10, SEAMS.md §1).
// Real kingdom component, real KingdomRoom and a real walker, on the test-only market-walk town from
// packages/testing/fixtures. The walker is placed by the anvil and presses E; the room accepts the forge visit and the
// founded kingdom's anvil entry opens the wish box. Only the private Forge chat routes are answered by fixture data
// (a signed-in citizen with the chat grant), so no Twitch call or wish leaves this browser.
// Run: nice -n 10 node work/lanes/forge-wish/capture-anvil-entry.mjs
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createPortProbe } from 'node:net';
import assert from 'node:assert/strict';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const output = `${repo}work/evidence/forge-wish/wish-panel`;
// Free development ports only (AGENTS.md: 5170–5199 without 5187 and 5190–5197).
// 5172, 5198 and 5199 are probed on and off by another process on this host; stay clear of them.
const LANE_PORTS = [5170, 5171, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5182, 5183, 5184, 5185, 5186, 5188, 5189];
const report = { started: new Date().toISOString(), fixture: 'market-walk town (packages/testing/fixtures/kingdom-walk.ts)',
  forgeRoutes: 'fixture: signed-in citizen, chat grant ready, no wish sent', checks: [], errors: [], shots: [] };
let loader, web, realm, browser, release;
const freePorts = async count => {
  const found = [];
  for (const port of LANE_PORTS) {
    if (found.length === count) break;
    const probe = createPortProbe();
    const free = await new Promise(resolve => { probe.once('error', () => resolve(false)); probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true))); });
    if (free) found.push(port);
  }
  assert.equal(found.length, count, 'No free lane port.');
  return found;
};
const cleanup = async () => {
  await browser?.close().catch(() => {});
  await web?.close().catch(() => {});
  await realm?.gracefullyShutdown?.(false).catch(() => {});
  await loader?.close().catch(() => {});
  await release?.();
};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
// A drained event loop mid-capture is a failure, never a silent success.
let stage = 'start', finished = false;
const at = name => { stage = name; console.log(`[anvil] ${name}`); };
process.once('beforeExit', () => { if (!finished) { console.error(`[anvil] stopped without a result at: ${stage}`); process.exitCode = 1; } });
const dry = process.env.ANVIL_DRY === '1';
try {
  // Wait in the shared queue before binding any port, so a long wait never holds scarce development ports.
  if (!dry) release = await acquireCaptureLock({ priority: 'lane' });
  at('lock');
  const lockedAt = Date.now();
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
  const { createRealmServer } = await loader.ssrLoadModule('/apps/realm/src/server.ts');
  const { referenceServices } = await loader.ssrLoadModule('/apps/realm/src/reference.ts');
  const { createSimulatedKingdomWalkFixture, queryLimitedMarketFloor } = await loader.ssrLoadModule('/packages/testing/fixtures/kingdom-walk.ts');
  const { createInteractionAuthority, ownedHomes } = await loader.ssrLoadModule('/apps/realm/src/interactions/index.ts');
  const { REALM_RECONNECT_GRACE_MS } = await loader.ssrLoadModule('/apps/realm/src/auth/seats.ts');
  const { createFoundedInteractionRegistry } = await loader.ssrLoadModule('/packages/world/src/interactions/index.ts');
  const fixture = createSimulatedKingdomWalkFixture();
  at('fixture');
  const elevation = fixture.scene.plan.market.elevation;
  const [realmPort, webPort] = await freePorts(2);
  const endpoint = `http://127.0.0.1:${realmPort}`;
  const base = referenceServices();
  let effects;
  const services = { auth: { ...base.auth, authenticate: async join => ({ ...(await base.auth.authenticate(join)), look: 'tide' }) },
    open: async kingdomId => {
      const handle = await base.open(kingdomId);
      // The room's actual interaction authority over the town's founded registry, composed through the handle's own
      // intent/lifecycle/bindRoom/bindTransient hooks exactly as the durable kingdom composes it. Rights are the
      // reference session's; no home is owned, so only the anvil and seats are open.
      const registry = createFoundedInteractionRegistry(fixture.scene, fixture.world);
      const interactions = createInteractionAuthority({ writerEpoch: handle.writerEpoch, clock: Date.now, reconnectGraceMs: REALM_RECONNECT_GRACE_MS,
        world: () => fixture.world, registry: () => registry,
        rights: { current: (principal, now) => base.auth.current(principal, now), permitted: () => true },
        homes: ownedHomes(() => ({ homes: {} }), () => fixture.scene.layoutRevision),
        recovery: (walkerId, revision) => revision === fixture.world.revision && !!effects?.placeWalker(walkerId, [0, elevation, 10.2], revision) });
      let owner;
      return { ...handle, layoutRevision: fixture.scene.layoutRevision, world: fixture.world,
        spawn: () => [0, elevation, 10.2],
        intent: (context, intent) => intent.type === 'interact' ? interactions.intent(context, intent) : handle.intent(context, intent),
        lifecycle: (event, principal, walkerId, now) => { handle.lifecycle(event, principal, walkerId, now); interactions.lifecycle(event, principal, walkerId, now); },
        bootstrap: principal => {
          owner?.(principal.personId, { type: 'interaction', requestId: null, writerEpoch: handle.writerEpoch, state: interactions.selfState(principal.sessionId) });
          return { ...handle.bootstrap(principal), layoutRevision: fixture.scene.layoutRevision, collisionRevision: fixture.world.revision };
        },
        recoverWalker: (id, revision) => revision === fixture.world.revision && !!effects?.placeWalker(id, [0, elevation, 10.2], revision),
        bindRoom: bound => {
          effects = bound; const off = handle.bindRoom(bound), offAuthority = interactions.bindRoom(bound);
          return () => { if (effects === bound) effects = undefined; offAuthority(); off(); };
        },
        bindTransient: (send, toOwner) => {
          owner = toOwner; const off = handle.bindTransient(send, toOwner), offDelivery = interactions.bindDelivery({ transient: send, owner: toOwner });
          return () => { owner = undefined; offDelivery(); off(); };
        },
      };
    } };
  const created = createRealmServer(services);
  realm = created.server;
  created.transport.app.post('/reference/session', response => response.writeHeader('Access-Control-Allow-Origin', '*').writeHeader('Cache-Control', 'no-store')
    .writeHeader('Content-Type', 'application/json').end(JSON.stringify(base.issue())));
  // A port taken between the probe and the bind leaves the native listen unanswered: bound it.
  await Promise.race([realm.listen(realmPort, '127.0.0.1'), new Promise((_, reject) => setTimeout(() => reject(new Error(`realm could not bind ${realmPort}`)), 20_000))]);
  at('realm');
  const mainSource = `import { render } from 'solid-js/web'; import { createComponent } from 'solid-js';
    import './style.css'; import Kingdom from './kingdom';
    const bytes = await (await fetch('/__anvil-walk/scene')).text();
    render(() => createComponent(Kingdom, { founded: JSON.parse(bytes) }), document.getElementById('root'));`;
  const plugin = { name: 'forge-anvil-walk-capture', enforce: 'pre',
    transform(_code, id) { if (id.split('?')[0] === `${repo}apps/web/src/main.tsx`) return { code: mainSource, map: null }; },
    configureServer(server) { server.middlewares.use((req, res, next) => {
      const path = req.url?.split('?')[0];
      if (!path?.startsWith('/__anvil-walk/')) return next();
      res.setHeader('Cache-Control', 'no-store');
      if (path === '/__anvil-walk/query.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(`export const queryLimitedMarketFloor = ${queryLimitedMarketFloor.toString()};`); }
      else if (path === '/__anvil-walk/scene') { res.setHeader('Content-Type', 'application/json'); res.end(fixture.sceneBytes); }
      else if (path === '/__anvil-walk/fixture') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ manifest: fixture.manifest, floor: fixture.floor })); }
      else { res.statusCode = 404; res.end(); }
    }); },
  };
  web = await createServer({ root: `${repo}apps/web`, configFile: `${repo}apps/web/vite.config.ts`, plugins: [plugin], logLevel: 'error',
    server: { host: '127.0.0.1', port: webPort, strictPort: true, hmr: false } });
  await web.listen();
  at('web');
  if (dry) { finished = true; console.log(JSON.stringify(report.ports ?? { web: webPort, realm: realmPort })); throw Object.assign(new Error('dry run'), { dry: true }); }
  report.ports = { web: webPort, realm: realmPort };
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  const kingdomId = fixture.manifest.kingdomId;
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/realm/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/realm/session') return json(route, { version: 1, status: 'authenticated', expiresAt: Date.now() + 3_600_000,
      resumeScope: 'anvil-capture-scope', csrfToken: 'c'.repeat(40) });
    if (url.pathname === '/api/realm/forge/chat/status') return json(route, { version: 1, status: 'ok', kingdomId, grant: { status: 'ready' },
      availability: { status: 'ready' }, wish: null });
    // Nothing else of the realm API exists in this capture (the town's clock falls back to the page's own hour).
    report.unanswered = [...new Set([...(report.unanswered ?? []), url.pathname])];
    return route.abort();
  });
  at('browser');
  await page.goto(`http://127.0.0.1:${webPort}/?walk=1&hour=19.5&time=30`, { waitUntil: 'domcontentloaded', timeout: 240_000 });
  await page.waitForFunction(() => window.__chatdomReady === true && window.__chatdomKingdom?.stats.ready, null, { timeout: 240_000 });
  report.checks.push({ name: 'town ready', seconds: (Date.now() - lockedAt) / 1000 });
  // Radians about +Y, zero faces +Z (apps/web/src/walk/input/direction.ts): π looks from the spawn towards the anvil at z = 8.
  const heading = Number(process.env.ANVIL_HEADING ?? Math.PI);
  await page.evaluate(async ({ endpoint, heading }) => {
    const [{ connectRealm }, { queryLimitedMarketFloor }, fixture] = await Promise.all([
      import('/src/realm/client.ts'), import('/__anvil-walk/query.js'), fetch('/__anvil-walk/fixture').then(r => r.json()),
    ]);
    const collision = { revision: fixture.floor.revision, query: bounds => queryLimitedMarketFloor(fixture.floor, bounds) };
    const client = await connectRealm(endpoint, { kingdomId: fixture.manifest.kingdomId, resumeScope: window.crypto.randomUUID(),
      ticket: async () => (await fetch(`${endpoint}/reference/session`, { method: 'POST' })).json() }, collision);
    window.__anvilCapture = { client };
    await window.__chatdomKingdom.attachWalk({ client, collision, manifest: fixture.manifest, heading, hud: document.querySelector('[data-chatdom-kingdom]') });
  }, { endpoint, heading });
  await page.waitForFunction(() => window.__chatdomWalk?.ready === true && window.__chatdomWalk.owner === 'walking', null, { timeout: 120_000 });
  const focus = async () => page.evaluate(() => { const d = window.__chatdomKingdom.interactionDebug(); return d && { focus: d.focus, action: d.action, prompt: d.prompt }; });
  let seen = null;
  for (let i = 0; i < 40 && seen?.action !== 'forge'; i++) { await page.waitForTimeout(250); seen = await focus(); }
  report.checks.push({ name: 'anvil in focus', heading, debug: seen });
  assert.equal(seen?.action, 'forge', `The walker must face the anvil (heading ${heading}); saw ${JSON.stringify(seen)}`);
  await page.keyboard.press('KeyE');
  const box = page.getByLabel('What would you like to make?');
  try { await box.waitFor({ timeout: 30_000 }); }
  catch (error) {
    report.afterUse = await page.evaluate(() => ({ debug: window.__chatdomKingdom.interactionDebug(),
      dialog: document.querySelector('[role="dialog"]')?.textContent?.slice(0, 400) ?? null }));
    await page.screenshot({ path: '/tmp/chatdom-forge-wish/anvil-failure.png' });
    throw error;
  }
  await box.fill('a little fox asleep on my chimney');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
  await mkdir(output, { recursive: true });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(600);
    await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    const path = `${output}/walk-anvil@${width}x${height}.png`;
    await page.screenshot({ path }); report.shots.push(path.slice(repo.length));
    report.checks.push({ name: `wish box at ${width}x${height}`, fits, held: await page.evaluate(() => window.__chatdomKingdom.interactionDebug()?.held ?? null) });
  }
  // Closing the box ends the visit and gives the walk back.
  await page.getByRole('button', { name: /close|leave/i }).first().click();
  await page.waitForFunction(() => window.__chatdomWalk?.owner === 'walking' && !document.querySelector('.forge-panel'), null, { timeout: 15_000 });
  report.checks.push({ name: 'closing returns the walk', owner: await page.evaluate(() => window.__chatdomWalk.owner) });
  report.lockSeconds = (Date.now() - lockedAt) / 1000;
  await writeFile(`${output}/walk-anvil.json`, JSON.stringify(report, null, 2) + '\n');
  finished = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (error?.dry) { await cleanup(); process.exit(0); }
  finished = true;
  report.failure = String(error?.stack ?? error);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally { await cleanup(); }
