import { ChannelGenesisFactsSchema, GENESIS_ATLAS_REALMS, type ChannelGenesisFacts, type ChannelKingdomRecipe, type DeepReadonly, type GenesisAtlasRealm, type GenesisLandscape } from '@chatdom/world/genesis';
import type { DoorHolding } from '../atlas/data/holding';

/**
 * The Genesis facts the Atlas survey supports for one holding, and nothing more: the observed average over the
 * survey's window, its most streamed game and the realm it stands in. The survey has no profile colours,
 * description, followers or emote approvals, so those stay empty rather than invented.
 */
export function holdingFacts(holding: DoorHolding): ChannelGenesisFacts {
  const realm: GenesisAtlasRealm | undefined = holding.realm.kind === 'family'
    ? (GENESIS_ATLAS_REALMS as readonly string[]).includes(holding.realm.family ?? '') ? holding.realm.family as GenesisAtlasRealm : undefined
    : (GENESIS_ATLAS_REALMS as readonly string[]).includes(holding.realm.kind) ? holding.realm.kind as GenesisAtlasRealm : undefined;
  const windowMinutes = Math.max(1, Math.round(holding.survey.windowHours * 60));
  return ChannelGenesisFactsSchema.parse({
    version: 1, broadcasterId: holding.id,
    evidence: { kind: 'observed', sourceId: holding.survey.revision, asOf: holding.survey.asOf },
    audience: { averageViewers: holding.average, followers: null, windowHours: holding.survey.windowHours },
    // The projection names the dominant game but not its minutes; as the only category its order is all it decides,
    // so it is recorded against the survey's whole window, which is an upper bound and claims nothing finer.
    categories: holding.game ? [{ categoryId: holding.game.id ?? `atlas-game:${slug(holding.game.name)}`, name: holding.game.name, observedMinutes: windowMinutes }] : [],
    profileColours: [], approvedEmotes: [], approvedDescription: null, oldestFollowYear: null,
    ...(realm ? { atlasRealm: realm } : {}),
  });
}

const slug = (text: string): string => (text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed').slice(0, 100);

/** How strongly each biome draws each landscape, before the channel's own seeded draw picks one. */
const PREFERENCE: Readonly<Record<ChannelKingdomRecipe['identity']['biome'], Readonly<Record<GenesisLandscape['character'], number>>>> = {
  coastal: { 'coastal-harbour': .72, 'river-valley': .18, 'mountain-pass': .10 },
  highland: { 'mountain-pass': .66, 'river-valley': .16, 'coastal-harbour': .18 },
  meadow: { 'river-valley': .62, 'coastal-harbour': .22, 'mountain-pass': .16 },
  woodland: { 'river-valley': .5, 'mountain-pass': .3, 'coastal-harbour': .2 },
};

/**
 * Pick one of the recipe's three seeded candidates: the biome leans the choice (a shooter's holding is usually in the
 * hills, an isle's on the sea) and the broadcaster's own seed decides, so two channels of one game do not all stand in
 * the same kind of land. Deterministic for a channel and its facts.
 */
export function chooseLandscape(recipe: DeepReadonly<ChannelKingdomRecipe>): DeepReadonly<GenesisLandscape> {
  const weights = PREFERENCE[recipe.identity.biome];
  let roll = unit(`${recipe.seedKey}/landscape-choice`);
  for (const landscape of recipe.landscapes) {
    roll -= weights[landscape.character];
    if (roll < 0) return landscape;
  }
  return recipe.landscapes.find(landscape => landscape.id === recipe.recommendedLandscapeId) ?? recipe.landscapes[0];
}

/** FNV-1a over the key, into [0, 1). */
export function unit(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  hash ^= hash >>> 13; hash = Math.imul(hash, 0x5bd1e995); hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296;
}
