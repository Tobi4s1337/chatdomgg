import type { CitizenShareCard, CitizenShareFact, CitizenSharePassport, CitizenSharePortrait, CrestView } from '@chatdom/ui/passport';
import type { CitizenCardDocument } from '../../../api/src/citizen-card/contracts';
import { OFFICE_TITLES, followFact, showLogin, subscriptionFact } from './format';
import { disclosedWorn, type CardWorn } from './host';

/**
 * What the share picture is drawn from. Everything is what the card page already shows publicly: the projected
 * document, the pieces the look authority says they wear, the approved portrait bytes and the kingdom's arms. The
 * passport is the reading the card's disclosure gate let through, never a book fetched around it.
 */
export interface CardShareSource {
  /** The safe, projected card (`projectCard`), the same document the page shows. */
  readonly document: CitizenCardDocument;
  readonly worn: readonly CardWorn[];
  /** The approved portrait asset for the document's exact portrait revision, as inline bytes; null for none. */
  readonly portrait: CitizenSharePortrait | null;
  /** The kingdom's arms as the kingdom directory supplies them. */
  readonly crest: CrestView;
  /** Their home's tier in words ("A cottage") when the house authority says so; the card document does not carry it. */
  readonly homeTier: string | null;
  /** The passport as its reader answered for this card's subject, after the card's disclosure. */
  readonly passport: CitizenSharePassport;
}

/** Office and number as the plaque engraves them: "Knight of the Watch", "Citizen No. 212"; a guest is a guest. */
export function shareStanding(document: Pick<CitizenCardDocument, 'identity' | 'address' | 'citizenNumber'>): readonly string[] {
  const number = document.citizenNumber === null ? null : `Citizen No. ${document.citizenNumber}`;
  if (document.identity.office) return number ? [OFFICE_TITLES[document.identity.office], number] : [OFFICE_TITLES[document.identity.office]];
  if (number) return [number];
  return [document.address ? 'Citizen' : 'Guest'];
}

/**
 * The card's share picture input, from the same current safe view the page shows (spec 19 R8, spec 45 R3).
 *
 * The book only reaches the picture when the document itself discloses a passport and the book belongs to the
 * document's own person. A hidden card passport, or a book for anybody else, draws no book at all: the picture is
 * the card alone, and nothing travel-derived (names, stamps, words) can reach it.
 */
export function citizenShareCard(source: CardShareSource): CitizenShareCard {
  const { document } = source;
  const book = source.passport.hidden || document.passport.hidden || source.passport.book.holder.personId !== document.key.personId
    ? { hidden: true } as const
    : source.passport;
  const follow = followFact(document.tenure), sub = subscriptionFact(document.tenure);
  const tenure: CitizenShareFact[] = [
    { label: follow.label, value: follow.value, mark: 'follow' },
    { label: sub.label, value: sub.value, mark: 'subscribed' },
  ];
  return {
    origin: document.origin,
    name: document.identity.name,
    login: showLogin(document.identity) ? document.identity.login : null,
    colour: document.identity.colour,
    standing: shareStanding(document),
    kingdom: { name: document.kingdomName, crest: source.crest },
    home: document.address ? { name: document.address.home, street: document.address.street, tier: source.homeTier } : null,
    tenure,
    // A portrait whose document no longer names one is not drawn: the picture follows the card, not the cache.
    portrait: document.identity.portrait ? source.portrait : null,
    // A travel piece names where its road went: it is drawn only when the book itself may be.
    worn: disclosedWorn(source.worn, book).map(piece => ({ name: piece.name, story: piece.story })),
    passport: book,
  };
}

let prints = 0;

/**
 * The picture's address for this one shown card. A document may reuse an image it already holds for the same URL
 * whatever the response's caching said, so every card the page shows asks for its own print: a card read afresh
 * (hidden travels, a new journey, a new portrait) never shows the picture of the one before it. The share route
 * ignores the parameter and always draws the card as it stands; the links people copy stay clean.
 */
export function printOf(imageUrl: string, document: Pick<CitizenCardDocument, 'revision'>): string {
  const [base = '', hash] = imageUrl.split('#', 2) as [string, string | undefined];
  const print = `print=${document.revision.person}.${document.revision.citizen}.${++prints}`;
  return `${base}${base.includes('?') ? '&' : '?'}${print}${hash === undefined ? '' : `#${hash}`}`;
}
