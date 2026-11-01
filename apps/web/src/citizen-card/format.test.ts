import { describe, expect, it } from 'vitest';
import { parseCardDocument } from '../../../api/src/citizen-card/contracts';
import { simulatedPassport } from '../../../../packages/ui/src/passport/craft';
import { disclosedPlaces } from '../../../api/src/passport/disclosure';
import { simulatedPassportAuthorities } from '../../../api/src/passport/simulated';
import { CARD_FIXTURES, findFixture } from './fixtures';
import { followFact, formatDay, nameStyle, standing, subscriptionFact } from './format';
import { SITTER, SITTER_LOOK, SITTER_WORN } from './sitter';

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
    const knight = findFixture('knight')!.document;
    expect(standing(knight)).toBe('Knight of the Watch');
    expect(standing({ ...knight, identity: { ...knight.identity, office: null }, address: null, citizenNumber: null })).toBe('Guest');
    expect(nameStyle('#b22222').surface).toBe('parchment');
    expect(nameStyle('#2e8b57').surface).toBe('plate');
    expect(nameStyle('#00ff7f').surface).toBe('plate');
    expect(nameStyle(null).surface).toBe('ink');
  });

  it('shows one SIMULATED Wren: the sitter’s look, what they wear, and the passport holder’s own homes', () => {
    const wren = findFixture('wren')!;
    expect(CARD_FIXTURES[0]).toBe(wren);
    expect(CARD_FIXTURES.filter(item => /wren/i.test(item.document.identity.name))).toEqual([wren]);
    const { document } = wren;
    expect(document.identity).toMatchObject({ name: SITTER.name, login: SITTER.login, office: null });
    expect(document.kingdomName).toBe(SITTER.kingdom.name);
    expect(nameStyle(document.identity.colour).surface).toBe('parchment');
    expect(standing(document)).toBe('Citizen');
    expect(followFact(document.tenure).value).toBe('30 Aug 2024');
    expect(subscriptionFact(document.tenure).value).toBe('14 months, Tier 1');
    expect(wren.portraitLook).toBe(SITTER_LOOK);
    expect(wren.worn).toEqual(SITTER_WORN.map(offer => ({ name: offer.name, story: offer.story })));
    // Their passport is the craft's `many` book, held by this very person, and its roads begin at a home the card shows.
    const authorities = simulatedPassportAuthorities('many', { signedIn: true, travelsHidden: false });
    expect(simulatedPassport('many').holder.personId).toBe(document.key.personId);
    expect(authorities.key.personId).toBe(document.key.personId);
    expect(disclosedPlaces(document).get(authorities.key.kingdomId)).toBe(SITTER.elsewhere.name);
    expect(document.homes.map(home => home.kingdomName)).toEqual([SITTER.kingdom.name, SITTER.elsewhere.name]);
  });
});
