import { RealmDockService, mountRealmDockRoutes } from './dock';
import { createRealmServer } from './server';
import { referenceServices } from './reference';
import { assertRealmSchema, createRealmPool, describeStorageFailure,
  realmDatabaseConfig } from './persistence';
import { INGRESS_ROUTE, ingressCredentials } from './ingress';
import { HEALTH_ROUTE, READY_ROUTE } from './diagnostics';
import { TenureEvidenceVerifier, tenureEvidenceKey } from './allocation';
import { createDurableRealmBoot, mountEntryRoutes, mountRealmWatchRoutes } from './bootstrap';
import { RealmEntryInfoSchema } from '@chatdom/shared/realm';
import { join } from 'node:path';
import { ForgeWriteGate, FileForgeApprovals } from './wiring';
import { RealmEveningBridge, mountEveningRoutes } from './evening';
import { createRealmCitizens } from './evening/citizens';
import { createRealmCastle } from './evening/castle';
import { attachEveningInteractions } from './evening/interactions';
import { createServer as createPortReservation } from 'node:net';
import { realmListenHost, realmListenPort } from './listen-port';
import { ownRealmShutdown } from './lifecycle';
import { composeRealmItems } from './items/compose';
import { createItemRoomChannel } from './items/channel';
import { createPostgresItemAdmission } from './items/entry';
import { itemCatalogue } from './items';
import { createDurableFishingChannel } from './fishing/durable';
import { fishingSpecies } from './fishing/content';
import { createRealmPier } from './fishing/pier';
import { mountPierRoutes } from './fishing/routes';

const simulated = process.env.REALM_SIMULATED === '1';
const storage = process.env.REALM_STORAGE ?? 'postgres';
const host = realmListenHost(process.env);

try {
  await serve();
} catch (error) {
  // Only typed, secret-free descriptions reach the console; the connection string never does.
  const plain = error instanceof Error && !('code' in error) && !/[a-z]+:\/\//i.test(error.message);
  console.error(`Realm failed to start: ${plain ? error.message : describeStorageFailure(error)}`);
  process.exit(1);
}

async function serve() {
  const port = realmListenPort(process.env);
  // uWS permits SO_REUSEPORT. Two local builds on one port would split entry and sockets between worlds.
  const reservation = createPortReservation();
  // A connection accepted during boot (a health probe, a browser retry) would hold close() open forever.
  reservation.on('connection', socket => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', () => reject(new Error(`Realm port ${port} is already in use; choose a free REALM_PORT.`)));
    reservation.listen({ port, host, exclusive: true }, resolve);
  });
  let held = true;
  const release = async () => { if (held) { held = false; await new Promise<void>(resolve => reservation.close(() => resolve())); } };
  try { await serveOwnedPort(release, port); } finally { await release(); }
}

