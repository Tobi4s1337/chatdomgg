import { MAT } from '@chatdom/content';
import { terrainHeight, type GroundSurface, type LandSurfaceAt } from '@chatdom/world';
import { sampleTerrainTriangles, terrainCellSurface, type TerrainLayout } from './terrain-worker';

/**
 * The drawn surface of today's land (the smoothed 1 m terrain skin from `meshTerrainSurface`), for the land seam's
 * `surfaceAt`. drawnY is the rendered triangle under the point (`sampleRenderedTerrainHeight`, the same corner
 * samples and 00→11 diagonal as the GPU). The material is the one the mesher gives that metre patch: its four
 * half-metre cells vote, ties keep the southwest cell, exactly as `meshTerrainSurface` decides it. Water depth comes
 * from the drawn water surface the scene owns, when it has one there.
 *
 * Null outside the plan's terrain bounds. Presentation and audio only. A first sample in a metre patch costs about
 * 0.4 ms (eight analytic terrain reads); the patch's corners and material are then kept in a bounded cache, so the
 * feet of every visible walker cost a lookup each frame.
 */
export function todayLandSurface(layout: TerrainLayout, waterLevel?: (x: number, z: number) => number | null): LandSurfaceAt {
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const patches = new Map<number, { readonly corners: Float64Array; readonly surface: GroundSurface }>();
  const patchOf = (left: number, back: number) => {
    const key = (left + 32768) * 65536 + back + 32768;
    let patch = patches.get(key);
    if (patch) return patch;
    const cells = [terrainCellSurface(layout, left + .25, back + .25), terrainCellSurface(layout, left + .75, back + .25),
      terrainCellSurface(layout, left + .25, back + .75), terrainCellSurface(layout, left + .75, back + .75)];
    let material = cells[0]!, votes = 0;
    for (const candidate of cells) {
      const count = cells.filter(value => value === candidate).length;
      if (count > votes) { material = candidate; votes = count; }
    }
    // Corner order 00, 01, 10, 11 (x then z), read by sampleTerrainTriangles through the sampler below.
    const corners = Float64Array.of(terrainHeight(layout, left, back), terrainHeight(layout, left, back + 1),
      terrainHeight(layout, left + 1, back), terrainHeight(layout, left + 1, back + 1));
    if (patches.size >= PATCH_CACHE) patches.clear();
    patch = { corners, surface: groundOf(material) };
    patches.set(key, patch);
    return patch;
  };
  return (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(x >= minX && x < maxX && z >= minZ && z < maxZ)) return null;
    const left = Math.floor(x), back = Math.floor(z), patch = patchOf(left, back), c = patch.corners;
    const drawnY = sampleTerrainTriangles((px, pz) => c[(px - left) * 2 + (pz - back)]!, x, z);
    if (!Number.isFinite(drawnY)) return null;
    const level = waterLevel?.(x, z) ?? null;
    const waterDepth = level !== null && Number.isFinite(level) && level > drawnY ? level - drawnY : 0;
    return Object.freeze({ drawnY, surface: patch.surface, waterDepth });
  };
}

/** About two hundred metres square of patches; cleared whole when full (feet revisit the same few patches). */
const PATCH_CACHE = 40_000;

function groundOf(material: number): GroundSurface {
  // The waterbed is the lake's sand margin; paving is laid setts; every other skin cell is turf.
  return material === MAT.waterbed ? 'sand' : material === MAT.paving ? 'cobble' : 'grass';
}
