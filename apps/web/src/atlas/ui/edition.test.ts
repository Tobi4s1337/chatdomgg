// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FOUNDED_AT, makeEdition, makeWorld, publish } from '../data/fixtures.test-support';
import type { PreviewWorld } from '../data/preview';
import { editionOf, holdingNote, holdingStatus, mapNoun, newerNotice, sealLive, sealWords, stillTitle } from './edition';
import { formatCount, formatDay, formatMoment, SEARCH_PLACEHOLDER } from './format';
import { WAY_IN_LABEL } from './opening';

const DRAFT = /survey|awaiting|founding|draft|preview|still of land/i;
/** Words as the carved-chrome check counts them (checks/carved-checks.mjs). */
const words = (text: string) => text.match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu) ?? [];

describe('sealWords', () => {
  it('keeps the survey preview’s seal exactly as it was, moving and still', () => {
    const world = makeWorld();
    expect(sealWords(world, false)).toEqual({ kind: 'survey', lead: 'Survey', when: { text: formatDay(world.asOf), at: world.asOf }, hint: 'Survey of land awaiting founding.' });
    expect(sealWords(world, true)).toEqual({ kind: 'survey', lead: 'Still', when: { text: formatDay(world.asOf), at: world.asOf }, hint: 'Still of land awaiting founding.' });
  });

  it('names a founded edition with its founding day, and says the land no longer moves', () => {
    for (const still of [false, true]) {
      expect(sealWords(makeEdition(), still)).toEqual({
        kind: 'edition', lead: 'Edition I', when: { text: '5 Nov 2026', at: FOUNDED_AT }, hint: 'Founded 5 Nov 2026. The land no longer moves.',
      });
    }
    expect(sealWords(makeEdition({ label: 'Edition 0' }), false).lead).toBe('Edition 0');
  });

  it('never claims a founding for a rehearsal', () => {
    expect(sealWords(makeEdition({ rehearsal: true }), false)).toEqual({
      kind: 'rehearsal', lead: 'Edition I', when: { text: 'Rehearsal', at: null }, hint: 'A rehearsal of Edition I. Nothing is founded.',
    });
  });

  it('carries no draft wording on an edition', () => {
    for (const world of [makeEdition(), makeEdition({ rehearsal: true })]) {
      for (const still of [false, true]) {
        const seal = sealWords(world, still);
        expect(`${seal.lead} ${seal.when.text} ${seal.hint}`).not.toMatch(DRAFT);
      }
    }
  });
});

describe('sealLive', () => {
  const now = Date.UTC(2026, 10, 6, 10, 7);
  it('reads live or held at the frame’s time, or unavailable without one', () => {
    expect(sealLive(now - 120_000, true, now)).toBe('Live 10:05 UTC');
    expect(sealLive(now - 86_400_000, false, now)).toBe(`Held ${formatMoment(now - 86_400_000)}`);
    expect(sealLive(null, true, now)).toBe('Live unavailable');
    expect(sealLive(undefined, false, now)).toBe('Live unavailable');
  });
});

