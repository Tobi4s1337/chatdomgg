import type { KingdomId, TavernPortal } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { standingClear } from '@chatdom/world/interactions';
import { foundedTavernPortal } from '../../../../packages/content/src/tavern/portal';

/**
 * The tavern door for the kingdom's portal owner, from the same installed scene and collision the kingdom page
 * walks on (and the realm authorises). Watch `door` with `createThresholdWatch` against the predicted feet; on a
 * crossing, transfer to `destinationRoom` and spawn at `entry`. Returning, spawn at `returnAnchor`, facing out.
 */
export function tavernPortalFor(kingdomId: KingdomId, scene: RealmFoundedScene, world: CollisionWorld): TavernPortal | null {
  return foundedTavernPortal({ kingdomId, scene, world, standingClear });
}
