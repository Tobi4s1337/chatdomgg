/**
 * Durable records and the narrow transaction port behind the Raid Gate application (spec 23, "Repository ports").
 * Main binds a database adapter to `RaidGateRepository`; this module defines what it stores and how a write is
 * accepted. Records never hold OAuth credentials, chat text or a raw preview token, only its SHA-256 hash.
 *
 * Every `put` is a compare-and-set: `expectedRevision` 0 creates, otherwise the stored revision must equal it, and
 * the new record's revision must be exactly one higher. A conflict returns what is stored now and changes nothing.
 * A transaction is all-or-nothing: if its function throws, none of its writes are kept.
 */
import { AtlasRaidSchema, type AtlasRaid } from '../../../../packages/shared/src/atlas-raids';
import type { KingdomId, PersonId } from '../../../../packages/shared/src/identity';
import type { GateActionState, GateTarget } from './contracts';
import { bool, complete, epoch, fields, kingdom, oneOf, person, positive, token, uint } from './guard';

/** Controlled transports and benches write `simulated`; their views carry SIMULATED wherever a person sees them. */
export type RecordOrigin = 'live' | 'simulated';

/** One open gate per source kingdom. Moving this pointer is what supersedes an older, unstarted preview. */
export type GatePointerRecord = Readonly<{ kingdomId: KingdomId; revision: number; requestId: string | null; updatedAt: number }>;

/**
 * Why an action ended as `cancelled`: a newer preview replaced it, its window ran out (before or, on recovery, just
 * after the press, but always before anything reached Twitch), the monarch closed the gate before starting, or
 * Twitch confirmed the monarch's cancel of a pending raid (`withdrawn`).
 */
export type ActionEndReason = 'superseded' | 'expired' | 'closed' | 'withdrawn';

export type RaidActionRecord = Readonly<{
  requestId: string;
  revision: number;
  /** The verified source broadcaster who asked for the preview, and the session that holds it. */
  actorId: PersonId;
  sessionId: string;
  from: KingdomId;
  to: KingdomId;
  /** The destination policy's verdict when the preview was last issued. Start re-reads it. */
  target: GateTarget;
  state: GateActionState;
  previewTokenHash: string;
  previewExpiresAt: number;
  /** Walkers who chose to march, kept in the same transaction as their membership records. */
  optedIn: number;
  createdAt: number;
  updatedAt: number;
  /** When the authority last established this state. */
  observedAt: number;
  raid: AtlasRaid | null;
  endReason: ActionEndReason | null;
  origin: RecordOrigin;
  /** When the monarch's start was accepted here and queued for Twitch. Null while still a preview. */
  dispatchedAt: number | null;
  /** Twitch's own time for the accepted request; its countdown runs from here. Pending and later only. */
  acceptedAt: number | null;
  /** Twitch's refusal code for a rejected start. Kept for the monarch and the log, never shown to walkers. */
  rejection: string | null;
  /** The upstream event identity of the `channel.raid` observation that landed this request. */
  raidEventId: string | null;
}>;

/** The three external effects the gate asks for. Each has one durable record whose ID is also its idempotency key. */
export type OutboxKind = 'start' | 'cancel' | 'road';

/**
 * One external effect, written in the same transaction as the decision that wants it.
 *
 * - `queued`: decided, provably not sent. Recovery may send it.
 * - `claimed`: about to be sent, or sent with no answer yet. A Twitch write here may have happened, so recovery only
 *   asks the transport what became of it (`reconcile`), never sends it again. A road handoff is idempotent at the
 *   Atlas and may be retried.
 * - `settled`: the answer is known (`accepted`, `rejected`, `delivered`), it was abandoned before sending (`lapsed`),
 *   or reconciliation gave up (`unknown`) and only a verified observation can still settle the action.
 */
export type RaidOutboxRecord = Readonly<{
  id: string;
  revision: number;
  requestId: string;
  kind: OutboxKind;
  state: 'queued' | 'claimed' | 'settled';
  createdAt: number;
  claimedAt: number | null;
  settledAt: number | null;
  outcome: 'accepted' | 'rejected' | 'unknown' | 'delivered' | 'lapsed' | null;
  /** How many times this effect was handed to its transport. A Twitch write is handed over at most once. */
  attempts: number;
  origin: RecordOrigin;
}>;

/** The outbox ID of a request's one effect of each kind. */
export const outboxId = (requestId: string, kind: OutboxKind): string => `${requestId}/${kind}`;

/** One person's choice for one request. Unique on (requestId, personId). */
export type PartyMemberRecord = Readonly<{
  requestId: string;
  personId: PersonId;
  kingdomId: KingdomId;
  sessionId: string;
  joined: boolean;
  revision: number;
  joinedAt: number | null;
  updatedAt: number;
}>;

