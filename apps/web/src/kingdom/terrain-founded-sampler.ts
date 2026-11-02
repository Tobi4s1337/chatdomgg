import { terrainHeight, type SettlementPlan } from '@chatdom/world';

/** Metre heights `terrainHeight(plan, origin + (x, z))`, x fastest, as the opening's ground workers sample them. */
export interface SampledGroundWindow {
  readonly window: { readonly origin: readonly [number, number]; readonly width: number; readonly depth: number };
  readonly height: Float32Array;
}

/** The adopted surface's square (`ADOPTED_TERRAIN_BOUNDS` in `@chatdom/world`): metre corners exist only inside it. */
const ADOPTED_EXTENT = 1100;

/**
 * `terrainHeight(plan, x, z)` for points inside the sampled window, read from the metre corners the ground workers
 * already computed instead of sculpting them again on this thread. The adopted surface (plan version 2) answers a
 * fractional point by splitting its metre cell along the diagonal and interpolating the two Float32 corners of its
 * triangle; the window holds exactly those corners, so the same arithmetic in the same order gives the same double.
 * Points outside the window ask `terrainHeight`. Before it is trusted, the sampler recomputes a spread of points
 * on this thread; any difference (another landform, a changed producer) returns null and the caller keeps
 * `terrainHeight`.
 */
export function foundedHeightSampler(plan: SettlementPlan, ground: SampledGroundWindow): ((x: number, z: number) => number) | null {
  if (plan.version !== 2) return null;
  const { origin: [ox, oz], width, depth } = ground.window, heights = ground.height;
  if (heights.length !== width * depth || width < 2 || depth < 2) return null;
  if (Math.min(ox, oz) < -ADOPTED_EXTENT || Math.max(ox + width - 1, oz + depth - 1) > ADOPTED_EXTENT) return null;
  const corner = (ix: number, iz: number) => heights[ix - ox + (iz - oz) * width]!;
  const sample = (x: number, z: number): number => {
    const left = Math.floor(x), backZ = Math.floor(z);
    if (!(left >= ox && backZ >= oz && left < ox + width - 1 && backZ < oz + depth - 1)) return terrainHeight(plan, x, z);
    const u = x - left, v = z - backZ;
    const h00 = corner(left, backZ);
    if (u === 0 && v === 0) return h00;
    const h01 = corner(left, backZ + 1), h11 = corner(left + 1, backZ + 1);
    if (u <= v) return h00 + u * (h11 - h01) + v * (h01 - h00);
    const h10 = corner(left + 1, backZ);
    return h00 + u * (h10 - h00) + v * (h11 - h10);
  };
  // A deterministic spread over the window, both triangles of a cell and its exact corners.
  for (let k = 0; k < 24; k++) {
    const x = ox + (k * 0.618034 % 1) * (width - 1.001), z = oz + (k + 0.37) / 24 * (depth - 1.001);
    for (const [px, pz] of [[x, z], [Math.floor(x), Math.floor(z)], [Math.floor(x) + .75, Math.floor(z) + .25]] as const) {
      if (sample(px, pz) !== terrainHeight(plan, px, pz)) return null;
    }
  }
  return sample;
}
