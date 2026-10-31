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

/** Why an action closed before Twitch was ever asked. Later states record Twitch's own answer instead. */
export type ActionEndReason = 'superseded' | 'expired';

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
}>;

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
}

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
  const f = fields(value, ['requestId', 'revision', 'actorId', 'sessionId', 'from', 'to', 'target', 'state', 'previewTokenHash',
    'previewExpiresAt', 'optedIn', 'createdAt', 'updatedAt', 'observedAt', 'raid', 'endReason', 'origin']);
  if (!f) return undefined;
  const t = fields(f.target, ['kingdomId', 'founded', 'live', 'classification']);
  const target = t && { kingdomId: kingdom(t.kingdomId), founded: bool(t.founded), live: bool(t.live), classification: oneOf(t.classification, CLASSIFICATIONS) };
  const parsedRaid = f.raid === null ? null : AtlasRaidSchema.safeParse(f.raid);
  const raid = parsedRaid === null ? null : parsedRaid.success ? parsedRaid.data : undefined;
  const endReason = f.endReason === null ? null : oneOf(f.endReason, ['superseded', 'expired'] as const);
  const record = {
    requestId: token(f.requestId), revision: positive(f.revision), actorId: person(f.actorId), sessionId: token(f.sessionId),
    from: kingdom(f.from), to: kingdom(f.to), state: oneOf(f.state, ACTION_STATES),
    previewTokenHash: typeof f.previewTokenHash === 'string' && HASH.test(f.previewTokenHash) ? f.previewTokenHash : undefined,
    previewExpiresAt: positive(f.previewExpiresAt), optedIn: uint(f.optedIn), createdAt: epoch(f.createdAt), updatedAt: epoch(f.updatedAt),
    observedAt: epoch(f.observedAt), origin: oneOf(f.origin, ['live', 'simulated'] as const),
  };
  if (!target || !complete(target) || !complete(record) || raid === undefined || endReason === undefined) return undefined;
  if (record.from === record.to || target.kingdomId !== record.to || record.updatedAt < record.createdAt) return undefined;
  if ((record.state === 'landed') !== (raid !== null)) return undefined;
  if (endReason !== null && record.state !== 'cancelled') return undefined;
  return { ...record, target, raid, endReason };
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
