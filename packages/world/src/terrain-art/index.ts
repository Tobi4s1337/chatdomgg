/**
 * Picture-land candidate producer (spec 46). Main decides whether and how to export this from
 * `@chatdom/world` (proposed subpath: `@chatdom/world/terrain-art`) and alone adopts a candidate.
 */
export { createTerrainArtCandidate, terrainArtBackdrop, TERRAIN_ART_LIMITS } from './producer';
export { TERRAIN_ART_MATERIALS, TERRAIN_ART_PRODUCER } from './types';
export type { TerrainArtBackdrop, TerrainArtCandidate, TerrainArtGuard, TerrainArtInputs, TerrainArtMaterial, TerrainArtProtection } from './types';
