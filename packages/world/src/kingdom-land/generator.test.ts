import { describe, expect, it } from 'vitest';
import { terrainHeight } from '../layout';
import { polygonDistance } from '../settlement/geometry';
import { settlementTerrainHeight } from '../settlement/terrain';
import type { XZ } from '../settlement/types';
import { foundKingdomTown, LOTS_PER_QUARTER, MARKET_HEART_RADIUS, MARKET_SITE_SIZE, TOWN_STREETS, TownCapacityError } from './generator';
import { foundKingdomGeography, reservedByGeography } from './geography';
import { foundKingdomRoutes } from './routes';
import { waterKeepOut } from './surface';
// The independent geometry audit the v1 settlement is held to.
// @ts-expect-error standalone mjs module
import { audit, compare } from '../../../testing/settlement-audit.mjs';

const area = (polygon: readonly XZ[]) => polygon.reduce((sum, p, k) => {
  const q = polygon[(k + 1) % polygon.length]!;
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;
const centroid = (polygon: readonly XZ[]): XZ => [polygon.reduce((s, p) => s + p[0], 0) / polygon.length, polygon.reduce((s, p) => s + p[1], 0) / polygon.length];

describe('the founded kingdom town', () => {
  it('gathers full street-front lots around a usable square, founded once and grown only by appending', () => {
    const seed = 'chatdom', geography = foundKingdomGeography({ seed, tier: 'town', firstYear: 2024, year: 2026 });
    const town = foundKingdomTown({ seed, tier: 'town', firstYear: 2024, year: 2026 }, geography);
    const { plan, sites } = town;

    // Deterministic, audited like every installed settlement, inside one 512 m terrain request.
    expect(foundKingdomTown({ seed, tier: 'town', firstYear: 2024, year: 2026 }, geography).plan.revision).toBe(plan.revision);
    expect(audit(plan).failures).toEqual([]);
    expect(plan.bounds.maxX - plan.bounds.minX).toBeLessThanOrEqual(512);
    expect(plan.bounds.maxZ - plan.bounds.minZ).toBeLessThanOrEqual(512);
    // The generator's graded town stays within what the terrain skin can follow: each 1 m patch corner within
    // 1.75 m of its 0.5 m column. The adopted picture-land layer deliberately adds cliffs outside town supports.
    let steep = 0;
    for (let z = plan.bounds.minZ; z < plan.bounds.maxZ; z++) for (let x = plan.bounds.minX; x < plan.bounds.maxX; x++) {
      const column = settlementTerrainHeight(plan, x + .25, z + .25);
      if ([[0, 0], [0, 1], [1, 1], [1, 0]].some(([dx, dz]) => Math.abs(settlementTerrainHeight(plan, x + dx!, z + dz!) - column) > 1.75)) steep++;
    }
    expect(steep).toBe(0);

    // Adoption keeps supports on that graded surface. Sample future lot corners/centres, market boundary/centre,
    // and active road vertices/verge edges, checking their metre-patch corners against the actual column sample.
    const supports = new Map<string, XZ>();
    const support = (x: number, z: number) => { const p: XZ = [Math.floor(x), Math.floor(z)]; supports.set(p.join(','), p); };
    for (const { lot } of plan.reservations) {
      for (const x of [lot.minX, lot.maxX]) for (const z of [lot.minZ, lot.maxZ]) support(x, z);
      support((lot.minX + lot.maxX) / 2, (lot.minZ + lot.maxZ) / 2);
    }
    for (const [x, z] of [...plan.market.boundary, centroid(plan.market.boundary)]) support(x, z);
    const active = new Set(plan.activeStreetIds);
    for (const edge of plan.streets) if (active.has(edge.id)) edge.points.forEach((p, k) => {
      const a = edge.points[Math.max(0, k - 1)]!, b = edge.points[Math.min(edge.points.length - 1, k + 1)]!;
      const length = Math.hypot(b[0] - a[0], b[2] - a[2]), half = edge.width / 2 + edge.verge;
      for (const across of [-half, 0, half]) support(p[0] + (b[2] - a[2]) / length * across, p[2] - (b[0] - a[0]) / length * across);
    });
    let movedSupports = 0, steepSupports = 0;
    for (const [x, z] of supports.values()) {
      const column = terrainHeight(plan, x + .25, z + .25);
      const corners = [[0, 0], [0, 1], [1, 1], [1, 0]].map(([dx, dz]) => {
        const px = x + dx!, pz = z + dz!, height = terrainHeight(plan, px, pz);
        if (height !== settlementTerrainHeight(plan, px, pz)) movedSupports++;
        return height;
      });
      if (corners.some(height => Math.abs(height - column) > 1.75)) steepSupports++;
    }
    expect(movedSupports).toBe(0);
    expect(steepSupports).toBe(0);

    // Founded once: a hamlet is the town's exact prefix and a later year only appends a quarter.
    const hamlet = foundKingdomTown({ seed, tier: 'hamlet', firstYear: 2025, year: 2026 }, geography).plan;
    const twoYears = foundKingdomTown({ seed, tier: 'town', firstYear: 2025, year: 2026 }, geography).plan;
    const grown = foundKingdomTown({ seed, tier: 'town', firstYear: 2025, year: 2027 }, geography).plan;
    expect(audit(hamlet).failures).toEqual([]);
    expect(compare(hamlet, twoYears, 'tier growth')).toEqual([]);
    expect(compare(twoYears, grown, 'year growth')).toEqual([]);
    expect(hamlet.reservations).toEqual(twoYears.reservations);
    // A town larger than the land holds is refused out loud, never shrunk or silently dropped.
    expect(() => foundKingdomTown({ seed, tier: 'town', firstYear: 2016, year: 2026 }, geography)).toThrow(TownCapacityError);
    expect(town.capacity).toBeGreaterThanOrEqual(3 * LOTS_PER_QUARTER);

    // Homes belong to the street: full lots, canonical ids and slots, every orientation, on dry open ground.
    plan.reservations.forEach(plot => {
      expect(plot.id).toBe(`plot:${plot.quarterYear}:${plot.ordinal}`);
      const across = [plot.lot.maxX - plot.lot.minX, plot.lot.maxZ - plot.lot.minZ].sort((a, b) => a - b);
      expect(across).toEqual([8, 16]);
      for (const x of [plot.lot.minX, plot.lot.maxX]) for (const z of [plot.lot.minZ, plot.lot.maxZ]) {
        expect(waterKeepOut(plan.landform, x, z, 0)).toBe(false);
        expect(reservedByGeography(geography, x, z, 0)).toBe(false);
      }
    });
    plan.homes.forEach(home => expect(home.slot).toBe((home.quarterYear - 2024) * 1024 + home.ordinal));
    expect(new Set(plan.reservations.map(plot => plot.rotation)).size).toBe(4);
    const lake = plan.landform.waters.find(body => body.id === 'lake')!;
    const tide = plan.homes.filter(home => home.style === 'tide'
      && waterKeepOut({ ...plan.landform, streams: [], waters: [lake] }, home.position[0], home.position[2], 48));
    expect(tide.length).toBeGreaterThanOrEqual(6);

    // Streets: mains and lanes at their widths, Crown Road climbing to the gate with a switchback.
    for (const edge of plan.streets) if (edge.kind === 'main' || edge.kind === 'lane') expect(edge.width).toBe(TOWN_STREETS[edge.kind].width);
    const crown = plan.streets.filter(edge => edge.name === 'Crown Road').flatMap(edge => edge.points);
    expect(crown.at(-1)).toEqual(plan.nodes.find(node => node.id === plan.castle.gateNodeId)!.position);
    const heading = (k: number) => { const a = crown[k]!, b = crown[k + 6]!, d = Math.hypot(b[0] - a[0], b[2] - a[2]); return [(b[0] - a[0]) / d, (b[2] - a[2]) / d]; };
    const reverses = crown.slice(0, -40).some((_, k) => crown.slice(k + 20, -6).some((__, j) => {
      const u = heading(k), v = heading(k + 20 + j); return u[0]! * v[0]! + u[1]! * v[1]! < -.85;
    }));
    expect(reverses).toBe(true);

    // The square: irregular, roughly 30×24 m or a little more, met by Crown Road and at least three streets.
    const { boundary } = plan.market, xs = boundary.map(p => p[0]), zs = boundary.map(p => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(28);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(22);
    expect(area(boundary)).toBeGreaterThan(30 * 24 * .75);
    const approaches = plan.streets.filter(edge => edge.kind !== 'approach' && (edge.from === 'market' || edge.to === 'market'));
    expect(approaches.length).toBeGreaterThanOrEqual(4);
    expect(approaches.some(edge => edge.name === 'Crown Road')).toBe(true);

    // Its sites are real, separate footprints on its floor, around a clear heart at least 12 m across.
    expect(sites.map(site => site.id).sort()).toEqual(['market:bench:0', 'market:bench:1', 'market:forge', 'market:pad:0', 'market:pad:1',
      'market:stall:0', 'market:stall:1', 'market:statue', 'market:well']);
    expect(MARKET_HEART_RADIUS * 2).toBeGreaterThanOrEqual(12);
    const heart = plan.nodes.find(node => node.id === 'market')!.position;
    for (const site of sites) {
      const size = MARKET_SITE_SIZE[site.id.split(':')[1] as keyof typeof MARKET_SITE_SIZE];
      expect(Math.abs(area(site.footprint))).toBeCloseTo(size[0] * size[1], 6);
      for (const p of site.footprint) {
        expect(polygonDistance(boundary, ...p)).toBeLessThan(0);
        expect(Math.hypot(p[0] - heart[0], p[1] - heart[2])).toBeGreaterThanOrEqual(MARKET_HEART_RADIUS);
      }
      for (const other of sites) if (other !== site) for (const p of other.footprint) expect(polygonDistance(site.footprint, ...p)).toBeGreaterThan(0);
    }
    const statue = centroid(sites.find(site => site.id === 'market:statue')!.footprint);
    expect(Math.hypot(statue[0] - heart[0], statue[1] - heart[2])).toBeGreaterThan(MARKET_HEART_RADIUS);
    // The Forge yard stands on the rim with homes behind it.
    const forge = centroid(sites.find(site => site.id === 'market:forge')!.footprint), forgeReach = Math.hypot(forge[0] - heart[0], forge[1] - heart[2]);
    const behind = plan.reservations.filter(plot => Math.hypot(plot.position[0] - forge[0], plot.position[2] - forge[1]) < 30
      && Math.hypot(plot.position[0] - heart[0], plot.position[2] - heart[2]) > forgeReach + 8);
    expect(behind.length).toBeGreaterThanOrEqual(2);

    // The walks LD04 founds connect onto this town's own streets.
    expect(() => foundKingdomRoutes(geography, plan)).not.toThrow();
  }, 120_000);
});
