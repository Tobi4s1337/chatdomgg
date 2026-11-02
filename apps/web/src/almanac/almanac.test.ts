import { describe, expect, it } from 'vitest';
import type { FishSpecies, PierAlmanac } from '@chatdom/shared';
import { FISH_SPECIES } from '../../../../packages/content/src/fish/species';
import { SAOIRSE_MARKS, WILLOWMERE_ALMANAC } from './fixture';
import { parseAlmanac } from './fetch';
import {
  bookLayout, bookOrder, buildLeaves, contentsWords, folios, leafIndex, navKey, printedStrings, speciesWords, stepIndex, swipeAction, toRoman,
  type Leaf,
} from './pages';
import {
  biggestLine, catchesLine, countLine, firstLine, fisherName, formatDay, formatHour, formatLength, formatWeight, markWords, mountsLine,
  statusWords, summaryLine, unknownHint, whereWhen,
} from './words';

const species = (id: string): FishSpecies => FISH_SPECIES.find(fish => fish.id === id)!;
const SLOP = /\b(undefined|null|NaN|Infinity|object Object|TODO|lorem)\b|fish:|\[|\]|\{|\}|\b1 items\b/i;

describe('the Almanac’s words', () => {
  it('weighs and measures as a fisher would say it', () => {
    expect(formatWeight(412)).toBe('412 g');
    expect(formatWeight(2410)).toBe('2.4 kg');
    expect(formatWeight(2000)).toBe('2 kg');
    expect(formatWeight(41_600)).toBe('42 kg');
    expect(formatWeight(0.3)).toBe('1 g');
    expect(formatWeight(NaN)).toBe('');
    expect(formatLength(342)).toBe('34 cm');
    expect(formatLength(1188)).toBe('1.2 m');
    expect(formatLength(2000)).toBe('2 m');
    expect(formatLength(-4)).toBe('');
  });

  it('dates in English by the realm’s day, adding the year only when it differs', () => {
    const asOf = Date.UTC(2026, 10, 2, 19);
    expect(formatDay(Date.UTC(2026, 10, 2, 23, 59), asOf)).toBe('2 November');
    expect(formatDay(Date.UTC(2025, 11, 31, 22), asOf)).toBe('31 December 2025');
    expect(formatDay(NaN)).toBe('');
    expect(formatHour(Date.UTC(2026, 10, 2, 19, 30))).toBe('at dusk');
    expect(formatHour(Date.UTC(2026, 10, 2, 6))).toBe('at dawn');
    expect(formatHour(Date.UTC(2026, 10, 2, 10))).toBe('in the morning');
    expect(formatHour(Date.UTC(2026, 10, 2, 15))).toBe('in the afternoon');
    expect(formatHour(Date.UTC(2026, 10, 2, 2))).toBe('at night');
  });

  it('writes where and when a fish bites as prose', () => {
    expect(whereWhen(species('fish:willow-tench'))).toBe('Bites in still lakes at dusk and by night, in any weather but a clear sky.');
    expect(whereWhen(species('fish:whisker-catfish'))).toBe('Bites in lakes and rivers at dusk and by night, in mist or rain.');
    expect(whereWhen(species('fish:copper-perch'))).toBe('Bites in lakes and rivers at any hour, in any weather.');
    expect(whereWhen(species('fish:moonlit-pike'))).toBe('Bites in still lakes, where the water runs deep, at dusk and by night, under clear skies or in mist.');
    expect(whereWhen(species('fish:redfin-char'))).toBe('Bites in lakes and rivers up in the highlands, where the water runs deep, at dawn and at dusk, in a breeze or rain.');
    expect(whereWhen(species('fish:mossback-carp'))).toBe('Bites in still lakes among meadows and woods by day and at dusk, in any weather but mist.');
    expect(whereWhen(species('fish:sun-bream'))).toBe('Bites in every water, fresh or salt, from dawn until dusk, in fair weather, still or breezy.');
    for (const fish of FISH_SPECIES) {
      const line = whereWhen(fish);
      expect(line, fish.id).toMatch(/^Bites .+\.$/);
      expect(line, fish.id).not.toMatch(SLOP);
      expect(line, fish.id).not.toMatch(/ ,|,,|\s{2}/);
    }
  });

  it('names a hidden fisher “a fisher”', () => {
    expect(fisherName(null)).toBe('a fisher');
    expect(fisherName('  ')).toBe('a fisher');
    expect(fisherName(' Juniper ')).toBe('Juniper');
    expect(firstLine({ name: null, at: Date.UTC(2026, 9, 20, 13, 40), via: 'chat' }, 'Willowmere', Date.UTC(2026, 10, 2)))
      .toBe('First caught in Willowmere by a fisher in the afternoon on 20 October, on a line cast from chat.');
  });

  it('tells the kingdom’s record in sentences', () => {
    const asOf = Date.UTC(2026, 10, 2);
    expect(firstLine({ name: 'Juniper', at: Date.UTC(2026, 10, 2, 19, 5), via: 'pier' }, 'Willowmere', asOf))
      .toBe('First caught in Willowmere by Juniper at dusk on 2 November.');
    expect(firstLine({ name: 'Juniper', at: Date.UTC(2026, 10, 2, 19, 5), via: 'pier' }, '', asOf))
      .toBe('First caught here by Juniper at dusk on 2 November.');
    const first = { name: 'saoirse_k', at: Date.UTC(2026, 9, 23, 19), via: 'pier' as const };
    expect(biggestLine({ ...first, weightG: 9620, lengthMm: 1188 }, first, asOf, 2)).toBe('That first fish is still the biggest: it weighed 9.6 kg and measured 1.2 m.');
    expect(biggestLine({ ...first, weightG: 9620, lengthMm: 1188 }, first, asOf, 1)).toBe('It weighed 9.6 kg and measured 1.2 m.');
    expect(biggestLine({ name: 'Tobias', at: Date.UTC(2026, 9, 27), via: 'pier', weightG: 1130, lengthMm: 398 }, first, asOf, 9))
      .toBe('The biggest weighed 1.1 kg and measured 40 cm, landed by Tobias on 27 October.');
    expect(biggestLine({ name: 'Tobias', at: 1, via: 'pier', weightG: NaN, lengthMm: 0 }, first, asOf)).toBe('');
    expect(countLine(1, 'Willowmere')).toBe('Caught once in Willowmere.');
    expect(countLine(2, 'Willowmere')).toBe('Caught twice in Willowmere.');
    expect(countLine(14, 'Willowmere')).toBe('Caught 14 times in Willowmere.');
    expect(countLine(9, 'Willowmere')).toBe('Caught nine times in Willowmere.');
    expect(countLine(0, 'Willowmere')).toBe('');
    expect(mountsLine(1, 'Willowmere')).toBe('One numbered mount hangs on a shelf in Willowmere.');
    expect(mountsLine(3, 'Willowmere')).toBe('Three numbered mounts hang on shelves in Willowmere.');
    expect(mountsLine(0, 'Willowmere')).toBe('');
    expect(unknownHint('waiting', 'Willowmere')).toBe('Lives in these waters. No one here has caught it yet.');
    expect(unknownHint('elsewhere', 'Willowmere')).toBe('Not in Willowmere’s waters. Caught only somewhere else.');
    expect(summaryLine(17, 28, 'Willowmere')).toBe('17 of 28 known in Willowmere');
    expect(catchesLine(0)).toMatch(/first could be yours/);
    expect(statusWords('caught', 1)).toBe('caught once');
    expect(statusWords('caught', 58)).toBe('caught 58 times');
  });

  it('pencils the reader’s own marks, never “1 times”', () => {
    expect(markWords({ speciesId: 'fish:moonlit-pike', count: 1, firstAt: Date.UTC(2026, 9, 23), bestWeightG: 9620, bestLengthMm: 1188, kingdomFirst: true }, 'Willowmere'))
      .toEqual({ head: 'Yours: caught once', lines: ['9.6 kg, 1.2 m', 'on 23 October', 'the first in Willowmere!'] });
    expect(markWords({ speciesId: 'x', count: 0, firstAt: 0, bestWeightG: 0, bestLengthMm: 0, kingdomFirst: false }, 'Willowmere')).toBeNull();
  });
});

