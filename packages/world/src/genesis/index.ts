import { RealmFoundedManifestSchema } from '@chatdom/shared/realm';
import {
  ChannelGenesisFactsSchema, GENESIS_LIMITS, GENESIS_VERSION,
  type ChannelGenesisFacts, type ChannelKingdomRecipe, type DeepReadonly, type GenesisBiome,
  type GenesisEntryDecision, type GenesisLandmark, type GenesisSize, type GenesisTier,
} from './contracts';
import { compileLandscape, draw } from './landscape';

export * from './contracts';
export { sampleGenesisSurface } from './surface';
export { compileGenesisSettlement } from './settlement';

const TIERS: readonly GenesisTier[] = ['hamlet', 'village', 'town', 'city', 'capital'];
const HOMES = [16, 48, 160, 512, 1536] as const;
const WARDS = [1, 1, 3, 8, 24] as const;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function sizeFor(facts: ChannelGenesisFacts): GenesisSize {
  const { averageViewers, followers } = facts.audience;
  // Atlas §4.2 is the established size contract. Followers never silently redefine its bands.
  const index = averageViewers === null ? 0 : [25, 50, 500, 5000].filter(limit => averageViewers >= limit).length;
  return {
    tier: TIERS[index]!,
    basis: averageViewers === null ? 'unknown' : 'average',
    homeCapacity: HOMES[index]!, wards: WARDS[index]!, cathedralSite: index >= 3, followerGrowthHint: followers, growth: 'append-only',
  };
}

/** Curated interpretation, not a factual claim about a community or its history. Unknown games stay neutral. */
const CATEGORY_THEMES: Readonly<Record<string, readonly [GenesisBiome, GenesisLandmark]>> = {
  'just chatting': ['meadow', 'open-air-stage'],
  'art': ['woodland', 'bell-garden'],
  'music': ['meadow', 'open-air-stage'],
  'minecraft': ['woodland', 'stone-circle'],
  'stardew valley': ['meadow', 'watermill'],
  'sea of thieves': ['coastal', 'lighthouse'],
  'fishing': ['coastal', 'lighthouse'],
  'world of warcraft': ['highland', 'stone-circle'],
  'league of legends': ['highland', 'watchtower'],
  'dota 2': ['highland', 'watchtower'],
  'counter-strike 2': ['highland', 'watchtower'],
  'counter-strike': ['coastal', 'watchtower'],
  'retro': ['meadow', 'stone-circle'],
  'chess': ['highland', 'watchtower'],
  'elden ring': ['highland', 'bell-garden'],
  'dark souls iii': ['highland', 'bell-garden'],
};

function identityFor(facts: ChannelGenesisFacts, seedKey: string): ChannelKingdomRecipe['identity'] {
  const categories = [...facts.categories].sort((a, b) => b.observedMinutes - a.observedMinutes || compare(a.categoryId, b.categoryId));
  const primary = categories.find(category => Object.hasOwn(CATEGORY_THEMES, category.name.trim().toLowerCase()));
  const theme = primary ? CATEGORY_THEMES[primary.name.trim().toLowerCase()]! : ['meadow', 'bell-garden'] as const;
  const [biome, landmark] = theme;
  const emoteWorks: ChannelKingdomRecipe['identity']['emoteWorks'][number][] = [];
  const emotes = [...facts.approvedEmotes].sort((a, b) => compare(a.emoteId, b.emoteId));
  // An approved glass derivative is not automatically an approved three-metre statue.
  for (const use of ['statue', 'weathervane', 'stained-glass'] as const) {
    const eligible = emotes.filter(emote => emote.allowedUses.includes(use));
    if (!eligible.length) continue;
    const chosen = eligible[Math.floor(draw(seedKey, `emote/${use}`) * eligible.length)]!;
    emoteWorks.push({ emoteId: chosen.emoteId, use, asset: { ...chosen.asset } });
  }
  return {
    biome, landmark, categoryBasis: primary ? [primary.categoryId] : [],
    styleFamily: biome === 'coastal' ? 'tide' : biome === 'woodland' ? 'grove' : 'hearth',
    profileColourTargets: [...new Set(facts.profileColours.map(colour => colour.toLowerCase()))],
    crest: {
      shape: (['heater', 'round', 'swallowtail'] as const)[Math.floor(draw(seedKey, 'crest/shape') * 3)]!,
      charge: biome === 'coastal' ? 'wave' : biome === 'woodland' ? 'oak' : biome === 'highland' ? 'mountain' : 'star',
      seedKey: `${seedKey}/crest`,
    },
    banner: { cut: (['square', 'forked', 'pennant'] as const)[Math.floor(draw(seedKey, 'banner/cut') * 3)]!, seedKey: `${seedKey}/banner` },
    emoteWorks, description: facts.approvedDescription,
  };
}

