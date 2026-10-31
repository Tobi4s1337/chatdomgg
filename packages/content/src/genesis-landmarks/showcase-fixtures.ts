import { compileChannelGenesis, type ChannelKingdomRecipe, type DeepReadonly, type GenesisLandscape } from '../../../world/src/genesis/index';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from '../../../world/src/genesis/observed-fixtures';
import { GENESIS_CHANNELS } from '../../../../apps/web/src/genesis/channels';

/**
 * Test and bench inputs only; no collection or runtime barrel imports this module. Each recipe is compiled from the
 * observed spec-39 facts plus the channel's public profile palette as captured by main (`apps/web/src/genesis/
 * channels.ts`), so the colour targets are actual targets rather than invented ones. The landscape is the explicit
 * showcase choice, not the recipe's recommendation. These are not founded or approved kingdoms.
 */
export interface ShowcaseFixture {
  readonly broadcasterId: string;
  readonly recipe: DeepReadonly<ChannelKingdomRecipe>;
  readonly landscape: DeepReadonly<GenesisLandscape>;
}

export function showcaseFixture(broadcasterId: string): ShowcaseFixture {
  const facts = OBSERVED_GENESIS_FIXTURES.find(row => row.broadcasterId === broadcasterId);
  const choice = OBSERVED_GENESIS_SHOWCASE_CHOICES.find(row => row.broadcasterId === broadcasterId);
  const channel = GENESIS_CHANNELS.find(row => row.id === broadcasterId);
  if (!facts || !choice || !channel) throw new Error(`No showcase fixture for ${broadcasterId}.`);
  const recipe = compileChannelGenesis({ ...facts, profileColours: channel.palette.slice(0, 4) });
  const landscape = recipe.landscapes.find(candidate => candidate.character === choice.character);
  if (!landscape) throw new Error(`${broadcasterId} has no ${choice.character} candidate.`);
  return { broadcasterId, recipe, landscape };
}

/** The coastal target from spec 40: The_AGGman, a coastal hamlet. */
export const HARBOUR_TARGET = '63920635';
