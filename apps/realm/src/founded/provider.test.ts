import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNativeForgeHost } from '@chatdom/forge';
import { KingdomIdSchema, PersonIdSchema, type Vec3 } from '@chatdom/shared';
import { REALM_CASTLE_SLOT, castleHostId, type RealmBootstrap, type RealmFoundedManifest, type RealmOwnedCastle, type RealmOwnedHome } from '@chatdom/shared/realm';
import { generateSettlementPlan, terrainHeight } from '@chatdom/world';
import { createRealmState } from '@chatdom/world/realm';
import { embeddedSolids, stepPlayer, supported } from '@chatdom/world/movement';
import { prepareFoundedWalkerPositions } from './anchors';
import { compileFoundedScene, sampleFoundedTerrain } from './collision';
import { canonicalSceneJson } from './codec';
import { createFoundedWorld, createFoundedWorldLoader } from './provider';
import { FileFoundedStore } from './store';
import { decodeFoundedScene } from './validate';

// SIMULATED committed fixture authority. The current-town artifact itself came from real allocation persistence.
const kingdomId = KingdomIdSchema.parse('900000001');
const artifact = async () => {
  const bytes = new Uint8Array(await readFile(new URL('./artifacts/simulated-town.scene.json', import.meta.url)));
  const manifest = JSON.parse(await readFile(new URL('./artifacts/simulated-town.manifest.json', import.meta.url), 'utf8')) as RealmFoundedManifest;
  return { bytes, manifest, scene: await decodeFoundedScene(bytes, manifest) };
};

