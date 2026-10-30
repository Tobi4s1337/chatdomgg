import pg from 'pg';
import { createClient } from 'redis';
const checks = [
  ['Postgres', async () => {
    if (!process.env.DATABASE_URL) throw new Error();
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
    try { await db.connect(); const result = await db.query("SELECT current_setting('server_version_num')::int AS version"); if (result.rows[0].version < 180000) throw new Error(); }
    finally { await db.end(); }
  }],
  ['Valkey', async () => {
    if (!process.env.VALKEY_URL) throw new Error();
    const client = createClient({ url: process.env.VALKEY_URL, socket: { connectTimeout: 3000, reconnectStrategy: false } });
    client.on('error', () => {});
    try { await client.connect(); if (await client.ping() !== 'PONG') throw new Error(); }
    finally { if (client.isOpen) client.destroy(); }
  }],
  ['Surveyor', async () => {
    if (!process.env.SURVEYOR_URL) throw new Error();
    const response = await fetch(`${process.env.SURVEYOR_URL.replace(/\/$/, '')}/status`, { signal: globalThis.AbortSignal.timeout(3000) });
    if (!response.ok || typeof await response.json() !== 'object') throw new Error();
  }],
];
for (const [name, check] of checks) {
  try { await check(); console.log(`${name}: ready (read-only check)`); }
  catch { console.error(`${name}: connection/check failed; inspect local configuration`); process.exitCode = 1; }
}
