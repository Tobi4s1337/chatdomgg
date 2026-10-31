import { expect, it } from 'vitest';
import { generateSettlementPlan, samplePublicGround, terrainHeight } from '@chatdom/world';
import { placeMarketContent, placeSettlementContent } from './settlement-content';
import { createCastleContent } from './castle-content';
import { planShoreDressing } from './shore-dressing';
import { sampleTerrainTriangles } from './terrain-worker';

it('places deterministic bank roots and wet lilies clear of public ground and occupied geometry', () => {
  const plan = generateSettlementPlan({ seed: 'willowmere', tier: 'hamlet', firstYear: 2025, year: 2026 });
  const { houses, props } = placeSettlementContent(plan.homes, (x, z) => terrainHeight(plan, x, z));
  const occupied = [...houses, ...props, ...placeMarketContent(plan.market), ...createCastleContent(plan.castle).buildings];
  const pieces = planShoreDressing(plan, occupied);
  expect(pieces).toEqual(planShoreDressing(plan, occupied));
  expect(pieces.filter(p => p.kind === 'reeds').length).toBeGreaterThan(3);
  expect(pieces.filter(p => p.kind === 'lilies').length).toBeGreaterThan(1);
  for (const piece of pieces) {
    const [x, z] = piece.centre;
    const ground = sampleTerrainTriangles((a, b) => terrainHeight(plan, a, b), x, z);
    expect((samplePublicGround(plan, x, z)?.reservedDistance ?? Infinity)).toBeGreaterThanOrEqual(1);
    if (piece.kind === 'reeds') expect(piece.position[1]).toBeCloseTo(ground - .04);
    else { expect(ground).toBeLessThan(plan.lake.level); expect(piece.position[1]).toBeGreaterThan(plan.lake.level); }
  }
  const town = generateSettlementPlan({ seed: 'willowmere', tier: 'town', firstYear: 2022, year: 2026 });
  const townContent = placeSettlementContent(town.homes, (x, z) => terrainHeight(town, x, z));
  const townPieces = planShoreDressing(town, [...townContent.houses, ...townContent.props, ...placeMarketContent(town.market), ...createCastleContent(town.castle).buildings]);
  expect(townPieces.some(p => p.kind === 'reeds')).toBe(true);
  expect(townPieces.some(p => p.kind === 'lilies')).toBe(true);
  const first = pieces[0]!;
  const blocked = planShoreDressing(plan, [{ blueprint: first.blueprint, position: first.position, yaw: first.yaw }]);
  expect(blocked.some(p => Math.hypot(p.centre[0] - first.centre[0], p.centre[1] - first.centre[1]) < 1)).toBe(false);
});
