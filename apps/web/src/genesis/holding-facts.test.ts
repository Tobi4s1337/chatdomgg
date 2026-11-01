import { describe, expect, it } from 'vitest';
import { compileChannelGenesis } from '@chatdom/world/genesis';
import { OBSERVED_GENESIS_FIXTURES } from '@chatdom/world/genesis/observed';
import { holdingPlace, type DoorHolding } from '../atlas/data/holding';
import { chooseLandscape, holdingFacts } from './holding-facts';

const holding = (over: Partial<DoorHolding> = {}): DoorHolding => ({
  version: 1, id: '71092938', login: 'example', name: 'Example', freshUntil: 1793540000000, tier: 'town', average: 312.4,
  game: { id: '32399', name: 'Counter-Strike' },
  realm: { kind: 'family', family: 'shooters', name: 'Shooters' }, region: { language: 'en', name: 'English' }, x: 10, y: -4,
  survey: { preview: 'pv-1', revision: 'obs-20261031T133817Z-82eb04a53567', asOf: 1793453897230, windowHours: 45.89 },
  ...over,
});

describe('a holding’s Genesis facts', () => {
  it('carries only what the survey observed', () => {
    const facts = holdingFacts(holding());
    expect(facts.audience).toEqual({ averageViewers: 312.4, followers: null, windowHours: 45.89 });
    expect(facts.categories).toEqual([{ categoryId: '32399', name: 'Counter-Strike', observedMinutes: 2753 }]);
    expect(facts.profileColours).toEqual([]);
    expect(facts.approvedEmotes).toEqual([]);
    expect(facts.approvedDescription).toBeNull();
    expect(facts.atlasRealm).toBe('shooters');
    expect(facts.evidence).toEqual({ kind: 'observed', sourceId: 'obs-20261031T133817Z-82eb04a53567', asOf: 1793453897230 });
  });

  it('sizes the land by the Atlas thresholds', () => {
    const tiers = [10, 30, 120, 900, 6000].map(average => compileChannelGenesis(holdingFacts(holding({ average }))).size.tier);
    expect(tiers).toEqual(['hamlet', 'village', 'town', 'city', 'capital']);
  });

  it('reads an unknown game through its realm, and a game without a category ID by name', () => {
    const facts = holdingFacts(holding({ game: { id: null, name: 'Some Unlisted Game: Deluxe' }, realm: { kind: 'isle', family: null, name: 'Polski' } }));
    expect(facts.categories[0]!.categoryId).toBe('atlas-game:some-unlisted-game-deluxe');
    const recipe = compileChannelGenesis(facts);
    expect(recipe.identity.biome).toBe('coastal');
    expect(recipe.identity.landmark).toBe('lighthouse');
    expect(compileChannelGenesis(holdingFacts(holding({ game: null, realm: { kind: 'family', family: 'cozy', name: 'Cozy & Party' } }))).identity.landmark).toBe('watermill');
  });

  it('leaves the three recorded fixtures exactly as they were', () => {
    expect(OBSERVED_GENESIS_FIXTURES.map(facts => compileChannelGenesis(facts).identity.biome)).toEqual(['coastal', 'meadow', 'highland']);
    expect(OBSERVED_GENESIS_FIXTURES.every(facts => !('atlasRealm' in facts))).toBe(true);
  });

  it('names where the holding stands', () => {
    expect(holdingPlace(holding())).toBe('A town in the realm of Shooters');
    expect(holdingPlace(holding({ tier: 'village', realm: { kind: 'isle', family: null, name: 'Polski' }, region: { language: 'pl', name: 'Polish' } }))).toBe('A village on the isle of Polish');
    expect(holdingPlace(holding({ tier: 'city', realm: { kind: 'crossroads', family: null, name: 'The Crossroads' } }))).toBe('A city in The Crossroads');
  });
});

describe('choosing the land', () => {
  it('leans to the biome but lets each channel’s seed decide', () => {
    const counts = { 'coastal-harbour': 0, 'river-valley': 0, 'mountain-pass': 0 };
    for (let i = 0; i < 300; i++) {
      const recipe = compileChannelGenesis(holdingFacts(holding({ id: String(1_000_003 + i * 7_919), game: { id: '516575', name: 'VALORANT' } })));
      counts[chooseLandscape(recipe).character]++;
    }
    expect(counts['mountain-pass']).toBeGreaterThan(150);
    expect(counts['coastal-harbour']).toBeGreaterThan(20);
    expect(counts['river-valley']).toBeGreaterThan(20);
  });

  it('is the same land every time for a channel', () => {
    const a = chooseLandscape(compileChannelGenesis(holdingFacts(holding())));
    const b = chooseLandscape(compileChannelGenesis(holdingFacts(holding({ average: 4000, game: { id: '21779', name: 'League of Legends' } }))));
    expect(a.id.split('/landscape/')[0]).toBe(b.id.split('/landscape/')[0]);
    expect(chooseLandscape(compileChannelGenesis(holdingFacts(holding()))).id).toBe(a.id);
  });
});
