/**
 * A transactional in-memory item authority for tests and the labelled bench (`ItemTransferRepository`). It keeps the
 * compare-and-set, all-or-nothing and strict-reader rules main's item storage must keep, and can fail a transaction on
 * purpose: before its commit (nothing is kept) or after it (everything is kept, the answer is lost). Never bound as
 * production storage, and it holds only the things it was given: it is not a second inventory.
 */
import type { KingdomId, PersonId } from '../../../../packages/shared/src/identity';
import {
  GIFT_LIST_LIMIT, readGiftItem, readGiftRecord, readTransferRecord,
  type GiftItem, type ItemTransferRecord, type ItemTransferRepository, type ItemTransferTransaction, type VisitorGiftRecord,
} from './gifts';
import type { RecordOrigin, Stored } from './repository';

type Table<T> = Map<string, T>;
interface Tables { items: Table<GiftItem>; offers: Table<VisitorGiftRecord>; transfers: Table<ItemTransferRecord> }
const empty = (): Tables => ({ items: new Map(), offers: new Map(), transfers: new Map() });

export interface MemoryItemTransfers extends ItemTransferRepository {
  /** Places things in the store as their authority would have. Each must read cleanly and be new. */
  seed(items: readonly GiftItem[]): void;
  /** Committed state only, for assertions. */
  snapshot(): Readonly<{ items: GiftItem[]; offers: VisitorGiftRecord[]; transfers: ItemTransferRecord[] }>;
  /** The next transaction that writes fails before committing: none of its writes are kept. */
  failNextCommit(): void;
  /** The next transaction that writes commits, and then its answer is lost. */
  loseNextAnswer(): void;
}

const stage = <T>(committed: Table<T>, staged: Table<T>, key: string): T | null => staged.get(key) ?? committed.get(key) ?? null;

function put<T extends { revision: number }>(committed: Table<T>, staged: Table<T>, key: string, record: T, expected: number, read: (value: unknown) => T | undefined): Stored<T> {
  const current = stage(committed, staged, key);
  if ((current?.revision ?? 0) !== expected || record.revision !== expected + 1) return { kind: 'conflict', current };
  const copy = read(structuredClone(record));
  if (!copy) throw new Error('Refusing to store a malformed gift record.');
  staged.set(key, copy);
  return { kind: 'stored', record: copy };
}

function limited(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > GIFT_LIST_LIMIT) throw new Error('A gift listing takes 1–50 records.');
}

const newestFirst = (a: VisitorGiftRecord, b: VisitorGiftRecord) => b.offeredAt - a.offeredAt || (a.offerId < b.offerId ? -1 : 1);

export function createMemoryItemTransfers(origin: RecordOrigin): MemoryItemTransfers {
  const tables = empty();
  /** When each item last changed hands here, so `listOwned` can put the newest first. */
  const received = new Map<string, number>();
  let queue: Promise<unknown> = Promise.resolve();
  let failNext = false, loseNext = false, sequence = 0;

  async function run<T>(work: (tx: ItemTransferTransaction) => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    const staged = empty();
    const offers = () => [...new Map([...tables.offers, ...staged.offers]).values()];
    const tx: ItemTransferTransaction = {
      getItem: async itemId => stage(tables.items, staged.items, itemId),
      async moveItem(itemId: string, from: PersonId, to: PersonId, expected: number): Promise<Stored<GiftItem>> {
        const current = stage(tables.items, staged.items, itemId);
        if (!current || current.ownerId !== from || current.revision !== expected || from === to) return { kind: 'conflict', current };
        return put(tables.items, staged.items, itemId, { ...current, ownerId: to, revision: expected + 1 }, expected, readGiftItem);
      },
      async listOwned(ownerId: PersonId, limit: number) {
        limited(limit);
        return [...new Map([...tables.items, ...staged.items]).values()].filter(item => item.ownerId === ownerId)
          .sort((a, b) => (received.get(b.itemId) ?? 0) - (received.get(a.itemId) ?? 0) || (a.itemId < b.itemId ? -1 : 1))
          .slice(0, limit).map(item => structuredClone(item));
      },
      getOffer: async offerId => stage(tables.offers, staged.offers, offerId),
      findOffer: async (giverId, requestId) => offers().find(each => each.giverId === giverId && each.requestId === requestId) ?? null,
      findOpenOffer: async itemId => offers().find(each => each.itemId === itemId && each.state === 'offered') ?? null,
      async listArrivalOffers(arrivalId: string, limit: number) {
        limited(limit);
        return offers().filter(each => each.arrivalId === arrivalId).sort(newestFirst).slice(0, limit).map(each => structuredClone(each));
      },
      async listPersonOffers(personId: PersonId, kingdomId: KingdomId, limit: number) {
        limited(limit);
        return offers().filter(each => each.kingdomId === kingdomId && (each.giverId === personId || each.recipientId === personId))
          .sort(newestFirst).slice(0, limit).map(each => structuredClone(each));
      },
      async putOffer(record, expected) {
        const all = offers();
        // Unique on (giver, request) and one open offer per item, as the database's indexes are.
        if (all.some(each => each.offerId !== record.offerId && each.giverId === record.giverId && each.requestId === record.requestId)) {
          return { kind: 'conflict', current: stage(tables.offers, staged.offers, record.offerId) };
        }
        if (record.state === 'offered' && all.some(each => each.offerId !== record.offerId && each.itemId === record.itemId && each.state === 'offered')) {
          return { kind: 'conflict', current: stage(tables.offers, staged.offers, record.offerId) };
        }
        return put(tables.offers, staged.offers, record.offerId, record, expected, readGiftRecord);
      },
      getTransfer: async transferId => stage(tables.transfers, staged.transfers, transferId),
      appendTransfer: async record => put(tables.transfers, staged.transfers, record.transferId, record, 0, readTransferRecord),
    };
    const result = await work(tx);
    signal.throwIfAborted();
    const writes = staged.items.size + staged.offers.size + staged.transfers.size;
    if (writes > 0 && failNext) { failNext = false; throw new Error('SIMULATED: the item store failed before committing'); }
    for (const [key, value] of staged.items) { tables.items.set(key, value); received.set(key, ++sequence); }
    for (const [key, value] of staged.offers) tables.offers.set(key, value);
    for (const [key, value] of staged.transfers) tables.transfers.set(key, value);
    if (writes > 0 && loseNext) { loseNext = false; throw new Error('SIMULATED: the item store committed, and its answer was lost'); }
    return result;
  }

  return {
    origin,
    transaction<T>(work: (tx: ItemTransferTransaction) => Promise<T>, signal: AbortSignal): Promise<T> {
      const next = queue.then(() => run(work, signal));
      queue = next.catch(() => undefined);
      return next;
    },
    seed(items) {
      for (const item of items) {
        const copy = readGiftItem(structuredClone(item));
        if (!copy || tables.items.has(copy.itemId) || copy.origin !== origin) throw new Error(`Refusing to seed item ${item.itemId}.`);
        tables.items.set(copy.itemId, copy);
        received.set(copy.itemId, ++sequence);
      }
    },
    snapshot: () => structuredClone({ items: [...tables.items.values()], offers: [...tables.offers.values()], transfers: [...tables.transfers.values()] }),
    failNextCommit() { failNext = true; },
    loseNextAnswer() { loseNext = true; },
  };
}
