// SIMULATED real-service bench. This is a scaffold, not visual evidence.
// Run only through integration-capture.mjs, which holds the shared capture lock.
import { createHash, randomBytes } from 'node:crypto';
import { clearInterval, clearTimeout, setInterval } from 'node:timers';
import { createServer as createHttp, request as httpRequest } from 'node:http';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import pg from 'pg';
import { loadServices } from './service-loader.mjs';

const evidenceRoot = fileURLToPath(new URL('./', import.meta.url));
const root = process.env.CHATDOM_DOCK_SOURCE_SNAPSHOT ?? '/tmp/chatdom-landing-build.Lq5Pzp';
const sourceCommit = process.env.CHATDOM_DOCK_SOURCE_COMMIT ?? (root === '/tmp/chatdom-landing-build.Lq5Pzp' ? 'f9c4f5c' : '');
if (!/^[a-f0-9]{7,40}$/.test(sourceCommit)) throw Error('The source snapshot commit must be explicit.');
if (!/^\/tmp\/chatdom-(?:round-final|landing)-build\.[A-Za-z0-9]+$/.test(root)) throw Error('A root-owned final build snapshot is required.');
const port = 5171, origin = `http://[::1]:${port}`;
const kingdom = '990100001'; // Wren in the simulated OpenID provider, also the broadcaster.
const scenario = 'close', format = 'still';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw Error('DATABASE_URL is required for the isolated simulated schema.');
const schema = process.env.CHATDOM_DOCK_CAPTURE_SCHEMA;
const foundedDirectory = process.env.CHATDOM_DOCK_CAPTURE_DIR;
if (!/^dock_round_[0-9a-f]{16}$/.test(schema ?? '') || !foundedDirectory?.startsWith('/tmp/chatdom-dock-round-')) throw Error('The supervisor must provide owned capture resources.');
const internalSecret = randomBytes(32).toString('hex'), heraldSecret = randomBytes(32).toString('hex'), evidenceKey = randomBytes(32);
const realmSocket = join(foundedDirectory, 'realm.sock');
let realmPool, apiPool, boot, dock, evening, realmServer, front, browser, sourceHeartbeat;
let sourceRefresh = Promise.resolve(), sourceRefreshFailures = 0;
let listeningRealm = false, stage = 'load workspace services';
let presenterConnected = false;
try {
  // Backend resources are isolated; Chrome opens only after the supervisor acquires the capture lock.
  console.log('SIMULATED bench: load workspace services');
  const loaded = await loadServices(root, foundedDirectory);
  const { persistence, allocation, bootstrap, wiring, evening: eveningModule, citizens: citizensModule, castle: castleModule,
    interactions, dock: dockModule, authService: authServiceModule, authHttp: authHttpModule, simulatedOidc: oidcModule, dockApi } = loaded;
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
  const sourcePlanPath = process.env.CHATDOM_DOCK_ADOPTED_PLAN ?? '/tmp/chatdom-winddown-live.MISHMM/adopted-plan.json';
  const sourcePlanBytes = await readFile(sourcePlanPath);
  const sourcePlanHash = createHash('sha256').update(sourcePlanBytes).digest('hex');
  const plan = JSON.parse(sourcePlanBytes);
  if (plan.revision !== 'settlement:2:43cffdb6' || plan.homes.length !== 240 || plan.quarters.length !== 5) throw Error('The approved complete Willowmere plan is required.');
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
  const siteDirectory = join(root, 'apps/web/dist'); // Reuse final snapshot build; never rebuild managed assets.
  front = createHttp((req, res) => { void (async () => {
    const path = new URL(req.url ?? '/', origin).pathname;
    if (path === '/__dock-evidence') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(`<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;background:#19120e;color:#fff;font:14px sans-serif}header{display:none}main{display:flex;gap:12px;align-items:start}iframe{border:0}#stream{width:1920px;height:1080px}#dock{width:318px;height:1080px}</style></head><body><header>SIMULATED · isolated realm, simulated sign-in and real stream view</header><main><iframe id="stream" title="Stream" src="/stream?source=realm&amp;kingdom=${kingdom}"></iframe><iframe id="dock" title="Dock" src="/dock/?kingdom=${kingdom}"></iframe></main></body></html>`); return;
    }
    const privateRealm = path.startsWith('/internal/dock/');
    if (privateRealm && req.headers.authorization !== `Bearer ${internalSecret}`) { res.writeHead(403).end(); return; }
    if (privateRealm || /^\/api\/realm\/(?:entry|founded|watch|clock|chronicle)(?:\/|$)/.test(path)) {
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
  const native = boot.loader.current(kingdom)?.scene;
  if (!native || native.origin !== 'simulated' || native.kingdomId !== kingdom) throw Error('The actual approved native scene was not installed.');
  const preflight = { sourceSnapshot: 'isolated final build snapshot', sourceCommit, origin: 'simulated', kingdomId: kingdom,
    sourcePlanHash, adoptedHomes: plan.homes.length, adoptedQuarters: plan.quarters.length,
    layoutRevision: native.layoutRevision, collisionRevision: native.collisionRevision, assets: native.assets.length,
    placements: native.placements.length, observedCitizens: 2, native: true, authority: 'retained writer', browserStarted: false };
  await writeFile(join(evidenceRoot, 'backend-preflight.json'), JSON.stringify(preflight, null, 2));
  if (!process.send) throw Error('The evidence supervisor is required.');
  const admitted = await new Promise(resolve => {
    process.on('message', function permit(message) {
      if (message === 'backend-only' || message === 'visual-admitted') { process.off('message', permit); resolve(message); }
    });
    process.send('backend-ready');
  });
  if (admitted === 'backend-only') { console.log('SIMULATED native backend preflight passed; no browser or receipt claimed.'); }
  else {
  // A failed rerun must never leave an older successful still or receipt looking current.
  for (const name of ['native-ready.json', 'native-gate-close-attempt.json', 'native-gate-close-SIMULATED.json', 'native-gate-close-SIMULATED@1920x1080.png', 'native-gate-close-diagnostic.json', 'native-gate-close-UNCONFIRMED@1920x1080.png']) await rm(join(evidenceRoot, name), { force: true });
  const freshAt = await stamp();
  await sendObservation({ version: 1, observation: { version: 1, kind: 'stream', origin: 'simulated', id: 'dock-round-presenter-stream', kingdomId: kingdom, observedAt: freshAt, live: true, sessionId: 'dock-simulated-night' } });
  await sendObservation({ version: 1, observation: { version: 1, kind: 'observe', origin: 'simulated', id: 'dock-round-presenter-citizens', kingdomId: kingdom, observedAt: freshAt,
    source: 'chat', coverage: 'activity', people: [{ personId: kingdom, disclosure: 'named', displayName: 'SIMULATED Wren' }, { personId: '990100002', disclosure: 'named', displayName: 'SIMULATED Robin' }] } });
  // This owned simulated Herald continues its actual observations while native assets warm.
  // No browser state, scene clock, people or renderer readiness is manufactured.
  const refreshObservedSource = async () => {
    const at = await stamp();
    await sendObservation({ version: 1, observation: { version: 1, kind: 'stream', origin: 'simulated', id: `dock-round-stream-heartbeat-${at}`, kingdomId: kingdom, observedAt: at, live: true, sessionId: 'dock-simulated-night' } });
    await sendObservation({ version: 1, observation: { version: 1, kind: 'observe', origin: 'simulated', id: `dock-round-citizens-heartbeat-${at}`, kingdomId: kingdom, observedAt: at,
      source: 'chat', coverage: 'activity', people: [{ personId: kingdom, disclosure: 'named', displayName: 'SIMULATED Wren' }, { personId: '990100002', disclosure: 'named', displayName: 'SIMULATED Robin' }] } });
  };
  sourceHeartbeat = setInterval(() => { sourceRefresh = sourceRefresh.then(refreshObservedSource).catch(() => { sourceRefreshFailures++; }); }, 20_000);
  await stat(join(siteDirectory, 'index.html'));
  stage = 'sign in and open stream and dock'; console.log(`SIMULATED bench: ${stage}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  if (!process.send) throw Error('The capture supervisor is required to track the browser.');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Browser tracking did not complete.')), 5000);
    process.on('message', function tracked(message) { if (message === 'browser-tracked' || message === 'browser-untracked') { clearTimeout(timer); process.off('message', tracked); if (message === 'browser-tracked') resolve(); else reject(Error('Browser group could not be tracked.')); } });
    process.send('browser-started');
  });
  const context = await browser.newContext({ viewport: { width: 2250, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [], pageErrors = [], witnessReplies = [];
  page.on('pageerror', error => { errors.push(error.message); pageErrors.push(error.message); });
  page.on('response', response => {
    if (!response.url().endsWith('/api/dock/witness')) return;
    void (async () => {
      const value = response.request().postDataJSON();
      const body = await response.json();
      witnessReplies.push({ at: Date.now(), http: response.status(), kingdomId: value.kingdomId, streamEventId: value.streamEventId, body });
    })().catch(() => {});
  });
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
  stage = 'verify actual installed native gate';
  const beforeDraw = await frame.evaluate(() => window.__chatdomKingdom?.inspect?.().dock);
  await writeFile(join(evidenceRoot, 'native-ready.json'), JSON.stringify({ ...preflight, browserStarted: true, dock: beforeDraw }, null, 2));
  if (!beforeDraw?.sites?.gate || beforeDraw.sites.simulated !== false) throw Error(`The actual approved native scene has no supported dock gate (${beforeDraw?.sites?.failure ?? 'no approved site'}). No act was substituted.`);
  // Let the native opening/arrival director finish before asking its lens to present another act.
  await page.waitForTimeout(12000);
  stage = 'press one native gate-close and retain its exact outcome';
  const button = dockFrame.getByRole('button', { name: /Close the gate/ }).first();
  await button.waitFor({ timeout: 30000 });
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/dock/actions') && response.request().method() === 'POST', { timeout: 30000 });
  const clickedAt = Date.now();
  await button.click(); // Exactly one command; all following operations are read-only outcome checks.
  const response = await responsePromise, result = await response.json(), request = response.request().postDataJSON();
  await writeFile(join(evidenceRoot, 'native-gate-close-attempt.json'), JSON.stringify({ request, result }, null, 2));
  const samples = [];
  const readEvent = async () => (await realmPool.query('SELECT event_id, presentation, created_ms, witnessed_ms FROM realm_dock_presentations WHERE action_id = $1 AND kingdom_id = $2', [request.id, kingdom])).rows[0];
  let stored = await readEvent();
  const diagnosticDeadline = Date.now() + 20_000;
  while (!stored?.witnessed_ms && Date.now() < diagnosticDeadline) {
    samples.push({ elapsedMs: Date.now() - clickedAt, dock: await frame.evaluate(() => window.__chatdomKingdom?.inspect?.().dock) });
    await page.waitForTimeout(250);
    stored = await readEvent();
  }
  // Hold only the frame that the real stream has already drawn and acknowledged.
  // Suspending rendering keeps the native gate camera/effect unchanged while Chrome captures pixels.
  const heldFrame = await frame.evaluate(() => {
    const engine = window.__chatdomKingdom, dock = engine?.inspect?.().dock;
    if (!dock?.presenting || dock.witnessed < 1 || typeof engine?.suspendRendering !== 'function') return { held: false, dock };
    window.__dockEvidenceRelease = engine.suspendRendering();
    return { held: true, dock };
  });
  const event = stored ? JSON.parse(stored.presentation) : null;
  const publicStatus = await dockDocument.evaluate(async kingdomId => {
    const status = await (await fetch(`/api/dock/status?kingdom=${kingdomId}`, { credentials: 'same-origin', cache: 'no-store' })).json();
    return { status: status.status, gate: status.town?.gate, undoable: status.undoable };
  }, kingdom);
  const drawn = await frame.evaluate(() => window.__chatdomKingdom?.inspect?.().dock);
  const exactReply = witnessReplies.find(value => value.http === 200 && value.body?.status === 'witnessed' && value.kingdomId === kingdom && value.streamEventId === event?.id);
  const exactReceipt = publicStatus.undoable?.find(value => value.id === `receipt:${event?.id}`)?.id;
  const drawConfirmed = !!stored?.witnessed_ms && !!exactReply && !!exactReceipt && drawn?.witnessed >= 1 && !pageErrors.length;
  const visualFrameReady = drawConfirmed && heldFrame.held && sourceRefreshFailures === 0;
  const label = visualFrameReady ? 'SIMULATED' : 'UNCONFIRMED';
  stage = 'capture native stream diagnostic still';
  await page.locator('#stream').screenshot({ path: join(evidenceRoot, `native-gate-close-${label}@1920x1080.png`), timeout: 150000 });
  const diagnostic = { ...preflight, browserStarted: true, scenario, format, action: request, initialOutcome: result,
    presentation: event, committedAt: stored ? Number(stored.created_ms) : null, witnessedAt: stored?.witnessed_ms ? Number(stored.witnessed_ms) : null,
    witnessReplies: witnessReplies.map(value => ({ ...value, elapsedMs: value.at - clickedAt })), samples, publicStatus, drawn, consoleErrors: errors, pageErrors,
    exactReceipt: exactReceipt ?? null, heldFrame, sourceRefreshFailures, drawConfirmed, visualFrameReady, screenshot: `native-gate-close-${label}@1920x1080.png` };
  await writeFile(join(evidenceRoot, 'native-gate-close-diagnostic.json'), JSON.stringify(diagnostic, null, 2));
  const witness = event ? { actionId: event.actionId, kingdomId: event.kingdomId, origin: event.origin, streamEventId: event.id } : null;
  if (drawConfirmed) await writeFile(join(evidenceRoot, 'native-gate-close-SIMULATED.json'), JSON.stringify({ ...preflight, browserStarted: true, scenario, format,
    initialOutcome: result, receipt: exactReceipt, receiptSource: 'authenticated public status undoable receipt', witness,
    durableWitnessed: true, heldFrame, sourceRefreshFailures, drawConfirmed, visualFrameReady, witnessedAfterCommitMs: Number(stored.witnessed_ms) - Number(stored.created_ms), witnessedAfterMs: Number(stored.witnessed_ms) - clickedAt, drawn, consoleErrors: errors.length, pageErrors: pageErrors.length }, null, 2));
  if (!visualFrameReady) throw Error('The native frame was captured; its held gate ceremony is unconfirmed. See drawConfirmed separately in the diagnostic evidence.');
  console.log('Captured one SIMULATED native gate close with an exact durable draw witness; the initial API outcome remains recorded.');
  }
} catch (error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,48}$/.test(error.code) ? ` code=${error.code}` : '';
  const missing = typeof error?.message === 'string' ? /Cannot find (?:package|module) ['"]([@a-zA-Z0-9_./-]+)['"]/.exec(error.message)?.[1] : undefined;
  const detail = String(error?.message ?? 'unknown').replaceAll(databaseUrl, '[database redacted]').replaceAll(internalSecret, '[credential redacted]').replaceAll(heraldSecret, '[credential redacted]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database redacted]');
  console.log(`SIMULATED bench failed at ${stage}${code}${missing ? ` missing=${missing}` : ''}: ${detail}`);
  process.exitCode = 1;
} finally {
  console.log('SIMULATED bench: close owned browser and services');
  clearInterval(sourceHeartbeat);
  await sourceRefresh;
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
