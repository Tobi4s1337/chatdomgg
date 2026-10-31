// Writes the SIMULATED founded-town artifact into apps/realm/src/founded/artifacts/.
//   node --env-file-if-exists=.env apps/realm/src/founded/write-artifact.mjs
// Uses a fresh throwaway schema of DATABASE_URL, drops it afterwards and prints no connection details.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import pg from 'pg';
import { runnerImport } from 'vite';

if (!process.env.DATABASE_URL) {
  console.error('founded artifact: DATABASE_URL is not configured (load it with --env-file-if-exists=.env)');
  process.exit(1);
}
const root = fileURLToPath(new URL('../..', import.meta.url));
const load = path => runnerImport(fileURLToPath(new URL(path, import.meta.url)), { root, configFile: false, logLevel: 'warn' }).then(r => r.module);
const persistence = await load('../persistence/index.ts');
const { writeSimulatedTownArtifact } = await load('./artifact.ts');
const schema = `realm_founded_${randomBytes(6).toString('hex')}`;
const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: 'chatdom-founded-artifact' });
let pool;
try {
  await persistence.migrateRealmSchema(owner, schema);
  pool = persistence.createRealmPool({ connectionString: process.env.DATABASE_URL, schema });
  const evidence = await writeSimulatedTownArtifact(pool, fileURLToPath(new URL('./artifacts', import.meta.url)));
  console.info(JSON.stringify(evidence, null, 2));
} catch (error) {
  console.error(`founded artifact: ${error instanceof Error && !/postgres(ql)?:\/\//.test(error.message) ? error.stack : 'the database refused the run'}`);
  process.exitCode = 1;
} finally {
  await pool?.end();
  await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => { process.exitCode = 1; console.error('founded artifact: could not drop the throwaway schema'); });
  await owner.end();
}
