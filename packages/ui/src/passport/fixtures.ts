import { inkHash, inkStream } from './ink';
import type { BondView, GiftView, KeepsakeView, KingdomView, PageView, PassportCollection, PersonView, StampView, VisiblePassportView, VisitView } from './types';

/**
 * Three illustrative books, SIMULATED end to end: invented citizens and invented kingdoms, `origin: 'simulated'`,
 * deterministic from fixed seeds. They exist so the book can be seen empty, lightly travelled and well travelled
 * before a real authority supplies one. Every surface that shows them says SIMULATED; nothing here is evidence.
 */
export type PassportFixtureName = 'none' | 'few' | 'many';
export const PASSPORT_FIXTURE_NAMES: readonly PassportFixtureName[] = ['none', 'few', 'many'];
export const PASSPORT_FIXTURE_TITLES: Readonly<Record<PassportFixtureName, string>> = {
  none: 'A new book, no journeys yet',
  few: 'Three raids and two visits',
  many: 'Eighty-four raids across ten kingdoms',
};

/** 30 October 2026, 21:00 UTC: the moment every fixture book was last written. */
export const FIXTURE_AS_OF = Date.UTC(2026, 9, 30, 21, 0);
const DAY = 86_400_000;

const kingdom = (kingdomId: string, name: string, shape: KingdomView['crest']['shape'], charge: KingdomView['crest']['charge'], colours: string[]): KingdomView =>
  ({ kingdomId, name, crest: { key: `crest:${kingdomId}:1`, shape, charge, colours, assetHash: null } });

/** Invented kingdoms. Their names cover a very long name, Japanese, Cyrillic and Arabic, and two pale arms. */
export const FIXTURE_KINGDOMS = {
  copperleaf: kingdom('910000001', 'Copperleaf', 'heater', 'oak', ['#7a432b', '#d4ab61']),
  hollowmere: kingdom('910000002', 'Hollowmere', 'round', 'wave', ['#1f4e5f', '#e9dcb5', '#8fb6b0']),
  saltmarsh: kingdom('910000003', 'Saltmarsh Reach', 'swallowtail', 'wave', ['#2c3e66', '#f0e6cc', '#b84a3a']),
  brindlewick: kingdom('910000004', 'Brindlewick-under-the-Long-Ridge-of-Seven-Lanterns', 'heater', 'mountain', ['#4b5a3a', '#efe3c0', '#7a2e2a', '#c9a24a']),
  kiri: kingdom('910000005', '霧の港', 'round', 'star', ['#5a3d6e', '#f2d27a']),
  pinebrod: kingdom('910000006', 'Сосновый Брод', 'swallowtail', 'oak', ['#2f5d3a', '#d9c27a', '#3a2a1c']),
  oasis: kingdom('910000007', 'واحة النخيل', 'round', 'star', ['#b8743a', '#2d4a5a', '#f3e2b8']),
  emberfold: kingdom('910000008', 'Emberfold', 'heater', 'star', ['#9b2d20', '#f1c45a']),
  thistledown: kingdom('910000009', 'Thistledown Crossing', 'heater', 'mountain', ['#9d8fc0', '#efe8f6']),
  whitecliff: kingdom('910000010', 'Whitecliff', 'round', 'mountain', ['#ece6d6', '#b4c4d2']),
} as const satisfies Record<string, KingdomView>;

/** The holders' own homes. A raid's road starts here; a home is not a kingdom the holder reached, so it is no stamp. */
const HOME = { gorse: '910000101', tarn: '910000102' } as const;

const person = (personId: string, name: string): PersonView => ({ personId, name });
const LEADERS: readonly (PersonView | null)[] = [
  person('920000001', 'Maple Wren'), person('920000002', 'Old Tamsin of the Ferry'), person('920000003', 'Bramblecoat'),
  null, person('920000004', 'Ысолта'), person('920000005', 'Corriander Vale'),
];
const GIFT_NAMES: Readonly<Record<GiftView['direction'], readonly string[]>> = {
  left: ['A copper acorn', 'A jar of heather honey', 'A carved driftwood fox', 'A lantern wick, tied in red', 'A pressed sea-pink'],
  'brought-back': ['A river-smoothed stone', 'A ribbon from the market', 'A sprig of salt lavender', 'A brass ferry token', 'A painted pebble'],
};

interface Book {
  readonly book: VisiblePassportView;
  readonly all: { readonly [K in PassportCollection]: readonly CollectionItem<K>[] };
  readonly pageSize: Readonly<Record<PassportCollection, number>>;
}
type CollectionItem<K extends PassportCollection> = K extends 'stamps' ? StampView : K extends 'kingdoms' ? VisitView : K extends 'bonds' ? BondView : KeepsakeView;

