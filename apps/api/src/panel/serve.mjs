// Isolated lane gateway for the real panel backend. Never points at the live realm or schema.
import { createServer } from 'node:http';
import { runnerImport } from 'vite';
import pg from 'pg';
const db = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['localhost', '127.0.0.1'].includes(db.hostname) || db.port !== '5410' || process.env.REALM_DATABASE_SCHEMA !== 'panel_window') throw new Error('The lane gateway requires development Postgres and schema panel_window.');
const port = Number(process.env.PANEL_GATEWAY_PORT || 5171), realm = process.env.PUBLIC_REALM_TARGET || 'http://127.0.0.1:5172';
if (![5171, 5191].includes(port)) throw new Error('Use lane gateway port 5171 or lease port 5191.');
process.env.PUBLIC_REALM_TARGET = realm;
// The isolated gateway may read Twitch, but it never broadcasts to real channels during lane captures.
process.env.PANEL_DISABLE_BROADCAST = '1';
const root = new URL('../../', import.meta.url).pathname;
const load = async path => (await runnerImport(new URL(path, import.meta.url).pathname, { root, configFile: false, logLevel: 'warn' })).module;
const [{ createPanelHttp }, { createPanelAuthority }, { createTwitchUsers }] = await Promise.all([load('./http.ts'), load('../public/panel/reading.ts'), load('../public/panel/twitch-users.ts')]);
const pool = new pg.Pool({ connectionString: db.toString(), max: 4, options: '-c search_path="panel_window"' });
const origin = 'live', publicOrigin = `http://localhost:${port}`;
const users = createTwitchUsers(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET ? { clientId: process.env.TWITCH_CLIENT_ID, clientSecret: process.env.TWITCH_CLIENT_SECRET } : null);
const authority = createPanelAuthority({ pool, origin, publicOrigin, users, kingdomName: async id => {
  const answer = await fetch(`${realm}/api/realm/entry/${encodeURIComponent(id)}`, { signal: globalThis.AbortSignal.timeout(5000) });
  const body = await answer.json(); return answer.ok && body.kingdomId === id && typeof body.name === 'string' ? body.name : null;
} });
const handler = createPanelHttp({ authority, origin, extension: { clientId: process.env.TWITCH_EXTENSION_CLIENT_ID || 'panel-lane', secret: process.env.TWITCH_EXTENSION_SECRET || '' },
  extraOrigins: [5170, 5173, 5175, 5191, 5192].flatMap(p => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]) });
const server = createServer((req, res) => { const url = new URL(req.url || '/', publicOrigin); void handler(req, res, url.pathname).catch(() => { if (!res.headersSent) res.writeHead(503).end(); else res.destroy(); }); });
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
console.info(`Panel lane gateway on 127.0.0.1:${port}`);
const stop = () => { handler.dispose(); server.closeAllConnections(); server.close(() => { void pool.end(); }); };
process.once('SIGTERM', stop); process.once('SIGINT', stop);
