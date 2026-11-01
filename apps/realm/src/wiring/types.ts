import type { KingdomId } from '@chatdom/shared';
import type { ForgeAttempt, KingdomForgeAuthority } from '@chatdom/shared/realm';
import type { ForgeWriteGate } from './gate';
import type { ForgeCandidateBinding } from '../../../codex/src/kingdom-forge/candidate';

/** Trusted private durable judge evidence, written by the coordinator's audit sink before commit. */
export interface RealmForgeApprovals {
  /** Both independent gates must pass; bind the selected draft and full host digest before authorizing. */
  approved(key: string, runId: string, expected: ForgeCandidateBinding): Promise<string | null>;
}
export interface RealmForgeOptions {
  readonly approvals: RealmForgeApprovals;
  /** Install this same instance in the Postgres repository through gate.install(options). */
  readonly gate: ForgeWriteGate;
  readonly anvils?: number;
  readonly reservationMs?: number;
}
export type RealmForgeAttemptStatus =
  | { readonly kind: 'committed'; readonly committedAt: number }
  | { readonly kind: 'reserved' | 'released' | 'other-attempt' | 'unknown' };
export interface RealmForgeAuthority extends KingdomForgeAuthority {
  status(attempt: ForgeAttempt): Promise<RealmForgeAttemptStatus>;
}
/** Private operational codes only: never words, source IDs, people, judge bodies or geometry. */
export interface RealmWiringLog {
  readonly kind: 'forge';
  readonly kingdomId: KingdomId;
  readonly operation: 'reserve' | 'revalidate' | 'commit' | 'release' | 'expire' | 'status';
  readonly status: string;
  readonly reason?: string;
}
