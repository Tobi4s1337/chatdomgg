import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { foundedGroundAt } from '../../founded-world/collision';
import type { RealmFoundedScene } from '../../founded-world/types';
import { createKingdomLandInterface, type KingdomLandInterface, type LandGroundSource } from '../../land-interface';
import type { BoundsXZ } from '../../settlement/types';
import { frameSettlement } from './frame';

/**
 * The grand land's physical ground for one installed scene: exactly the founded collision surface inside the
 * scene's physical region and unknown (`null`) everywhere else. The generated land beyond the region is scenery; it
 * is never offered as somewhere to stand (spec 56: a far surface never becomes a collider). Settlement metres.
 */
export function grandGroundSource(scene: Pick<RealmFoundedScene, 'plan' | 'layoutRevision' | 'collisionRevision'>, region: BoundsXZ = frameSettlement(scene.plan).region): LandGroundSource {
  const plan = scene.plan;
  return Object.freeze({
    layoutRevision: scene.layoutRevision,
    collisionRevision: scene.collisionRevision,
    sample: (x: number, z: number): Vec3 | null => {
      if (!(x >= region.minX && x < region.maxX && z >= region.minZ && z < region.maxZ)) return null;
      return foundedGroundAt(plan, x, z);
    },
  });
}

/**
 * The frozen consumer seam for a scene seated on the grand land: the exact installed scene, its physical ground,
 * optional exact collision, paths, Forge, moment anchors and light inputs, all in settlement metres. The renderer
 * adds `seat.offset` to draw it on the land; nothing here moves.
 */
export function grandKingdomLand(scene: RealmFoundedScene, collision?: CollisionWorld): KingdomLandInterface {
  return createKingdomLandInterface({ scene, ground: grandGroundSource(scene), ...(collision ? { collision } : {}) });
}
