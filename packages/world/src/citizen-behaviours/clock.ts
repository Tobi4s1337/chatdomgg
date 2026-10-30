import { BEHAVIOUR_TUNING } from './tuning';

/**
 * Fixed policy steps due between the last processed step and `nowMs`, on an absolute grid of
 * `BEHAVIOUR_TUNING.stepMs`. Rendering cadence therefore never changes when a step happens.
 * A first call, a backward clock or a gap beyond the catch-up bound yields only the latest step:
 * the policy sees the jump and drops transient looks instead of replaying a backlog.
 */
export function dueBehaviourSteps(lastStepMs: number | null, nowMs: number): number[] {
  if (!Number.isFinite(nowMs)) throw new Error('Citizen behaviour needs a finite kingdom clock');
  const { stepMs, maxCatchUpSteps } = BEHAVIOUR_TUNING, latest = Math.floor(nowMs / stepMs) * stepMs;
  if (lastStepMs === null || latest < lastStepMs) return [latest];
  const count = Math.round((latest - lastStepMs) / stepMs);
  if (count > maxCatchUpSteps) return [latest];
  return Array.from({ length: count }, (_, i) => lastStepMs + (i + 1) * stepMs);
}
