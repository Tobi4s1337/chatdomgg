/** Explicit stand-in for spec38/wiring: real KingdomRoom, SIMULATED identities and bounded market ground. */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { createServer as createPortReservation } from 'node:net';

if (!process.argv.includes('--simulated')) throw new Error('Pass --simulated; this preview never hosts live identities or durable work.');
const port = Number(process.env.REALM_PREVIEW_PORT ?? 5187);
if (!Number.isInteger(port) || port < 5170 || port > 5199 || [5190, 5191, 5192, 5194, 5195].includes(port)) throw new Error('Use an owned realm development port.');
// uWS can share a listen port. Refuse an existing listener instead of splitting tickets across writers.
const reservation = createPortReservation();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(port, '127.0.0.1', resolve); });
const repo = fileURLToPath(new URL('../', import.meta.url));
const loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
const { createRealmServer } = await loader.ssrLoadModule('/apps/realm/src/server.ts');
const { referenceServices } = await loader.ssrLoadModule('/apps/realm/src/reference.ts');
const { createSimulatedKingdomWalkFixture } = await loader.ssrLoadModule('/packages/testing/fixtures/kingdom-walk.ts');
const { createSimulatedPresence } = await loader.ssrLoadModule('/apps/web/src/kingdom/presence-feed.ts');
const fixture = createSimulatedKingdomWalkFixture(), base = referenceServices();
const simulation = createSimulatedPresence(fixture.scene.plan);
const started = Date.now();
const settledSeconds = 600, clockOffset = started - simulation.epochMs - settledSeconds * 1000;
simulation.advance(settledSeconds);
let frame;
// The presentation scenario has its own test kingdom ID; this explicitly simulated room owns its namespace.
// Room-fed presentation uses the wall clock, so translate the scenario clock and start with an inhabited town.
simulation.feed.subscribe(value => { frame = { ...value, kingdomId: fixture.manifest.kingdomId,
  asOf: value.asOf + clockOffset, windows: value.windows.map(window => ({ ...window, since: window.since + clockOffset })) }; }, () => {});
let arrival = 0, effects, cursor = 0;
const listeners = new Set();
const services = {
  auth: { ...base.auth, authenticate: async join => {
    const principal = await base.auth.authenticate(join);
    return { ...principal, look: ['tide', 'grove', 'clay'][Number(principal.personId.slice(-1)) % 3] };
  } },
  open: async kingdomId => {
    const handle = await base.open(kingdomId);
    const publish = next => {
      const nextCursor = ++cursor;
      for (const receive of listeners) receive({ version: 1, kingdomId, writerEpoch: handle.writerEpoch,
        sequence: 0, cursor: nextCursor, eventId: `simulated:preview:${nextCursor}`, message: { type: 'presence', frame: next } });
    };
    const timer = globalThis.setInterval(() => { simulation.advance(settledSeconds + (Date.now() - started) / 1000, true); publish(frame); }, 15_000);
    timer.unref();
    return { ...handle, layoutRevision: fixture.manifest.layoutRevision, world: fixture.world,
      spawn: () => fixture.spawns[arrival++ % fixture.spawns.length],
      bootstrap: principal => ({ ...handle.bootstrap(principal), throughCursor: cursor,
        layoutRevision: fixture.manifest.layoutRevision, collisionRevision: fixture.world.revision,
        current: [{ type: 'presence', frame }] }),
      subscribe: receive => { listeners.add(receive); return () => listeners.delete(receive); },
      recoverWalker: (id, revision) => revision === fixture.world.revision && !!effects?.placeWalker(id, fixture.spawns[0], revision),
      bindRoom: bound => { effects = bound; const off = handle.bindRoom(bound); return () => { if (effects === bound) effects = undefined; off(); }; },
      dispose: async () => { globalThis.clearInterval(timer); listeners.clear(); await handle.dispose(); },
    };
  },
};
const { server, transport } = createRealmServer(services);
const json = (response, body) => response.writeHeader('Cache-Control', 'no-store').writeHeader('Content-Type', 'application/json').end(JSON.stringify(body));
transport.app.get('/preview/entry', response => json(response, { kingdomId: fixture.manifest.kingdomId,
  kingdomName: 'Willowmere', origin: 'simulated', floor: fixture.floor,
  notice: 'SIMULATED · Market square only · Nothing is saved.' }));
transport.app.get(`/api/realm/founded/${fixture.manifest.kingdomId}`, response => json(response, fixture.manifest));
transport.app.get(`/api/realm/founded/scenes/${fixture.manifest.sceneHash}`, response => response.writeHeader('Cache-Control', 'no-store')
  .writeHeader('Content-Type', 'application/json').end(fixture.sceneBytes));
transport.app.post('/reference/session', response => json(response, base.issue()));
const stop = async () => { await server.gracefullyShutdown(false); await loader.close(); };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().finally(() => process.exit()); });
try {
  await new Promise(resolve => reservation.close(resolve));
  await server.listen(port, '127.0.0.1');
  console.info(`SIMULATED kingdom entry on ${port}; memory only, bounded market collision. Open /?walk=1&source=simulated on 5190.`);
} catch (error) { await loader.close(); throw error; }
