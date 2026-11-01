import type { PersonId, Vec3 } from '@chatdom/shared';
import type { CollisionWorld, RealmIntent, RealmInteractionLease, RealmInteractionState, RealmInteractions, RealmPrincipal, RealmPrivateMessage, RealmReceipt, RealmSeat, RealmTransientMessage } from '@chatdom/shared/realm';
import type { RealmIntentContext, RealmRoomEffects } from '../ports';
import type { InteractionRegistry } from '../../../../packages/world/src/interactions';

/**
 * Lane-local seams of the interaction authority. Every port is satisfied by an existing owner's export; the
 * integrator binds them (see README). Nothing here is a browser payload or a new public protocol.
 */

/** The subset of the actual `RealmRoomEffects` this lane uses. Pose authority stays with the room. */
export type InteractionRoomEffects = Pick<RealmRoomEffects, 'readWalker' | 'placeWalker' | 'allowWalking'>;
/** The actual `RealmRoomHandle.bindTransient` callbacks. */
export type SeatsMessage = Extract<RealmTransientMessage, { type: 'seats' }>;
export type InteractionMessage = Extract<RealmPrivateMessage, { type: 'interaction' }>;
export type InteractIntent = Extract<RealmIntent, { type: 'interact' }>;
export interface InteractionDelivery {
  readonly transient: (message: RealmTransientMessage) => void;
  readonly owner: (personId: string, message: RealmPrivateMessage) => void;
}

/** Current rights. `current` is the realm authenticator's revocation check; `permitted` reads the room's rights. */
export interface InteractionRights {
  current(principal: RealmPrincipal, now: number): Promise<boolean>;
  /** False while warned out, timed out, banned or blocked. Synchronous: read immediately before mutation. */
  permitted(personId: PersonId): boolean;
}
/** The installed deed. Plot of the home this person owns at the room's current layout, else null. */
export interface InteractionHomes {
  ownedPlotId(personId: PersonId): string | null;
  /**
   * The installed home revision on this plot right now (`RealmOwnedHome.revision`). When given, a door derived from
   * another revision is refused ("Your home has just changed"); the registry is rebuilt for the new one.
   */
  revisionOf?(plotId: string): string | null;
}
/**
 * The zone a standing body is in, from the existing tavern threshold/zone flow (spec 22). Interior zones are this
 * lane's own accepted state and are never asked here. Absent, or null, means the street.
 */
export interface InteractionZones {
  zoneOf(walkerId: string, feet: Vec3): string | null;
}

/**
 * Existing match host for tavern chairs (spec 22) and the campfire's voice/admission supervisor (spec 21).
 * Admission is acquired before the synchronous seat mutation and cancelled if the seat is refused; `released`
 * is called in the same turn a lease ends. These stay typed in-process hooks; absence makes `tavern` unavailable.
 * `composeInteractionHosts` (./hosts.ts) builds this from the two producers' own seat seams.
 */
export interface InteractionHosts {
  /**
   * Seat kinds whose host decides before the claim. A tavern chair always needs its table host; a campfire log
   * asks its host only when listed here (the fire's own rule for logs a match holds). Default: tavern only.
   */
  readonly decides?: readonly ('campfire-seat' | 'tavern-seat')[];
  /**
   * `signal` aborts when the room stops waiting (moderation, leave, writer loss); the host should stop admitting.
   * An admission that resolves after the abort is cancelled by the room and never seats anyone.
   */
  admit?(request: { readonly targetId: string; readonly personId: PersonId; readonly walkerId: string; readonly signal: AbortSignal }): Promise<InteractionAdmission>;
  released?(lease: RealmInteractionLease, why: InteractionReleaseCause): void;
}
export type InteractionAdmission =
  | {
    readonly admitted: true; readonly cancel: () => void;
    /** The claim landed: the exact seat and generation the host may later end with `endSeat`. Never before. */
    readonly seated?: (seat: { readonly targetId: string; readonly generation: number }) => void;
  }
  | { readonly admitted: false; readonly reason: 'refused' | 'unavailable' };
/**
 * Why a lease ended. `replaced`: the same person sat elsewhere from a newer window. `host-ended`: its host closed it
 * by exact generation. `closed`: the authority stopped writing (writer loss/shutdown).
 */
export type InteractionReleaseCause = 'stand' | 'leave' | 'expired' | 'revoked' | 'replaced' | 'target-removed' | 'host-ended' | 'closed';

