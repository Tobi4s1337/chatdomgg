import { RealmDockService, mountRealmDockRoutes } from './dock';
import { createRealmServer } from './server';
import { referenceServices } from './reference';
import { assertRealmSchema, createRealmPool, describeStorageFailure,
  realmDatabaseConfig } from './persistence';
import { INGRESS_ROUTE, ingressCredentials } from './ingress';
import { RealmPanelGifts, RealmPanelService, mountRealmPanelRoutes } from './ingress/panel';
import { ForgetGuard, RealmChatPrivacy, createQuietDisclosure, disclosedServices, mountChatPrivacyRoute } from './ingress/panel';
import { RealmPanelSettings } from './ingress/panel/settings';
import { HEALTH_ROUTE, READY_ROUTE } from './diagnostics';
import { TenureEvidenceVerifier, tenureEvidenceKey } from './allocation';
import { createDurableRealmBoot, mountEntryRoutes, mountRealmWatchRoutes } from './bootstrap';
import { RealmEntryInfoSchema } from '@chatdom/shared/realm';
import { join } from 'node:path';
import { ForgeWriteGate, FileForgeApprovals } from './wiring';
import { mountEveningRoutes } from './evening';
import { RaidChatBridge } from './raid-gate/raid-chat-bridge';
import { RaidChatPresentation } from './raid-gate/raid-chat-presentation';
import { mountRaidChatRead } from './raid-gate/raid-chat-http';
import { mountForgeQueueRoutes } from './forge-queue/http';
import { createRealmCitizens } from './evening/citizens';
import { createRealmCastle } from './evening/castle';
import { attachEveningInteractions } from './evening/interactions';
import { createServer as createPortReservation } from 'node:net';
import { realmListenHost, realmListenPort } from './listen-port';
import { ownRealmShutdown } from './lifecycle';
import { composeRealmItems } from './items/compose';
import { createItemRoomChannel } from './items/channel';
import { createPostgresItemAdmission } from './items/entry';
import { mountRaidShowRoutes } from './raid-gate/http';
import { mountChatCommandRoute, realmChatCommands } from './raid-gate/chat-commands';
import { RaidCrierAuthority } from './raid-gate/crier';
import { mountRaidCrierRoutes } from './raid-gate/crier-http';
import { RaidGuestAuthority } from './raid-gate/guests';
import { createRaidGuestRuntime } from './raid-gate/guest-runtime';
import { createRaidGuestSpawn } from './raid-gate/guest-spawn';
import { createRealmForgeChat } from './wiring/forge-chat-runtime';
import { itemCatalogue } from './items';
import { createDurableFishingChannel } from './fishing/durable';
import { fishingSpecies } from './fishing/content';
import { installGatherStore, createPostgresGatherStore } from './games/store';
import { installTavernReturns } from './games/return';
import { RealmPortalArrivals, installPortalArrivals } from './portals/arrivals';
import { RealmRoomTravel } from './raid-gate/room-travel';
import { createRealmRoomDoor } from './raid-gate/room-door';

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
  const guestAuthority = new RaidGuestAuthority({ pool, origin, clock: Date.now });
  const raidChat = new RaidChatPresentation({ origin, clock: Date.now });
  const roomTravel = new RealmRoomTravel({ pool, origin, clock: Date.now });
  const roomDoor = createRealmRoomDoor({ travel: roomTravel, rooms: { founded: async id => !!await boot.allocation.currentLayout(id), retain: id => boot.services.retain(id),
    scene: id => { const prepared = boot.loader.current(id); return prepared ? { world: prepared.world, plan: prepared.scene.plan } : undefined; } } });
  const raidGuests = createRaidGuestRuntime({ authority: guestAuthority, origin, marchers: roomTravel, citizens: input => citizens.observe(input), log: line => console.info(line),
    chatPresented: (input, result) => raidChat.observe(input, result) });
  // The grand land: bound to each founded receipt before it is public, baked in a niced child for a new plan.
  const land = process.env.REALM_LAND_DIRECTORY ? await (await import('./land/realm')).openRealmLand(process.env.REALM_LAND_DIRECTORY, line => console.info(line)) : null;
  const boot = createDurableRealmBoot({ pool, origin, verifier, foundedDirectory, ingressCredentials: credentials,
    ...(land ? { beforeFoundedPublication: land.beforePublication } : {}),
    // The reader serves only this origin's current authority-adopted, public-checkpoint-matching geometry.
    foundedAccess: target => target.origin === origin, log: line => console.info(line),
    repositoryOptions: gate.install({ origin, guards: [castle.guard] }), furnish: citizens.furnish,
    attach: kingdom => {
      const detachGuests = raidGuests.attach(kingdom), detachDoor = roomDoor.attach(kingdom);
      const clearRaidChat = () => raidChat.clear(kingdom.kingdomId), detachRaidChat = kingdom.onClosed(clearRaidChat);
      const detachEvening = evening.attach(kingdom);
      const detachInteractions = attachEveningInteractions(kingdom, { auth: boot.services.auth,
        scene: () => boot.loader.current(kingdom.kingdomId)?.scene });
      return () => { clearRaidChat(); detachRaidChat(); detachDoor(); detachGuests(); detachInteractions(); detachEvening(); };
    },
  });
  Object.assign(boot.services, { channels: [...(boot.services.channels ?? []), createItemRoomChannel(itemFoundation.items, createPostgresItemAdmission({ pool, origin, readiness: boot.readiness }))] });
  Object.assign(boot.services, { auth: roomDoor.fence(boot.services.auth), prepareSpawn: createRaidGuestSpawn({ authority: guestAuthority, marchers: roomTravel, current: (kingdomId) => {
    const held = boot.services.kingdoms.get(kingdomId), founded = boot.loader.current(kingdomId);
    return held?.current && founded ? { world: held.world, layoutRevision: held.layoutRevision,
      writerEpoch: held.writerEpoch, plan: founded.scene.plan } : undefined;
  } }) });
  // Fishing opens only where its pier layer is drawn: REALM_PIER_FISHING=1 once the kingdom view mounts it.
  const pierVisible = process.env.REALM_PIER_FISHING === '1';
  Object.assign(boot.services, { channels: [...boot.services.channels!, createDurableFishingChannel({ pool, origin, store: itemFoundation.store,
    items: itemFoundation.items, catalogue: itemCatalogue, species: fishingSpecies, readiness: boot.readiness,
    authority: id => boot.services.kingdoms.get(id) ?? null, scene: id => boot.loader.current(id)?.scene ?? null,
    visible: () => pierVisible, where: id => names.has(id) ? `${names.get(id)} pier` : 'the pier' })] });
  citizens.use(boot.allocation, boot.services);
  // Forgotten people are left out before the raid-guest guard and settlement see them.
  const forgetGuard = new ForgetGuard(pool, origin);
  boot.ingress.moments.useSettler(forgetGuard.settler(raidGuests.guardSettler(citizens)));
  castle.use(boot.allocation, boot.store);
  const forgeChat = await createRealmForgeChat({ pool, origin, services: boot.services, founded: id => !!boot.loader.current(id)?.scene });
  const evening = new RaidChatBridge({ origin, ingress: boot.ingress, gate, approvals, raidChat,
    forgeChatObserver: forgeChat.observe,
    current: kingdomId => boot.services.kingdoms.get(kingdomId)?.current === true,
    forgeQueue: { directory: join(foundedDirectory, 'forge-queue') },
    beforeObservation: input => forgetGuard.run(input, kept => raidGuests.observe(kept)) });
  evening.use(boot.services);
  const dock = new RealmDockService(pool, origin, process.env.REALM_INTERNAL_SECRET, 1800, names);
  dock.use(boot.services);
  installGatherStore(boot.services, createPostgresGatherStore(pool));
  installTavernReturns(boot.services, kingdomId => boot.loader.current(kingdomId)?.scene);
  // Doors out of the kingdom (the tavern's) register their outside here; coming back stands you outside them.
  const doors = new RealmPortalArrivals(); installPortalArrivals(boot.services, doors);
  const panel = new RealmPanelService({ settings: new RealmPanelSettings({ db: pool, services: boot.services, origin }), gifts: new RealmPanelGifts({ db: pool, services: boot.services, origin }), db: pool, origin, secret: credentials.panel, services: boot.services, allocation: boot.allocation, citizens, castle: castle.observe, loader: boot.loader, founded: boot.founded, projection: true, guard: forgetGuard });
  const chatPrivacy = new RealmChatPrivacy({ db: pool, origin, secret: credentials.herald, services: boot.services, allocation: boot.allocation, guard: forgetGuard });
  const { server, transport } = boot.createServer({ mountIngress: app => { mountEveningRoutes(app, evening); mountRealmDockRoutes(app, dock); mountRealmPanelRoutes(app, panel); mountChatPrivacyRoute(app, chatPrivacy); } });
  const raidShow = mountRaidShowRoutes(transport.app, { pool, origin, credentials, clock: Date.now, moment: observation => boot.ingress.moments.acceptMoment(observation), walkers: raidGuests.walkerOf,
    door: { transport: roomDoor.transport, secret: process.env.REALM_INTERNAL_SECRET } });
  const chatCommands = mountChatCommandRoute(transport.app, { registry: realmChatCommands, origin, credentials, clock: Date.now });
  const raidCrier = process.env.REALM_PUBLIC_ORIGIN ? mountRaidCrierRoutes(transport.app, { origin, credentials, authority: new RaidCrierAuthority({ pool, origin, publicOrigin: process.env.REALM_PUBLIC_ORIGIN, clock: Date.now }) }) : null;
  mountEntryRoutes(transport.app, boot.founded, origin, names);
  mountRealmWatchRoutes(transport.app, { services: disclosedServices(boot.services, createQuietDisclosure({ db: pool, origin })), founded: boot.founded, loader: boot.loader });
  const raidChatRead = mountRaidChatRead(transport.app, { origin, presentation: raidChat, current: kingdomId => boot.services.kingdoms.get(kingdomId)?.current === true });
  forgeChat.mount(transport.app);
  land?.mount(transport.app);
  mountForgeQueueRoutes(transport.app, evening.line, { pool, origin, secureCookies: new URL(process.env.REALM_PUBLIC_ORIGIN ?? 'http://localhost:5190').protocol === 'https:' });
  ownRealmShutdown(server, transport, async () => {
    itemFoundation.dispose();
    dock.stop();
    await land?.stop();
    raidChatRead.close();
    await raidShow.close();
    await chatCommands.close();
    await raidCrier?.close();
    try { await forgeChat.stop(); }
    finally { try { await evening.stop(); } finally { try { await boot.stop(); } finally { await raidGuests.close(); await pool.end(); } } }
  });
  try {
    await boot.readiness.start();
    await evening.start();
    await forgeChat.start();
    await releasePort();
    await server.listen(port, host);
  } catch (error) { itemFoundation.dispose(); dock.stop(); raidChatRead.close(); await raidShow.close(); await chatCommands.close(); await raidCrier?.close(); await forgeChat.stop(); await evening.stop(); await boot.stop(); await raidGuests.close(); await pool.end(); throw error; }
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
