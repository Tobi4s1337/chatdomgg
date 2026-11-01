import { CitizenKeySchema } from '@chatdom/shared';
import type { CitizenLook } from '@chatdom/content/avatar-style';
import type { CitizenCardDocument } from '../../../api/src/citizen-card/contracts';
import type { CardWorn } from './host';
import { SITTER, SITTER_LOOK, SITTER_WORN, remembersTravel } from './sitter';

/**
 * SIMULATED citizens for the card bench. Every document says `origin: 'simulated'` and the card prints that on
 * every view; none of these people, kingdoms or dates exist on Twitch. Portraits are actual renders through the
 * citizen portrait renderer (`portraitLook`: a saved look, or one of the default citizen looks), made by the bench,
 * never stand-in pictures.
 *
 * `wren` is the one SIMULATED citizen every card surface shows (`./sitter`): the same saved look paints their
 * portrait here, in the panel and on the share picture, and their passport is the craft's `many` book. The others
 * are variety cases for the plaque's states (an office, unknown tenure, a lapsed sub, no portrait).
 */
export interface CardFixture {
  readonly id: string;
  readonly note: string;
  /** The look rendered for the portrait asset: a saved `CitizenLook`, or a default citizen look by name. */
  readonly portraitLook: CitizenLook | string | null;
  readonly document: CitizenCardDocument;
  /** Earned pieces they wear, named with the story each remembers. */
  readonly worn?: readonly CardWorn[];
  /** The SIMULATED passport this citizen holds (the craft's book of that name), read beneath the card on their page. */
  readonly passport?: 'many' | 'none';
  /** Their home's tier in words, as the house authority would say it (the card document does not carry it). */
  readonly homeTier?: string;
}

interface Kingdom { readonly id: string; readonly name: string }
const LANTERNMERE: Kingdom = { id: '491305829', name: 'Lanternmere' };
/** The raid gate's SIMULATED Willowmere, the kingdom of the panel's SIMULATED night. */
const WILLOWMERE: Kingdom = { id: '41000001', name: SITTER.kingdom.name };
/** Wren's other home, where the passport's roads begin (the passport authorities' `many` kingdom). */
const TARNHOLLOW: Kingdom = { id: '910000102', name: SITTER.elsewhere.name };

const day = (year: number, month: number, date: number) => Date.UTC(year, month - 1, date);
const nothing = { availability: 'known', entries: [], next: null } as const;

type Fields = Omit<CitizenCardDocument, 'key' | 'kingdomName' | 'origin' | 'homes' | 'castle' | 'passport' | 'pieces' | 'honours' | 'house'>;
interface Elsewhere { readonly kingdom: Kingdom; readonly home: string; readonly street: string }

function document(kingdom: Kingdom, personId: string, fields: Fields, elsewhere: readonly Elsewhere[] = []): CitizenCardDocument {
  const key = CitizenKeySchema.parse({ personId, kingdomId: kingdom.id });
  const here = fields.address ? [{ kingdom, home: fields.address.home, street: fields.address.street }] : [];
  return {
    key, kingdomName: kingdom.name, origin: 'simulated', ...fields,
    homes: [...here, ...elsewhere].map(home => ({
      kingdomId: CitizenKeySchema.shape.kingdomId.parse(home.kingdom.id), kingdomName: home.kingdom.name,
      home: home.home, street: home.street, image: null, path: null,
    })),
    castle: null,
    passport: { hidden: false, stamps: nothing },
    pieces: nothing,
    honours: nothing,
    house: null,
  };
}

/** A day this many months before the passport fixtures' moment, 30 Oct 2026 (UTC months roll back across years). */
const monthsBefore = (months: number) => Date.UTC(2026, 9 - months, 30);

