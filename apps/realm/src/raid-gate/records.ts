/**
 * The durable records behind a journey between kingdoms (spec 23 R5, R6, R12) and the narrow transaction port that
 * stores them. Main binds a database adapter (`postgres-repository.ts` over the realm schema); tests and the labelled
 * bench use `memory-repository.ts`. Both keep the same rules:
 *
 * - Every `put` is a compare-and-set: `expectedRevision` 0 creates, otherwise the stored revision must equal it, and
 *   the new record is exactly one higher. A conflict returns what is stored now and changes nothing.
 * - A transaction is all-or-nothing and serializable.
 * - Every record passes its strict reader on the way in and on the way out.
 *
 * Three records:
 *
 * - `TravelRecord`, one per ticket: one person's one journey, from reservation to arrival or rollback.
 * - `ArrivalRecord`, immutable, one per committed ticket: private evidence that the destination acknowledged this
 *   person's arrival and in which role. Passports and gifts read it later; it never leaves the server.
 * - `WhereaboutsRecord`, one per person: the one authoritative walking location. `generation` is the membership
 *   fencing generation handed to the room transport; `active` is the one outstanding journey; `fence` is set while a
 *   commit is in flight or uncertain, and blocks every other movement until it is reconciled.
 */
import type { KingdomId, PersonId } from '../../../../packages/shared/src/identity';
import type { TravelReason, TravelState } from '../../../api/src/raid-gate/contracts';
import { bool, complete, epoch, fields, kingdom, oneOf, person, positive, token, uint } from '../../../api/src/raid-gate/guard';

export type RecordOrigin = 'live' | 'simulated';
export type TravelRole = 'monarch' | 'citizen' | 'visitor';
/**
 * The room hold this ticket still owes a release: the destination's reservation after a rollback, or the retained
 * source after the destination acknowledged the arrival. Releases are idempotent at the room transport and retried.
 */
export type TravelRelease = 'none' | 'destination' | 'source';

export type TravelRecord = Readonly<{
  ticket: string;
  revision: number;
  personId: PersonId;
  /** The session that reserved. Prepare and commit need it; a different session before commit is a disconnect. */
  sessionId: string;
  /** The viewer's idempotency key for this reservation. Unique per person. */
  requestId: string;
  from: KingdomId;
  to: KingdomId;
  reason: TravelReason;
  state: TravelState;
  /** The whereabouts generation this journey leaves from. Commit moves the person to `baseGeneration + 1`. */
  baseGeneration: number;
  /** The destination acknowledged the reservation. Until then the ticket is reserved here only. */
  held: boolean;
  /** Before commit, when the reservation lapses. */
  leaseUntil: number;
  role: TravelRole | null;
  arrivalId: string | null;
  release: TravelRelease;
  createdAt: number;
  updatedAt: number;
  /** When the commit was handed to the room transport. From then on it may have happened. */
  committingAt: number | null;
  /** When the ticket reached a final state. */
  settledAt: number | null;
  origin: RecordOrigin;
}>;

export type ArrivalRecord = Readonly<{
  arrivalId: string;
  revision: number;
  personId: PersonId;
  ticket: string;
  from: KingdomId;
  to: KingdomId;
  role: TravelRole;
  reason: TravelReason;
  /** The whereabouts generation this arrival established. */
  generation: number;
  /** The destination's own time for the acknowledged commit. */
  committedAt: number;
  origin: RecordOrigin;
}>;

export type WhereaboutsRecord = Readonly<{
  personId: PersonId;
  revision: number;
  kingdomId: KingdomId;
  generation: number;
  /** The arrival that put this person here, or null for where they always were. */
  arrivalId: string | null;
  active: string | null;
  fence: string | null;
  updatedAt: number;
}>;

export type Stored<T> = Readonly<{ kind: 'stored'; record: T }> | Readonly<{ kind: 'conflict'; current: T | null }>;

/** `open`: reserved, preparing, ready, committing or unknown. `release`: a room hold is still owed a release. */
export type TravelListing = 'open' | 'release';

