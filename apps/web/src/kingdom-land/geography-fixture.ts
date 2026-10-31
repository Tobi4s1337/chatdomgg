import type { Vec3 } from '@chatdom/shared';
import { foundKingdomGeography, generateSettlementPlan, LAND_FRAME, naturalLandHeight, reservedByGeography,
  waterKeepOut, type KingdomGeography, type KingdomTier, type SettlementPlan } from '@chatdom/world';

type PublicSquare = SettlementPlan['market'];

/**
 * SIMULATED composition for the geography bench only. The founded version 2 land carries today's installed
 * streets and homes, re-seated on the new ground and kept only where they sit honestly on it (dry, clear of
 * sites, within a metre of the ground beneath them) until the new street generator supplies its own town.
 * Never offered as a live or adopted layout.
 */
export interface GeographyFixture { plan: SettlementPlan; land: KingdomGeography; kept: number; dropped: number }

const seat = (value: number) => Math.round(value * 8) / 8;

export function geographyFixture(seed: string, tier: KingdomTier = 'town'): GeographyFixture {
  const config = { seed, tier, firstYear: tier === 'hamlet' ? 2025 : 2022, year: 2026 };
  const installed = generateSettlementPlan(config), land = foundKingdomGeography(config), ground = land.landform;
  const natural = (x: number, z: number) => naturalLandHeight(ground, x, z);
  const inFrame = (x: number, z: number) => x > LAND_FRAME.minX && x < LAND_FRAME.maxX && z > LAND_FRAME.minZ && z < LAND_FRAME.maxZ;
  const level = (points: readonly (readonly [number, number])[], y: number) => points.every(([x, z]) => Math.abs(natural(x, z) - y) <= 1);

  const homes = installed.homes.flatMap(home => {
    const { minX, maxX, minZ, maxZ } = home.lot, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const corners = [[minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ], [cx, cz]] as const;
    if (!corners.every(([x, z]) => inFrame(x, z) && !reservedByGeography(land, x, z, 3))) return [];
    // The whole lot, every 2 m, so a flat foundation never meets its own approach as a step.
    const lot: [number, number][] = [];
    for (let z = minZ; z <= maxZ; z += 2) for (let x = minX; x <= maxX; x += 2) lot.push([x, z]);
    // Its street in front, where the approach meets it, stands near the home's own level too.
    const approach = installed.streets.find(street => street.id === `${home.id}:approach`)?.points.at(-1);
    if (approach) lot.push([approach[0], approach[2]]);
    const y = seat(natural(home.position[0], home.position[2]));
    return level([...corners, ...lot], y) ? [{ ...home, position: [home.position[0], y, home.position[2]] as Vec3 }] : [];
  });
  const reseat = (square: PublicSquare): PublicSquare => {
    const cx = square.boundary.reduce((sum, p) => sum + p[0], 0) / square.boundary.length;
    const cz = square.boundary.reduce((sum, p) => sum + p[1], 0) / square.boundary.length;
    return { ...square, elevation: seat(natural(cx, cz)) };
  };
  const courts = installed.courts.filter(court => homes.some(home => home.courtId === court.id)).map(reseat)
    .filter(court => level(court.boundary, court.elevation));

  // Every metre of a kept street sits on the new ground, dry and well clear of water: only a bridge crosses it.
  const along = (points: readonly Vec3[]) => points.slice(1).flatMap((b, i) => {
    const a = points[i]!, steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2])));
    return Array.from({ length: steps + 1 }, (_, k) => [a[0] + (b[0] - a[0]) * k / steps, a[2] + (b[2] - a[2]) * k / steps] as const);
  });
  const seated = new Map(homes.map(home => [`${home.id}:approach`, home.position[1]]));
  const streets = installed.streets.flatMap(street => {
    if (street.kind === 'approach' && !seated.has(street.id)) return [];
    let points = street.points.map(([x, , z]) => [x, seat(natural(x, z)), z] as Vec3);
    // An approach leaves its home's forecourt at the home's own level and climbs evenly to its street.
    const home = seated.get(street.id);
    if (home !== undefined) {
      const run = points.map((p, i) => i ? Math.hypot(p[0] - points[i - 1]![0], p[2] - points[i - 1]![2]) : 0).map((sum => d => sum += d)(0));
      const end = points.at(-1)![1], total = run.at(-1) || 1;
      points = points.map((p, i) => [p[0], seat(home + (end - home) * run[i]! / total), p[2]] as Vec3);
    }
    const clear = along(points).every(([x, z]) => inFrame(x, z) && !waterKeepOut(ground, x, z, street.width / 2 + 4));
    return clear ? [{ ...street, points }] : [];
  });
  const streetIds = new Set(streets.map(street => street.id));
  const plan: SettlementPlan = {
    ...installed, revision: `land-fixture:${ground.seed.toString(16)}:${homes.length}`, landform: ground,
    homes, reservations: installed.reservations.filter(plot => homes.some(home => home.id === plot.id)), castle: land.castle, lake: ground.lake,
    streets, activeStreetIds: installed.activeStreetIds.filter(id => streetIds.has(id)), courts, market: reseat(installed.market),
    // One 512 m terrain request: the founded frame plus the plan's 16 m margin.
    bounds: { minX: LAND_FRAME.minX - 16, maxX: LAND_FRAME.maxX + 16, minZ: LAND_FRAME.minZ - 16, maxZ: LAND_FRAME.maxZ + 16 },
  };
  return { plan, land, kept: homes.length, dropped: installed.homes.length - homes.length };
}
