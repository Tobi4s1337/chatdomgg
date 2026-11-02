import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createRemoteJWKSet } from 'jose';
import { readRealmAuthConfig } from '../realm-auth/config';
import { createRealmAuthHttp } from '../realm-auth/http';
import { twitchOidc } from '../realm-auth/oidc';
import { createRealmAuthService } from '../realm-auth/service';
import { createSimulatedOidcProvider } from '../realm-auth/simulated-provider';
import { readPublicConfig, refuseSimulatedOnHttps } from './config';
import { createPanelHttp } from '../panel/http';
import { createPanelAuthority } from './panel/reading';
import { createTwitchUsers } from './panel/twitch-users';
import { fetchTargetJson, proxyHttp, proxyUpgrade, type ProxyTarget } from './proxy';
import { classify, isRealmSocket } from './routes';
import { createSite, robotsHeaderFor } from './site';
import { indexBuild, sendFile, type StaticFile } from './static';
import { bindPublicGateway, supervise, type Supervised } from './supervisor';

/**
 * chatdom.io on one port: the web app, Twitch sign-in, the panel's Extension backend and the realm (its HTTP routes
 * and its WebSocket rooms), all same-origin, so session cookies, tickets and sockets never cross a site boundary.
 *
 * The realm runs as its own supervised process on a loopback port (or an already-running realm is named with
 * PUBLIC_REALM_TARGET); everything durable lives in Postgres and the founded directory, so restarting this process
 * or the realm loses no one's home, session or history. Visitors reconnect with a fresh ticket on their own.
 */
const repoRoot = process.env.PUBLIC_REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const config = readPublicConfig(process.env, repoRoot);
const auth = readRealmAuthConfig({ ...process.env, API_PORT: String(config.port), REALM_PUBLIC_ORIGIN: process.env.REALM_PUBLIC_ORIGIN ?? `http://localhost:${config.port}` });
// The existing dock bridge reads this default too; an explicit DOCK_REALM_URL still takes precedence there.
refuseSimulatedOnHttps(auth.mode, auth.publicOrigin);
process.env.CHATDOM_REALM_TARGET ??= `http://${config.realm.target.host.includes(':') ? `[${config.realm.target.host}]` : config.realm.target.host}:${config.realm.target.port}`;

const pool = new pg.Pool({
  connectionString: auth.databaseUrl, max: Number(process.env.PUBLIC_DATABASE_POOL ?? 20), connectionTimeoutMillis: 3_000, idleTimeoutMillis: 30_000,
  statement_timeout: 5_000, idle_in_transaction_session_timeout: 10_000, application_name: 'chatdom-public',
  options: `-c search_path="${auth.schema}"`,
});
pool.on('error', () => console.error('public: an idle database connection failed; it will be replaced'));

const simulated = auth.mode === 'simulated'
  ? await createSimulatedOidcProvider({ publicOrigin: auth.publicOrigin, internalOrigin: `http://127.0.0.1:${config.port}`, redirectUri: auth.redirectUri })
  : null;
const provider = simulated?.provider ?? twitchOidc(auth.twitch!.clientId, auth.twitch!.clientSecret);
const service = createRealmAuthService({
  pool, provider, redirectUri: auth.redirectUri,
  keys: createRemoteJWKSet(new URL(provider.jwksUri), { timeoutDuration: 5_000, cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 }),
});
try { await service.ready(); }
catch (error) {
  console.error(`public: ${error instanceof Error ? error.message : 'the realm schema is unavailable'} (schema "${auth.schema}"; run node --env-file-if-exists=.env apps/realm/scripts/migrate.mjs --schema ${auth.schema})`);
  await pool.end();
  process.exit(1);
}
const authRoutes = createRealmAuthHttp({
  service, publicOrigin: auth.publicOrigin, secureCookies: auth.secureCookies,
  // Internal revocation is a service door; it is never mounted on the public origin.
  ...(simulated ? { extra: simulated.handle } : {}),
});

let files: Map<string, StaticFile>;
try { files = await indexBuild(config.webRoot); }
catch { console.error(`public: the web build is missing at ${config.webRoot}; run node scripts/public/build.mjs first`); await pool.end(); process.exit(1); }
const page = files.get('/index.html');
if (!page) { console.error('public: the build has no app page; run node scripts/public/build.mjs'); await pool.end(); process.exit(1); }

const origin = auth.mode === 'live' ? 'live' : 'simulated';
const names = new Map<string, { at: number; name: Promise<string | null>; last: string | null }>();
/**
 * A kingdom's approved public name, as the realm's own entry gate serves it (cached for a minute). While the realm
 * restarts or cannot be reached, the last name it gave stands; only the realm's own answer can withdraw it.
 */
