import { foundedGroundAt, sampleFoundedTerrain } from '../../founded-world/collision';
import { waterSurfaceAt } from '../../kingdom-land/surface';
import { sampleGenesisSurface } from '../../genesis/surface';
import { polygonDistance, segmentProjection } from '../../settlement/geometry';
import type { BoundsXZ, SettlementPlan } from '../../settlement/types';
import type { SettlementFrame, SettlementGround } from './types';

/** The founded terrain compiler's chunk: physical terrain covers plan bounds aligned outward to 16 m. */
export const PHYSICAL_CHUNK_METRES = 16;

/** Unit XZ toward the ocean for each Genesis `oceanToward` turn, as `sampleGenesisSurface` reads it. */
const OCEAN: Readonly<Record<0 | 1 | 2 | 3, readonly [number, number]>> = { 0: [0, 1], 1: [1, 0], 2: [0, -1], 3: [-1, 0] };

/**
 * What a settlement asks of the land around it: its exact physical region, the water level the sea takes, which
 * side its open water lies on, and where the town and castle stand. Pure; reads only the plan.
 */
export function frameSettlement(plan: SettlementPlan): SettlementFrame {
  const b = plan.bounds;
  if (![b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isFinite) || b.minX >= b.maxX || b.minZ >= b.maxZ) throw new Error('A settlement frame needs finite nonempty bounds');
  const c = PHYSICAL_CHUNK_METRES;
  const minX = Math.floor(b.minX / c) * c, minZ = Math.floor(b.minZ / c) * c;
  const region = { minX, minZ, maxX: minX + Math.ceil((b.maxX - minX) / c) * c, maxZ: minZ + Math.ceil((b.maxZ - minZ) / c) * c };
  let sx = plan.market.boundary.reduce((s, p) => s + p[0], 0) / plan.market.boundary.length;
  let sz = plan.market.boundary.reduce((s, p) => s + p[1], 0) / plan.market.boundary.length;
  // The inhabited centre weighs the homes and the square equally, so one long quarter cannot drag it off the town.
  if (plan.homes.length) {
    const hx = plan.homes.reduce((s, h) => s + h.position[0], 0) / plan.homes.length;
    const hz = plan.homes.reduce((s, h) => s + h.position[2], 0) / plan.homes.length;
    sx = (sx + hx) / 2; sz = (sz + hz) / 2;
  }
  const surface = plan.genesisSurface;
  let seaward: readonly [number, number] | null;
  let waterLevel: number;
  if (surface) {
    seaward = OCEAN[surface.coast.oceanToward];
    waterLevel = surface.coast.level;
  } else {
    // A town on a lake opens toward it; the lake takes the sea's level and becomes the harbour's inner water.
    const dx = plan.lake.x - sx, dz = plan.lake.z - sz, length = Math.hypot(dx, dz);
    seaward = length > 1e-6 ? [dx / length, dz / length] : null;
    waterLevel = plan.lake.level;
  }
  return { plan, region, waterLevel, seaward, centre: [sx, sz], castle: { centre: plan.castle.centre, bounds: plan.castle.bounds } };
}

/**
 * The settlement's physical ground and waters, in settlement metres. `top` is the founded collision surface itself
 * (the half-metre cell centre's height rounded to the half-metre lattice, as `foundedGroundAt`), so the grand land
 * under the town is the ground people already walk on, not a renderer's smoothed guess. An installed (v1) landform
 * reads the founded compiler's own cached grid, shared with collision compilation; other landforms sample the same
 * dispatch per cell. Paving is rasterised once from the plan's paved influences, as `samplePublicGround` reads them.
 */
export function settlementGround(plan: SettlementPlan, region: BoundsXZ = frameSettlement(plan).region): SettlementGround {
  const grid = plan.landform.version === 1 ? sampleFoundedTerrain(plan) : null;
  const top = grid
    ? (x: number, z: number): number => {
      const column = Math.floor((x - grid.origin[0]) * 2), row = Math.floor((z - grid.origin[2]) * 2);
      return column >= 0 && row >= 0 && column < grid.columns && row < grid.rows ? grid.heights[column + row * grid.columns]! : foundedGroundAt(plan, x, z)[1];
    }
    : (x: number, z: number): number => foundedGroundAt(plan, x, z)[1];
  const paving = pavingMask(plan, region);
  const width = (region.maxX - region.minX) * 2;
  return {
    top,
    water: settlementWater(plan),
    paved: (x, z) => {
      const column = Math.floor((x - region.minX) * 2), row = Math.floor((z - region.minZ) * 2);
      return column >= 0 && row >= 0 && column < width && row * width < paving.length && paving[column + row * width] === 1;
    },
  };
}

/** The settlement's own water surface over a point (Genesis coast and rivers, or the v1 lake), null where dry. */
export function settlementWater(plan: SettlementPlan): (x: number, z: number) => number | null {
  const surface = plan.genesisSurface;
  return (x, z) => {
    if (surface) {
      const sample = sampleGenesisSurface(surface, x, z);
      if (sample.waterLevel !== null) return sample.waterLevel;
    }
    return waterSurfaceAt(plan.landform, x, z);
  };
}

/** Paved public ground at half-metre cell centres: active streets (not earth trails) and the paved squares. */
export function pavingMask(plan: SettlementPlan, region: BoundsXZ): Uint8Array {
  const width = (region.maxX - region.minX) * 2, depth = (region.maxZ - region.minZ) * 2;
  const mask = new Uint8Array(width * depth);
  const stamp = (minX: number, maxX: number, minZ: number, maxZ: number, inside: (x: number, z: number) => boolean) => {
    const c0 = Math.max(0, Math.floor((minX - region.minX) * 2)), c1 = Math.min(width - 1, Math.ceil((maxX - region.minX) * 2));
    const r0 = Math.max(0, Math.floor((minZ - region.minZ) * 2)), r1 = Math.min(depth - 1, Math.ceil((maxZ - region.minZ) * 2));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (mask[c + r * width]) continue;
      if (inside(region.minX + (c + 0.5) / 2, region.minZ + (r + 0.5) / 2)) mask[c + r * width] = 1;
    }
  };
  const active = new Set(plan.activeStreetIds);
  for (const street of plan.streets) {
    if (!active.has(street.id) || street.kind === 'trail') continue;
    const half = street.width / 2 + PAVING_TOLERANCE;
    for (let i = 1; i < street.points.length; i++) {
      const a = street.points[i - 1]!, b = street.points[i]!;
      stamp(Math.min(a[0], b[0]) - half, Math.max(a[0], b[0]) + half, Math.min(a[2], b[2]) - half, Math.max(a[2], b[2]) + half,
        (x, z) => segmentProjection([a[0], a[2]], [b[0], b[2]], x, z).distance <= half);
    }
  }
  const courts = new Set(plan.homes.map(home => home.courtId));
  for (const square of [plan.market, plan.castle.court, ...plan.courts.filter(court => courts.has(court.id))]) {
    const xs = square.boundary.map(p => p[0]), zs = square.boundary.map(p => p[1]);
    stamp(Math.min(...xs) - 1, Math.max(...xs) + 1, Math.min(...zs) - 1, Math.max(...zs) + 1,
      (x, z) => polygonDistance(square.boundary, x, z) <= PAVING_TOLERANCE);
  }
  return mask;
}

/** `samplePublicGround`'s paving distance is measured from the paved edge; a quarter-metre keeps the setts flush. */
const PAVING_TOLERANCE = 0.25;