export type Stored<T> = Readonly<{ kind: 'stored'; record: T }> | Readonly<{ kind: 'conflict'; current: T | null }>;

export interface RaidGateTransaction {
  getGate(kingdomId: KingdomId): Promise<GatePointerRecord | null>;
  putGate(record: GatePointerRecord, expectedRevision: number): Promise<Stored<GatePointerRecord>>;
  getAction(requestId: string): Promise<RaidActionRecord | null>;
  putAction(record: RaidActionRecord, expectedRevision: number): Promise<Stored<RaidActionRecord>>;
  getMember(requestId: string, personId: PersonId): Promise<PartyMemberRecord | null>;
  putMember(record: PartyMemberRecord, expectedRevision: number): Promise<Stored<PartyMemberRecord>>;
  getOutbox(id: string): Promise<RaidOutboxRecord | null>;
  putOutbox(record: RaidOutboxRecord, expectedRevision: number): Promise<Stored<RaidOutboxRecord>>;
  /** Unsettled outbox records in this state, ordered by ID, strictly after `after`. At most `limit` (1–100). */
  listOutbox(state: 'queued' | 'claimed', after: string | null, limit: number): Promise<RaidOutboxRecord[]>;
  /** Actions in this state, ordered by request ID, strictly after `after`. At most `limit` (1–100). */
  listActions(state: GateActionState, after: string | null, limit: number): Promise<RaidActionRecord[]>;
}

/** The largest page a recovery listing returns. */
export const RAID_GATE_LIST_LIMIT = 100;

export interface RaidGateRepository {
  /** Serializable and atomic. Rejects with the signal's reason if aborted before commit. */
  transaction<T>(work: (tx: RaidGateTransaction) => Promise<T>, signal: AbortSignal): Promise<T>;
}

const HASH = /^[a-f0-9]{64}$/;
const ACTION_STATES = ['prepared', 'dispatching', 'pending', 'landed', 'cancelled', 'rejected', 'unknown'] as const;
const CLASSIFICATIONS = ['unknown', 'general', 'mature', 'excluded'] as const;

export function readGatePointer(value: unknown): GatePointerRecord | undefined {
  const f = fields(value, ['kingdomId', 'revision', 'requestId', 'updatedAt']);
  if (!f) return undefined;
  const requestId = f.requestId === null ? null : token(f.requestId);
  const record = { kingdomId: kingdom(f.kingdomId), revision: positive(f.revision), updatedAt: epoch(f.updatedAt) };
  return complete(record) && requestId !== undefined ? { ...record, requestId } : undefined;
}

export function readActionRecord(value: unknown): RaidActionRecord | undefined {
  // The start fields arrived with RG08; a record written before them reads them as null.
  const f = fields(value, ['requestId', 'revision', 'actorId', 'sessionId', 'from', 'to', 'target', 'state', 'previewTokenHash',
    'previewExpiresAt', 'optedIn', 'createdAt', 'updatedAt', 'observedAt', 'raid', 'endReason', 'origin'], START_FIELDS);
  if (!f) return undefined;
  const t = fields(f.target, ['kingdomId', 'founded', 'live', 'classification']);
  const target = t && { kingdomId: kingdom(t.kingdomId), founded: bool(t.founded), live: bool(t.live), classification: oneOf(t.classification, CLASSIFICATIONS) };
  const parsedRaid = f.raid === null ? null : AtlasRaidSchema.safeParse(f.raid);
  const raid = parsedRaid === null ? null : parsedRaid.success ? parsedRaid.data : undefined;
  const endReason = f.endReason === null ? null : oneOf(f.endReason, ['superseded', 'expired', 'closed', 'withdrawn'] as const);
  const dispatchedAt = optional(f.dispatchedAt, epoch), acceptedAt = optional(f.acceptedAt, epoch);
  const rejection = optional(f.rejection, token), raidEventId = optional(f.raidEventId, token);
  const record = {
    requestId: token(f.requestId), revision: positive(f.revision), actorId: person(f.actorId), sessionId: token(f.sessionId),
    from: kingdom(f.from), to: kingdom(f.to), state: oneOf(f.state, ACTION_STATES),
    previewTokenHash: typeof f.previewTokenHash === 'string' && HASH.test(f.previewTokenHash) ? f.previewTokenHash : undefined,
    previewExpiresAt: positive(f.previewExpiresAt), optedIn: uint(f.optedIn), createdAt: epoch(f.createdAt), updatedAt: epoch(f.updatedAt),
    observedAt: epoch(f.observedAt), origin: oneOf(f.origin, ['live', 'simulated'] as const),
  };
  if (!target || !complete(target) || !complete(record) || raid === undefined || endReason === undefined) return undefined;
  if (dispatchedAt === undefined || acceptedAt === undefined || rejection === undefined || raidEventId === undefined) return undefined;
  if (record.from === record.to || target.kingdomId !== record.to || record.updatedAt < record.createdAt) return undefined;
  if ((record.state === 'landed') !== (raid !== null) || (record.state === 'landed') !== (raidEventId !== null)) return undefined;
  if (raid && (raid.fromKingdomId !== record.from || raid.toKingdomId !== record.to)) return undefined;
  if (endReason !== null && record.state !== 'cancelled') return undefined;
  // Twitch states and a withdrawn raid were started; a preview, a superseded or closed gate never was. A start that
  // recovery abandoned before sending ends `expired` and keeps its press time.
  const mustStart = STARTED.has(record.state) || endReason === 'withdrawn';
  if (mustStart ? dispatchedAt === null : dispatchedAt !== null && endReason !== 'expired') return undefined;
  if (record.state === 'pending' && acceptedAt === null) return undefined;
  if ((record.state === 'rejected') !== (rejection !== null)) return undefined;
  return { ...record, target, raid, endReason, dispatchedAt, acceptedAt, rejection, raidEventId };
}

