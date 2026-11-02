// PL10's stills: first and third person at one spot, sole close-ups before and after on a slope, a stair and a raised
// floor, a dusk street with bubbles over lit homes and only walkers in it, and the hamlet. The real kingdom page on a
// stills fixture (fixture.ts) with full production collision and a memory-only realm this script owns.
//
//   SwiftShader, under the shared capture lock, ONE still per lock hold (the shared capture guard stops anything that
//   holds the lock for 12 minutes, and opening the kingdom in software takes several): several names run one after
//   another, each in its own process that takes the lock, opens the page, shoots and releases it before the next.
//   The page is built once, before any lock is taken, and served as plain files: through the dev server a software
//   browser fetched hundreds of unbundled modules under the lock, and the crowd still never opened inside one hold.
//     node apps/web/src/walk/stills/stills.mjs [--land town|hamlet] [--only third,first] [--out shots/play/stills]
//   Real GPU, inside the lease (web on 5192, realm on 5191, each still a fresh load through `chatdom-pc shot`):
//     chatdom-pc-lease -- node apps/web/src/walk/stills/stills.mjs --target pc [--land town|hamlet]
//
// Test identities exist only in the memory room and are never Twitch claims. Dev only: never a route, never built.
import { chromium } from '@playwright/test';
import { build, createServer } from 'vite';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttp } from 'node:http';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer as createProbe } from 'node:net';
import { spawn } from 'node:child_process';
import { CAPTURE_PORTS } from '../../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const { values } = parseArgs({ options: {
  target: { type: 'string', default: 'swiftshader' }, land: { type: 'string', default: 'town' },
  only: { type: 'string' }, out: { type: 'string', default: 'shots/play/stills' }, size: { type: 'string', default: '1440x900' },
  // A page already built by a parent run (one still per lock hold shares one build).
  bundle: { type: 'string' },
} });
const [width, height] = values.size.split('x').map(Number);
const pc = values.target === 'pc';
if (!['town', 'hamlet'].includes(values.land)) throw new Error('--land is town or hamlet');
const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const ALL = values.land === 'hamlet' ? ['dusk', 'third'] : ['third', 'first', 'dusk', 'crowd', 'slope-before', 'slope-after', 'stairs-before', 'stairs-after', 'floor-before', 'floor-after'];
const names = values.only ? values.only.split(',') : ALL;

