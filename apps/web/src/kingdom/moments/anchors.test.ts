import { describe, expect, it } from 'vitest';
import { createHearthHome } from '@chatdom/content';
import type { WindowHouse } from '@chatdom/render';
import { generateSettlementPlan } from '@chatdom/world';
import { bannerMount, doorOf, giftRouteOf, spectaclePlacesOf } from './anchors';

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
  it('uses occupied geometry and the adopted public places for spectacles', () => {
    const plan = generateSettlementPlan({ seed: 'spectacle-anchors', tier: 'hamlet', firstYear: 2025, year: 2026 });
    const base = createHearthHome('hut', 0);
    const blueprint = { ...base, size: [4, 8, 4] as [number, number, number], windows: [], boxes: [
      { from: [0, 0, 0] as [number, number, number], to: [4, 5, 4] as [number, number, number], material: 1 },
      { from: [0, 4, 0] as [number, number, number], to: [4, 5, 4] as [number, number, number], material: 0 },
    ] };
    const house: WindowHouse = { slot: 7, blueprint, position: [10, 2, 20], yaw: 0 };
    const places = spectaclePlacesOf(plan, [house], house);
    expect(places.roof(7)?.[1]).toBe(2 + 4 * .125);
    expect(places.castle()?.crown).toEqual(places.roof(7));
    expect(places.roof(8)).toBeNull();
    expect(places.homes()).toEqual([7]);
    expect(places.plaza()).toEqual(plan.nodes.find(node => node.id === plan.market.nodeId)?.position);
    expect(places.sky()?.centre[0]).toBe((plan.bounds.minX + plan.bounds.maxX) / 2);
    expect(places.lair()).toBeNull(); expect(places.track()).toBeNull(); expect(places.bunting()).toEqual([]);
    expect(spectaclePlacesOf(plan, [], undefined).castle()).toBeNull();
  });

});
