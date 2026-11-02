import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GIFT_IDS, GIFT_CATALOGUE } from './catalogue';

describe('gift catalogue', () => {
  it('has stable, distinct IDs for every gift and band', () => {
    expect(GIFT_CATALOGUE.length).toBeGreaterThanOrEqual(15);
    expect(GIFT_CATALOGUE.length).toBeLessThanOrEqual(25);
    const ids = GIFT_CATALOGUE.flatMap(gift => [gift.id, ...gift.bands.map(band => band.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => /^[a-z0-9]+$/.test(id))).toBe(true);
  });

  it('keeps shared moments within a day and each band economy consistent', () => {
    for (const gift of GIFT_CATALOGUE) {
      expect(gift.durationMs).toBeGreaterThan(0);
      expect(gift.durationMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
      expect(gift.bands.map(band => band.suggestedBits)).toEqual([100, 300, 500]);
      expect(gift.what.trim()).not.toBe('');
    }
  });

  // Twitch's words are get, use and give. Nothing is random, permanent, ranked or about an outcome.
  const RESTRICTED = /\b(buy|bought|spend|spent|cost|costs|price|prices|pay|paid|support|donate|purchase|cheer|rank|coal|tenure|odds|random|chance|win|wins|prize|forever|permanent|exclusive|limited|hurry|last chance|only \d+ left)\b/i;
  it('uses welcoming words without restricted framing', () => {
    const words = GIFT_CATALOGUE.flatMap(gift => [gift.title, gift.what]).join(' ');
    expect(words).not.toMatch(RESTRICTED);
  });

  it('keeps the same wording on the shelf the viewer reads', () => {
    // Every quoted string and every run of JSX text in the shelf, which is all the copy a viewer sees there.
    const source = readFileSync(new URL('./GiftShelf.tsx', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const copy = [...source.matchAll(/'([^'\n]*)'|`([^`\n]*)`|>([^<>{}\n]+)</g)].map(match => match[1] ?? match[2] ?? match[3] ?? '')
      // State names and selectors are code, not copy: copy has a capital letter or a space.
      .filter(text => /[A-Z ]/.test(text.trim())).join(' ');
    expect(copy).toContain('Give');
    expect(copy).not.toMatch(RESTRICTED);
  });

  it('draws an emblem for every gift on the shelf', () => {
    // The tests run without a JSX transform, so read the emblem record's keys from its source.
    const source = readFileSync(new URL('./emblems.tsx', import.meta.url), 'utf8');
    const record = source.slice(source.indexOf('const EMBLEMS'), source.indexOf('export const GIFT_EMBLEM_IDS'));
    const drawn = [...record.matchAll(/^ {2}([a-z]+): \(\) =>/gm)].map(match => match[1]);
    expect(drawn.sort()).toEqual(GIFT_CATALOGUE.map(gift => gift.id).sort());
  });

  it('starts with eight distinct gifts in the catalogue', () => {
    const ids = new Set(GIFT_CATALOGUE.map(gift => gift.id));
    expect(DEFAULT_GIFT_IDS).toHaveLength(8);
    expect(new Set(DEFAULT_GIFT_IDS).size).toBe(8);
    expect(DEFAULT_GIFT_IDS.every(id => ids.has(id))).toBe(true);
  });
});
