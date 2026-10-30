import type { KingdomId, PersonId } from '../identity';
import type { VoxelBlueprint } from '../voxel';
import type { CommittedForgeAttachment, ForgeAttachment, ForgeAttempt, ForgeReservation } from './forge-authority';
import type { RealmPublicMessage } from './messages';
import type { PresenceInput, KingdomPresenceFrame } from '../presence';
import type { EventCause } from '../events';

/** Private snapshot: NEVER install this in a Colyseus Schema or send it as a public fact. */
export interface RealmOwnedHome {
  readonly id: string; readonly ownerId: PersonId; readonly slot: number;
  readonly allocationReceipt: string; readonly layoutRevision: string;
  readonly revision: string; readonly digest: string; readonly family: 'hearth' | 'tide' | 'grove';
  readonly blueprint: VoxelBlueprint;
  readonly attribution: ForgeReservation['attribution'];
  readonly attachments: Readonly<Record<string, string>>;
}
export interface RealmForgeReservation {
  readonly attempt: ForgeAttempt; readonly homeId: string; readonly streamSessionId: string;
  readonly homeDigest: string;
  readonly rightsRevision: number; readonly reservation: ForgeReservation;
}
export interface RealmOwnedAttachment {
  readonly forgeKey: string;
  readonly ownerId: PersonId; readonly homeId: string; readonly attached: boolean;
  readonly attachment: CommittedForgeAttachment;
  readonly creation: { readonly words: string }; readonly approvalReceipt: string;
}
export interface RealmPrivateState {
  readonly version: 1; readonly kingdomId: KingdomId; readonly origin: 'live' | 'simulated';
  readonly sequence: number;
  readonly stream: { readonly sessionId: string | null; readonly startedAt: number; readonly liveUntil: number };
  readonly rights: Readonly<Record<string, { readonly revision: number; readonly forge: boolean; readonly build: boolean; readonly blocked: boolean; readonly safetyIdentifier: string }>>;
  readonly homes: Readonly<Record<string, RealmOwnedHome>>;
  /** Total held, INCLUDING reserved coals. Reserve/release do not change this number. */
  readonly coals: Readonly<Record<string, number>>;
  readonly reservations: Readonly<Record<string, RealmForgeReservation>>;
  readonly forgeOutcomes: Readonly<Record<string, { readonly attemptId: string; readonly status: 'released' | 'committed' }>>;
  readonly attachments: Readonly<Record<string, RealmOwnedAttachment>>;
  /** One credit per actually qualified stream night; not ten arbitrary presence samples. */
  readonly creditedNights: Readonly<Record<string, true>>;
  /** Closed, unioned evidenced intervals only. An open interval never survives a coverage gap/restart. */
  readonly qualification: Readonly<Record<string, { readonly coveredMs: number; readonly intervals: readonly (readonly [number, number])[] }>>;
}

/** Internal service commands, not a browser protocol. Services verify receipts before entering the room. */
export type RealmDomainCommand =
  | { readonly type: 'stream.observe'; readonly sessionId: string | null; readonly startedAt: number; readonly liveUntil: number }
  | { readonly type: 'citizen.rights'; readonly personId: PersonId; readonly rights: RealmPrivateState['rights'][string] }
  | { readonly type: 'home.installAllocated'; readonly home: RealmOwnedHome }
  | { readonly type: 'home.replaceApproved'; readonly homeId: string; readonly expectedRevision: string; readonly home: RealmOwnedHome; readonly approvalReceipt: string;
      readonly attachments: readonly { readonly id: string; readonly placement: Pick<ForgeAttachment, 'hostId' | 'hostFingerprint' | 'socketId' | 'origin'> | null }[] }
  | { readonly type: 'coal.creditQualifiedNight'; readonly personId: PersonId; readonly streamSessionId: string; readonly qualificationReceipt: string }
  | { readonly type: 'presence.confirmInterval'; readonly personId: PersonId; readonly streamSessionId: string; readonly from: number; readonly through: number; readonly evidenceReceipt: string }
  | { readonly type: 'forge.reserve'; readonly record: RealmForgeReservation }
  | { readonly type: 'forge.release'; readonly attempt: ForgeAttempt }
  | { readonly type: 'forge.commitApproved'; readonly attempt: ForgeAttempt; readonly reservationId: string;
      readonly expectedRevision: string; readonly expectedHomeDigest: string; readonly attachment: ForgeAttachment;
      readonly creation: { readonly words: string }; readonly approvalReceipt: string };

