// Applies the realm's additive SQL migrations to one schema of DATABASE_URL.
//   node --env-file-if-exists=.env apps/realm/scripts/migrate.mjs [--schema realm]
// Creates the schema if needed, never drops or rewrites anything, and prints no connection details.
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import pg from 'pg';
import { runnerImport } from 'vite';

const at = process.argv.indexOf('--schema');
const schema = at > 0 ? process.argv[at + 1] : (process.env.REALM_DATABASE_SCHEMA ?? 'realm');
if (!process.env.DATABASE_URL) {
  console.error('realm migrate: DATABASE_URL is not configured (load it with --env-file-if-exists=.env)');
  process.exit(1);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const { module } = await runnerImport(fileURLToPath(new URL('../src/persistence/migrate.ts', import.meta.url)), { root, configFile: false, logLevel: 'warn' });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, application_name: 'chatdom-realm-migrate' });
try {
  const ran = await module.migrateRealmSchema(pool, schema);
  console.info(ran.length ? `realm migrate: schema "${schema}" applied ${ran.join(', ')}` : `realm migrate: schema "${schema}" is current`);
} catch (error) {
  console.error(`realm migrate: ${error instanceof Error && !/postgres(ql)?:\/\//.test(error.message) ? error.message : 'the database refused the migration'}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
