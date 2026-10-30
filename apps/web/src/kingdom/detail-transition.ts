export type DetailLevel = 1 | 2 | 4;
export const DETAIL_FADE_MS = 400;

/**
 * `from` and `to` keep their shader roles until an endpoint is reached, including on reversal.
 * During a fade draw `to` with aLodFade=progress and `from` with aLodFade=-1-progress.
 * The same screen-space threshold then selects exactly one of the two overlapping surfaces.
 * When inactive, from===to and that level is drawn once with aLodFade=1.
 */
export interface DetailTransition {
  readonly from: DetailLevel;
  readonly to: DetailLevel;
  readonly progress: number;
  readonly active: boolean;
  readonly at: number;
  readonly direction: -1 | 1;
  /** Latest desired third level; it starts once the current pair reaches an endpoint. */
  readonly queued: DetailLevel | null;
}

function settled(level: DetailLevel, at: number): DetailTransition {
  return { from: level, to: level, progress: 1, active: false, at, direction: 1, queued: null };
}

function begin(from: DetailLevel, to: DetailLevel, at: number): DetailTransition {
  return { from, to, progress: 0, active: true, at, direction: 1, queued: null };
}

/**
 * Advance once per rendered frame, using monotonic milliseconds. Reversals keep the existing
 * dither partition and run at the same rate, so reversing a 25% fade takes 100 ms to return.
 * A third requested level waits for the current endpoint: never discard a still-visible mesh.
 * `instant` is for fixed captures/cuts, where there is no intermediate frame to preserve.
 */
export function advanceDetailTransition(
  previous: DetailTransition | undefined,
  wanted: DetailLevel,
  now: number,
  instant = false,
): DetailTransition {
  if (wanted !== 1 && wanted !== 2 && wanted !== 4) throw new Error('Detail level must be 1, 2 or 4.');
  if (!Number.isFinite(now)) throw new Error('Detail transition time must be finite.');
  const at = Math.max(now, previous?.at ?? now);
  if (!previous || instant) return settled(wanted, at);
  if (!previous.active) return previous.to === wanted ? settled(wanted, at) : begin(previous.to, wanted, at);

  const progress = Math.max(0, Math.min(1, previous.progress + previous.direction * (at - previous.at) / DETAIL_FADE_MS));
  const reachedEndpoint = previous.direction === 1 ? progress === 1 : progress === 0;
  if (reachedEndpoint) {
    const level = previous.direction === 1 ? previous.to : previous.from;
    return level === wanted ? settled(level, at) : begin(level, wanted, at);
  }

  const direction = wanted === previous.from ? -1 : wanted === previous.to ? 1 : previous.direction;
  const queued = wanted !== previous.from && wanted !== previous.to ? wanted : null;
  // Reversing at the first frame of a fade returns directly to its untouched source.
  if (direction === -1 && progress === 0) return settled(previous.from, at);
  return { from: previous.from, to: previous.to, progress, active: true, at, direction, queued };
}
