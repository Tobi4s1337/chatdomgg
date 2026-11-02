// The growth set's shots, as data. A shot locks one camera on the product's growth stage and maps shot time onto
// the growth sequence's own clock (a time-lapse), so every frame is a pure function of t.
import type { Act, Shot } from '../../../../web/src/growth/score';

/** A point on the growth sequence, relative to one of its acts (the n-th act of that kind). */
export interface Anchor { readonly act: Act['kind']; readonly index?: number; readonly at: number }

/** At shot time `t`, the sequence stands at `at`. */
export interface TimeKey { readonly t: number; readonly at: Anchor }

export interface GrowthShot {
  readonly id: string;
  /** Seconds in the cut. */
  readonly duration: number;
  /** Hour of the evening the stage is lit for. */
  readonly hour: number;
  /** One of the stage's own camera poses, held still: `local` picks where along that pose's drift it is held. */
  readonly camera: { readonly from: Shot; readonly to: Shot; readonly blend: number; readonly local: number };
  /**
   * The time-lapse: shot time to sequence time through these keys, on a smooth monotone curve (it never runs
   * backwards or overshoots a key). The first key is at t = 0 and the last at the shot's duration.
   */
  readonly keys: readonly TimeKey[];
  /** The pace at the first and last key, in sequence seconds per shot second: low values ease in and settle. */
  readonly endPace: readonly [number, number];
}

const WIDE: Shot = { kind: 'wide', drift: 0 };

export const SHOTS: Record<string, GrowthShot> = {
  // S13, "Come back… and it grows with you". The stage's wide pose, held still: the citizen's lit hall in the
  // foreground, the town behind it, the dusk horizon above, and open meadow to the right. Three neighbours on the
  // hall's street grow into manors, the new quarter's streets spread across the meadow from its green, then its
  // homes rise in a wave and settle as their windows come on. About 19.5 s of the sequence in 5 s (3.9x on average):
  // up to 5.6x through the neighbours and the gap before the streets, about 4x through the streets and homes, then
  // easing to a stop as the last windows light. (The quarter pose shows the same growth from higher up, as a map
  // with no horizon; `?cam=quarter` renders it.)
  S13: {
    id: 'S13', duration: 5, hour: 19.6,
    camera: { from: WIDE, to: WIDE, blend: 1, local: 0 },
    keys: [
      { t: 0, at: { act: 'rise', at: 2.35 } },       // just before the first neighbour starts to grow
      { t: 1.8, at: { act: 'quarter', at: 2.2 } },   // the neighbours stand as manors; the quarter's streets spread
      { t: 4.3, at: { act: 'quarter', at: 11.75 } }, // the last homes in view stand
      { t: 5, at: { act: 'quarter', at: 13.3 } },    // their windows come on
    ],
    endPace: [1.5, 1],
  },
};

/**
 * Shot time to sequence time: monotone cubic (PCHIP) through the keys, already resolved to sequence seconds.
 * Held at the ends outside the keys.
 */
export function sequenceTime(keys: readonly { t: number; at: number }[], endPace: readonly [number, number], t: number): number {
  const n = keys.length;
  if (t <= keys[0]!.t) return keys[0]!.at;
  if (t >= keys[n - 1]!.t) return keys[n - 1]!.at;
  const h = keys.slice(1).map((k, i) => k.t - keys[i]!.t);
  const d = keys.slice(1).map((k, i) => (k.at - keys[i]!.at) / h[i]!);
  const m = keys.map((_, i) => {
    if (i === 0) return Math.min(endPace[0], 3 * d[0]!);
    if (i === n - 1) return Math.min(endPace[1], 3 * d[n - 2]!);
    const a = d[i - 1]!, b = d[i]!;
    if (a <= 0 || b <= 0) return 0;
    const w1 = 2 * h[i]! + h[i - 1]!, w2 = h[i]! + 2 * h[i - 1]!;
    return (w1 + w2) / (w1 / a + w2 / b);
  });
  let i = 0;
  while (t > keys[i + 1]!.t) i++;
  const s = (t - keys[i]!.t) / h[i]!, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * keys[i]!.at + (s3 - 2 * s2 + s) * h[i]! * m[i]!
    + (-2 * s3 + 3 * s2) * keys[i + 1]!.at + (s3 - s2) * h[i]! * m[i + 1]!;
}