function kingdomName(kingdomId: string): Promise<string | null> {
  const cached = names.get(kingdomId);
  if (cached && Date.now() - cached.at < 60_000) return cached.name;
  const last = cached?.last ?? null;
  const answer = fetchTargetJson(config.realm.target, `/api/realm/entry/${encodeURIComponent(kingdomId)}`).then(({ status, body }) => {
    if (status === 0 || status >= 500) return { stale: true, value: last };
    const info = body as { kingdomId?: unknown; origin?: unknown; name?: unknown } | null;
    const value = status === 200 && info?.kingdomId === kingdomId && info.origin === origin && typeof info.name === 'string' && info.name.trim() ? info.name.trim().slice(0, 80) : null;
    return { stale: false, value };
  });
  const name = answer.then(({ value }) => value);
  names.set(kingdomId, { at: Date.now(), name, last });
  void answer.then(({ stale, value }) => {
    if (names.get(kingdomId)?.name !== name) return;
    if (value === null) names.delete(kingdomId);
    // A stale name is asked for again within ten seconds; a fresh one is good for the minute.
    else names.set(kingdomId, { at: stale ? Date.now() - 50_000 : Date.now(), name, last: value });
  });
  return name;
}

const twitchApp = auth.twitch ?? (process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET ? { clientId: process.env.TWITCH_CLIENT_ID, clientSecret: process.env.TWITCH_CLIENT_SECRET } : null);
const panel = createPanelHttp({
  authority: createPanelAuthority({ pool, origin, publicOrigin: auth.publicOrigin, users: createTwitchUsers(twitchApp), kingdomName }),
  origin, extension: config.extension,
  extraOrigins: (process.env.PUBLIC_PANEL_EXTRA_ORIGINS ?? '').split(',').map(value => value.trim()).filter(value => /^(?:https:\/\/[a-z0-9.-]+|http:\/\/(?:localhost|127\.0\.0\.1):\d+)$/.test(value)),
});

// The realm: a supervised child on its loopback port, or an existing realm the host already runs.
let realm: Supervised | null = null;

const optionalTargets: Record<'herald' | 'map' | 'forge', ProxyTarget | null> = config.optional;
const PAGE_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://static-cdn.jtvnw.net", "font-src 'self' data:", "connect-src 'self'",
    "media-src 'self' data: blob:", "worker-src 'self' blob:", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  ...(config.proto === 'https' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
};
let site: ReturnType<typeof createSite>;
try { site = createSite({ files, indexing: config.indexing, origin: auth.publicOrigin, pageHeaders: PAGE_HEADERS }); }
catch (error) { console.error(`public: ${error instanceof Error ? error.message : 'the site build is missing'}`); await pool.end(); process.exit(1); }
const unavailableJson = (response: ServerResponse, status: number, message: string) =>
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    .end(JSON.stringify({ version: 1, status: status === 404 ? 'refused' : 'unavailable', message }));

async function health(): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const [database, realmHealth] = await Promise.all([
    pool.query('select 1').then(() => true, () => false),
    fetchTargetJson(config.realm.target, '/healthz', 2_000),
  ]);
  const realmUp = realmHealth.status === 200;
  return { ok: database && realmUp, body: { alive: true, database, realm: realmUp, mode: auth.mode === 'live' ? 'LIVE' : 'SIMULATED' } };
}

async function doorData(response: ServerResponse) {
  const kingdoms = await Promise.all(config.doorKingdoms.map(async kingdom => {
    const name = await kingdomName(kingdom.kingdomId);
    return name ? { kingdomId: kingdom.kingdomId, name, login: kingdom.login } : null;
  }));
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    .end(JSON.stringify({ version: 1, mode: auth.mode === 'live' ? 'live' : 'simulated', kingdoms: kingdoms.filter(Boolean) }));
}

