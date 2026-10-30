import pg from 'pg';

/** Finite ceilings for every database wait. A slow store holds actions; it never queues them without end. */
export const REALM_DATABASE_LIMITS = {
  /** Pool connections per process. One writer transaction per kingdom plus renewals and reads. */
  poolSize: 8,
  connectMs: 3_000,
  statementMs: 5_000,
  /** Server-side query ceiling sent with each statement. */
  queryMs: 6_000,
  /** A stalled holder of the kingdom row lock is cut off so the lease can move on. */
  idleInTransactionMs: 10_000,
} as const;

export interface RealmDatabaseConfig {
  readonly connectionString: string;
  /** Isolated namespace: production uses `realm`, tests use a random throwaway schema. */
  readonly schema: string;
}

const SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;

/** Reads configuration without echoing it. Absence is an explicit failure, never an in-memory fallback. */
export function realmDatabaseConfig(env: Readonly<Record<string, string | undefined>> = process.env): RealmDatabaseConfig {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new RealmStorageUnavailableError('DATABASE_URL is not configured; the realm has no durable store and will not start without one.');
  const schema = env.REALM_DATABASE_SCHEMA ?? 'realm';
  if (!SCHEMA.test(schema)) throw new RealmStorageUnavailableError('REALM_DATABASE_SCHEMA must be a lowercase SQL identifier.');
  return { connectionString, schema };
}

export function createRealmPool(config: RealmDatabaseConfig, limits: Partial<typeof REALM_DATABASE_LIMITS> = {}): pg.Pool {
  if (!SCHEMA.test(config.schema)) throw new RealmStorageUnavailableError('Invalid realm schema name.');
  const l = { ...REALM_DATABASE_LIMITS, ...limits };
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: l.poolSize,
    connectionTimeoutMillis: l.connectMs,
    query_timeout: l.queryMs,
    statement_timeout: l.statementMs,
    idle_in_transaction_session_timeout: l.idleInTransactionMs,
    options: `-c search_path=${config.schema}`,
    application_name: 'chatdom-realm',
  });
  // An idle client error must not crash the process; the next checkout reports the failure.
  pool.on('error', () => {});
  return pool;
}

/** Minimal surface the repository needs; tests wrap it to interrupt a reply. */
export type RealmDatabase = Pick<pg.Pool, 'connect' | 'query'>;

export class RealmStorageUnavailableError extends Error {
  readonly code = 'realm.storage-unavailable';
  constructor(message: string) { super(message); this.name = 'RealmStorageUnavailableError'; }
}
/** Another unexpired writer holds this kingdom. */
export class RealmLeaseHeldError extends Error {
  readonly code = 'realm.lease-held';
  constructor(readonly kingdomId: string) { super(`Kingdom ${kingdomId} already has an active writer.`); this.name = 'RealmLeaseHeldError'; }
}
/** This process's epoch is no longer the current unexpired writer. Nothing was written. */
export class RealmWriterFencedError extends Error {
  readonly code = 'realm.writer-fenced';
  constructor(readonly kingdomId: string) { super(`The writer lease for kingdom ${kingdomId} is no longer held by this process.`); this.name = 'RealmWriterFencedError'; }
}
/** COMMIT was sent but its reply was lost. Resolve with `lookup` before any retry or cleanup. */
export class RealmCommitUncertainError extends Error {
  readonly code = 'realm.commit-uncertain';
  constructor(readonly kingdomId: string, readonly commandId: string) { super(`The commit of ${commandId} in kingdom ${kingdomId} could not be confirmed; look it up before retrying.`); this.name = 'RealmCommitUncertainError'; }
}
/** Stored history cannot be replayed exactly. The kingdom stays closed; it is never replaced by an empty one. */
export class RealmRecoveryError extends Error {
  readonly code = 'realm.recovery-failed';
  constructor(readonly kingdomId: string, detail: string) { super(`Kingdom ${kingdomId} cannot be recovered: ${detail}`); this.name = 'RealmRecoveryError'; }
}

const KNOWN = [RealmStorageUnavailableError, RealmLeaseHeldError, RealmWriterFencedError, RealmCommitUncertainError, RealmRecoveryError];

/**
 * A log-safe description. Driver errors can quote hosts, users or statements; only our own typed messages and
 * the Postgres SQLSTATE class are reported. The connection string never reaches output.
 */
export function describeStorageFailure(error: unknown): string {
  if (KNOWN.some(type => error instanceof type)) return (error as Error).message;
  const code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null;
  if (code === '28P01' || code === '28000') return 'The realm database refused the configured credentials.';
  if (code === '3D000') return 'The configured realm database does not exist.';
  if (code === '57014') return 'A realm database statement exceeded its time limit.';
  if (code) return `The realm database reported SQLSTATE ${code}.`;
  if (error instanceof Error && /timeout/i.test(error.message)) return 'The realm database did not answer in time.';
  if (typeof error === 'object' && error && 'code' in error && ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EHOSTUNREACH'].includes(String(error.code))) return 'The realm database is unreachable.';
  return 'The realm database is unavailable.';
}
