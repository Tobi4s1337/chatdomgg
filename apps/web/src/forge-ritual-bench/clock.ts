import { forgeRitualFrame } from '@chatdom/forge';
import type { ForgeRitualFrame } from '@chatdom/shared';
import { RITUAL_SECONDS } from './params';

/**
 * The bench's SIMULATED observation. Before the gate it is main's local frame; at the gate the reported
 * phase and progress stop while elapsed time keeps counting, as a pending live gate would. A gate on a stage
 * boundary holds the finished earlier stage, never the first instant of the next.
 */
export function benchFrame(ritualId: string, t: number, gate: number | null): { frame: ForgeRitualFrame; held: number } {
  if (gate === null) return { frame: forgeRitualFrame(ritualId, Math.min(t, RITUAL_SECONDS)), held: 0 };
  const stop = Math.min(gate, RITUAL_SECONDS);
  if (t < stop) return { frame: forgeRitualFrame(ritualId, t), held: 0 };
  let at = forgeRitualFrame(ritualId, stop);
  if (stop > 0 && at.phaseProgress === 0) at = { ...forgeRitualFrame(ritualId, stop - 1e-6), phaseProgress: 1 };
  return { frame: { ...at, elapsed: t }, held: t - stop };
}
