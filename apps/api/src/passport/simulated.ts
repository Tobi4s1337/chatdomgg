/**
 * SIMULATED authorities for the passport read application: the three illustrative books from the craft, taken apart
 * into what real authorities would each hold. The Gate holds only its minimal witnessed stamps; the kingdom
 * directory, witnessed roads and accepted gift receipts are separate records the reader has to join back together.
 * A trusted card source carries disclosure (first sign-in, hide travels). Everything here says `simulated`, and the
 * reader refuses to let it answer for a live card. Nothing here is evidence.
 */
import type { PassportKingdom } from '@chatdom/shared/passport';
import type { CardSource, CitizenKey, KingdomId, PersonId } from '../citizen-card/contracts';
import type { PassportStamp as GateStamp, VisitorGiftView } from '../raid-gate/contracts';
// The craft entry has no JSX or CSS; the `./passport/craft` package subpath is a needs: in progress.
import {
  FIXTURE_AS_OF, FIXTURE_KINGDOMS, simulatedPassport, simulatedPassportPage,
  type PassportFixtureName, type StampView,
} from '../../../../packages/ui/src/passport/craft';
import type { PassportCollection, PassportItem } from './contracts';
import type { AcceptedGiftRecord, WitnessedRoad } from './gate';
import type { PassportPorts, RevisionedPage } from './read';

export interface SimulatedScenario {
  /** False: the subject has never signed in, so nothing of their life elsewhere may show. */
  readonly signedIn: boolean;
  /** The subject chose "Hide my travels". */
  readonly travelsHidden: boolean;
  /** A new journey is witnessed after the first book is read: on the first further page of journeys or kingdoms,
   *  stamps and kingdoms have moved to a new revision. */
  readonly revisedWhileReading?: boolean;
}

export interface SimulatedPassport {
  readonly ports: PassportPorts;
  readonly key: CitizenKey;
  /** The moment the SIMULATED world stands at; reads use it as `now`. */
  readonly now: number;
  /** The SIMULATED card source, for hosts that also draw the card (its disclosed homes name road origins). */
  readonly card: () => CardSource;
}

const DAY = 86_400_000;
/** The holder's own kingdom on each fixture's card: where their home is, and where most roads start. */
const HOMES: Readonly<Record<PassportFixtureName, { kingdomId: string; name: string; login: string; home: string; street: string }>> = {
  none: { kingdomId: '910000103', name: 'Larkspur Hollow', login: 'juniper_ashdown', home: 'The Wicker House', street: 'Mill Lane' },
  few: { kingdomId: '910000101', name: 'Gorsehold', login: 'pellam_rook', home: 'No. 4, the Tanner’s Yard', street: 'Gorse Steps' },
  many: { kingdomId: '910000102', name: 'Tarnhollow', login: 'wren_tarnwalker', home: 'The Lantern Loft', street: 'Ferry Row' },
};
/** The people on the other side of each SIMULATED gift. */
const HOST = '940000001';

function everything<K extends PassportCollection>(name: PassportFixtureName, collection: K): PassportItem<K>[] {
  const first = simulatedPassport(name)[collection];
  const items = [...first.items] as unknown as PassportItem<K>[];
  for (let cursor = first.nextCursor; cursor;) {
    const page = simulatedPassportPage(name, collection, cursor);
    if (!page) throw new Error(`SIMULATED ${name}/${collection} lost its page at ${cursor}`);
    items.push(...page.items as unknown as PassportItem<K>[]);
    cursor = page.nextCursor;
  }
  return items;
}

const visitsOf = (stamps: readonly StampView[]): PassportItem<'kingdoms'>[] => {
  const seen = new Map<string, { kingdom: PassportKingdom; firstAt: number; lastAt: number }>();
  for (const stamp of stamps) {
    const entry = seen.get(stamp.kingdom.kingdomId);
    if (!entry) seen.set(stamp.kingdom.kingdomId, { kingdom: stamp.kingdom as PassportKingdom, firstAt: stamp.at, lastAt: stamp.at });
    else { entry.firstAt = Math.min(entry.firstAt, stamp.at); entry.lastAt = Math.max(entry.lastAt, stamp.at); }
  }
  return [...seen.values()].sort((a, b) => b.lastAt - a.lastAt || a.kingdom.kingdomId.localeCompare(b.kingdom.kingdomId));
};

/** A collection as its own authority holds it: revisioned, paged by its own issued cursors only. */
class Shelf<T> {
  constructor(readonly name: string, private items: readonly T[], private readonly size: number, public revision = 1) {}
  replace(items: readonly T[]) { this.items = items; this.revision++; }
  page(cursor: string | null): RevisionedPage<T> {
    let start = 0;
    if (cursor !== null) {
      const match = new RegExp(`^sim\\.${this.name}\\.([1-9]\\d*)\\.([1-9]\\d*)$`).exec(cursor);
      if (!match) throw new Error('SIMULATED cursor was never issued');
      // A cursor from an older revision still reads, at this revision: the reader sees the revision and calls it stale.
      start = Number(match[2]);
      // Only cursors this shelf issued: a page boundary inside the collection.
      if (start <= 0 || start >= this.items.length || start % this.size !== 0) throw new Error('SIMULATED cursor was never issued');
    }
    const items = this.items.slice(start, start + this.size);
    const end = start + items.length;
    return { revision: this.revision, items, nextCursor: end < this.items.length ? `sim.${this.name}.${this.revision}.${end}` : null };
  }
}

