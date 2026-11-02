// PL10's stills: first and third person at one spot, sole close-ups before and after on a slope, a stair and a raised
// floor, a dusk street with bubbles over lit homes and only walkers in it, and the hamlet. The real kingdom page on a
// stills fixture (fixture.ts) with full production collision and a memory-only realm this script owns.
//
//   SwiftShader, under the shared capture lock, ONE still per lock hold (the shared capture guard stops anything that
//   holds the lock for 12 minutes, and opening the kingdom in software takes several): several names run one after
//   another, each in its own process that takes the lock, opens the page, shoots and releases it before the next.
//     node apps/web/src/walk/stills/stills.mjs [--land town|hamlet] [--only third,first] [--out shots/play/stills]
//   Real GPU, inside the lease (web on 5192, realm on 5191, each still a fresh load through `chatdom-pc shot`):
//     chatdom-pc-lease -- node apps/web/src/walk/stills/stills.mjs --target pc [--land town|hamlet]
//
// Test identities exist only in the memory room and are never Twitch claims. Dev only: never a route, never built.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer as createProbe } from 'node:net';
import { spawn } from 'node:child_process';
import { CAPTURE_PORTS } from '../../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const { values } = parseArgs({ options: {
  target: { type: 'string', default: 'swiftshader' }, land: { type: 'string', default: 'town' },
  only: { type: 'string' }, out: { type: 'string', default: 'shots/play/stills' }, size: { type: 'string', default: '1440x900' },
} });
const [width, height] = values.size.split('x').map(Number);
const pc = values.target === 'pc';
if (!['town', 'hamlet'].includes(values.land)) throw new Error('--land is town or hamlet');
const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const ALL = values.land === 'hamlet' ? ['dusk', 'third'] : ['third', 'first', 'dusk', 'slope-before', 'slope-after', 'stairs-before', 'stairs-after', 'floor-before', 'floor-after'];
const names = values.only ? values.only.split(',') : ALL;
if (!pc && names.length > 1) {
  // One still per lock hold: run each in its own process and let the queue serve the other lanes in between.
  let failed = 0;
  for (const name of names) {
    const args = [fileURLToPath(import.meta.url), '--land', values.land, '--only', name, '--out', values.out, '--size', values.size];
    const code = await new Promise(resolve => spawn(process.execPath, args, { stdio: 'inherit' }).once('exit', resolve));
    if (code !== 0) failed++;
  }
  process.exit(failed ? 1 : 0);
}
const report = { land: values.land, target: values.target, width, height, stills: [], errors: [] };
const stamp = name => `${values.out}/${values.land}-${name}${pc ? '-gpu' : ''}@${width}x${height}`;

const free = port => new Promise(resolve => { const probe = createProbe(); probe.once('error', () => resolve(false)); probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true))); });
async function ports() {
  if (pc) return [5191, 5192]; // the lease checked both are free and forwards them to the GPU machine
  const found = [];
  for (const port of CAPTURE_PORTS) { if (await free(port)) found.push(port); if (found.length === 2) return found; }
  throw new Error('No free capture ports');
}

