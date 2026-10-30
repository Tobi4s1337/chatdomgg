import { FORGE_PHASES, type ForgePhase, type ForgeRitualFrame } from '@chatdom/shared';

/** The only facts the presentation reads from an observed run. */
export interface StageFrame {
  ritualId: string;
  phase: ForgePhase;
  /** Progress inside the supplied phase, clamped to [0, 1]. Never recomputed from elapsed time. */
  progress: number;
  /** Seconds since the run began; used only for calm, bounded idle motion while a phase is held. */
  elapsed: number;
  live: boolean;
}

/** A frame that cannot be trusted is rejected rather than repaired into a guessed phase. */
export function readStageFrame(frame: ForgeRitualFrame): StageFrame | null {
  if (typeof frame !== 'object' || frame === null) return null;
  if (typeof frame.ritualId !== 'string' || frame.ritualId.length === 0) return null;
  if (!(FORGE_PHASES as readonly string[]).includes(frame.phase)) return null;
  if (!Number.isFinite(frame.phaseProgress) || !Number.isFinite(frame.elapsed)) return null;
  if (frame.source !== 'simulated' && frame.source !== 'live') return null;
  return {
    ritualId: frame.ritualId,
    phase: frame.phase,
    progress: Math.min(1, Math.max(0, frame.phaseProgress)),
    elapsed: Math.max(0, frame.elapsed),
    live: frame.source === 'live',
  };
}

/** FNV-1a; the ritual id seeds which authored runes appear, never the words themselves. */
export function ritualSeed(ritualId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < ritualId.length; i++) hash = Math.imul(hash ^ ritualId.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const smoother = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };
/** A toy-like settle: a little overshoot, then rest. */
export const backOut = (t: number) => { const c = 1.45, u = clamp01(t) - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
