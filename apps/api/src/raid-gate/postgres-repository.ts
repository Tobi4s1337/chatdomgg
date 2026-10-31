/**
 * The durable `RaidGateRepository` over the shared realm schema (migration `realm-migration.sql`). It keeps the exact
 * rules of `memory-repository.ts`, which the application suite runs against:
 *
 * - One serializable transaction per `transaction` call. If `work` throws, or the signal aborts before commit,
 *   everything rolls back; an abort rejects with the signal's reason.
 * - Every `put` is a compare-and-set on the stored revision. Expected 0 inserts (and does nothing if the row exists);
 *   otherwise the update only matches the expected revision. A missed write, or a record whose revision is not exactly
 *   one higher, returns `conflict` with what is stored now, re-read inside the same transaction.
 * - A record is decoded by its strict reader on the way in and on the way out. A malformed write throws before any
 *   SQL runs; a stored row that fails its reader throws, and is never treated as missing.
 * - A serialization failure or deadlock reruns the whole transaction, up to three attempts in all.
 */
import type { KingdomId, PersonId } from '../../../../packages/shared/src/identity';
import type { GateActionState } from './contracts';
import {
  RAID_GATE_LIST_LIMIT, readActionRecord, readGatePointer, readMemberRecord, readOutboxRecord,
  type GatePointerRecord, type PartyMemberRecord, type RaidActionRecord, type RaidGateRepository, type RaidGateTransaction, type RaidOutboxRecord,
  type Stored,
} from './repository';

/** The part of `pg.PoolClient` this adapter uses. */
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  /** `true` destroys a connection whose state is unknown instead of returning it to the pool. */
  release(destroy?: boolean | Error): void;
}

/** The part of `pg.Pool` this adapter uses. */
export interface SqlPool {
  connect(): Promise<SqlClient>;
}

export type PostgresRaidGateRepositoryOptions = Readonly<{ pool: SqlPool }>;

/** Attempts in all, including the first, for a transaction Postgres asked us to retry. */
export const RAID_GATE_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE = new Set(['40001', '40P01']);

export class RaidGateStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'RaidGateStorageError'; }
}

const retryable = (error: unknown) => typeof error === 'object' && error !== null && RETRYABLE.has(String((error as { code?: unknown }).code));

/** One table's statements and the reader that every row passes through. */
type TableSpec<T> = Readonly<{
  name: string;
  read: (value: unknown) => T | undefined;
  /** Primary key columns and the matching values of a record. */
  key: readonly string[];
  keyOf: (record: T) => readonly string[];
  /** Duplicated, checked columns written beside the record. */
  columns: readonly string[];
  columnsOf: (record: T) => readonly unknown[];
}>;

const POINTERS: TableSpec<GatePointerRecord> = {
  name: 'realm_raid_gate_pointers', read: readGatePointer,
  key: ['kingdom_id'], keyOf: record => [record.kingdomId],
  columns: ['request_id'], columnsOf: record => [record.requestId],
};
const ACTIONS: TableSpec<RaidActionRecord> = {
  name: 'realm_raid_gate_actions', read: readActionRecord,
  key: ['request_id'], keyOf: record => [record.requestId],
  columns: ['from_kingdom_id', 'to_kingdom_id', 'state', 'origin'], columnsOf: record => [record.from, record.to, record.state, record.origin],
};
const MEMBERS: TableSpec<PartyMemberRecord> = {
  name: 'realm_raid_gate_members', read: readMemberRecord,
  key: ['request_id', 'person_id'], keyOf: record => [record.requestId, record.personId],
  columns: ['joined'], columnsOf: record => [record.joined],
};

const OUTBOX: TableSpec<RaidOutboxRecord> = {
  name: 'realm_raid_gate_outbox', read: readOutboxRecord,
  key: ['outbox_id'], keyOf: record => [record.id],
  columns: ['request_id', 'kind', 'state'], columnsOf: record => [record.requestId, record.kind, record.state],
};

function where(key: readonly string[]): string {
  return key.map((column, index) => `${column} = $${index + 1}`).join(' and ');
}

async function select<T extends { revision: number }>(client: SqlClient, spec: TableSpec<T>, key: readonly string[]): Promise<T | null> {
  const result = await client.query(`select revision::text as revision, record from ${spec.name} where ${where(spec.key)}`, [...key]);
  const row = result.rows[0] as { revision?: unknown; record?: unknown } | undefined;
  if (!row) return null;
  let parsed: unknown;
  try {
    parsed = typeof row.record === 'string' ? JSON.parse(row.record) : undefined;
  } catch {
    parsed = undefined;
  }
  const record = spec.read(parsed);
  // The row's own key and revision columns must agree with the record they carry.
  if (!record || String(record.revision) !== row.revision || spec.keyOf(record).some((value, index) => value !== key[index])) {
    throw new RaidGateStorageError(`A stored ${spec.name} row failed its reader; refusing to treat it as missing.`);
  }
  return record;
}

