import { describe, expect, it } from 'vitest';
import { createThresholdWatch, insideTavernThreshold, KingdomIdSchema, type GrowthPrivateState } from '@chatdom/shared';
import type { PlayerState } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { createGrowthState } from '@chatdom/world/growth';
import { standingClear } from '@chatdom/world/interactions';
import { stepPlayer } from '@chatdom/world/movement';
import { createRealmState } from '@chatdom/world/realm';
import { createNativeTown } from '../founded/native';
import { assembleFoundedScene } from '../founded/scene';
import { compileFoundedScene } from '../founded/collision';
import { tavernPortalFor } from './portal';

const growthAt = (kingdomId: ReturnType<typeof KingdomIdSchema.parse>, level: number): GrowthPrivateState => {
  const growth = createGrowthState(kingdomId, 'simulated');
  return { ...growth, civic: { ...growth.civic, levels: { tavern: level, forge: level, market: level, bridge: level, 'castle-court': level } } };
};
const body = (feet: readonly number[], revision: number): PlayerState =>
  ({ x: feet[0]!, y: feet[1]!, z: feet[2]!, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: revision });

// Distinct founded plans, both tiers: each places its tavern on its own site and turn.
// Distinct founded plans; the first is also checked at its mature tavern (the stage-four porch and steps).
const PLANS: readonly { readonly kingdom: string; readonly seed: string; readonly tier: 'hamlet' | 'town'; readonly levels: readonly number[] }[] = [
  { kingdom: '900000011', seed: 'founded-scene-test', tier: 'hamlet', levels: [1, 4] },
  { kingdom: '900000012', seed: 'tavern-door-north', tier: 'hamlet', levels: [1] },
  { kingdom: '900000013', seed: 'tavern-door-harbour', tier: 'hamlet', levels: [1] },
  // Founded from the four launch channels' names at both tiers, youngest and mature tavern. Their adopted plans live
  // in the realm database (Genesis); these seeds widen the sites and turns checked, they are not those plans.
  ...(['tobi4s_', 'the_aggman', 'pinkkittyrose', 'mashad4'] as const).flatMap((seed, index) => (['hamlet', 'town'] as const)
    .map((tier, t) => ({ kingdom: `90000002${index * 2 + t}`, seed, tier, levels: [1, 4] }))),
];
// All four exterior turns are covered against the authored form in packages/content/src/tavern/portal.test.ts.

describe('the founded tavern door', () => {
  for (const { kingdom, seed, tier, levels } of PLANS) it(`derives a supported return outside the installed door of ${seed} (${tier}), facing out, that real walking crosses both ways`, async () => {
      const kingdomId = KingdomIdSchema.parse(kingdom), plan = generateSettlementPlan({ seed, tier, firstYear: 2025, year: 2026 });
      const native = createNativeTown(plan), empty = createRealmState(kingdomId, 'simulated');
      for (const level of levels) {
        const { scene } = await assembleFoundedScene({ kingdomId, plan, native, state: { ...empty, growth: growthAt(kingdomId, level) }, collisionRevision: level });
        const before = JSON.stringify(scene.placements), world = compileFoundedScene(scene);
        const portal = tavernPortalFor(kingdomId, scene, world), label = `${seed} level ${level}`;
        expect(portal, label).not.toBeNull();
        // Deriving the door moves no home, road, placement or exterior piece.
        expect(JSON.stringify(scene.placements), label).toBe(before);
        const tavern = scene.placements.find(piece => piece.id === 'civic:growth:v1:tavern')!;
        expect([0, 1, 2, 3]).toContain(tavern.rotation);
        expect(portal!.kingdomId).toBe(kingdomId);
        expect(portal!.source.collisionRevision).toBe(world.revision);
        expect(standingClear(world, portal!.returnAnchor.feet), label).toBe(true);
        expect(insideTavernThreshold(portal!.door, portal!.returnAnchor.feet), label).toBe(false);
        const [tx, tz] = portal!.door.through, yaw = portal!.returnAnchor.yaw * Math.PI / 128;
        // Facing out is facing against the inward crossing.
        expect(Math.sin(yaw) * tx + Math.cos(yaw) * tz, label).toBeLessThan(-.999);

        // Walk in from the return anchor through the actual collision: the door is crossed within two seconds.
        const walker = body(portal!.returnAnchor.feet, world.revision), watch = createThresholdWatch(portal!.door);
        const inward = { moveX: Math.round(tx * 127), moveZ: Math.round(tz * 127), buttons: 0, yaw: (portal!.returnAnchor.yaw + 128) % 256, collisionRevision: world.revision };
        let crossed = -1;
        for (let step = 0; step < 60 && crossed < 0; step++) { stepPlayer(walker, inward, 1 / 30, world); if (watch([walker.x, walker.y, walker.z])) crossed = step; }
        expect(crossed, `${label} crossing`).toBeGreaterThanOrEqual(0);
        expect(walker.grounded, label).toBe(true);
        // And back out: the street outside the door is open again.
        const outward = { ...inward, moveX: -inward.moveX, moveZ: -inward.moveZ, yaw: portal!.returnAnchor.yaw };
        for (let step = 0; step < 30; step++) stepPlayer(walker, outward, 1 / 30, world);
        expect(insideTavernThreshold(portal!.door, [walker.x, walker.y, walker.z]), `${label} out`).toBe(false);
        expect(walker.grounded, `${label} out`).toBe(true);
      }
  }, 240_000);
});
