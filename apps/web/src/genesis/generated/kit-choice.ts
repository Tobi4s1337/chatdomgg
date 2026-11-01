import type { SettlementPlan } from '@chatdom/world';
import type { ChannelKingdomRecipe, DeepReadonly, GenesisLandscape } from '@chatdom/world/genesis';
import { chooseRoofFamily } from '../../../../../packages/content/src/genesis-kingdoms/masha/roofs';
import { unit } from '../holding-facts';

export type KingdomKit = 'hearth' | 'tide' | 'grove';
const KITS: readonly KingdomKit[] = ['hearth', 'tide', 'grove'];

/**
 * Which of the three building kits a generated kingdom is built in: terracotta and plaster (Hearth), slate and
 * cream (Tide), thatch and honey (Grove). The kit carries the roofs, walls, trim, the castle's stone and the trees,
 * so it is the largest single difference between two towns seen at dusk.
 *
 * Three things decide it, in this order of weight: the land (a harbour leans to slate, a river valley to thatch and
 * terracotta, a pass to terracotta and slate), the realm's biome (a woodland realm leans to thatch), and the holding's
 * Atlas arms (the kit whose roof sits nearest the shield's tinctures in OKLab, the rule MashaD4's roofs follow). The
 * channel's own seed rolls among those weights, so every kit appears in every land and two channels of one game do
 * not build alike.
 *
 * Just over half the towns grew in two kits: the old town round the market in the first, the outer lanes in the
 * second, the way a real town's newer streets change their roofs.
 */
export interface KitChoice {
  readonly primary: KingdomKit;
  /** The outer lanes' kit, or null for a town built in one kit throughout. */
  readonly secondary: KingdomKit | null;
  /** The share of homes, farthest from the market first, built in the secondary kit. */
  readonly share: number;
  readonly weights: Readonly<Record<KingdomKit, number>>;
}

const LAND_LEAN: Readonly<Record<GenesisLandscape['character'], Readonly<Record<KingdomKit, number>>>> = {
  'coastal-harbour': { tide: .5, hearth: .3, grove: .2 },
  'river-valley': { grove: .36, hearth: .42, tide: .22 },
  'mountain-pass': { hearth: .42, tide: .36, grove: .22 },
};
const BIOME_LEAN: Readonly<Record<ChannelKingdomRecipe['identity']['biome'], Readonly<Partial<Record<KingdomKit, number>>>>> = {
  coastal: { tide: 1.3 },
  woodland: { grove: 1.35 },
  highland: { tide: 1.2 },
  meadow: { hearth: 1.3 },
};
/** How strongly the arms pull: the kit nearest the shield's colours counts about half again the farthest. */
const ARMS_PULL = 1.3;

export function chooseKingdomKit(recipe: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>, armsTargets: readonly string[]): KitChoice {
  const roofs = chooseRoofFamily(armsTargets, recipe.identity.styleFamily);
  const nearest = Math.min(...KITS.map(kit => roofs.distances[kit]));
  const spread = Math.max(1e-6, Math.max(...KITS.map(kit => roofs.distances[kit])) - nearest);
  const weights = Object.fromEntries(KITS.map(kit => {
    const arms = roofs.basis === 'profile-colour-targets' ? Math.exp(-ARMS_PULL * (roofs.distances[kit] - nearest) / spread) * 2 / (1 + Math.exp(-ARMS_PULL)) : 1;
    return [kit, LAND_LEAN[landscape.character][kit] * (BIOME_LEAN[recipe.identity.biome][kit] ?? 1) * arms];
  })) as Record<KingdomKit, number>;
  const primary = pick(weights, unit(`${recipe.seedKey}/kit/primary`));
  const rest = Object.fromEntries(KITS.filter(kit => kit !== primary).map(kit => [kit, weights[kit]])) as Record<KingdomKit, number>;
  // A hamlet or a village is one street: it keeps one kit.
  const mixed = recipe.size.homeCapacity >= 160 && unit(`${recipe.seedKey}/kit/mixed`) < .55;
  const secondary = mixed ? pick(rest, unit(`${recipe.seedKey}/kit/secondary`)) : null;
  const share = secondary ? Math.round((.28 + unit(`${recipe.seedKey}/kit/share`) * .2) * 100) / 100 : 0;
  return { primary, secondary, share, weights };
}

function pick(weights: Readonly<Partial<Record<KingdomKit, number>>>, roll: number): KingdomKit {
  const entries = KITS.filter(kit => weights[kit] !== undefined).map(kit => [kit, weights[kit]!] as const);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let left = roll * total;
  for (const [kit, weight] of entries) { left -= weight; if (left < 0) return kit; }
  return entries[entries.length - 1]![0];
}

/**
 * The plan with its outer lanes in the secondary kit: the homes farthest from the market, by the choice's share. The
 * revision records the change, so nothing keyed by the plan confuses the two.
 */
export function applyKit(plan: SettlementPlan, choice: KitChoice): SettlementPlan {
  if (!choice.secondary || !choice.share) return plan;
  const market = plan.nodes.find(node => node.id === plan.market.nodeId)!.position;
  const order = plan.homes.map((home, index) => ({ index, d: Math.hypot(home.position[0] - market[0], home.position[2] - market[2]) }))
    .sort((a, b) => b.d - a.d || a.index - b.index);
  const outer = new Set(order.slice(0, Math.round(plan.homes.length * choice.share)).map(item => item.index));
  const secondary = choice.secondary;
  return { ...plan, homes: plan.homes.map((home, index) => outer.has(index) ? { ...home, style: secondary } : home),
    revision: `${plan.revision}:kit:${choice.primary}+${secondary}@${choice.share}` };
}
