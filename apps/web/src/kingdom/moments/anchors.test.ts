import { describe, expect, it } from 'vitest';
import { createHearthHome } from '@chatdom/content';
import type { WindowHouse } from '@chatdom/render';
import { generateSettlementPlan } from '@chatdom/world';
import { bannerMount, doorOf, giftRouteOf } from './anchors';

describe('kingdom moment anchors', () => {
  it('does not invent a doorstep or banner when the actual front portal has been filled', () => {
    const blueprint = createHearthHome('hut', 0);
    const house: WindowHouse = { slot: 1, blueprint, position: [3, 2, 5], yaw: 0 };
    expect(doorOf(house)).not.toBeNull();
    const filled: WindowHouse = { ...house, blueprint: { ...blueprint, id: 'custom-filled', boxes: [...blueprint.boxes,
      { from: [0, 0, Math.floor(blueprint.size[2] / 2)], to: [blueprint.size[0], 24, blueprint.size[2]], material: 1 }] } };
    expect(doorOf(filled)).toBeNull();
    expect(bannerMount(filled)).toBeNull();
  });
  it('routes along the settlement’s own active streets', () => {
    const plan = generateSettlementPlan({ seed: 'moment-route-test', tier: 'hamlet', firstYear: 2025, year: 2026 });
    const route = giftRouteOf(plan);
    expect(route).not.toBeNull();
    const market = plan.nodes.find(n => n.id === plan.market.nodeId)!.position;
    expect(route!.inbound.at(-1)).toEqual(market);
    expect(route!.outbound[0]).toEqual(market);
    const points = new Set(plan.streets.filter(s => plan.activeStreetIds.includes(s.id)).flatMap(s => s.points.map(p => p.join(','))));
    for (const point of [...route!.inbound, ...route!.outbound]) expect(points.has(point.join(','))).toBe(true);
  });
});
