// The room and spell runtime consume one main-owned authority contract.
export type * from '@chatdom/shared/realm';
import type { JudgeVerdict } from '../providers';

/** No original wish, source message ID, person ID, house, or provider error body enters this audit. */
export interface KingdomForgeAudit {
  readonly key: string;
  readonly runId: string;
  readonly at: number;
  /** This records the model gates, not a claim that the realm committed anything. */
  readonly judgment: string;
  readonly verdicts: readonly Pick<JudgeVerdict, 'outcome' | 'records' | 'quality'>[];
}