const START_FIELDS = ['dispatchedAt', 'acceptedAt', 'rejection', 'raidEventId'] as const;
const STARTED: ReadonlySet<GateActionState> = new Set(['dispatching', 'pending', 'unknown', 'landed', 'rejected']);
/** A field added after a record was first written: absent reads as null, present must read cleanly. */
function optional<T>(value: unknown, read: (value: unknown) => T | undefined): T | null | undefined {
  return value === undefined || value === null ? null : read(value);
}

const OUTBOX_KINDS = ['start', 'cancel', 'road'] as const;
const OUTBOX_STATES = ['queued', 'claimed', 'settled'] as const;
const OUTBOX_OUTCOMES = ['accepted', 'rejected', 'unknown', 'delivered', 'lapsed'] as const;

export function readOutboxRecord(value: unknown): RaidOutboxRecord | undefined {
  const f = fields(value, ['id', 'revision', 'requestId', 'kind', 'state', 'createdAt', 'claimedAt', 'settledAt', 'outcome', 'attempts', 'origin']);
  if (!f) return undefined;
  const claimedAt = optional(f.claimedAt, epoch), settledAt = optional(f.settledAt, epoch), outcome = optional(f.outcome, value => oneOf(value, OUTBOX_OUTCOMES));
  const record = {
    id: typeof f.id === 'string' ? f.id : undefined, revision: positive(f.revision), requestId: token(f.requestId), kind: oneOf(f.kind, OUTBOX_KINDS),
    state: oneOf(f.state, OUTBOX_STATES), createdAt: epoch(f.createdAt), attempts: uint(f.attempts), origin: oneOf(f.origin, ['live', 'simulated'] as const),
  };
  if (!complete(record) || claimedAt === undefined || settledAt === undefined || outcome === undefined) return undefined;
  if (record.id !== outboxId(record.requestId, record.kind)) return undefined;
  if ((record.state === 'settled') !== (settledAt !== null) || (record.state === 'settled') !== (outcome !== null)) return undefined;
  if (record.state === 'queued' ? claimedAt !== null || record.attempts !== 0 : record.state === 'claimed' && (claimedAt === null || record.attempts === 0)) return undefined;
  // A Twitch write is handed to its transport at most once; only the idempotent road handoff may repeat.
  if (record.kind !== 'road' && record.attempts > 1) return undefined;
  if (outcome === 'lapsed' ? record.attempts !== 0 : outcome !== null && record.attempts === 0) return undefined;
  if (outcome === 'delivered' ? record.kind !== 'road' : record.kind === 'road' && outcome !== null) return undefined;
  return { ...record, claimedAt, settledAt, outcome };
}

export function readMemberRecord(value: unknown): PartyMemberRecord | undefined {
  const f = fields(value, ['requestId', 'personId', 'kingdomId', 'sessionId', 'joined', 'revision', 'joinedAt', 'updatedAt']);
  if (!f) return undefined;
  const joinedAt = f.joinedAt === null ? null : epoch(f.joinedAt);
  const record = {
    requestId: token(f.requestId), personId: person(f.personId), kingdomId: kingdom(f.kingdomId), sessionId: token(f.sessionId),
    joined: bool(f.joined), revision: positive(f.revision), updatedAt: epoch(f.updatedAt),
  };
  if (!complete(record) || joinedAt === undefined || record.joined !== (joinedAt !== null)) return undefined;
  return { ...record, joinedAt };
}