describe('the book’s order and turning', () => {
  it('binds lakes and rivers, then the sea, then the four legends', () => {
    const order = bookOrder(FISH_SPECIES);
    expect(order).toHaveLength(FISH_SPECIES.length);
    expect(order.map(plate => plate.plate)).toEqual(order.map((_, i) => i + 1));
    const chapters = order.map(plate => plate.chapter);
    expect(chapters.indexOf('sea')).toBeGreaterThan(chapters.lastIndexOf('fresh'));
    expect(chapters.indexOf('legends')).toBeGreaterThan(chapters.lastIndexOf('sea'));
    expect(order.filter(plate => plate.chapter === 'legends').map(plate => plate.species.id))
      .toEqual(['fish:stormcrown-sturgeon', 'fish:goldscale-emperor', 'fish:moonwake-ray', 'fish:frostking-char']);
    expect(order[0]!.species.id).toBe('fish:copper-perch');
    expect(toRoman(28)).toBe('XXVIII');
    expect(toRoman(4)).toBe('IV');
    expect(folios(1)).toEqual([3, 4]);
  });

  it('opens the right page and stays inside the covers', () => {
    const leaves = buildLeaves(WILLOWMERE_ALMANAC, FISH_SPECIES, SAOIRSE_MARKS);
    expect(leaves).toHaveLength(FISH_SPECIES.length + 1);
    expect(leafIndex(leaves, 'contents')).toBe(0);
    expect(leafIndex(leaves, 'fish:copper-perch')).toBe(1);
    expect(leafIndex(leaves, 'fish:nothing-here')).toBe(0);
    expect(leafIndex(leaves, null)).toBe(0);
    expect(stepIndex(0, -1, leaves.length)).toBe(0);
    expect(stepIndex(0, 1, leaves.length)).toBe(1);
    expect(stepIndex(leaves.length - 1, 1, leaves.length)).toBe(leaves.length - 1);
    expect(stepIndex(3, 99, leaves.length)).toBe(leaves.length - 1);
  });

  it('reads keys and swipes', () => {
    expect(navKey('ArrowRight')).toBe('next');
    expect(navKey('PageDown')).toBe('next');
    expect(navKey('ArrowLeft')).toBe('prev');
    expect(navKey('PageUp')).toBe('prev');
    expect(navKey('Escape')).toBe('close');
    expect(navKey('Home')).toBe('contents');
    expect(navKey('a')).toBeNull();
    expect(swipeAction(-120, 10, 240)).toBe('next');
    expect(swipeAction(120, -14, 240)).toBe('prev');
    expect(swipeAction(-20, 0, 100)).toBeNull();
    expect(swipeAction(-80, 120, 200)).toBeNull();
    expect(swipeAction(-120, 0, 2000)).toBeNull();
    expect(bookLayout(1440, 900)).toBe('spread');
    expect(bookLayout(390, 844)).toBe('single');
    expect(bookLayout(1920, 1080)).toBe('spread');
  });

  it('fills a species the realm left out from the water, never as caught', () => {
    const almanac: PierAlmanac = { ...WILLOWMERE_ALMANAC, entries: [] };
    const leaves = buildLeaves(almanac, FISH_SPECIES, null).filter((leaf): leaf is Leaf => leaf.kind === 'species');
    expect(leaves.every(leaf => leaf.status !== 'caught')).toBe(true);
    expect(leaves.find(leaf => leaf.plate.species.id === 'fish:harbour-mackerel')!.status).toBe('elsewhere');
    expect(leaves.find(leaf => leaf.plate.species.id === 'fish:copper-perch')!.status).toBe('waiting');
  });
});

