/**
 * The durable `ItemTransferRepository` (spec 23 R9, RG10). Gift offers and transfer lineage live in the lane's own tables
 * (`realm_raid_gifts`, `realm_raid_item_transfers` in `realm-migration.sql`) through the gate adapter's serializable
 * compare-and-set helpers. The things themselves stay in main's item authority, reached through `ItemRows` on the same
 * connection, so the offer, the ownership move and the lineage commit together or not at all. It keeps the exact rules
 * of `gift-memory.ts`, which the gift suite runs against:
 *
 * - Every `put` is a compare-and-set on `revision`; unique (giver, request) and at most one `offered` offer per thing.
 *   An insert that trips any unique index does nothing and answers `conflict` (`put` inserts with a bare
 *   `on conflict do nothing`, whose arbiters are every unique index, the partial open-offer index included). An update
 *   is checked first, because Postgres raises on it instead.
 * - Every row and every item is decoded by its strict reader. One that fails it, or belongs to the other origin, throws
 *   `RaidGateStorageError` and is never treated as missing: a live gate never reads a SIMULATED record.
 * - Listings read keys by their indexed columns, newest first, then decode each row and check it against the query.
 */
import type { KingdomId, PersonId } from '../../../../packages/shared/src/identity';
import {
  GIFT_LIST_LIMIT, readGiftItem, readGiftRecord, readTransferRecord,
  type GiftItem, type ItemTransferRecord, type ItemTransferRepository, type ItemTransferTransaction, type VisitorGiftRecord,
} from './gifts';
import { RaidGateStorageError, put, select, serializable, type SqlClient, type SqlPool, type TableSpec } from './postgres-repository';
import type { RecordOrigin, Stored } from './repository';

/**
 * Main's item rows, on the gift transaction's own client so every read and the move share its snapshot and its commit.
 * Values are checked here with `readGiftItem` and the adapter's origin; anything else throws.
 */
export interface ItemRows {
  get(client: SqlClient, itemId: string): Promise<GiftItem | null>;
  /**
   * One conditional update: the item moves from `from` to `to` only if it is still `from`'s at `expectedRevision`, and
   * is then stored at `expectedRevision + 1`. Otherwise `conflict` with what is stored now, and nothing changes.
   */
  move(client: SqlClient, itemId: string, from: PersonId, to: PersonId, expectedRevision: number): Promise<Stored<GiftItem>>;
  /** Things this person owns now, most recently received first. At most `limit` (1–50). */
  listOwned(client: SqlClient, ownerId: PersonId, limit: number): Promise<GiftItem[]>;
}

export type PostgresItemTransfersOptions = Readonly<{ pool: SqlPool; origin: RecordOrigin; items: ItemRows }>;

const GIFTS: TableSpec<VisitorGiftRecord> = {
  name: 'realm_raid_gifts', read: readGiftRecord,
  key: ['offer_id'], keyOf: record => [record.offerId],
  columns: ['giver_id', 'request_id', 'recipient_id', 'arrival_id', 'kingdom_id', 'item_id', 'state', 'offered_at', 'origin'],
  columnsOf: record => [record.giverId, record.requestId, record.recipientId, record.arrivalId, record.kingdomId, record.itemId, record.state, record.offeredAt, record.origin],
};
const TRANSFERS: TableSpec<ItemTransferRecord> = {
  name: 'realm_raid_item_transfers', read: readTransferRecord,
  key: ['transfer_id'], keyOf: record => [record.transferId],
  columns: ['item_id', 'origin'], columnsOf: record => [record.itemId, record.origin],
};

/** Newest first, ties in byte order of the ID: `gift-memory.ts`'s order. */
const NEWEST = `order by offered_at desc, offer_id collate "C"`;

function limited(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > GIFT_LIST_LIMIT) throw new RaidGateStorageError('A gift listing takes 1–50 records.');
}