/** Movement owner's supported recovery (main: `RealmRoomHandle.recoverWalker`). */
export type InteractionRecovery = (walkerId: string, collisionRevision: number) => boolean;

/** Unsolicited self-state for one live session, delivered with `requestId: null`. */
export interface InteractionSelfChange {
  readonly personId: PersonId; readonly sessionId: string; readonly walkerId: string;
  readonly state: RealmInteractionState;
}
export interface InteractionChange {
  /** Present when the public seat projection changed. */
  readonly seats: SeatsMessage | null;
  readonly selves: readonly InteractionSelfChange[];
  readonly released: readonly { readonly lease: RealmInteractionLease; readonly cause: InteractionReleaseCause }[];
}
/** Collision for the room's current revision (the room's own `world`). */
export type CurrentWorld = () => CollisionWorld;
export type InteractionSeats = readonly RealmSeat[];

export interface InteractionAuthorityOptions {
  /** The room's durable writer epoch. A new epoch is a new authority: leases never cross it. */
  readonly writerEpoch: string;
  /** The room clock in ms (Colyseus `clock.currentTime` or the realm's own). Never the browser's. */
  readonly clock: () => number;
  /** The realm's configured reconnect grace; a dropped sitter keeps the seat this long and no longer. */
  readonly reconnectGraceMs: number;
  readonly world: CurrentWorld;
  /** The registry built for the room's current collision revision, or null while none is installed. */
  readonly registry: () => InteractionRegistry | null;
  readonly rights: InteractionRights;
  readonly homes: InteractionHomes;
  readonly zones?: InteractionZones;
  readonly hosts?: InteractionHosts;
  readonly recovery?: InteractionRecovery;
  /** The realm limiter for one person's interaction requests. False refuses without touching any state. */
  readonly limiter?: (personId: PersonId, now: number) => boolean;
}

/**
 * The room's interaction authority: the shared `RealmInteractions` plus the request adapter and the actual room
 * hook shapes, so it binds to `RealmRoomHandle.intent/lifecycle/bindRoom/bindTransient` without editing them.
 */
export interface InteractionAuthority extends RealmInteractions {
  /**
   * `RealmRoomHandle.intent` for `type: 'interact'`. Deduplicates by the principal's entry session and request ID:
   * a redelivery returns the same receipt, and another window's IDs never collide with this one's.
   */
  intent(context: RealmIntentContext, intent: InteractIntent): Promise<RealmReceipt>;
  /**
   * `RealmRoomHandle.lifecycle`, called with the room's own clock time. `join` by a person who holds a seat (a reload
   * or a newer window, which the realm admits as a fresh session and walker) resumes that same lease and generation
   * under the new walker; the replaced session is never delivered to again.
   */
  lifecycle(event: 'join' | 'drop' | 'reconnect' | 'leave', principal: RealmPrincipal, walkerId: string, now: number): void;
  /** `RealmRoomHandle.bindRoom` effects. Without them every placing action is honestly unavailable. */
  bindRoom(effects: InteractionRoomEffects): () => void;
  /** `RealmRoomHandle.bindTransient` callbacks: seat fanout and self-only state. */
  bindDelivery(delivery: InteractionDelivery): () => void;
  /**
   * Moderation (warning, timeout, ban, revoked rights): this person's occupancy ends in this same turn and every
   * request of theirs still awaiting rights or host admission is aborted, so it can never seat them afterwards.
   */
  revoke(personId: PersonId): void;
  /** The host ended this exact lease (its table closed). Fenced by generation; false when it is not the current one. */
  endSeat(seat: { readonly targetId: string; readonly generation: number }): boolean;
  /** A new collision/layout revision was adopted: seats whose target no longer exists are released. */
  adoptRegistry(): void;
  /** Earliest absolute room-clock expiry of a held seat, so the room can schedule `expire(now)`. */
  nextExpiry(): number | null;
  /** Current public seat envelope and one session's self state (bootstrap after join/reconnect). Self revisions rise
   * across all of a person's sessions, so a newer window never mistakes an older window's state for news. */
  seats(): SeatsMessage;
  selfState(sessionId: string): RealmInteractionState;
  /** Lane-local change hook for the void lifecycle calls; delivery already happens through `bindDelivery`. */
  onChange(listener: (change: InteractionChange) => void): () => void;
  /** Writer loss or shutdown: every lease ends, hosts are told, nothing is delivered afterwards. */
  dispose(): void;
}
