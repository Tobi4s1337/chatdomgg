import { FISH_ITEM_DEFINITIONS, FISH_SPECIES } from '../../../../packages/content/src/fish';
import { WILLOW_ROD_DEFINITION } from '../../../../packages/content/src/pier/rod';
import { registerItemDefinitions } from '../items/catalogue';
import { createFishingSpecies } from './species';

/** Reviewed authored content only. Registration grants nothing; casts remain gated by the room adapter. */
export const fishingSpecies = createFishingSpecies(FISH_SPECIES);
registerItemDefinitions([...FISH_ITEM_DEFINITIONS, WILLOW_ROD_DEFINITION]);
