import type { PlaceShot } from '../interactions/places/framing';

/** A witnessed game requests the host camera. Expiry is shared epoch milliseconds, never a RAF timestamp. */
export interface DirectorCue {
  readonly id: string;
  readonly priority: 'game';
  readonly shot: PlaceShot;
  readonly until: number | null;
}

/** One kingdom-bound producer, publishing its current cue (null withdraws it). */
export interface DirectorCueSource {
  subscribe(receive: (cue: DirectorCue | null) => void): () => void;
}

/** Detach from producer-owned arrays. A malformed or expired update withdraws that source's previous cue. */
export function snapshotDirectorCue(cue: DirectorCue | null, epochMs: number): DirectorCue | null {
  if (!cue || typeof cue.id !== 'string' || !cue.id.trim() || cue.id.length > 160 || cue.priority !== 'game'
    || (cue.until !== null && (!Number.isFinite(cue.until) || cue.until <= epochMs))) return null;
  const { eye, at } = cue.shot ?? {};
  if (!Array.isArray(eye) || !Array.isArray(at) || eye.length !== 3 || at.length !== 3
    || ![...eye, ...at].every(Number.isFinite) || Math.hypot(...eye.map((n, i) => n - at[i]!)) < .01) return null;
  return Object.freeze({ id: cue.id, priority: 'game', until: cue.until,
    shot: Object.freeze({ eye: Object.freeze([...eye]) as PlaceShot['eye'], at: Object.freeze([...at]) as PlaceShot['at'] }) });
}
