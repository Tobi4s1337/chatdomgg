import type { KingdomId } from '@chatdom/shared';
import type { CollisionWorld, PlayerState, RealmAuthenticator, RealmIntent, RealmPrincipal, RealmReceipt, RealmPublicDelivery, RealmTransientMessage, RealmPrivateMessage, RealmBootstrap } from '@chatdom/shared/realm';

export interface RealmIntentContext {
  readonly principal: RealmPrincipal; readonly walkerId: string;
  readonly position: readonly [number, number, number]; readonly collisionRevision: number;
  /** Async admission must read again, recheck rights, then act synchronously on current authority. */
  current(): Readonly<PlayerState> | null;
}
export interface RealmRoomEffects {
  /** Irreversible writer-loss/shutdown gate: stop all room work, then disconnect without guessing commit outcomes. */
  close(reason: 'authority-lost' | 'shutdown'): void;
  readWalker(walkerId: string): Readonly<PlayerState> | null;
  /** Caller validates support/egress at this revision. Stale revisions fail without moving anyone. */
  placeWalker(walkerId: string, position: readonly [number, number, number], collisionRevision: number): boolean;
  allowWalking(walkerId: string, allowed: boolean): void;
  /** Atomic committed geometry/collision adoption. Positions cover every affected walker. */
  adoptWorld(world: CollisionWorld, layoutRevision: string, positions: ReadonlyMap<string, readonly [number, number, number]>): void;
}
/** The room owns this handle. Server persistence + domain wiring supply its implementation. */
export interface RealmRoomHandle {
  readonly kingdomId: KingdomId; readonly origin: 'live' | 'simulated';
  readonly writerEpoch: string; readonly layoutRevision: string;
  readonly world: CollisionWorld;
  readonly sequence: number;
  spawn(principal: RealmPrincipal): readonly [number, number, number];
  /** Server-only: choose a supported clear anchor in the current world and place via bound effects. */
  recoverWalker(walkerId: string, collisionRevision: number): boolean;
  intent(context: RealmIntentContext, intent: RealmIntent): Promise<RealmReceipt>;
  /** Synchronous checkpoint: client buffers deltas, installs throughCursor, then applies newer entries. */
  bootstrap(principal: RealmPrincipal): RealmBootstrap;
  bindRoom(effects: RealmRoomEffects): () => void;
  lifecycle(event: 'join' | 'drop' | 'reconnect' | 'leave', principal: RealmPrincipal, walkerId: string, now: number): void;
  /** Only committed public outbox entries; public projection catches up before declaring itself ready. */
  subscribe(deliver: (message: RealmPublicDelivery) => void): () => void;
  /** Transient chat/seats and owner-only replies are never durable public history. */
  bindTransient(send: (message: RealmTransientMessage) => void, owner: (personId: string, message: RealmPrivateMessage) => void): () => void;
  dispose(): Promise<void>;
}
export interface RealmRoomServices {
  readonly auth: RealmAuthenticator;
  /** Acquires the exclusive durable writer lease before returning. Rejects a second active writer. */
  open(kingdomId: KingdomId): Promise<RealmRoomHandle>;
}
