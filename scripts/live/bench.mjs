// The SIMULATED live-Twitch bench: a private realm, Herald's EventSub door and the web client, side by side with
// (never instead of) the running services on 5191–5197.
//
//   node --env-file=<file with DATABASE_URL> scripts/live/bench.mjs up       build, migrate, adopt, start, stay up
//        … up --fresh                                                        first drop the bench's own schema and scenes
//        … up --profile                                                      write a CPU profile of the realm on stop
//   node scripts/live/bench.mjs status                                       health of the three processes
//   node scripts/live/bench.mjs down                                         stop exactly what `up` started
// `up` stays in the foreground and owns its three processes: run it in its own terminal (or `&`), stop it with
// Ctrl-C or `down`.
//
// Ports (development range, none capture-reserved): realm 5198, web 5199, Herald door 5175.
// State, secrets, logs and the outbox live in ~/.local/state/chatdom/live-twitch-bench (owner-only), never in the
// repository. Postgres schema: live_twitch_bench. Nothing here prints DATABASE_URL or a secret.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { BENCH, ROOT, cliForward, payloadSource, readState, stateDir, health } from './lib.mjs';

const children = new Map();
// Whatever ends the supervisor (a failure, a thrown error, a signal) ends the processes it started, and only those.
process.on('exit', () => { for (const child of children.values()) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
process.on('uncaughtException', error => fail(error?.stack ?? String(error)));
process.on('unhandledRejection', error => fail(error?.stack ?? String(error)));
const command = process.argv[2] ?? 'status';
if (command === 'up') await up();
else if (command === 'down') down();
else if (command === 'status') await status();
else { console.error('bench: up | status | down'); process.exit(2); }

async function up() {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set (run with node --env-file=<your .env>).');
  const dir = stateDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const previous = readState();
  if (previous?.supervisor && alive(previous.supervisor)) fail('the bench is already running; run `bench.mjs down` first.');
  const secrets = previous?.secrets ?? {
    ingress: randomBytes(32).toString('hex'), door: randomBytes(24).toString('hex'), evidence: randomBytes(32).toString('hex'),
  };
  for (const port of [BENCH.realmPort, BENCH.webPort, BENCH.doorPort]) if (await listening(port)) fail(`port ${port} is in use by something else; the bench never shares a port.`);

  step('building realm and Herald');
  for (const app of ['@chatdom/realm', '@chatdom/herald']) {
    const built = spawnSync('pnpm', ['--filter', app, 'build'], { cwd: ROOT, stdio: 'inherit' });
    if (built.status !== 0) fail(`${app} did not build.`);
  }

  if (process.argv.includes('--fresh')) {
    step(`dropping the bench's own schema ${BENCH.schema} and scenes`);
    const pg = (await import('pg')).default;
    const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: 'chatdom-live-twitch-bench' });
    try { await owner.query(`DROP SCHEMA IF EXISTS ${BENCH.schema} CASCADE`); } finally { await owner.end(); }
    rmSync(join(dir, 'founded'), { recursive: true, force: true });
    rmSync(join(dir, 'outbox'), { recursive: true, force: true });
  }
  step(`preparing schema ${BENCH.schema}`);
  await prepare(secrets.evidence);

  const env = (extra) => ({ PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', ...extra });
  const founded = join(dir, 'founded'), outbox = join(dir, 'outbox');
  mkdirSync(founded, { recursive: true, mode: 0o700 });
  const pids = {};
  step(`realm on ${BENCH.realmPort} (SIMULATED)`);
  const profile = process.argv.includes('--profile') ? ['--cpu-prof', '--cpu-prof-dir', join(dir, 'profiles')] : [];
  pids.realm = start('realm', 'node', [...profile, 'apps/realm/dist/realm.mjs'], env({
    DATABASE_URL: process.env.DATABASE_URL, REALM_DATABASE_SCHEMA: BENCH.schema, REALM_FOUNDED_DIRECTORY: founded, REALM_SIMULATED: '1',
    REALM_ENTRY_KINGDOM_ID: BENCH.kingdomId, REALM_ENTRY_KINGDOM_NAME: BENCH.kingdomName, REALM_INGRESS_HERALD_SECRET: secrets.ingress,
    REALM_EVIDENCE_KEY: secrets.evidence, REALM_PORT: String(BENCH.realmPort),
  }));
  // The realm holds its port with a bare reservation socket until it is ready, and only lets go once every
  // connection to it has closed: nothing may knock on 5198 until the realm itself says it is listening.
  const booted = Date.now() + 120_000;
  for (;;) {
    const log = readFileSync(join(dir, 'realm.log'), 'utf8');
    if (/realm on \d+:/.test(log)) break;
    if (/Realm failed to start/.test(log) || children.get('realm').exitCode !== null) { console.error(log.slice(-600)); fail('the realm did not start.'); }
    if (Date.now() > booted) { children.get('realm').kill('SIGTERM'); fail('the realm did not start within two minutes.'); }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  step(`Herald door on ${BENCH.doorPort} (SIMULATED)`);
  pids.door = start('door', 'node', ['apps/herald/dist/herald.mjs', 'mock', '--kingdom', BENCH.kingdomId, '--port', String(BENCH.doorPort)], env({
    HERALD_REALM_URL: `http://127.0.0.1:${BENCH.realmPort}`, REALM_INGRESS_HERALD_SECRET: secrets.ingress, HERALD_MOCK_SECRET: secrets.door,
    HERALD_REALM_OUTBOX_DIR: outbox,
  }));
  step(`web on ${BENCH.webPort}`);
  pids.web = start('web', join(ROOT, 'node_modules/.bin/vite'), ['--port', String(BENCH.webPort), '--strictPort', '--host', '127.0.0.1'], env({
    CHATDOM_REALM_TARGET: `http://127.0.0.1:${BENCH.realmPort}`, CHATDOM_API_TARGET: 'http://127.0.0.1:9', NODE_ENV: 'development',
  }), join(ROOT, 'apps/web'));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ secrets, supervisor: process.pid, pids, startedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  let stopping = false;
  const stopAll = (why) => {
    if (stopping) return;
    stopping = true;
    console.info(`· stopping (${why})`);
    for (const child of children.values()) if (child.exitCode === null) child.kill('SIGTERM');
    setTimeout(() => process.exit(0), 5_000).unref();
    Promise.all([...children.values()].map(child => child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : null)).then(() => process.exit(0));
  };
  process.on('SIGINT', () => stopAll('interrupted'));
  process.on('SIGTERM', () => stopAll('asked to stop'));
  for (const [name, child] of children) child.once('exit', (code, signal) => { if (!stopping) { console.error(`bench: ${name} exited (${signal ?? code}); see ${join(dir, `${name}.log`)}`); stopAll(`${name} exited`); } });

  step('waiting for health');
  const deadline = Date.now() + 90_000;
  for (;;) {
    const report = await health();
    if (report.realm.ok && report.door.ok && report.web.ok) break;
    if (Date.now() > deadline) { console.error(JSON.stringify(report, null, 2)); console.error(`bench: the bench did not come up; logs are in ${dir}.`); stopAll('not healthy'); return; }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  // The broadcast begins, as Twitch would announce it: chat now lights windows in a live evening.
  try { await cliForward('stream.online', ['-t', BENCH.kingdomId]); } catch (error) {
    console.error(`bench: stream.online did not reach the door: ${error.message}`);
    stopAll('stream.online failed');
    return;
  }
  console.info(`  stream.online · ${payloadSource.value}`);
  console.info(`\nbench up · SIMULATED · kingdom ${BENCH.kingdomId} (${BENCH.kingdomName})`);
  console.info(`  watch:  http://127.0.0.1:${BENCH.webPort}/stream?source=realm&kingdom=${BENCH.kingdomId}`);
  console.info(`  door:   POST http://127.0.0.1:${BENCH.doorPort}/eventsub   ·   logs: ${dir}`);
  console.info('  (stays up; Ctrl-C or `bench.mjs down` to stop)');
  await new Promise(() => {});
}

/** Migrate the private schema and adopt the kingdom's layout as SIMULATED. Reads the live layout, never writes it. */
async function prepare(evidenceHex) {
  const { runnerImport } = await import('vite');
  const load = path => runnerImport(join(ROOT, path), { root: join(ROOT, 'apps/realm'), configFile: false, logLevel: 'warn' }).then(result => result.module);
  const pg = (await import('pg')).default;
  const { migrateRealmSchema } = await load('apps/realm/src/persistence/migrate.ts');
  const { createRealmPool } = await load('apps/realm/src/persistence/index.ts');
  const { AllocationService, TenureEvidenceVerifier } = await load('apps/realm/src/allocation/index.ts');
  const { simulatedFurnisher } = await load('apps/realm/src/founded/simulated.ts');
  const { generateSettlementPlan } = await load('packages/world/src/index.ts');
  const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: 'chatdom-live-twitch-bench' });
  try {
    const ran = await migrateRealmSchema(owner, BENCH.schema);
    if (ran.length) console.info(`  migrated ${ran.length} step(s)`);
    // The real kingdom's adopted streets, so the bench looks like the place chat lives in. Read only.
    let plan = null;
    try {
      const row = (await owner.query(`SELECT l.plan FROM realm.realm_layout_heads h JOIN realm.realm_layouts l
        ON l.kingdom_id = h.kingdom_id AND l.revision = h.revision WHERE h.kingdom_id = $1`, [BENCH.kingdomId])).rows[0];
      if (row) plan = JSON.parse(row.plan);
    } catch { plan = null; }
    if (!plan) {
      plan = generateSettlementPlan(BENCH.fallbackConfig);
      console.info(`  no adopted layout to copy; generated ${plan.revision}`);
    }
    const db = createRealmPool({ connectionString: process.env.DATABASE_URL, schema: BENCH.schema });
    try {
      const allocation = new AllocationService(db, { origin: 'simulated', verifier: new TenureEvidenceVerifier('simulated', Buffer.from(evidenceHex, 'hex')), furnish: simulatedFurnisher });
      const adopted = await allocation.adoptLayout(BENCH.kingdomId, plan);
      if (adopted.status === 'rejected') fail(`layout not adopted: ${adopted.reason} ${adopted.detail ?? ''}`);
      console.info(`  layout ${adopted.revision} ${adopted.status} · ${plan.homes.length} home plots`);
    } finally { await db.end(); }
  } finally { await owner.end(); }
}

function start(name, command, args, env, cwd = ROOT) {
  const log = openSync(join(stateDir(), `${name}.log`), 'w', 0o600);
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', log, log] });
  children.set(name, child);
  return child.pid;
}

function down() {
  const state = readState();
  if (!state?.supervisor || !alive(state.supervisor)) { console.info('bench: nothing recorded as running'); return; }
  // The supervisor stops its own three processes and exits.
  process.kill(state.supervisor, 'SIGTERM');
  console.info(`  asked the bench (${state.supervisor}) to stop`);
}

async function status() {
  console.info(JSON.stringify(await health(), null, 2));
}

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function listening(port) {
  try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) }); return true; } catch (error) {
    return !/ECONNREFUSED/.test(String(error?.cause?.code ?? error?.cause ?? ''));
  }
}
function step(text) { console.info(`· ${text}`); }
function fail(text) { console.error(`bench: ${text}`); process.exit(1); }
