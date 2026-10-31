import { describe, expect, it } from 'vitest';
import { KingdomIdSchema } from '@chatdom/shared';
import { naturalLandHeight } from '../kingdom-land/surface';
import { compileChannelGenesis, GENESIS_LIMITS, resolveGenesisEntry, sampleGenesisSurface, type ChannelGenesisFacts } from './index';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from './observed-fixtures';

const id = KingdomIdSchema.parse('9007199254740993');
const digest = 'a'.repeat(64);
/** Entirely SIMULATED compiler inputs; no real channel metrics, approvals or founding claimed. */
function facts(): ChannelGenesisFacts {
  return {
    version: 1, broadcasterId: id,
    evidence: { kind: 'simulated', sourceId: 'genesis-unit-test', asOf: 1793404800000, label: 'SIMULATED' },
    audience: { averageViewers: 8, followers: null, windowHours: 720 },
    categories: [
      { categoryId: '1', name: 'Sea of Thieves', observedMinutes: 80 },
      { categoryId: '2', name: 'Just Chatting', observedMinutes: 20 },
    ],
    profileColours: ['#6B9E94'],
    approvedEmotes: [
      { emoteId: 'emote-a', broadcasterId: id, asset: { assetHash: digest, approvalId: 'simulated-approval-a' }, allowedUses: ['stained-glass'] },
      { emoteId: 'emote-b', broadcasterId: id, asset: { assetHash: digest, approvalId: 'simulated-approval-b' }, allowedUses: ['statue', 'weathervane'] },
    ],
    approvedDescription: null, oldestFollowYear: 2019,
  };
}

