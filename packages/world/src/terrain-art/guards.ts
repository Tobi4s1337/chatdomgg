import { sampleGenesisSurface } from '../genesis/surface';
import { sampleLandWater } from '../kingdom-land/surface';
import { expandBounds, pointBounds, polygonDistance, rectangleDistance, segmentProjection, SpatialIndex, transformCardinalPoint } from '../settlement/geometry';
import type { BoundsXZ, PublicGroundSample, SettlementPlan, XZ } from '../settlement/types';
import type { TerrainArtGuard, TerrainArtProtection } from './types';

/**
 * Guards: every footprint the candidate must leave on the authoritative ground. All of them come from the
 * plan itself or the caller's public-ground query. Future streets, unbuilt reservations, inactive courts
 * and every water body count as well as the built town, so later growth never meets carved land.
 */

/** Dry bank kept beyond every wet edge, matching the six metres Genesis holds for bridge landings. */
export const WATER_BANK = 6;
/** Extra clearance around the castle's outer bounds for its curtain footings and gate apron. */
const CASTLE_APRON = 2;
/** A lobed shore reaches at most this factor beyond its base ellipse (the 3/5/7-lobe harmonics sum to 1.21). */
const SHORE_LOBE = 1.25;

interface Footprint {
  guard: Exclude<TerrainArtGuard, 'public-ground' | 'water' | 'none'>;
  distance(x: number, z: number): number;
}
interface Channel { a: XZ; b: XZ; half: number }

export interface Guards {
  /** Nearest guard within `reach` metres; 'none' (distance `reach`) beyond it. */
  protection(x: number, z: number): TerrainArtProtection;
  /** Signed metres to the nearest wet edge (conservative: never farther than the truth), or Infinity beyond `waterReach`. */
  waterDistance(x: number, z: number): number;
  /** Water level governing a patch, or null on dry land. */
  waterLevel(x: number, z: number): number | null;
}

export function createGuards(plan: SettlementPlan, publicGround: (x: number, z: number) => PublicGroundSample | undefined, reach: number, waterReach: number): Guards {
  const footprints = new SpatialIndex<Footprint>(16);
  const add = (bounds: BoundsXZ, footprint: Footprint): void => footprints.add(expandBounds(bounds, reach + 1), footprint);

  // Every planned street, including routes not yet opened: the land must never displace a future road.
  for (const street of plan.streets) {
    const half = street.width / 2 + street.verge;
    for (let i = 1; i < street.points.length; i++) {
      const a: XZ = [street.points[i - 1]![0], street.points[i - 1]![2]], b: XZ = [street.points[i]![0], street.points[i]![2]];
      add(expandBounds(pointBounds([a, b]), half), { guard: 'street', distance: (x, z) => segmentProjection(a, b, x, z).distance - half });
    }
  }
  for (const square of [plan.market, plan.castle.court, ...plan.courts]) {
    const boundary = square.boundary;
    add(pointBounds(boundary), { guard: 'square', distance: (x, z) => polygonDistance(boundary, x, z) });
  }
  // Built homes first; a reservation repeating a home's lot never hides that it is a home.
  for (const home of plan.homes) { const lot = home.lot; add(lot, { guard: 'home', distance: (x, z) => rectangleDistance(lot, x, z) }); }
  for (const reservation of plan.reservations) { const lot = reservation.lot; add(lot, { guard: 'reservation', distance: (x, z) => rectangleDistance(lot, x, z) }); }
  const castle = plan.castle.bounds;
  add(expandBounds(castle, CASTLE_APRON), { guard: 'castle', distance: (x, z) => rectangleDistance(castle, x, z) - CASTLE_APRON });
  for (const module of plan.castle.modules) {
    const corners: XZ[] = [];
    for (const lx of [0, module.size[0]]) for (const lz of [0, module.size[2]]) {
      const p = transformCardinalPoint(module.position, module.rotation, [lx, 0, lz]); corners.push([p[0], p[2]]);
    }
    const bounds = pointBounds(corners);
    add(expandBounds(bounds, CASTLE_APRON), { guard: 'castle', distance: (x, z) => rectangleDistance(bounds, x, z) - CASTLE_APRON });
  }

  // Water: the plan's exact samplers, and a conservative estimate that reaches past their bank envelopes.
  const landform = plan.landform, surface = plan.genesisSurface;
  const bodies = [landform.lake, ...(landform.version === 2 ? landform.waters : [])];
  const channels = new SpatialIndex<Channel>(32);
  if (landform.version === 2) for (const stream of landform.streams) for (let i = 1; i < stream.points.length; i++) {
    const p = stream.points[i - 1]!, q = stream.points[i]!, half = Math.max(p.width, q.width) / 2;
    channels.add(expandBounds(pointBounds([p.position, q.position]), half + waterReach + 1), { a: p.position, b: q.position, half });
  }
  const waterDistance = (x: number, z: number): number => {
    let distance = Infinity;
    if (surface) distance = sampleGenesisSurface(surface, x, z).shoreDistance;
    else { const sample = sampleLandWater(landform, x, z); if (sample) distance = sample.shoreDistance; }
    for (const body of bodies) {
      const q = Math.hypot((x - body.x) / body.radiusX, (z - body.z) / body.radiusZ);
      distance = Math.min(distance, (q / SHORE_LOBE - 1) * Math.min(body.radiusX, body.radiusZ));
    }
    for (const channel of channels.at(x, z)) distance = Math.min(distance, segmentProjection(channel.a, channel.b, x, z).distance - channel.half);
    return distance > waterReach ? Infinity : distance;
  };
  const waterLevel = (x: number, z: number): number | null => {
    const sample = sampleLandWater(landform, x, z);
    if (sample) return sample.surface;
    if (!surface) return null;
    const genesis = sampleGenesisSurface(surface, x, z);
    return genesis.waterLevel ?? (genesis.shoreDistance < WATER_BANK ? 0 : null);
  };

  const protection = (x: number, z: number): TerrainArtProtection => {
    let distance = reach, guard: TerrainArtGuard = 'none';
    const sample = publicGround(x, z);
    if (sample && sample.reservedDistance < distance) { distance = sample.reservedDistance; guard = 'public-ground'; }
    for (const footprint of footprints.at(x, z)) {
      const d = footprint.distance(x, z);
      if (d < distance) { distance = d; guard = footprint.guard; }
    }
    const wet = waterDistance(x, z) - WATER_BANK;
    if (wet < distance) { distance = wet; guard = 'water'; }
    return { distance, guard };
  };

  return { protection, waterDistance, waterLevel };
}
