import { describe, expect, it } from 'vitest';
import { parseCardDocument } from '../../../api/src/citizen-card/contracts';
import { CARD_FIXTURES } from './fixtures';
import { followFact, formatDay, nameStyle, standing, subscriptionFact } from './format';

describe('citizen card facts', () => {
  it('ships only fixtures the public reader accepts, each one SIMULATED', () => {
    for (const fixture of CARD_FIXTURES) {
      expect(parseCardDocument(fixture.document)).toEqual(fixture.document);
      expect(fixture.document.origin).toBe('simulated');
    }
  });

  it('says plainly what is known, and “not known” rather than zero or no', () => {
    // UTC: the last minute of 14 Feb stays 14 Feb wherever the reader is.
    expect(formatDay(Date.UTC(2022, 1, 14, 23, 59))).toBe('14 Feb 2022');
    expect(followFact({ followedAt: null, subscribedMonths: null, activeTier: null }).value).toBeNull();
    expect(subscriptionFact({ followedAt: null, subscribedMonths: 14, activeTier: 1 }).value).toBe('14 months, Tier 1');
    // A lapsed sub keeps their months and claims no tier; an unwitnessed history is not zero.
    expect(subscriptionFact({ followedAt: null, subscribedMonths: 7, activeTier: null }).value).toBe('7 months');
    expect(subscriptionFact({ followedAt: null, subscribedMonths: null, activeTier: null }).value).toBeNull();
    expect(subscriptionFact({ followedAt: null, subscribedMonths: null, activeTier: 2 })).toMatchObject({ value: 'Tier 2 now', note: 'Months not known yet' });
  });

  it('gives office from supplied facts only and keeps every chat colour readable', () => {
    const wren = CARD_FIXTURES.find(item => item.id === 'wren')!.document;
    expect(standing(wren)).toBe('Knight of the Watch');
    expect(standing({ ...wren, identity: { ...wren.identity, office: null }, address: null, citizenNumber: null })).toBe('Guest');
    expect(nameStyle('#b22222').surface).toBe('parchment');
    expect(nameStyle('#2e8b57').surface).toBe('plate');
    expect(nameStyle('#00ff7f').surface).toBe('plate');
    expect(nameStyle(null).surface).toBe('ink');
  });
});
