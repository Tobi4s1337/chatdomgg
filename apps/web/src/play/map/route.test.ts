import { describe, expect, it } from 'vitest';
import { generateSettlementPlan, type SettlementPlan } from '@chatdom/world';
import oldTown from '../../../../realm/src/founded/artifacts/simulated-town.scene.json';
import { nearestOnStreets, routeHome, streetGraph, trailStops } from './route';
import { homeDoor, townMapFrom } from './town';

/**
 * The lantern path home follows the real streets to the right door, on both lands: the old land's adopted plan and the
 * grand land's founding (Willowmere, tobi4s_, as the walk's solids tests found it).
 */
const oldPlan = (oldTown as unknown as { plan: SettlementPlan }).plan;
function grandPlan(): SettlementPlan {
  const config = { seed: 'tobi4s_', tier: 'town', firstYear: 2019, year: 2026 } as const;
  try { return generateSettlementPlan(config); } catch { return generateSettlementPlan({ ...config, firstYear: 2022 }); }
}

/** Distance from (x, z) to the nearest open street. */
const graphs = new WeakMap<SettlementPlan, ReturnType<typeof streetGraph>>();
function offStreets(plan: SettlementPlan, x: number, z: number): number {
  let graph = graphs.get(plan);
  if (!graph) graphs.set(plan, graph = streetGraph(plan));
  return nearestOnStreets(graph, x, z)?.distance ?? Infinity;
}

for (const [name, plan] of [['the old land', oldPlan], ['the grand land', grandPlan()]] as const) {
  describe(`the way home on ${name}`, () => {
    const graph = streetGraph(plan);
    // Several homes spread through the town, and starts at the market, the castle gate and a far corner.
    const homes = [0, 17, 61, 118, 179, plan.homes.length - 1].map(index => plan.homes[Math.min(index, plan.homes.length - 1)]!);
    const gate = plan.nodes.find(node => node.id === plan.castle.gateNodeId)!.position;
    const starts: [string, [number, number, number]][] = [
      ['the market', [2, plan.market.elevation, 10]],
      ['the castle gate', [gate[0] + 1, gate[1], gate[2] + 1]],
      ['another home', [...homeDoor(plan, plan.homes[Math.floor(plan.homes.length / 2)]!)] as [number, number, number]],
    ];

    for (const home of homes) for (const [where, feet] of starts) {
      it(`walks from ${where} to ${home.id} along the streets to its own door`, () => {
        const route = routeHome(plan, graph, feet, home.id);
        expect(route, 'a route').not.toBeNull();
        const door = homeDoor(plan, home);
        // It ends at this home's door, nobody else's.
        expect(route!.door).toEqual(door);
        expect(route!.points[route!.points.length - 1]).toEqual(door);
        const closest = plan.homes.map(other => ({ id: other.id, d: Math.hypot(homeDoor(plan, other)[0] - door[0], homeDoor(plan, other)[2] - door[2]) }))
          .sort((a, b) => a.d - b.d)[0]!;
        expect(closest.id).toBe(home.id);
        // Every point lies on an open street, and so does every step between them (sampled each metre).
        for (let i = 1; i < route!.points.length; i++) {
          const a = route!.points[i - 1]!, b = route!.points[i]!, steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2])));
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            expect(offStreets(plan, a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t)).toBeLessThan(.05);
          }
        }
        // It starts on the street nearest you and is never shorter than the crow flies.
        expect(Math.hypot(route!.points[0]![0] - feet[0], route!.points[0]![2] - feet[2])).toBeCloseTo(route!.offStreet, 6);
        expect(route!.length + route!.offStreet + 1e-6).toBeGreaterThanOrEqual(Math.hypot(door[0] - feet[0], door[2] - feet[2]));
        // The last street is the home's own approach, which bears its street's name.
        expect(route!.streets[route!.streets.length - 1]).toBe(plan.streets.find(street => street.id === home.approachId)!.name);
      });
    }

    it('takes the shortest way, not merely a way', () => {
      // From the market to a home, the route is no longer than the walk along any single neighbour's route plus the
      // street between the two doors (a loose but honest bound that a wandering search breaks).
      const a = plan.homes[3]!, b = plan.homes[4]!;
      const feet: [number, number, number] = [0, plan.market.elevation, 10];
      const toA = routeHome(plan, graph, feet, a.id)!, toB = routeHome(plan, graph, feet, b.id)!;
      const between = routeHome(plan, graph, [...toA.door] as [number, number, number], b.id)!;
      expect(toB.length).toBeLessThanOrEqual(toA.length + between.length + between.offStreet + 1e-6);
    });

    it('walks straight along your own approach when you are already on it', () => {
      const home = homes[1]!, approach = plan.streets.find(street => street.id === home.approachId)!;
      const mid = approach.points[Math.floor(approach.points.length / 2)]!;
      const route = routeHome(plan, graph, [mid[0], mid[1], mid[2]], home.id)!;
      expect(route.streets).toEqual([approach.name]);
      expect(route.length).toBeLessThan(approach.points.length * 1.5);
    });

    it('sets lanterns beside the street, every few metres, toward the door', () => {
      const home = homes[2]!;
      const route = routeHome(plan, graph, starts[0]![1], home.id)!;
      const stops = trailStops(route, 7, 1.6);
      expect(stops.length).toBeGreaterThanOrEqual(Math.floor(route.length / 7) - 1);
      for (const stop of stops) expect(offStreets(plan, stop.position[0], stop.position[2])).toBeLessThan(1.65);
      for (let i = 1; i < stops.length; i++) expect(stops[i]!.at - stops[i - 1]!.at).toBeCloseTo(7, 6);
      // Alternate sides of the street.
      if (stops.length > 2) {
        const side = (i: number) => {
          const s = stops[i]!, n = nearestOnStreets(graph, s.position[0], s.position[2])!;
          return Math.sign((s.position[0] - n.point[0]) * -s.forward[1] + (s.position[2] - n.point[2]) * s.forward[0]);
        };
        expect(side(0)).not.toBe(side(1));
      }
    });

    it('knows nothing of an unknown plot', () => {
      expect(routeHome(plan, graph, [0, 0, 0], 'plot:none')).toBeNull();
    });

    it('draws the map of the same plan the same way', () => {
      const map = townMapFrom(plan);
      expect(map).toEqual(townMapFrom(plan));
      expect(map.streets.length).toBe(plan.activeStreetIds.filter(id => plan.streets.some(street => street.id === id)).length);
      expect(map.homes.length).toBe(plan.homes.length);
      expect(map.places.map(place => place.id)).toEqual(['castle', 'market', 'forge']);
      // A home on the map is a plot and its street: nothing on it names a person.
      for (const home of map.homes) expect(Object.keys(home).sort()).toEqual(['centre', 'door', 'id', 'lot', 'street']);
    });
  });
}
