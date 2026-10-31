import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GAMBLING_POLICY } from '../policy/visibility';
import { VARIETY_RULE, currentTaxonomy, currentTaxonomyText, loadTaxonomy, placementOf, type Placement } from './taxonomy';

// A small synthetic taxonomy: game IDs in the 1xxx–9xxx range are made up for the test and describe no real category.
interface TestTaxonomy {
  version: 1;
  kind: string;
  id: string;
  review: { status: 'proposed' | 'reviewed'; proposedAt: string; basis: string; reviewedBy: string | null; reviewedAt: string | null };
  families: { id: string; name: string; realmName: string; games: { gameId: string; name: string }[] }[];
  unassigned: { gameId: string; name: string; why: string }[];
  notes: string[];
}

function testTaxonomy(): TestTaxonomy {
  return {
    version: 1,
    kind: 'chatdom-atlas-family-taxonomy',
    id: 'families-90',
    review: { status: 'proposed', proposedAt: '2026-10-30', basis: 'Synthetic test taxonomy.', reviewedBy: null, reviewedAt: null },
    families: [
      { id: 'blasters', name: 'Blasters', realmName: 'The Test Ramparts', games: [{ gameId: '1001', name: 'Blaster A' }, { gameId: '1002', name: 'Blaster B' }, { gameId: '1003', name: 'Blaster C' }] },
      { id: 'tacticians', name: 'Tacticians', realmName: 'The Test Marches', games: [{ gameId: '2001', name: 'Tactics A' }] },
      { id: 'puzzlers', name: 'Puzzlers', realmName: 'The Test Mazes', games: [{ gameId: '3001', name: 'Puzzle A' }] },
    ],
    unassigned: [{ gameId: '9001', name: 'Unfiled A', why: 'no family yet' }, { gameId: '9002', name: 'Unfiled B', why: 'no family yet' }],
    notes: [],
  };
}

const text = (taxonomy: TestTaxonomy) => JSON.stringify(taxonomy, null, 2);
const familyOf = loadTaxonomy(text(testTaxonomy())).familyOf;
const place = (minutes: Record<string, number>): Placement =>
  placementOf(Object.entries(minutes).map(([gameId, value]) => ({ gameId, minutes: value })), familyOf);

const BLASTERS: Placement = { kind: 'family', family: 0 };
const TACTICIANS: Placement = { kind: 'family', family: 1 };
const VARIETY: Placement = { kind: 'variety' };
const UNASSIGNED: Placement = { kind: 'unassigned' };

