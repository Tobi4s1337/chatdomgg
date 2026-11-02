import type { Vec3 } from '@chatdom/shared';
import type { SettlementPlan } from '@chatdom/world';

/**
 * The kingdom's map, read from the founded plan alone, the same way on the old land and the grand land. It names
 * places, never people: a home here is a plot and its street, and nothing on it says who lives there. The map's
 * only people are you and your friends, and they come from `people.ts`, never from here.
 */

export type XZ = readonly [number, number];

export interface MapStreet {
  readonly id: string;
  readonly kind: 'main' | 'lane' | 'approach' | 'trail';
  readonly name: string;
  /** Paved width in metres. */
  readonly width: number;
  readonly points: readonly XZ[];
}

export interface MapWater {
  readonly id: string;
  readonly kind: 'lake' | 'pond';
  readonly x: number; readonly z: number; readonly radiusX: number; readonly radiusZ: number;
}

export interface MapStream {
  readonly id: string;
  readonly points: readonly { readonly at: XZ; readonly width: number }[];
}

export interface MapHome {
  /** The public plot id. Never a person. */
  readonly id: string;
  readonly street: string;
  /** The plot's centre and the box of its lot. */
  readonly centre: XZ;
  readonly lot: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  /** Where its approach meets the plot: the front door's step, at street level. */
  readonly door: Vec3;
}

export interface MapPlace {
  readonly id: 'castle' | 'market' | 'forge';
  readonly name: string;
  readonly at: XZ;
}

export interface TownMap {
  /** The plan's layout revision: a map is rebuilt only when this changes. */
  readonly revision: string;
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  /** Open streets only (the ones the town has built), widest first so lanes are painted over the main road's verge. */
  readonly streets: readonly MapStreet[];
  readonly waters: readonly MapWater[];
  readonly streams: readonly MapStream[];
  readonly market: readonly XZ[];
  readonly courts: readonly (readonly XZ[])[];
  readonly castle: {
    readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
    readonly court: readonly XZ[];
    /** Keep, gatehouse, curtain and towers as plan boxes (rotation already applied to the size). */
    readonly modules: readonly { readonly kind: string; readonly centre: XZ; readonly size: XZ }[];
  };
  readonly places: readonly MapPlace[];
  readonly homes: readonly MapHome[];
}

const xz = (point: readonly number[]): XZ => [point[0]!, point[2]!];
const finite = (point: readonly number[]) => point.every(Number.isFinite);

/** The anvil stands on the market's north side (as `foundedAnvilPosition` places it), on both lands. */
export const FORGE_ON_MARKET: XZ = [0, 8];

/** The front step of a home: its approach street's frontage end, or the plot's own position when the plan has none. */
export function homeDoor(plan: Pick<SettlementPlan, 'streets' | 'nodes'>, home: SettlementPlan['homes'][number]): Vec3 {
  const approach = plan.streets.find(street => street.id === home.approachId);
  if (approach && approach.points.length) {
    const front = plan.nodes.find(node => node.kind === 'frontage' && (node.id === approach.from || node.id === approach.to));
    if (front && finite(front.position)) return front.position;
    const first = approach.points[0]!;
    if (finite(first)) return first;
  }
  return home.position;
}

function watersOf(plan: SettlementPlan): MapWater[] {
  const landform = plan.landform as SettlementPlan['landform'] & { waters?: readonly { id: string; x: number; z: number; radiusX: number; radiusZ: number }[] };
  if (landform.version === 2 && Array.isArray(landform.waters) && landform.waters.length) {
    return landform.waters.map((water, index) => ({ id: water.id, kind: index === 0 ? 'lake' : 'pond', x: water.x, z: water.z, radiusX: water.radiusX, radiusZ: water.radiusZ }));
  }
  const lake = plan.lake ?? landform.lake;
  return lake && [lake.x, lake.z, lake.radiusX, lake.radiusZ].every(Number.isFinite) && lake.radiusX > 0 && lake.radiusZ > 0
    ? [{ id: 'lake', kind: 'lake', x: lake.x, z: lake.z, radiusX: lake.radiusX, radiusZ: lake.radiusZ }] : [];
}

function streamsOf(plan: SettlementPlan): MapStream[] {
  const landform = plan.landform as { version: number; streams?: readonly { id: string; points: readonly { position: XZ; width: number }[] }[] };
  if (landform.version !== 2 || !Array.isArray(landform.streams)) return [];
  return landform.streams.filter(stream => stream.points.length >= 2)
    .map(stream => ({ id: stream.id, points: stream.points.map((point: { position: XZ; width: number }) => ({ at: point.position, width: point.width })) }));
}

const WIDTH_ORDER: Record<MapStreet['kind'], number> = { main: 0, lane: 1, trail: 2, approach: 3 };

/** The map of one founded plan. Pure; the same plan always gives an equal map. */
export function townMapFrom(plan: SettlementPlan): TownMap {
  const active = new Set(plan.activeStreetIds);
  const streets = plan.streets.filter(street => active.has(street.id) && street.points.length >= 2)
    .map(street => ({ id: street.id, kind: street.kind, name: street.name, width: street.width, points: street.points.filter(finite).map(xz) }))
    .filter(street => street.points.length >= 2)
    .sort((a, b) => WIDTH_ORDER[a.kind] - WIDTH_ORDER[b.kind] || b.width - a.width || (a.id < b.id ? -1 : 1));
  const modules = plan.castle.modules.map(module => {
    const turned = module.rotation % 2 === 1;
    return { kind: module.kind, centre: xz(module.position), size: [turned ? module.size[2] : module.size[0], turned ? module.size[0] : module.size[2]] as XZ };
  });
  const market = plan.market.boundary;
  const centre = market.length
    ? [market.reduce((sum, point) => sum + point[0], 0) / market.length, market.reduce((sum, point) => sum + point[1], 0) / market.length] as XZ
    : [0, 0] as XZ;
  return {
    revision: plan.revision,
    bounds: { ...plan.bounds },
    streets,
    waters: watersOf(plan),
    streams: streamsOf(plan),
    market,
    courts: plan.courts.map(court => court.boundary),
    castle: { bounds: { ...plan.castle.bounds }, court: plan.castle.court.boundary, modules },
    places: [
      { id: 'castle', name: 'The castle', at: xz(plan.castle.centre) },
      { id: 'market', name: 'The market', at: centre },
      { id: 'forge', name: 'The Forge', at: FORGE_ON_MARKET },
    ],
    homes: plan.homes.map(home => ({
      id: home.id, street: home.street, centre: [(home.lot.minX + home.lot.maxX) / 2, (home.lot.minZ + home.lot.maxZ) / 2] as XZ,
      lot: { minX: home.lot.minX, maxX: home.lot.maxX, minZ: home.lot.minZ, maxZ: home.lot.maxZ }, door: homeDoor(plan, home),
    })),
  };
}

/** One map per plan revision: the plan never changes under a revision, so neither does its map. */
export function createTownMapCache(): (plan: SettlementPlan) => TownMap {
  let last: TownMap | null = null;
  return plan => (last && last.revision === plan.revision ? last : (last = townMapFrom(plan)));
}