async function serveOwnedPort(releasePort: () => Promise<void>, port: number) {
  if (storage === 'memory') {
    if (!simulated) throw new Error('Memory reference mode requires explicit REALM_SIMULATED=1.');
    return serveMemoryReference(releasePort, port);
  }
  if (storage !== 'postgres') throw new Error('REALM_STORAGE must be "postgres" or, for the SIMULATED reference only, "memory".');

  const foundedDirectory = process.env.REALM_FOUNDED_DIRECTORY;
  if (!foundedDirectory) throw new Error('REALM_FOUNDED_DIRECTORY must name a persistent ignored host directory for exact approved scene bytes.');
  const origin = simulated ? 'simulated' : 'live';
  const evidenceKey = tenureEvidenceKey();
  const verifier = new TenureEvidenceVerifier(origin, evidenceKey);
  const config = realmDatabaseConfig();
  const pool = createRealmPool(config);
  try { await assertRealmSchema(pool); } catch (error) { await pool.end(); throw error; }
  const itemFoundation = composeRealmItems(pool);
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
  const castle = createRealmCastle({ origin, kingdomNames: names, safetyKey: evidenceKey });
  const citizens = createRealmCitizens({ db: pool, origin, kingdomNames: names, castle: castle.observe, evidenceKey });
  const boot = createDurableRealmBoot({ pool, origin, verifier, foundedDirectory, ingressCredentials: credentials,
    // The reader serves only this origin's current authority-adopted, public-checkpoint-matching geometry.
    foundedAccess: target => target.origin === origin, log: line => console.info(line),
    repositoryOptions: gate.install({ origin, guards: [castle.guard] }), furnish: citizens.furnish,
    attach: kingdom => {
      const detachEvening = evening.attach(kingdom);
      const detachInteractions = attachEveningInteractions(kingdom, { auth: boot.services.auth,
        scene: () => boot.loader.current(kingdom.kingdomId)?.scene });
      return () => { detachInteractions(); detachEvening(); };
    },
  });
  Object.assign(boot.services, { channels: [...(boot.services.channels ?? []), createItemRoomChannel(itemFoundation.items, createPostgresItemAdmission({ pool, origin, readiness: boot.readiness }))] });
  // Fishing opens only where its pier layer is drawn: REALM_PIER_FISHING=1 once the kingdom view mounts it.
  const pierVisible = process.env.REALM_PIER_FISHING === '1';
  const pierWhere = (id: string) => names.has(id) ? `${names.get(id)} pier` : 'the pier';
  // Chat's `!fish`, the stream's pier feed and the public Almanac: the same pier, the same gate.
  const pier = createRealmPier({ pool, origin, store: itemFoundation.store, items: itemFoundation.items, catalogue: itemCatalogue,
    species: fishingSpecies, visible: () => pierVisible, scene: id => boot.loader.current(id)?.scene ?? null,
    authority: id => boot.services.kingdoms.get(id) ?? null, where: pierWhere, kingdomName: id => names.get(id) ?? 'This kingdom' });
  Object.assign(boot.services, { channels: [...boot.services.channels!, createDurableFishingChannel({ pool, origin, store: itemFoundation.store,
    items: itemFoundation.items, catalogue: itemCatalogue, species: fishingSpecies, readiness: boot.readiness,
    authority: id => boot.services.kingdoms.get(id) ?? null, scene: id => boot.loader.current(id)?.scene ?? null,
    visible: () => pierVisible, where: pierWhere, pier })] });
  citizens.use(boot.allocation, boot.services);
  boot.ingress.moments.useSettler(citizens);
  castle.use(boot.allocation, boot.store);
  const evening = new RealmEveningBridge({ origin, ingress: boot.ingress, gate, approvals,
    beforeObservation: input => citizens.observe(input), ...(pierVisible ? { chatCommands: pier.chatCommands } : {}) });
  evening.use(boot.services);
  const dock = new RealmDockService(pool, origin, process.env.REALM_INTERNAL_SECRET, 1800, names);
  dock.use(boot.services);
  const { server, transport } = boot.createServer({ mountIngress: app => { mountEveningRoutes(app, evening); mountRealmDockRoutes(app, dock); } });
  mountEntryRoutes(transport.app, boot.founded, origin, names);
  mountRealmWatchRoutes(transport.app, boot);
  mountPierRoutes(transport.app, pier);
  ownRealmShutdown(server, transport, async () => {
    pier.dispose();
    itemFoundation.dispose();
    dock.stop();
    try { await evening.stop(); }
    finally { try { await boot.stop(); } finally { await pool.end(); } }
  });
  try {
    await boot.readiness.start();
    await releasePort();
    await server.listen(port, host);
  } catch (error) { pier.dispose(); itemFoundation.dispose(); dock.stop(); await evening.stop(); await boot.stop(); await pool.end(); throw error; }
  console.info(`${simulated ? 'SIMULATED' : 'LIVE'} realm on ${port}: adopted durable Postgres kingdoms in schema "${config.schema}"; `
    + (boot.ingress.gate.configured ? `service ingress at POST ${INGRESS_ROUTE} (${Object.keys(credentials).join(', ')})` : 'service ingress closed (no REALM_INGRESS_*_SECRET)')
    + `; GET ${HEALTH_ROUTE}, GET ${READY_ROUTE}; current approved geometry only`);
}

async function serveMemoryReference(releasePort: () => Promise<void>, port: number) {
  const services = referenceServices();
  const { server, transport } = createRealmServer(services);
  ownRealmShutdown(server, transport, async () => {});
  transport.app.post('/reference/session', response => {
    response.writeHeader('Access-Control-Allow-Origin', '*').writeHeader('Cache-Control', 'no-store').writeHeader('Content-Type', 'application/json').end(JSON.stringify(services.issue()));
  });
  await releasePort();
  await server.listen(port, host);
  console.info(`SIMULATED realm reference on ${port}: memory only, nothing is saved`);
}
