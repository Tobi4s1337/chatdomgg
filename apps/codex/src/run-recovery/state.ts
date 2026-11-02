import { randomUUID } from 'node:crypto';
import { FORGE_JUDGE_MESSAGES, type JudgeVerdict } from '../providers';
import { FORGE_CLEAR_SUBJECT_MINIMUM, agreedForgeWishSubject, forgeMeasureSlotMissed } from '../providers/policy';
import { FORGE_WAIT_MESSAGES, type ForgeRunSelection } from '../wish-decision';
import { ForgeRunRecoveryError, type ForgeRunState } from './types';

const quality = (verdict: JudgeVerdict) => verdict.quality?.score ?? 0;
export const goodForgeQuality = (verdict: JudgeVerdict) => quality(verdict) >= 0.72
  && verdict.detailMatch === 'met'
  && (verdict.quality?.recognisability ?? 0) >= FORGE_CLEAR_SUBJECT_MINIMUM
  && (verdict.quality?.completeness ?? 0) >= 0.7 && (verdict.quality?.cleanMarks ?? 0) >= 0.7;

export function initialForgeRunState(): ForgeRunState {
  return { id: `forge-${randomUUID()}`, at: Date.now(), phase: 'words', attempts: 0, verdicts: [], candidates: [] };
}
export function bestForgeCandidate(state: Pick<ForgeRunState, 'candidates' | 'verdicts'>): number | undefined {
  let best: number | undefined;
  for (let index = 0; index < state.candidates.length; index++) {
    const current = state.verdicts[state.candidates[index]!.verdict];
    if (!current || current.outcome !== 'pass') continue;
    const previous = best === undefined ? undefined : state.verdicts[state.candidates[best]!.verdict];
    if (!previous || (goodForgeQuality(current) && !goodForgeQuality(previous))
      || goodForgeQuality(current) === goodForgeQuality(previous) && quality(current) > quality(previous)) best = index;
  }
  return best;
}
export function forgeRunSelection(state: ForgeRunState): ForgeRunSelection {
  const selected = state.best === undefined ? undefined : state.candidates[state.best];
  const verdict = selected && state.verdicts[selected.verdict];
  if (!selected || !verdict || verdict.outcome !== 'pass') throw new ForgeRunRecoveryError('corrupt');
  // The gates' agreed reading of the words outranks the drafter's own claim about its interpretation.
  const measure = verdict.measure, agreed = measure ? agreedForgeWishSubject(measure) : undefined;
  const exact = measure && agreed ? agreed.motif === measure.plan.motif : selected.interpretation === 'as-wished';
  const unsupported = agreed ? agreed.motif === 'none' : selected.interpretation === 'closest';
  const reason = unsupported ? 'vocabulary' as const : !goodForgeQuality(verdict) ? 'quality' as const
    : state.softening ?? (measure && forgeMeasureSlotMissed(measure) ? 'fit' as const : undefined);
  // A softened piece never claims to keep a subject it does not show.
  const shared = exact ? 'subject' as const : selected.shared !== 'subject' ? selected.shared
    : measure && agreed?.slot === measure.plan.kind ? 'slot' as const : 'mood' as const;
  return { verdict: selected.verdict, attempt: selected.attempt,
    delivery: reason ? 'softened' : state.attempts > 1 ? 'retried' : 'delivered', shared,
    ...(reason ? { reason } : {}) };
}
export function forgeRunStopMessage(state: ForgeRunState): string {
  switch (state.stop?.code) {
    case 'safety-hold': return FORGE_JUDGE_MESSAGES.hold;
    case 'safety-refuse': return FORGE_JUDGE_MESSAGES.refuse;
    case 'no-slot': return FORGE_WAIT_MESSAGES.noSlot;
    case 'fit': return FORGE_WAIT_MESSAGES.fit;
    case 'service': return FORGE_WAIT_MESSAGES.service;
    case 'budget': return FORGE_WAIT_MESSAGES.budget;
    default: throw new ForgeRunRecoveryError('corrupt');
  }
}
