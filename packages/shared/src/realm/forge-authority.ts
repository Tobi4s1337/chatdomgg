import type { ForgeDraft, ForgeHostProfile } from '../forge';
import { z } from 'zod';
import { TokenSchema } from '../identity';
import type { KingdomId, PersonId } from '../identity';
import type { VoxelBlueprint } from '../voxel';

/** Private and structurally compatible with Herald. A presentation slot is only a hint, never a deed. */
export interface KingdomForgeCommand {
  readonly kingdomId: KingdomId;
  readonly personId: PersonId;
  readonly messageId: string;
  readonly slot: number;
  readonly words: string;
  readonly observedAt: number;
}
export interface KingdomForgeLease {
  readonly signal: AbortSignal;
  current(): boolean;
}
export interface ForgeAttempt {
  /** Stable hash of kingdom + Twitch message ID; the authority enforces uniqueness durably. */
  readonly key: string;
  /** Distinguishes competing callers so one caller's cleanup cannot release another's reservation. */
  readonly attemptId: string;
}
export interface NativeForgeHome {
  readonly slot: number;
  readonly revision: string;
  readonly family: 'hearth' | 'tide' | 'grove';
  readonly home: VoxelBlueprint;
  readonly hostProfile?: ForgeHostProfile;
}
export interface ForgeReservation extends NativeForgeHome {
  readonly reservationId: string;
  readonly kingdomId: KingdomId;
  readonly personId: PersonId;
  /** Real authority supplies a stable opaque citizen hash, never the development safety identity. */
  readonly safetyIdentifier: string;
  readonly expiresAt: number;
  /** Already approved display names (or approved anonymous defaults), with durable approval evidence. */
  readonly attribution: { readonly makerName: string; readonly kingdomName: string; readonly approvalId: string };
}

/** A candidate is private until the authority durably commits precisely this attachment. */
export interface ForgeAttachment {
  readonly version: 1;
  readonly id: string;
  readonly runId: string;
  readonly kingdomId: KingdomId;
  readonly slot: number;
  readonly hostId: string;
  readonly hostFingerprint: string;
  readonly socketId: string;
  readonly origin: readonly [number, number, number];
  readonly kitId: string;
  readonly kitRevision: number;
  readonly family: NativeForgeHome['family'];
  readonly hostProfile?: ForgeHostProfile;
  readonly draft: ForgeDraft;
  readonly provenance: {
    readonly source: 'live' | 'simulated';
    readonly makerName: string;
    readonly kingdomName: string;
    readonly designId: string;
  };
}
export type CommittedForgeAttachment = Omit<ForgeAttachment, 'provenance'> & {
  readonly committedAt: number;
  readonly provenance: ForgeAttachment['provenance'] & { readonly firstForgedAt: number };
};
/** Present-tense only. Ending the animation reveals no verdict, identity, wish or dependency failure. */
export const ForgeTransientActivitySchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('stage'), activityId: TokenSchema, stage: z.enum(['judging-words', 'drafting', 'assembling', 'judging-piece']) }),
  z.strictObject({ type: z.literal('ended'), activityId: TokenSchema }),
]);
export type ForgeTransientActivity = z.infer<typeof ForgeTransientActivitySchema>;
/** activityId is the opaque attemptId throughout stages and the durable reveal; runId identifies the model run. */
export type ForgeActivity =
  | ForgeTransientActivity
  | { readonly type: 'committed'; readonly activityId: string; readonly attachment: CommittedForgeAttachment };

export interface KingdomForgeAuthority {
  /** Bound by the owning room, never by the wish/browser. Applies to every reservation and attachment. */
  readonly origin: 'live' | 'simulated';
  /**
   * Atomically check actual home ownership, free-word eligibility, live session, moderation, coal and anvil
   * capacity; reserve one coal/capacity without spending it. Never derive these rights from the slot hint.
   * Enforce one active work per person and durable key uniqueness. Expiry recovers abandoned reservations.
   * A thrown/aborted call may be retried/cleaned up by attemptId without creating a second reservation.
   */
  reserve(input: ForgeAttempt & Omit<KingdomForgeCommand, 'words'>, lease: KingdomForgeLease): Promise<
    | { readonly kind: 'reserved'; readonly reservation: ForgeReservation }
    | { readonly kind: 'held' | 'cold' | 'already-committed' }
  >;
  /** Recheck rights and return the CURRENT owned home, not the reserved snapshot echoed back. */
  revalidate(attempt: ForgeAttempt, reservationId: string, lease: KingdomForgeLease): Promise<
    | { readonly kind: 'current'; readonly native: NativeForgeHome }
    | { readonly kind: 'held' | 'cold' }
  >;
  /**
   * One durable transaction: recheck lease.current(), expiry, rights, revision and SHA-256 home digest;
   * consume exactly one reserved coal; attach the exact candidate and retain any displaced item safely;
   * persist provenance/private owner linkage and a public outbox/snapshot entry; release anvil capacity.
   * Set committedAt AND provenance.firstForgedAt to the same authoritative transaction timestamp, and
   * return that identical timestamp. Each original designId is unique; only actual copies retain a lineage.
   * Recheck after any await before the transaction's linearization point. No successful result before commit.
   * Duplicate keys never consume again or replay a public ritual. A failed CAS leaves the home untouched.
   */
  commit(input: ForgeAttempt & {
    readonly reservationId: string;
    readonly expectedRevision: string;
    readonly expectedHomeDigest: string;
    readonly attachment: ForgeAttachment;
    /** Private creation input, retained with the made item (Safety §5); never copied into its public outbox. */
    readonly creation: { readonly words: string };
  }, lease: KingdomForgeLease): Promise<
    | { readonly kind: 'committed'; readonly committedAt: number }
    | { readonly kind: 'held' | 'cold' | 'already-committed' }
  >;
  /** Idempotent, durable cleanup for this attempt only; a committed/other attempt is never refunded or erased. */
  release(attempt: ForgeAttempt): Promise<void>;
}

/** Private response; no public verdict. An observed animation may end through the opaque transient above. */
export type KingdomForgeOutcome =
  | { readonly kind: 'committed'; readonly attachment: CommittedForgeAttachment; readonly published: boolean }
  | { readonly kind: 'already-committed' }
  | ({ readonly kind: 'recovery-needed' } & ForgeAttempt)
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'held' | 'cold' | 'canceled' };