export function createPostgresItemTransfers(options: PostgresItemTransfersOptions): ItemTransferRepository {
  const { pool, origin, items } = options;
  if (origin !== 'live' && origin !== 'simulated') throw new Error('The gift storage origin is live or simulated.');

  function ours<T extends { origin: RecordOrigin }>(record: T, table: string): T {
    if (record.origin !== origin) throw new RaidGateStorageError(`A ${table} record of the other origin reached a ${origin} gate; refusing to read it.`);
    return record;
  }
  const oursStored = <T extends { origin: RecordOrigin }>(result: Stored<T>, table: string): Stored<T> => result.kind === 'stored'
    ? result : { kind: 'conflict', current: result.current && ours(result.current, table) };

  /** An item from main's authority: it reads cleanly, is of this origin and is the one asked for (if one was), or it throws. */
  function item(value: unknown, itemId: string | null): GiftItem {
    const read = readGiftItem(value);
    if (!read || read.origin !== origin || (itemId !== null && read.itemId !== itemId)) {
      throw new RaidGateStorageError('An item from the item authority failed its reader; refusing to treat it as missing.');
    }
    return read;
  }

  function moved(result: unknown, itemId: string, to: PersonId, expected: number): Stored<GiftItem> {
    const shape = typeof result === 'object' && result !== null ? result as { kind?: unknown; record?: unknown; current?: unknown } : {};
    if (shape.kind === 'stored') {
      const record = item(shape.record, itemId);
      if (record.ownerId !== to || record.revision !== expected + 1) throw new RaidGateStorageError('The item authority stored a move other than the one asked for.');
      return { kind: 'stored', record };
    }
    if (shape.kind === 'conflict') return { kind: 'conflict', current: shape.current === null ? null : item(shape.current, itemId) };
    throw new RaidGateStorageError('The item authority answered a move with neither a stored item nor a conflict.');
  }

  function transactionOn(client: SqlClient): ItemTransferTransaction {
    const getOffer = async (offerId: string) => {
      const record = await select(client, GIFTS, [offerId]);
      return record && ours(record, GIFTS.name);
    };

    /** Offers whose keys `sql` lists (its last parameter is the limit), each decoded and checked to match the query. */
    async function offers(sql: string, params: readonly unknown[], limit: number, matches: (record: VisitorGiftRecord) => boolean): Promise<VisitorGiftRecord[]> {
      limited(limit);
      const found = await client.query(sql, [...params, limit]);
      if (found.rows.length > limit) throw new RaidGateStorageError('A gift listing returned more rows than it asked for.');
      const records: VisitorGiftRecord[] = [];
      for (const row of found.rows as { offer_id?: unknown }[]) {
        const record = typeof row.offer_id === 'string' ? await getOffer(row.offer_id) : null;
        if (!record || !matches(record)) throw new RaidGateStorageError(`A ${GIFTS.name} row disagrees with its own columns; refusing to skip it.`);
        records.push(record);
      }
      return records;
    }

    return {
      getItem: async itemId => {
        const found = await items.get(client, itemId);
        return found === null ? null : item(found, itemId);
      },
      async moveItem(itemId: string, from: PersonId, to: PersonId, expected: number) {
        if (!Number.isSafeInteger(expected) || expected < 1) throw new RaidGateStorageError('An item revision is a positive integer.');
        if (from === to) {
          const current = await items.get(client, itemId);
          return { kind: 'conflict', current: current === null ? null : item(current, itemId) };
        }
        return moved(await items.move(client, itemId, from, to, expected), itemId, to, expected);
      },
      async listOwned(ownerId: PersonId, limit: number) {
        limited(limit);
        const found: unknown = await items.listOwned(client, ownerId, limit);
        if (!Array.isArray(found) || found.length > limit) throw new RaidGateStorageError('The item authority answered a listing outside its limit.');
        const seen = new Set<string>();
        return found.map(value => {
          const read = item(value, null);
          if (read.ownerId !== ownerId || seen.has(read.itemId)) throw new RaidGateStorageError('The item authority listed a thing this person does not own.');
          seen.add(read.itemId);
          return read;
        });
      },
      getOffer,
      findOffer: async (giverId: PersonId, requestId: string) => (await offers(
        `select offer_id from ${GIFTS.name} where giver_id = $1 and request_id = $2 limit $3`, [giverId, requestId], 1,
        record => record.giverId === giverId && record.requestId === requestId))[0] ?? null,
      findOpenOffer: async (itemId: string) => (await offers(
        `select offer_id from ${GIFTS.name} where item_id = $1 and state = 'offered' limit $2`, [itemId], 1,
        record => record.itemId === itemId && record.state === 'offered'))[0] ?? null,
      listArrivalOffers: (arrivalId: string, limit: number) => offers(
        `select offer_id from ${GIFTS.name} where arrival_id = $1 ${NEWEST} limit $2`, [arrivalId], limit, record => record.arrivalId === arrivalId),
      // Two index scans, one per side; an offer never has the same person on both (a CHECK), so nothing appears twice.
      listPersonOffers: (personId: PersonId, kingdomId: KingdomId, limit: number) => offers(
        `select offer_id from (
          (select offer_id, offered_at from ${GIFTS.name} where kingdom_id = $1 and giver_id = $2 ${NEWEST} limit $3)
          union all
          (select offer_id, offered_at from ${GIFTS.name} where kingdom_id = $1 and recipient_id = $2 ${NEWEST} limit $3)
        ) sides ${NEWEST} limit $3`, [kingdomId, personId], limit,
        record => record.kingdomId === kingdomId && (record.giverId === personId || record.recipientId === personId)),
      async putOffer(record, expected) {
        if (!readGiftRecord(record) || record.origin !== origin) throw new RaidGateStorageError('Refusing to store a malformed or foreign gift offer.');
        if (expected > 0) {
          // The unique indexes would raise on an update rather than skip it; answer as the insert does.
          const clash = await client.query(
            `select 1 from ${GIFTS.name} where offer_id <> $1 and ((giver_id = $2 and request_id = $3) or ($5 and item_id = $4 and state = 'offered')) limit 1`,
            [record.offerId, record.giverId, record.requestId, record.itemId, record.state === 'offered']);
          if (clash.rows.length > 0) return { kind: 'conflict', current: await getOffer(record.offerId) };
        }
        return oursStored(await put(client, GIFTS, record, expected), GIFTS.name);
      },
      getTransfer: async transferId => {
        const record = await select(client, TRANSFERS, [transferId]);
        return record && ours(record, TRANSFERS.name);
      },
      async appendTransfer(record) {
        if (record.origin !== origin) throw new RaidGateStorageError('Refusing to append a transfer of the other origin.');
        return oursStored(await put(client, TRANSFERS, record, 0), TRANSFERS.name);
      },
    };
  }

  return { origin, transaction: (work, signal) => serializable(pool, transactionOn, work, signal) };
}