export type RealmCapability = 'presence' | 'moderation' | 'allocation' | 'publication' | 'forge';
export interface RealmDecisionContext {
  readonly now: number; readonly writerEpoch: string; readonly commandId: string;
  readonly capability: RealmCapability;
  /** Checked on entry and again at the transaction's write, after awaits. False cancels without a fact. */
  readonly current: boolean;
  readonly anvilCapacity: number;
  readonly occurredAt?: number; readonly receivedAt?: number; readonly actor?: PersonId | null; readonly cause?: EventCause;
}
export interface RealmFact {
  readonly version: 1; readonly kingdomId: KingdomId; readonly writerEpoch: string; readonly seq: number;
  readonly occurredAt: number; readonly receivedAt: number; readonly committedAt: number;
  readonly origin: 'live' | 'simulated'; readonly type: 'realm.transaction';
  readonly actor: PersonId | null; readonly cause: EventCause;
  readonly body: RealmDomainCommand;
}
export type RealmDecision =
  | { readonly kind: 'accepted'; readonly fact: RealmFact; readonly state: RealmPrivateState; readonly public: readonly RealmPublicMessage[] }
  | { readonly kind: 'unchanged' | 'rejected'; readonly reason: 'duplicate' | 'cold' | 'held' | 'conflict' | 'forbidden' };
export interface RealmWriterLease {
  readonly kingdomId: KingdomId; readonly epoch: string; readonly expiresAt: number;
}
export type RealmStoredOutcome =
  | { readonly status: 'committed'; readonly sequence: number; readonly at: number }
  | { readonly status: 'unchanged' | 'rejected'; readonly reason: string };

/**
 * Postgres implementation belongs to realm-server. There is one durable transaction, not a save callback.
 * Lock/fence the kingdom writer, load the snapshot+tail, then call decide with authoritative transaction time.
 * Append fact, private state/receipt, ledger effects and public outbox ATOMICALLY; compare epoch+sequence.
 * Check `current` after acquiring locks and immediately before the write (no await in that final gap).
 * The transaction also enforces globally unique design IDs and global allocation receipts where applicable.
 * A duplicate commandId returns its stored outcome; a different payload with that id is a conflict.
 * Never acknowledge or broadcast until commit. A lost reply is recovered by lookup, not called a refund.
 */
export interface RealmRepository {
  acquire(kingdomId: KingdomId): Promise<RealmWriterLease>;
  renew(lease: RealmWriterLease): Promise<RealmWriterLease>;
  load(lease: RealmWriterLease): Promise<RealmPrivateState>;
  execute(lease: RealmWriterLease, commandId: string, command: RealmDomainCommand,
    decide: (state: RealmPrivateState, now: number) => RealmDecision, current: () => boolean): Promise<RealmStoredOutcome>;
  lookup(kingdomId: KingdomId, commandId: string): Promise<RealmStoredOutcome | null>;
  /** Private versioned codec supplied by world/wiring; bytes contain no ordinary chat text. */
  loadIngress(lease: RealmWriterLease): Promise<RealmIngressCheckpoint | null>;
  /**
   * Same fenced transaction as execute: receipt, checkpoint, fact batch and presence outbox commit together.
   * Dedupe (source, observation.id), reject changed digests and mismatched kingdom/origin. The checkpoint
   * revision advances exactly once even with zero domain facts. Reject stale checkpoint revisions; recover
   * a lost reply through the same receipt. This method never accepts ordinary chat text.
   */
  executeIngress(lease: RealmWriterLease, input: { readonly source: 'herald' | 'panel' | 'walker'; readonly digest: string; readonly receivedAt: number; readonly observation: PresenceInput },
    transition: (state: RealmPrivateState, checkpoint: RealmIngressCheckpoint | null, now: number) => RealmIngressTransition,
    current: () => boolean): Promise<RealmStoredOutcome>;
  release(lease: RealmWriterLease): Promise<void>;
}
export interface RealmIngressCheckpoint { readonly version: 1; readonly revision: number; readonly codec: 'presence-v1'; readonly data: Uint8Array }
export interface RealmIngressTransition {
  readonly checkpoint: RealmIngressCheckpoint;
  /** Repository runs decideRealm sequentially with trusted capabilities inside the transaction. */
  readonly commands: readonly { readonly command: RealmDomainCommand; readonly capability: RealmCapability; readonly commandId: string }[];
  readonly presence: KingdomPresenceFrame;
}