async function put<T extends { revision: number }>(client: SqlClient, spec: TableSpec<T>, record: T, expected: number): Promise<Stored<T>> {
  if (!Number.isSafeInteger(expected) || expected < 0) throw new RaidGateStorageError('An expected revision is a non-negative integer.');
  // What the database will hold, decoded exactly as a later read will decode it.
  const text = JSON.stringify(record);
  const copy = text === undefined ? undefined : spec.read(JSON.parse(text));
  if (!copy) throw new RaidGateStorageError('Refusing to store a malformed Raid Gate record.');
  const canonical = JSON.stringify(copy);
  const key = spec.keyOf(copy);
  if (copy.revision !== expected + 1) return { kind: 'conflict', current: await select(client, spec, key) };

  const values = [...key, ...spec.columnsOf(copy), copy.revision, canonical];
  let written: { rowCount: number | null };
  if (expected === 0) {
    const columns = [...spec.key, ...spec.columns, 'revision', 'record'];
    written = await client.query(
      `insert into ${spec.name} (${columns.join(', ')}) values (${columns.map((_, index) => `$${index + 1}`).join(', ')}) on conflict do nothing`, values);
  } else {
    const assigned = [...spec.columns, 'revision', 'record'].map((column, index) => `${column} = $${spec.key.length + index + 1}`);
    written = await client.query(
      `update ${spec.name} set ${assigned.join(', ')} where ${where(spec.key)} and revision = $${values.length + 1}`, [...values, expected]);
  }
  if (written.rowCount === 1) return { kind: 'stored', record: copy };
  return { kind: 'conflict', current: await select(client, spec, key) };
}

/** Rows of one state in key order after a cursor; every row passes its reader, as `select` does. */
async function listBy<T extends { revision: number }>(client: SqlClient, spec: TableSpec<T>, state: string, after: string | null, limit: number): Promise<T[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > RAID_GATE_LIST_LIMIT) throw new RaidGateStorageError('A Raid Gate listing takes 1–100 records.');
  const [key] = spec.key;
  const result = await client.query(
    `select ${key} as key, revision::text as revision, record from ${spec.name} where state = $1 and ($2::text is null or ${key} collate "C" > $2) order by ${key} collate "C" limit $3`,
    [state, after, limit]);
  return result.rows.map(raw => {
    const row = raw as { key?: unknown; revision?: unknown; record?: unknown };
    let parsed: unknown;
    try { parsed = typeof row.record === 'string' ? JSON.parse(row.record) : undefined; } catch { parsed = undefined; }
    const record = spec.read(parsed);
    if (!record || String(record.revision) !== row.revision || spec.keyOf(record)[0] !== row.key) {
      throw new RaidGateStorageError(`A stored ${spec.name} row failed its reader; refusing to skip it.`);
    }
    return record;
  });
}

function transactionOn(client: SqlClient): RaidGateTransaction {
  return {
    getGate: (kingdomId: KingdomId) => select(client, POINTERS, [kingdomId]),
    putGate: (record, expected) => put(client, POINTERS, record, expected),
    getAction: (requestId: string) => select(client, ACTIONS, [requestId]),
    putAction: (record, expected) => put(client, ACTIONS, record, expected),
    getMember: (requestId: string, personId: PersonId) => select(client, MEMBERS, [requestId, personId]),
    putMember: (record, expected) => put(client, MEMBERS, record, expected),
    getOutbox: (id: string) => select(client, OUTBOX, [id]),
    putOutbox: (record, expected) => put(client, OUTBOX, record, expected),
    listOutbox: (state: 'queued' | 'claimed', after: string | null, limit: number) => listBy(client, OUTBOX, state, after, limit),
    listActions: (state: GateActionState, after: string | null, limit: number) => listBy(client, ACTIONS, state, after, limit),
  };
}

export function createPostgresRaidGateRepository(options: PostgresRaidGateRepositoryOptions): RaidGateRepository {
  const { pool } = options;

  async function attempt<T>(work: (tx: RaidGateTransaction) => Promise<T>, signal: AbortSignal): Promise<T> {
    const client = await pool.connect();
    // A connection whose rollback failed is in an unknown state: destroy it rather than hand it to the next caller.
    let broken = false;
    try {
      await client.query('begin isolation level serializable');
      const result = await work(transactionOn(client));
      signal.throwIfAborted();
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => { broken = true; });
      throw error;
    } finally {
      client.release(broken || undefined);
    }
  }

  return {
    async transaction<T>(work: (tx: RaidGateTransaction) => Promise<T>, signal: AbortSignal): Promise<T> {
      for (let tries = 1; ; tries++) {
        signal.throwIfAborted();
        try {
          return await attempt(work, signal);
        } catch (error) {
          if (signal.aborted || !retryable(error)) throw error;
          if (tries >= RAID_GATE_TRANSACTION_ATTEMPTS) {
            throw new RaidGateStorageError(`The Raid Gate transaction kept conflicting with concurrent writers (${RAID_GATE_TRANSACTION_ATTEMPTS} attempts).`, { cause: error });
          }
        }
      }
    },
  };
}
