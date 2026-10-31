import { landBeforeWater, sampleLandWater } from '../kingdom-land/surface';
import type { KingdomLandform } from '../kingdom-land/types';
import { smoothstep } from '../settlement/geometry';
import type { DeepReadonly, GenesisLandscape } from './contracts';
import type { XZ } from '../settlement/types';

export interface GenesisSurfaceSample {
  ground: number;
  waterLevel: number | null;
  water: 'ocean' | 'inland' | null;
  /** Signed distance to the nearest water boundary, including its dry bank. */
  shoreDistance: number;
}

const bankQueries = new WeakMap<DeepReadonly<GenesisLandscape>, KingdomLandform>();
/** Query the complete valley, rather than fading a mountain cut back in a 14 m bank. */
function inlandSurface(landscape: DeepReadonly<GenesisLandscape>, x: number, z: number) {
  let query = bankQueries.get(landscape);
  if (!query) {
    query = { ...landscape.terrainCore, streams: landscape.terrainCore.streams.map(stream => ({ ...stream, bank: 128 })) };
    bankQueries.set(landscape, query);
  }
  const water = sampleLandWater(query, x, z);
  const land = landBeforeWater(landscape.terrainCore, x, z);
  if (!water) return { ground: land, water };
  if (water.shoreDistance < 0) {
    const stream = landscape.terrainCore.streams.find(item => item.id === water.id);
    if (!stream) return { ground: water.bed, water };
    const a = stream.points[0]!.position, b = stream.points[1]!.position, dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    const downstream = ((x - a[0]) * dx + (z - a[1]) * dz) / length;
    // A spring opens gradually into its full bed instead of beginning with a
    // square two-metre underwater wall across the start of the watercourse.
    return { ground: water.surface + (water.bed - water.surface) * smoothstep(0, 4, downstream), water };
  }
  // The bank meets its actual water level, rises at .9 m/m, and joins the
  // hillside wherever the two meet. There is no fixed-distance fade capable of
  // restoring 50 m of mountain in the last few metres of the bank envelope.
  const distance = water.shoreDistance, lip = water.surface + .3 * smoothstep(0, 1.4, distance);
  // Hold a six-metre dry bank beyond the wet edge before returning to lower
  // ground. A bridge landing must meet land, rather than a narrow raised leat.
  return { ground: Math.max(Math.min(land, lip + .9 * distance), lip - .5 * Math.max(0, distance - 6)), water };
}

/**
 * Executable coast/island extension over existing v2 terrain primitives, in world metres.
 * The same function is intended for terrain and collision consumers after main promotes the dispatch.
 * It is a natural surface, not a graded settlement or a declaration that unstreamed chunks are known.
 */
export function sampleGenesisSurface(landscape: DeepReadonly<GenesisLandscape>, x: number, z: number): GenesisSurfaceSample {
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Genesis surface needs finite coordinates.');
  const turn = landscape.coast.oceanToward;
  const local = (a: number, b: number): XZ => turn === 0 ? [a, b] : turn === 1 ? [-b, a] : turn === 2 ? [-a, -b] : [b, -a];
  const [u, v] = local(x, z);
  const shore = landscape.coast.shoreline;
  let coastV = local(...shore[0]!)[1];
  for (let i = 1; i < shore.length; i++) {
    const a = local(...shore[i - 1]!), b = local(...shore[i]!);
    if (u < a[0]) break;
    const t = Math.max(0, Math.min(1, (u - a[0]) / (b[0] - a[0])));
    coastV = a[1] + (b[1] - a[1]) * t;
    if (u <= b[0]) break;
  }
  let shoreDistance = coastV - v;
  let islandHeight: number | null = null;
  for (const island of landscape.islands) {
    const distance = (1 - Math.hypot((x - island.centre[0]) / island.radiusX, (z - island.centre[1]) / island.radiusZ))
      * Math.min(island.radiusX, island.radiusZ);
    if (distance > shoreDistance) { shoreDistance = distance; islandHeight = island.height; }
  }
  // The river's carved bed continues through its mouth. Replacing it with the
  // ocean ramp at the coastline made a vertical seam across the submerged bed.
  if (shoreDistance <= 0) return { ground: Math.min(Math.max(-8, shoreDistance * .22), inlandSurface(landscape, x, z).ground), waterLevel: 0, water: 'ocean', shoreDistance };
  if (islandHeight !== null) return { ground: Math.min(islandHeight, shoreDistance * .3), waterLevel: null, water: null, shoreDistance };
  const { ground: natural, water: inland } = inlandSurface(landscape, x, z);
  const water = inland && inland.shoreDistance < 0 ? inland.surface : null;
  return { ground: Math.min(natural, shoreDistance * .22), waterLevel: water, water: water === null ? null : 'inland', shoreDistance: Math.min(shoreDistance, inland?.shoreDistance ?? Infinity) };
}
