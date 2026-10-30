import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { createRealmServer } from './server';
import { REFERENCE_KINGDOM, referenceServices } from './reference';
import { PostgresRealmRepository, assertRealmSchema, createDurableRealmServices, createRealmPool, describeStorageFailure,
  realmDatabaseConfig } from './persistence';

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
  const services = createDurableRealmServices({
    repository, auth: reference.auth, log: line => console.info(line),
    kingdom: kingdomId => {
      if (kingdomId !== REFERENCE_KINGDOM) throw new Error('The SIMULATED realm hosts only its reference kingdom.');
      return { world: REFERENCE_WORLD, layoutRevision: 'reference-court-v1', spawn: (_principal, arrival) => courtSpawn(arrival) };
    },
  });
  const { server, transport } = createRealmServer(services);
  transport.app.post('/reference/session', response => {
    response.writeHeader('Access-Control-Allow-Origin', '*').writeHeader('Cache-Control', 'no-store').writeHeader('Content-Type', 'application/json').end(JSON.stringify(reference.issue()));
  });
  // Colyseus disposes rooms first (each releases only its own lease), then the pool closes.
  server.onShutdown(() => pool.end());
  await server.listen(port, '0.0.0.0');
  console.info(`SIMULATED realm on ${port}: durable Postgres kingdom ${REFERENCE_KINGDOM} in schema "${config.schema}"`);
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
