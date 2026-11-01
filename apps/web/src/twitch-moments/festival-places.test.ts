import { describe, expect, it } from 'vitest';
import { generateSettlementPlan, terrainHeight } from '@chatdom/world';
import { FESTIVAL, festivalPlacesOf, withFestivalPlaces } from './festival-places';
import type { SpectaclePlaces } from './spectacle';

describe('the festival places of a real town', () => {
  const plan = generateSettlementPlan({ seed: 'willowmere', tier: 'town', firstYear: 2022, year: 2026 });
  const ground = (x: number, z: number) => terrainHeight(plan, x, z);
  const places = festivalPlacesOf(plan, ground);

  it('rings the town outside every lot, the castle and the lake, on the ground', () => {
    const track = places.track!;
    expect(track).toHaveLength(FESTIVAL.ringSamples);
    // Densify the ring and check no point lies inside a lot or the castle's bounds, nor on the water.
    const inside = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
    for (let i = 0; i < track.length; i++) for (let k = 0; k < 4; k++) {
      const a = track[i]!, b = track[(i + 1) % track.length]!, x = a[0] + (b[0] - a[0]) * k / 4, z = a[2] + (b[2] - a[2]) * k / 4;
      expect(plan.reservations.some(r => inside(r.lot, x, z))).toBe(false);
      expect(inside(plan.castle.bounds, x, z)).toBe(false);
      expect(Math.hypot((x - plan.lake.x) / plan.lake.radiusX, (z - plan.lake.z) / plan.lake.radiusZ)).toBeGreaterThan(1.1);
      expect(a[1]).toBeGreaterThanOrEqual(ground(a[0], a[2]) - 1e-9);
    }
  });

  it('lays the lair in the low ground behind the castle, facing the town', () => {
    const lair = places.lair!;
    const homes = plan.homes.map(h => h.position), hz = homes.reduce((s, p) => s + p[2], 0) / homes.length;
    // Willowmere's castle stands north of its homes: the lair is beyond it, lower than the castle hill.
    expect(lair.position[2]).toBeLessThan(plan.castle.bounds.minZ);
    expect(lair.position[1]).toBeLessThan(ground(plan.castle.centre[0], plan.castle.centre[2]) - 6);
    expect(Math.sign(lair.facing[2])).toBe(Math.sign(hz - lair.position[2]));
  });

  it('strings bounded bunting over the market streets and fills only what main leaves empty', () => {
    expect(places.bunting.length).toBe(FESTIVAL.buntingRuns);
    const none: SpectaclePlaces = { sky: () => null, castle: () => null, plaza: () => null, lair: () => null, track: () => null, bunting: () => [], roof: () => null, homes: () => [] };
    const merged = withFestivalPlaces(none, places);
    expect(merged.track()).toBe(places.track);
    const own = withFestivalPlaces({ ...none, lair: () => ({ position: [1, 2, 3], facing: [0, 0, 1] }) }, places);
    expect(own.lair()!.position).toEqual([1, 2, 3]);
    expect(festivalPlacesOf(plan, ground)).toEqual(places);
  });
});
