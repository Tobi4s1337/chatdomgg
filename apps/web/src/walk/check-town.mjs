// Full-town CPU diagnostic. No browser, preview listener or capture slot; all identities are SIMULATED.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true, hmr: false, ws: false } });
try {
  const [{ createSimulatedTownWalkFixture }, { stepPlayer, embeddedSolids, supported }] = await Promise.all([
    loader.ssrLoadModule('/apps/web/src/walk/town-fixture.ts'), loader.ssrLoadModule('/packages/world/src/movement/step.ts'),
  ]);
  const start = Date.now(), fixture = createSimulatedTownWalkFixture();
  const preparedMs = Date.now() - start;
  console.log(`SIMULATED native town compiled: ${fixture.scene.placements.length} placements, ${preparedMs} ms`);
  assert.ok(fixture.scene.placements.length > 50 && fixture.scene.placements.some(p => p.plotId));
  const players = fixture.spawns.map(([x, y, z]) => ({ x, y, z, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: fixture.world.revision }));
  assert.equal(new Set(players.map(p => `${p.x}:${p.z}`)).size, 3);
  for (let tick = 0; tick < 90; tick++) for (const player of players) {
    stepPlayer(player, { moveX: 0, moveZ: tick < 30 ? 40 : tick < 60 ? -40 : 0, yaw: tick < 30 ? 0 : 128,
      buttons: 0, collisionRevision: fixture.world.revision }, 1 / 30, fixture.world);
    assert.equal(embeddedSolids(player, fixture.world).length, 0, 'Native town body entered a solid');
    assert.ok(supported(player, fixture.world), 'Native town body lost ground support');
  }
  for (const player of players) { assert.ok(player.distance > 1.5); assert.equal(player.vx, 0); assert.equal(player.vz, 0); }
  console.log(JSON.stringify({ source: 'SIMULATED', knownWorld: 'full native founded collision', preparedMs, elapsedMs: Date.now() - start,
    players: players.map(({ x, y, z, distance }) => ({ x, y, z, distance })), limitation: fixture.limitation }, null, 2));
} finally { await loader.close(); }
