import { compileChannelGenesis } from '@chatdom/world/genesis';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from '@chatdom/world/genesis/observed';
import type { GrandLandSeed } from '../../../../packages/world/src/grand/types';
import { grandSeedFromGenesis } from '../../../../packages/world/src/grand/world';

/** The four first lands: tobi4s_ and the three Genesis channels. */
export interface GrandChannel {
  readonly login: string;
  readonly name: string;
  readonly seed: GrandLandSeed;
  /** The same channel's own world (`grand-land-2`): its landform, forest and crest. Absent for a holding read as a world already. */
  readonly world?: GrandLandSeed;
  /** Where the facts behind the seed came from, as shown to a person. */
  readonly evidence: 'observed' | 'simulated';
}

const TOBIAS = { id: '129634568', login: 'tobi4s_', name: 'tobi4s_' };
const NAMES: Record<string, { login: string; name: string }> = {
  '63920635': { login: 'the_aggman', name: 'The_AGGman' },
  '4363967': { login: 'pinkkittyrose', name: 'PinkKittyRose' },
  '154972160': { login: 'mashad4', name: 'MashaD4' },
};

function channelFromFacts(facts: unknown, login: string, name: string, character: GrandLandSeed['character'] | null, evidence: GrandChannel['evidence']): GrandChannel {
  const recipe = compileChannelGenesis(facts);
  const recommended = recipe.landscapes.find(l => l.id === recipe.recommendedLandscapeId) ?? recipe.landscapes[0];
  return {
    login, name, evidence,
    world: grandSeedFromGenesis(recipe, name, { character: character ?? recommended.character }),
    seed: {
      seedKey: recipe.seedKey, kingdomId: String(recipe.kingdomId), name,
      biome: recipe.identity.biome, tier: recipe.size.tier, character: character ?? recommended.character,
    },
  };
}

export const GRAND_CHANNELS: readonly GrandChannel[] = [
  // No observed audience or categories for this channel yet: Genesis keeps the honest defaults (an unknown
  // audience is a hamlet, an unknown category is meadow). The facts record is marked SIMULATED.
  channelFromFacts({
    version: 1, broadcasterId: TOBIAS.id,
    evidence: { kind: 'simulated', sourceId: 'grand-land-proof', asOf: 1793520000000, label: 'SIMULATED' },
    audience: { averageViewers: null, followers: null, windowHours: 24 },
    categories: [], profileColours: [], approvedEmotes: [], approvedDescription: null, oldestFollowYear: null,
  }, TOBIAS.login, TOBIAS.name, null, 'simulated'),
  ...OBSERVED_GENESIS_FIXTURES.map(facts => {
    const choice = OBSERVED_GENESIS_SHOWCASE_CHOICES.find(c => c.broadcasterId === facts.broadcasterId);
    const known = NAMES[facts.broadcasterId]!;
    return channelFromFacts(facts, known.login, known.name, choice?.character ?? null, 'observed');
  }),
];

export function grandChannel(login: string | null): GrandChannel {
  const key = (login ?? '').toLowerCase();
  return GRAND_CHANNELS.find(c => c.login === key || c.seed.kingdomId === key) ?? GRAND_CHANNELS[0]!;
}
