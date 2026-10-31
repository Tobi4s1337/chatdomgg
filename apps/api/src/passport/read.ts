/**
 * The passport read application (spec 45 R1–R4). Main binds it to an authenticated route and to the real
 * authorities; this module owns the order of operations, which is the whole point:
 *
 * 1. **Disclosure first.** The citizen card's current trusted source goes through `projectCard`. Before the first
 *    sign-in, or with travels hidden, the reply is the schema's hidden variant and no history port is even asked.
 * 2. **Witnessed records only.** Stamps are the Gate authority's own records, enriched from corresponding trusted
 *    records (`enrichGateStamps`); kingdoms reached, bonds and keepsakes come from their authorities as they are.
 * 3. **One snapshot.** The book's revision names the revision of each collection it was read at. A further page is
 *    read against that revision; if that collection has moved on, the reply is `stale` and the surface reopens the
 *    book instead of mixing two snapshots.
 * 4. **Disclosure again.** The card is read once more after the history and before anything leaves, so a hide that
 *    lands mid-read still wins, and the holder's name is the one the card shows now.
 * 4a. **Never backwards.** The reader remembers the highest card revision it has seen for each citizen. A card source
 *    older than that (a cache or replica replaying the moment before a hide) is refused as unavailable, so a stale
 *    "shown" can never undo a newer "hidden".
 * 5. **Checked out.** The reply is re-read with the same boundary reader every surface uses; a corrupt record makes
 *    the read unavailable, never an empty or partial book.
 */
import type { PassportKingdom } from '@chatdom/shared/passport';
import type { CardSource, CitizenKey } from '../citizen-card/contracts';
import { projectCard } from '../citizen-card/project';
import type { PassportView as GatePassportView, PersonId } from '../raid-gate/contracts';
import {
  hiddenPassport, readPassportBook, readPassportReply, readPassportRequest,
  type PassportCollection, type PassportItem, type PassportPageOf, type PassportReply, type PassportRequest, type VisiblePassportBook,
} from './contracts';
import { disclosedPlaces, passportDisclosure, samePlaces, type PassportDisclosure } from './disclosure';
import { enrichGateStamps, type AcceptedGiftRecord, type EnrichmentGap, type WitnessedRoad } from './gate';

/** One page of an authority's records with the revision it was read at. */
export interface RevisionedPage<T> { readonly revision: number; readonly items: readonly T[]; readonly nextCursor: string | null }

export interface PassportPorts {
  /** What these authorities are. A simulated set never answers for a live card, and the reverse. */
  readonly origin: 'live' | 'simulated';
  /** The trusted, current card source for this citizen in this kingdom. */
  card(key: CitizenKey, signal: AbortSignal): Promise<CardSource>;
  /** The Gate authority's witnessed stamps for this person (spec 23 `PassportView`), one page from `cursor`. */
  stamps(person: PersonId, cursor: string | null, signal: AbortSignal): Promise<GatePassportView>;
  visits(person: PersonId, cursor: string | null, signal: AbortSignal): Promise<RevisionedPage<PassportItem<'kingdoms'>>>;
  bonds(person: PersonId, cursor: string | null, signal: AbortSignal): Promise<RevisionedPage<PassportItem<'bonds'>>>;
  keepsakes(person: PersonId, cursor: string | null, signal: AbortSignal): Promise<RevisionedPage<PassportItem<'keepsakes'>>>;
  /** Approved public name and arms for each kingdom ID it knows. Unknown IDs are simply absent. */
  kingdoms(ids: readonly string[], signal: AbortSignal): Promise<ReadonlyMap<string, PassportKingdom>>;
  /** The witnessed road and leader for each raid ID it knows. */
  roads(raidIds: readonly string[], signal: AbortSignal): Promise<ReadonlyMap<string, WitnessedRoad>>;
  /** Accepted gift receipts linked to these stamps for this holder. */
  gifts(holder: PersonId, stampIds: readonly string[], signal: AbortSignal): Promise<readonly AcceptedGiftRecord[]>;
}

