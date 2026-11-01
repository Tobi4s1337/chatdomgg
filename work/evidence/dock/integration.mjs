// SIMULATED real-service bench. This is a scaffold, not visual evidence.
// Run only through integration-capture.mjs, which holds the shared capture lock.
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer as createHttp, request as httpRequest } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build as viteBuild } from 'vite';
import { chromium } from '@playwright/test';
import pg from 'pg';
import { loadServices } from './service-loader.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const port = 5171, origin = `http://[::1]:${port}`;
const kingdom = '990100001'; // Wren in the simulated OpenID provider, also the broadcaster.
const [scenario = 'initial', format = 'still'] = process.argv.slice(2);
if (!['initial', 'open', 'close', 'fire', 'raid', 'crown', 'knight', 'moment', 'undo'].includes(scenario) || !['still', 'clip'].includes(format)) throw Error('Invalid capture scenario.');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw Error('DATABASE_URL is required for the isolated simulated schema.');
const schema = process.env.CHATDOM_DOCK_CAPTURE_SCHEMA;
const foundedDirectory = process.env.CHATDOM_DOCK_CAPTURE_DIR;
if (!/^dock_capture_[0-9a-f]{16}$/.test(schema ?? '') || !foundedDirectory?.startsWith('/tmp/chatdom-dock-capture-')) throw Error('The supervisor must provide owned capture resources.');
const internalSecret = randomBytes(32).toString('hex'), heraldSecret = randomBytes(32).toString('hex'), evidenceKey = randomBytes(32);
const realmSocket = join(foundedDirectory, 'realm.sock');
let realmPool, apiPool, boot, dock, evening, realmServer, front, browser;
let listeningRealm = false, stage = 'load workspace services';
let presenterConnected = false;
try {
  // No listener or browser is opened before the caller has acquired the capture lock.
  console.log('SIMULATED bench: load workspace services');
  const loaded = await loadServices(root, foundedDirectory);
  const { persistence, allocation, bootstrap, wiring, evening: eveningModule, citizens: citizensModule, castle: castleModule,
    interactions, dock: dockModule, world, authService: authServiceModule, authHttp: authHttpModule, simulatedOidc: oidcModule, dockApi } = loaded;
  stage = 'migrate isolated realm schema'; console.log(`SIMULATED bench: ${stage}`);
  realmPool = persistence.createRealmPool({ connectionString: databaseUrl, schema });
  await persistence.migrateRealmSchema(realmPool, schema);
  apiPool = new pg.Pool({ connectionString: databaseUrl, max: 8, options: `-c search_path=${schema}`, application_name: 'chatdom-dock-capture-api' });
  const names = new Map([[kingdom, 'SIMULATED Willowmere']]);
  const verifier = new allocation.TenureEvidenceVerifier('simulated', evidenceKey);
  const gate = new wiring.ForgeWriteGate(), approvals = new wiring.FileForgeApprovals(join(foundedDirectory, 'forge-approvals'));
  const castle = castleModule.createRealmCastle({ origin: 'simulated', kingdomNames: names, safetyKey: evidenceKey });
  const citizens = citizensModule.createRealmCitizens({ db: realmPool, origin: 'simulated', kingdomNames: names, castle: castle.observe });
  boot = bootstrap.createDurableRealmBoot({ pool: realmPool, origin: 'simulated', verifier, foundedDirectory, ingressCredentials: { herald: heraldSecret },
    foundedAccess: target => target.origin === 'simulated', log: () => {},
    repositoryOptions: gate.install({ origin: 'simulated', guards: [castle.guard] }), furnish: citizens.furnish,
    attach: held => { const a = evening.attach(held), b = interactions.attachEveningInteractions(held, { auth: boot.services.auth, scene: () => boot.loader.current(held.kingdomId)?.scene }); return () => { b(); a(); }; },
  });
  citizens.use(boot.allocation, boot.services); castle.use(boot.allocation, boot.store);
  evening = new eveningModule.RealmEveningBridge({ origin: 'simulated', ingress: boot.ingress, gate, approvals, beforeObservation: input => citizens.observe(input) });
  evening.use(boot.services);
  dock = new dockModule.RealmDockService(realmPool, 'simulated', internalSecret, 1800, names); dock.use(boot.services);
  const realm = boot.createServer({ mountIngress: app => { eveningModule.mountEveningRoutes(app, evening); dockModule.mountRealmDockRoutes(app, dock); } });
  realmServer = realm.server;
  bootstrap.mountEntryRoutes(realm.transport.app, boot.founded, 'simulated', names);
  bootstrap.mountRealmWatchRoutes(realm.transport.app, boot);
  stage = 'adopt and prepare town'; console.log(`SIMULATED bench: ${stage}`);
  const plan = world.generateSettlementPlan({ seed: 'dock-simulated', tier: 'town', firstYear: 2019, year: 2026 });
  const adoption = await boot.allocation.adoptLayout(kingdom, plan);
  if (adoption.status === 'rejected') throw Error('Simulated layout adoption was rejected.');
  await boot.readiness.start();

  // The installed uWS transport ignores numeric listen hostnames, but supports an owned Unix socket.
  // This avoids both SO_REUSEPORT and any listener on another service's TCP port.
  stage = 'start owned realm socket'; console.log(`SIMULATED bench: ${stage}`);
  await realmServer.listen(realmSocket); listeningRealm = true;
  if (!(await stat(realmSocket)).isSocket()) throw Error('The owned realm socket did not open.');
  const sendObservation = async envelope => {
    const reply = await evening.observation(`Bearer ${heraldSecret}`, envelope);
    if (reply.http !== 202) throw Error('SIMULATED ingress did not accept the observation.');
  };
  const stamp = async () => Number((await realmPool.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now')).rows[0].now) - 200;
  const firstAt = await stamp();
  await sendObservation({ version: 1, observation: { version: 1, kind: 'stream', origin: 'simulated', id: 'dock-simulated-stream', kingdomId: kingdom, observedAt: firstAt, live: true, sessionId: 'dock-simulated-night' } });
  const monarchAt = await stamp();
  await sendObservation({ version: 1, observation: { version: 1, kind: 'observe', origin: 'simulated', id: 'dock-simulated-monarch-chat', kingdomId: kingdom, observedAt: monarchAt,
    source: 'chat', coverage: 'activity', people: [{ personId: kingdom, disclosure: 'named', displayName: 'SIMULATED Wren' }] } });
  const chatAt = await stamp();
  await sendObservation({ version: 1, observation: { version: 1, kind: 'observe', origin: 'simulated', id: 'dock-simulated-chat', kingdomId: kingdom, observedAt: chatAt,
    source: 'chat', coverage: 'activity', people: [{ personId: '990100002', disclosure: 'named', displayName: 'SIMULATED Robin' }] } });

  process.env.DOCK_REALM_URL = origin;
  const config = { mode: 'simulated', databaseUrl, schema, publicOrigin: origin, redirectUri: `${origin}/api/realm/auth/callback`, secureCookies: false, host: '::1', port, twitch: null, internalSecret };
  stage = 'prepare sign-in and web'; console.log(`SIMULATED bench: ${stage}`);
  const simulated = await oidcModule.createSimulatedOidcProvider({ publicOrigin: origin, internalOrigin: origin, redirectUri: config.redirectUri });
  const apiRequire = createRequire(join(root, 'apps/api/package.json'));
  const { createRemoteJWKSet } = await import(pathToFileURL(apiRequire.resolve('jose')).href);
  const auth = authServiceModule.createRealmAuthService({ pool: apiPool, provider: simulated.provider, redirectUri: config.redirectUri,
    keys: createRemoteJWKSet(new URL(simulated.provider.jwksUri), { timeoutDuration: 5000 }) });
  await auth.ready();
  const authRoutes = authHttpModule.createRealmAuthHttp({ service: auth, publicOrigin: origin, secureCookies: false, internalSecret, extra: simulated.handle });
  const siteDirectory = join(foundedDirectory, 'web-build');
  await viteBuild({ root: join(root, 'apps/web'), configFile: join(root, 'apps/web/vite.config.ts'), build: { outDir: siteDirectory, emptyOutDir: true }, logLevel: 'error' });
  front = createHttp((req, res) => { void (async () => {
    const path = new URL(req.url ?? '/', origin).pathname;
    if (path === '/__dock-evidence') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(`<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;background:#19120e;color:#fff;font:14px sans-serif}header{height:32px;padding:8px;background:#7d2921}main{display:flex;gap:12px;align-items:start}iframe{border:0}#stream{width:1280px;height:720px}#dock{width:318px;height:1048px}</style></head><body><header>SIMULATED · isolated realm, simulated sign-in and real stream view</header><main><iframe id="stream" title="Stream" src="/stream?source=realm&amp;kingdom=${kingdom}"></iframe><iframe id="dock" title="Dock" src="/dock/?kingdom=${kingdom}"></iframe></main></body></html>`); return;
    }
    const privateRealm = path.startsWith('/internal/dock/');
    if (privateRealm && req.headers.authorization !== `Bearer ${internalSecret}`) { res.writeHead(403).end(); return; }
    if (privateRealm || /^\/api\/realm\/(?:entry|founded|watch)(?:\/|$)/.test(path)) {
      const upstream = httpRequest({ socketPath: realmSocket, path: req.url, method: req.method, headers: { ...req.headers, host: 'realm.local' } }, response => {
        if (privateRealm && path.startsWith('/internal/dock/presentations/') && req.method === 'POST' && response.statusCode === 200) presenterConnected = true;
        res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
        res.once('close', () => { response.destroy(); upstream.destroy(); });
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(503).end(); else res.destroy(); }); req.pipe(upstream); return;
    }
    if (path.startsWith('/api/')) {
      if (await dockApi.handleDock(req, res, { pool: apiPool, config })) return;
      if (await authRoutes(req, res)) return;
      res.writeHead(404).end(); return;
    }
    // Never let the stock dev proxy contact unrelated host services.
    if (/^\/(?:live-realm-data|realm-data|forge-data|map-data|presence-data)(?:\/|$)/.test(path)) { res.writeHead(404).end(); return; }
    const relative = ['/dock', '/dock/', '/stream', '/'].includes(path) ? 'index.html' : decodeURIComponent(path.slice(1));
    const file = resolve(siteDirectory, relative);
    if (!relative || !file.startsWith(`${siteDirectory}${sep}`)) { res.writeHead(404).end(); return; }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.json': 'application/json' };
    try { const data = await readFile(file); res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(data); }
    catch { res.writeHead(404).end(); }
  })().catch(() => { if (!res.headersSent) res.writeHead(503).end(); else res.destroy(); }); });
  stage = 'start exclusive loopback front door'; console.log(`SIMULATED bench: ${stage}`);
  await new Promise((resolve, reject) => { front.once('error', reject); front.listen({ host: '::1', port, ipv6Only: true, exclusive: true }, resolve); });
  console.log('SIMULATED isolated real-service bench ready on [::1]:5171; no Twitch accounts or live kingdom.');
  stage = 'sign in and open stream and dock'; console.log(`SIMULATED bench: ${stage}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  if (!process.send) throw Error('The capture supervisor is required to track the browser.');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Browser tracking did not complete.')), 5000);
    process.on('message', function tracked(message) { if (message === 'browser-tracked' || message === 'browser-untracked') { clearTimeout(timer); process.off('message', tracked); if (message === 'browser-tracked') resolve(); else reject(Error('Browser group could not be tracked.')); } });
    process.send('browser-started');
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ...(format === 'clip' ? { recordVideo: { dir: foundedDirectory, size: { width: 1920, height: 1080 } } } : {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${origin}/dock/?kingdom=${kingdom}`);
  await page.getByRole('link', { name: /Sign in with Twitch/ }).click();
  await page.getByRole('button', { name: /Wren/ }).click();
  await page.waitForURL(/\/dock/);
  await page.goto(`${origin}/__dock-evidence`);
  const streamFrame = page.frameLocator('#stream'), dockFrame = page.frameLocator('#dock');
  await dockFrame.getByText('SIMULATED', { exact: true }).first().waitFor({ timeout: 120000 });
  const frame = page.frames().find(value => value.url().includes('/stream?'));
  const dockDocument = page.frames().find(value => value.url().includes('/dock/'));
  if (!frame) throw Error('The real stream frame was not mounted.');
  if (!dockDocument) throw Error('The dock frame was not mounted.');
  await frame.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 180000 });
  await dockDocument.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 120000 });
  await dockFrame.getByRole('button', { name: /(?:Open|Close) the gate/ }).waitFor({ timeout: 30000 });
  if (!await streamFrame.locator('[data-chatdom-stream]').count()) throw Error('The real stream did not mount.');
  const presenterDeadline = Date.now() + 30000;
  while (!presenterConnected && Date.now() < presenterDeadline) await page.waitForTimeout(200);
  if (!presenterConnected) throw Error('The signed-in stream did not open a broadcaster presenter.');
  if (scenario === 'crown' || scenario === 'knight') {
    const at = await stamp();
    await sendObservation({ version: 1, observation: { version: 1, kind: 'observe', origin: 'simulated', id: 'dock-simulated-chat-refresh', kingdomId: kingdom, observedAt: at,
      source: 'chat', coverage: 'activity', people: [{ personId: '990100002', disclosure: 'named', displayName: 'SIMULATED Robin' }] } });
  }
  if (scenario === 'raid') {
    const at = await stamp();
    await sendObservation({ version: 1, moment: { version: 1, id: 'dock-simulated-raid', kingdomId: kingdom, origin: 'simulated', occurredAt: at, receivedAt: at,
      notice: { kind: 'raid', from: { kingdomId: '990100003', login: 'simulated_hollowbrook', name: 'SIMULATED Hollowbrook' }, viewers: 12 } } });
  }
  const titles = { close: /Close the gate/, open: /Open the gate/, fire: /Light the fire/, raid: /Welcome SIMULATED Hollowbrook/,
    crown: /Crown SIMULATED Robin/, knight: /Knight SIMULATED Robin/, moment: /Play Gather beneath the dusk sky/, undo: /Undo / };
  const proof = [];
  const press = async title => {
    const button = dockFrame.getByRole('button', { name: title }).first(); await button.waitFor({ timeout: 30000 });
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/dock/actions') && response.request().method() === 'POST', { timeout: 30000 });
    await button.click();
    const response = await responsePromise, result = await response.json(), request = response.request().postDataJSON();
    if (result.status !== 'accepted' || result.witness?.origin !== 'simulated' || !result.witness?.streamEventId
      || result.witness.actionId !== request.id || result.witness.kingdomId !== kingdom) throw Error('The realm did not confirm this witnessed simulated draw; no success is claimed.');
    proof.push({ kind: request.kind, actionId: request.id, receipt: result.receipt, witness: result.witness });
    console.log('SIMULATED dock action acknowledged by the real signed-in stream.');
  };
  if (scenario === 'open' || scenario === 'undo') { await press(titles.close); await page.waitForTimeout(2500); }
  if (scenario !== 'initial') { await press(titles[scenario]); await page.waitForTimeout(format === 'clip' ? 4000 : 500); }
  if (errors.length) throw Error('A page raised an exception during the rehearsal.');
  if (format === 'still') await page.screenshot({ path: join(root, `work/evidence/dock/isolated-${scenario}-SIMULATED.png`), timeout: 150000 });
  else {
    const video = page.video(); await page.close(); await context.close();
    // Keep the last eight real-time seconds, including the press and aftermath; no synthetic time or frames.
    await promisify(execFile)('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-8', '-i', await video.path(), '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2M', '-an', join(root, `work/evidence/dock/isolated-${scenario}-SIMULATED.webm`)], { timeout: 120000 });
  }
  await writeFile(join(root, `work/evidence/dock/isolated-${scenario}-SIMULATED.json`), JSON.stringify({ origin: 'simulated', scenario, format, witness: proof }, null, 2));
  console.log(`Captured one SIMULATED real-service ${scenario} ${format}${scenario === 'initial' ? '; no action delivery is asserted' : ''}.`);
} catch (error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,48}$/.test(error.code) ? ` code=${error.code}` : '';
  const missing = typeof error?.message === 'string' ? /Cannot find (?:package|module) ['"]([@a-zA-Z0-9_./-]+)['"]/.exec(error.message)?.[1] : undefined;
  console.log(`SIMULATED bench failed at ${stage}${code}${missing ? ` missing=${missing}` : ''}.`);
  process.exitCode = 1;
} finally {
  console.log('SIMULATED bench: close owned browser and services');
  let cleanupFailed = false;
  const clean = async fn => { try { await fn(); } catch { cleanupFailed = true; } };
  await clean(async () => { if (browser) { await browser.close(); if (process.send) await new Promise((resolve, reject) => process.send('browser-closed', error => error ? reject(error) : resolve())); } });
  await clean(() => { if (!front?.listening) return; front.closeAllConnections(); return new Promise(resolve => front.close(resolve)); });
  await clean(() => dock?.stop()); await clean(() => evening?.stop());
  if (listeningRealm) await clean(() => realmServer?.gracefullyShutdown(false));
  await clean(() => boot?.stop()); await clean(() => apiPool?.end()); await clean(() => realmPool?.end());
  if (cleanupFailed) { process.exitCode = 1; console.log(`SIMULATED bench cleanup was incomplete; owned schema ${schema} and directory ${foundedDirectory}.`); }
  if (process.connected) process.disconnect();
}