let loader, web, realm, browser, release;
try {
  await mkdir(values.out, { recursive: true });
  console.log(`Stills: building the ${values.land} and its collision`);
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false } });
  const [{ createRealmServer }, { referenceServices }, { createStillsFixture }] = await Promise.all([
    loader.ssrLoadModule('/apps/realm/src/server.ts'), loader.ssrLoadModule('/apps/realm/src/reference.ts'), loader.ssrLoadModule('/apps/web/src/walk/stills/fixture.ts')]);
  const fixture = createStillsFixture(values.land);
  report.fixture = { homes: fixture.homes, placements: fixture.scene.placements.length, spots: fixture.spots, speakers: fixture.speakers };
  console.log(`Stills: ${fixture.homes} homes; spots ${Object.entries(fixture.spots).map(([k, v]) => `${k}${v ? '' : ' (none)'}`).join(', ')}`);
  const info = JSON.stringify({ land: fixture.land, manifest: fixture.manifest, spots: fixture.spots, beside: fixture.beside, speakers: fixture.speakers });

  if (!pc) release = await acquireCaptureLock();
  const [realmPort, webPort] = await ports(), endpoint = pc ? `http://localhost:${realmPort}` : `http://127.0.0.1:${realmPort}`;
  const base = referenceServices();
  let effects;
  const names3 = ['Rowan', 'Wren', 'Juniper'];
  const created = createRealmServer({ auth: { ...base.auth, authenticate: async join => {
    const principal = await base.auth.authenticate(join), index = Number(principal.personId) - 990000001;
    return { ...principal, publicName: names3[index % 3], look: ['tide', 'grove', 'clay'][index % 3] };
  } }, open: async id => {
    const handle = await base.open(id);
    return { ...handle, layoutRevision: fixture.scene.layoutRevision, world: fixture.world,
      spawn: () => fixture.spots.street.feet,
      bootstrap: principal => ({ ...handle.bootstrap(principal), layoutRevision: fixture.scene.layoutRevision, collisionRevision: fixture.world.revision }),
      recoverWalker: (walker, revision) => revision === fixture.world.revision && !!effects?.placeWalker(walker, fixture.spots.street.feet, revision),
      bindRoom: value => { effects = value; const off = handle.bindRoom(value); return () => { effects = undefined; off(); }; } };
  } });
  realm = created.server;
  const cors = response => response.writeHeader('Access-Control-Allow-Origin', '*').writeHeader('Cache-Control', 'no-store');
  created.transport.app.post('/reference/session', response => cors(response).writeHeader('Content-Type', 'application/json').end(JSON.stringify(base.issue())));
  // Stand a test walker on a spot of the fixture's own collision (the page asks; the realm places it as a recovery would).
  created.transport.app.get('/stills/place', (response, request) => {
    const q = new globalThis.URLSearchParams(request.getQuery() ?? ''), at = ['x', 'y', 'z'].map(k => Number(q.get(k)));
    const ok = at.every(Number.isFinite) && !!effects?.placeWalker(q.get('id') ?? '', at, fixture.world.revision);
    cors(response).writeStatus(ok ? '200 OK' : '409 Conflict').end(ok ? 'placed' : 'refused');
  });
  await realm.listen(realmPort, '127.0.0.1');
  const plugin = { name: 'play-stills', enforce: 'pre',
    transform(_code, id) { if (id.split('?')[0] === `${repo}apps/web/src/main.tsx`) return { code: "import './walk/stills/page';", map: null }; },
    configureServer(server) { server.middlewares.use((request, response, next) => {
      const path = request.url?.split('?')[0];
      if (path !== '/__stills/scene' && path !== '/__stills/fixture') return next();
      response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
      response.end(path === '/__stills/scene' ? fixture.sceneBytes : info);
    }); } };
  web = await createServer({ root: `${repo}apps/web`, configFile: `${repo}apps/web/vite.config.ts`, plugins: [plugin], logLevel: 'error',
    server: { host: '127.0.0.1', port: webPort, strictPort: true, hmr: false } });
  await web.listen();
  const url = name => `http://${pc ? 'localhost' : '127.0.0.1'}:${webPort}/?source=simulated&hour=19.5&still=${name}&realm=${encodeURIComponent(endpoint)}`;

  if (pc) {
    for (const name of names) {
      const out = `${stamp(name)}.png`;
      const code = await new Promise(resolve => spawn('chatdom-pc', ['shot', url(name), out, '--size', `${width}x${height}`, '--timeout', '240', '--settle', '2'], { stdio: 'inherit' }).once('exit', resolve));
      report.stills.push({ name, out, ok: code === 0 });
    }
  } else {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) report.errors.push(message.text()); });
    console.log('Stills: opening the kingdom');
    await page.goto(url(names[0]), { waitUntil: 'commit' });
    for (const [index, name] of names.entries()) {
      if (index) await page.evaluate(name => window.__chatdomStills.stage(name), name);
      await page.waitForFunction(() => window.__chatdomReady === true || !!window.__chatdomStills?.error, null, { timeout: 420_000 });
      const error = await page.evaluate(() => window.__chatdomStills?.error);
      if (error) throw new Error(error);
      const out = `${stamp(name)}.png`;
      await page.screenshot({ path: out, timeout: 180_000 });
      report.stills.push({ name, out, ok: true, walk: await page.evaluate(() => JSON.parse(JSON.stringify({ self: window.__chatdomWalk?.self, facts: window.__chatdomStills.facts }))) });
      console.log(`Stills: ${out}`);
    }
  }
} catch (error) {
  report.failure = String(error?.stack ?? error);
  process.exitCode = 1;
  console.error(report.failure);
} finally {
  await writeFile(`${values.out}/${values.land}${pc ? '-gpu' : `-${names[0]}`}.json`, JSON.stringify(report, null, 2)).catch(() => {});
  await browser?.close().catch(() => {});
  await web?.close().catch(() => {});
  await realm?.gracefullyShutdown(false).catch(() => {});
  await loader?.close().catch(() => {});
  await release?.();
}
process.exit(process.exitCode ?? 0);