describe('placementOf: a channel’s family from its accumulated category minutes', () => {
  it('adds up the minutes of every game in a family, so several smaller games beat one bigger game elsewhere', () => {
    // 3 × 40 = 120 Blasters minutes against a single 100-minute Tacticians game.
    expect(place({ 1001: 40, 1002: 40, 1003: 40, 2001: 100 })).toEqual(BLASTERS);
    // The same channel judged game by game would have gone to Tacticians.
    expect(place({ 1001: 40, 2001: 100 })).toEqual(TACTICIANS);
  });

  it('counts a family as one community for variety: two games of one family cannot make a channel varied', () => {
    // As four separate games this would be variety (30/25/22.5/22.5 %), but Blasters together hold 55 %.
    expect(place({ 1001: 60, 1002: 50, 2001: 45, 3001: 45 })).toEqual(BLASTERS);
    // Spread over three families it is variety.
    expect(place({ 1001: 45, 1002: 45, 2001: 60, 3001: 50 })).toEqual(VARIETY);
  });

  it('counts every unassigned or unknown game as its own community', () => {
    expect(place({ 9001: 90, 9002: 60, 7777: 50 })).toEqual(VARIETY);
    expect(place({ 9001: 101, 9002: 50, 7777: 49 })).toEqual(UNASSIGNED);
  });

  it(`applies ${VARIETY_RULE.id} at the minimum of ${VARIETY_RULE.minMinutes} minutes, and not one below`, () => {
    expect(VARIETY_RULE).toEqual({ id: 'variety-1', minMinutes: 120, maxTopShare: 0.5, minCommunities: 3, communityShare: 0.12 });
    expect(place({ 1001: 54, 2001: 36, 3001: 30 })).toEqual(VARIETY);
    expect(place({ 1001: 53.5, 2001: 36, 3001: 30 })).toEqual(BLASTERS);
    // Exactly the same shares, scaled below two hours.
    expect(place({ 1001: 54 * (119 / 120), 2001: 36 * (119 / 120), 3001: 30 * (119 / 120) })).toEqual(BLASTERS);
  });

  it('is variety only while the top community holds less than half: exactly 50 % keeps the family', () => {
    expect(place({ 1001: 100, 2001: 50, 3001: 50 })).toEqual(BLASTERS);
    expect(place({ 1001: 99, 2001: 51, 3001: 50 })).toEqual(VARIETY);
  });

  it('needs three communities of at least 12 % each: exactly 12 % counts, just under does not', () => {
    expect(place({ 1001: 98, 2001: 78, 3001: 24 })).toEqual(VARIETY);
    expect(place({ 1001: 98, 2001: 78.1, 3001: 23.9 })).toEqual(BLASTERS);
    // Two strong communities and a scattered tail are not variety, however spread the tail is.
    expect(place({ 1001: 98, 2001: 82, 3001: 10, 9001: 10, 9002: 10, 7777: 10 })).toEqual(BLASTERS);
    // A fourth community does not hurt.
    expect(place({ 1001: 80, 2001: 60, 3001: 40, 9001: 20 })).toEqual(VARIETY);
  });

  it('places a channel whose top community is an unassigned or unknown game in the Wilds (unassigned)', () => {
    expect(place({ 9001: 80, 2001: 40 })).toEqual(UNASSIGNED);
    expect(place({ 123456: 300, 1001: 100 })).toEqual(UNASSIGNED);
    expect(place({})).toEqual(UNASSIGNED);
    expect(place({ 1001: 0 })).toEqual(UNASSIGNED);
  });

  it('ignores zero, negative and non-numeric minutes', () => {
    expect(place({ 2001: 10, 1001: 0, 3001: -500 })).toEqual(TACTICIANS);
    expect(place({ 2001: 10, 1001: Number.NaN })).toEqual(TACTICIANS);
  });

  it('breaks ties deterministically, whatever order the categories arrive in', () => {
    const permutations = <T>(items: T[]): T[][] => (items.length <= 1 ? [items] : items.flatMap((item, i) =>
      permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])));
    const cases: [Record<string, number>, Placement][] = [
      // A family beats an unassigned game with equal minutes.
      [{ 9001: 60, 2001: 60 }, TACTICIANS],
      // Between families, the lower family index.
      [{ 3001: 60, 2001: 60 }, TACTICIANS],
      [{ 2001: 70, 1001: 70 }, BLASTERS],
      // Between unassigned games the lower game ID wins; either way the channel is in the Wilds.
      [{ 9002: 60, 9001: 60, 3001: 10 }, UNASSIGNED],
    ];
    for (const [minutes, expected] of cases) {
      for (const order of permutations(Object.entries(minutes))) {
        expect(placementOf(order.map(([gameId, value]) => ({ gameId, minutes: value })), familyOf)).toEqual(expected);
      }
    }
  });
});