describe('the default view’s words', () => {
  /** Everything the default map chrome shows in words: title, seal line, live line, search prompt, the "Map key"
   * button, scale. The way into a kingdom is counted on its own (see below); the opening caption is read once, on a
   * first visit only. */
  function defaultChrome(world: PreviewWorld, still: boolean): string {
    const seal = sealWords(world, still);
    // The longest live line: a held frame from another day.
    const live = sealLive(Date.UTC(2026, 9, 30, 1, 59), false, Date.UTC(2026, 10, 6, 10, 7));
    const scale = `${formatCount(1_000)} leagues · Continent`;
    return ['Chatdom Atlas', `${seal.lead} ${seal.when.text}`, live, SEARCH_PLACEHOLDER, 'Map key', scale].join(' ');
  }
  /** The way in with its kingdom's name, the one invitation beyond the map's own 25 words. */
  const wayIn = `${WAY_IN_LABEL} Willowmere`;

  it.each<[string, PreviewWorld]>([
    ['a survey preview', makeWorld()],
    ['Edition I', makeEdition()],
    ['Edition 0', makeEdition({ label: 'Edition 0' })],
    ['a rehearsal', makeEdition({ rehearsal: true })],
  ])('stays within 25 words for %s, moving and still, and 30 with the way into a kingdom', (_, world) => {
    for (const still of [false, true]) {
      expect(words(defaultChrome(world, still)).length).toBeLessThanOrEqual(25);
      expect(words(`${defaultChrome(world, still)} ${wayIn}`).length).toBeLessThanOrEqual(30);
    }
  });

  it('keeps the way in to five words with its kingdom’s name', () => {
    expect(words(wayIn).length).toBeLessThanOrEqual(5);
  });

  it('costs an edition at most one word more than the survey it replaced', () => {
    expect(words(defaultChrome(makeEdition(), false)).length - words(defaultChrome(makeWorld(), false)).length).toBeLessThanOrEqual(1);
  });
});

describe('holding wording', () => {
  it('keeps the survey card’s honesty and gives an edition its own words', () => {
    const survey = makeWorld();
    expect(holdingStatus(survey)).toBe('Mapped holding · not yet founded');
    expect(holdingNote(survey)).toBe('Survey of 29–30 Oct 2026 (UTC). Draft land: this holding may still move before the first edition.');
    expect(mapNoun(survey)).toBe('survey');
    const edition = makeEdition();
    expect(holdingStatus(edition)).toBe('Mapped holding · Edition I');
    expect(holdingNote(edition)).toBe('Observed 5–6 Nov 2026 (UTC). Edition I, founded 5 Nov 2026: this holding never moves.');
    expect(mapNoun(edition)).toBe('edition');
    const rehearsal = makeEdition({ rehearsal: true });
    expect(holdingStatus(rehearsal)).toBe('Mapped holding · Edition I rehearsal');
    expect(holdingNote(rehearsal)).toBe('Observed 5–6 Nov 2026 (UTC). A rehearsal of Edition I: nothing is founded, so this holding may still move.');
    for (const world of [edition, rehearsal]) expect(`${holdingStatus(world)} ${holdingNote(world)}`).not.toMatch(DRAFT);
  });
});

describe('editionOf and the still’s title', () => {
  it('reads the edition of a world, or none for a survey', () => {
    expect(editionOf(makeWorld())).toBeNull();
    expect(editionOf(makeEdition())).toEqual({ label: 'Edition I', foundedAt: FOUNDED_AT, rehearsal: false });
    expect(stillTitle(editionOf(makeWorld()))).toBe('A still of the survey');
    expect(stillTitle(editionOf(makeEdition()))).toBe('A still of Edition I');
    expect(stillTitle(editionOf(makeEdition({ rehearsal: true })))).toBe('A still of the Edition I rehearsal');
  });
});

describe('newerNotice', () => {
  const asOf = Date.UTC(2026, 10, 7, 2, 0);
  it('offers a newer survey, the founded edition, or the edition’s next night', () => {
    expect(newerNotice(makeWorld(), { asOf })).toBe(`A newer survey is ready (observed to ${formatMoment(asOf)}).`);
    const pointer = publish(makeEdition()).pointer;
    expect(newerNotice(makeWorld(), { asOf, edition: pointer.edition! })).toBe(`Edition I is ready (observed to ${formatMoment(asOf)}).`);
    expect(newerNotice(makeEdition(), { asOf, edition: pointer.edition! })).toBe(`A newer night of Edition I is ready (observed to ${formatMoment(asOf)}).`);
    expect(newerNotice(makeEdition({ label: 'Edition 0' }), { asOf, edition: pointer.edition! })).toBe(`Edition I is ready (observed to ${formatMoment(asOf)}).`);
  });
});
