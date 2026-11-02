import type { SettlementPlan } from '@chatdom/world';
import type { Vec3 } from '@chatdom/shared';
import type { RaidChatGround } from '../../twitch-moments/raid-view';

/** A conservative visual footprint, not a replacement for the adopted world's collision authority. */
// A 7-cell (.875 m) square foot reaches .619 m on an axis when yawed 45 degrees.
export const RAID_CHAT_FOOT = .65;
const MAX_SAMPLES = 256;
export type RaidChatSupport = (site: { readonly foot: Vec3; readonly radius: number; readonly height: number }) => boolean;
const segmentDistance = (x: number, z: number, a: readonly number[], b: readonly number[]): number => {
  const dx = b[0]! - a[0]!, dz = b[2]! - a[2]!, length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - a[0]!) * dx + (z - a[2]!) * dz) / length)) : 0;
  return Math.hypot(x - a[0]! - t * dx, z - a[2]! - t * dz);
};

export interface RaidPropGroundOptions {
  readonly radius: number; readonly height: number; readonly maxRise?: number; readonly sampleSpacing?: number; readonly support?: RaidChatSupport;
  /** A road, not a prop: it may run on past the plan's bounds and across a street; lots, squares, the castle and water still refuse it. */
  readonly road?: boolean;
}

/** Read-only adopted plan plus the exact surface drawn by this scene. Recreate on world adoption. */
export function raidPropGroundOf(plan: SettlementPlan, ground: (x: number, z: number) => number, options: RaidPropGroundOptions): RaidChatGround {
  const cache = new Map<string, number | null>(), r = options.radius;
  const offsets: number[][] = [[0, 0], [-r, -r], [-r, r], [r, -r], [r, r]];
  if (options.sampleSpacing !== undefined && Number.isFinite(options.sampleSpacing) && options.sampleSpacing > 0) {
    const divisions = Math.min(24, Math.max(1, Math.ceil(2 * r / options.sampleSpacing)));
    offsets.length = 0;
    for (let ix = 0; ix <= divisions; ix++) for (let iz = 0; iz <= divisions; iz++) offsets.push([-r + 2 * r * ix / divisions, -r + 2 * r * iz / divisions]);
  }
  const lots = [...plan.reservations.map(reservation => reservation.lot), plan.castle.bounds];
  const active = new Set(plan.activeStreetIds), streets = plan.streets.filter(street => active.has(street.id));
  const squares = [plan.market, ...plan.courts, plan.castle.court].map(square => ({
    minX: Math.min(...square.boundary.map(p => p[0])), maxX: Math.max(...square.boundary.map(p => p[0])),
    minZ: Math.min(...square.boundary.map(p => p[1])), maxZ: Math.max(...square.boundary.map(p => p[1])),
  }));
  const excluded = [...lots, ...squares];
  const current = (x: number, z: number, height: number | null): number | null => {
    if (height === null || !options.support) return height;
    // Terrain samples are scene-local; current physical support must never be cached with them.
    try { return options.support({ foot: [x, height, z], radius: r, height: options.height }) === true ? height : null; }
    catch { return null; }
  };
  const blocked = (x: number, z: number): boolean => {
    if (!options.road && (x - r < plan.bounds.minX || x + r > plan.bounds.maxX || z - r < plan.bounds.minZ || z + r > plan.bounds.maxZ)) return true;
    if (excluded.some(box => x + r >= box.minX && x - r <= box.maxX && z + r >= box.minZ && z - r <= box.maxZ)) return true;
    if (plan.lake.radiusX > 0 && plan.lake.radiusZ > 0 &&
        Math.hypot((Math.max(0, Math.abs(x - plan.lake.x) - r)) / plan.lake.radiusX,
          (Math.max(0, Math.abs(z - plan.lake.z) - r)) / plan.lake.radiusZ) <= 1.08) return true;
    return !options.road && streets.some(street => street.points.slice(1).some((point, i) =>
      segmentDistance(x, z, street.points[i]!, point) <= street.width / 2 + r));
  };
  return (x, z) => {
    if (![x, z].every(Number.isFinite)) return null;
    const key = `${x},${z}`;
    if (cache.has(key)) return current(x, z, cache.get(key)!);
    let result: number | null = null;
    if (!blocked(x, z)) {
      try {
        const samples = offsets.map(([dx, dz]) => ground(x + dx!, z + dz!));
        // Bury the stone foot's lower edge on gentle slopes, rather than leaving a floating corner.
        if (samples.every(y => Number.isFinite(y) && y > Math.max(0, plan.lake.level) + .1) && Math.max(...samples) - Math.min(...samples) <= (options.maxRise ?? .08)) result = Math.min(...samples);
      } catch { /* Missing adopted terrain is not permission to guess a height. */ }
    }
    if (cache.size >= MAX_SAMPLES) cache.delete(cache.keys().next().value!);
    cache.set(key, result); return current(x, z, result);
  };
}

export function raidChatGroundOf(plan: SettlementPlan, ground: (x: number, z: number) => number, support?: RaidChatSupport): RaidChatGround {
  return raidPropGroundOf(plan, ground, { radius: RAID_CHAT_FOOT, height: 2.4, ...(support ? { support } : {}) });
}

/** A wagon with its pony and standard, half its width plus air, in metres; the approach is cleared this far either side. */
export const RAID_APPROACH_HALF_WIDTH = 1.9;

/**
 * The open road in front of the gate, for the incoming column to come down: clear of every lot, square, the castle
 * and water by a wagon's half-width, on the adopted terrain, and on gently sloping ground only. It is a visual road,
 * not a walkable one; the scene's own trees and native occupancy reach it through `support` when the host has them.
 */
export function raidApproachGroundOf(plan: SettlementPlan, ground: (x: number, z: number) => number, support?: RaidChatSupport): RaidChatGround {
  return raidPropGroundOf(plan, ground, { radius: RAID_APPROACH_HALF_WIDTH, height: 5.6, maxRise: .9, sampleSpacing: 1.9, road: true, ...(support ? { support } : {}) });
}
