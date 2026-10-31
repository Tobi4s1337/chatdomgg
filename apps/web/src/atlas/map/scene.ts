import { decodeDecor, type Geography, type Ring } from '../data/model';
import type { PreviewWorld } from '../data/preview';
import type { PaintScene } from './paint';
import { pyramidFor } from './pyramid';
import { landTint, realmTints } from './theme';

/**
 * The land as the tile painter needs it, built once per preview: the same scene feeds the WebGL map's bakers and the
 * still that stands in for it where WebGL is missing, so both draw exactly the same revision.
 */
export function paintSceneFor(world: PreviewWorld, geo: Geography, rings: Ring[]): Omit<PaintScene, 'stamps'> {
  // Every patch of a realm shares the realm's wash; the realm's tint comes from its land's.
  const tints = realmTints(geo.realms, geo.regions);
  return {
    pyramid: pyramidFor(geo.bounds),
    rings,
    regionCount: world.regions.length,
    regionTints: geo.regions.map(landTint),
    realms: geo.realms.map((realm) => ({ x: realm.x, y: realm.y, r: realm.r, tint: tints[realm.index]! })),
    clusters: geo.clusters.map((cluster) => ({
      x: cluster.x, y: cluster.y, r: cluster.r, region: cluster.region, tint: tints[cluster.realm]!,
    })),
    decor: decodeDecor(world),
  };
}
