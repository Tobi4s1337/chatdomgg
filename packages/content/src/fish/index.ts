import type { ItemDefinition } from '@chatdom/shared';
import { createBellMinnow, createCopperPerch, createReedRoach, createSilverDace } from './shoal';
import { createLanternEel, createMoonlitPike, createMossbackCarp, createWhiskerCatfish } from './deep';
import { createMistfinTrout, createPebbleFlounder, createRedfinChar, createSunBream } from './shore';
import { FISH_SPECIES } from './species';
import type { FishModel } from './model';

export { FISH_SPECIES } from './species';
export type { FishModel } from './model';

const models: ReadonlyMap<string, () => FishModel> = new Map([
  ['fish:copper-perch', createCopperPerch], ['fish:bell-minnow', createBellMinnow],
  ['fish:reed-roach', createReedRoach], ['fish:silver-dace', createSilverDace],
  ['fish:lantern-eel', createLanternEel], ['fish:moonlit-pike', createMoonlitPike],
  ['fish:mossback-carp', createMossbackCarp], ['fish:whisker-catfish', createWhiskerCatfish],
  ['fish:mistfin-trout', createMistfinTrout], ['fish:sun-bream', createSunBream],
  ['fish:pebble-flounder', createPebbleFlounder], ['fish:redfin-char', createRedfinChar],
]);

export function createFishModel(id: string): FishModel {
  const factory = models.get(id);
  if (!factory) throw new Error('This fish is not in the authored catalogue.');
  return factory();
}

/** Firsts become separate storied records at the catch writer; rare fish never stack. */
export const FISH_ITEM_DEFINITIONS: readonly ItemDefinition[] = Object.freeze(FISH_SPECIES.map(fish => Object.freeze({
  id: fish.id, branch: 'gathered' as const, title: fish.name, lore: fish.lore,
  stack: fish.rarity === 'rare' ? null : 99, keepsake: false, model: fish.id,
  places: Object.freeze(['bag', 'away'] as const),
})));