export interface TravelTransaction {
  getTravel(ticket: string): Promise<TravelRecord | null>;
  /** The ticket this person reserved under this request ID, if any. */
  findTravel(personId: PersonId, requestId: string): Promise<TravelRecord | null>;
  putTravel(record: TravelRecord, expectedRevision: number): Promise<Stored<TravelRecord>>;
  getArrival(arrivalId: string): Promise<ArrivalRecord | null>;
  putArrival(record: ArrivalRecord, expectedRevision: number): Promise<Stored<ArrivalRecord>>;
  getWhereabouts(personId: PersonId): Promise<WhereaboutsRecord | null>;
  putWhereabouts(record: WhereaboutsRecord, expectedRevision: number): Promise<Stored<WhereaboutsRecord>>;
  /** Tickets in this listing, ordered by ticket, strictly after `after`. At most `limit` (1–100). */
  listTravel(listing: TravelListing, after: string | null, limit: number): Promise<TravelRecord[]>;
}

export interface TravelRepository {
  /** Serializable and atomic. Rejects with the signal's reason if aborted before commit. */
  transaction<T>(work: (tx: TravelTransaction) => Promise<T>, signal: AbortSignal): Promise<T>;
}

export const TRAVEL_LIST_LIMIT = 100;
export const OPEN_STATES: ReadonlySet<TravelState> = new Set(['reserved', 'preparing', 'ready', 'committing', 'unknown']);
export const PRE_COMMIT_STATES: ReadonlySet<TravelState> = new Set(['reserved', 'preparing', 'ready']);
const ROLLED_BACK: ReadonlySet<TravelState> = new Set(['cancelled', 'expired', 'denied']);
const TRAVEL_STATES = ['reserved', 'preparing', 'ready', 'committing', 'committed', 'cancelled', 'expired', 'denied', 'unknown'] as const;
const ROLES = ['monarch', 'citizen', 'visitor'] as const;

/** The arrival a committed ticket establishes. Derived, so a reconciled commit can never mint a second one. */
export const arrivalIdFor = (ticket: string): string => `arrival.${ticket}`;

export const inListing = (record: TravelRecord, listing: TravelListing): boolean =>
  listing === 'open' ? OPEN_STATES.has(record.state) : record.release !== 'none';

const nullable = <T>(value: unknown, read: (value: unknown) => T | undefined): T | null | undefined => value === null ? null : read(value);

export function readTravelReason(value: unknown): TravelReason | undefined {
  const kind = typeof value === 'object' && value !== null ? (value as { kind?: unknown }).kind : undefined;
  if (kind === 'visit') return fields(value, ['kind']) ? { kind } : undefined;
  if (kind === 'raid') {
    const f = fields(value, ['kind', 'requestId', 'raidId']);
    const reason = f && { kind: 'raid' as const, requestId: token(f.requestId), raidId: token(f.raidId) };
    return reason && complete(reason) ? reason : undefined;
  }
  if (kind === 'return') {
    const f = fields(value, ['kind', 'arrivalId']);
    const reason = f && { kind: 'return' as const, arrivalId: token(f.arrivalId) };
    return reason && complete(reason) ? reason : undefined;
  }
  return undefined;
}

export const sameReason = (a: TravelReason, b: TravelReason): boolean => JSON.stringify(a) === JSON.stringify(b);

