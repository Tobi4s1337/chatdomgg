/**
 * A transactional in-memory `TravelRepository` for tests and the labelled bench. It keeps the compare-and-set,
 * all-or-nothing and strict-reader rules a durable adapter must keep, so a write the coordinator should never make
 * fails here first. Never bound as production storage.
 */
import type { KingdomId, PersonId } from '../../../../packages/shared/src/identity';
import {
  inListing, readArrivalRecord, readTravelRecord, readWhereaboutsRecord, TRAVEL_LIST_LIMIT,
  type ArrivalRecord, type Stored, type TravelRecord, type TravelRepository, type TravelTransaction, type WhereaboutsRecord,
} from './records';

type Table<T> = Map<string, T>;
interface Tables { travel: Table<TravelRecord>; arrivals: Table<ArrivalRecord>; whereabouts: Table<WhereaboutsRecord> }
const empty = (): Tables => ({ travel: new Map(), arrivals: new Map(), whereabouts: new Map() });

export interface MemoryTravelRepository extends TravelRepository {
  /** Committed state only, for assertions. */
  snapshot(): Readonly<{ travel: TravelRecord[]; arrivals: ArrivalRecord[]; whereabouts: WhereaboutsRecord[] }>;
}

const stage = <T>(committed: Table<T>, staged: Table<T>, key: string): T | null => staged.get(key) ?? committed.get(key) ?? null;

function put<T extends { revision: number }>(committed: Table<T>, staged: Table<T>, key: string, record: T, expected: number, read: (value: unknown) => T | undefined): Stored<T> {
  const current = stage(committed, staged, key);
  if ((current?.revision ?? 0) !== expected || record.revision !== expected + 1) return { kind: 'conflict', current };
  const copy = read(structuredClone(record));
  if (!copy) throw new Error('Refusing to store a malformed travel record.');
  staged.set(key, copy);
  return { kind: 'stored', record: copy };
}

export function createMemoryTravelRepository(): MemoryTravelRepository {
  const tables = empty();
  let queue: Promise<unknown> = Promise.resolve();

  async function run<T>(work: (tx: TravelTransaction) => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    const staged = empty();
    const merged = () => new Map([...tables.travel, ...staged.travel]);
    const tx: TravelTransaction = {
      getTravel: async ticket => stage(tables.travel, staged.travel, ticket),
      findTravel: async (personId: PersonId, requestId: string) =>
        [...merged().values()].find(record => record.personId === personId && record.requestId === requestId) ?? null,
      putTravel: async (record, expected) => {
        // Unique on (person, request): a second ticket under one key is refused like the database's unique index.
        const other = [...merged().values()].find(each => each.personId === record.personId && each.requestId === record.requestId && each.ticket !== record.ticket);
        if (other) return { kind: 'conflict', current: stage(tables.travel, staged.travel, record.ticket) };
        return put(tables.travel, staged.travel, record.ticket, record, expected, readTravelRecord);
      },
      getArrival: async arrivalId => stage(tables.arrivals, staged.arrivals, arrivalId),
      putArrival: async (record, expected) => put(tables.arrivals, staged.arrivals, record.arrivalId, record, expected, readArrivalRecord),
      getWhereabouts: async personId => stage(tables.whereabouts, staged.whereabouts, personId),
      putWhereabouts: async (record, expected) => put(tables.whereabouts, staged.whereabouts, record.personId, record, expected, readWhereaboutsRecord),
      listTravel: async (listing, after, limit) => {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > TRAVEL_LIST_LIMIT) throw new Error('A travel listing takes 1–100 records.');
        const all = merged();
        return [...all.keys()].filter(key => after === null || key > after).sort()
          .map(key => all.get(key)!).filter(record => inListing(record, listing)).slice(0, limit).map(record => structuredClone(record));
      },
      listArrivedIn: async (kingdomId: KingdomId, limit: number) => {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > TRAVEL_LIST_LIMIT) throw new Error('A travel listing takes 1–100 records.');
        return [...new Map([...tables.whereabouts, ...staged.whereabouts]).values()]
          .filter(record => record.kingdomId === kingdomId && record.arrivalId !== null)
          .sort((a, b) => b.updatedAt - a.updatedAt || (a.personId < b.personId ? -1 : 1)).slice(0, limit).map(record => structuredClone(record));
      },
    };
    const result = await work(tx);
    signal.throwIfAborted();
    for (const [key, value] of staged.travel) tables.travel.set(key, value);
    for (const [key, value] of staged.arrivals) tables.arrivals.set(key, value);
    for (const [key, value] of staged.whereabouts) tables.whereabouts.set(key, value);
    return result;
  }

  return {
    transaction<T>(work: (tx: TravelTransaction) => Promise<T>, signal: AbortSignal): Promise<T> {
      const next = queue.then(() => run(work, signal));
      queue = next.catch(() => undefined);
      return next;
    },
    snapshot: () => structuredClone({ travel: [...tables.travel.values()], arrivals: [...tables.arrivals.values()], whereabouts: [...tables.whereabouts.values()] }),
  };
}