export interface PassportReadContext {
  /** The card's subject, already resolved by main's route from the public card path. */
  readonly key: CitizenKey;
  readonly now: number;
  readonly signal: AbortSignal;
}

/** Why a read answered unavailable, for main's logs. Never part of a reply. */
export type PassportReadFault =
  | Readonly<{ kind: 'enrichment'; collection: 'stamps'; missing: EnrichmentGap }>
  | Readonly<{ kind: 'source' | 'origin' | 'subject' | 'record' | 'port'; detail: string }>;

/**
 * One book read whole for a server-side surface (the share picture), with what the card disclosed at the end of the
 * read: the places it shows publicly and its disclosure revision. Hidden and unavailable carry nothing else.
 */
export type PassportSnapshot =
  | Readonly<{ kind: 'visible'; book: VisiblePassportBook; places: ReadonlyMap<string, string>; disclosure: PassportDisclosure }>
  | Readonly<{ kind: 'hidden' }>
  | Readonly<{ kind: 'unavailable' }>;

export interface PassportReader {
  handle(context: PassportReadContext, request: unknown): Promise<PassportReply>;
  /** The first book, read exactly as `handle({ op: 'book' })` reads it, with the card's places and disclosure. */
  snapshot(context: PassportReadContext): Promise<PassportSnapshot>;
}

/** Same book, same holder, same places and the same disclosure revision: nothing a picture of one could get wrong. */
export function sameSnapshot(a: Extract<PassportSnapshot, { kind: 'visible' }>, b: Extract<PassportSnapshot, { kind: 'visible' }>): boolean {
  return a.book.holder.personId === b.book.holder.personId && a.book.holder.name === b.book.holder.name && a.book.revision === b.book.revision
    && a.book.origin === b.book.origin && a.disclosure.revision === b.disclosure.revision && samePlaces(a.places, b.places);
}

class Unavailable extends Error {
  constructor(readonly fault: PassportReadFault) { super(fault.kind); this.name = 'PassportUnavailable'; }
}

type Disclosure =
  | Readonly<{ kind: 'hidden'; origin: 'live' | 'simulated' }>
  | Readonly<{ kind: 'visible'; origin: 'live' | 'simulated'; holder: { personId: PersonId; name: string }; places: ReadonlyMap<string, string>; gate: PassportDisclosure }>;

/** How many citizens' highest card revisions one reader remembers (least recently read forgotten first). */
const REMEMBERED = 4096;

const REVISION = /^p1\.(\d{1,15})\.(\d{1,15})\.(\d{1,15})\.(\d{1,15})$/;
type Revisions = Readonly<Record<PassportCollection, number>>;
const writeRevision = (r: Revisions) => `p1.${r.stamps}.${r.kingdoms}.${r.bonds}.${r.keepsakes}`;
function parseRevision(value: string): Revisions | undefined {
  const match = REVISION.exec(value);
  if (!match) return undefined;
  const [stamps, kingdoms, bonds, keepsakes] = match.slice(1).map(Number) as [number, number, number, number];
  return { stamps, kingdoms, bonds, keepsakes };
}
const isRevisionNumber = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 1e15;

