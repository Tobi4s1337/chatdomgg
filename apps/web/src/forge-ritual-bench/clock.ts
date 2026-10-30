import { forgeRitualFrame } from '@chatdom/forge';
import type { ForgeRitualFrame } from '@chatdom/shared';
import { BUILT_UNTIL } from './params';

/**
 * The bench's SIMULATED observation. Before the gate it is main's local frame; at the gate the reported
 * phase and progress stop while elapsed time keeps counting, as a pending live gate would.
 */
export function benchFrame(ritualId: string, t: number, gate: number | null): { frame: ForgeRitualFrame; held: number } {
  const stop = Math.min(gate ?? BUILT_UNTIL, BUILT_UNTIL);
  if (t < stop) return { frame: forgeRitualFrame(ritualId, t), held: 0 };
  const at = stop >= BUILT_UNTIL ? { ...forgeRitualFrame(ritualId, BUILT_UNTIL - 1e-6), phaseProgress: 1 } : forgeRitualFrame(ritualId, stop);
  return { frame: { ...at, elapsed: t }, held: t - stop };
}
