import { createFishModel, FISH_ITEM_DEFINITIONS, FISH_SPECIES } from '../../../../packages/content/src/fish';
import { createKeepsakeModel, FISH_MOUNT_DEFINITIONS } from '../../../../packages/content/src/keepsakes';
import { createWillowRod, WILLOW_ROD_DEFINITION } from '../../../../packages/content/src/pier/rod';
import { registerItemModels } from '../bag/catalogue';
import { registerItemDefinitions } from '../bag/definitions';

registerItemModels([
  ...FISH_SPECIES.map(fish => ({ id: fish.id, create: () => createFishModel(fish.id).asset })),
  ...FISH_MOUNT_DEFINITIONS.map(mount => ({ id: mount.model, create: () => createKeepsakeModel(mount.id) })),
  { id: 'tool:rod.willow', create: () => createWillowRod().asset },
]);
// The same reviewed definitions the realm's catalogue holds: names, lore and where each thing may go.
registerItemDefinitions([...FISH_ITEM_DEFINITIONS, ...FISH_MOUNT_DEFINITIONS, WILLOW_ROD_DEFINITION]);