export const CARD_FIXTURES: readonly CardFixture[] = [
  {
    id: 'wren',
    note: 'Wren Tarnwalker: subscribed, a home in Willowmere and one in Tarnhollow, wearing what they earned, with their passport',
    portraitLook: SITTER_LOOK,
    worn: SITTER_WORN.map(offer => ({ name: offer.name, story: offer.story, travel: remembersTravel(offer) })),
    passport: 'many',
    homeTier: 'A cottage',
    document: document(WILLOWMERE, SITTER.personId, {
      revision: { person: 3, citizen: 7 },
      identity: {
        login: SITTER.login, name: SITTER.name, colour: '#2f6f5e', office: null,
        portrait: { id: 'portrait.wren-tarnwalker', revision: 1, alt: `${SITTER.name}’s portrait: auburn braids, a rust coat and a green tenure hood` },
      },
      tenure: { followedAt: monthsBefore(26), subscribedMonths: 14, activeTier: 1 },
      citizenNumber: 212,
      address: { home: 'The Lantern House', street: 'Lantern Row' },
    }, [{ kingdom: TARNHOLLOW, home: 'The Lantern Loft', street: 'Ferry Row' }]),
  },
  {
    id: 'juniper',
    note: 'Juniper Ashdown: arrived this month, no home or portrait yet, and a passport waiting for its first journey',
    portraitLook: null,
    passport: 'none',
    document: document(WILLOWMERE, '930000001', {
      revision: { person: 1, citizen: 1 },
      identity: { login: 'juniper_ashdown', name: 'Juniper Ashdown', colour: '#b5541c', office: null, portrait: null },
      tenure: { followedAt: day(2026, 10, 2), subscribedMonths: null, activeTier: null },
      citizenNumber: 1047,
      address: null,
    }),
  },
  {
    id: 'knight',
    note: 'A moderator of four years, subscribed, with a home on Old Row; a bright red chat colour written on parchment',
    portraitLook: 'citizen-a',
    document: document(LANTERNMERE, '718203547', {
      revision: { person: 4, citizen: 9 },
      identity: { login: 'hale_quill', name: 'Hale_Quill', colour: '#b22222', office: 'moderator', portrait: { id: 'portrait.hale', revision: 3, alt: 'Hale_Quill’s portrait: cropped ash-grey hair, a full dark beard and a tomato-red jacket' } },
      tenure: { followedAt: day(2022, 2, 14), subscribedMonths: 31, activeTier: 2 },
      citizenNumber: 38,
      address: { home: 'Lantern Cottage', street: 'Old Row' },
    }),
  },
  {
    id: 'unknown',
    note: 'A Noble whose follow and sub history Twitch has not shared; bright chat colour on an ink plate',
    portraitLook: 'common-short-cloak-tide',
    document: document(LANTERNMERE, '803344120', {
      revision: { person: 1, citizen: 2 },
      identity: { login: 'mossandember', name: 'MossAndEmber', colour: '#00ff7f', office: 'vip', portrait: { id: 'portrait.moss', revision: 1, alt: 'MossAndEmber’s portrait: a straw hat over black hair and a red vest' } },
      tenure: { followedAt: null, subscribedMonths: null, activeTier: null },
      citizenNumber: 1288,
      address: { home: 'The Reed Hut', street: 'Ferry Lane' },
    }),
  },
  {
    id: 'lapsed',
    note: 'A citizen whose sub lapsed: earned months stay, no tier is claimed',
    portraitLook: null,
    document: document(LANTERNMERE, '652019774', {
      revision: { person: 2, citizen: 5 },
      identity: { login: 'tobyfinch', name: 'TobyFinch', colour: null, office: null, portrait: null },
      tenure: { followedAt: day(2024, 9, 3), subscribedMonths: 7, activeTier: null },
      citizenNumber: 740,
      address: { home: 'Weaver’s End', street: 'Mill Street' },
    }),
  },
];

export function findFixture(id: string): CardFixture | undefined {
  return CARD_FIXTURES.find(fixture => fixture.id === id);
}
