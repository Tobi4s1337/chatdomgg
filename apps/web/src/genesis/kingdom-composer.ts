import type { SettlementPlan } from '@chatdom/world';
import type { ChannelKingdomRecipe, DeepReadonly, GenesisLandscape } from '@chatdom/world/genesis';
import type { PotentialKingdomView } from '../kingdom/scene';
import type { GenesisSeatContent } from './seat-content';

/** What a kingdom's own composition reads: its compiled recipe, the selected land and the proposed settlement. */
export interface GenesisKingdomInput {
  readonly recipe: DeepReadonly<ChannelKingdomRecipe>;
  readonly landscape: DeepReadonly<GenesisLandscape>;
  readonly plan: SettlementPlan;
  /** Channel-bound, use-specific approved emote derivatives supplied by the facts adapter; absent means none. */
  readonly emoteDerivatives?: readonly unknown[];
}

/** A kingdom's authored additions to its potential view. Every field is optional; absent means the shared default. */
export interface GenesisKingdomComposition {
  readonly plan?: SettlementPlan;
  readonly seat?: GenesisSeatContent;
  readonly camera?: PotentialKingdomView['camera'];
}

export interface GenesisKingdomComposer {
  readonly broadcasterId: string;
  compose(input: GenesisKingdomInput): GenesisKingdomComposition;
}

/** Each finished Genesis kingdom lives in `./kingdoms/<name>/index.ts` and exports `kingdom`. */
const modules = import.meta.glob<{ kingdom: GenesisKingdomComposer }>('./kingdoms/*/index.ts', { eager: true });
const composers = Object.values(modules).map(module => module.kingdom);

export function genesisKingdomComposer(broadcasterId: string): GenesisKingdomComposer | undefined {
  return composers.find(composer => composer.broadcasterId === broadcasterId);
}
