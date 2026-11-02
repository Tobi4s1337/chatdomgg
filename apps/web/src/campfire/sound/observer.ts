import type { CampfireFrame, DuskCourtPhase, DuskCourtView } from '@chatdom/shared';
import type { CampfireCue } from './materials';

/** A local render or delivery gap longer than this is an interruption: the next frame is a silent baseline. */
export const CAMPFIRE_OBSERVATION_GAP_MS = 1500;
/** Gallery embers can rise in quick succession while chat piles in; one spark tick at most this often. */
export const CAMPFIRE_EMBER_SPACING_MS = 450;

/** Only the public fields a cue may depend on. Never a role, a name, a vote target or anything private. */
interface Witnessed {
  match: string;
  revision: number;
  phase: DuskCourtPhase;
  dawn: { night: number; seat: number | null } | null;
  verdict: { night: number; seat: number | null } | null;
  winner: 'town' | 'wolves' | null;
  embers: Map<number, number>;
}

/**
 * Turns witnessed public Dusk Court frames into cues. A cue sounds only for a transition seen between two
 * consecutive public revisions of one match. First observations, revision gaps, local gaps and reconnections
 * establish a silent baseline: nothing that happened while we were not listening is ever replayed.
 */
export class CampfireObserver {
  private observed = false;
  private previous: Witnessed | null = null;
  private at = -Infinity;
  private seenAt = -Infinity;
  private emberAt = -Infinity;

  reset(): void {
    this.observed = false; this.previous = null; this.at = -Infinity; this.seenAt = -Infinity; this.emberAt = -Infinity;
  }

  /** `frame` is the raw witnessed public frame (null: none witnessed); `now` is the host's monotonic clock, ms. */
  step(frame: CampfireFrame | null, now: number): CampfireCue[] {
    if (!Number.isFinite(now) || now < this.seenAt || now - this.seenAt > CAMPFIRE_OBSERVATION_GAP_MS) this.reset();
    if (!frame || !Number.isFinite(frame.at)) { this.reset(); return []; }
    this.seenAt = now;
    // An older delivery is not an observation. Keep the accepted watermark.
    if (frame.at < this.at) return [];
    const court = frame.court, previous = this.previous, first = !this.observed;
    if (court && previous && court.match === previous.match && court.revision <= previous.revision) return [];
    this.observed = true; this.at = frame.at;
    if (!court) { this.previous = null; return []; }
    const current = witness(court);
    this.previous = current;
    if (first) return [];
    // A new round. Only its call is news; a match first met later in its life is a baseline.
    if (!previous || previous.match !== current.match) return current.phase === 'call' ? ['ask'] : [];
    if (current.revision !== previous.revision + 1) return [];
    return this.transition(previous, current, now);
  }

  private transition(before: Witnessed, after: Witnessed, now: number): CampfireCue[] {
    const cues: CampfireCue[] = [];
    if (after.phase !== before.phase) {
      if (after.phase === 'deal') cues.push('deal');
      if (after.phase === 'night') cues.push('night');
      if (after.phase === 'ballot') cues.push('ballot');
    }
    // The dawn is read when its record arrives (with a Magistrate presiding, after the dawn phase has begun).
    if (after.dawn && after.dawn.night !== before.dawn?.night) cues.push(after.dawn.seat === null ? 'dawn' : 'snuff');
    // No one sent (a tie or an empty ballot) is the hollow knock; someone sent is the thud.
    if (after.verdict && after.verdict.night !== before.verdict?.night) cues.push(after.verdict.seat === null ? 'spared' : 'sent');
    if (after.phase === 'ended' && before.phase !== 'ended' && after.winner) cues.push(after.winner);
    let rising = false;
    for (const [seat, embers] of after.embers) if (embers > (before.embers.get(seat) ?? 0)) rising = true;
    if (rising && now - this.emberAt >= CAMPFIRE_EMBER_SPACING_MS) { cues.push('ember'); this.emberAt = now; }
    return cues;
  }
}

/** A defensive copy: the host may mutate or reuse its objects; we compare against what was actually witnessed. */
function witness(court: DuskCourtView): Witnessed {
  const embers = new Map<number, number>();
  for (const player of court.players) embers.set(player.seat, player.embers);
  return {
    match: court.match, revision: court.revision, phase: court.phase,
    dawn: court.dawn ? { night: court.dawn.night, seat: court.dawn.seat } : null,
    verdict: court.verdict ? { night: court.verdict.night, seat: court.verdict.seat } : null,
    winner: court.result?.winner ?? null, embers,
  };
}
