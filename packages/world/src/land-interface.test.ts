import { expect, it } from 'vitest';
import { VOXEL_METRES, VoxelBlueprintSchema, type Vec3 } from '@chatdom/shared';
import { WORLD_FIXTURE_KINGDOM } from '@chatdom/shared/world-fixtures';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { compileCollisionWorld } from '@chatdom/voxel/collision';
import type { RealmFoundedScene } from './founded-world/types';
import { assetHashOf } from './founded-world/codec';
import { validateFoundedScene } from './founded-world/validate';
import { createKingdomLandInterface, type LandGroundSource } from './land-interface';
import { generateSettlementPlan } from './settlement/generator';
import { homeOrigin, transformCardinalPoint } from './settlement/geometry';

/** SIMULATED installed snapshots: a front-fixed home grows back, with a published attachment placement.
 * Real hashes and the public scene validator protect the same boundary as fetched geometry.
 * This fixture is geometry only; it does not grant an allocation or a growth entitlement. */
async function fixture(depth: 64 | 80, revision: number) {
  const plan = generateSettlementPlan({ seed: 'grand-seam', tier: 'hamlet', firstYear: 2025, year: 2026 });
  const blueprint = VoxelBlueprintSchema.parse({ version: 1, id: `simulated:home:${depth}`, styleId: 'hearth', kind: 'home',
    lattice: 'build', size: [64, 24, depth], boxes: [
      { from: [0, 0, 0], to: [64, 24, depth], material: 3 },
      { from: [2, 1, 2], to: [62, 22, depth - 2], material: 0 },
      { from: [28, 1, depth - 4], to: [36, 17, depth], material: 0 },
    ], windows: [{ id: 'presence', centre: [16, 13, depth], width: 8, height: 8, facing: 'south' }] });
  const piece = VoxelBlueprintSchema.parse({ version: 1, id: 'simulated:chimney', styleId: 'hearth', kind: 'prop',
    lattice: 'build', size: [4, 8, 4], boxes: [{ from: [0, 0, 0], to: [4, 8, 4], material: 3 }], windows: [] });
  const hash = await assetHashOf(blueprint), pieceHash = await assetHashOf(piece), plot = plan.homes[0]!;
  const placements = plan.homes.map(home => ({ id: `home:${home.id}`, plotId: home.id,
    assetHash: hash, position: homeOrigin(home, depth * VOXEL_METRES.build), rotation: home.rotation }));
  const home = placements[0]!;
  placements.push({ id: 'forge:simulated-part', plotId: plot.id, assetHash: pieceHash,
    position: transformCardinalPoint(home.position, home.rotation, [1, 3, 1]), rotation: home.rotation });
  const scene = await validateFoundedScene({ version: 1, kingdomId: WORLD_FIXTURE_KINGDOM, origin: 'simulated',
    layoutRevision: plan.revision, collisionRevision: revision, plan,
    materials: { version: 1, revision: 1, materials: [
      { id: 0, name: 'Air', solid: false, occludesFaces: false, occludesAo: false, blocksLight: false, colour: '#000000', surface: 'air' },
      { id: 3, name: 'Stone', solid: true, occludesFaces: true, occludesAo: true, blocksLight: true, colour: '#777777', surface: 'stone' },
    ] }, assets: [{ assetHash: hash, blueprint }, { assetHash: pieceHash, blueprint: piece }], placements });
  // Only this 64m-square physical region is loaded. It is independent of the far landscape.
  const collision = compileCollisionWorld({ ...scene, revision,
    terrain: { origin: [-32, -16, -32], columns: 128, rows: 128,
      heights: new Float32Array(128 * 128).fill(plan.market.elevation), ceilingY: 64 } });
  const ground: LandGroundSource = { layoutRevision: scene.layoutRevision, collisionRevision: revision,
    sample: (x, z) => x >= -32 && x < 32 && z >= -32 && z < 32 ? [x, plan.market.elevation, z] : null };
  return { scene, ground, collision, blueprint };
}

