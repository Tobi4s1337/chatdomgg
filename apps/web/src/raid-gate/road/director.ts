/**
 * The raid road's director (spec 23 R3, R6; Moments.md §7): one continuous journey told in acts, each held until the
 * fact that lets the next one begin has actually been observed. The gate gathers for as long as it takes; the column
 * sets out only once Twitch's raid is witnessed; the map rises when its drawing is ready; the column rides the public
 * caravan's 12–30 s; it waits at the destination's edge until the destination acknowledged the arrival and its world
 * is drawn; and the welcome begins when the authority has answered with it. Animation never stands in for a fact.
 *
 * Pure: a function of the presentation clock and the moments facts were observed on it, so a seek, a reload or a
 * capture lands on the same frame.
 */

export const ACTS = ['gather', 'setout', 'rise', 'ride', 'hold', 'wake', 'welcome', 'land', 'home'] as const;
export type Act = typeof ACTS[number];

/** Presentation seconds at which each fact was first observed, or null while it has not been. */
export interface RoadFacts {
  /** Twitch's raid was witnessed and this marcher's journey began (spec 23 R3: never a timer or an HTTP 200). */
  departedAt: number | null;
  /** The Atlas's drawing of the road is ready to rise into. */
  mapReadyAt: number | null;
  /** The destination acknowledged the arrival (committed) and its world has drawn. */
  arrivedAt: number | null;
  /** The authority answered with the welcome at the destination's gate. */
  welcomedAt: number | null;
  /**
   * Where the road ends. Waiting land has no world to enter (spec 23 R7): the column stops at its place on the map,
   * where the walker can watch the channel on Twitch, and nothing is woken or welcomed. Founded unless said.
   */
  land?: 'founded' | 'waiting';
  /** The walker chose to come home (their return journey committed, or they left the waiting land's map). */
  homeAt?: number | null;
}

export interface RoadTiming {
  /** The least time the gate takes to wake and gather, even if Twitch is quicker. */
  gather: number;
  setout: number;
  rise: number;
  /** The public caravan's ride, from the Atlas (12–30 s by distance). */
  ride: number;
  wake: number;
}

export const ROAD_TIMING: RoadTiming = { gather: 9, setout: 7, rise: 1.6, ride: 16, wake: 2.2 };
/** Reduced motion keeps every stage and its facts but dissolves instead of travelling. */
export const REDUCED_TIMING: RoadTiming = { gather: 4, setout: 1, rise: 0.6, ride: 3, wake: 0.8 };

export interface ActSpan { act: Act; start: number; /** The least duration; the act holds past it until the next fact. */ length: number }

export interface RoadMoment {
  act: Act;
  /** 0…1 through the act's own length (1 while it holds). */
  progress: number;
  /** Seconds since the act began. */
  elapsed: number;
  /** The acts that have begun so far, in order. */
  spans: ActSpan[];
  /** Waiting on a fact past the act's own length. */
  holding: boolean;
}

const after = (at: number | null) => (at === null ? Infinity : at);

/** When each act begins, given the facts so far. Acts whose fact has not been seen yet have not begun. */
export function schedule(facts: RoadFacts, timing: RoadTiming): ActSpan[] {
  const spans: ActSpan[] = [{ act: 'gather', start: 0, length: timing.gather }];
  const setout = Math.max(timing.gather, after(facts.departedAt));
  if (!Number.isFinite(setout)) return spans;
  spans.push({ act: 'setout', start: setout, length: timing.setout });
  const rise = Math.max(setout + timing.setout, after(facts.mapReadyAt));
  if (!Number.isFinite(rise)) return spans;
  spans.push({ act: 'rise', start: rise, length: timing.rise });
  const ride = rise + timing.rise;
  spans.push({ act: 'ride', start: ride, length: timing.ride });
  const rideEnd = ride + timing.ride;
  const home = after(facts.homeAt ?? null);
  if (facts.land === 'waiting') {
    // The road ends at the waiting land's place on the map: no hold for a world, no wake, no welcome.
    spans.push({ act: 'land', start: rideEnd, length: Infinity });
    if (Number.isFinite(home)) spans.push({ act: 'home', start: Math.max(rideEnd + 0.5, home), length: Infinity });
    return spans;
  }
  // The column waits at the destination's edge only if the destination is not ready when it gets there.
  const arrived = after(facts.arrivedAt);
  if (arrived > rideEnd) {
    spans.push({ act: 'hold', start: rideEnd, length: 0 });
    if (!Number.isFinite(arrived)) return spans;
  }
  const wake = Math.max(rideEnd, arrived);
  spans.push({ act: 'wake', start: wake, length: timing.wake });
  const welcome = Math.max(wake + timing.wake, after(facts.welcomedAt));
  if (!Number.isFinite(welcome)) return spans;
  spans.push({ act: 'welcome', start: welcome, length: Infinity });
  if (Number.isFinite(home)) spans.push({ act: 'home', start: Math.max(welcome + 0.5, home), length: Infinity });
  return spans;
}

export function momentAt(facts: RoadFacts, timing: RoadTiming, t: number): RoadMoment {
  const all = schedule(facts, timing);
  const spans = all.filter(span => span.start <= t);
  const current = spans[spans.length - 1] ?? all[0]!;
  const elapsed = Math.max(0, t - current.start);
  const progress = current.length === Infinity ? Math.min(1, elapsed / 12) : current.length > 0 ? Math.min(1, elapsed / current.length) : 1;
  return { act: current.act, progress, elapsed, spans, holding: current.length !== Infinity && elapsed > current.length };
}

/** Ease for a walk that starts and settles gently. */
export const easeInOut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The map's frame for a moment: the rise into the drawing, the column's travel along the road (its banner-bearer
 * reaches the destination at 1), the rest of the column filing in through the gate, and the drawing's wake. While it
 * holds, the column stands on the road at the destination's edge.
 */
export function mapFrame(moment: RoadMoment): { rise: number; travel: number; file: number; wake: number; marching: boolean } {
  switch (moment.act) {
    case 'gather': case 'setout': return { rise: 0, travel: 0, file: 0, wake: 0, marching: false };
    case 'rise': return { rise: moment.progress, travel: 0, file: 0, wake: 0, marching: true };
    case 'ride': return { rise: 1, travel: easeInOut(moment.progress), file: 0, wake: 0, marching: true };
    case 'hold': return { rise: 1, travel: 1, file: 0, wake: 0, marching: true };
    case 'wake': return { rise: 1, travel: 1, file: Math.min(1, moment.progress / 0.7), wake: moment.progress, marching: moment.progress < 0.7 };
    case 'welcome': return { rise: 1, travel: 1, file: 1, wake: 1, marching: false };
    case 'land': return { rise: 1, travel: 1, file: 1, wake: 0, marching: false };
    case 'home': return { rise: 0, travel: 0, file: 0, wake: 0, marching: false };
  }
}

/** The three chapters a viewer is told about, and which one a moment belongs to. */
export const CHAPTERS = [
  { id: 'gate', title: 'The gate wakes' },
  { id: 'road', title: 'The road' },
  { id: 'welcome', title: 'The welcome' },
] as const;
export function chapterOf(act: Act): typeof CHAPTERS[number]['id'] {
  return act === 'gather' || act === 'setout' || act === 'home' ? 'gate' : act === 'welcome' || act === 'wake' || act === 'land' ? 'welcome' : 'road';
}

/** A smooth step from `from` to `to`, for fades driven by an act's progress. */
export const ramp = (from: number, to: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
