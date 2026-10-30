import { createServer } from 'node:http';
import pg from 'pg';
import { createRemoteJWKSet } from 'jose';
import { readRealmAuthConfig } from './realm-auth/config';
import { createRealmAuthHttp } from './realm-auth/http';
import { twitchOidc } from './realm-auth/oidc';
import { createRealmAuthService } from './realm-auth/service';
import { createSimulatedOidcProvider } from './realm-auth/simulated-provider';

const config = readRealmAuthConfig(process.env);
const pool = new pg.Pool({
  connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 3_000, idleTimeoutMillis: 30_000,
  statement_timeout: 5_000, idle_in_transaction_session_timeout: 10_000, application_name: 'chatdom-api',
  options: `-c search_path="${config.schema}"`,
});
pool.on('error', () => console.error('api: an idle database connection failed; it will be replaced'));

const simulated = config.mode === 'simulated'
  ? await createSimulatedOidcProvider({ publicOrigin: config.publicOrigin, internalOrigin: `http://127.0.0.1:${config.port}`, redirectUri: config.redirectUri })
  : null;
const provider = simulated?.provider ?? twitchOidc(config.twitch!.clientId, config.twitch!.clientSecret);
const service = createRealmAuthService({
  pool, provider, redirectUri: config.redirectUri,
  keys: createRemoteJWKSet(new URL(provider.jwksUri), { timeoutDuration: 5_000, cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 }),
});
try { await service.ready(); }
catch (error) {
  console.error(`api: ${error instanceof Error ? error.message : 'the realm schema is unavailable'} (schema "${config.schema}"; node --env-file-if-exists=.env apps/realm/scripts/migrate.mjs --schema ${config.schema})`);
  await pool.end();
  process.exit(1);
}

const routes = createRealmAuthHttp({
  service, publicOrigin: config.publicOrigin, secureCookies: config.secureCookies,
  ...(config.internalSecret ? { internalSecret: config.internalSecret } : {}),
  ...(simulated ? { extra: simulated.handle } : {}),
});
const server = createServer((request, response) => {
  void (async () => {
    if (request.url === '/healthz') {
      const database = await pool.query('select 1').then(() => true, () => false);
      response.writeHead(database ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ alive: true, database, mode: config.mode === 'live' ? 'LIVE' : 'SIMULATED' }));
      return;
    }
    if (!await routes(request, response)) {
      response.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ version: 1, status: 'refused', message: 'No such route' }));
    }
  })().catch(() => { if (!response.headersSent) response.writeHead(503).end(); else response.destroy(); });
});
server.headersTimeout = 10_000; server.requestTimeout = 15_000;
const sweep = setInterval(() => { service.sweep().catch(() => console.error('api: sign-in record sweep failed; it will retry')); }, 10 * 60_000);
sweep.unref();

await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
console.info(config.mode === 'live'
  ? `Chatdom API listening on ${config.host}:${config.port}: LIVE Twitch sign-in (openid only) for ${config.publicOrigin}`
  : `Chatdom API listening on ${config.host}:${config.port}: SIMULATED sign-in provider, no real accounts, for ${config.publicOrigin}`);

const stop = () => {
  clearInterval(sweep);
  server.close(() => { void pool.end().finally(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 5_000).unref();
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
