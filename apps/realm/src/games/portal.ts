import type { KingdomId, TavernPortal } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { standingClear } from '@chatdom/world/interactions';
import { foundedTavernPortal } from '../../../../packages/content/src/tavern/portal';

/** Server truth for the tavern door: the same installed scene and collision the kingdom room authorises. */
export function tavernPortalFor(kingdomId: KingdomId, scene: RealmFoundedScene, world: CollisionWorld): TavernPortal | null {
  return foundedTavernPortal({ kingdomId, scene, world, standingClear });
}