export function simulatedPassportAuthorities(name: PassportFixtureName, scenario: SimulatedScenario): SimulatedPassport {
  const book = simulatedPassport(name);
  const holder = book.holder.personId as PersonId;
  const home = HOMES[name];
  const key = { personId: holder, kingdomId: home.kingdomId as KingdomId } as CitizenKey;
  const size = (collection: PassportCollection) => Math.max(1, book[collection].items.length && book[collection].nextCursor ? book[collection].items.length : 50);

  let stampsAll = everything(name, 'stamps') as StampView[];
  const stamps = new Shelf<StampView>('stamps', stampsAll, size('stamps'));
  const visits = new Shelf('kingdoms', everything(name, 'kingdoms'), size('kingdoms'));
  const bonds = new Shelf('bonds', everything(name, 'bonds'), size('bonds'));
  const keepsakes = new Shelf('keepsakes', everything(name, 'keepsakes'), size('keepsakes'));
  let pendingRevision = !!scenario.revisedWhileReading;
  const revise = () => {
    if (!pendingRevision) return;
    pendingRevision = false;
    // A quiet visit to Copperleaf an hour before the world's moment, witnessed while the first book was open.
    const fresh: StampView = { id: 'arrival:sim-fresh', kind: 'visit', at: FIXTURE_AS_OF - 3_600_000, kingdom: FIXTURE_KINGDOMS.copperleaf, gifts: [] };
    stampsAll = [fresh, ...stampsAll];
    stamps.replace(stampsAll);
    visits.replace(visitsOf(stampsAll));
  };

  const directory = new Map<string, PassportKingdom>();
  const roads = new Map<string, WitnessedRoad>();
  const gifts: AcceptedGiftRecord[] = [];
  const gift = (stamp: StampView, offerId: string, direction: 'left' | 'brought-back', state: VisitorGiftView['state']): VisitorGiftView => ({
    offerId, itemId: `item:${offerId}`, from: (direction === 'left' ? holder : HOST) as PersonId, to: (direction === 'left' ? HOST : holder) as PersonId,
    originKingdomId: stamp.kingdom.kingdomId as KingdomId, makerId: HOST as PersonId, revision: 2, state,
  });
  for (const kingdom of Object.values(FIXTURE_KINGDOMS)) directory.set(kingdom.kingdomId, kingdom as PassportKingdom);
  for (const stamp of stampsAll) {
    if (stamp.kind === 'raid') {
      roads.set(stamp.raidId, { raidId: stamp.raidId, road: { id: stamp.road.id, from: stamp.road.from as KingdomId, to: stamp.road.to as KingdomId }, leader: stamp.leader && { personId: stamp.leader.personId as PersonId, name: stamp.leader.name } });
    }
    for (const g of stamp.gifts) gifts.push({ stampId: stamp.id, gift: gift(stamp, g.id, g.direction, 'accepted'), name: g.name, keepsakeId: g.keepsakeId });
  }
  // Offers that were never accepted stay in the gift ledger and never reach a page.
  const declined = stampsAll.find(stamp => stamp.gifts.length === 0);
  if (declined) gifts.push({ stampId: declined.id, gift: gift(declined, `offer:${declined.id.replace(/^arrival:/, '')}`, 'left', 'refused'), name: 'A tin whistle', keepsakeId: null });

  const card = (): CardSource => ({
    subjectFirstSignedInAt: scenario.signedIn ? FIXTURE_AS_OF - 400 * DAY : null,
    travelsHidden: scenario.travelsHidden,
    dependencies: [],
    document: {
      key, kingdomName: home.name, revision: { person: 3, citizen: 7 }, origin: 'simulated',
      identity: { login: home.login, name: book.holder.name, colour: null, office: null, portrait: null },
      tenure: { followedAt: null, subscribedMonths: null, activeTier: null },
      citizenNumber: null,
      address: { home: home.home, street: home.street },
      homes: [{ kingdomId: key.kingdomId, kingdomName: home.name, home: home.home, street: home.street, image: null, path: null }],
      castle: null,
      passport: { hidden: false, stamps: { availability: 'unavailable' } },
      pieces: { availability: 'unavailable' }, honours: { availability: 'unavailable' }, house: null,
    },
  });

  const only = <T>(person: PersonId, read: () => T): Promise<T> =>
    person === holder ? Promise.resolve().then(read) : Promise.reject(new Error('SIMULATED authority holds no other person'));
  const ports: PassportPorts = {
    origin: 'simulated',
    card: async requested => {
      if (requested.personId !== key.personId || requested.kingdomId !== key.kingdomId) throw new Error('SIMULATED card holds one citizen');
      return card();
    },
    stamps: (person, cursor) => only(person, () => {
      if (cursor !== null) revise();
      const page = stamps.page(cursor);
      const minimal: GateStamp[] = page.items.map(stamp => ({
        id: stamp.id, kingdomId: stamp.kingdom.kingdomId as KingdomId, occurredAt: stamp.at, kind: stamp.kind, raidId: stamp.kind === 'raid' ? stamp.raidId : null,
      }));
      return { hidden: false, revision: page.revision, stamps: minimal, nextCursor: page.nextCursor };
    }),
    visits: (person, cursor) => only(person, () => { if (cursor !== null) revise(); return visits.page(cursor); }),
    bonds: (person, cursor) => only(person, () => bonds.page(cursor)),
    keepsakes: (person, cursor) => only(person, () => keepsakes.page(cursor)),
    kingdoms: async ids => new Map(ids.flatMap(id => (directory.has(id) ? [[id, directory.get(id)!] as const] : []))),
    roads: async raidIds => new Map(raidIds.flatMap(id => (roads.has(id) ? [[id, roads.get(id)!] as const] : []))),
    gifts: (person, stampIds) => only(person, () => gifts.filter(record => stampIds.includes(record.stampId))),
  };
  return { ports, key, now: FIXTURE_AS_OF, card };
}
