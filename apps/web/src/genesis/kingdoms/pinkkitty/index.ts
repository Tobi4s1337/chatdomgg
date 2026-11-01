import { proposeGenesisLandmarks } from '@chatdom/content/genesis-landmarks';
import type { Vec3 } from '@chatdom/shared';
import { compileChannelGenesis, compileGenesisSettlement, type ChannelGenesisFacts } from '@chatdom/world/genesis';
import { composeGenesisHeraldry } from '../../../../../../packages/content/src/genesis-heraldry/index';
import { composeGenesisEmoteArt } from '../../../../../../packages/content/src/genesis-emotes/index';
import { loadPinkKittyEmoteDerivatives, pinkKittyApprovedEmotes } from '../../../../../../packages/content/src/genesis-kingdoms/pinkkitty/emotes/index';
import type { GenesisKingdomComposition, GenesisKingdomInput } from '../../kingdoms';
import { createPinkKittySeat } from './seat';
import { composeRiverTown } from './town';

/**
 * PinkKittyRose (4363967), a river town of its own. The broadcaster ID seeds the land; Retro sets the hearth kit and
 * the river hall; the profile colours make the arms; three of the channel's own emotes, each checked for one use,
 * become the market statue, the stained glass and the vane; the town grows along its river at its true size.
 */
export async function composeGenesisKingdom(input: GenesisKingdomInput): Promise<GenesisKingdomComposition> {
  if (input.facts.broadcasterId !== '4363967' || input.character !== 'river-valley') throw new Error('This composition belongs to PinkKittyRose’s river valley.');
  const facts: ChannelGenesisFacts = { ...input.facts, approvedEmotes: pinkKittyApprovedEmotes().map(emote => ({
    ...emote, broadcasterId: input.facts.broadcasterId, allowedUses: [...emote.allowedUses] })) };
  const recipe = compileChannelGenesis(facts);
  const landscape = recipe.landscapes.find(item => item.character === 'river-valley')!;
  const town = composeRiverTown(recipe, landscape, compileGenesisSettlement(recipe, landscape.id));
  const hall = proposeGenesisLandmarks(recipe, landscape).find(item => item.showcase === 'river-hall');
  if (!hall) throw new Error('The river valley has no river hall.');
  const heraldry = composeGenesisHeraldry(recipe, landscape);
  const emotes = composeGenesisEmoteArt(recipe, landscape, await loadPinkKittyEmoteDerivatives());
  const seat = createPinkKittySeat(town, { hall: hall.piece, heraldry, emotes });

  // The hero view stands on the far bank downstream, looking up the river at the hall, the square and Crown Hill.
  const [hx, hz] = town.hall.centre;
  const target: Vec3 = [hx + 52, town.market[1] + 7, hz + 40];
  const eye: Vec3 = [hx - 58, town.hall.bank + 30, hz - 88];
  return {
    recipe, landscape, plan: town.plan, seat, camera: { eye, target, fov: 46 }, hour: 19.25,
    lore: 'Old stories find new paths across the rose-lit river.',
  };
}
