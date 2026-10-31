import { z } from 'zod';
import { BuildOperationSchema } from '../build';
import { KingdomIdSchema, TokenSchema, UIntSchema, type KingdomId, type PersonId } from '../identity';
import type { Vec3 } from '../voxel';
import type { KingdomPresenceFrame } from '../presence';
import type { ForgeActivity, CommittedForgeAttachment } from './forge-authority';
import type { CitizenChatCue } from '../citizen-chat';
import type { RealmInteractionState, RealmSeat } from './interactions';
import type { TwitchMomentFact } from '../twitch-moments';

export function kingdomRoomId(kingdom: KingdomId | string): `k:${string}` {
  return `k:${KingdomIdSchema.parse(kingdom)}`;
}
/** Reserved identities, not implemented rooms or permission to write kingdom facts. */
export const REALM_ROLES = {
  kingdom: 'single-writer', layer: 'movement-and-seats', draft: 'private-edits', match: 'private-game',
} as const;

export const RealmJoinSchema = z.strictObject({ kingdomId: KingdomIdSchema, ticket: z.string().min(16).max(4096), protocol: z.literal(1) });
export type RealmJoin = z.infer<typeof RealmJoinSchema>;
/** Returned by a verified session service. Never decoded from client-selected identity fields. */
export interface RealmPrincipal {
  readonly personId: PersonId; readonly kingdomId: KingdomId;
  readonly sessionId: string; readonly expiresAt: number;
  readonly origin: 'live' | 'simulated'; readonly publicName: string; readonly look: string;
}
export interface RealmAuthenticator {
  authenticate(join: RealmJoin): Promise<RealmPrincipal>;
  /** Recheck revocation, not merely token expiry, when reconnecting or applying an owned action. */
  current(principal: RealmPrincipal, now: number): Promise<boolean>;
}

const request = { version: z.literal(1), id: TokenSchema };
export const RealmIntentSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...request, type: z.literal('build.edit'), plotId: TokenSchema, revision: UIntSchema, operation: BuildOperationSchema }),
  z.strictObject({ ...request, type: z.literal('build.undo'), plotId: TokenSchema, revision: UIntSchema }),
  z.strictObject({ ...request, type: z.literal('build.redo'), plotId: TokenSchema, revision: UIntSchema }),
  z.strictObject({ ...request, type: z.literal('build.publish'), plotId: TokenSchema, revision: UIntSchema, name: z.string().trim().min(1).max(80) }),
  z.strictObject({ ...request, type: z.literal('forge.wish'), words: z.string().trim().min(1).max(240) }),
  z.strictObject({ ...request, type: z.literal('interact'), targetId: TokenSchema, action: z.enum(['sit', 'forge', 'tavern', 'enter-home', 'exit-home', 'stand']) }),
]);
export type RealmIntent = z.infer<typeof RealmIntentSchema>;
export type RealmReceipt =
  | { readonly version: 1; readonly id: string; readonly status: 'committed'; readonly writerEpoch: string; readonly sequence: number }
  | { readonly version: 1; readonly id: string; readonly status: 'applied'; readonly writerEpoch: string; readonly state: RealmInteractionState }
  | { readonly version: 1; readonly id: string; readonly status: 'held' | 'refused' | 'unavailable'; readonly message: string };

/** Public domain delivery is separate from the small movement schema; never send raw private facts. */
export type RealmPublicMessage =
  /** Only committed, disclosure-filtered facts. `current` keeps lasting state in the next quiet checkpoint. */
  | { readonly type: 'moment'; readonly fact: TwitchMomentFact; readonly current: boolean }
  /** Checkpoint only: never a request to animate historical events. */
  | { readonly type: 'moments.current'; readonly throughSeq: number; readonly facts: readonly TwitchMomentFact[] }
  | { readonly type: 'presence'; readonly frame: KingdomPresenceFrame }
  | { readonly type: 'forge'; readonly event: ForgeActivity }
  | { readonly type: 'home'; readonly plotId: string; readonly revision: string; readonly assetHash: string; readonly attachments: readonly CommittedForgeAttachment[] }
  | { readonly type: 'castle'; readonly moduleId: string; readonly revision: string; readonly assetHash: string; readonly attachments: readonly CommittedForgeAttachment[] };
export interface RealmPublicDelivery {
  readonly version: 1; readonly kingdomId: KingdomId; readonly writerEpoch: string;
  readonly sequence: number; readonly cursor: number; readonly eventId: string; readonly message: RealmPublicMessage;
}
export interface RealmBootstrap {
  readonly version: 1; readonly kingdomId: KingdomId; readonly writerEpoch: string;
  readonly throughSequence: number; readonly throughCursor: number; readonly layoutRevision: string; readonly collisionRevision: number;
  /** Current approved views, not a replay of historical rituals. No private domain snapshot. */
  readonly current: readonly RealmPublicMessage[];
}

/** Transient room messages are never appended to history/snapshots or replayed as newly live speech. */
export type RealmTransientMessage =
  | { readonly type: 'forge'; readonly event: Exclude<ForgeActivity, { type: 'committed' }> }
  | { readonly type: 'chat'; readonly cue: CitizenChatCue }
  | { readonly type: 'chat.remove'; readonly cueIds: readonly string[] }
  | { readonly type: 'chat.clear' }
  | { readonly type: 'seats'; readonly writerEpoch: string; readonly revision: number; readonly seats: readonly RealmSeat[] };
export type RealmPrivateMessage =
  /** The authenticated viewer's own street plot, never the other homes' ownership table. */
  | { readonly type: 'home.owned'; readonly plotId: string | null }
  | { readonly type: 'receipt'; readonly receipt: RealmReceipt }
  | { readonly type: 'interaction'; readonly requestId: string | null; readonly writerEpoch: string; readonly state: RealmInteractionState };

export interface RealmInteractionTarget {
  readonly id: string;
  readonly kind: 'campfire-seat' | 'anvil' | 'tavern-seat' | 'home-door' | 'home-exit';
  readonly position: Vec3; readonly approach: Vec3; readonly reach: number;
  readonly plotId?: string;
}