function raid(id: string, at: number, to: KingdomView, from: string, leader: PersonView | null, gifts: GiftView[]): StampView {
  return { id, kind: 'raid', at, kingdom: to, gifts, raidId: `raid:${id.split(':')[1]}`, road: { id: `road:${from}:${to.kingdomId}`, from, to: to.kingdomId }, leader };
}
const visit = (id: string, at: number, to: KingdomView, gifts: GiftView[] = []): StampView => ({ id, kind: 'visit', at, kingdom: to, gifts });

/** Kingdoms reached, derived from the stamps as an authority would hold them: first and last arrival, newest first. */
function visitsOf(stamps: readonly StampView[]): VisitView[] {
  const byKingdom = new Map<string, { kingdom: KingdomView; firstAt: number; lastAt: number }>();
  for (const stamp of stamps) {
    const seen = byKingdom.get(stamp.kingdom.kingdomId);
    if (!seen) byKingdom.set(stamp.kingdom.kingdomId, { kingdom: stamp.kingdom, firstAt: stamp.at, lastAt: stamp.at });
    else { seen.firstAt = Math.min(seen.firstAt, stamp.at); seen.lastAt = Math.max(seen.lastAt, stamp.at); }
  }
  return [...byKingdom.values()].sort((a, b) => b.lastAt - a.lastAt || a.kingdom.kingdomId.localeCompare(b.kingdom.kingdomId));
}

function assemble(holder: PersonView, revision: string, all: Book['all'], pageSize: Book['pageSize']): Book {
  const first = <K extends PassportCollection>(key: K): PageView<CollectionItem<K>> => {
    const items = all[key].slice(0, pageSize[key]) as CollectionItem<K>[];
    return { items, nextCursor: all[key].length > items.length ? `sim:${key}:${items.length}` : null };
  };
  return {
    all, pageSize,
    book: {
      version: 1, origin: 'simulated', visibility: 'visible', holder, revision, asOf: FIXTURE_AS_OF,
      stamps: first('stamps'), kingdoms: first('kingdoms'), bonds: first('bonds'), keepsakes: first('keepsakes'),
    },
  };
}

function none(): Book {
  return assemble(person('930000001', 'Juniper Ashdown'), 'sim:none:1', { stamps: [], kingdoms: [], bonds: [], keepsakes: [] },
    { stamps: 50, kingdoms: 50, bonds: 50, keepsakes: 50 });
}

function few(): Book {
  const k = FIXTURE_KINGDOMS;
  const at = (daysAgo: number, hour: number) => FIXTURE_AS_OF - daysAgo * DAY - (21 - hour) * 3_600_000;
  const stamps: StampView[] = [
    raid('arrival:f5', at(2, 20), k.hollowmere, HOME.gorse, LEADERS[0]!, [{ id: 'gift:f5a', name: 'A jar of heather honey', direction: 'left', keepsakeId: null }]),
    visit('arrival:f4', at(9, 19), k.copperleaf),
    raid('arrival:f3', at(16, 21), k.brindlewick, HOME.gorse, null, []),
    visit('arrival:f2', at(31, 18), k.kiri, [{ id: 'gift:f2a', name: 'A paper crane folded from a map', direction: 'brought-back', keepsakeId: 'keepsake:f2a' }]),
    raid('arrival:f1', at(40, 20), k.copperleaf, HOME.gorse, LEADERS[1]!, [
      { id: 'gift:f1a', name: 'A carved driftwood fox', direction: 'left', keepsakeId: null },
      { id: 'gift:f1b', name: 'A copper acorn', direction: 'brought-back', keepsakeId: 'keepsake:f1b' },
    ]),
  ];
  const bonds: BondView[] = [
    { id: 'bond:f1', since: at(40, 21), name: 'Friends of the Copperleaf hearth', with: { kind: 'kingdom', kingdom: k.copperleaf } },
    { id: 'bond:f2', since: at(2, 21), name: 'Rode beside each other to Hollowmere', with: { kind: 'citizen', person: person('920000006', 'Linnet Harrow') } },
  ];
  const keepsakes: KeepsakeView[] = [
    { id: 'keepsake:f2a', name: 'A paper crane folded from a map', earnedAt: at(31, 18), kingdom: k.kiri, artHash: null },
    { id: 'keepsake:f1b', name: 'A copper acorn', earnedAt: at(40, 20), kingdom: k.copperleaf, artHash: null },
  ];
  return assemble(person('930000002', 'Pellam Rook'), 'sim:few:1', { stamps, kingdoms: visitsOf(stamps), bonds, keepsakes },
    { stamps: 50, kingdoms: 50, bonds: 50, keepsakes: 50 });
}

