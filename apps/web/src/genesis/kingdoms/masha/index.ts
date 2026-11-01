import type { Vec3 } from '@chatdom/shared';
import type { SettlementPlan } from '@chatdom/world';
import type { ChannelKingdomRecipe, DeepReadonly, GenesisLandscape } from '@chatdom/world/genesis';
import { chooseRoofFamily } from '../../../../../../packages/content/src/genesis-kingdoms/masha/roofs';
import { composeGenesisEmoteArt, type GenesisEmoteArt } from '../../../../../../packages/content/src/genesis-emotes';
import { proposeGenesisKeepers, type KeeperProposal } from '../../../../../../packages/content/src/genesis-keepers/adapter';
import { compileMashaCity } from './city';
import { composeMashaLand, mashaFrame } from './land';
import { createMashaSeat, type MashaSeat } from './seat';

export const MASHA_ID = '154972160';

/**
 * MashaD4's composed potential kingdom: a mountain city on its seeded mountain-pass candidate. The page mounts it
 * exactly as other potential land (Unfounded land, SIMULATED light study, no people); this module decides the
 * land, the terraced plan, the seat on Crown Hill and at the pass, the roofs, the hero view and the dusk hour.
 */
export interface MashaKingdom {
  readonly plan: SettlementPlan;
  readonly landscape: DeepReadonly<GenesisLandscape>;
  readonly style: 'hearth' | 'tide' | 'grove';
  readonly seat: MashaSeat;
  readonly camera: { readonly eye: Vec3; readonly target: Vec3; readonly fov: number };
  /** The hour the hero view opens at when the address names none. */
  readonly hour: number;
  readonly caption: string;
  /**
   * The land's sound, ready for the kingdom's audio host (`createGenesisSoundscape(host, sound)`): the recipe with
   * this composed land in place of its seeded candidate, so the wind, the pass and the water sound where they are drawn.
   */
  readonly sound: { readonly recipe: DeepReadonly<ChannelKingdomRecipe>; readonly landscapeId: string };
  /** The channel's emote art. With no approved, channel-bound derivative it is honest absence: no statue, no vane. */
  readonly emoteArt: GenesisEmoteArt;
  /** The recipe's keepers and where this city keeps them: Tansy at The Copper Kettle, Pip on the Crown Stair. */
  readonly keepers: readonly { readonly proposal: KeeperProposal; readonly site: Vec3 }[];
}

export function composeMashaKingdom(recipe: DeepReadonly<ChannelKingdomRecipe>, selected: DeepReadonly<GenesisLandscape>): MashaKingdom {
  if (String(recipe.kingdomId) !== MASHA_ID) throw new Error('This composition belongs to MashaD4.');
  const roofs = chooseRoofFamily(recipe.identity.profileColourTargets, recipe.identity.styleFamily);
  // The roof kit the colours chose becomes the city's family; the recipe itself is not rewritten.
  const styled = { ...recipe, identity: { ...recipe.identity, styleFamily: roofs.family } } as DeepReadonly<ChannelKingdomRecipe>;
  const landscape = composeMashaLand(selected);
  const city = compileMashaCity(styled, landscape);
  const frame = mashaFrame(landscape.coast.oceanToward);
  const seat = createMashaSeat(styled, selected, city);
  // From the river meadows below Bell Court, looking up the stair to the keep, the pass and the crown of peaks: the
  // court, the inn and the arms in the lower third, the terraces in the middle, the keep and the pass above them.
  const [kx, kz] = city.keep.local;
  const eyeXZ = frame.world(kx + 70, kz + 680), targetXZ = frame.world(kx + 10, kz - 60);
  const camera = { eye: [eyeXZ[0], 100, eyeXZ[1]] as Vec3, target: [targetXZ[0], city.keep.height + 26, targetXZ[1]] as Vec3, fov: 46 };
  const sound = { recipe: { ...recipe, landscapes: recipe.landscapes.map(item => item.id === selected.id ? landscape : item) } as unknown as DeepReadonly<ChannelKingdomRecipe>, landscapeId: selected.id };
  // Approved emote derivatives arrive through the monarch's review; none exists for this channel yet.
  const emoteArt = composeGenesisEmoteArt(styled, selected, []);
  // Tansy keeps The Copper Kettle from its door; Pip starts the lamp round at the foot of the Crown Stair.
  const market = city.plan.nodes.find(node => node.id === city.plan.market.nodeId)!.position;
  const innDoor = city.plan.nodes.find(node => node.id === 'masha:inn')!.position;
  const keepers = proposeGenesisKeepers(styled, selected).map(proposal => ({ proposal, site: proposal.keeper.role === 'innkeeper' ? innDoor : market }));
  return { plan: city.plan, landscape, style: roofs.family, seat, camera, hour: 18.9,
    caption: 'Five hundred and twelve homes on terraces beneath the keep, and a road up to the pass.', sound, emoteArt, keepers };
}