export function createPassportReader(ports: PassportPorts, options: { report?: (fault: PassportReadFault) => void } = {}): PassportReader {
  const alive = (signal: AbortSignal) => { if (signal.aborted) throw new Unavailable({ kind: 'port', detail: 'aborted' }); };
  const highest = new Map<string, number>();
  /** Refuse a card older than one already read for this citizen; remember the newest. */
  const forward = (key: CitizenKey, revision: number) => {
    const mark = `${key.kingdomId}/${key.personId}`;
    const seen = highest.get(mark);
    if (seen !== undefined && revision < seen) throw new Unavailable({ kind: 'source', detail: `card revision ${revision} is older than ${seen}, already read` });
    highest.delete(mark);
    highest.set(mark, Math.max(seen ?? revision, revision));
    if (highest.size > REMEMBERED) highest.delete(highest.keys().next().value!);
  };

  async function disclose(context: PassportReadContext): Promise<Disclosure> {
    const source = await ports.card(context.key, context.signal);
    alive(context.signal);
    let card;
    try { card = projectCard(source); } catch (error) {
      throw new Unavailable({ kind: 'source', detail: error instanceof Error ? error.message : 'unreadable card source' });
    }
    if (card.key.personId !== context.key.personId || card.key.kingdomId !== context.key.kingdomId) {
      throw new Unavailable({ kind: 'subject', detail: 'the card source answered for another citizen' });
    }
    if (card.origin !== ports.origin) throw new Unavailable({ kind: 'origin', detail: `a ${ports.origin} passport cannot answer for a ${card.origin} card` });
    forward(context.key, card.revision.person);
    if (card.passport.hidden) return { kind: 'hidden', origin: card.origin };
    return {
      kind: 'visible', origin: card.origin, holder: { personId: context.key.personId, name: card.identity.name },
      places: disclosedPlaces(card), gate: passportDisclosure(card),
    };
  }

  /** One page of witnessed Gate stamps, enriched. A Gate that reports hidden makes the whole book hidden. */
  async function stampsAt(person: PersonId, cursor: string | null, signal: AbortSignal, expected?: number) {
    const view = await ports.stamps(person, cursor, signal);
    alive(signal);
    if (view.hidden) return { hidden: true as const };
    if (!isRevisionNumber(view.revision)) throw new Unavailable({ kind: 'record', detail: 'stamps revision' });
    // A page of another snapshot is not worth enriching: the surface will reopen the book.
    if (expected !== undefined && view.revision !== expected) return { hidden: false as const, revision: view.revision, page: { items: [], nextCursor: null } };
    const kingdomIds = [...new Set(view.stamps.map(stamp => stamp.kingdomId))];
    const raidIds = [...new Set(view.stamps.flatMap(stamp => (stamp.raidId ? [stamp.raidId] : [])))];
    const stampIds = view.stamps.map(stamp => stamp.id);
    const [kingdoms, roads, gifts] = await Promise.all([
      kingdomIds.length ? ports.kingdoms(kingdomIds, signal) : new Map<string, PassportKingdom>(),
      raidIds.length ? ports.roads(raidIds, signal) : new Map<string, WitnessedRoad>(),
      stampIds.length ? ports.gifts(person, stampIds, signal) : [],
    ]);
    alive(signal);
    const enriched = enrichGateStamps(person, view.stamps, { kingdoms, roads, gifts });
    if (!enriched.ok) throw new Unavailable({ kind: 'enrichment', collection: 'stamps', missing: enriched.missing });
    return { hidden: false as const, revision: view.revision, page: { items: enriched.stamps, nextCursor: view.nextCursor } };
  }

  async function recordsAt<K extends Exclude<PassportCollection, 'stamps'>>(collection: K, person: PersonId, cursor: string | null, signal: AbortSignal) {
    const read = { kingdoms: ports.visits, bonds: ports.bonds, keepsakes: ports.keepsakes }[collection] as
      (person: PersonId, cursor: string | null, signal: AbortSignal) => Promise<RevisionedPage<PassportItem<K>>>;
    const page = await read.call(ports, person, cursor, signal);
    alive(signal);
    if (!isRevisionNumber(page.revision)) throw new Unavailable({ kind: 'record', detail: `${collection} revision` });
    return { revision: page.revision, page: { items: page.items, nextCursor: page.nextCursor } as PassportPageOf<K> };
  }

  async function readBook(context: PassportReadContext, disclosure: Extract<Disclosure, { kind: 'visible' }>): Promise<PassportReply> {
    const person = context.key.personId;
    const [stamps, kingdoms, bonds, keepsakes] = await Promise.all([
      stampsAt(person, null, context.signal),
      recordsAt('kingdoms', person, null, context.signal),
      recordsAt('bonds', person, null, context.signal),
      recordsAt('keepsakes', person, null, context.signal),
    ]);
    if (stamps.hidden) return { kind: 'book', book: hiddenPassport(disclosure.origin) };
    const book = readPassportBook({
      version: 1, origin: disclosure.origin, visibility: 'visible', holder: disclosure.holder,
      revision: writeRevision({ stamps: stamps.revision, kingdoms: kingdoms.revision, bonds: bonds.revision, keepsakes: keepsakes.revision }),
      asOf: context.now, stamps: stamps.page, kingdoms: kingdoms.page, bonds: bonds.page, keepsakes: keepsakes.page,
    });
    if (!book) throw new Unavailable({ kind: 'record', detail: 'the composed book failed the frozen schema' });
    return { kind: 'book', book };
  }

  async function readPage(context: PassportReadContext, request: Extract<PassportRequest, { op: 'page' }>, origin: 'live' | 'simulated'): Promise<PassportReply> {
    const revisions = parseRevision(request.revision);
    if (!revisions) return { kind: 'denied', code: 'invalid' };
    const person = context.key.personId;
    const read = request.collection === 'stamps'
      ? await stampsAt(person, request.cursor, context.signal, revisions.stamps)
      : { hidden: false as const, ...await recordsAt(request.collection, person, request.cursor, context.signal) };
    if (read.hidden) return { kind: 'book', book: hiddenPassport(origin) };
    // The collection moved on since the book was read: the surface reopens the book rather than mixing snapshots.
    if (read.revision !== revisions[request.collection]) return { kind: 'denied', code: 'stale' };
    return { kind: 'page', collection: request.collection, revision: request.revision, page: read.page } as PassportReply;
  }

  /** One read in the order the module header gives, answering the reply and the card as it stood at the end. */
  async function run(context: PassportReadContext, request: PassportRequest): Promise<{ reply: PassportReply; after?: Extract<Disclosure, { kind: 'visible' }> }> {
    try {
      const before = await disclose(context);
      if (before.kind === 'hidden') return { reply: { kind: 'book', book: hiddenPassport(before.origin) } };
      let reply = request.op === 'book' ? await readBook(context, before) : await readPage(context, request, before.origin);
      // A hide that landed while the history was read wins over the history.
      const after = await disclose(context);
      if (after.kind === 'hidden') return { reply: { kind: 'book', book: hiddenPassport(after.origin) } };
      // A rename that landed meanwhile: the book carries the name the card shows now.
      if (reply.kind === 'book' && reply.book.visibility === 'visible') reply = { kind: 'book', book: { ...reply.book, holder: after.holder } };
      const checked = readPassportReply(reply);
      if (!checked) throw new Unavailable({ kind: 'record', detail: 'the reply failed its own boundary reader' });
      return { reply: checked, after };
    } catch (error) {
      options.report?.(error instanceof Unavailable ? error.fault : { kind: 'port', detail: error instanceof Error ? error.message : 'port failed' });
      return { reply: { kind: 'denied', code: 'unavailable' } };
    }
  }

  return {
    async handle(context, input) {
      const request = readPassportRequest(input);
      if (!request) return { kind: 'denied', code: 'invalid' };
      return (await run(context, request)).reply;
    },
    async snapshot(context) {
      const { reply, after } = await run(context, { op: 'book' });
      if (reply.kind !== 'book') return { kind: 'unavailable' };
      if (reply.book.visibility !== 'visible') return { kind: 'hidden' };
      if (!after) return { kind: 'unavailable' };
      return { kind: 'visible', book: reply.book, places: after.places, disclosure: after.gate };
    },
  };
}
