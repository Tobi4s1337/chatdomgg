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

  it('uses welcoming words without restricted framing', () => {
    const words = GIFT_CATALOGUE.flatMap(gift => [gift.title, gift.what]).join(' ');
    expect(words).not.toMatch(/\b(buy|spend|cost|price|support|donate|purchase|cheer|rank|coal|tenure|odds)\b/i);
  });

  it('starts with eight distinct gifts in the catalogue', () => {
    const ids = new Set(GIFT_CATALOGUE.map(gift => gift.id));
    expect(DEFAULT_GIFT_IDS).toHaveLength(8);
    expect(new Set(DEFAULT_GIFT_IDS).size).toBe(8);
    expect(DEFAULT_GIFT_IDS.every(id => ids.has(id))).toBe(true);
  });
});
