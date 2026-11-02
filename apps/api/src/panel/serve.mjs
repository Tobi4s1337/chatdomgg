// Isolated lane gateway for the real panel backend. Never points at the live realm or schema.
// Run it on its own port, or mount its handler inside the panel stack host (`createLaneGateway`).
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { runnerImport } from 'vite';
import pg from 'pg';
import { CAPTURE_PORTS } from '../../../../packages/testing/capture-ports.mjs';

/**
 * The real panel HTTP handler over the lane's development database.
 * @param {{ realm?: string, publicOrigin: string, localOrigins?: string[] }} options
 */
export async function createLaneGateway({ realm = process.env.PUBLIC_REALM_TARGET || 'http://127.0.0.1:5172', publicOrigin, localOrigins = [] }) {
  const db = new URL(process.env.DATABASE_URL || 'http://missing');
  if (!['localhost', '127.0.0.1'].includes(db.hostname) || db.port !== '5410' || process.env.REALM_DATABASE_SCHEMA !== 'panel_window') throw new Error('The lane gateway requires development Postgres and schema panel_window.');
  process.env.PUBLIC_REALM_TARGET = realm;
  // The isolated gateway may read Twitch, but it never broadcasts to real channels during lane captures.
  process.env.PANEL_DISABLE_BROADCAST = '1';
  process.env.PANEL_DISABLE_CONFIGURATION = '1';
  const root = new URL('../../', import.meta.url).pathname;
  const load = async path => (await runnerImport(new URL(path, import.meta.url).pathname, { root, configFile: false, logLevel: 'warn' })).module;
  const [{ createPanelHttp }, { createPanelAuthority }, { createTwitchUsers }] = await Promise.all([load('./http.ts'), load('../public/panel/reading.ts'), load('../public/panel/twitch-users.ts')]);
  const pool = new pg.Pool({ connectionString: db.toString(), max: 4, options: '-c search_path="panel_window"' });
  const origin = 'live';
  const users = createTwitchUsers(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET ? { clientId: process.env.TWITCH_CLIENT_ID, clientSecret: process.env.TWITCH_CLIENT_SECRET } : null);
  const authority = createPanelAuthority({ pool, origin, publicOrigin, users, kingdomName: async id => {
    const answer = await fetch(`${realm}/api/realm/entry/${encodeURIComponent(id)}`, { signal: globalThis.AbortSignal.timeout(5000) });
    const body = await answer.json(); return answer.ok && body.kingdomId === id && typeof body.name === 'string' ? body.name : null;
  } });
  const handler = createPanelHttp({ authority, origin, extension: { clientId: process.env.TWITCH_EXTENSION_CLIENT_ID || 'panel-lane', secret: process.env.TWITCH_EXTENSION_SECRET || '' },
    extraOrigins: localOrigins });
  return { handler, close: async () => { handler.dispose(); await pool.end(); } };
}

const localOrigins = ports => [...new Set(ports)].flatMap(p => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]);
export { localOrigins };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PANEL_GATEWAY_PORT || 5171);
  // Any capture-safe lane port, or the lease port 5191; never a reserved service port.
  if (![5191, ...CAPTURE_PORTS].includes(port)) throw new Error('Use a capture-safe lane port or the lease port 5191.');
  const stackPort = Number(process.env.PANEL_STACK_PORT || 0);
  const publicOrigin = `http://localhost:${port}`;
  const gateway = await createLaneGateway({ publicOrigin,
    localOrigins: localOrigins([5170, 5173, 5175, 5191, 5192, 5198, ...([5192, ...CAPTURE_PORTS].includes(stackPort) ? [stackPort] : [])]) });
  const server = createServer((req, res) => { const url = new URL(req.url || '/', publicOrigin); void gateway.handler(req, res, url.pathname).catch(() => { if (!res.headersSent) res.writeHead(503).end(); else res.destroy(); }); });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  console.info(`Panel lane gateway on 127.0.0.1:${port}`);
  const stop = () => { server.closeAllConnections(); server.close(() => { void gateway.close(); }); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