export function readTravelRecord(value: unknown): TravelRecord | undefined {
  const f = fields(value, ['ticket', 'revision', 'personId', 'sessionId', 'requestId', 'from', 'to', 'reason', 'state', 'baseGeneration', 'held',
    'leaseUntil', 'role', 'arrivalId', 'release', 'createdAt', 'updatedAt', 'committingAt', 'settledAt', 'origin']);
  if (!f) return undefined;
  const role = nullable(f.role, value => oneOf(value, ROLES)), arrivalId = nullable(f.arrivalId, token);
  const committingAt = nullable(f.committingAt, epoch), settledAt = nullable(f.settledAt, epoch);
  const record = {
    ticket: token(f.ticket), revision: positive(f.revision), personId: person(f.personId), sessionId: token(f.sessionId), requestId: token(f.requestId),
    from: kingdom(f.from), to: kingdom(f.to), reason: readTravelReason(f.reason), state: oneOf(f.state, TRAVEL_STATES),
    baseGeneration: uint(f.baseGeneration), held: bool(f.held), leaseUntil: epoch(f.leaseUntil),
    release: oneOf(f.release, ['none', 'destination', 'source'] as const), createdAt: epoch(f.createdAt), updatedAt: epoch(f.updatedAt),
    origin: oneOf(f.origin, ['live', 'simulated'] as const),
  };
  if (!complete(record) || role === undefined || arrivalId === undefined || committingAt === undefined || settledAt === undefined) return undefined;
  if (record.from === record.to || record.updatedAt < record.createdAt) return undefined;
  const committed = record.state === 'committed';
  // Committed if and only if the destination acknowledged a role, and the arrival is this ticket's own.
  if (committed !== (role !== null) || committed !== (arrivalId !== null)) return undefined;
  if (arrivalId !== null && arrivalId !== arrivalIdFor(record.ticket)) return undefined;
  // From the commit hand-off on, it may have happened: the record says when.
  if ((record.state === 'committing' || record.state === 'unknown' || committed) && committingAt === null) return undefined;
  if (PRE_COMMIT_STATES.has(record.state) && committingAt !== null) return undefined;
  if (OPEN_STATES.has(record.state) === (settledAt !== null)) return undefined;
  // A reservation the destination never acknowledged cannot be prepared or committed.
  if (!record.held && record.state !== 'reserved' && !ROLLED_BACK.has(record.state)) return undefined;
  // The source is released only after the destination acknowledged; a rollback releases the destination.
  if (record.release === 'source' && !committed) return undefined;
  if (record.release === 'destination' && !ROLLED_BACK.has(record.state)) return undefined;
  if (record.reason.kind === 'return' && record.reason.arrivalId === arrivalIdFor(record.ticket)) return undefined;
  return { ...record, role, arrivalId, committingAt, settledAt };
}

export function readArrivalRecord(value: unknown): ArrivalRecord | undefined {
  const f = fields(value, ['arrivalId', 'revision', 'personId', 'ticket', 'from', 'to', 'role', 'reason', 'generation', 'committedAt', 'origin']);
  if (!f) return undefined;
  const record = {
    arrivalId: token(f.arrivalId), revision: positive(f.revision), personId: person(f.personId), ticket: token(f.ticket), from: kingdom(f.from),
    to: kingdom(f.to), role: oneOf(f.role, ROLES), reason: readTravelReason(f.reason), generation: positive(f.generation),
    committedAt: epoch(f.committedAt), origin: oneOf(f.origin, ['live', 'simulated'] as const),
  };
  if (!complete(record) || record.from === record.to || record.arrivalId !== arrivalIdFor(record.ticket)) return undefined;
  // Arrival evidence is written once and never changes.
  return record.revision === 1 ? record : undefined;
}

export function readWhereaboutsRecord(value: unknown): WhereaboutsRecord | undefined {
  const f = fields(value, ['personId', 'revision', 'kingdomId', 'generation', 'arrivalId', 'active', 'fence', 'updatedAt']);
  if (!f) return undefined;
  const arrivalId = nullable(f.arrivalId, token), active = nullable(f.active, token), fence = nullable(f.fence, token);
  const record = { personId: person(f.personId), revision: positive(f.revision), kingdomId: kingdom(f.kingdomId), generation: uint(f.generation), updatedAt: epoch(f.updatedAt) };
  if (!complete(record) || arrivalId === undefined || active === undefined || fence === undefined) return undefined;
  // A fenced commit is always the outstanding journey; a person who never arrived anywhere is at generation 0.
  if (fence !== null && fence !== active) return undefined;
  if ((record.generation === 0) !== (arrivalId === null)) return undefined;
  return { ...record, arrivalId, active, fence };
}