describe('loadTaxonomy: the checked-in schema', () => {
  it('reads a valid proposal and maps every game to its family', () => {
    const loaded = loadTaxonomy(text(testTaxonomy()));
    expect([...loaded.familyOf.entries()].sort()).toEqual([['1001', 0], ['1002', 0], ['1003', 0], ['2001', 1], ['3001', 2]]);
    expect(loaded.familyOf.has('9001')).toBe(false);
    expect(loaded.ref).toMatchObject({ id: 'families-90', status: 'proposed' });
  });

  it('refuses a gambling category in a family or among the unassigned games', () => {
    const inFamily = testTaxonomy();
    inFamily.families[1]!.games.push({ gameId: '498566', name: 'Slots' });
    expect(() => loadTaxonomy(text(inFamily))).toThrow(/Gambling category 498566/);
    for (const gameId of GAMBLING_POLICY.gameIds) {
      const unassigned = testTaxonomy();
      unassigned.unassigned.push({ gameId, name: 'Gambling', why: 'test' });
      expect(() => loadTaxonomy(text(unassigned))).toThrow(new RegExp(`Gambling category ${gameId}`));
    }
  });

  it('refuses a game filed twice, within a family, across families or between a family and the unassigned list', () => {
    const twiceInFamily = testTaxonomy();
    twiceInFamily.families[0]!.games.push({ gameId: '1001', name: 'Blaster A again' });
    const acrossFamilies = testTaxonomy();
    acrossFamilies.families[2]!.games.push({ gameId: '2001', name: 'Tactics A' });
    const alsoUnassigned = testTaxonomy();
    alsoUnassigned.unassigned.push({ gameId: '3001', name: 'Puzzle A', why: 'test' });
    for (const taxonomy of [twiceInFamily, acrossFamilies, alsoUnassigned]) expect(() => loadTaxonomy(text(taxonomy))).toThrow(/appears twice/);
  });

  it('refuses duplicate family IDs', () => {
    const taxonomy = testTaxonomy();
    taxonomy.families[2]!.id = 'blasters';
    expect(() => loadTaxonomy(text(taxonomy))).toThrow(/Family ids must be unique/);
  });

  it('accepts “reviewed” only with a reviewer and a date, and a proposal only without either', () => {
    const reviewed = (reviewedBy: string | null, reviewedAt: string | null, status: 'proposed' | 'reviewed' = 'reviewed') => {
      const taxonomy = testTaxonomy();
      taxonomy.review = { ...taxonomy.review, status, reviewedBy, reviewedAt };
      return text(taxonomy);
    };
    expect(() => loadTaxonomy(reviewed(null, null))).toThrow(/names its reviewer and date/);
    expect(() => loadTaxonomy(reviewed('test_reviewer', null))).toThrow(/names its reviewer and date/);
    expect(() => loadTaxonomy(reviewed(null, '2026-11-02'))).toThrow(/names its reviewer and date/);
    expect(() => loadTaxonomy(reviewed('test_reviewer', '2026-11-02', 'proposed'))).toThrow(/names its reviewer and date/);
    expect(loadTaxonomy(reviewed('test_reviewer', '2026-11-02')).ref.status).toBe('reviewed');
  });

  it('refuses unknown fields and a wrong kind', () => {
    expect(() => loadTaxonomy(JSON.stringify({ ...testTaxonomy(), approvedByFounder: true }))).toThrow();
    expect(() => loadTaxonomy(JSON.stringify({ ...testTaxonomy(), kind: 'something-else' }))).toThrow();
  });

  it('hashes the exact bytes: the same taxonomy written differently has a different reference', () => {
    const pretty = text(testTaxonomy());
    const compact = JSON.stringify(testTaxonomy());
    const sha = (value: string) => createHash('sha256').update(value).digest('hex');
    expect(loadTaxonomy(pretty).ref.sha256).toBe(sha(pretty));
    expect(loadTaxonomy(compact).ref.sha256).toBe(sha(compact));
    expect(loadTaxonomy(pretty).ref.sha256).not.toBe(loadTaxonomy(compact).ref.sha256);
    expect(loadTaxonomy(`${pretty}\n`).ref.sha256).toBe(sha(`${pretty}\n`));
  });
});

describe('the checked-in proposal families-1', () => {
  const loaded = currentTaxonomy();
  const { taxonomy } = loaded;

  it('is a proposal: never claims a reviewer or founder approval', () => {
    expect(taxonomy.id).toBe('families-1');
    expect(taxonomy.review).toMatchObject({ status: 'proposed', reviewedBy: null, reviewedAt: null });
    expect(loaded.ref.status).toBe('proposed');
  });

  it('has 14 families with unique IDs, every game filed once', () => {
    expect(taxonomy.families).toHaveLength(14);
    expect(new Set(taxonomy.families.map((family) => family.id)).size).toBe(14);
    const games = [...taxonomy.families.flatMap((family) => family.games), ...taxonomy.unassigned].map((game) => game.gameId);
    expect(new Set(games).size).toBe(games.length);
    expect(loaded.familyOf.size).toBe(taxonomy.families.reduce((sum, family) => sum + family.games.length, 0));
  });

  it('files no gambling category anywhere', () => {
    const games = [...taxonomy.families.flatMap((family) => family.games), ...taxonomy.unassigned].map((game) => game.gameId);
    for (const gameId of GAMBLING_POLICY.gameIds) expect(games).not.toContain(gameId);
  });

  it('is referenced by the SHA-256 of its exact checked-in bytes', () => {
    expect(loaded.ref.sha256).toBe(createHash('sha256').update(currentTaxonomyText()).digest('hex'));
    expect(loadTaxonomy(currentTaxonomyText()).ref).toEqual(loaded.ref);
  });
});