function many(): Book {
  const next = inkStream(inkHash('passport-fixture:many'));
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
  const k = FIXTURE_KINGDOMS;
  // Ten kingdoms, weighted so the book has favourite roads and a few rare ones, as a real year of raids would.
  const destinations = [k.copperleaf, k.copperleaf, k.hollowmere, k.hollowmere, k.saltmarsh, k.brindlewick, k.kiri, k.pinebrod, k.oasis,
    k.emberfold, k.emberfold, k.thistledown, k.whitecliff];
  const stamps: StampView[] = [];
  let at = FIXTURE_AS_OF - 6 * 3_600_000;
  let raids = 0, visits = 0, n = 0;
  while (raids < 84) {
    n++;
    const to = pick(destinations);
    const gifts: GiftView[] = [];
    if (next() < 0.32) {
      const direction = next() < 0.5 ? 'left' : 'brought-back';
      gifts.push({ id: `gift:m${n}a`, name: pick(GIFT_NAMES[direction]), direction, keepsakeId: direction === 'brought-back' ? `keepsake:m${n}a` : null });
    }
    // Every seventh entry is a quiet visit between raids.
    if (n % 7 === 0 && visits < 6) { stamps.push(visit(`arrival:m${n}`, at, to, gifts)); visits++; }
    else {
      // Most roads leave from the holder's home; some leave from Copperleaf, where they also keep a home.
      const from = to.kingdomId !== k.copperleaf.kingdomId && next() < 0.18 ? k.copperleaf.kingdomId : HOME.tarn;
      stamps.push(raid(`arrival:m${n}`, at, to, from, pick(LEADERS), gifts)); raids++;
    }
    at -= Math.round((2.2 + next() * 3.6) * DAY);
  }
  const bonds: BondView[] = [
    ...[k.copperleaf, k.hollowmere, k.emberfold, k.pinebrod].map((kingdom, i) =>
      ({ id: `bond:mk${i}`, since: FIXTURE_AS_OF - (300 - i * 61) * DAY, name: ['Sworn guest of the Copperleaf hearth', 'Keeper of the Hollowmere ferry rope', 'Friend of the Emberfold forge', 'Названый гость Соснового Брода'][i]!, with: { kind: 'kingdom' as const, kingdom } })),
    ...['Linnet Harrow', 'Pip Okonkwo-Marsh', 'Ысолта', 'Hesper of the Long Ridge, who sang the whole road home', 'Doran Quill', 'Saffi', 'Teodor Brask'].map((name, i) =>
      ({ id: `bond:mc${i}`, since: FIXTURE_AS_OF - (280 - i * 37) * DAY, name: ['Road companions', 'Shared a lantern on the march', 'Rode the same raids', 'Sang the road home together', 'Carried the gate banner', 'First raid together', 'Swapped keepsakes'][i]!, with: { kind: 'citizen' as const, person: person(`92000010${i}`, name) } })),
  ].sort((a, b) => b.since - a.since);
  const keepsakes: KeepsakeView[] = stamps.flatMap(stamp => stamp.gifts.filter(gift => gift.keepsakeId)
    .map(gift => ({ id: gift.keepsakeId!, name: gift.name, earnedAt: stamp.at, kingdom: stamp.kingdom, artHash: null })));
  return assemble(person('930000003', 'Wren Tarnwalker'), 'sim:many:1', { stamps, kingdoms: visitsOf(stamps), bonds, keepsakes },
    // The authority chooses page sizes up to 50: stamps run the full 50, bonds and keepsakes page sooner.
    { stamps: 50, kingdoms: 50, bonds: 8, keepsakes: 6 });
}

const BOOKS: Readonly<Record<PassportFixtureName, () => Book>> = { none, few, many };
const cache = new Map<PassportFixtureName, Book>();
const fixture = (name: PassportFixtureName) => {
  let book = cache.get(name);
  if (!book) cache.set(name, book = BOOKS[name]());
  return book;
};

/** The book as a reader first receives it: holder, revision and the first page of every collection. SIMULATED. */
export function simulatedPassport(name: PassportFixtureName): VisiblePassportView {
  return fixture(name).book;
}

/**
 * The next page of one collection after `cursor`, as the same revision of the same SIMULATED book. Cursors it never
 * issued (malformed, out of range, or in range but off a page boundary) return null: a fixture never invents a page.
 */
export function simulatedPassportPage<K extends PassportCollection>(name: PassportFixtureName, collection: K, cursor: string): PageView<CollectionItem<K>> | null {
  const book = fixture(name);
  const match = /^sim:([a-z]+):([1-9]\d*)$/.exec(cursor);
  if (!match || match[1] !== collection) return null;
  const start = Number(match[2]);
  const all = book.all[collection] as readonly CollectionItem<K>[];
  // Only cursors the fixture issued: a page boundary inside the collection, never an arbitrary in-range offset.
  if (!Number.isSafeInteger(start) || start <= 0 || start >= all.length || start % book.pageSize[collection] !== 0) return null;
  const items = all.slice(start, start + book.pageSize[collection]);
  const end = start + items.length;
  return { items, nextCursor: end < all.length ? `sim:${collection}:${end}` : null };
}

/** The revision each fixture's pages belong to. */
export const simulatedRevision = (name: PassportFixtureName) => fixture(name).book.revision;
