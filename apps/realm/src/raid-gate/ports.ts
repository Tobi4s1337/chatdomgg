/**
 * What the travel coordinator needs from main (spec 23 "Contracts"): the realm's room membership transport, the
 * durable repository (`records.ts`) and the server clock. These are mechanical I/O adapters; reservation, readiness,
 * the single commit, rollback, return and recovery are decided in `coordinator.ts`.
 */
import type { KingdomId, PersonId } from '../../../../packages/shared/src/identity';
import type { TravelReason } from '../../../api/src/raid-gate/contracts';
import type { RaidMarchCheck } from '../../../api/src/raid-gate/ports';
import type { RecordOrigin, TravelRepository, TravelRole } from './records';

/**
 * One ticket as the room transport sees it. `ticket` is the idempotency key of every operation. `generation` is the
 * person's walking-membership generation this journey would establish: commit succeeds only while the person's
 * membership is still at `generation - 1` in `from`, and moves it atomically, so there are never two walking leases.
 */
export type TravelTicketRef = Readonly<{
  ticket: string; personId: PersonId; sessionId: string; from: KingdomId; to: KingdomId; generation: number; kind: TravelReason['kind'];
}>;

/** A read-only look at the destination's door: access, bans and capacity right now. Holds nothing. */
export type AdmissionOutcome = Readonly<{ kind: 'admitted' }> | Readonly<{ kind: 'full' }> | Readonly<{ kind: 'denied' }> | Readonly<{ kind: 'unknown' }>;
/** The destination holds a place for this ticket until `leaseUntil`, or is still deciding, or refused. */
export type HoldOutcome =
  | Readonly<{ kind: 'acknowledged'; leaseUntil: number }>
  | Readonly<{ kind: 'pending' }>
  | Readonly<{ kind: 'denied'; code: 'full' | 'refused' }>
  | Readonly<{ kind: 'unknown' }>;
/** The destination world is loaded and a safe arrival point is ready for this person, or is still being made ready. */
export type PrepareOutcome = Readonly<{ kind: 'acknowledged' }> | Readonly<{ kind: 'pending' }> | Readonly<{ kind: 'denied' }> | Readonly<{ kind: 'unknown' }>;
/** The destination took the walker, in the role its own authority decided, at its own time. */
export type CommitOutcome =
  | Readonly<{ kind: 'acknowledged'; role: TravelRole; committedAt: number }>
  | Readonly<{ kind: 'pending' }>
  | Readonly<{ kind: 'denied' }>
  | Readonly<{ kind: 'unknown' }>;
/** What the room transport knows of a ticket: committed, still held but never committed, released, or cannot tell. */
export type TicketStatus =
  | Readonly<{ kind: 'committed'; role: TravelRole; committedAt: number }>
  | Readonly<{ kind: 'held' }>
  | Readonly<{ kind: 'released' }>
  | Readonly<{ kind: 'unknown' }>;
export type ReleaseOutcome = Readonly<{ kind: 'acknowledged' }> | Readonly<{ kind: 'unknown' }>;

/**
 * Main's room membership transport over the realm's existing rooms and destination moderation. Every operation is
 * idempotent by `ref.ticket`. A timeout, a dropped connection or any answer it cannot vouch for is `unknown`.
 *
 * - `reserve` holds a place at the destination; `prepare` readies the world and an arrival point for the person.
 * - `commit` moves the walking membership from `from` to `to` atomically, honouring the fencing generation, and
 *   answers the destination's role for this person (monarch only at home, citizen at their own door, else visitor).
 * - `reconcile` never moves anyone: it says whether the ticket committed, is still only held, or was released. Once it
 *   answers `held` or `released`, a commit for that ticket that arrives later is refused, so the answer stays true.
 * - `release('destination')` drops a reservation that will not commit; `release('source')` lets go of the source
 *   place retained for rollback, and is only ever called after the destination acknowledged the commit.
 */
export interface RealmTravelTransport {
  readonly origin: RecordOrigin;
  checkAdmission(personId: PersonId, kingdomId: KingdomId, signal: AbortSignal): Promise<AdmissionOutcome>;
  reserve(ref: TravelTicketRef, signal: AbortSignal): Promise<HoldOutcome>;
  prepare(ref: TravelTicketRef, signal: AbortSignal): Promise<PrepareOutcome>;
  commit(ref: TravelTicketRef, signal: AbortSignal): Promise<CommitOutcome>;
  reconcile(ref: TravelTicketRef, signal: AbortSignal): Promise<TicketStatus>;
  release(ref: TravelTicketRef, side: 'destination' | 'source', signal: AbortSignal): Promise<ReleaseOutcome>;
}

export type RaidTravelDeps = Readonly<{
  repository: TravelRepository;
  rooms: RealmTravelTransport;
  /** The gate application's own check that a person marched on a witnessed raid (`createRaidMarchCheck`). */
  marches: RaidMarchCheck;
  /** `simulated` whenever the room transport is controlled; then every view carries SIMULATED. */
  origin: RecordOrigin;
  /** Main's server clock. */
  clock: () => number;
  /** Fresh opaque tickets; defaults to `crypto.randomUUID`. */
  tickets?: () => string;
  /** How long one room call may take before its answer counts as unknown. */
  callTimeoutMs?: number;
}>;

/** What one recovery pass did, for main's log. */
export type TravelRecovery = Readonly<{ expired: number; reconciled: number; released: number }>;
