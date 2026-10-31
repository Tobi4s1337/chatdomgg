import { createRealmServer } from './server';
import { referenceServices } from './reference';
import { assertRealmSchema, createRealmPool, describeStorageFailure,
  realmDatabaseConfig } from './persistence';
import { INGRESS_ROUTE, ingressCredentials } from './ingress';
import { HEALTH_ROUTE, READY_ROUTE } from './diagnostics';
import { TenureEvidenceVerifier, tenureEvidenceKey } from './allocation';
import { createDurableRealmBoot, mountEntryRoutes } from './bootstrap';
import { RealmEntryInfoSchema } from '@chatdom/shared/realm';
import { join } from 'node:path';
import { ForgeWriteGate, FileForgeApprovals } from './wiring';
import { RealmEveningBridge, mountEveningRoutes } from './evening';
import { createRealmCitizens } from './evening/citizens';

const simulated = process.env.REALM_SIMULATED === '1';
const storage = process.env.REALM_STORAGE ?? 'postgres';
const port = Number(process.env.REALM_PORT ?? 5191);

try {
  await serve();
} catch (error) {
  // Only typed, secret-free descriptions reach the console; the connection string never does.
  const plain = error instanceof Error && !('code' in error) && !/[a-z]+:\/\//i.test(error.message);
  console.error(`Realm failed to start: ${plain ? error.message : describeStorageFailure(error)}`);
  process.exit(1);
}

async function serve() {
  if (!Number.isInteger(port) || port < 5170 || port > 5199) throw new Error('Use a development port in 5170–5199');
  if (storage === 'memory') {
    if (!simulated) throw new Error('Memory reference mode requires explicit REALM_SIMULATED=1.');
    return serveMemoryReference();
  }
  if (storage !== 'postgres') throw new Error('REALM_STORAGE must be "postgres" or, for the SIMULATED reference only, "memory".');

  const foundedDirectory = process.env.REALM_FOUNDED_DIRECTORY;
  if (!foundedDirectory) throw new Error('REALM_FOUNDED_DIRECTORY must name a persistent ignored host directory for exact approved scene bytes.');
  const origin = simulated ? 'simulated' : 'live';
  const verifier = new TenureEvidenceVerifier(origin, tenureEvidenceKey());
  const config = realmDatabaseConfig();
  const pool = createRealmPool(config);
  try { await assertRealmSchema(pool); } catch (error) { await pool.end(); throw error; }
  const credentials = ingressCredentials();
  const gate = new ForgeWriteGate();
  const approvals = new FileForgeApprovals(join(foundedDirectory, 'forge-approvals'));
  const names = new Map();
  // Explicit host-approved presentation for the local test kingdom; never accept a visitor's chosen title.
  if (process.env.REALM_ENTRY_KINGDOM_ID || process.env.REALM_ENTRY_KINGDOM_NAME) {
    const entry = RealmEntryInfoSchema.parse({ version: 1, origin,
      kingdomId: process.env.REALM_ENTRY_KINGDOM_ID, name: process.env.REALM_ENTRY_KINGDOM_NAME });
    names.set(entry.kingdomId, entry.name);
  }
  const citizens = createRealmCitizens({ db: pool, origin, kingdomNames: names });
  const boot = createDurableRealmBoot({ pool, origin, verifier, foundedDirectory, ingressCredentials: credentials,
    // The reader serves only this origin's current authority-adopted, public-checkpoint-matching geometry.
    foundedAccess: target => target.origin === origin, log: line => console.info(line),
    repositoryOptions: gate.install({ origin }), furnish: citizens.furnish,
    attach: kingdom => evening.attach(kingdom),
  });
  citizens.use(boot.allocation, boot.services);
  const evening = new RealmEveningBridge({ origin, ingress: boot.ingress, gate, approvals,
    beforeObservation: input => citizens.observe(input) });
  evening.use(boot.services);
  const { server, transport } = boot.createServer({ mountIngress: app => mountEveningRoutes(app, evening) });
  mountEntryRoutes(transport.app, boot.founded, origin, names);
  server.onShutdown(async () => { await evening.stop(); await boot.stop(); await pool.end(); });
  try {
    await boot.readiness.start();
    await server.listen(port, '0.0.0.0');
  } catch (error) { await evening.stop(); await boot.stop(); await pool.end(); throw error; }
  console.info(`${simulated ? 'SIMULATED' : 'LIVE'} realm on ${port}: adopted durable Postgres kingdoms in schema "${config.schema}"; `
    + (boot.ingress.gate.configured ? `service ingress at POST ${INGRESS_ROUTE} (${Object.keys(credentials).join(', ')})` : 'service ingress closed (no REALM_INGRESS_*_SECRET)')
    + `; GET ${HEALTH_ROUTE}, GET ${READY_ROUTE}; current approved geometry only`);
}

async function serveMemoryReference() {
  const services = referenceServices();
  const { server, transport } = createRealmServer(services);
  transport.app.post('/reference/session', response => {
    response.writeHeader('Access-Control-Allow-Origin', '*').writeHeader('Cache-Control', 'no-store').writeHeader('Content-Type', 'application/json').end(JSON.stringify(services.issue()));
  });
  await server.listen(port, '0.0.0.0');
  console.info(`SIMULATED realm reference on ${port}: memory only, nothing is saved`);
}
