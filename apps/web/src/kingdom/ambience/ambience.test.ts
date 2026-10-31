import { expect, it, vi } from 'vitest';
import { generateSettlementPlan } from '@chatdom/world';
import { createKingdomAmbience, sampleKingdomAmbience } from './index';

it('follows the adopted v1 shore and current audible clock without replaying missed ambience', () => {
  const plan = generateSettlementPlan({ seed: 'willowmere', tier: 'hamlet', firstYear: 2025, year: 2026 });
  expect(plan.landform.version).toBe(1);
  const { lake, bounds } = plan;
  const near = [lake.x + lake.radiusX + 1, lake.level + 1.7, lake.z] as const;
  const water = sampleKingdomAmbience(plan, near, [-1, 0, 0]);
  expect(water.water).toBe(1);
  expect(water.waterPan).toBeGreaterThan(0);
  expect(sampleKingdomAmbience(plan, near, [1, 0, 0]).waterPan).toBeCloseTo(-water.waterPan);
  const minorShore = sampleKingdomAmbience(plan,
    [lake.x, lake.level + 1.7, lake.z + lake.radiusZ + 1], [0, 0, -1]);
  expect(minorShore.water).toBe(1);
  expect(minorShore.waterPan).toBeGreaterThan(0);
  expect(sampleKingdomAmbience(plan, [near[0], lake.level + 40, near[2]], [1, 0, 0]).water).toBe(0);
  expect(sampleKingdomAmbience(plan, [0, 1.7, 8], [1, 0, 0]).water).toBe(0);
  expect(sampleKingdomAmbience(plan, [bounds.maxX + 30, 1.7, bounds.maxZ + 30], [1, 0, 0]).wind)
    .toBeGreaterThan(sampleKingdomAmbience(plan, [0, 1.7, 8], [1, 0, 0]).wind);
  const before = sampleKingdomAmbience(plan, [near[0] + 10, near[1], near[2]], [1, 0, 0]);
  const after = sampleKingdomAmbience(plan, [near[0] + 10.001, near[1], near[2]], [1, 0, 0]);
  expect(Math.abs(before.water - after.water)).toBeLessThan(0.001);

  // The scene supplies this frame clock and cancels active voices when it becomes inaudible.
  const play = vi.fn(() => true);
  const ambience = createKingdomAmbience(play);
  ambience.update(0, water, false);
  expect(play).not.toHaveBeenCalled();
  ambience.update(100, water, true);
  ambience.update(1699, water, true);
  expect(play).toHaveBeenCalledTimes(1);
  ambience.update(1700, water, true);
  expect(play).toHaveBeenCalledTimes(2);
  ambience.update(1800, water, false);
  ambience.update(1900, water, true);
  expect(play).toHaveBeenCalledTimes(2);
  ambience.update(10_000, water, false);
  ambience.update(100_000, after, true);
  ambience.update(100_001, after, true);
  expect(play).toHaveBeenCalledTimes(3);
  play.mockReturnValue(false);
  ambience.update(101_600, after, true);
  ambience.update(101_601, after, true);
  expect(play).toHaveBeenCalledTimes(4);
  ambience.dispose();
  ambience.update(200_000, water, true);
  expect(play).toHaveBeenCalledTimes(4);
});
