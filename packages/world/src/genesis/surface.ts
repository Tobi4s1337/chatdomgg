import { naturalLandHeight, waterSurfaceAt } from '../kingdom-land/surface';
import type { DeepReadonly, GenesisLandscape } from './contracts';
import type { XZ } from '../settlement/types';

export interface GenesisSurfaceSample {
  ground: number;
  waterLevel: number | null;
  water: 'ocean' | 'inland' | null;
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
  if (shoreDistance <= 0) return { ground: Math.max(-8, shoreDistance * .22), waterLevel: 0, water: 'ocean' };
  if (islandHeight !== null) return { ground: Math.min(islandHeight, shoreDistance * .3), waterLevel: null, water: null };
  const natural = naturalLandHeight(landscape.terrainCore, x, z);
  const water = waterSurfaceAt(landscape.terrainCore, x, z);
  return { ground: Math.min(natural, shoreDistance * .22), waterLevel: water, water: water === null ? null : 'inland' };
}
