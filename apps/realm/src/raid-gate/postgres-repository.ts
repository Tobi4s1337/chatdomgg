/**
 * The durable `TravelRepository` over the realm schema (the travel tables in
 * `apps/api/src/raid-gate/realm-migration.sql`). It keeps the exact rules of `memory-repository.ts`, which the
 * coordinator suite runs against, through the gate adapter's own serializable compare-and-set helpers: one
 * serializable transaction per call, every `put` a compare-and-set on `revision`, every row decoded by its strict
 * reader in both directions, and a serialization failure retried as a whole.
 */
import type { PersonId } from '../../../../packages/shared/src/identity';
import { listWhere, put, select, serializable, type SqlClient, type SqlPool, type TableSpec } from '../../../api/src/raid-gate/postgres-repository';
import {
  readArrivalRecord, readTravelRecord, readWhereaboutsRecord,
  type ArrivalRecord, type TravelRecord, type TravelRepository, type TravelTransaction, type WhereaboutsRecord,
} from './records';

const TRAVEL: TableSpec<TravelRecord> = {
  name: 'realm_raid_travel', read: readTravelRecord,
  key: ['ticket'], keyOf: record => [record.ticket],
  columns: ['person_id', 'request_id', 'state', 'release'], columnsOf: record => [record.personId, record.requestId, record.state, record.release],
};
const ARRIVALS: TableSpec<ArrivalRecord> = {
  name: 'realm_raid_arrivals', read: readArrivalRecord,
  key: ['arrival_id'], keyOf: record => [record.arrivalId],
  columns: ['ticket', 'person_id'], columnsOf: record => [record.ticket, record.personId],
};
const WHEREABOUTS: TableSpec<WhereaboutsRecord> = {
  name: 'realm_raid_whereabouts', read: readWhereaboutsRecord,
  key: ['person_id'], keyOf: record => [record.personId],
  columns: ['kingdom_id', 'generation'], columnsOf: record => [record.kingdomId, record.generation],
};

const OPEN = `state in ('reserved', 'preparing', 'ready', 'committing', 'unknown')`;

function transactionOn(client: SqlClient): TravelTransaction {
  return {
    getTravel: ticket => select(client, TRAVEL, [ticket]),
    async findTravel(personId: PersonId, requestId: string) {
      const found = await client.query(`select ticket from ${TRAVEL.name} where person_id = $1 and request_id = $2`, [personId, requestId]);
      const ticket = (found.rows[0] as { ticket?: unknown } | undefined)?.ticket;
      return typeof ticket === 'string' ? select(client, TRAVEL, [ticket]) : null;
    },
    putTravel: (record, expected) => put(client, TRAVEL, record, expected),
    getArrival: arrivalId => select(client, ARRIVALS, [arrivalId]),
    putArrival: (record, expected) => put(client, ARRIVALS, record, expected),
    getWhereabouts: personId => select(client, WHEREABOUTS, [personId]),
    putWhereabouts: (record, expected) => put(client, WHEREABOUTS, record, expected),
    listTravel: (listing, after, limit) => listWhere(client, TRAVEL, listing === 'open' ? OPEN : `release <> 'none'`, [], after, limit),
  };
}

export function createPostgresTravelRepository(options: Readonly<{ pool: SqlPool }>): TravelRepository {
  return { transaction: (work, signal) => serializable(options.pool, transactionOn, work, signal) };
}
