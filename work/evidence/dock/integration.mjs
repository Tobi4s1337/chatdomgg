// SIMULATED real-service bench. This is a scaffold, not visual evidence.
// Run only through integration-capture.mjs, which holds the shared capture lock.
import { randomBytes } from 'node:crypto';
import { createServer as createHttp, request as httpRequest } from 'node:http';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer as createVite, runnerImport } from 'vite';
import { chromium } from '@playwright/test';
import pg from 'pg';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const port = 5171, origin = `http://127.0.0.1:${port}`;
const kingdom = '990100001'; // Wren in the simulated OpenID provider, also the broadcaster.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw Error('DATABASE_URL is required for the isolated simulated schema.');
const schema = process.env.CHATDOM_DOCK_CAPTURE_SCHEMA;
const foundedDirectory = process.env.CHATDOM_DOCK_CAPTURE_DIR;
if (!/^dock_capture_[0-9a-f]{16}$/.test(schema ?? '') || !foundedDirectory?.startsWith('/tmp/chatdom-dock-capture-')) throw Error('The supervisor must provide owned capture resources.');
const internalSecret = randomBytes(32).toString('hex'), heraldSecret = randomBytes(32).toString('hex'), evidenceKey = randomBytes(32);
const realmSocket = join(foundedDirectory, 'realm.sock');
const loaders = [];
const load = async path => {
  const result = await runnerImport(join(root, path), { root, configFile: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false, ws: false } });
  loaders.push(result.runner); return result.module;
};
let realmPool, apiPool, boot, dock, evening, realmServer, webVite, front, browser;
let listeningRealm = false;
try {
  // No listener or browser is opened before the caller has acquired the capture lock.
  console.log('SIMULATED bench: load workspace services');
  const [persistence, allocation, bootstrap, wiring, eveningModule, citizensModule, castleModule, interactions,
    dockModule, world, authServiceModule, authHttpModule, oidcModule, dockApi] = await Promise.all([
    load('apps/realm/src/persistence/index.ts'), load('apps/realm/src/allocation/index.ts'), load('apps/realm/src/bootstrap/index.ts'),
    load('apps/realm/src/wiring/index.ts'), load('apps/realm/src/evening/index.ts'), load('apps/realm/src/evening/citizens.ts'),
    load('apps/realm/src/evening/castle.ts'), load('apps/realm/src/evening/interactions.ts'), load('apps/realm/src/dock/index.ts'),
    load('packages/world/src/index.ts'), load('apps/api/src/realm-auth/service.ts'), load('apps/api/src/realm-auth/http.ts'),
    load('apps/api/src/realm-auth/simulated-provider.ts'), load('apps/api/src/dock/index.ts'),
  ]);
  console.log('SIMULATED bench: migrate isolated realm schema');
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
  console.log('SIMULATED bench: adopt and prepare town');
  const plan = world.generateSettlementPlan({ seed: 'dock-simulated', tier: 'town', firstYear: 2019, year: 2026 });
  const adoption = await boot.allocation.adoptLayout(kingdom, plan);
  if (adoption.status === 'rejected') throw Error('Simulated layout adoption was rejected.');
  await boot.readiness.start();

  // The installed uWS transport ignores numeric listen hostnames, but supports an owned Unix socket.
  // This avoids both SO_REUSEPORT and any listener on another service's TCP port.
  console.log('SIMULATED bench: start owned realm socket');
  await realmServer.listen(realmSocket); listeningRealm = true;
  if (!(await stat(realmSocket)).isSocket()) throw Error('The owned realm socket did not open.');

  process.env.DOCK_REALM_URL = origin;
  const config = { mode: 'simulated', databaseUrl, schema, publicOrigin: origin, redirectUri: `${origin}/api/realm/auth/callback`, secureCookies: false, host: '127.0.0.1', port, twitch: null, internalSecret };
  console.log('SIMULATED bench: prepare sign-in and web');
  const simulated = await oidcModule.createSimulatedOidcProvider({ publicOrigin: origin, internalOrigin: origin, redirectUri: config.redirectUri });
  const apiRequire = createRequire(join(root, 'apps/api/package.json'));
  const { createRemoteJWKSet } = await import(pathToFileURL(apiRequire.resolve('jose')).href);
  const auth = authServiceModule.createRealmAuthService({ pool: apiPool, provider: simulated.provider, redirectUri: config.redirectUri,
    keys: createRemoteJWKSet(new URL(simulated.provider.jwksUri), { timeoutDuration: 5000 }) });
  await auth.ready();
  const authRoutes = authHttpModule.createRealmAuthHttp({ service: auth, publicOrigin: origin, secureCookies: false, internalSecret, extra: simulated.handle });
  webVite = await createVite({ root: join(root, 'apps/web'), configFile: join(root, 'apps/web/vite.config.ts'), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'spa', logLevel: 'error' });
  front = createHttp((req, res) => { void (async () => {
    const path = new URL(req.url ?? '/', origin).pathname;
    if (path === '/__dock-evidence') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(`<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;background:#19120e;color:#fff;font:14px sans-serif}header{height:32px;padding:8px;background:#7d2921}main{display:flex;gap:12px;align-items:start}iframe{border:0}#stream{width:1280px;height:720px}#dock{width:318px;height:1048px}</style></head><body><header>SIMULATED · isolated realm, simulated sign-in and real stream view</header><main><iframe id="stream" title="Stream" src="/stream?source=realm&amp;kingdom=${kingdom}"></iframe><iframe id="dock" title="Dock" src="/dock/?kingdom=${kingdom}"></iframe></main></body></html>`); return;
    }
    const privateRealm = path.startsWith('/internal/dock/');
    if (privateRealm && req.headers.authorization !== `Bearer ${internalSecret}`) { res.writeHead(403).end(); return; }
    if (privateRealm || /^\/api\/realm\/(?:entry|founded|watch)(?:\/|$)/.test(path)) {
      const upstream = httpRequest({ socketPath: realmSocket, path: req.url, method: req.method, headers: { ...req.headers, host: 'realm.local' } }, response => {
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
    webVite.middlewares(req, res, () => res.writeHead(404).end());
  })().catch(() => { if (!res.headersSent) res.writeHead(503).end(); else res.destroy(); }); });
  console.log('SIMULATED bench: start exclusive loopback front door');
  await new Promise((resolve, reject) => { front.once('error', reject); front.listen({ host: '127.0.0.1', port, exclusive: true }, resolve); });
  console.log('SIMULATED isolated real-service bench ready on 127.0.0.1:5171; no Twitch accounts or live kingdom.');
  console.log('SIMULATED bench: sign in and open stream and dock');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  if (!process.send) throw Error('The capture supervisor is required to track the browser.');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Browser tracking did not complete.')), 5000);
    process.on('message', function tracked(message) { if (message === 'browser-tracked' || message === 'browser-untracked') { clearTimeout(timer); process.off('message', tracked); if (message === 'browser-tracked') resolve(); else reject(Error('Browser group could not be tracked.')); } });
    process.send('browser-started');
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
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
  if (errors.length) throw Error('A page raised an exception during the rehearsal.');
  await page.screenshot({ path: join(root, 'work/evidence/dock/isolated-stream-dock-SIMULATED.png'), timeout: 150000 });
  console.log('Captured one SIMULATED real-service stream and dock still; no action delivery is asserted.');
} finally {
  console.log('SIMULATED bench: close owned browser and services');
  let cleanupFailed = false;
  const clean = async fn => { try { await fn(); } catch { cleanupFailed = true; } };
  await clean(async () => { if (browser) { await browser.close(); if (process.send) await new Promise((resolve, reject) => process.send('browser-closed', error => error ? reject(error) : resolve())); } });
  await clean(() => { if (!front?.listening) return; front.closeAllConnections(); return new Promise(resolve => front.close(resolve)); });
  await clean(() => webVite?.close());
  await clean(() => dock?.stop()); await clean(() => evening?.stop());
  if (listeningRealm) await clean(() => realmServer?.gracefullyShutdown(false));
  await clean(() => boot?.stop()); await clean(() => apiPool?.end()); await clean(() => realmPool?.end());
  await clean(() => Promise.all(loaders.map(runner => runner?.close?.())));
  if (cleanupFailed) { process.exitCode = 1; console.error(`SIMULATED bench cleanup was incomplete; owned schema ${schema} and directory ${foundedDirectory}.`); }
  if (process.connected) process.disconnect();
}
