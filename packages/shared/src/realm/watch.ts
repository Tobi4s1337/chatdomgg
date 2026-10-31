import type { RealmFoundedManifest } from './founded-world';
import type { RealmBootstrap } from './messages';
import { z } from 'zod';
import { DisplayNameSchema, EpochMsSchema, KingdomIdSchema, TokenSchema, UIntSchema } from '../identity';
import { CitizenLookIdSchema } from '../citizen-look';

/** Actual walkers only; matches the current KingdomRoom capacity and 5 Hz public patch cadence. */
export const REALM_WALKER_FRAME_LIMIT = 300;
export const REALM_WALKER_FRAME_MAX_BYTES = 262_144;
export const REALM_WALKER_FRAME_INTERVAL_MS = 200;
export interface RealmWalkerPresentation { readonly homeSlot: number; readonly look: string }
export const RealmObservedWalkerSchema = z.strictObject({
  id: TokenSchema, name: DisplayNameSchema, look: CitizenLookIdSchema, homeSlot: UIntSchema.max(65535),
  x: z.number().finite(), y: z.number().finite(), z: z.number().finite(),
  yaw: UIntSchema.max(255), distance: z.number().finite().nonnegative(), speed: z.number().finite().nonnegative(),
  placement: UIntSchema.max(0xffff_ffff),
});
export type RealmObservedWalker = z.infer<typeof RealmObservedWalkerSchema>;
/** Named SSE event `walkers`: bounded ephemeral view of the SAME room. No replay/event cursor or crowd poses. */
export const RealmWalkerFrameSchema = z.strictObject({
  version: z.literal(1), kingdomId: KingdomIdSchema, origin: z.enum(['live', 'simulated']),
  writerEpoch: TokenSchema, layoutRevision: TokenSchema, collisionRevision: UIntSchema.max(0xffff_ffff),
  sampledAt: EpochMsSchema, walkers: z.array(RealmObservedWalkerSchema).max(REALM_WALKER_FRAME_LIMIT),
}).superRefine((frame, ctx) => {
  if (new Set(frame.walkers.map(walker => walker.id)).size !== frame.walkers.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate public walker' });
});
export type RealmWalkerFrame = z.infer<typeof RealmWalkerFrameSchema>;
export interface RealmWalkerFeed {
  subscribe(receive: (frame: RealmWalkerFrame) => void, unavailable: () => void): () => void;
}

/** Read-only public stream projection. No join ticket, principal, walker, input or command channel. */
export const REALM_WATCH_ROUTE = '/api/realm/watch/:kingdomId';
/** Named SSE event `checkpoint`; subsequent `world`/`transient` payloads use the existing room contracts. */
export interface RealmWatchCheckpoint {
  readonly version: 1;
  readonly manifest: RealmFoundedManifest;
  readonly checkpoint: RealmBootstrap;
}
/** Named SSE event `revision`; reopen at a fresh checkpoint and fetch its exact current scene bytes. */
export interface RealmWatchRevision {
  readonly layoutRevision: string;
  readonly collisionRevision: number;
}
