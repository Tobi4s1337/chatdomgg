import { CitizenKeySchema, type CitizenKey } from '@chatdom/shared';
import type { CitizenCardDocument } from '../../../api/src/citizen-card/contracts';

/**
 * SIMULATED citizens for the card bench. Every document says `origin: 'simulated'` and the card prints that on
 * every view; none of these people, kingdoms or dates exist on Twitch. Portraits are actual renders of the
 * avatar library's review looks (`portraitLook`), made by the bench, never stand-in pictures.
 */
export interface CardFixture {
  readonly id: string;
  readonly note: string;
  /** The review look from `packages/content/src/avatars/review.ts` rendered for the portrait asset. */
  readonly portraitLook: string | null;
  readonly document: CitizenCardDocument;
}

const LANTERNMERE = '491305829';
const key = (personId: string): CitizenKey => CitizenKeySchema.parse({ personId, kingdomId: LANTERNMERE });
const day = (year: number, month: number, date: number) => Date.UTC(year, month - 1, date);
const nothing = { availability: 'known', entries: [], next: null } as const;

function document(personId: string, fields: Omit<CitizenCardDocument, 'key' | 'kingdomName' | 'origin' | 'homes' | 'castle' | 'passport' | 'pieces' | 'honours' | 'house'>): CitizenCardDocument {
  const k = key(personId);
  return {
    key: k, kingdomName: 'Lanternmere', origin: 'simulated', ...fields,
    homes: fields.address ? [{ kingdomId: k.kingdomId, kingdomName: 'Lanternmere', home: fields.address.home, street: fields.address.street, image: null, path: null }] : [],
    castle: null,
    passport: { hidden: false, stamps: nothing },
    pieces: nothing,
    honours: nothing,
    house: null,
  };
}

export const CARD_FIXTURES: readonly CardFixture[] = [
  {
    id: 'wren',
    note: 'A moderator of four years, subscribed, with a home on Old Row',
    portraitLook: 'citizen-a',
    document: document('718203547', {
      revision: { person: 4, citizen: 9 },
      identity: { login: 'wren_quill', name: 'Wren_Quill', colour: '#b22222', office: 'moderator', portrait: { id: 'portrait.wren', revision: 3, alt: 'Wren_Quill’s portrait: brown side-parted hair and a short red cloak' } },
      tenure: { followedAt: day(2022, 2, 14), subscribedMonths: 14, activeTier: 1 },
      citizenNumber: 212,
      address: { home: 'Lantern Cottage', street: 'Old Row' },
    }),
  },
  {
    id: 'unknown',
    note: 'A Noble whose follow and sub history Twitch has not shared; bright chat colour on an ink plate',
    portraitLook: 'common-short-cloak-tide',
    document: document('803344120', {
      revision: { person: 1, citizen: 2 },
      identity: { login: 'mossandember', name: 'MossAndEmber', colour: '#00ff7f', office: 'vip', portrait: { id: 'portrait.moss', revision: 1, alt: 'MossAndEmber’s portrait: black side-parted hair and a short blue cloak' } },
      tenure: { followedAt: null, subscribedMonths: null, activeTier: null },
      citizenNumber: 1288,
      address: { home: 'The Reed Hut', street: 'Ferry Lane' },
    }),
  },
  {
    id: 'lapsed',
    note: 'A citizen whose sub lapsed: earned months stay, no tier is claimed',
    portraitLook: null,
    document: document('652019774', {
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
