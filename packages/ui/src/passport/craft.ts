/**
 * The passport's pure craft: types, deterministic ink, crest geometry, dates, the page model, the drawn marks, the
 * share composition and the SIMULATED fixtures. No DOM, CSS or JSX, so a server (the share image) can draw the same
 * book from the same rules.
 */
export type * from './types';
export { ARMS_BOX, CHARGE, CHARGE_SEAT, SHIELD, blazonOf, chargeTransform, type ChargeArt } from './crest';
export { PARCHMENT, chroma, contrast, crestInks, inkFor, inkHash, inkStream, luminance, mix, parseHex, toHex, type CrestInks, type Ink, type Rgb } from './ink';
export { folio, initialOf, isoDay, longDate, monthOf, monthSpan, stampDate } from './format';
export {
  DENSITY, SECTION_LABEL, buildLeaves, buildViews, sectionOfView, sectionTabs, shelfOf, viewCaption,
  type BookLayout, type BookView, type Leaf, type Loaded, type PageDensity, type PassportPage, type PassportShelf, type SectionId, type SectionTab,
} from './pages';
export {
  acknowledgesDisclosure, continuesBook, createPassportSession, followDisclosure, newerDisclosure,
  type PassportDisclosureView, type PassportPageReplyView, type PassportReadState, type PassportReplyView, type PassportRequestView, type PassportSession, type PassportTransport,
} from './session';
export {
  FIXTURE_AS_OF, FIXTURE_KINGDOMS, PASSPORT_FIXTURE_NAMES, PASSPORT_FIXTURE_TITLES, simulatedPassport, simulatedPassportPage, simulatedRevision,
  type PassportFixtureName,
} from './fixtures';
export { armsMarkup, armsSvg, chargeMarkup, escapeMarkup, stampMarkup, stampSvg } from './markup';
export {
  SHARE_GIFTS, SHARE_KINGDOMS, SHARE_SIZE, SHARE_STAMPS, composePassportShare, curateShareSpread, shareAlt,
  type PassportShare, type ShareOptions, type ShareSpread,
} from './share';
export {
  CITIZEN_SHARE_FACTS, CITIZEN_SHARE_SIZE, CITIZEN_SHARE_STAMPS, CITIZEN_SHARE_WORN, acceptedPortrait, citizenShareAlt, composeCitizenShare, nameInk,
  type CitizenShare, type CitizenShareCard, type CitizenShareFact, type CitizenShareHome, type CitizenShareOptions, type CitizenSharePassport, type CitizenSharePortrait, type CitizenShareWorn,
} from './card-share';