function freezeDeep<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** No I/O, model, clock, global RNG, adoption, allocations or synthetic presence. */
export function compileChannelGenesis(input: unknown): DeepReadonly<ChannelKingdomRecipe> {
  const facts = ChannelGenesisFactsSchema.parse(input);
  const seedKey = `${GENESIS_VERSION}/broadcaster/${facts.broadcasterId}`;
  const keeperNames = ['Mallow', 'Brindle', 'Rowan', 'Tansy', 'Pip', 'Hazel'];
  const keeperName = (role: string) => keeperNames[Math.floor(draw(seedKey, `keeper/${role}`) * keeperNames.length)]!;
  const identity = identityFor(facts, seedKey);
  const size = sizeFor(facts);
  const landscapes = [compileLandscape(seedKey, 0), compileLandscape(seedKey, 1), compileLandscape(seedKey, 2)] as const;
  const recipe: ChannelKingdomRecipe = {
    version: GENESIS_VERSION, kingdomId: facts.broadcasterId, seedKey, evidence: facts.evidence,
    status: 'potential', size, identity,
    recommendedLandscapeId: landscapes[0].id,
    landscapes,
    soul: {
      oldRow: { name: 'Old Row', oldestFollowYear: facts.oldestFollowYear, allocation: 'follow-year-then-sub-months-once' },
      keepers: [
        { role: 'innkeeper', name: keeperName('innkeeper'), placeId: 'tavern', carriesPresenceLight: false },
        { role: 'lamplighter', name: keeperName('lamplighter'), placeId: 'plaza', carriesPresenceLight: false },
      ],
      history: 'witnessed-facts-only', weatherSeedKey: `${seedKey}/weather`, clock: 'realm-time',
      soundscape: identity.biome, population: 'real-presence-only',
    },
  };
  // A checked upper bound on the control payload; asset bytes and scene geometry are separate.
  if (new TextEncoder().encode(JSON.stringify(recipe)).byteLength > GENESIS_LIMITS.recipeBytes) throw new Error('Genesis recipe exceeds its byte budget.');
  return freezeDeep(recipe);
}

/**
 * Read-only routing guard. Call with a trusted manifest lookup. Corrupt/mismatched adopted records fail;
 * they NEVER fall through to regenerated land. Neither result authorizes entry, publishing or founding.
 */
export function resolveGenesisEntry(input: unknown, adoptedManifest: unknown | null): GenesisEntryDecision {
  if (adoptedManifest !== null) {
    const manifest = RealmFoundedManifestSchema.parse(adoptedManifest);
    // Only identity is needed; an adopted kingdom must open even when a profile/category fetch is down.
    const broadcasterId = ChannelGenesisFactsSchema.shape.broadcasterId.parse(
      typeof input === 'object' && input !== null && 'broadcasterId' in input ? input.broadcasterId : undefined,
    );
    if (manifest.kingdomId !== broadcasterId) throw new Error('Adopted kingdom identity disagrees with the channel.');
    return { kind: 'adopted', manifest };
  }
  return { kind: 'potential', recipe: compileChannelGenesis(input), label: 'Unfounded land', canSettle: false };
}
