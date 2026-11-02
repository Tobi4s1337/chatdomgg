import { createFishModel, FISH_SPECIES } from '../../../../packages/content/src/fish';
import { createWillowRod } from '../../../../packages/content/src/pier/rod';
import { registerItemModels } from '../bag/catalogue';

registerItemModels([
  ...FISH_SPECIES.map(fish => ({ id: fish.id, create: () => createFishModel(fish.id).asset })),
  { id: 'tool:rod.willow', create: () => createWillowRod().asset },
]);