describe('founded physical town and persisted loader (SIMULATED)', () => {
  it('uses the same exact 924-placement town on both ends, real terrain, safe anchors and existing movement law', async () => {
    const { scene, bytes, manifest } = await artifact(), server = createFoundedWorld(scene);
    const browser = compileFoundedScene(await decodeFoundedScene(bytes, manifest));
    expect(scene.placements).toHaveLength(924);
    const terrain = sampleFoundedTerrain(scene.plan), [x, , z] = terrain.origin;
    expect(terrain.heights[0]).toBe(Math.round(terrainHeight(scene.plan, x + .25, z + .25) / .5) * .5);
    // Lake bed remains below the water sheet rather than becoming a crossing.
    const lake = scene.plan.lake, column = Math.floor((lake.x - x) * 2), row = Math.floor((lake.z - z) * 2);
    expect(terrain.heights[column + terrain.columns * row]).toBeLessThan(lake.level);
    const locations: Vec3[] = [server.anchors[0]!, scene.placements.find(p => p.id.startsWith('castle:'))!.position,
      scene.placements.find(p => p.id.startsWith('home:'))!.position, [x - 1, 0, z - 1]];
    for (const p of locations) {
      const query = { min: [p[0] - .3, p[1] - .1, p[2] - .3] as Vec3, max: [p[0] + .3, p[1] + 2, p[2] + .3] as Vec3 };
      expect(browser.query(query)).toEqual(server.world.query(query));
    }
    expect(browser.query({ min: [x - 2, 0, z - 2], max: [x - 1, 2, z - 1] }).length).toBeGreaterThan(0);
    const at = server.anchors[0]!, start = { x: at[0], y: at[1], z: at[2], vx: 0, vy: 0, vz: 0,
      grounded: true, yaw: 0, distance: 0, collisionRevision: manifest.collisionRevision };
    expect(embeddedSolids(start, server.world)).toHaveLength(0); expect(supported(start, server.world)).toBe(true);
    const a = { ...start }, b = { ...start }, input = { moveX: 127, moveZ: 60, buttons: 0, yaw: 0, collisionRevision: manifest.collisionRevision };
    for (let tick = 0; tick < 90; tick++) { stepPlayer(a, input, 1 / 30, server.world); stepPlayer(b, input, 1 / 30, browser); }
    expect(b).toEqual(a); expect(a.distance).toBeGreaterThan(1);
    // A geometry change covers affected bystanders, keeps clear peers and provides grounded egress.
    const victim = server.anchors[0]!, peer = server.anchors[15]!;
    const obstacle = { min: [victim[0] - .4, victim[1], victim[2] - .4] as Vec3, max: [victim[0] + .4, victim[1] + 2, victim[2] + .4] as Vec3 };
    const changed = { revision: server.world.revision + 1, query: (bounds: Parameters<typeof browser.query>[0]) => {
      const overlap = bounds.min.every((v, axis) => v < obstacle.max[axis]! && bounds.max[axis]! > obstacle.min[axis]!);
      return overlap ? [...server.world.query(bounds), obstacle] : server.world.query(bounds);
    } };
    const positions = prepareFoundedWalkerPositions(scene.plan, changed, [{ id: 'affected-bystander', position: victim }, { id: 'clear-peer', position: peer }]);
    expect(positions.size).toBe(2); expect(positions.get('clear-peer')).toEqual(peer); expect(positions.get('affected-bystander')).not.toEqual(victim);
  }, 30_000);

  it('loads exact adopted plans, pins native bytes, allocates nonaliasing revisions and waits for public agreement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chatdom-founded-'));
    try {
      const plan = generateSettlementPlan({ seed: 'SIMULATED-loader', tier: 'hamlet', firstYear: 2026, year: 2026 });
      const source = { origin: 'simulated' as const, currentLayout: async () => ({ revision: plan.revision, foundedAt: 1, adoptedAt: 1 }), layoutPlan: async () => plan };
      const store = new FileFoundedStore(directory), loader = createFoundedWorldLoader(source, store), empty = createRealmState(kingdomId, 'simulated');
      await store.native(kingdomId, plan, 'simulated');
      const first = await loader.load(kingdomId, empty);
      const checkpoint: RealmBootstrap = { version: 1, kingdomId, writerEpoch: 'SIMULATED-writer', throughCursor: 0, throughSequence: 0,
        layoutRevision: plan.revision, collisionRevision: first.world.revision, current: [] };
      expect(first.manifestFor(checkpoint)).toEqual(first.build.manifest);
      const native = await store.native(kingdomId, plan, 'simulated');
      const moduleId = plan.castle.beaconModuleId, keep = native.fixtures.find(f => f.id === castleHostId(moduleId))!;
      const castle: RealmOwnedCastle = { id: keep.id, moduleId, ownerId: PersonIdSchema.parse('900001111'), slot: REALM_CASTLE_SLOT,
        layoutRevision: plan.revision, revision: 'castle:1', digest: 'e'.repeat(64), family: 'tide', blueprint: keep.blueprint, attachments: {},
        attribution: { makerName: 'PRIVATE-SIMULATED-person', kingdomName: 'PRIVATE-SIMULATED-name', approvalId: 'PRIVATE-SIMULATED-approval' } };
      const withCastle = await loader.load(kingdomId, { ...empty, castle });
      expect(withCastle).not.toBe(first); // Metadata-only install must invalidate the staged private-state cache.
      expect(withCastle.world).toBe(first.world); // Identical native keep bytes retain physical world identity.
      expect(withCastle.build.manifest).toEqual(first.build.manifest);
      expect(withCastle.manifestFor(checkpoint)).toBeNull();
      expect(withCastle.manifestFor({ ...checkpoint, current: [{ type: 'castle', moduleId, revision: castle.revision, assetHash: castle.digest, attachments: [] }] }))
        .toEqual(withCastle.build.manifest);

      expect(first.manifestFor({ ...checkpoint, collisionRevision: 0 })).toBeNull();
      const restarted = createFoundedWorldLoader(source, new FileFoundedStore(directory)), again = await restarted.load(kingdomId, empty);
      expect(again.build.manifest).toEqual(first.build.manifest);
      const plot = plan.homes[0]!, blueprint = createNativeForgeHost(plot).blueprint;
      const edited = { ...blueprint, boxes: [...blueprint.boxes, { from: [1, 0, 1] as [number, number, number], to: [2, 1, 2] as [number, number, number], material: 1 }] };
      const home: RealmOwnedHome = { id: plot.id, ownerId: PersonIdSchema.parse('900001111'), slot: plot.slot,
        layoutRevision: plan.revision, allocationReceipt: 'PRIVATE-SIMULATED-deed', revision: 'approved:1', digest: 'a'.repeat(64), family: plot.style,
        blueprint: edited, attachments: {}, attribution: { makerName: 'PRIVATE-SIMULATED-person', kingdomName: 'PRIVATE-SIMULATED-name', approvalId: 'PRIVATE-SIMULATED-approval' } };
      const next = await loader.load(kingdomId, { ...empty, homes: { [plot.id]: home } });
      expect(next.world.revision).not.toBe(first.world.revision); expect(next.build.manifest.sceneHash).not.toBe(first.build.manifest.sceneHash);
      expect(next.manifestFor({ ...checkpoint, collisionRevision: next.world.revision })).toBeNull();
      expect(next.manifestFor({ ...checkpoint, collisionRevision: next.world.revision, throughCursor: 2, throughSequence: 1,
        current: [{ type: 'home', plotId: plot.id, revision: home.revision, assetHash: home.digest, attachments: [] }] })).toEqual(next.build.manifest);
      expect(new TextDecoder().decode(next.build.bytes)).not.toContain('PRIVATE-SIMULATED');
      const oldBytes = await store.get(first.build.manifest.sceneHash);
      expect(canonicalSceneJson(await decodeFoundedScene(oldBytes!, first.build.manifest))).toBe(canonicalSceneJson(first.scene));
      await expect(decodeFoundedScene(next.build.bytes, first.build.manifest)).rejects.toThrow('hash');
      const identities = ['b'.repeat(64), 'c'.repeat(64), 'b'.repeat(64)];
      const revisions = await Promise.all(identities.map(hash => store.revision(kingdomId, hash)));
      expect(revisions[0]).toBe(revisions[2]); expect(revisions[0]).not.toBe(revisions[1]);
      await writeFile(join(directory, 'scenes', `${first.build.manifest.sceneHash}.json`), 'corrupt');
      await expect(store.get(first.build.manifest.sceneHash)).rejects.toThrow('corrupt');
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30_000);
});
