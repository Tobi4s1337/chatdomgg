import type { SettlementPlan } from '@chatdom/world';
import type { Vec3 } from '@chatdom/shared';
import type { ChannelGenesisFacts, ChannelKingdomRecipe, DeepReadonly, GenesisLandscape } from '@chatdom/world/genesis';
import type { GenesisSeatContent } from './seat-content';
import type { KeeperProposal } from '../../../../packages/content/src/genesis-keepers/adapter';
import type { KeeperPlaceSite, KeeperRound } from '../../../../packages/content/src/genesis-keepers/routine';

/** What the preview hands a kingdom's own composition: the facts it compiled and the showcase landscape choice. */
export interface GenesisKingdomInput {
  readonly facts: ChannelGenesisFacts;
  readonly character: GenesisLandscape['character'];
}

/** A finished potential kingdom: its recipe and land, its town, what it raises and how it is first seen. */
export interface GenesisKingdomComposition {
  readonly recipe: DeepReadonly<ChannelKingdomRecipe>;
  readonly landscape: DeepReadonly<GenesisLandscape>;
  readonly plan: SettlementPlan;
  readonly seat?: GenesisSeatContent;
  readonly camera: { readonly eye: Vec3; readonly target: Vec3; readonly fov: number };
  /** The realm hour the view opens at when the address names none. */
  readonly hour?: number;
  readonly lore?: string;
  /**
   * The recipe's keepers at the places the composition built for them: the proposal (look, temperament, retreat,
   * greeting speaker), the site's real fixtures and the round at the opening hour. Drawing, walking and voicing them
   * is the scene's keeper mount; a keeper is never counted, lit or shown as a citizen.
   */
  readonly keepers?: readonly { readonly proposal: KeeperProposal; readonly site: KeeperPlaceSite; readonly round: KeeperRound }[];
}

/**
 * Kingdoms with a composition of their own, by broadcaster ID, loaded only when entered. A channel absent here
 * opens the shared potential composition.
 */
export const GENESIS_KINGDOMS: Readonly<Record<string, () => Promise<{ composeGenesisKingdom(input: GenesisKingdomInput): Promise<GenesisKingdomComposition> }>>> = {
  '63920635': () => import('./kingdoms/aggman/index'),
  '4363967': () => import('./kingdoms/pinkkitty/index'),
  '63920635': () => import('./kingdoms/aggman/index'),
};
