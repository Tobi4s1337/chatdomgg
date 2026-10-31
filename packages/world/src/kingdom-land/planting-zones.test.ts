import { describe, expect, it } from 'vitest';
import { polygonDistance, rectangleDistance, segmentProjection } from '../settlement/geometry';
import { generateSettlementPlan } from '../settlement/generator';
import type { XZ } from '../settlement/types';
import { foundKingdomGeography, signedArea } from './geography';
import { CLEARING_CROWN_MARGIN, CLEARING_GAP, CROWN_REACH, foundPlantingZones, LANDMARK_CROWN, TRUNK_CLEARANCE } from './planting-zones';
import { naturalLandHeight, waterKeepOut } from './surface';

/** Every 2 m lattice point inside an outline: where a trunk could be planted. */
const inside = (outline: readonly XZ[]) => {
  const xs = outline.map(p => p[0]), zs = outline.map(p => p[1]), points: XZ[] = [];
  for (let z = Math.ceil(Math.min(...zs)); z <= Math.max(...zs); z += 2) for (let x = Math.ceil(Math.min(...xs)); x <= Math.max(...xs); x += 2)
    if (polygonDistance(outline, x, z) < 0) points.push([x, z]);
  return points;
};

describe('kingdom planting zones', () => {
  it('frames the land with woods whose crowns keep clear of the whole founded town, its places and views', () => {
    const seed = 'chatdom', town = generateSettlementPlan({ seed, tier: 'town', firstYear: 2022, year: 2026 });
    const land = foundKingdomGeography({ seed, tier: 'town', firstYear: 2022, year: 2026 });
    const plan = foundPlantingZones(land, town);
    // Founded once: the hamlet's geography with the same complete reservations plants exactly the same woods.
    expect(foundPlantingZones(foundKingdomGeography({ seed, tier: 'hamlet', firstYear: 2025, year: 2026 }), town)).toEqual(plan);

    expect(new Set(plan.treeZones.map(zone => zone.kind))).toEqual(new Set(Object.keys(CROWN_REACH)));
    expect(new Set(plan.treeZones.map(zone => zone.id)).size).toBe(plan.treeZones.length);
    const { forest, lookout } = land.places, clearing = forest.clearing;
    const oak = plan.landmarks.find(tree => tree.id === 'elder-oak')!, pine = plan.landmarks.find(tree => tree.id === 'summit-pine')!;
    expect(oak.position).toEqual(forest.oak);
    const hill = land.landform.hills.find(item => item.id === 'lookout')!;
    expect(Math.hypot(pine.position[0] - hill.centre[0], pine.position[2] - hill.centre[1])).toBeLessThan(hill.plateau);
    expect(pine.position[1]).toBeCloseTo(naturalLandHeight(land.landform, pine.position[0], pine.position[2]), 1);
    expect(clearing.radius).toBeGreaterThanOrEqual(9.6);
    const gap = plan.sightlines.find(view => view.id === 'clearing-beacon')!;

    // Every keep-out as a signed margin a planted trunk must keep; collect the breaches, then assert once.
    const segments = (points: readonly (readonly number[])[], y: 0 | 2) => points.slice(1).map((b, k) => [[points[k]![0]!, points[k]![y]!], [b[0]!, b[y]!]] as [XZ, XZ]);
    const crownRules: { name: string; margin: (x: number, z: number) => number }[] = [
      ...town.reservations.map(plot => ({ name: plot.id, margin: (x: number, z: number) => rectangleDistance(plot.lot, x, z) })),
      ...town.streets.flatMap(street => segments(street.points, 2).map(([a, b]) => ({ name: street.id, margin: (x: number, z: number) => segmentProjection(a, b, x, z).distance - street.width / 2 - street.verge }))),
      ...land.sites.map(site => ({ name: site.id, margin: (x: number, z: number) => polygonDistance(site.footprint, x, z) })),
      { name: 'clearing', margin: (x, z) => Math.hypot(x - clearing.centre[0], z - clearing.centre[2]) - clearing.radius - CLEARING_CROWN_MARGIN },
      ...plan.landmarks.map(tree => ({ name: tree.id, margin: (x: number, z: number) => Math.hypot(x - tree.position[0], z - tree.position[2]) - LANDMARK_CROWN[tree.id] })),
      // The beacon gap stays at least 8 m wide between crowns, all the way out of the woods.
      { name: 'beacon gap', margin: (x, z) => segmentProjection(gap.from, gap.to, x, z).distance - CLEARING_GAP / 2 },
    ];
    const trails = [...segments(lookout.trail, 2), ...segments(forest.path, 2)];
    const breaches: string[] = [], seen = new Map<string, XZ[]>();
    for (const zone of plan.treeZones) {
      expect(signedArea(zone.outline), zone.id).toBeGreaterThan(0);
      const reach = CROWN_REACH[zone.kind], trunks = inside(zone.outline);
      for (const [x, z] of trunks) {
        // Crowns clear every full future lot, street, site, the clearing, the landmarks and the gap.
        for (const rule of crownRules) if (rule.margin(x, z) < reach) breaches.push(`${zone.id} at ${x},${z}: crown over ${rule.name}`);
        // Trunks stand clear of water and of the trails crowns may arch over.
        if (waterKeepOut(land.landform, x, z, TRUNK_CLEARANCE)) breaches.push(`${zone.id} at ${x},${z}: trunk by water`);
        if (trails.some(([a, b]) => segmentProjection(a, b, x, z).distance <= 1.25 + TRUNK_CLEARANCE)) breaches.push(`${zone.id} at ${x},${z}: trunk on a trail`);
      }
      seen.set(zone.id, trunks);
    }
    expect(breaches.slice(0, 12)).toEqual([]);
    // Zones never overlap, and the woods are real masses rather than a sprinkle.
    const owner = new Map<string, string>();
    const overlaps: string[] = [];
    for (const [id, trunks] of seen) for (const [x, z] of trunks) { if (owner.has(`${x},${z}`)) overlaps.push(`${id} over ${owner.get(`${x},${z}`)}`); owner.set(`${x},${z}`, id); }
    expect(overlaps).toEqual([]);
    const area = (kind: string) => plan.treeZones.filter(zone => zone.kind === kind).reduce((sum, zone) => sum + signedArea(zone.outline), 0);
    expect(area('forest-wall')).toBeGreaterThan(15_000);
    expect(area('ridge')).toBeGreaterThan(3_000);
    expect(plan.treeZones.filter(zone => zone.kind === 'grove').length).toBeGreaterThanOrEqual(3);
  }, 120_000);
});
