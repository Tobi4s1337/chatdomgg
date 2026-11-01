import { generateSettlementPlan, homeFrame, type SettlementHome, type SettlementPlan, type StreetEdge } from '@chatdom/world';
import type { Vec3 } from '@chatdom/shared';
import type { SimulatedNeighbour } from './history';

/**
 * The town around the growing home, from main's settlement plan: the kingdom as it stands, and the same kingdom one
 * year on with its next quarter. Older plots never move between the two (the plan reserves them), so the new quarter
 * opens beside a town that stays exactly where it was.
 */
export interface GrowingQuarter {
  readonly year: number;
  readonly name: string;
  readonly homes: readonly SettlementHome[];
  /** Streets installed only in the new year, approaches included. */
  readonly streets: readonly StreetEdge[];
  /** Where the quarter's green sits: streets open outward from here. */
  readonly root: Vec3;
  readonly centre: Vec3;
  /** Furthest new street point or lot corner from the root. */
  readonly reach: number;
}
export interface GrowthTown {
  readonly seed: string;
  readonly before: SettlementPlan;
  readonly after: SettlementPlan;
  readonly hero: SettlementHome;
  readonly neighbours: readonly SettlementHome[];
  readonly quarter: GrowingQuarter;
}

export const TOWN_FIRST_YEAR = 2023;

/** Every home is a Hearth home in this kingdom, as `nativeStyle` does for the simulated kingdom. */
function hearth(plan: SettlementPlan): SettlementPlan {
  return { ...plan, homes: plan.homes.map(home => ({ ...home, style: 'hearth' as const })) };
}

export function planGrowthTown(seed: string, year: number): GrowthTown {
  const config = { seed, tier: 'town' as const, firstYear: TOWN_FIRST_YEAR };
  const before = hearth(generateSettlementPlan({ ...config, year }));
  const after = hearth(generateSettlementPlan({ ...config, year: year + 1 }));
  const known = new Set(before.homes.map(home => home.id));
  const fresh = after.homes.filter(home => home.quarterYear === year + 1 && !known.has(home.id));
  const record = after.quarters.find(q => q.year === year + 1);
  if (!record || !fresh.length) throw new Error(`The ${year + 1} quarter has no homes to open.`);
  const root = after.nodes.find(node => node.id === record.rootNodeId)!.position;
  const centre: Vec3 = [fresh.reduce((n, h) => n + h.position[0], 0) / fresh.length, root[1], fresh.reduce((n, h) => n + h.position[2], 0) / fresh.length];
  const active = new Set(before.activeStreetIds);
  const freshIds = new Set(after.activeStreetIds.filter(id => !active.has(id)));
  const streets = after.streets.filter(edge => freshIds.has(edge.id));
  let reach = 0;
  for (const edge of streets) for (const p of edge.points) reach = Math.max(reach, Math.hypot(p[0] - root[0], p[2] - root[2]));
  for (const home of fresh) for (const x of [home.lot.minX, home.lot.maxX]) for (const z of [home.lot.minZ, home.lot.maxZ]) reach = Math.max(reach, Math.hypot(x - root[0], z - root[2]));

  // The new citizen is given a plot in the newest quarter, at the side nearest where the next one will open, with
  // open street before its door (so the house can be seen whole) and the growth edge in the background.
  const nearestFresh = (p: Vec3) => Math.min(...fresh.map(h => Math.hypot(h.position[0] - p[0], h.position[2] - p[2])));
  const candidates = before.homes.filter(home => home.quarterYear === year);
  const blocked = (home: SettlementHome) => before.homes.filter(other => {
    if (other === home) return false;
    const { front, outward } = homeFrame(home), dx = other.position[0] - front[0], dz = other.position[2] - front[2];
    const ahead = dx * outward[0] + dz * outward[2], aside = Math.abs(dx * outward[2] - dz * outward[0]);
    return ahead > 0 && ahead < 20 && aside < 9;
  }).length;
  const score = (home: SettlementHome) => nearestFresh(home.position) + blocked(home) * 40 + Math.abs(home.position[1] - root[1]) * 2;
  const hero = [...candidates].sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id))[0];
  if (!hero) throw new Error(`The ${year} quarter has no plot to give.`);
  const neighbours = before.homes.filter(home => home !== hero)
    .map(home => ({ home, distance: Math.hypot(home.position[0] - hero.position[0], home.position[2] - hero.position[2]) }))
    .filter(item => item.distance < 34).sort((a, b) => a.distance - b.distance).slice(0, 3).map(item => item.home);
  return { seed, before, after, hero, neighbours, quarter: { year: year + 1, name: record.name, homes: fresh, streets, root, centre, reach } };
}

/** Neighbours keep their installed homes as a floor and earn on from there at their own pace. */
export function neighbourHistory(town: GrowthTown): SimulatedNeighbour[] {
  const rates = [.74, .58, .66];
  return town.neighbours.map((home, i) => ({ plotId: home.id, installedTier: home.tier, attendance: rates[i % rates.length]! }));
}
