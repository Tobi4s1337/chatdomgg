import { samplePublicGround, settlementTerrainHeight } from '../settlement/terrain';
import type { SettlementPlan } from '../settlement/types';
import { createTerrainArtCandidate, TERRAIN_ART_LIMITS } from './producer';
import type { TerrainArtCandidate } from './types';

const extent = TERRAIN_ART_LIMITS.maxExtent;
/** The installed horizon square; detailed ground and horizon share its metre corners. */
export const ADOPTED_TERRAIN_BOUNDS = Object.freeze({ minX: -extent, maxX: extent, minZ: -extent, maxZ: extent });
const adoptedPlans = new WeakMap<SettlementPlan, TerrainArtCandidate>();

/** One deterministic picture-land surface per immutable accepted plan, without rewriting its identity. */
export function adoptedTerrainArt(plan: SettlementPlan): TerrainArtCandidate {
  const cached = adoptedPlans.get(plan);
  if (cached) return cached;
  const candidate = createTerrainArtCandidate({ plan, bounds: ADOPTED_TERRAIN_BOUNDS,
    // Keep the base sampler here: calling terrainHeight would recurse through adoption.
    ground: (x, z) => settlementTerrainHeight(plan, x, z),
    publicGround: (x, z) => samplePublicGround(plan, x, z) });
  adoptedPlans.set(plan, candidate);
  return candidate;
}

/** Consumers beyond the installed horizon retain the finite, unsculpted settlement surface. */
export function adoptedTerrainHeight(plan: SettlementPlan, x: number, z: number): number {
  const bounds = ADOPTED_TERRAIN_BOUNDS;
  if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return settlementTerrainHeight(plan, x, z);
  return adoptedTerrainArt(plan).height(x, z);
}
