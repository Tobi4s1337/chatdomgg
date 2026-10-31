import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { createRealmServer } from './server';
import { REFERENCE_KINGDOM, referenceServices } from './reference';
import { PostgresRealmRepository, assertRealmSchema, createDurableRealmServices, createRealmPool, describeStorageFailure,
  realmDatabaseConfig } from './persistence';
import { PostgresOutboxStore } from './outbox';
import { INGRESS_ROUTE, RealmIngress, ingressCredentials, mountIngressRoute } from './ingress';
import { HEALTH_ROUTE, READY_ROUTE, RealmDiagnostics, RealmReadiness, databaseProbe, holdEntry, mountDiagnosticsRoutes, writerProbe } from './diagnostics';

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
  if (!simulated) {
    // Live entry needs Twitch-verified sessions and checked tickets; there is no development bypass and no memory court.
    throw new Error('Live realm entry requires the verified Twitch session service, which this build does not include. Set REALM_SIMULATED=1 for the labelled SIMULATED kingdom.');
  }
  if (storage === 'memory') return serveMemoryReference();
  if (storage !== 'postgres') throw new Error('REALM_STORAGE must be "postgres" or, for the SIMULATED reference only, "memory".');

  const config = realmDatabaseConfig();
  const pool = createRealmPool(config);
  try { await assertRealmSchema(pool); } catch (error) { await pool.end(); throw error; }
  // SIMULATED entry tickets, durable SIMULATED kingdom: committed facts survive restarts; no live identity is claimed.
  const reference = referenceServices();
  const repository = new PostgresRealmRepository(pool, { origin: 'simulated' });
  const credentials = ingressCredentials();
  const ingress = new RealmIngress(pool, 'simulated', credentials, line => console.info(line));
  // Readiness: database and writer leases (SIMULATED entry has no session store to probe). Held dependencies refuse
  // new arrivals and owned commands at once instead of queueing them behind a store that is not answering.
  const diagnostics = new RealmDiagnostics();
  const open = () => services.kingdoms.values();
  const readiness = new RealmReadiness([databaseProbe(pool), writerProbe(open)]);
  const held = () => readiness.held();
  const services = createDurableRealmServices({
    repository, outbox: new PostgresOutboxStore(pool), auth: holdEntry(reference.auth, held), log: line => console.info(line), hold: held,
    attach: kingdom => {
      const forget = kingdom.onClosed(reason => diagnostics.writerClosed(kingdom, reason));
      const detach = ingress.attach(kingdom);
      return () => { forget(); detach(); };
    },
    kingdom: kingdomId => {
      if (kingdomId !== REFERENCE_KINGDOM) throw new Error('The SIMULATED realm hosts only its reference kingdom.');
      return { world: REFERENCE_WORLD, layoutRevision: 'reference-court-v1', spawn: (_principal, arrival) => courtSpawn(arrival) };
    },
  });
  ingress.use(services);
  const { server, transport } = createRealmServer(services, diagnostics);
  diagnostics.watch({ pool });
  mountDiagnosticsRoutes(transport.app, readiness, diagnostics, open);
  await readiness.start();
  transport.app.post('/reference/session', response => {
    response.writeHeader('Access-Control-Allow-Origin', '*').writeHeader('Cache-Control', 'no-store').writeHeader('Content-Type', 'application/json').end(JSON.stringify(reference.issue()));
  });
  // Herald/panel presence evidence. Without a configured service secret the door stays shut; walkers are still observed.
  if (ingress.gate.configured) mountIngressRoute(transport.app, ingress);
  // Colyseus disposes rooms first (each releases only its own hold), then ingress lets go of its kingdoms, then the pool closes.
  server.onShutdown(async () => { readiness.stop(); diagnostics.stop(); await ingress.stop(); await pool.end(); });
  await server.listen(port, '0.0.0.0');
  console.info(`SIMULATED realm on ${port}: durable Postgres kingdom ${REFERENCE_KINGDOM} in schema "${config.schema}"; `
    + (ingress.gate.configured ? `service ingress at POST ${INGRESS_ROUTE} (${Object.keys(credentials).join(', ')})` : 'service ingress closed (no REALM_INGRESS_*_SECRET)')
    + `; GET ${HEALTH_ROUTE}, GET ${READY_ROUTE}`);
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

/** Arrivals spread across the open court floor in front of the spawn bench, clear of its two blocks. */
function courtSpawn(arrival: number): readonly [number, number, number] {
  const column = arrival % 5, row = Math.floor(arrival / 5) % 4;
  return [(column - 2) * 3, 0, 6 + row * 2.5];
}
