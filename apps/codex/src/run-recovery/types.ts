import type { ForgeDraft, ForgeRunRequest, ForgeStyleKit } from '@chatdom/shared';
import type { ForgeCallBudget, ForgeDraftCandidate, JudgeVerdict } from '../providers';

export type ForgeRecoveryStage = 'words' | 'drafting' | 'result';
export interface ForgeRunCandidate extends ForgeDraftCandidate {
  readonly attempt: number;
  readonly verdict: number;
}
export type ForgeRunStopCode = 'safety-hold' | 'safety-refuse' | 'no-slot' | 'fit' | 'service' | 'budget';
/** Private finite execution state; the word/home binding lives in its recovery envelope. */
export interface ForgeRunState {
  readonly id: string;
  readonly at: number;
  phase: 'words' | 'drafting' | 'assembling' | 'selecting' | 'approved' | 'stopped';
  attempts: number;
  verdicts: JudgeVerdict[];
  candidates: ForgeRunCandidate[];
  pending?: ForgeDraftCandidate;
  best?: number;
  softening?: 'fit';
  feedback?: 'fit' | 'quality';
  stop?: { readonly outcome: 'hold' | 'refuse' | 'cold'; readonly code: ForgeRunStopCode };
}
export interface ForgeRunRecoveryInput {
  readonly request: ForgeRunRequest;
  readonly styleKit: ForgeStyleKit;
  readonly safetyIdentifier: string;
}
export interface ForgeRunRecovery {
  /** Initializes stable identity before the first model call, or restores this exact run's last snapshot. */
  restore(input: ForgeRunRecoveryInput): Promise<ForgeRunState>;
  /** Persist completed finite work before the next stage can begin. */
  save(state: ForgeRunState, stage: ForgeRecoveryStage): Promise<void>;
  /** Each view debits the durable ledger before a real invocation; exact-result views retain the five-call cap. */
  budget(stage: ForgeRecoveryStage, exact?: boolean): ForgeCallBudget;
  extend(reason: 'fit' | 'vocabulary'): Promise<void>;
  /** Validates current evidence against this run before any state can be saved or reused. */
  verdict(value: JudgeVerdict, image: boolean, draft?: ForgeDraft, sheet?: string): JudgeVerdict;
}
export type ForgeRunRecoveryErrorCode = 'binding' | 'corrupt' | 'unavailable' | 'interrupted';
export class ForgeRunRecoveryError extends Error {
  constructor(readonly code: ForgeRunRecoveryErrorCode) {
    super(`The private Forge recovery is ${code}.`);
    this.name = 'ForgeRunRecoveryError';
  }
}
