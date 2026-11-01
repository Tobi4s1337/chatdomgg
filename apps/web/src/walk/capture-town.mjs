// One actual-town still or short clip per capture-lock acquisition. Three real SDK connections;
// test identities and the temporary memory-only room are explicitly SIMULATED, never real Twitch claims.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer as createProbe } from 'node:net';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { CAPTURE_PORTS } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { createOfflineReview } from './offline-review.mjs';

const { values } = parseArgs({ options: { width: { type: 'string', default: '1440' }, height: { type: 'string', default: '900' },
  clip: { type: 'boolean', default: false }, offline: { type: 'boolean', default: false }, out: { type: 'string', default: 'shots/walking-together/town' } } });
const width = Number(values.width), height = Number(values.height);
assert.ok([[1440, 900], [390, 844]].some(([w, h]) => w === width && h === height), 'Use a standard web size');
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const report = { origin: 'SIMULATED', width, height, clip: values.clip, offline: values.offline, errors: [], clients: [], checks: [], output: '' };
let loader, web, realm, browser, offline, page;
let complete = false, stage = 'waiting for capture lock';
const cancellation = new globalThis.AbortController();
for (const name of ['SIGINT', 'SIGTERM', 'SIGUSR2']) process.once(name, () => {
  console.error(`SIMULATED town: received ${name} during ${stage}`);
  cancellation.abort(new Error(`Town capture cancelled by ${name}`)); void browser?.close().catch(() => {});
});
const release = await acquireCaptureLock({ signal: cancellation.signal });
const freePorts = async count => {
  const ports = [];
  for (const port of CAPTURE_PORTS) {
    const probe = createProbe();
    const free = await new Promise(resolve => { probe.once('error', () => resolve(false)); probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true))); });
    if (free) ports.push(port);
    if (ports.length === count) return ports;
  }
  throw new Error('No free safe town capture ports');
};
const output = `${values.out}/town${values.clip ? '-clip' : ''}@${width}x${height}`;
process.once('exit', code => {
  if (complete) return;
  // A transport's process-level signal handler can exit before our async finally/catch runs.
  // Preserve the observed stage and never report a missing artifact as a successful capture.
  console.error(`SIMULATED town: exited during ${stage}; capture incomplete`);
  try { writeFileSync(`${output}.failure.json`, JSON.stringify({ ...report, stage, failure: `Process exited ${code} before capture completion` }, null, 2)); } catch { /* output directory may not exist yet */ }
  if (code === 0) process.exitCode = 1;
});
try {
  await mkdir(values.out, { recursive: true });
  // Do not spend the full collision compile holding a capture slot if no listener can be started.
  const [realmPort, webPort] = await freePorts(values.offline ? 1 : 2), endpoint = `http://127.0.0.1:${realmPort}`;
  report.ports = { realm: realmPort, web: webPort };
  stage = 'compiling full collision';
  console.log(`SIMULATED town: preparing full collision; allowed realm port ${realmPort}`);
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false } });
  const [{ createRealmServer }, { referenceServices }, { createSimulatedTownWalkFixture }] = await Promise.all([
    loader.ssrLoadModule('/apps/realm/src/server.ts'), loader.ssrLoadModule('/apps/realm/src/reference.ts'), loader.ssrLoadModule('/apps/web/src/walk/town-fixture.ts'),
  ]);
  const fixture = createSimulatedTownWalkFixture();
  report.fixture = { manifest: fixture.manifest, placements: fixture.scene.placements.length, limitation: fixture.limitation };
  console.log(`SIMULATED town: compiled ${fixture.scene.placements.length} native placements`);
  const base = referenceServices();
  let spawnIndex = 0, effects;
  const created = createRealmServer({ auth: { ...base.auth, authenticate: async join => {
    const principal = await base.auth.authenticate(join), index = Number(principal.personId) - 990000001;
    return { ...principal, publicName: `SIMULATED ${['Juniper', 'Wren', 'Rowan'][index % 3]}`, look: ['tide', 'grove', 'clay'][index % 3] };
  } }, open: async id => {
    const handle = await base.open(id);
    return { ...handle, layoutRevision: fixture.scene.layoutRevision, world: fixture.world,
      spawn: () => fixture.spawns[spawnIndex++ % fixture.spawns.length],
      bootstrap: principal => ({ ...handle.bootstrap(principal), layoutRevision: fixture.scene.layoutRevision, collisionRevision: fixture.world.revision }),
      recoverWalker: (id, revision) => revision === fixture.world.revision && !!effects?.placeWalker(id, fixture.spawns[0], revision),
      bindRoom: value => { effects = value; const off = handle.bindRoom(value); return () => { effects = undefined; off(); }; },
    };
  } });
  realm = created.server;
  created.transport.app.post('/reference/session', response => response.writeHeader('Access-Control-Allow-Origin', '*').writeHeader('Cache-Control', 'no-store')
    .writeHeader('Content-Type', 'application/json').end(JSON.stringify(base.issue())));
  await realm.listen(realmPort, '127.0.0.1');
  console.log(`SIMULATED town: owned memory realm listening on ${realmPort}`);
  stage = 'compiling and opening browser page';
  const main = `import { render } from 'solid-js/web'; import { createComponent } from 'solid-js'; import './style.css'; import Kingdom from './kingdom';
    import { connectRealm } from './realm/client'; import { compileFoundedScene } from '@chatdom/world/founded-collision';
    window.__walkingTogetherDependencies = { connectRealm, compileFoundedScene };
    const raw = await (await fetch('/__walk-town/scene')).text(); const fixture = await (await fetch('/__walk-town/fixture')).json();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))), n => n.toString(16).padStart(2,'0')).join('');
    if(hash!==fixture.manifest.sceneHash)throw new Error('SIMULATED town scene hash mismatch');
    render(()=>createComponent(Kingdom,{founded:JSON.parse(raw)}),document.getElementById('root'));`;
  const plugin = { name: 'simulated-town-walk-evidence', enforce: 'pre',
    transform(_code, id) { if (id.split('?')[0] === `${repo}apps/web/src/main.tsx`) return { code: main, map: null }; },
    configureServer(server) { server.middlewares.use((request, response, next) => {
      const path = request.url?.split('?')[0];
      if (!path?.startsWith('/__walk-town/')) return next();
      response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
      if (path === '/__walk-town/scene') response.end(fixture.sceneBytes);
      else if (path === '/__walk-town/fixture') response.end(JSON.stringify({ manifest: fixture.manifest }));
      else { response.statusCode = 404; response.end(); }
    }); },
  };
  if (!values.offline) {
    web = await createServer({ root: `${repo}apps/web`, configFile: `${repo}apps/web/vite.config.ts`, plugins: [plugin], logLevel: 'error',
      server: { host: '127.0.0.1', port: webPort, strictPort: true, hmr: false } });
    await web.listen();
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: width === 390, hasTouch: width === 390,
    ...(values.clip ? { recordVideo: { dir: `${values.out}/raw-video`, size: { width, height } } } : {}) });
  if (values.offline) {
    offline = await createOfflineReview(context, '/index.html', values.out, { plugins: [plugin], allowedOrigins: [endpoint] });
    await context.route(`${offline.origin}/__walk-town/**`, route => {
      const path = new URL(route.request().url()).pathname;
      const body = path === '/__walk-town/scene' ? fixture.sceneBytes
        : path === '/__walk-town/fixture' ? JSON.stringify({ manifest: fixture.manifest }) : null;
      return route.fulfill({ status: body === null ? 404 : 200, contentType: 'application/json', body: body ?? 'null' });
    });
  }
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) report.errors.push(message.text()); });
  await page.goto(`${offline?.origin ?? `http://127.0.0.1:${webPort}`}/?walk=1&source=simulated&hour=19.5&time=30`, { waitUntil: 'domcontentloaded' });
  stage = 'waiting for Kingdom ready'; console.log(`SIMULATED town: ${stage}`);
  await page.waitForFunction(() => window.__chatdomReady === true && window.__chatdomKingdom?.stats.ready, null, { timeout: 240_000 });
  console.log('SIMULATED town: actual Kingdom rendered; connecting three SDK clients');
  stage = 'connecting three SDK clients';
  report.clients = await page.evaluate(async ({ endpoint }) => {
    const { connectRealm, compileFoundedScene } = window.__walkingTogetherDependencies;
    const scene = await (await fetch('/__walk-town/scene')).json(), fixture = await (await fetch('/__walk-town/fixture')).json();
    const collision = compileFoundedScene(scene), clients = [];
    for (let i = 0; i < 3; i++) clients.push(await connectRealm(endpoint, { kingdomId: fixture.manifest.kingdomId,
      resumeScope: window.crypto.randomUUID(), ticket: async () => (await fetch(`${endpoint}/reference/session`, { method: 'POST' })).json() }, collision));
    await window.__chatdomKingdom.attachWalk({ client: clients[0], collision, manifest: fixture.manifest, heading: 0 });
    const peers = clients.slice(1), initial = peers.map(client => ({ ...client.predicted }));
    const state = { clients, initial, moving: false, timer: 0 };
    const timer = window.setInterval(() => {
      for (const client of peers) client.tick(window.performance.now(), { moveX: 0, moveZ: state.moving ? 40 : 0, buttons: 0, yaw: 0, collisionRevision: collision.revision });
    }, 16);
    state.timer = timer; window.__walkingTogetherTown = state;
    const ribbon = document.querySelector('.source-ribbon'); if (ribbon) ribbon.append(document.createTextNode(' · FULL FOUNDED COLLISION'));
    return clients.map(client => ({ id: client.selfId, roomId: client.room.roomId, name: client.room.state.walkers.get(client.selfId).name }));
  }, { endpoint }).catch(error => { throw new Error(`Town binding failed: ${error.message}`); });
  assert.equal(new Set(report.clients.map(client => client.id)).size, 3);
  console.log('SIMULATED town: three distinct SDK clients attached');
  stage = 'waiting for walkers and settled lighting';
  await page.waitForFunction(() => window.__chatdomWalk?.ready === true && window.__chatdomWalk.walkers === 3, null, { timeout: 120_000 });
  await page.getByText(/SIMULATED/).first().waitFor({ state: 'visible' });
  await page.locator('.walker-name, .walk-person-label[data-walker][aria-hidden="false"]').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 180_000 });
  console.log('SIMULATED town: lighting settled; exercising actual keyboard and peer inputs');
  stage = 'exercising keyboard and peer inputs';
  const before = await page.evaluate(() => ({ ...window.__chatdomWalk.authority }));
  await page.evaluate(() => { window.__walkingTogetherTown.moving = true; });
  await page.keyboard.down('KeyW');
  try { await page.waitForFunction(before => {
    const state = window.__walkingTogetherTown;
    return Math.hypot(window.__chatdomWalk.authority.x - before.x, window.__chatdomWalk.authority.z - before.z) > .4
      && state.clients.slice(1).every((client, i) => client.predicted.distance - state.initial[i].distance > .2);
  }, before, { timeout: 20_000 }); }
  finally { await page.keyboard.up('KeyW'); await page.evaluate(() => { window.__walkingTogetherTown.moving = false; }); }
  await page.waitForFunction(() => window.__chatdomWalk.input.moveX === 0 && window.__chatdomWalk.input.moveZ === 0, null, { timeout: 10_000 });
  report.checks.push({ name: 'real keyboard moved the room citizen', before, after: await page.evaluate(() => ({ ...window.__chatdomWalk.authority })) });
  report.checks.push({ name: 'two other real SDK clients also walked', distances: await page.evaluate(() => window.__walkingTogetherTown.clients.slice(1).map((client, i) => client.predicted.distance - window.__walkingTogetherTown.initial[i].distance)) });
  if (values.clip) {
    // Recording includes the real render clock and network interpolation, never deterministic respeeding.
    const clipStart = Date.now();
    await page.evaluate(() => { window.__walkingTogetherTown.moving = true; });
    await page.keyboard.down('KeyW');
    try { await page.waitForTimeout(3000); } finally { await page.keyboard.up('KeyW'); }
    await offline?.close(); offline = undefined;
    await context.close();
    const raw = await page.video().path();
    await new Promise((resolve, reject) => { const child = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-3', '-i', raw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', `${output}.mp4`], { stdio: ['ignore', 'ignore', 'inherit'] });
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))); });
    report.checks.push({ name: 'real-time walking clip', elapsedMs: Date.now() - clipStart }); report.output = `${output}.mp4`;
  } else { await page.screenshot({ path: `${output}.png` }); report.output = `${output}.png`; }
  assert.deepEqual(report.errors, [], 'Browser reported errors');
  await writeFile(`${output}.json`, JSON.stringify(report, null, 2));
  complete = true;
  console.log(`Actual town capture: ${report.output}`);
} catch (error) {
  const pageState = await page?.evaluate(() => ({ ready: window.__chatdomReady, stats: window.__chatdomKingdom?.stats,
    text: document.body.innerText.slice(0, 4000) })).catch(() => undefined);
  await writeFile(`${output}.failure.json`, JSON.stringify({ ...report, stage, pageState, failure: error.message }, null, 2)).catch(() => {});
  complete = true; // The caught failure is recorded above; preserve it rather than overwriting it on exit.
  throw error;
} finally {
  // A failed close must not retain the shared lock or strand another owned service.
  try {
    try { await offline?.close(); } catch (error) { console.error('Offline town cleanup:', error); }
    const closures = await Promise.allSettled([
      browser?.close(), web?.close(), realm?.gracefullyShutdown(false), loader?.close(),
    ]);
    for (const result of closures) if (result.status === 'rejected') console.error('Town capture cleanup:', result.reason);
  } finally { await release(); }
}