describe('channel Genesis recipe', () => {
  it('keeps identity and byte output stable across source order, precision and unrelated changes', () => {
    const input = facts(), recipe = compileChannelGenesis(input);
    const reordered = { ...input, categories: [...input.categories].reverse(), approvedEmotes: [...input.approvedEmotes].reverse() };
    expect(JSON.stringify(compileChannelGenesis(reordered))).toBe(JSON.stringify(recipe));
    expect(recipe.kingdomId).toBe('9007199254740993');
    const other = { ...facts(), broadcasterId: KingdomIdSchema.parse('9007199254740992'), approvedEmotes: [] };
    expect(compileChannelGenesis(other).landscapes).not.toEqual(recipe.landscapes);
    const changed = { ...facts(), audience: { averageViewers: 9000, followers: 500000, windowHours: 720 }, categories: [], profileColours: [] };
    expect(compileChannelGenesis(changed).landscapes).toEqual(recipe.landscapes);
    expect(compileChannelGenesis(changed).recommendedLandscapeId).toBe(recipe.recommendedLandscapeId);
    expect(Object.isFrozen(recipe.landscapes[0].terrainCore.hills[0])).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(new TextEncoder().encode(JSON.stringify(recipe)).length).toBeLessThan(GENESIS_LIMITS.recipeBytes);
  });

  it('covers all Atlas sizes without turning capacity or followers into people', () => {
    const rows = [
      [0, 'hamlet', 16], [24.99, 'hamlet', 16], [25, 'village', 48], [49.99, 'village', 48],
      [50, 'town', 160], [499.99, 'town', 160], [500, 'city', 512], [4999.99, 'city', 512], [5000, 'capital', 1536],
    ] as const;
    for (const [averageViewers, tier, capacity] of rows) {
      const recipe = compileChannelGenesis({ ...facts(), audience: { averageViewers, followers: 1000000, windowHours: 720 } });
      expect(recipe.size.tier).toBe(tier);
      expect(recipe.size.homeCapacity).toBe(capacity);
      expect(recipe.size.cathedralSite).toBe(tier === 'city' || tier === 'capital');
      expect(recipe.soul.population).toBe('real-presence-only');
      expect(recipe.soul.keepers.every(keeper => !keeper.carriesPresenceLight)).toBe(true);
    }
    const unknown = compileChannelGenesis({ ...facts(), audience: { averageViewers: null, followers: 1000000, windowHours: 720 }, oldestFollowYear: null });
    expect(unknown.size).toMatchObject({ tier: 'hamlet', basis: 'unknown', followerGrowthHint: 1000000 });
    expect(unknown.soul.oldRow.oldestFollowYear).toBeNull();
  });

  it('produces all three landscape compositions with downstream river levels and sampler-compatible cores', () => {
    const recipe = compileChannelGenesis(facts());
    expect(new Set(recipe.landscapes.map(land => land.character))).toEqual(new Set(['coastal-harbour', 'river-valley', 'mountain-pass']));
    for (const landscape of recipe.landscapes) {
      const river = landscape.terrainCore.streams[0]!;
      for (let i = 1; i < river.points.length; i++) {
        expect(river.points[i]!.level).toBeLessThanOrEqual(river.points[i - 1]!.level);
        expect(river.points[i]!.bed).toBeLessThan(river.points[i]!.level);
      }
      for (const place of landscape.places) {
        expect(Number.isFinite(naturalLandHeight(landscape.terrainCore, ...place.anchor))).toBe(true);
      }
      const mouth = river.points.at(-1)!;
      expect(naturalLandHeight(landscape.terrainCore, ...mouth.position)).toBeLessThan(0);
      expect(landscape.surfaceCompiler).toBe('genesis-coast-1');
      expect(landscape.islands.length).toBeGreaterThan(0);
      for (const island of landscape.islands) {
        const dry = sampleGenesisSurface(landscape, ...island.centre);
        expect(dry.water).toBeNull();
        expect(dry.ground).toBeGreaterThan(0);
        const wet = sampleGenesisSurface(landscape, island.centre[0] + island.radiusX * 2, island.centre[1]);
        expect(wet.water).toBe('ocean');
        expect(wet.ground).toBeLessThan(0);
      }
      expect(landscape.places.some(place => place.id === 'old-row' && place.name === 'Old Row')).toBe(true);
    }
    const observed = OBSERVED_GENESIS_FIXTURES.map(input => compileChannelGenesis(input));
    expect(observed.map(recipe => recipe.size.tier)).toEqual(['hamlet', 'town', 'city']);
    expect(observed.map((recipe, i) => recipe.landscapes.find(land => land.character === OBSERVED_GENESIS_SHOWCASE_CHOICES[i]!.character)!.character))
      .toEqual(['coastal-harbour', 'river-valley', 'mountain-pass']);
    expect(observed.map(recipe => recipe.identity.biome)).toEqual(['coastal', 'meadow', 'highland']);
    expect(observed.every(recipe => recipe.identity.emoteWorks.length === 0 && recipe.identity.description === null)).toBe(true);
  });

  it('keeps source text out, respects derivative approval scope, and never regenerates an adopted kingdom', () => {
    const recipe = compileChannelGenesis(facts());
    expect(recipe.identity.emoteWorks.find(work => work.use === 'statue')?.emoteId).toBe('emote-b');
    expect(recipe.identity.emoteWorks.find(work => work.use === 'stained-glass')?.emoteId).toBe('emote-a');
    expect(recipe.identity.biome).toBe('coastal');
    expect(JSON.stringify(recipe)).not.toContain('Sea of Thieves');
    expect(() => compileChannelGenesis({ ...facts(), rawDescription: '<script>unsafe</script>' })).toThrow();
    expect(() => compileChannelGenesis({ ...facts(), approvedDescription: { broadcasterId: '2', sourceHash: digest, motto: null, lore: null } })).toThrow();
    expect(() => compileChannelGenesis({ ...facts(), categories: [...facts().categories, facts().categories[0]] })).toThrow();
    const manifest = { version: 1, kingdomId: id, origin: 'live', layoutRevision: 'willowmere-adopted', collisionRevision: 12, sceneHash: digest };
    expect(resolveGenesisEntry({ broadcasterId: id }, manifest)).toEqual({ kind: 'adopted', manifest });
    expect(() => resolveGenesisEntry(facts(), { ...manifest, sceneHash: 'corrupt' })).toThrow();
    expect(() => resolveGenesisEntry(facts(), { ...manifest, kingdomId: '2' })).toThrow();
    expect(resolveGenesisEntry(facts(), null)).toMatchObject({ kind: 'potential', label: 'Unfounded land', canSettle: false });
  });
});