// The stills page (page.tsx in place of main.tsx), built with the web app's own config into a scratch folder.
async function buildPage() {
  const outDir = await mkdtemp(join(tmpdir(), 'chatdom-play-stills-'));
  const swap = { name: 'play-stills', enforce: 'pre',
    transform(_code, id) { if (id.split('?')[0] === `${repo}apps/web/src/main.tsx`) return { code: "import './walk/stills/page';", map: null }; } };
  console.log('Stills: building the page (before any lock)');
  await build({ root: `${repo}apps/web`, configFile: `${repo}apps/web/vite.config.ts`, plugins: [swap], logLevel: 'warn',
    build: { outDir, emptyOutDir: true, minify: false, sourcemap: false, reportCompressedSize: false, chunkSizeWarningLimit: 1e9 } });
  return outDir;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.opus': 'audio/ogg' };
// Plain files from the build, plus the fixture's scene and facts from memory. No proxies: the page talks only to this
// run's realm, so a request for another service fails at once instead of waiting on a port it does not own.
const servePage = (dir, extra) => createHttp((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://stills').pathname);
  response.setHeader('Cache-Control', 'no-store');
  if (path in extra) { response.setHeader('Content-Type', 'application/json'); response.end(extra[path]); return; }
  const file = normalize(join(dir, path === '/' ? 'index.html' : path));
  if (!file.startsWith(dir + sep)) { response.statusCode = 403; response.end(); return; }
  readFile(file).then(body => { response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream'); response.end(body); },
    () => { response.statusCode = 404; response.end(); });
});

const ownBundle = !values.bundle;
const bundle = values.bundle ?? await buildPage();
if (!pc && names.length > 1) {
  // One still per lock hold: run each in its own process and let the queue serve the other lanes in between.
  let failed = 0;
  for (const name of names) {
    const args = [fileURLToPath(import.meta.url), '--land', values.land, '--only', name, '--out', values.out, '--size', values.size, '--bundle', bundle];
    const code = await new Promise(resolve => spawn(process.execPath, args, { stdio: 'inherit' }).once('exit', resolve));
    if (code !== 0) failed++;
  }
  await rm(bundle, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
const report = { land: values.land, target: values.target, width, height, stills: [], errors: [] };
// Colyseus turns any uncaught exception into a quiet process.exit(0) in development, which loses the report and
// the reason; say both before it does.
process.prependListener('uncaughtException', error => {
  report.failure = `uncaught: ${error?.stack ?? error}`;
  console.error(`Stills: ${report.failure}`);
  try { writeFileSync(`${values.out}/${values.land}${pc ? '-gpu' : `-${names[0]}`}.json`, JSON.stringify(report, null, 2)); } catch { /* the out folder may not exist yet */ }
});
const stamp = name => `${values.out}/${values.land}-${name}${pc ? '-gpu' : ''}@${width}x${height}`;

// The realm's transport binds every address and fails silently when any of them holds the port (other lanes listen on
// 127.0.0.2 and up), so a port is free only if the wildcard addresses bind, not just 127.0.0.1.
const bindable = (port, host) => new Promise(resolve => { const probe = createProbe(); probe.once('error', () => resolve(false)); probe.listen({ port, host, exclusive: true }, () => probe.close(() => resolve(true))); });
const free = async port => await bindable(port, '0.0.0.0') && await bindable(port, '::');
async function ports() {
  if (pc) return [5191, 5192]; // the lease checked both are free and forwards them to the GPU machine
  // Two lane captures run beside main's, and other harnesses take the first free ports, so this one draws at random.
  const found = [], order = [...CAPTURE_PORTS].sort(() => Math.random() - .5);
  for (const port of order) { if (await free(port)) found.push(port); if (found.length === 2) return found; }
  throw new Error('No free capture ports');
}
// uWS listens beside another uWS on the same port without an error and the kernel then shares connections between
// them, so the realm proves the port answers only to this run before anything uses it.
const nonce = globalThis.crypto.randomUUID();
async function ownRealm(origin) {
  for (let i = 0; i < 6; i++) {
    const answer = await globalThis.fetch(`${origin}/stills/nonce`).then(response => response.text(), () => 'unreachable');
    if (answer !== nonce) throw new Error(`The realm port ${origin} answers for another server (${answer.slice(0, 80)}); run again`);
  }
}

let loader, web, realm, browser, release, crowd;
try {
  await mkdir(values.out, { recursive: true });
  console.log(`Stills: building the ${values.land} and its collision`);
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false } });
  const [{ createRealmServer }, { referenceServices }, { createStillsFixture }, { connectRealm }] = await Promise.all([
    loader.ssrLoadModule('/apps/realm/src/server.ts'), loader.ssrLoadModule('/apps/realm/src/reference.ts'), loader.ssrLoadModule('/apps/web/src/walk/stills/fixture.ts'),
    loader.ssrLoadModule('/apps/web/src/realm/client.ts')]);
  const fixture = createStillsFixture(values.land);
  report.fixture = { homes: fixture.homes, placements: fixture.scene.placements.length, spots: fixture.spots, speakers: fixture.speakers, crowdSpots: fixture.crowd.length };
  console.log(`Stills: ${fixture.homes} homes; spots ${Object.entries(fixture.spots).map(([k, v]) => `${k}${v ? '' : ' (none)'}`).join(', ')}`);
  const info = JSON.stringify({ land: fixture.land, manifest: fixture.manifest, spots: fixture.spots, beside: fixture.beside, speakers: fixture.speakers, crowd: fixture.crowd.length });

  if (!pc) release = await acquireCaptureLock();
  const [realmPort, webPort] = await ports(), endpoint = pc ? `http://localhost:${realmPort}` : `http://127.0.0.1:${realmPort}`;
  const base = referenceServices();
  let effects;
  const names3 = ['Rowan', 'Wren', 'Juniper'];
  // The crowd still's walkers, after the first three: test names in the memory room only, the six starter looks.
  const CROWD_NAMES = ['Alder', 'Briar', 'Cedar', 'Dove', 'Elm', 'Fern', 'Gale', 'Heath', 'Ivy', 'Jay', 'Kestrel', 'Larch', 'Marigold',
    'Nettle', 'Oriel', 'Pip', 'Quill', 'Reed', 'Sorrel', 'Thistle', 'Umber', 'Vale', 'Willow', 'Yarrow'];
  const LOOKS = ['hearth', 'tide', 'grove', 'clay', 'sun', 'dusk'];
  // Names follow who asked for the ticket: the page's walkers are Rowan, Wren and Juniper, the runner's crowd the rest.
  const crowdTickets = new Map(), named = new Map();
  let pageWalkers = 0;
  const created = createRealmServer({ auth: { ...base.auth, authenticate: async join => {
    const principal = await base.auth.authenticate(join), crowdIndex = crowdTickets.get(join.ticket);
    if (!named.has(principal.personId)) named.set(principal.personId, crowdIndex === undefined
      ? { publicName: names3[pageWalkers % 3], look: ['tide', 'grove', 'clay'][pageWalkers++ % 3] }
      : { publicName: `${CROWD_NAMES[crowdIndex % CROWD_NAMES.length]} ${Math.floor(crowdIndex / CROWD_NAMES.length) + 1}`, look: LOOKS[crowdIndex % LOOKS.length] });
    return { ...principal, ...named.get(principal.personId) };
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
  // The crowd still: its walkers join from here (not the page, which only draws them), each stood on its own open
  // spot. They start joining as soon as the realm listens, while the page is still opening the kingdom (in software
  // that takes minutes), so the still does not pay for 120 joins in a row under the capture lock.
  crowd = [];
  const CROWD = 120;
  // Eight at a time: one after another, 120 joins on a loaded host outlast a real-GPU shot's four minutes.
  const CROWD_JOINS_AT_ONCE = 8;
  const joinCrowd = async count => {
    const issue = i => { const join = base.issue(); crowdTickets.set(join.ticket, i); return join; };
    const total = Math.min(count, fixture.crowd.length);
    let next = crowd.length;
    const joinOne = async i => {
      let client;
      for (let attempt = 1; !client; attempt++) {
        try {
          client = await connectRealm(`http://127.0.0.1:${realmPort}`, { kingdomId: fixture.manifest.kingdomId, ticket: async () => issue(i),
            resumeScope: `stills-crowd-${i}-${globalThis.crypto.randomUUID()}` }, fixture.world);
        } catch (error) {
          if (attempt >= 3) throw error;
          await new Promise(resolve => globalThis.setTimeout(resolve, 2_000));
        }
      }
      crowd.push(client);
      if (!effects?.placeWalker(client.selfId, fixture.crowd[i], fixture.world.revision)) throw new Error(`The realm would not place crowd walker ${i}`);
      if (crowd.length % 30 === 0) console.log(`Stills: ${crowd.length} crowd walkers in the street`);
    };
    await Promise.all(Array.from({ length: CROWD_JOINS_AT_ONCE }, async () => { while (next < total) await joinOne(next++); }));
    return crowd.length;
  };
  let crowdJoin = null;
  globalThis.setInterval(() => { for (const client of crowd) client.tick(globalThis.performance.now(), { moveX: 0, moveZ: 0, buttons: 0, yaw: 0, collisionRevision: fixture.world.revision }); }, 50).unref();
  created.transport.app.get('/stills/crowd', (response, request) => {
    const count = Math.max(0, Math.min(fixture.crowd.length, Number(new globalThis.URLSearchParams(request.getQuery() ?? '').get('n')) || 0));
    let aborted = false;
    response.onAborted(() => { aborted = true; });
    crowdJoin ??= joinCrowd(Math.max(count, CROWD));
    crowdJoin.then(joined => { if (!aborted) response.cork(() => cors(response).writeHeader('Content-Type', 'application/json').end(JSON.stringify({ joined }))); },
      error => { console.error(error); if (!aborted) response.cork(() => cors(response).writeStatus('409 Conflict').end(String(error?.message ?? error))); });
  });
  created.transport.app.get('/stills/nonce', response => cors(response).end(nonce));
  await realm.listen(realmPort, '127.0.0.1');
  await ownRealm(`http://127.0.0.1:${realmPort}`);
  if (names.includes('crowd')) {
    crowdJoin = joinCrowd(CROWD);
    crowdJoin.catch(error => console.error(`Stills: the crowd did not join: ${error?.message ?? error}`));
  }
  web = servePage(bundle, { '/__stills/scene': fixture.sceneBytes, '/__stills/fixture': info });
  await new Promise((resolve, reject) => { web.once('error', reject); web.listen(webPort, '127.0.0.1', resolve); });
  await ownRealm(`http://127.0.0.1:${realmPort}`);
  const url = name => `http://${pc ? 'localhost' : '127.0.0.1'}:${webPort}/?source=simulated&hour=19.5&still=${name}&realm=${encodeURIComponent(endpoint)}`;

  if (pc) {
    for (const name of names) {
      const out = `${stamp(name)}.png`;
      const code = await new Promise(resolve => spawn('chatdom-pc', ['shot', url(name), out, '--size', `${width}x${height}`, '--timeout', name === 'crowd' ? '360' : '240', '--settle', '2'], { stdio: 'inherit' }).once('exit', resolve));
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
      await page.waitForFunction(() => window.__chatdomReady === true || !!window.__chatdomStills?.error, null, { timeout: 420_000 }).catch(async error => {
        const progress = await page.evaluate(() => window.__chatdomStillsProgress ?? 'the page script had not started').catch(() => 'unreadable');
        throw new Error(`${error.message} (the page was at: ${progress}; crowd joined ${crowd.length})`);
      });
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
  web?.closeAllConnections?.();
  await new Promise(resolve => (web?.listening ? web.close(resolve) : resolve()));
  if (ownBundle) await rm(bundle, { recursive: true, force: true }).catch(() => {});
  await crowd?.reduce((all, client) => all.then(() => client.dispose?.()), Promise.resolve()).catch(() => {});
  await realm?.gracefullyShutdown(false).catch(() => {});
  await loader?.close().catch(() => {});
  await release?.();
}
process.exit(process.exitCode ?? 0);
