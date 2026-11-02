import { describe, expect, it } from 'vitest';
import { VOXEL_METRES, type VoxelBlueprint } from '@chatdom/shared';
import { generateSettlementPlan, terrainHeight } from '@chatdom/world';
import { foundedGroundAt } from '@chatdom/world/founded-collision';
import { findPierSite, installPier, pierFootprint, pierFurnishings, pierLocalToWorld, pierWaterAt } from './site';

const planFor = (seed: string) => generateSettlementPlan({ seed, tier: 'hamlet', firstYear: 2025, year: 2026 });
const seeds = ['founded-scene-test', 'willowmere', 'lanternmere', 'chatdom'];

describe('founded pier site', () => {
  it('finds a stable site from the plan, including independently copied plans', () => {
    for (const seed of seeds) {
      const plan = planFor(seed), before = JSON.stringify(plan), site = findPierSite(plan);
      expect(site, seed).not.toBeNull();
      expect(findPierSite(structuredClone(plan)), seed).toEqual(site);
      expect(JSON.stringify(plan)).toBe(before);
      expect(site!.root[1]).toBe(foundedGroundAt(plan, site!.root[0], site!.root[2])[1]);
      for (let x = -22; x <= 42; x += 2) for (let z = site!.walk / VOXEL_METRES.build; z <= site!.walk / VOXEL_METRES.build + 32; z += 2) {
        const p = pierLocalToWorld(site!, [x, 0, z]), water = pierWaterAt(plan, p[0], p[2]);
        expect(water, `${seed} head ${x},${z}`).toBe(site!.waterY);
        expect(water! - Math.max(terrainHeight(plan, p[0], p[2]), foundedGroundAt(plan, p[0], p[2])[1])).toBeGreaterThanOrEqual(1);
      }
      for (const x of [4, 10, 16]) for (const z of [-6, -2, .5]) {
        const p = pierLocalToWorld(site!, [x, 0, z]);
        expect(foundedGroundAt(plan, p[0], p[2])[1]).toBeGreaterThanOrEqual(site!.waterY + .125);
      }
    }
  }, 120_000);

  it('refuses malformed lakes and site obstructions without relocating or mutating existing pieces', () => {
    const plan = planFor('founded-scene-test'), site = findPierSite(plan)!;
    expect(site).not.toBeNull();
    const malformed = structuredClone(plan);
    expect(findPierSite(malformed)).toEqual(site);
    Object.assign(malformed.landform.lake, { radiusX: NaN });
    expect(findPierSite(malformed)).toBeNull();
    const footprint = [...pierFootprint(site)].sort((a, b) => a.minX - b.minX)[0]!;
    const blueprint = { size: [1, 8, 16] } as VoxelBlueprint;
    const obstacle = { id: 'existing:turned', blueprint, position: [footprint.minX - .5, site.deckY, footprint.minZ + .5] as const, rotation: 1 as const };
    expect(installPier(plan, [{ ...obstacle, rotation: 0 }])).not.toBeNull();
    const old = structuredClone(obstacle);
    expect(installPier(plan, [obstacle])).toBeNull();
    expect(obstacle).toEqual(old);
    expect(findPierSite(plan)).toEqual(site);
    const existing = { ...obstacle, id: 'existing:far', position: [plan.bounds.minX, site.deckY, plan.bounds.minZ] as const };
    const pieces = [existing], before = structuredClone(pieces), added = pierFurnishings(plan, pieces);
    expect(added.length).toBeGreaterThan(0);
    expect(pieces).toEqual(before);
    expect(pieces[0]).toBe(existing);
    expect(pierFurnishings(plan, [...pieces, ...added])).toEqual([]);
  }, 120_000);
});

it('walks continuously from the bank onto the assembled pier head in the production collision world', async () => {
  const { KingdomIdSchema } = await import('@chatdom/shared');
  const { createRealmState } = await import('@chatdom/world/realm');
  const { compileFoundedScene } = await import('@chatdom/world/founded-collision');
  const { embeddedSolids, stepPlayer, supported } = await import('@chatdom/world/movement');
  const { assembleFoundedScene } = await import('../founded/scene');
  const plan = planFor('founded-scene-test'), site = findPierSite(plan)!;
  const kingdomId = KingdomIdSchema.parse('900000002');
  const { scene } = await assembleFoundedScene({ kingdomId, plan, state: createRealmState(kingdomId, 'simulated'), collisionRevision: 7 });
  expect(scene.placements.some(p => p.id.startsWith('pier:'))).toBe(true);
  const world = compileFoundedScene(scene);
  const start = pierLocalToWorld(site, [10, 0, -6]);
  const y = foundedGroundAt(plan, start[0], start[2])[1];
  const player = { x: start[0], y, z: start[2], vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: 7 };
  const end = pierLocalToWorld(site, [10, 0, 8]);
  const dx = end[0] - start[0], dz = end[2] - start[2];
  const input = { moveX: Math.sign(dx) * 127, moveZ: Math.sign(dz) * 127, buttons: 0, yaw: 0, collisionRevision: 7 };
  for (let tick = 0; tick < Math.ceil((site.walk + 3) / 4 * 30); tick++) {
    stepPlayer(player, input, 1 / 30, world);
    expect(embeddedSolids(player, world), `tick ${tick}`).toHaveLength(0);
    expect(supported(player, world), `tick ${tick}`).toBe(true);
  }
  expect(player.distance).toBeGreaterThan(site.walk + 1);
  const head = pierLocalToWorld(site, [10, 0, (site.walk + 2) / VOXEL_METRES.build]);
  expect(Math.hypot(player.x - head[0], player.z - head[2])).toBeLessThan(2);
  expect(player.y).toBeCloseTo(site.deckY, 5);
}, 120_000);