async function route(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', 'http://public.invalid');
  const target = classify(url.pathname, url.search);
  // Forward the same normalized path we authorized, never the raw spelling a downstream parser may interpret differently.
  request.url = `${url.pathname}${url.search}`;
  // While indexing is closed every answer says noindex; once open, only service, data and sign-in answers do.
  for (const [name, value] of Object.entries(robotsHeaderFor(config.indexing, target.kind))) response.setHeader(name, value);
  switch (target.kind) {
    case 'health': {
      const { ok, body } = await health();
      response.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
      return;
    }
    case 'auth':
      if (!await authRoutes(request, response)) unavailableJson(response, 404, 'No such route');
      return;
    case 'dock':
      if (!await (await import('../dock')).handleDock(request, response, { pool, config: auth })) unavailableJson(response, 404, 'No such route');
      return;
    case 'realm': proxyHttp(config.realm.target, request, response, config.proto, config.trustedProxies); return;
    case 'panel': await panel(request, response, url.pathname); return;
    case 'door-data': await doorData(response); return;
    case 'optional': {
      const upstream = optionalTargets[target.service];
      // Herald, Surveyor and the Forge already mount their own public prefixes. Only the realm mount is stripped.
      if (upstream) proxyHttp({ name: upstream.name, host: upstream.host, port: upstream.port }, request, response, config.proto, config.trustedProxies);
      else unavailableJson(response, 503, 'This part of Chatdom is not running on this host.');
      return;
    }
    case 'not-found':
      if (target.api) { unavailableJson(response, 404, 'No such route'); return; }
      break;
    default: break;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  if (site.handle(request, response, target)) return;
  if (target.kind === 'page') { sendFile(request, response, page!, site.appPageHeaders()); return; }
  const file = target.kind === 'file' ? files.get(url.pathname) : undefined;
  // HTML outside the listed pages (benches, references) stays off the public origin.
  if (file && !file.path.endsWith('.html')) { sendFile(request, response, file, { 'X-Content-Type-Options': 'nosniff' }); return; }
  site.notFound(request, response);
}

const server = createServer((request, response) => {
  route(request, response).catch(error => {
    console.error(`public: ${request.method} ${request.url?.split('?')[0]} failed (${error instanceof Error ? error.name : 'unknown'})`);
    if (!response.headersSent) unavailableJson(response, 503, 'Something went wrong on our side. Nothing has changed; try again.');
    else response.destroy();
  });
});
server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url ?? '/', 'http://public.invalid');
    request.url = `${url.pathname}${url.search}`;
    // Only the realm's rooms accept sockets; anything else is closed at once.
    if (isRealmSocket(url.pathname)) proxyUpgrade(config.realm.target, request, socket, head, config.proto, config.trustedProxies);
    else socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  } catch { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); }
});
server.headersTimeout = 15_000;
server.requestTimeout = 0; // Long-lived watch streams; idle sockets are bounded by keepAliveTimeout instead.
server.keepAliveTimeout = 65_000;
server.maxHeadersCount = 64;

const sweep = setInterval(() => { service.sweep().catch(() => console.error('public: sign-in record sweep failed; it will retry')); }, 10 * 60_000);
sweep.unref();

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  clearInterval(sweep);
  const closed = new Promise<void>(resolve => server.close(() => resolve()));
  server.closeIdleConnections();
  setTimeout(() => server.closeAllConnections(), 5_000).unref();
  void Promise.allSettled([closed, realm?.stop(15_000)]).then(() => pool.end()).finally(() => process.exit(0));
  setTimeout(() => process.exit(1), 25_000).unref();
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

try {
  realm = await bindPublicGateway({ server, port: config.port, host: config.host, realmMode: config.realm.mode,
    startRealm: () => {
      if (stopping) throw new Error('The public server stopped during startup.');
      return supervise({
        name: 'realm', command: process.execPath, args: [config.realm.entry], cwd: resolve(repoRoot, 'apps/realm'),
        env: { ...process.env, REALM_PORT: String(config.realm.target.port), REALM_HOST: '127.0.0.1',
          REALM_DATABASE_SCHEMA: auth.schema, REALM_SIMULATED: auth.mode === 'simulated' ? '1' : '0' },
      });
    } });
} catch (error) {
  clearInterval(sweep);
  process.removeListener('SIGTERM', stop);
  process.removeListener('SIGINT', stop);
  server.closeAllConnections();
  server.close();
  await realm?.stop(15_000);
  await pool.end();
  throw error;
}
server.on('error', error => { console.error(`public: listener failed (${error.name})`); stop(); });
console.info(`Chatdom public origin ${auth.publicOrigin} on ${config.host}:${config.port}: ${auth.mode === 'live' ? 'LIVE Twitch sign-in' : 'SIMULATED sign-in, no real accounts'}; `
  + `realm ${config.realm.mode === 'spawn' ? `supervised on ${config.realm.target.port}` : `at ${config.realm.target.host}:${config.realm.target.port}`}; `
  + `panel backend ${config.extension ? `for extension ${config.extension.clientId.slice(0, 6)}…` : 'not configured (TWITCH_EXTENSION_CLIENT_ID)'}; `
  + `door kingdoms ${config.doorKingdoms.map(kingdom => kingdom.login).join(', ')}`);
