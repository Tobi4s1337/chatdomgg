import { describe, expect, it } from 'vitest';
import { createCastle, MAT } from '@chatdom/content';
import { createKingdomCastle, foundKingdomGeography, KEEP_DOOR_LOCAL_METRES } from '@chatdom/world';
import { createCastleContent } from '../kingdom/castle-content';

describe('kingdom land castle', () => {
  it('anchors the keep door at its actual inner sill', () => {
    const keep = createCastle('tide');
    // The keep's front wall and the opening carved through it, read from the blueprint itself.
    const wall = keep.boxes.find(b => b.material !== MAT.air && b.from[1] === 13 && b.to[2] - b.from[2] === 5 && b.to[0] - b.from[0] > 100)!;
    const door = keep.boxes.find(b => b.material === MAT.air && b.from[1] === wall.from[1]
      && b.from[2] <= wall.from[2] && b.to[2] >= wall.to[2] && b.from[0] > wall.from[0] && b.to[0] < wall.to[0])!;
    expect(door).toBeDefined();
    expect(KEEP_DOOR_LOCAL_METRES).toEqual([(door.from[0] + door.to[0]) / 16, door.from[1] / 8, wall.to[2] / 8]);
    const land = foundKingdomGeography({ seed: 'chatdom', tier: 'town', firstYear: 2022, year: 2026 });
    expect(land.castle).toEqual(createKingdomCastle());
  });

  it('builds the opened court from stock modules at their exact sizes', () => {
    const plan = createKingdomCastle(), { buildings, beaconPosition } = createCastleContent(plan);
    expect(buildings).toHaveLength(plan.modules.length);
    for (const building of buildings) {
      const module = plan.modules.find(m => m.id === building.id)!;
      expect(building.blueprint.size.map(n => n / 8)).toEqual(module.size);
    }
    // Side curtains close the court from front to rear towers without a gap.
    const sides = plan.modules.filter(m => m.id.startsWith('castle:side')).map(m => [m.position[0], m.position[2], m.position[2] - m.size[0]]);
    expect(sides.filter(s => s[0] === -32).map(s => [s[1], s[2]]).sort()).toEqual([[-48, -72], [-72, -84]]);
    expect(beaconPosition[2]).toBeLessThan(plan.court.boundary[0]![1]);
  });
});
