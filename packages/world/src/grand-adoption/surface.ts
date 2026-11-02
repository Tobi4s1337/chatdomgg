import type { SettlementPlan, BoundsXZ } from '../settlement/types';
import { frameSettlement, settlementGround } from '../grand/kingdom/frame';
import { TOWN_ROCK_STEP } from '../grand/kingdom/grade';
import { LAND_CELL } from '../grand/kingdom/types';

/** What the drawn ground under a foot is made of, in the footsteps' ground names (play's `StepGround`). */
export type GroundSurface =
  | 'grass' | 'meadow' | 'earth' | 'gravel' | 'cobble' | 'stone' | 'plank'
  | 'sand' | 'snow' | 'shallows' | 'rock';

export const GROUND_SURFACES: readonly GroundSurface[] = Object.freeze(['grass', 'meadow', 'earth', 'gravel', 'cobble',
  'stone', 'plank', 'sand', 'snow', 'shallows', 'rock']);

/** The drawn ground at a point: what a person sees under their feet, not walking permission. */
export interface LandSurfaceSample {
  /** Height of the DRAWN surface at (x, z), in world metres: the face the player sees. */
  readonly drawnY: number;
  /** What the drawn surface is made of at this point, as painted. */
  readonly surface: GroundSurface;
  /** Water depth above drawnY in metres; 0 on dry ground. */
  readonly waterDepth: number;
}

/** Null where unknown. Presentation and audio only: never a collision, camera or prediction input. */
export type LandSurfaceAt = (x: number, z: number) => LandSurfaceSample | null;

export interface GrandFloorSurfaceOptions {
  /** The grand sea's surface in settlement metres (`seaLevel * 0.5 - seat.offset[1]` of the baked land). */
  readonly seaLevel: number;
  /** The installed physical region; defaults to the plan's own frame, which is what the grand floor grades. */
  readonly region?: BoundsXZ;
}

/**
 * The drawn surface of the grand floor inside the installed physical region, read from the same inputs the baked
 * land was graded from (`gradeSettlement` and `restoreInstalledFloor`), so it is what the half-metre columns show:
 *
 * - drawnY is the column's flat top, which equals `foundedGroundAt` and the collision top (seam guarantee 1);
 * - water stands over a column up to the larger of the settlement's own water and the grand sea;
 * - paved public ground is setts (cobble), low ground by the sea is sand, a lawn bank of 1.5 m or more to a
 *   neighbour shows rock, and every other column is turf.
 *
 * Outside the region the land is scenery nobody walks on, so the answer is null. Each sample costs five reads of
 * the founded grid and one of the paving mask, which is rasterised once on the first call.
 */
export function grandFloorSurface(plan: SettlementPlan, options: GrandFloorSurfaceOptions): LandSurfaceAt {
  if (!Number.isFinite(options.seaLevel)) throw new RangeError('The grand floor surface needs a finite sea level');
  const region = options.region ?? frameSettlement(plan).region, sea = options.seaLevel;
  let ground: ReturnType<typeof settlementGround> | undefined;
  const cellTop = (cx: number, cz: number) => ground!.top(region.minX + (cx + .5) * LAND_CELL, region.minZ + (cz + .5) * LAND_CELL);
  return (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(x >= region.minX && x < region.maxX && z >= region.minZ && z < region.maxZ)) return null;
    ground ??= settlementGround(plan, region);
    const cx = Math.floor((x - region.minX) / LAND_CELL), cz = Math.floor((z - region.minZ) / LAND_CELL);
    const sx = region.minX + (cx + .5) * LAND_CELL, sz = region.minZ + (cz + .5) * LAND_CELL;
    const top = cellTop(cx, cz);
    if (!Number.isFinite(top)) return null;
    // The grader rounds the settlement's water to the half-metre lattice; the floor floods up to the sea as well.
    const own = ground.water(sx, sz), level = Math.max(own === null ? -Infinity : Math.round(own / LAND_CELL) * LAND_CELL, sea);
    const waterDepth = level > top ? level - top : 0;
    if (waterDepth > 0) return Object.freeze({ drawnY: top, surface: 'sand' as const, waterDepth });
    if (ground.paved(sx, sz)) return Object.freeze({ drawnY: top, surface: 'cobble' as const, waterDepth: 0 });
    if (top <= sea + LAND_CELL) return Object.freeze({ drawnY: top, surface: 'sand' as const, waterDepth: 0 });
    const step = Math.max(Math.abs(top - cellTop(cx - 1, cz)), Math.abs(top - cellTop(cx + 1, cz)),
      Math.abs(top - cellTop(cx, cz - 1)), Math.abs(top - cellTop(cx, cz + 1)));
    return Object.freeze({ drawnY: top, surface: step >= TOWN_ROCK_STEP * LAND_CELL - 1e-6 ? 'rock' as const : 'grass' as const, waterDepth: 0 });
  };
}
