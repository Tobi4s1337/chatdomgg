import { compileChannelGenesis, compileGenesisSettlement, type ChannelGenesisFacts, type ChannelKingdomRecipe, type DeepReadonly, type GenesisLandscape } from '@chatdom/world/genesis';
import type { GenesisKingdomComposer } from '../../kingdom-composer';
import { composeAggman } from './compose';
import { AGGMAN_BROADCASTER, aggmanApprovedEmotes, loadAggmanEmoteDerivatives } from './content';

export { composeAggman, AGGMAN_HOUR, AGGMAN_LORE, type AggmanKingdom, type PlacedKeeper } from './compose';

/**
 * The channel's checked emote derivatives, decoded once as the kingdom loads. A raster that no longer matches its
 * check is refused: its use composes as honest absence and nothing stands in for it.
 */
const derivatives = await loadAggmanEmoteDerivatives().catch((error: unknown) => {
  console.warn('The_AGGman’s emote derivatives were refused; the statue, window and vane stay open.', error);
  return [];
});

/**
 * The recipe as `compileChannelGenesis` writes it for facts carrying `aggmanApprovedEmotes()`: each checked emote is
 * the only one eligible for its use, so it is that use's work. For hosts that compiled the recipe before the
 * kingdom's own composition ran; the tests hold the two equal.
 */
export function withApprovedEmoteWorks(recipe: DeepReadonly<ChannelKingdomRecipe>): DeepReadonly<ChannelKingdomRecipe> {
  if (recipe.identity.emoteWorks.length) return recipe;
  const approved = aggmanApprovedEmotes();
  const emoteWorks = (['statue', 'weathervane', 'stained-glass'] as const).flatMap(use => approved.filter(emote => emote.allowedUses.includes(use))
    .map(emote => ({ emoteId: emote.emoteId, use, asset: { ...emote.asset } })));
  return { ...recipe, identity: { ...recipe.identity, emoteWorks } } as DeepReadonly<ChannelKingdomRecipe>;
}

/** The_AGGman (63920635) through the shared composer registry: a coastal hamlet of sixteen homes above its harbour. */
export const kingdom: GenesisKingdomComposer = {
  broadcasterId: AGGMAN_BROADCASTER,
  compose({ recipe, landscape, plan }) {
    const composed = composeAggman(withApprovedEmoteWorks(recipe), landscape, plan, derivatives);
    return { plan: composed.plan, seat: composed.seat, camera: composed.camera };
  },
};

/**
 * The_AGGman as a kingdom of its own, for the preview's per-kingdom registry: the facts compiled with the channel's
 * checked emotes, the coastal harbour land, the hamlet, its keepers, its hour and its line.
 */
export async function composeGenesisKingdom(input: { readonly facts: ChannelGenesisFacts; readonly character: GenesisLandscape['character'] }) {
  if (input.facts.broadcasterId !== AGGMAN_BROADCASTER || input.character !== 'coastal-harbour') throw new Error('This composition belongs to The_AGGman’s coastal harbour.');
  const recipe = compileChannelGenesis({ ...input.facts, approvedEmotes: aggmanApprovedEmotes() });
  const landscape = recipe.landscapes.find(item => item.character === 'coastal-harbour')!;
  const composed = composeAggman(recipe, landscape, compileGenesisSettlement(recipe, landscape.id), await loadAggmanEmoteDerivatives());
  return { recipe, landscape, plan: composed.plan, seat: composed.seat, camera: composed.camera, hour: composed.hour, lore: composed.lore, keepers: composed.keepers, sound: composed.sound };
}
