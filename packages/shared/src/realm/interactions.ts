import type { PersonId } from '../identity';
import type { Vec3 } from '../voxel';
import type { RealmInteractionTarget } from './messages';

/** Ephemeral movement authority. A physical seat does not grant a game/voice/royal seat. */
export interface RealmSeat {
  readonly targetId: string; readonly walkerId: string; readonly generation: number;
  readonly status: 'occupied' | 'reconnecting';
}
export interface RealmInteractionState {
  readonly revision: number; readonly mode: 'standing' | 'seated' | 'interior';
  readonly targetId: string | null; readonly plotId: string | null;
}
export interface RealmInteractionLease {
  readonly seat: RealmSeat; readonly sessionId: string; readonly personId: PersonId;
  readonly writerEpoch: string; readonly expiresAt: number;
}
export interface RealmInteractionContext {
  readonly personId: PersonId; readonly sessionId: string; readonly walkerId: string;
  readonly writerEpoch: string; readonly now: number;
  /** From authoritative player/collision/ownership state, never the request body. */
  readonly position: Vec3; readonly collisionRevision: number; readonly ownedPlotId: string | null;
  /** Target approach/exit has been checked supported and unoccupied at collisionRevision. */
  readonly target: RealmInteractionTarget | null; readonly unobstructed: boolean; readonly permitted: boolean;
}
export type RealmInteractionAction = 'sit' | 'forge' | 'tavern' | 'enter-home' | 'exit-home' | 'stand';
export type RealmInteractionResult =
  | { readonly kind: 'accepted'; readonly state: RealmInteractionState; readonly position: Vec3 | null; readonly seats: readonly RealmSeat[] }
  | { readonly kind: 'refused'; readonly reason: 'unreachable' | 'occupied' | 'forbidden' | 'unavailable' };
export interface RealmInteractions {
  act(context: RealmInteractionContext, action: RealmInteractionAction): RealmInteractionResult;
  drop(sessionId: string, now: number): void;
  reconnect(sessionId: string, now: number): void;
  release(sessionId: string): void;
  expire(now: number): void;
}
