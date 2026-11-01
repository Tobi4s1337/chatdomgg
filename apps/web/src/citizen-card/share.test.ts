import { describe, expect, it } from 'vitest';
import { composeCitizenShare, simulatedPassport, type CitizenSharePassport, type CrestView } from '../../../../packages/ui/src/passport/craft';
import { findFixture } from './fixtures';
import { citizenShareCard, printOf, shareStanding } from './share';
import { simulatedCardShare } from './share-fixture';
import { SITTER } from './sitter';

const wren = findFixture('wren')!;
const crest: CrestView = { key: 'crest:41000001:1', shape: 'heater', charge: 'oak', colours: ['#2f5e4e', '#e3b955'], assetHash: null };
const portrait = { src: 'data:image/webp;base64,UklGRg==', alt: 'Wren Tarnwalker’s portrait' };
const many: CitizenSharePassport = { hidden: false, book: simulatedPassport('many') };
/** Every kingdom a stamp in the many book names: none of them may reach a picture whose travels are hidden. */
const travelled = [...new Set(simulatedPassport('many').stamps.items.map(stamp => stamp.kingdom.name))];

const source = (overrides: Partial<Parameters<typeof citizenShareCard>[0]> = {}) => citizenShareCard({
  document: wren.document, worn: wren.worn ?? [], portrait, crest, homeTier: 'A cottage', passport: many, ...overrides,
});

describe('the card’s share picture input', () => {
  it('says what the card page and the panel say about the same citizen', () => {
    const card = source();
    expect(card.name).toBe(SITTER.name);
    expect(card.kingdom.name).toBe('Willowmere');
    expect(card.standing).toEqual(['Citizen No. 212']);
    expect(card.tenure.map(fact => fact.value)).toEqual(['30 Aug 2024', '14 months, Tier 1']);
    expect(card.home).toEqual({ name: 'The Lantern House', street: 'Lantern Row', tier: 'A cottage' });
    expect(card.worn.map(piece => piece.name)).toEqual(wren.worn!.map(piece => piece.name));
    expect(card.login).toBe('wren_tarnwalker');
    expect(card.origin).toBe('simulated');
    expect(card.passport.hidden).toBe(false);
  });

  it('draws no book when the card hides the travels, even if a book is handed in', () => {
    const card = source({ document: { ...wren.document, passport: { hidden: true } } });
    expect(card.passport).toEqual({ hidden: true });
    const share = composeCitizenShare(card);
    for (const name of travelled) {
      expect(share.html).not.toContain(name);
      expect(share.alt).not.toContain(name);
    }
    // Homes stay: hiding travels never hides the card's home.
    expect(share.html).toContain('The Lantern House');
    expect(share.alt).toContain('SIMULATED');
  });

  it('refuses a book that belongs to somebody else', () => {
    const card = source({ passport: { hidden: false, book: simulatedPassport('few') } });
    expect(card.passport).toEqual({ hidden: true });
  });

  it('drops a portrait the document no longer names', () => {
    const identity = { ...wren.document.identity, portrait: null };
    expect(source({ document: { ...wren.document, identity } }).portrait).toBeNull();
  });

  it('engraves office and number the way the plaque does', () => {
    const knight = findFixture('knight')!.document;
    expect(shareStanding(knight)).toEqual(['Knight of the Watch', 'Citizen No. 38']);
    expect(shareStanding({ ...knight, identity: { ...knight.identity, office: null }, citizenNumber: null })).toEqual(['Citizen']);
    expect(shareStanding({ ...knight, identity: { ...knight.identity, office: null }, citizenNumber: null, address: null })).toEqual(['Guest']);
  });

  it('asks for a fresh print for every card shown, and keeps the link clean', () => {
    const a = printOf('/-/citizens/share.png?fixture=wren#p', wren.document);
    const b = printOf('/-/citizens/share.png?fixture=wren#p', wren.document);
    expect(a).toMatch(/^\/-\/citizens\/share\.png\?fixture=wren&print=3\.7\.\d+#p$/);
    expect(a).not.toBe(b);
  });
});

describe('the SIMULATED share, read through the passport reader', () => {
  it('opens Wren’s book on the newest journeys', async () => {
    const card = await simulatedCardShare('wren', { travels: 'shown', portrait });
    expect(card?.passport.hidden).toBe(false);
    const share = composeCitizenShare(card!);
    expect(share.alt).toMatch(/passport lies open on its latest journeys/);
    expect(share.alt).toContain('SIMULATED');
  });

  it('keeps hidden travels out of the picture, the words and the title', async () => {
    const card = await simulatedCardShare('wren', { travels: 'hidden', portrait });
    expect(card?.passport).toEqual({ hidden: true });
    const share = composeCitizenShare(card!);
    for (const name of travelled) expect(`${share.html}${share.alt}${share.title}`).not.toContain(name);
    expect(share.alt).not.toMatch(/passport/i);
  });

  it('lays a newcomer’s empty book closed, with nothing pressed into it', async () => {
    const card = await simulatedCardShare('juniper', { travels: 'shown', portrait: null });
    expect(card?.passport.hidden === false && card.passport.book.stamps.items).toEqual([]);
    expect(composeCitizenShare(card!).alt).toMatch(/closed, with Juniper Ashdown on its cover and no journeys in it yet/);
  });
});