it('preserves a validated placement graph, published attachment and fixed door across installed geometry revisions', async () => {
  const initial = await fixture(64, 7), grown = await fixture(80, 8);
  const before = JSON.stringify(grown.scene), seam = createKingdomLandInterface(grown);
  expect(seam.scene).toBe(grown.scene);
  expect(seam.paths.nodes).toBe(grown.scene.plan.nodes);
  expect(seam.paths.streets).toBe(grown.scene.plan.streets);
  expect(seam.paths.activeStreetIds).toBe(grown.scene.plan.activeStreetIds);
  expect(seam.forge.square).toBe(grown.scene.plan.market);
  expect(seam.forge.anvil).toEqual([0, 9, 8]);
  expect(seam.forge.approach).toEqual([0, 9, 9.7]);
  expect(seam.moments.plaza).toBe(grown.scene.plan.nodes.find(n => n.id === 'market')!.position);
  expect(seam.moments.castleGate).toBeNull(); // Outside physical coverage; scenery is no evidence.
  expect(seam.light.placements).toBe(grown.scene.placements);
  expect(seam.light.assets).toBe(grown.scene.assets);
  const a = initial.scene.placements[0]!, b = grown.scene.placements[0]!;
  expect(a.plotId).toBe(b.plotId);
  expect(a.rotation).toBe(b.rotation);
  expect(a.assetHash).not.toBe(b.assetHash);
  const front = (placed: typeof a, depth: number) => transformCardinalPoint(placed.position, placed.rotation, [4, .125, depth]);
  expect(front(a, 8)).toEqual(front(b, 10)); // Front door does not move when the origin moves back.
  expect(grown.scene.placements.at(-1)!.assetHash).toBe(initial.scene.placements.at(-1)!.assetHash);
  expect(grown.scene.placements.at(-1)!.position).not.toEqual(initial.scene.placements.at(-1)!.position);
  expect(seam.light.placements.filter(p => p.plotId === b.plotId)).toHaveLength(2); // Home + attachment, not two lights.
  expect(seam.groundAt(31, 0)).toEqual([31, 9, 0]);
  expect(seam.groundAt(9000, 0)).toBeNull();
  expect(seam.collision!.query({ min: [9000, 9, 0], max: [9001, 11, 1] })).not.toHaveLength(0);
  expect(JSON.stringify(grown.scene)).toBe(before);
  expect(() => createKingdomLandInterface({ ...grown, ground: initial.ground })).toThrow('revisions');
  expect(() => createKingdomLandInterface({ ...grown, collision: initial.collision })).toThrow('revisions');
  expect(() => createKingdomLandInterface({ ...grown, ground: { ...grown.ground, layoutRevision: 'old-land' } })).toThrow('revisions');
});

it('offers no approach without exact support and body clearance, and rejects invalid ground samples', async () => {
  const input = await fixture(64, 7);
  const make = (sample: LandGroundSource['sample'], collision?: CollisionWorld) => createKingdomLandInterface({
    scene: input.scene, ground: { ...input.ground, sample }, ...(collision ? { collision } : {}),
  });
  expect(make(input.ground.sample).forge.approach).toBeNull();
  expect(make(() => null, input.collision).moments.plaza).toBeNull();
  const empty: CollisionWorld = { revision: 7, query: () => [] };
  expect(make(input.ground.sample, empty).forge.approach).toBeNull();
  const blocked: CollisionWorld = { revision: 7, query: bounds => [...input.collision.query(bounds),
    { min: [-1, 9, 9], max: [1, 11, 11] }] };
  expect(make(input.ground.sample, blocked).forge.approach).toBeNull();
  for (const sample of [() => [0, NaN, 0] as Vec3, (x: number, z: number) => [x + 1, 9, z] as Vec3]) {
    expect(make(sample, input.collision).groundAt(0, 0)).toBeNull();
    expect(make(sample, input.collision).forge.approach).toBeNull();
  }
  expect(make((x, z) => [x, 9.01, z], input.collision).moments.plaza).toBeNull(); // Buried feet are not support.
  expect(make((x, z) => [x, 8.5, z], input.collision).forge.approach).toBeNull(); // Water sheet cannot hide a bed gap.
  let nonFiniteReachedProducer = false;
  const guarded = make((x, z) => { if (!Number.isFinite(x) || !Number.isFinite(z)) nonFiniteReachedProducer = true; return null; });
  expect(guarded.groundAt(Infinity, 0)).toBeNull();
  expect(guarded.groundAt(0, NaN)).toBeNull();
  expect(nonFiniteReachedProducer).toBe(false);
  const badPlan: RealmFoundedScene = { ...input.scene, layoutRevision: 'different-plan' };
  expect(() => createKingdomLandInterface({ ...input, scene: badPlan })).toThrow('revisions');
});
