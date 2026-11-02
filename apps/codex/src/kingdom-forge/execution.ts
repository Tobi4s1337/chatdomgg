import type { ForgeStyleKit } from '@chatdom/shared';
import type { ForgeRunContext } from '../run';
import type { ForgeRunSelection } from '../wish-decision';
import type { ForgeAttempt, ForgeReservation, KingdomForgeAuthority } from './ports';

export type ForgeCommitRequest = Parameters<KingdomForgeAuthority['commit']>[0];

/** Trusted server-only recovery hooks. A browser or model cannot supply this execution context. */
export interface KingdomForgeExecution {
  readonly attempt: ForgeAttempt;
  readonly recovery: NonNullable<ForgeRunContext['recovery']>;
  /** Bind the exact authoritative reservation before model work or recovered evidence can be used. */
  bind(reservation: ForgeReservation, kit: ForgeStyleKit): Promise<void>;
  /** Save the entire original command before the authority can cross its transactional write boundary. */
  prepareCommit(input: ForgeCommitRequest, selection?: ForgeRunSelection): Promise<void>;
}