describe('every printed word of a full book', () => {
  for (const mode of ['walker', 'watcher'] as const) {
    it(`holds no slop for a ${mode}`, () => {
      const marks = mode === 'walker' ? SAOIRSE_MARKS : null;
      const leaves = buildLeaves(WILLOWMERE_ALMANAC, FISH_SPECIES, marks);
      const context = { kingdom: WILLOWMERE_ALMANAC.kingdom, asOf: WILLOWMERE_ALMANAC.asOf, watcher: mode === 'watcher' };
      const contents = contentsWords(leaves, WILLOWMERE_ALMANAC, { ...context, marks });
      expect(contents.summary).toBe('17 of 28 known in Willowmere');
      const all = [...printedStrings(contents)];
      for (const leaf of leaves) if (leaf.kind === 'species') {
        const words = speciesWords(leaf, context);
        all.push(...printedStrings(words));
        if (leaf.status === 'caught') {
          expect(words.title).toBe(leaf.plate.species.name);
          expect(words.first, leaf.plate.species.id).toMatch(/^First caught in Willowmere by .+ on \d+ (October|November)/);
          expect(words.lore).toBe(leaf.plate.species.lore);
        } else {
          expect(words.title).toBe(leaf.plate.species.riddle);
          expect(words.first).toBe('');
          expect(words.hint).not.toBe('');
        }
        if (mode === 'watcher') expect(words.mark).toBeNull();
      }
      for (const text of all) {
        expect(text, text).not.toMatch(SLOP);
        expect(text, text).not.toMatch(/\b1 times\b|\b0 (of|times)\b.*\b0\b/);
        expect(text.trim(), text).toBe(text);
      }
      if (mode === 'walker') expect(all).toContain('Yours: caught twice');
      expect(all.some(text => text.includes('by a fisher'))).toBe(true);
    });
  }

  it('prints a page for a kingdom with no name and no catches', () => {
    const almanac: PierAlmanac = { ...WILLOWMERE_ALMANAC, kingdom: '', entries: [], caught: 0, catches: 0 };
    const leaves = buildLeaves(almanac, FISH_SPECIES, []);
    const contents = contentsWords(leaves, almanac, { kingdom: '', asOf: almanac.asOf, watcher: false, marks: [] });
    expect(contents.summary).toBe('0 of 28 known here');
    expect(contents.sub).toBe('of the kingdom’s waters');
    for (const text of printedStrings(contents)) expect(text).not.toMatch(SLOP);
  });
});

describe('reading the Almanac from the realm', () => {
  it('accepts the realm’s shape and refuses a torn one in plain words', () => {
    expect(parseAlmanac(JSON.parse(JSON.stringify(WILLOWMERE_ALMANAC)), '48151623').entries).toHaveLength(28);
    expect(() => parseAlmanac({ version: 1, kingdomId: '48151623' }, '48151623')).toThrow(/came back torn/);
    expect(() => parseAlmanac(JSON.parse(JSON.stringify(WILLOWMERE_ALMANAC)), '99')).toThrow(/another kingdom/);
    const odd = { ...JSON.parse(JSON.stringify(WILLOWMERE_ALMANAC)), entries: [{ speciesId: 'fish:copper-perch', status: 'caught', count: 'many' }] };
    expect(() => parseAlmanac(odd, '48151623')).toThrow(/came back torn/);
  });
});
